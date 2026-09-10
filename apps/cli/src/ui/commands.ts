// Slash command handlers for the TUI (issue #34).
import type { AppState } from "@almost/storage";
import { AgentRegistry } from "@almost/agents";
import { createBuiltinRegistry } from "@almost/providers";
import { listModelsFor, providerAuthEnvNames } from "../runner.js";
import { listSkills, findSkill, skillRoots } from "./skills.js";
import path from "node:path";

export interface SlashResult {
  title?: string;
  lines: string[];
}

export const COMMAND_HELP: Record<string, string> = {
  "/help": "show this help",
  "/exit": "exit the TUI (alias: /quit, /q)",
  "/new": "start a fresh conversation",
  "/clear": "clear the chat pane",
  "/thinking": "toggle reasoning visibility",
  "/details": "toggle tool execution details",
  "/agents": "list agents (built-in + custom)",
  "/models [provider]": "list available models",
  "/config get <key>": "read config (default-provider, default-model, agent)",
  "/config set <key> <value>": "write config",
  "/sessions": "list sessions",
  "/sessions show <id>": "show a session",
  "/sessions rm <id>": "delete a session",
  "/auth": "list stored credentials (names only)",
  "/connect [provider]": "list providers + auth status, or set default-provider",
  "/skill [name]": "list local skills, or show a skill's details",
  "/mcp": "list configured MCP servers",
};

const APP_COMMANDS = new Set(["/help", "/exit", "/quit", "/q", "/new", "/clear", "/thinking", "/details"]);

export function isSlashCommand(input: string): boolean {
  return input.startsWith("/");
}

export function isAppCommand(input: string): boolean {
  const head = input.trim().split(/\s+/)[0] ?? "";
  return APP_COMMANDS.has(head);
}

export function commandName(input: string): string {
  return (input.trim().split(/\s+/)[0] ?? "").toLowerCase();
}

async function registryFor(state: AppState): Promise<AgentRegistry> {
  return new AgentRegistry({ agentsDir: path.join(state.paths.root, "agents") });
}

async function helpResult(): Promise<SlashResult> {
  const lines = Object.entries(COMMAND_HELP).map(([cmd, desc]) => `  ${cmd.padEnd(28)} ${desc}`);
  return { title: "Available commands", lines };
}

async function runAgents(state: AppState): Promise<SlashResult> {
  const registry = await registryFor(state);
  const agents = await registry.listAgents();
  if (agents.length === 0) return { lines: ["no agents"] };
  const lines = agents.map((agent) => `- ${agent.id}  ${agent.name}  tools: ${agent.tools.map((t) => t.name).join(", ")}`);
  return { title: `Agents (${agents.length})`, lines };
}

async function runModels(state: AppState, rest: string[]): Promise<SlashResult> {
  const providerId = rest[0];
  const provider = (() => {
    const registry = createBuiltinRegistry();
    const id = providerId ?? state.config.get("defaultProvider");
    return registry.get(id ?? "");
  })();
  if (!provider) return { title: "Models", lines: ["(no provider configured; run /config set default-provider <id>)"] };
  const models = await listModelsFor(state, providerId);
  if (models.length === 0) return { title: `${provider.id} models`, lines: ["  (model listing not available)"] };
  return { title: `${provider.id} models`, lines: models.map((m) => `- ${m}`) };
}

const CONFIG_KEYS = ["default-provider", "default-model", "agent"] as const;
type ConfigInternal = "defaultProvider" | "defaultModel" | "agent";

async function runConfig(state: AppState, rest: string[]): Promise<SlashResult> {
  const [sub, key, ...valueParts] = rest;
  const all = (state.config as unknown as { all(): Record<string, string> }).all();
  if (!sub || sub === "get") {
    if (!key) {
      return {
        title: "Config",
        lines: CONFIG_KEYS.map((k) => `- ${k} = ${all[CONFIG_KEYS_LABEL[k]] ?? "(unset)"}`),
      };
    }
    const internal = CONFIG_KEYS_LABEL[key as (typeof CONFIG_KEYS)[number]];
    if (!internal) return { title: "Config", lines: [`unknown key '${key}' (available: ${CONFIG_KEYS.join(", ")})`] };
    return { title: "Config", lines: [`${key} = ${all[internal] ?? "(unset)"}`] };
  }
  if (sub === "set") {
    if (!key || valueParts.length === 0) return { title: "Config", lines: ["usage: /config set <key> <value>"] };
    const internal = CONFIG_KEYS_LABEL[key as (typeof CONFIG_KEYS)[number]];
    const value = valueParts.join(" ");
    if (!internal) return { title: "Config", lines: [`unknown key '${key}' (available: ${CONFIG_KEYS.join(", ")})`] };
    state.config.set(internal, value);
    await state.config.save();
    return { title: "Config", lines: [`${key} = ${value}`] };
  }
  return { title: "Config", lines: ["usage: /config <get|set>"] };
}

const CONFIG_KEYS_LABEL: Record<(typeof CONFIG_KEYS)[number], ConfigInternal> = {
  "default-provider": "defaultProvider",
  "default-model": "defaultModel",
  agent: "agent",
};

async function runSessions(state: AppState, rest: string[]): Promise<SlashResult> {
  const [sub, id] = rest;
  if (sub === "show") {
    if (!id) return { title: "Sessions", lines: ["usage: /sessions show <id>"] };
    const session = await state.sessions.load(id);
    if (!session) return { title: "Sessions", lines: [`no session '${id}'`] };
    const lines = session.messages.map((m) => {
      const text = (m.payload as { text?: unknown })?.text ?? "";
      return `  [${m.from}] ${String(text).slice(0, 200)}`;
    });
    return { title: `Session ${id} (${lines.length} messages)`, lines: lines.length ? lines : ["  (no messages)"] };
  }
  if (sub === "rm") {
    if (!id) return { title: "Sessions", lines: ["usage: /sessions rm <id>"] };
    await state.sessions.remove(id);
    return { title: "Sessions", lines: [`removed session ${id}`] };
  }
  const list = await state.sessions.list();
  if (list.length === 0) return { title: "Sessions", lines: ["no sessions"] };
  const lines = list.map((meta) => `- ${meta.id}  ${meta.cwd ?? ""}  (${new Date(meta.updatedAt).toISOString()})`);
  return { title: `Sessions (${list.length})`, lines };
}

async function runAuth(state: AppState): Promise<SlashResult> {
  const names = state.credentials.keys();
  if (names.length === 0) return { title: "Credentials", lines: ["no stored credentials"] };
  return { title: "Stored credentials", lines: names.map((n) => `- ${n}`) };
}

function providerOk(state: AppState, providerId: string): boolean {
  const names = providerAuthEnvNames(providerId);
  return names.some((n) => state.credentials.resolve(n) !== undefined || process.env[n] !== undefined);
}

async function runConnect(state: AppState, rest: string[]): Promise<SlashResult> {
  const registry = createBuiltinRegistry();
  const target = rest[0];
  if (target) {
    if (!registry.has(target)) {
      return { title: "Connect", lines: [`unknown provider '${target}' (available: ${registry.ids().join(", ")})`] };
    }
    state.config.set("defaultProvider", target);
    await state.config.save();
    const envVars = providerAuthEnvNames(target);
    if (providerOk(state, target)) {
      return { title: "Connect", lines: [`${target} is connected and set as default provider.`] };
    }
    const hint = envVars.length > 0 ? `export ${envVars.join(" or ")} then run: myagent auth set ${envVars[0]}` : "no env var known";
    return {
      title: "Connect",
      lines: [
        `${target} set as default provider, but no API key found.`,
        `  ${hint}`,
        `  or run /auth to check stored credentials.`,
      ],
    };
  }
  const lines = registry.ids().map((id) => {
    const envVars = providerAuthEnvNames(id);
    const status = providerOk(state, id) ? "connected" : "missing key";
    const env = envVars.length > 0 ? ` (${envVars.join(" / ")})` : "";
    const current = state.config.get("defaultProvider") === id ? "  [default]" : "";
    return `- ${id}  ${status}${current}${env}`;
  });
  return { title: "Providers", lines };
}

async function runSkill(rest: string[]): Promise<SlashResult> {
  const name = rest[0];
  if (name) {
    const skill = await findSkill(name);
    if (!skill) {
      const all = await listSkills();
      const available = all.length > 0 ? all.map((s) => s.name).join(", ") : "(none found)";
      return { title: "Skills", lines: [`no skill '${name}'`, `available: ${available}`] };
    }
    return {
      title: `Skill: ${skill.name}`,
      lines: [skill.description, skill.description.length > 0 ? "" : "", `  source: ${skill.path}`].filter((l) => l.length > 0),
    };
  }
  const skills = await listSkills();
  if (skills.length === 0) return { title: "Skills", lines: ["no skills found", "  scanned: " + skillRootsForHelp()] };
  const lines = skills.map((s) => `- ${s.name}  ${s.description.split("\n")[0] ?? ""}`.slice(0, 160));
  return { title: `Skills (${skills.length})`, lines };
}

function skillRootsForHelp(): string {
  return skillRoots().filter(Boolean).join(", ");
}

async function runMcp(state: AppState): Promise<SlashResult> {
  const { loadMcpConfig } = await import("@almost/mcp");
  const config = await loadMcpConfig(state.paths.root);
  if (config.servers.length === 0) return { title: "MCP servers", lines: ["no MCP servers configured"] };
  const lines = config.servers.map((server) => {
    const args = (server.args ?? []).length > 0 ? ` ${(server.args ?? []).join(" ")}` : "";
    return `- ${server.name}  ${server.command}${args}`;
  });
  return { title: "MCP servers", lines };
}

/**
 * Run a slash command. App-level commands (/exit, /new, /thinking, ...) are
 * handled by the App component and filtered out before we get here.
 */
export async function runSlashCommand(input: string, state: AppState): Promise<SlashResult> {
  const [head, ...rest] = input.trim().split(/\s+/);
  switch (head) {
    case "/help":
    case "--help":
    case "-h":
      return helpResult();
    case "/agents":
      return runAgents(state);
    case "/models":
      return runModels(state, rest);
    case "/config":
      return runConfig(state, rest);
    case "/sessions":
      return runSessions(state, rest);
    case "/auth":
      return runAuth(state);
    case "/connect":
    case "--connect":
      return runConnect(state, rest);
    case "/skill":
    case "--skill":
      return runSkill(rest);
    case "/mcp":
      return runMcp(state);
    default:
      return {
        title: "Unknown command",
        lines: [`'${head}' is not a command (run /help to list them)`],
      };
  }
}