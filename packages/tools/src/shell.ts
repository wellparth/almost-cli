import { exec } from "node:child_process";
import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { sanitizeEnv } from "@almost/security";
import { denied } from "./result.js";

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brm\s+-fr\b/,
  /\brmdir\b/,
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\bgit\s+commit\b.*--amend/,
  /\bgit\s+push\b.*(--force|-f\b)/,
  /\bmv\s+.*\s+\/(?:etc|bin|sbin|usr|lib)\b/,
  /\bchmod\s+(-R\s+)?777\b/,
  /\bchown\s+-R\b/,
  /\b>+\s*\/dev\/sd/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\b:wq!?\b/,
  /\b:q!/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsh\s+-c\b/,
  /\bbash\s+-c\b/,
  /\bzsh\s+-c\b/,
  /\beval\b/,
  /\bcurl\b[^\n]*\|\s*(sh|bash)\b/,
  /\bcurl\b[^\n]*\|\s*(sh|bash)\s*$/m,
  /\bwget\b[^\n]*\|\s*(sh|bash)\b/,
  /\bbase64\s+-[dl]\b/i,
  /\biptables\b/,
  /\bufw\s+(enable|allow|deny)\b/,
  /\bpoweroff\b/,
  /\bsystemctl\b/,
  /\bnc\s+/,
  /\bsocat\b/,
  /`/,
  /\$\(/,
  /\|\s*sh\s*(;|$)/,
];

/**
 * Best-effort guard against obviously destructive commands. This is NOT the
 * primary security boundary: shell.execute is not granted by default and shell
 * execution is routed through the permission engine (and typically approval).
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

export function runShellCommand(
  command: string,
  ctx: ToolContext,
  options?: { timeoutMs?: number },
): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    const baseEnv = { ...process.env, ...ctx.env };
    exec(
      command,
      {
        cwd: ctx.cwd,
        // Never pass secret-bearing environment variables to the child process
        // (e.g. API keys) to limit exfiltration via shell commands.
        env: sanitizeEnv(baseEnv as Record<string, string>),
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