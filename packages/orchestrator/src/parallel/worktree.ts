import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Worktree-managed task isolation. Every task runs in its own git worktree
 * created from a shared base revision, so concurrent agents can edit files
 * without stepping on each other. Requires the workspace to be a git repo.
 */

export interface WorktreeInfo {
  /** Task identifier the worktree was created for. */
  id: string;
  /** Absolute path of the worktree root (scope for that task's tools). */
  path: string;
}

export interface WorktreeManagerOptions {
  /** Repository root (the main working tree). */
  repoRoot: string;
  /** Revision all worktrees are created from. Defaults to HEAD. */
  baseRef?: string;
  /** Directory (relative to repoRoot) that holds linked worktrees. */
  worktreesDir?: string;
}

export class WorktreeManager {
  readonly #repoRoot: string;
  readonly #baseRef: string;
  readonly #worktreesDir: string;
  readonly #active = new Map<string, string>();

  constructor(options: WorktreeManagerOptions) {
    this.#repoRoot = options.repoRoot;
    this.#baseRef = options.baseRef ?? "HEAD";
    this.#worktreesDir = options.worktreesDir ?? ".almost/worktrees";
  }

  get repoRoot(): string {
    return this.#repoRoot;
  }

  get active(): ReadonlyMap<string, string> {
    return new Map(this.#active);
  }

  async init(): Promise<void> {
    await this.#git(this.#repoRoot, ["rev-parse", "--verify", this.#baseRef]);
  }

  async acquire(id: string): Promise<WorktreeInfo> {
    if (this.#active.has(id)) {
      return { id, path: this.#active.get(id) as string };
    }
    await this.init();
    const worktreePath = path.join(this.#repoRoot, this.#worktreesDir, id);
    await this.#git(this.#repoRoot, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      this.#baseRef,
    ]);
    this.#active.set(id, worktreePath);
    return { id, path: worktreePath };
  }

  async release(id: string): Promise<void> {
    const worktreePath = this.#active.get(id);
    if (worktreePath === undefined) return;
    await this.#git(this.#repoRoot, ["worktree", "remove", "--force", worktreePath]);
    this.#active.delete(id);
  }

  async releaseAll(): Promise<void> {
    const failures: string[] = [];
    for (const id of [...this.#active.keys()]) {
      try {
        await this.release(id);
      } catch (error) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`failed to release worktrees: ${failures.join("; ")}`);
    }
  }

  /** Files changed in a task's worktree relative to the base revision. */
  async changedFiles(id: string): Promise<string[]> {
    const worktreePath = this.#active.get(id);
    if (worktreePath === undefined) throw new Error(`no active worktree for ${id}`);
    const { stdout } = await this.#git(this.#repoRoot, [
      "-C",
      worktreePath,
      "diff",
      "--name-only",
      "-z",
      this.#baseRef,
    ]);
    return stdout ? stdout.split("\0").filter(Boolean) : [];
  }

  async #git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await exec("git", args, { cwd });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git worktree operation failed: ${message}`);
    }
  }
}