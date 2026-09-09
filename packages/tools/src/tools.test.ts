import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyPermissionChecker } from "@almost/permissions";
import type { ToolContext } from "@almost/agent-core";
import { isDangerousCommand, shellTool } from "./shell.js";
import {
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
} from "./filesystem.js";
import { grepTool, searchFilesTool } from "./search.js";
import { gitDiffTool, gitStatusTool } from "./git.js";
import { execFile } from "node:child_process";

let dir: string;
const permitAll = new PolicyPermissionChecker({
  set: {
    filesystem: { read: true, write: true, delete: true },
    shell: { execute: true },
    git: { read: true, write: true },
  },
});

function ctx(cwd: string): ToolContext {
  return { workspaceRoot: cwd, cwd, permissions: permitAll, env: {} };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "almost-tools-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("filesystem tools", () => {
  it("writes, reads, edits, lists, and deletes", async () => {
    const c = ctx(dir);
    await expect(
      (await writeFileTool.execute({ path: "a.txt", content: "hello world" }, c)).ok,
    ).toBe(true);
    const read = await readFileTool.execute({ path: "a.txt" }, c);
    expect(read).toMatchObject({ ok: true, output: "hello world" });

    const edited = await editFileTool.execute(
      { path: "a.txt", oldString: "hello", newString: "goodbye" },
      c,
    );
    expect(edited.ok).toBe(true);

    const listed = await listDirectoryTool.execute({}, c);
    expect(listed.ok && /a\.txt/.test(listed.output)).toBe(true);

    const del = await deleteFileTool.execute({ path: "a.txt" }, c);
    expect(del.ok).toBe(true);
  });

  it("edit_file does not succeed when oldString is missing", async () => {
    await writeFileTool.execute({ path: "a.txt", content: "abc abc" }, ctx(dir));
    const result = await editFileTool.execute(
      { path: "a.txt", oldString: "zzz", newString: "x" },
      ctx(dir),
    );
    expect(result.ok).toBe(false);
  });

  it("blocks paths that escape the workspace", async () => {
    const c = ctx(dir);
    const read = await readFileTool.execute({ path: "../outside.txt" }, c);
    expect(read.ok).toBe(false);
    const write = await writeFileTool.execute({ path: "/tmp/almost-escape.txt", content: "x" }, c);
    expect(write.ok).toBe(false);
    const del = await deleteFileTool.execute({ path: "/tmp/whatever" }, c);
    expect(del.ok).toBe(false);
  });
});

describe("search tools", () => {
  it("finds files and matches line content", async () => {
    await writeFileTool.execute({ path: "src/index.ts", content: "const answer = 42;" }, ctx(dir));
    await writeFileTool.execute({ path: "src/lib.ts", content: "not relevant" }, ctx(dir));

    const found = await searchFilesTool.execute({ pattern: "index\\.ts$" }, ctx(dir));
    expect(found.ok && /src\/index\.ts/.test(found.output)).toBe(true);

    const lines = await grepTool.execute({ pattern: "answer" }, ctx(dir));
    expect(lines.ok && /index\.ts:1:const answer = 42/.test(lines.output)).toBe(true);
  });
});

describe("shell tool", () => {
  it("runs commands and streams stdout", async () => {
    const result = await shellTool.execute({ command: "echo hello" }, ctx(dir));
    expect(result).toMatchObject({ ok: true, output: expect.stringContaining("hello") });
  });

  it("rejects destructive commands", () => {
    expect(isDangerousCommand("rm -rf /tmp/x")).toBe(true);
    expect(isDangerousCommand("git push origin main")).toBe(true);
    expect(isDangerousCommand("cat package.json")).toBe(false);
  });
});

describe("git tools", () => {
  it("reports status and diff in a git repo", async () => {
    await execFile("git", ["init", "-q", dir]);
    await execFile("git", ["config", "user.email", "t@t.test"], { cwd: dir });
    await execFile("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFileTool.execute({ path: "file.txt", content: "one" }, ctx(dir));
    await execFile("git", ["add", "file.txt"], { cwd: dir });
    await execFile("git", ["commit", "-qm", "initial"], { cwd: dir });
    await writeFileTool.execute({ path: "file.txt", content: "two" }, ctx(dir));

    const status = await gitStatusTool.execute({}, ctx(dir));
    expect(status.ok && /file.txt/.test(status.output)).toBe(true);
    const diff = await gitDiffTool.execute({}, ctx(dir));
    expect(diff.ok && /\+two/.test(diff.output)).toBe(true);
  });
});