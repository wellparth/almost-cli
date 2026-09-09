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

  constructor(options: OrchestratorOptions) {
    this.#provider = options.provider;
    this.#agent = options.agent;
    this.#executor = options.executor;
    this.#concurrency = options.concurrency ?? 1;
    this.#bus = options.bus ?? new EventBus();
    this.#onEvent = options.onEvent;
  }

  get bus(): EventBus {
    return this.#bus;
  }

  async run(graph: TaskGraph): Promise<OrchestratorRunResult> {
    const runTask = async (task: TaskSpec): Promise<TaskOutcome> => {
      await this.#bus.emit({
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
        await this.#bus.emit({ ...event, sessionId: "" });
        await this.#onEvent?.(event);
      };

      try {
        const result = await runAgentLoop({
          provider: this.#provider,
          model: task.options?.model ?? this.#agent.defaultModelHint ?? this.#defaultModel(),
          agentId: task.agentId,
          executor: this.#executor,
          system: this.#agent.systemPrompt,
          input: task.input,
          onEvent: sink,
        });
        if (result.status === "failed") {
          await this.#bus.emit({
            type: "TaskFailed",
            sessionId: "",
            taskId: task.id,
            error: result.error ?? "agent failed",
            timestamp: Date.now(),
          });
          return { id: task.id, status: "failed", error: result.error ?? "agent failed" };
        }
        await this.#bus.emit({
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
        await this.#bus.emit({
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

  #defaultModel(): string {
    return this.#agent.defaultModelHint ?? "gpt-4o";
  }
}

export * from "./task-graph.js";
export * from "./scheduler.js";
export * from "./event-bus.js";