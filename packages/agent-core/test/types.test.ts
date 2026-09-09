import { describe, expect, it } from "vitest";
import type { AgentTask, Message, ModelEvent, Permission } from "../src/index.js";

describe("core types", () => {
  it("AgentTask covers the statuses from the plan", () => {
    const statuses = new Set<AgentTask["status"]>([
      "pending",
      "queued",
      "running",
      "waiting_for_approval",
      "completed",
      "failed",
      "cancelled",
      "blocked",
    ]);
    const task: AgentTask = {
      id: "t1",
      agentId: "builder",
      input: { change: "x" },
      dependencies: [],
      status: "running",
      createdAt: 1,
      updatedAt: 2,
    };
    expect(statuses.has(task.status)).toBe(true);
  });

  it("Message covers system/user/assistant/tool roles", () => {
    const messages: Message[] = [
      { role: "system", content: "policy" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [{ id: "c1", name: "read_file", input: {} }] },
      { role: "tool", toolCallId: "c1", content: "result" },
    ];
    expect(messages).toHaveLength(4);
  });

  it("ModelEvent is a discriminated union", () => {
    const event: ModelEvent = { type: "TEXT_DELTA", content: "hi" };
    expect(event.type).toBe("TEXT_DELTA");
  });

  it("Permission strings match the plan", () => {
    const permissions: Permission[] = [
      "filesystem.read",
      "filesystem.write",
      "filesystem.delete",
      "shell.execute",
      "git.read",
      "git.write",
      "network",
      "mcp",
      "spawn_agents",
    ];
    expect(permissions).toContain("filesystem.delete");
  });
});