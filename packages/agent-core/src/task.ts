export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface AgentTask {
  id: string;
  agentId: string;
  input: unknown;
  dependencies: string[];
  status: TaskStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentMessageType =
  | "TASK_REQUEST"
  | "TASK_RESULT"
  | "QUESTION"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "TEST_FAILURE"
  | "IMPLEMENTATION_COMPLETE"
  | "REVIEW_REQUEST";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: AgentMessageType;
  payload: unknown;
  timestamp: number;
}