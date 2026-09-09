import type { PermissionSet } from "./tool.js";

export interface AgentModelConfig {
  provider: string;
  model?: string;
}

export type AgentRole =
  | "architect"
  | "planner"
  | "builder"
  | "tester"
  | "debugger"
  | "reviewer"
  | "custom";

export interface AgentCapabilities {
  planning: boolean;
  coding: boolean;
  testing: boolean;
  debugging: boolean;
}

/**
 * Declarative agent definition. Agents serialize into project files such as
 * `.myagent/agents/*.yaml` and are loaded by the agent-definitions package.
 * See project plan sections 3.5 and 5.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  role: AgentRole;
  system?: string;
  permissions: PermissionSet;
  tools: string[];
  behavior: AgentCapabilities;
  model?: AgentModelConfig;
  temperature?: number;
  maxIterations?: number;
  tokenBudget?: number;
  allowedSubagents?: string[];
  inputFormat?: string;
  outputFormat?: string;
}

export interface AgentRunRequest {
  task: unknown;
  definition: AgentDefinition;
  context: import("./tool.js").ToolContext;
}

export interface AgentRunResult {
  status: "completed" | "failed" | "waiting_for_approval" | "cancelled";
  output?: unknown;
  error?: string;
  iterations: number;
}