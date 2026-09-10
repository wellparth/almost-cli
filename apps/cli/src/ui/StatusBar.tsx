import { Box, Text } from "ink";
import type { Theme } from "./themes.js";

export interface StatusBarProps {
  agent: string;
  provider: string;
  model: string;
  sessionId?: string;
  mode: string;
  thinking: boolean;
  theme: Theme;
}

export function StatusBar({ agent, provider, model, sessionId, mode, thinking, theme }: StatusBarProps) {
  const left = `${agent} • ${provider}/${model} • ${mode}${thinking ? " • thinking on" : ""}`;
  const right = sessionId ? `session ${sessionId}` : "no session";
  return (
    <Box borderStyle="single" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.muted}>
        <Text dimColor>{left}</Text>
        <Text>{"  "}</Text>
        <Text color={theme.accent}>{right}</Text>
      </Text>
    </Box>
  );
}