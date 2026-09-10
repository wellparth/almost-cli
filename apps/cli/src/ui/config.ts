// Shared TUI config loaded from tui.json (issue #37).
export interface TuiConfig {
  theme: string;
  leaderTimeout: number;
  scrollSpeed: number;
  keybinds: {
    leader: string;
    commandList: string;
    shortcuts: Record<string, string>;
  };
}

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  theme: "default",
  leaderTimeout: 2000,
  scrollSpeed: 3,
  keybinds: {
    leader: "ctrl",
    commandList: "ctrl+p",
    shortcuts: {
      h: "help",
      q: "exit",
      n: "new",
      l: "sessions",
      t: "thinking",
      d: "details",
      c: "clear",
    },
  },
};

export async function loadTuiConfig(source: string | undefined = undefined): Promise<TuiConfig> {
  const candidates = source ? [source] : [process.env.MYAGENT_TUI_CONFIG, "tui.json", "/tmp/opencode/tui.json"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return mergeConfig(parsed);
    } catch {
      // fall through to next candidate
    }
  }
  return DEFAULT_TUI_CONFIG;
}

function mergeConfig(parsed: Record<string, unknown>): TuiConfig {
  const keybinds = (parsed.keybinds as Record<string, unknown> | undefined) ?? {};
  const shortcuts = (keybinds.shortcuts as Record<string, string> | undefined) ?? {};
  return {
    theme: typeof parsed.theme === "string" ? parsed.theme : DEFAULT_TUI_CONFIG.theme,
    leaderTimeout:
      typeof parsed.leader_timeout === "number" ? parsed.leader_timeout : DEFAULT_TUI_CONFIG.leaderTimeout,
    scrollSpeed: typeof parsed.scroll_speed === "number" ? parsed.scroll_speed : DEFAULT_TUI_CONFIG.scrollSpeed,
    keybinds: {
      leader: typeof keybinds.leader === "string" ? keybinds.leader : DEFAULT_TUI_CONFIG.keybinds.leader,
      commandList:
        typeof keybinds.command_list === "string" ? keybinds.command_list : DEFAULT_TUI_CONFIG.keybinds.commandList,
      shortcuts: { ...DEFAULT_TUI_CONFIG.keybinds.shortcuts, ...shortcuts },
    },
  };
}