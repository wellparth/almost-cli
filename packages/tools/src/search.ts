import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { denied } from "./result.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

function makeSafeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

async function walkFiles(root: string, maxDepth = 8): Promise<string[]> {
  const results: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full, depth + 1);
      } else {
        results.push(full);
      }
    }
  }
  await visit(root, 0);
  return results;
}

export const searchFilesTool: AgentTool = {
  name: "search_files",
  description: "Find files whose path matches a pattern under a directory.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression matched against file paths" },
      path: { type: "string", description: "Directory to search, defaults to workspace root" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  permissions: ["filesystem.read"],
  async execute(input, ctx): Promise<ToolResult> {
    const { pattern, path } = input as { pattern: string; path?: string };
    if (!pattern) return { ok: false, error: "missing 'pattern'" };
    const decision = await ctx.permissions.check("filesystem.read", path ?? ".");
    if (decision.verdict !== "allowed") return denied(decision);
    const root = path && path !== "." ? join(ctx.workspaceRoot, path) : ctx.workspaceRoot;
    const regex = makeSafeRegex(pattern);
    const files = await walkFiles(root);
    const matches: string[] = [];
    for (const file of files) {
      const relative = file.replace(root + "/", "");
      if (regex.test(relative)) matches.push(relative);
    }
    return { ok: true, output: matches.join("\n") || "(no matches)" };
  },
};

export const grepTool: AgentTool = {
  name: "grep",
  description: "Search file contents for a regular expression and return matching lines.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory to search, defaults to workspace root" },
      include: { type: "string", description: "Optional path regex to filter files" },
      maxMatches: { type: "number", description: "Cap on returned matches (default 200)" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  permissions: ["filesystem.read"],
  async execute(input, ctx): Promise<ToolResult> {
    const { pattern, path, include, maxMatches } = input as {
      pattern: string;
      path?: string;
      include?: string;
      maxMatches?: number;
    };
    if (!pattern) return { ok: false, error: "missing 'pattern'" };
    const decision = await ctx.permissions.check("filesystem.read", path ?? ".");
    if (decision.verdict !== "allowed") return denied(decision);
    const root = path && path !== "." ? join(ctx.workspaceRoot, path) : ctx.workspaceRoot;
    const regex = makeSafeRegex(pattern);
    const includeRegex = include ? makeSafeRegex(include) : null;
    const cap = maxMatches ?? 200;
    const files = await walkFiles(root);
    const results: string[] = [];
    for (const file of files) {
      if (includeRegex && !includeRegex.test(file)) continue;
      let content: string;
      try {
        const s = await stat(file);
        if (s.size > 512 * 1024) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < cap; i++) {
        if (regex.test(lines[i] ?? "")) {
          results.push(`${file.replace(root + "/", "")}:${i + 1}:${(lines[i] ?? "").slice(0, 200)}`);
        }
      }
      if (results.length >= cap) break;
    }
    if (results.length >= cap) results.push("(truncated)");
    return { ok: true, output: results.join("\n") || "(no matches)" };
  },
};