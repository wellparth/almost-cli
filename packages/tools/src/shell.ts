import { exec } from "node:child_process";
import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { denied } from "./result.js";

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brmdir\b/,
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\bgit\s+commit\b.*--amend/,
  /\b>+\s*\/dev\/sd/,
  /\bdd\s+if=/,
  /\b:wq!/,
  /;\s*(rm|shutdown|reboot|mkfs)/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

export function runShellCommand(
  command: string,
  ctx: ToolContext,
  options?: { timeoutMs?: number },
): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      {
        cwd: ctx.cwd,
        env: { ...process.env, ...ctx.env },
        timeout: options?.timeoutMs ?? 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = error?.code === undefined || typeof error?.code !== "number" ? 1 : error.code;
        if (error && exitCode === 0) {
          resolvePromise({ ok: true, output: stdout });
          return;
        }
        if (error) {
          resolvePromise({
            ok: false,
            error: stderr || String(error),
            meta: { exitCode, stdout },
          });
          return;
        }
        resolvePromise({ ok: true, output: stdout });
      },
    );
  });
}

export const shellTool: AgentTool = {
  name: "shell",
  description:
    "Execute a shell command in the workspace and return its stdout. Requires explicit permission.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeoutMs: { type: "number" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  permissions: ["shell.execute"],
  async execute(input, ctx): Promise<ToolResult> {
    const { command, timeoutMs } = input as { command: string; timeoutMs?: number };
    if (!command) return { ok: false, error: "missing 'command'" };
    const decision = await ctx.permissions.check("shell.execute", command);
    if (decision.verdict !== "allowed") return denied(decision);
    if (isDangerousCommand(command)) {
      return { ok: false, error: "command rejected: matches a destructive pattern" };
    }
    return runShellCommand(command, ctx, { timeoutMs });
  },
};