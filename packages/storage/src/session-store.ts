import type {
  AgentEvent,
  AgentMessage,
  Session,
  SessionMetadata,
  SessionStore,
} from "@almost/agent-core";
import { mkdir, readFile, readdir, unlink, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, readJson } from "./fs.js";

function newId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `session-${ts}-${rand}`;
}

/**
 * Session layout (plan section 19):
 * sessions/<id>/metadata.json, messages.jsonl, events.jsonl
 */
export class DiskSessionStore implements SessionStore {
  readonly #sessionsDir: string;

  constructor(sessionsDir: string) {
    this.#sessionsDir = sessionsDir;
  }

  async create(metadata: Omit<SessionMetadata, "id" | "createdAt" | "updatedAt">): Promise<Session> {
    const id = newId();
    const dir = join(this.#sessionsDir, id);
    const now = Date.now();
    const full: SessionMetadata = { ...metadata, id, createdAt: now, updatedAt: now };
    await atomicWrite(join(dir, "metadata.json"), JSON.stringify(full, null, 2));
    await atomicWrite(join(dir, "messages.jsonl"), "");
    await atomicWrite(join(dir, "events.jsonl"), "");
    return { metadata: full, messages: [], events: [] };
  }

  async load(id: string): Promise<Session | undefined> {
    const dir = this.resolve(dirForIdSafe(id));
    const metadata = await readJson<SessionMetadata | null>(join(dir, "metadata.json"), null);
    if (!metadata) return undefined;
    const messages = (await this.readLines(join(dir, "messages.jsonl"))) as AgentMessage[];
    const events = (await this.readLines(join(dir, "events.jsonl"))) as AgentEvent[];
    return { metadata, messages, events };
  }

  async list(): Promise<SessionMetadata[]> {
    let entries;
    try {
      entries = await readdir(this.#sessionsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const metadatas: SessionMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readJson<SessionMetadata | null>(
        join(this.#sessionsDir, entry.name, "metadata.json"),
        null,
      );
      if (meta) metadatas.push(meta);
    }
    return metadatas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async appendMessage(sessionId: string, message: AgentMessage): Promise<void> {
    const dir = this.resolve(dirForIdSafe(sessionId));
    await this.appendLine(join(dir, "messages.jsonl"), JSON.stringify(message));
    await this.touch(sessionId);
  }

  async appendEvent(sessionId: string, event: AgentEvent): Promise<void> {
    const dir = this.resolve(dirForIdSafe(sessionId));
    await this.appendLine(join(dir, "events.jsonl"), JSON.stringify(event));
    await this.touch(sessionId);
  }

  async touch(sessionId: string): Promise<void> {
    const dir = this.resolve(dirForIdSafe(sessionId));
    const metadata = await readJson<SessionMetadata | null>(join(dir, "metadata.json"), null);
    if (!metadata) return;
    metadata.updatedAt = Date.now();
    await atomicWrite(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));
  }

  async remove(sessionId: string): Promise<void> {
    await unlink(join(this.resolve(dirForIdSafe(sessionId)), "metadata.json"));
  }

  resolve(dir: string): string {
    return join(this.#sessionsDir, dir);
  }

  async readLines(path: string): Promise<unknown[]> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  async appendLine(path: string, line: string): Promise<void> {
    await mkdir(this.#sessionsDir, { recursive: true });
    await appendFile(path, line + "\n", "utf8");
  }
}

function dirForIdSafe(id: string): string {
  if (id.includes("/") || id.includes("..")) throw new Error(`invalid session id: ${id}`);
  return id;
}