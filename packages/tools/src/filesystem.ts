import { access, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { denied } from "./result.js";

async function hasAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(ctx: ToolContext, requested: string): string {
  const base = requested ? resolve(ctx.cwd, requested) : ctx.workspaceRoot;
  return base;
}

export const readFileTool: AgentTool = {
  name: "read_file",
  description: "Read the full contents of a file at the given path.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, relative to the workspace or absolute" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  permissions: ["filesystem.read"],
  async execute(input, ctx): Promise<ToolResult> {
    const { path } = input as { path: string };
    if (!path) return { ok: false, error: "missing 'path'" };
    const decision = await ctx.permissions.check("filesystem.read", path);
    if (decision.verdict !== "allowed") return denied(decision);
    const full = resolvePath(ctx, path);
    if (!(await hasAccess(full))) return { ok: false, error: `no such file: ${path}` };
    const content = await readFile(full, "utf8");
    return { ok: true, output: content };
  },
};

export const writeFileTool: AgentTool = {
  name: "write_file",
  description: "Create or overwrite a file with the given content.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  permissions: ["filesystem.write"],
  async execute(input, ctx): Promise<ToolResult> {
    const { path, content } = input as { path: string; content: string };
    if (!path || typeof content !== "string") return { ok: false, error: "missing 'path' or 'content'" };
    const decision = await ctx.permissions.check("filesystem.write", path);
    if (decision.verdict !== "allowed") return denied(decision);
    const full = resolvePath(ctx, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
    return { ok: true, output: `wrote ${relative(ctx.workspaceRoot, full)} (${content.length} chars)` };
  },
};

export const editFileTool: AgentTool = {
  name: "edit_file",
  description: "Replace an exact string in a file with a new string.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  permissions: ["filesystem.write"],
  async execute(input, ctx): Promise<ToolResult> {
    const { path, oldString, newString } = input as {
      path: string;
      oldString: string;
      newString: string;
    };
    if (!path || typeof oldString !== "string" || typeof newString !== "string") {
      return { ok: false, error: "missing 'path', 'oldString' or 'newString'" };
    }
    if (oldString.length === 0) return { ok: false, error: "'oldString' must not be empty" };
    const decision = await ctx.permissions.check("filesystem.write", path);
    if (decision.verdict !== "allowed") return denied(decision);
    const full = resolvePath(ctx, path);
    if (!(await hasAccess(full))) return { ok: false, error: `no such file: ${path}` };
    const current = await readFile(full, "utf8");
    const first = current.indexOf(oldString);
    if (first === -1) return { ok: false, error: "oldString not found in file" };
    const next = current.indexOf(oldString, first + oldString.length);
    const updated = current.slice(0, first) + newString + current.slice(first + oldString.length);
    await writeFile(full, updated, "utf8");
    if (next !== -1) {
      return {
        ok: true,
        output: `replaced first occurrence of a string that appears ${current.split(oldString).length - 1} times`,
      };
    }
    return { ok: true, output: "edited file successfully" };
  },
};

export const deleteFileTool: AgentTool = {
  name: "delete_file",
  description: "Delete a file (not a directory).",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  permissions: ["filesystem.delete"],
  async execute(input, ctx): Promise<ToolResult> {
    const { path } = input as { path: string };
    if (!path) return { ok: false, error: "missing 'path'" };
    const decision = await ctx.permissions.check("filesystem.delete", path);
    if (decision.verdict !== "allowed") return denied(decision);
    const full = resolvePath(ctx, path);
    const s = await stat(full);
    if (s.isDirectory()) return { ok: false, error: "delete_file does not remove directories" };
    await rm(full, { force: true });
    return { ok: true, output: `deleted ${relative(ctx.workspaceRoot, full)}` };
  },
};

export const listDirectoryTool: AgentTool = {
  name: "list_directory",
  description: "List the entries of a directory.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Defaults to workspace root" } },
    additionalProperties: false,
  },
  permissions: ["filesystem.read"],
  async execute(input, ctx): Promise<ToolResult> {
    const { path } = input as { path?: string };
    const decision = await ctx.permissions.check("filesystem.read", path ?? ".");
    if (decision.verdict !== "allowed") return denied(decision);
    const full = resolvePath(ctx, path ?? ".");
    if (!(await hasAccess(full))) return { ok: false, error: `no such directory: ${path ?? "."}` };
    const entries = await readdir(full, { withFileTypes: true });
    const lines = entries.map((e) => `${e.isDirectory() ? "dir " : "file"} ${e.name}`);
    return { ok: true, output: lines.join("\n") || "(empty)" };
  },
};

export const isPathInWorkspace = (workspaceRoot: string, candidate: string): boolean => {
  const root = resolve(workspaceRoot);
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  return target === root || target.startsWith(root + "/") || target.startsWith(root + "\\");
};