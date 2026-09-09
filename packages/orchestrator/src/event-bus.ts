import type { AgentEvent } from "@almost/agent-core";

/** Minimal in-process event bus with fan-out to sinks. */
export class EventBus {
  readonly #sinks = new Set<(event: AgentEvent) => void | Promise<void>>();

  subscribe(sink: (event: AgentEvent) => void | Promise<void>): () => void {
    this.#sinks.add(sink);
    return () => this.#sinks.delete(sink);
  }

  async emit(event: AgentEvent): Promise<void> {
    let firstError: unknown;
    for (const sink of this.#sinks) {
      try {
        await sink(event);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}