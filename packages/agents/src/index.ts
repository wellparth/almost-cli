import type { PermissionSet } from "@almost/agent-core";
import { BUILTIN_TOOLS } from "@almost/tools";
import type { AgentTool } from "@almost/agent-core";

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  tools: AgentTool[];
  permissionDefaults: PermissionSet;
  defaultModelHint?: string;
}

const CODING_SYSTEM_PROMPT = `You are an expert software engineering agent working in a local codebase.
You complete coding tasks by reading code, searching for symbols, editing files, and running commands.

Rules:
- Work inside the workspace directory. Never touch files outside it.
- Prefer read_file / grep / search_files before editing. Read the relevant code first.
- Run tests and typechecks after changes: pnpm typecheck, pnpm test, pnpm --filter <pkg> test.
- Keep changes minimal and idiomatic. Match the existing code style.
- Run git_status / git_diff before deciding what to change and git_diff after editing to verify.
- Do not run git push, git commit --amend, rm -rf, or destructive shell commands.
- If a tool returns an error, read it carefully, adjust, and retry. Do not repeat the same call.
- When the task is done, summarize what changed and how it was verified.

If something requires a permission that is not granted, say so and stop; do not try to bypass it.`;

export const CODING_AGENT: AgentDefinition = {
  id: "coding",
  name: "Coding agent",
  systemPrompt: CODING_SYSTEM_PROMPT,
  tools: BUILTIN_TOOLS,
  permissionDefaults: {
    filesystem: { read: true, write: true, delete: false },
    shell: { execute: false },
    git: { read: true, write: false },
    network: false,
    mcp: false,
    spawnAgents: false,
  },
  defaultModelHint: "gpt-4o",
};

export const BUILTIN_AGENTS: AgentDefinition[] = [CODING_AGENT];

export function getAgent(id: string): AgentDefinition {
  const agent = BUILTIN_AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`unknown agent '${id}' (available: ${BUILTIN_AGENTS.map((a) => a.id).join(", ")})`);
  return agent;
}

export * from "./registry.js";