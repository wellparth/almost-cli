import type { ToolResult } from "./provider.js";

/**
 * Permission strings represent every capability a tool or agent can request.
 * See project plan section 11.
 */
export type Permission =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.delete"
  | "shell.execute"
  | "git.read"
  | "git.write"
  | "network"
  | "mcp"
  | "spawn_agents";

export interface PermissionSet {
  filesystem: { read: boolean; write: boolean; delete?: boolean };
  shell: { execute: boolean };
  git: { read: boolean; write: boolean };
  network?: boolean;
  mcp?: boolean;
  spawnAgents?: boolean;
}

export type PermissionDecision =
  | { verdict: "allowed" }
  | { verdict: "denied"; reason: string }
  | { verdict: "requires_approval" };

export interface PermissionChecker {
  check(permission: Permission, detail?: string): Promise<PermissionDecision>;
}

export interface ToolContext {
  workspaceRoot: string;
  cwd: string;
  permissions: PermissionChecker;
  env: Record<string, string>;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: Permission[];
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export function toToolDefinition(tool: AgentTool) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}