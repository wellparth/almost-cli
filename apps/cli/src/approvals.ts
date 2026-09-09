import { createInterface } from "node:readline";

/**
 * Reads a single y/n answer on stdin. Stderr is used for the prompt so the
 * provider/agent output on stdout stays clean.
 *
 * Reentrancy: approval prompts only happen while the agent is running. In the
 * REPL the main readline interface is paused for the duration of a turn, so
 * this temporary interface is the only reader on stdin. In non-interactive
 * (piped) mode we never prompt and deny by default (fail closed).
 */
export function askApproval(
  permission: string,
  detail?: string,
  prefersStdinTty = process.stdin.isTTY,
): Promise<boolean> {
  if (!prefersStdinTty) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(`\n⚠ permission: ${permission}\n${detail ? `  ${detail}\n` : ""}Allow? [y/N] `);
  return new Promise((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(/^\s*y(es)?\s*$/i.test(line));
    });
    rl.once("error", () => {
      rl.close();
      resolve(false);
    });
  });
}