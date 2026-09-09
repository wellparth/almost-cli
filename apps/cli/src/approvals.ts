import { createInterface } from "node:readline";

/**
 * Reads a single y/n answer on stdin. Stderr is used for the prompt so the
 * provider/agent output on stdout stays clean.
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