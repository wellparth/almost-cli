// Masked credential prompt overlay for onboarding flows (issue #47).
import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./themes.js";

export interface PromptPaneProps {
  title: string;
  label: string;
  value: string;
  secret: boolean;
  theme: Theme;
}

export function PromptPane({ title, label, value, secret, theme }: PromptPaneProps) {
  const shown = secret ? "*".repeat(value.length) : value;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} margin={1} paddingX={1}>
      <Text color={theme.accent}>
        {title}  <Text color={theme.muted}>enter to confirm · esc cancel</Text>
      </Text>
      <Box>
        <Text color={theme.prompt} bold>
          {label}:
        </Text>
        <Text color={theme.prompt}>
          {shown || <Text color={theme.muted}>…</Text>}
        </Text>
        <Text color={theme.muted}>▎</Text>
      </Box>
    </Box>
  );
}