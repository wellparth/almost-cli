// Local audit log: every security-relevant action is recorded to an append-only
// JSONL file. Secrets are redacted before writing.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentEvent } from "@almost/agent-core";
import { SecretRedactor } from "./secrets.js";

export type AuditCategory =
  | "run"
  | "tool"
  | "permission"
  | "config"
  | "auth"
  | "agent"
  | "mcp"
  | "network"
  | "security"
  | "system";

export interface AuditEntry {
  timestamp: string;
  category: AuditCategory;
  actor: string;
  action: string;
  detail?: string;
  decision?: string;
  eventType?: string;
}

export interface AuditStoreOptions {
  /** Perform secret redaction on entry fields (default true). */
  redact?: boolean;
}

export class AuditStore {
  readonly #file: string;
  readonly #redactor: SecretRedactor;
  #entries: AuditEntry[] = [];

  constructor(auditFile: string, options: AuditStoreOptions = {}) {
    this.#file = auditFile;
    this.#redactor = new SecretRedactor();
  }

  static async open(auditDir: string, options?: AuditStoreOptions): Promise<AuditStore> {
    await fs.mkdir(auditDir, { recursive: true });
    const store = new AuditStore(path.join(auditDir, "audit.jsonl"), options);
    await store.#load();
    return store;
  }

  async #load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.#file, "utf8");
      if (!raw.trim()) return;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          this.#entries.push(JSON.parse(line) as AuditEntry);
        } catch {
          // skip corrupt lines; audit should never fail the app
        }
      }
    } catch {
      // file may not exist yet
    }
  }

  get size(): number {
    return this.#entries.length;
  }

  entries(): AuditEntry[] {
    return [...this.#entries];
  }

  async append(entry: AuditEntry): Promise<void> {
    const redacted: AuditEntry = {
      ...entry,
      detail: entry.detail ? this.#redactor.redact(entry.detail) : undefined,
    };
    this.#entries.push(redacted);
    await this.#flush();
  }

  async #flush(): Promise<void> {
    const lines = this.#entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.writeFile(this.#file, lines, { mode: 0o600, flag: "w" });
  }
}

/** Maps agent loop events to audit entries, with redaction + attribution. */
export function auditFromAgentEvent(event: AgentEvent, actorAgentId: string): AuditEntry | undefined {
  const ts = new Date().toISOString();
  switch (event.type) {
    case "ToolRequested": {
      const detail = `name=${event.tool}(input=${JSON.stringify(event.input).slice(0, 300)})`;
      return { timestamp: ts, category: "tool", actor: `agent:${event.agentId}`, action: "tool.request", detail };
    }
    case "ToolExecuted":
      return {
        timestamp: ts,
        category: "tool",
        actor: `agent:${event.agentId}`,
        action: "tool.executed",
        detail: `name=${event.tool}`,
        decision: event.ok ? "allowed" : "failed",
      };
    case "PermissionRequested":
      return {
        timestamp: ts,
        category: "permission",
        actor: `agent:${event.agentId}`,
        action: "permission.requested",
        detail: event.permission,
        decision: "pending",
      };
    case "AgentStarted":
      return { timestamp: ts, category: "run", actor: `agent:${event.agentId}`, action: "agent.started" };
    case "AgentCompleted":
      return {
        timestamp: ts,
        category: "run",
        actor: `agent:${event.agentId}`,
        action: "agent.completed",
        decision: "ok",
      };
    case "AgentFailed":
      return {
        timestamp: ts,
        category: "run",
        actor: `agent:${event.agentId}`,
        action: "agent.failed",
        detail: event.error,
      };
    case "SecurityWarning":
      return {
        timestamp: ts,
        category: "security",
        actor: actorAgentId,
        action: "security.warning",
        detail: event.detail,
      };
    default:
      return undefined;
  }
}

export function auditSink(store: AuditStore, agentId: string) {
  return async (event: AgentEvent): Promise<void> => {
    const entry = auditFromAgentEvent(event, agentId);
    if (entry) await store.append(entry);
  };
}