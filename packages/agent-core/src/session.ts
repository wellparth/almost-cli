export interface SessionMetadata {
  id: string;
  modelProvider?: string;
  model?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  metadata: SessionMetadata;
  messages: import("./task.js").AgentMessage[];
  events: import("./event.js").AgentEvent[];
}

export interface SessionStore {
  create(metadata: Omit<SessionMetadata, "id" | "createdAt" | "updatedAt">): Promise<Session>;
  load(id: string): Promise<Session | undefined>;
  list(): Promise<SessionMetadata[]>;
  appendMessage(sessionId: string, message: import("./task.js").AgentMessage): Promise<void>;
  appendEvent(sessionId: string, event: import("./event.js").AgentEvent): Promise<void>;
  touch(sessionId: string): Promise<void>;
}