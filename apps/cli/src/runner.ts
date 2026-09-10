import { createBuiltinRegistry } from "@almost/providers";
import { AgentRegistry } from "@almost/agents";
import type { AgentDefinition } from "@almost/agents";
import { PolicyPermissionChecker } from "@almost/permissions";
import type { Permission, PermissionSet } from "@almost/agent-core";
import { ToolExecutor } from "@almost/agent-runtime";
import type { AppState } from "@almost/storage";
import type { ModelProvider } from "@almost/agent-core";
import { McpManager, loadMcpConfig } from "@almost/mcp";
import path from "node:path";
import { askApproval } from "./approvals.js";

export interface Runner {
  provider: ModelProvider;
  model: string;
  agent: AgentDefinition;
  executor: ToolExecutor;
  /** Connected MCP servers (call closeAll() when the run finishes). */
  mcp?: McpManager;
}

const REQUIRES_APPROVAL: Permission[] = ["shell.execute", "git.write", "filesystem.delete", "mcp"];

export interface RunnerOptions {
  state: AppState;
  providerId?: string;
  model?: string;
  agentId?: string;
}

/** Inject stored credentials into the environment before provider factories run. */
export function injectCredentials(state: AppState): void {
  for (const name of state.credentials.keys()) {
    if (process.env[name] === undefined) {
      const value = state.credentials.get(name);
      if (value !== undefined) process.env[name] = value;
    }
  }
}

export function resolveProvider(state: AppState, providerId?: string): ModelProvider {
  const registry = createBuiltinRegistry();
  const id = providerId ?? state.config.get("defaultProvider");
  if (!id) throw new Error("no default provider configured; run: myagent config set default-provider <id>");
  if (!registry.has(id)) {
    throw new Error(`unknown provider '${id}' (available: ${registry.ids().join(", ")})`);
  }
  return registry.get(id);
}

export async function listModelsFor(state: AppState, providerId?: string): Promise<string[]> {
  const provider = resolveProvider(state, providerId);
  const models = await provider.listModels().catch(() => []);
  return models.map((m) => m.id);
}

/** Resolve a built-in or user-defined agent, defaulting to config's `agent`. */
export async function resolveAgent(state: AppState, agentId?: string): Promise<AgentDefinition> {
  const registry = new AgentRegistry({ agentsDir: path.join(state.paths.root, "agents") });
  const id = agentId ?? state.config.get("agent") ?? "coding";
  return registry.get(id);
}

export async function resolveModel(
  state: AppState,
  requestedModel?: string,
): Promise<string> {
  const hint = (await resolveAgent(state)).defaultModelHint ?? "gpt-4o";
  return requestedModel ?? state.config.get("defaultModel") ?? hint;
}

export async function buildRunner(options: RunnerOptions): Promise<Runner> {
  const { state, providerId, model: requestedModel, agentId } = options;
  injectCredentials(state);
  migrateLegacyCredentials(state);
  const provider = resolveProvider(state, providerId);
  const agent = await resolveAgent(state, agentId);

  // Resolve the model synchronously is not possible (listModels is async), so
  // the CLI resolves the model before calling buildRunner; requestedModel is
  // authoritative here.
  const model = requestedModel ?? state.config.get("defaultModel") ?? agent.defaultModelHint ?? "gpt-4o";

  const set: PermissionSet = { ...agent.permissionDefaults };
  const checker = new PolicyPermissionChecker({
    set,
    requiresApproval: REQUIRES_APPROVAL,
    onApprovalRequested: async (permission, detail) => askApproval(permission, detail),
  });

  const config = await loadMcpConfig(state.paths.root);
  const mcp = new McpManager(config, {
    onLog: (server, line) => process.stderr.write(`[mcp:${server}] ${line}\n`),
  });
  if (mcp.hasServers) {
    await mcp.connectAll();
  }

  const executor = new ToolExecutor({
    tools: [...agent.tools, ...mcp.agentTools],
    context: {
      workspaceRoot: process.cwd(),
      cwd: process.cwd(),
      permissions: checker,
      env: process.env as Record<string, string>,
    },
  });

  return { provider, model, agent, executor, mcp: mcp.hasServers ? mcp : undefined };
}

const AUTH_ENV_NAMES: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
};

/** Historical env-var names migrated to their canonical counterparts. */
const LEGACY_CREDENTIAL_ALIASES: Record<string, string> = {
  NVIDIA_NIM_API_KEY: "NVIDIA_API_KEY",
};

export function migrateLegacyCredentials(state: AppState): void {
  for (const [from, to] of Object.entries(LEGACY_CREDENTIAL_ALIASES)) {
    const value = state.credentials.get(from);
    if (value !== undefined && state.credentials.get(to) === undefined) {
      state.credentials.set(to, value);
      void state.credentials.save();
    }
  }
}

export function providerAuthEnvNames(providerId: string): string[] {
  return AUTH_ENV_NAMES[providerId] ?? [];
}

export function providerRequiresAuth(state: AppState, providerId: string): boolean {
  const names = providerAuthEnvNames(providerId);
  return names.some((n) => state.credentials.resolve(n) === undefined);
}