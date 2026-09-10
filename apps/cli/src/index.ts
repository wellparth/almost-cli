import { cli } from "./cli.js";
import { startTui } from "./ui/tui.js";

void main();

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    const tuiMode = args.length === 0 || args[0] === "--tui" || args[0] === "tui";
    if (interactive && tuiMode) {
      // Terminal-first: drop into the Ink TUI when run without arguments.
      if (args[0] === "--tui") process.exitCode = 0;
      startTui();
      return;
    }
    const code = await cli(args);
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`\n✘ ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("run: myagent help\n");
    process.exitCode = 1;
  }
}