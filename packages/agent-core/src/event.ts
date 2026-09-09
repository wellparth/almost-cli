import type { AgentTask } from "./task.js";

export type AgentEvent =
  | { type: "SessionStarted"; sessionId: string; timestamp: number }
  | { type: "AgentStarted"; sessionId: string; agentId: string; timestamp: number }
  | { type: "AgentThinking"; sessionId: string; agentId: string; timestamp: number }
  | { type: "ToolRequested"; sessionId: string; agentId: string; tool: string; input: unknown; timestamp: number }
  | { type: "ToolExecuted"; sessionId: string; agentId: string; tool: string; ok: boolean; timestamp: number }
  | { type: "PermissionRequested"; sessionId: string; agentId: string; permission: string; timestamp: number }
  | { type: "AgentCompleted"; sessionId: string; agentId: string; timestamp: number }
  | { type: "AgentFailed"; sessionId: string; agentId: string; error: string; timestamp: number }
  | { type: "TaskQueued"; sessionId: string; task: AgentTask; timestamp: number }
  | { type: "TaskCompleted"; sessionId: string; taskId: string; timestamp: number }
  | { type: "TaskFailed"; sessionId: string; taskId: string; error: string; timestamp: number };

export type EventSink = (event: AgentEvent) => void | Promise<void>;