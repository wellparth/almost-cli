import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentTool, PermissionSet } from "@almost/agent-core";
import { buildToolRegistry, resolveTools } from "@almost/tools";
import type { AgentDefinition } from "./index.js";
import { BUILTIN_AGENTS } from "./index.js";

/**
 * Serialized form of an agent, as persisted on disk. Tools are referenced by
 * name and resolved against the built-in tool registry.
 */
export interface SerializedAgent {
  id: string;
  name: string;
  systemPrompt: string;
  /** Names of tools from the built-in tool registry. */
  tools: string[];
  permissionDefaults: PermissionSet;
  defaultModelHint?: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const AGENT_FILE_SUFFIX = "-agent.json";

/**
 * Registry over built-in agents plus user-defined agents persisted as JSON in
 * the agents directory (MYAGENT_HOME/agents by default).
 */
export class AgentRegistry {
  readonly #agentsDir?: string;
  readonly #registry: Map<string, AgentTool>;
  readonly #userCache = new Map<string, AgentDefinition>();

  constructor(options: { agentsDir?: string; registry?: Map<string, AgentTool> } = {}) {
    this.#agentsDir = options.agentsDir;
    this.#registry = options.registry ?? buildToolRegistry();
  }

  get toolNames(): string[] {
    return [...this.#registry.keys()].sort();
  }

  builtin(id: string): AgentDefinition | undefined {
    return BUILTIN_AGENTS.find((a) => a.id === id);
  }

  /** Built-in agents always available, plus loaded user agents. */
  async listAgents(): Promise<AgentDefinition[]> {
    const users = await this.#loadUsers();
    return [...BUILTIN_AGENTS, ...users];
  }

  async listIds(): Promise<string[]> {
    return (await this.listAgents()).map((a) => a.id);
  }

  async has(id: string): Promise<boolean> {
    return (await this.listIds()).includes(id);
  }

  async get(id: string): Promise<AgentDefinition> {
    const builtin = this.builtin(id);
    if (builtin) return builtin;
    const user = this.#userCache.get(id) ?? (await this.#loadUsers()).find((a) => a.id === id);
    if (!user) {
      throw new Error(`unknown agent '${id}' (available: ${(await this.listIds()).join(", ")})`);
    }
    return user;
  }

  /** Validate, persist, and register a new user agent (overwrites same id). */
  async create(serialized: SerializedAgent): Promise<AgentDefinition> {
    if (!this.#agentsDir) throw new Error("agent registry has no agents directory (read-only)");
    const errors = validateSerialized(serialized, this.#registry);
    if (errors.length > 0) throw new Error(`invalid agent: ${errors.join("; ")}`);
    const definition = toDefinition(serialized, this.#registry);
    const file = path.join(this.#agentsDir, `${serialized.id}${AGENT_FILE_SUFFIX}`);
    await fs.mkdir(this.#agentsDir, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(serialized, null, 2)}\n`, { encoding: "utf8" });
    this.#userCache.set(serialized.id, definition);
    return definition;
  }

  async remove(id: string): Promise<void> {
    if (!this.#agentsDir) throw new Error("agent registry has no agents directory (read-only)");
    if (this.builtin(id)) throw new Error(`cannot remove built-in agent '${id}'`);
    await fs.rm(path.join(this.#agentsDir, `${id}${AGENT_FILE_SUFFIX}`), { force: true });
    this.#userCache.delete(id);
  }

  async #loadUsers(): Promise<AgentDefinition[]> {
    if (!this.#agentsDir) return [];
    const definitions: AgentDefinition[] = [];
    this.#userCache.clear();
    let files: string[];
    try {
      files = await fs.readdir(this.#agentsDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw error;
    }
    for (const file of files.sort()) {
      if (!file.endsWith(AGENT_FILE_SUFFIX)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.readFile(path.join(this.#agentsDir, file), "utf8"));
      } catch {
        continue; // skip malformed files instead of failing the whole registry
      }
      const errors = validateSerialized(parsed as SerializedAgent, this.#registry);
      if (errors.length > 0) continue;
      const definition = toDefinition(parsed as SerializedAgent, this.#registry);
      this.#userCache.set(definition.id, definition);
      definitions.push(definition);
    }
    return definitions;
  }
}

/** Validate a parsed serialized agent; returns human-readable errors. */
export function validateSerialized(
  agent: SerializedAgent,
  registry: Map<string, AgentTool> = buildToolRegistry(),
): string[] {
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) {
    return ["agent must be an object"];
  }
  const errors: string[] = [];
  if (typeof agent.id !== "string" || !ID_PATTERN.test(agent.id)) {
    errors.push(`id must match ${String(ID_PATTERN)}`);
  }
  if (typeof agent.name !== "string" || agent.name.length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (typeof agent.systemPrompt !== "string" || agent.systemPrompt.length === 0) {
    errors.push("systemPrompt must be a non-empty string");
  }
  if (!Array.isArray(agent.tools)) {
    errors.push("tools must be an array of tool names");
  } else {
    for (const name of agent.tools) {
      if (typeof name !== "string" || !registry.has(name)) {
        errors.push(`unknown tool '${String(name)}' (available: ${[...registry.keys()].sort().join(", ")})`);
      }
    }
  }
  const p = agent.permissionDefaults;
  if (typeof p !== "object" || p === null) {
    errors.push("permissionDefaults must be an object");
  } else {
    for (const area of ["filesystem", "shell", "git"] as const) {
      if (typeof p[area] !== "object" || p[area] === null) {
        errors.push(`permissionDefaults.${area} must be an object`);
      }
    }
  }
  if (agent.defaultModelHint !== undefined && typeof agent.defaultModelHint !== "string") {
    errors.push("defaultModelHint must be a string");
  }
  return errors;
}

function toDefinition(
  agent: SerializedAgent,
  registry: Map<string, AgentTool> = buildToolRegistry(),
): AgentDefinition {
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    tools: resolveTools(agent.tools, registry),
    permissionDefaults: agent.permissionDefaults,
    defaultModelHint: agent.defaultModelHint,
  };
}