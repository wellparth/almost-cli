import { describe, expect, it } from "vitest";
import type { AgentEvent, ModelProvider } from "@almost/agent-core";
import type { ToolExecutor } from "@almost/agent-runtime";
import type { AgentDefinition } from "@almost/agents";
import { Orchestrator } from "./orchestrator.js";
import { EventBus } from "./event-bus.js";
import { TaskGraph } from "./task-graph.js";
import { runGraph } from "./scheduler.js";
import type { TaskOutcome } from "./task-graph.js";

const fakeProvider: ModelProvider = {
  id: "fake",
  supports: () => true,
  listModels: async () => [],
  async *generate() {
    yield { type: "TEXT_DELTA", content: "done" };
    yield { type: "FINISH", stopReason: "stop" };
  },
};

const agent: AgentDefinition = {
  id: "coding",
  name: "Coding",
  systemPrompt: "you code",
  tools: [],
  permissionDefaults: { filesystem: { read: true, write: false }, shell: { execute: false }, git: { read: false, write: false } },
};

function fakeExecutor(): ToolExecutor {
  return {} as unknown as ToolExecutor;
}

function collection(events: AgentEvent[]) {
  return (event: AgentEvent) => void events.push(event);
}

describe("TaskGraph", () => {
  it("orders tasks by dependency", () => {
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "coding", input: "a", dependencies: [] })
      .addTask({ id: "b", agentId: "coding", input: "b", dependencies: ["a"] })
      .addTask({ id: "c", agentId: "coding", input: "c", dependencies: ["b"] });
    expect(graph.validate().valid).toBe(true);
    expect(graph.readyTasks(new Set(), new Set()).map((t) => t.id)).toEqual(["a"]);
    expect(graph.readyTasks(new Set(["a"]), new Set()).map((t) => t.id)).toEqual(["b"]);
  });

  it("detects cycles", () => {
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "coding", input: "a", dependencies: ["b"] })
      .addTask({ id: "b", agentId: "coding", input: "b", dependencies: ["a"] });
    const { valid, errors } = graph.validate();
    expect(valid).toBe(false);
    expect(errors.join()).toContain("cycle");
  });

  it("detects missing dependencies", () => {
    const graph = new TaskGraph().addTask({ id: "a", agentId: "coding", input: "a", dependencies: ["ghost"] });
    expect(graph.validate().valid).toBe(false);
    expect(graph.validate().errors[0]).toContain("ghost");
  });
});

describe("runGraph", () => {
  it("runs tasks in dependency order sequentially", async () => {
    const order: string[] = [];
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "c", input: "a", dependencies: [] })
      .addTask({ id: "b", agentId: "c", input: "b", dependencies: ["a"] });
    const { outcomes } = await runGraph(graph, {
      concurrency: 1,
      runTask: async (t) => {
        order.push(t.id);
        return { id: t.id, status: "completed" };
      },
    });
    expect(order).toEqual(["a", "b"]);
    expect(outcomes.get("a")?.status).toBe("completed");
  });

  it("runs independent tasks concurrently within the limit", async () => {
    const running = new Set<string>();
    let maxActive = 0;
    let active = 0;
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "c", input: "a", dependencies: [] })
      .addTask({ id: "b", agentId: "c", input: "b", dependencies: [] })
      .addTask({ id: "c", agentId: "c", input: "c", dependencies: [] })
      .addTask({ id: "d", agentId: "c", input: "d", dependencies: [] });
    await runGraph(graph, {
      concurrency: 2,
      runTask: async (t) => {
        void running.add(t.id);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        running.delete(t.id);
        return { id: t.id, status: "completed" };
      },
    });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("cancels descendants of failed tasks", async () => {
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "c", input: "a", dependencies: [] })
      .addTask({ id: "b", agentId: "c", input: "b", dependencies: ["a"] })
      .addTask({ id: "c2", agentId: "c", input: "c", dependencies: ["a"] });
    const ran: string[] = [];
    const { outcomes } = await runGraph(graph, {
      runTask: async (t): Promise<TaskOutcome> => {
        ran.push(t.id);
        return t.id === "a" ? { id: t.id, status: "failed", error: "boom" } : { id: t.id, status: "completed" };
      },
    });
    expect(ran).toEqual(["a"]);
    expect(outcomes.get("b") ?? undefined).toBeUndefined();
  });

  it("rejects invalid graphs", async () => {
    const graph = new TaskGraph()
      .addTask({ id: "a", agentId: "c", input: "a", dependencies: ["missing"] });
    await expect(
      runGraph(graph, { runTask: async (t) => ({ id: t.id, status: "completed" }) }),
    ).rejects.toThrow(/invalid task graph/);
  });
});

describe("EventBus", () => {
  it("fans events out and unsubscribes", async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => void seen.push(e.type));
    await bus.emit({ type: "AgentThinking", sessionId: "", agentId: "a", timestamp: 1 });
    off();
    await bus.emit({ type: "AgentCompleted", sessionId: "", agentId: "a", timestamp: 2 });
    expect(seen).toEqual(["AgentThinking"]);
  });

  it("surfaces subscriber errors but keeps others running", async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error("sink boom");
    });
    bus.subscribe((e) => void seen.push(e.type));
    await expect(
      bus.emit({ type: "AgentStarted", sessionId: "", agentId: "a", timestamp: 1 }),
    ).rejects.toThrow("sink boom");
    expect(seen).toEqual(["AgentStarted"]);
  });
});

describe("Orchestrator", () => {
  it("completes tasks and emits TaskQueued / TaskCompleted", async () => {
    const loopEvents: AgentEvent[] = [];
    const busEvents: AgentEvent[] = [];
    const orchestrator = new Orchestrator({
      provider: fakeProvider,
      agent,
      executor: fakeExecutor(),
      bus: new EventBus(),
      onEvent: collection(loopEvents),
    });
    orchestrator.bus.subscribe((e) => void busEvents.push(e));
    const graph = new TaskGraph()
      .addTask({ id: "t1", agentId: "coding", input: "hi", dependencies: [] });

    const { outcomes, ranTasks } = await orchestrator.run(graph);
    expect(ranTasks).toBe(1);
    expect(outcomes.get("t1")?.status).toBe("completed");
    expect(busEvents.some((e) => e.type === "TaskQueued")).toBe(true);
    expect(busEvents.some((e) => e.type === "TaskCompleted")).toBe(true);
    expect(loopEvents.some((e) => e.type === "AgentCompleted")).toBe(true);
  });

  it("emits TaskFailed when the agent loop fails", async () => {
    const busEvents: AgentEvent[] = [];
    const failing: ModelProvider = {
      id: "fake",
      supports: () => true,
      listModels: async () => [],
      async *generate() {
        yield { type: "ERROR", message: "provider down" };
      },
    };
    const orchestrator = new Orchestrator({
      provider: failing,
      agent,
      executor: fakeExecutor(),
    });
    orchestrator.bus.subscribe((e) => void busEvents.push(e));
    const graph = new TaskGraph().addTask({ id: "t1", agentId: "coding", input: "hi", dependencies: [] });
    const { outcomes } = await orchestrator.run(graph);
    expect(outcomes.get("t1")?.status).toBe("failed");
    expect(outcomes.get("t1")?.error).toBe("provider down");
    expect(busEvents.some((e) => e.type === "TaskFailed")).toBe(true);
  });
});