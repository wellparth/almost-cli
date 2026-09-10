// Leader-key keybinds for the TUI (issue #36).
import type { TuiConfig } from "./config.js";

export type LeaderAction =
  | "help"
  | "exit"
  | "new"
  | "clear"
  | "sessions"
  | "thinking"
  | "details";

export const LEADER_ACTIONS: readonly LeaderAction[] = [
  "help",
  "exit",
  "new",
  "clear",
  "sessions",
  "thinking",
  "details",
] as const;

/** Resolve a leader shortcut key ("h", "q", ...) to an action. */
export function resolveLeaderAction(config: TuiConfig, input: string): LeaderAction | undefined {
  if (!input) return undefined;
  const shortcut = input.toLowerCase();
  const command = config.keybinds.shortcuts[shortcut];
  if (command && (LEADER_ACTIONS as readonly string[]).includes(command)) {
    return command as LeaderAction;
  }
  // Allow the full action name as a fallback (e.g. ctrl+x followed by "exit").
  if ((LEADER_ACTIONS as readonly string[]).includes(input)) return input as LeaderAction;
  return undefined;
}