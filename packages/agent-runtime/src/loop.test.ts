import { describe, expect, it, vi } from "vitest";
import type {
  AgentTool,
  ModelProvider,
  PermissionChecker,
  ToolContext,
  ToolResult,
} from "@almost/agent-core";
import { runAgentLoop } from "./loop.js";
import { ToolExecutor } from "./tool-executor.js";
import { sessionEventSink } from "./event-sink.js";
import type { SessionStore } from "@almost/agent-core";

function makeTool(name: string, result: ToolResult, permissions: AgentTool["permissions"]): AgentTool {
  return {
    name,
    description: name,
    inputSchema: {},
    permissions,
    async execute(): Promise<ToolResult> {
      return result;
    },
  };
}

const ALLOW: PermissionChecker = { async check() { return { verdict: "allowed" }; } };
const DENY: PermissionChecker = { async check() { return { verdict: "denied", reason: "nope" }; } };

function context(): ToolContext {
  return {
    workspaceRoot: "/tmp",
    cwd: "/tmp",
    permissions: ALLOW,
    env: {},
  };
}

/** Fake provider that emits text, then optionally a tool call. */
function fakeProvider(
  emits: Array<Array<import("@almost/agent-core").ModelEvent>>,
): ModelProvider {
  let i = 0;
  return {
    id: "fake",
    supports: () => true,
    async listModels() {
      return [];
    },
    async *generate() {
      const events = emits[Math.min(i, emits.length - 1)] ?? [];
      i++;
      for (const event of events) yield event;
    },
  };
}

describe("runAgentLoop", () => {
  it("returns the final text for a plain answer", async () => {
    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider = fakeProvider([[{ type: "TEXT_DELTA", content: "hello" }, { type: "FINISH", stopReason: "stop" }]]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "hi",
    });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello");
    expect(result.iterations).toBe(1);
  });

  it("executes tool calls in a follow-up iteration", async () => {
    const executor = new ToolExecutor({
      tools: [makeTool("read_file", { ok: true, output: "file contents" }, ["filesystem.read"])],
      context: context(),
    });
    const provider = fakeProvider([
      [
        { type: "TEXT_DELTA", content: "reading… " },
        {
          type: "TOOL_CALL",
          id: "t1",
          name: "read_file",
          input: { path: "a.txt" },
        },
        { type: "FINISH", stopReason: "tool_calls" },
      ],
      [{ type: "TEXT_DELTA", content: "done" }, { type: "FINISH", stopReason: "stop" }],
    ]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "read a.txt",
    });
    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("reports denial when permission is denied", async () => {
    const executor = new ToolExecutor({
      tools: [makeTool("write_file", { ok: true, output: "wrote" }, ["filesystem.write"])],
      context: { ...context(), permissions: DENY },
    });
    const provider = fakeProvider([
      [
        { type: "TOOL_CALL", id: "t1", name: "write_file", input: { path: "x" } },
        { type: "FINISH", stopReason: "tool_calls" },
      ],
      [{ type: "TEXT_DELTA", content: "blocked" }, { type: "FINISH", stopReason: "stop" }],
    ]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "write x",
    });
    expect(result.status).toBe("completed");
    const toolMessages = result.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0]?.content)).toContain("nope");
  });

  it("fails closed on unknown tools", async () => {
    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider = fakeProvider([
      [
        { type: "TOOL_CALL", id: "t1", name: "mystery", input: {} },
        { type: "FINISH", stopReason: "tool_calls" },
      ],
      [{ type: "TEXT_DELTA", content: "ok" }, { type: "FINISH", stopReason: "stop" }],
    ]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "run it",
    });
    expect(result.status).toBe("completed");
    const toolMessages = result.messages.filter((m) => m.role === "tool");
    expect(String(toolMessages[0]?.content)).toContain("unknown tool");
  });

  it("handles streamed provider errors as failure", async () => {
    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider: ModelProvider = {
      id: "boom",
      supports: () => true,
      async listModels() {
        return [];
      },
      async *generate() {
        throw new Error("stream exploded");
      },
    };
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "hi",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("stream exploded");
  });

  it("does not loop forever when tool_calls stop has no calls", async () => {
    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider = fakeProvider([[{ type: "FINISH", stopReason: "tool_calls" }]]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "hi",
      maxIterations: 10,
    });
    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(1);
  });

  it("surfaces provider errors as failure", async () => {
    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider = fakeProvider([[{ type: "ERROR", message: "boom" }]]);
    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "hi",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("boom");
  });

  it("emits events and mirrors them into a session store", async () => {
    type Sink = { store: SessionStore; collected: unknown[] };
    const collected: unknown[] = [];
    const fakeStore: SessionStore = {
      async create() {
        throw new Error("unused");
      },
      async load() {
        return undefined;
      },
      async list() {
        return [];
      },
      appendMessage: vi.fn(async () => undefined),
      appendEvent: vi.fn(async () => undefined),
      touch: vi.fn(async () => undefined),
    };

    const executor = new ToolExecutor({ tools: [], context: context() });
    const provider = fakeProvider([[{ type: "TEXT_DELTA", content: "ok" }, { type: "FINISH", stopReason: "stop" }]]);
    const sink = sessionEventSink(fakeStore, "sess1", (e) => {
      collected.push(e);
    });

    const result = await runAgentLoop({
      provider,
      model: "test",
      agentId: "a",
      executor,
      input: "hi",
      onEvent: sink,
    });

    expect(result.status).toBe("completed");
    expect(collected.some((e) => (e as { type: string }).type === "AgentCompleted")).toBe(true);
    const appendEvents = vi.mocked(fakeStore.appendEvent).mock.calls;
    expect(appendEvents.length).toBeGreaterThan(0);
    expect(appendEvents[0]?.[1].sessionId).toBe("sess1");
  });
});