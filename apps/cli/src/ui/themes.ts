// Theme tokens for the TUI (issue #37).
export interface Theme {
  user: string;
  agent: string;
  system: string;
  error: string;
  prompt: string;
  muted: string;
  accent: string;
}

export const THEMES: Record<string, Theme> = {
  default: {
    user: "cyan",
    agent: "green",
    system: "yellow",
    error: "red",
    prompt: "magenta",
    muted: "gray",
    accent: "blue",
  },
  dark: {
    user: "#7dd3fc",
    agent: "#86efac",
    system: "#fde047",
    error: "#f87171",
    prompt: "#f0abfc",
    muted: "#64748b",
    accent: "#93c5fd",
  },
  light: {
    user: "#0369a1",
    agent: "#15803d",
    system: "#a16207",
    error: "#b91c1c",
    prompt: "#a21caf",
    muted: "#9ca3af",
    accent: "#1d4ed8",
  },
};

export function resolveTheme(name: string): Theme {
  const fallback = THEMES["default"] as Theme;
  const selected = THEMES[name] as Theme | undefined;
  return selected ? ({ ...fallback, ...selected } as Theme) : fallback;
}