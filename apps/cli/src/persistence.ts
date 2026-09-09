import type { EventSink } from "@almost/agent-core";
import type { AgentMessage } from "@almost/agent-core";
import { DiskSessionStore } from "@almost/storage";
import { sessionEventSink } from "@almost/agent-runtime";

/** Minimal selector so the store types narrow without extra generics. */
export interface SessionPersistence {
  store: DiskSessionStore;
  sessionId: string;
  sink: EventSink;
}

export async function openPersistence(
  sessionsDir: string,
  agentId: string,
): Promise<SessionPersistence> {
  const store = new DiskSessionStore(sessionsDir);
  const session = await store.create({ cwd: process.cwd() });
  return {
    store,
    sessionId: session.metadata.id,
    sink: sessionEventSink(store, session.metadata.id),
  };
}

export function toAgentMessage(
  from: "user" | "agent",
  agentId: string,
  text: string,
  type: "QUESTION" | "IMPLEMENTATION_COMPLETE" | "BLOCKED" = "QUESTION",
): AgentMessage {
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    from: from === "user" ? "user" : agentId,
    to: from === "user" ? agentId : "user",
    type,
    payload: { text },
    timestamp: Date.now(),
  };
}