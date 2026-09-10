// TUI entry point (issues #28, #30).
import { render } from "ink";
import App from "./App.js";

/** Render the Ink-based terminal UI. Caller is responsible for the process lifecycle. */
export function startTui(): void {
  render(<App />, {
    exitOnCtrlC: false,
    // Alternate screen keeps scrollback intact, the way Claude Code / OpenCode do.
    alternateScreen: true,
  });
}