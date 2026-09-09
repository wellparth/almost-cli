import { execFile as exec } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreeManager } from "./worktree.js";

const run = promisify(exec);
const tmpDirs: string[] = [];

async function repo(): Promise<{ repoRoot: string; cleanUp: () => Promise<void> }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "almost-wt-"));
  tmpDirs.push(repoRoot);
  await run("git", ["-C", repoRoot, "init", "-q"]);
  await run("git", ["-C", repoRoot, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repoRoot, "config", "user.name", "test"]);
  await fs.writeFile(path.join(repoRoot, "file.txt"), "base\n");
  await run("git", ["-C", repoRoot, "add", "."]);
  await run("git", ["-C", repoRoot, "commit", "-qm", "base"]);
  const cleanUp = async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  };
  return { repoRoot, cleanUp };
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorktreeManager", () => {
  it("creates an isolated worktree from the base revision", async () => {
    const { repoRoot, cleanUp } = await repo();
    try {
      const manager = new WorktreeManager({ repoRoot });
      await manager.init();
      const wt = await manager.acquire("task-1");
      expect(wt.path).toContain("task-1");
      expect(manager.active.has("task-1")).toBe(true);

      const checkFile = path.join(wt.path, "file.txt");
      expect(await fs.readFile(checkFile, "utf8")).toBe("base\n");

      await fs.appendFile(checkFile, "task-1 change\n");
      const mainFile = path.join(repoRoot, "file.txt");
      expect(await fs.readFile(mainFile, "utf8")).toBe("base\n");

      const changed = await manager.changedFiles("task-1");
      expect(changed).toEqual(["file.txt"]);

      await manager.release("task-1");
      expect(manager.active.has("task-1")).toBe(false);
      await expect(fs.access(checkFile)).rejects.toThrow();
    } finally {
      await cleanUp();
    }
  });

  it("acquire is idempotent for the same task id", async () => {
    const { repoRoot, cleanUp } = await repo();
    try {
      const manager = new WorktreeManager({ repoRoot });
      const first = await manager.acquire("task-1");
      const second = await manager.acquire("task-1");
      expect(second.path).toBe(first.path);
      await manager.releaseAll();
      expect(manager.active.size).toBe(0);
    } finally {
      await cleanUp();
    }
  });

  it("reports newly added (untracked) files as changes", async () => {
    const { repoRoot, cleanUp } = await repo();
    try {
      const manager = new WorktreeManager({ repoRoot });
      const wt = await manager.acquire("task-1");
      await fs.writeFile(path.join(wt.path, "brand-new.ts"), "export const x = 1;\n");
      const changed = await manager.changedFiles("task-1");
      expect(changed).toContain("brand-new.ts");
      await manager.releaseAll();
    } finally {
      await cleanUp();
    }
  });

  it("rejects task ids that escape the worktrees directory", async () => {
    const { repoRoot, cleanUp } = await repo();
    try {
      const manager = new WorktreeManager({ repoRoot });
      for (const bad of ["..", ".", "a/b", "a\\b"]) {
        await expect(manager.acquire(bad)).rejects.toThrow(/invalid worktree task id/);
      }
    } finally {
      await cleanUp();
    }
  });

  it("throws for a non-git directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almost-nowt-"));
    tmpDirs.push(dir);
    const manager = new WorktreeManager({ repoRoot: dir });
    await expect(manager.acquire("task-1")).rejects.toThrow(/worktree operation failed/);
  });
});