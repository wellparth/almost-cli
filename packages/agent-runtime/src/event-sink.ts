import type { AgentEvent, EventSink } from "@almost/agent-core";
import type { SessionStore } from "@almost/agent-core";

/**
 * Event sink that mirrors events into a session's events.jsonl via the
 * session store, then forwards to `next` for live display.
 */
export function sessionEventSink(
  store: SessionStore,
  sessionId: string,
  next?: EventSink,
): EventSink {
  return async (event: AgentEvent) => {
    const stamped = { ...event, sessionId } as AgentEvent;
    try {
      await store.appendEvent(sessionId, stamped);
    } catch {
      // event logging is best-effort; never fail the agent run on it
    }
    await next?.(stamped);
  };
}