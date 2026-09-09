import { execFile as exec } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, ModelProvider } from "@almost/agent-core";
import type { ToolExecutor } from "@almost/agent-runtime";
import type { AgentDefinition } from "@almost/agents";
import { Orchestrator } from "../orchestrator.js";
import { WorktreeManager } from "./worktree.js";
import { TaskGraph } from "../task-graph.js";

const run = promisify(exec);

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
  const base = {} as unknown as ToolExecutor;
  return { ...base, scoped: () => base } as unknown as ToolExecutor;
}

const tmpDirs: string[] = [];

async function repo(): Promise<{ repoRoot: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "almost-wt-"));
  tmpDirs.push(repoRoot);
  await run("git", ["-C", repoRoot, "init", "-q"]);
  await run("git", ["-C", repoRoot, "config", "user.email", "t@example.com"]);
  await run("git", ["-C", repoRoot, "config", "user.name", "t"]);
  await fs.writeFile(path.join(repoRoot, "file.txt"), "base\n");
  await run("git", ["-C", repoRoot, "add", "."]);
  await run("git", ["-C", repoRoot, "commit", "-qm", "base"]);
  return { repoRoot };
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("parallel agent composition", () => {
  it("runs tasks in isolated worktrees and cleans them up", async () => {
    const { repoRoot } = await repo();
    const manager = new WorktreeManager({ repoRoot });
    const seen: string[] = [];
    const orchestrator = new Orchestrator({
      provider: fakeProvider,
      agent,
      executor: fakeExecutor(),
      concurrency: 3,
      bus: undefined,
      onEvent: (e: AgentEvent) => {
        void e;
      },
      workspaceFor: async (task) => {
        const wt = await manager.acquire(task.id);
        seen.push(wt.path);
        return wt.path;
      },
    });
    const graph = new TaskGraph()
      .addTask({ id: "task-1", agentId: "coding", input: "a", dependencies: [] })
      .addTask({ id: "task-2", agentId: "coding", input: "b", dependencies: [] })
      .addTask({ id: "task-3", agentId: "coding", input: "c", dependencies: ["task-1"] });

    const { outcomes, ranTasks } = await orchestrator.run(graph);
    expect(ranTasks).toBe(3);
    expect(outcomes.get("task-1")?.status).toBe("completed");
    expect(manager.active.size).toBe(3);

    await manager.releaseAll();
    expect(manager.active.size).toBe(0);
    for (const p of seen) {
      await expect(fs.access(p)).rejects.toThrow();
    }
    expect(seen).toHaveLength(3);
  });
});