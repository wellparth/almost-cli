import { runAgentLoop } from "@almost/agent-runtime";
import type { ToolExecutor } from "@almost/agent-runtime";
import type { EventSink, ModelProvider } from "@almost/agent-core";
import type { AgentDefinition } from "@almost/agents";
import { runGraph } from "./scheduler.js";
import { EventBus } from "./event-bus.js";
import type { TaskOutcome, TaskSpec } from "./task-graph.js";
import { TaskGraph } from "./task-graph.js";

export interface OrchestratorOptions {
  provider: ModelProvider;
  agent: AgentDefinition;
  executor: ToolExecutor;
  concurrency?: number;
  bus?: EventBus;
  onEvent?: EventSink;
  /** Per-task workspace root (e.g. task's git worktree). When set, the task
   * runs with a tool executor scoped to that root; otherwise tasks share the
   * executor's workspace. */
  workspaceFor?: (task: TaskSpec) => string | undefined | Promise<string | undefined>;
}

export interface OrchestratorRunResult {
  outcomes: Map<string, TaskOutcome>;
  ranTasks: number;
}

/**
 * Phase 5 orchestrator: executes a task graph by running one agent per task
 * through the single-agent loop. Results with a tool output are exposed on
 * the outcome; failures propagate as "failed" and cancel descendants.
 */
export class Orchestrator {
  readonly #provider: ModelProvider;
  readonly #agent: AgentDefinition;
  readonly #executor: ToolExecutor;
  readonly #concurrency: number;
  readonly #bus: EventBus;
  readonly #onEvent?: EventSink;
  readonly #workspaceFor?: (task: TaskSpec) => string | undefined | Promise<string | undefined>;

  constructor(options: OrchestratorOptions) {
    this.#provider = options.provider;
    this.#agent = options.agent;
    this.#executor = options.executor;
    this.#concurrency = options.concurrency ?? 1;
    this.#bus = options.bus ?? new EventBus();
    this.#onEvent = options.onEvent;
    this.#workspaceFor = options.workspaceFor;
  }

  get bus(): EventBus {
    return this.#bus;
  }

  async run(graph: TaskGraph): Promise<OrchestratorRunResult> {
    const runTask = async (task: TaskSpec): Promise<TaskOutcome> => {
      const workspace = await this.#workspaceFor?.(task);
      const executor = workspace === undefined ? this.#executor : this.#executor.scoped(workspace);
      try {
        if (task.options?.providerId && task.options.providerId !== this.#provider.id) {
          throw new Error(`provider ${task.options.providerId} is not available to this orchestrator`);
        }

        await this.#emit({
          type: "TaskQueued",
          sessionId: "",
          task: {
            id: task.id,
            agentId: task.agentId,
            input: task.input,
            dependencies: task.dependencies,
            status: "queued",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          timestamp: Date.now(),
        });

        const sink: EventSink = async (event) => {
          await this.#emit({ ...event, sessionId: "" });
          try {
            await this.#onEvent?.(event);
          } catch {
            // A misbehaving external sink must not mark the task as failed.
          }
        };

        const result = await runAgentLoop({
          provider: this.#provider,
          model: task.options?.model ?? this.#agent.defaultModelHint ?? "gpt-4o",
          agentId: task.agentId,
          executor,
          system: this.#agent.systemPrompt,
          input: task.input,
          onEvent: sink,
        });
        if (result.status === "failed") {
          const error = result.error ?? "agent failed";
          await this.#emit({
            type: "TaskFailed",
            sessionId: "",
            taskId: task.id,
            error,
            timestamp: Date.now(),
          });
          return { id: task.id, status: "failed", error };
        }
        await this.#emit({
          type: "TaskCompleted",
          sessionId: "",
          taskId: task.id,
          timestamp: Date.now(),
        });
        return {
          id: task.id,
          status: "completed",
          output: result.output,
          iterations: result.iterations,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.#emit({
          type: "TaskFailed",
          sessionId: "",
          taskId: task.id,
          error: message,
          timestamp: Date.now(),
        });
        return { id: task.id, status: "failed", error: message };
      }
    };

    const scheduled = await runGraph(graph, {
      runTask,
      concurrency: this.#concurrency,
    });
    return { outcomes: scheduled.outcomes, ranTasks: scheduled.ranTasks };
  }

  /**
   * Observers must never abort a run: a bus subscriber or onEvent sink that
   * throws is downgraded to a failed task outcome, not a run failure.
   */
  async #emit(event: Parameters<EventBus["emit"]>[0]): Promise<void> {
    try {
      await this.#bus.emit(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const payload = { sessionId: "", timestamp: Date.now(), error: message };
      await this.#onEvent?.({ type: "AgentFailed", agentId: "", ...payload });
    }
  }
}

export * from "./task-graph.js";
export * from "./scheduler.js";
export * from "./event-bus.js";