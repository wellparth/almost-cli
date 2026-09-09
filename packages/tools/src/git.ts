import { execFile } from "node:child_process";
import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { denied } from "./result.js";

function runGit(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) resolvePromise({ ok: false, stdout, stderr: stderr || String(error) });
      else resolvePromise({ ok: true, stdout, stderr });
    });
  });
}

export function makeGitTool(
  name: string,
  description: string,
  permission: "git.read" | "git.write",
  args: (input: Record<string, unknown>, cwd: string) => string[],
  schema: Record<string, unknown> = {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
): AgentTool {
  return {
    name,
    description,
    inputSchema: schema,
    permissions: [permission],
    async execute(input, ctx): Promise<ToolResult> {
      const decision = await ctx.permissions.check(permission);
      if (decision.verdict !== "allowed") return denied(decision);
      const result = await runGit(args(input as Record<string, unknown>, ctx.cwd), ctx.cwd);
      if (!result.ok) return { ok: false, error: result.stderr.trim() || "git command failed" };
      return { ok: true, output: result.stdout.trimEnd() || "(empty)" };
    },
  };
}

export const gitStatusTool = makeGitTool(
  "git_status",
  "Show the working tree status.",
  "git.read",
  () => ["status", "--short"],
);

export const gitDiffTool = makeGitTool(
  "git_diff",
  "Show uncommitted changes. Pass a file path to scope the diff.",
  "git.read",
  (input, cwd) => {
    const { path, staged } = input as { path?: string; staged?: boolean };
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (path) args.push("--", path);
    else args.push("--", cwd);
    return args;
  },
  {
    type: "object",
    properties: {
      path: { type: "string" },
      staged: { type: "boolean" },
    },
    additionalProperties: false,
  },
);

export const gitLogTool = makeGitTool(
  "git_log",
  "Show recent commit history.",
  "git.read",
  (input) => {
    const { max } = input as { max?: number };
    return ["log", "--oneline", "-n", String(max ?? 20)];
  },
  {
    type: "object",
    properties: { max: { type: "number" } },
    additionalProperties: false,
  },
);

export const gitBranchTool = makeGitTool(
  "git_branch",
  "List local branches and the current branch.",
  "git.read",
  () => ["branch", "--list"],
);