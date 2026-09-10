import { Box, Text } from "ink";
import type { Theme } from "./themes.js";

export interface InputPaneProps {
  prompt: string;
  submitting: boolean;
  leadingAction: boolean;
  suggestions: string[];
  selectedSuggestion: number;
  theme: Theme;
}

export function InputPane({
  prompt,
  submitting,
  leadingAction,
  suggestions,
  selectedSuggestion,
  theme,
}: InputPaneProps) {
  const showSuggestions = suggestions.length > 0;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Box>
        <Text color={theme.prompt} bold>
          {leadingAction ? "⌨︎ " : "› "}
        </Text>
        {prompt.length === 0 ? (
          <Text color={theme.muted}>type a prompt…</Text>
        ) : (
          <Text color={theme.prompt}>{prompt}</Text>
        )}
        <Text color={theme.muted}>▎</Text>
      </Box>
      {showSuggestions ? (
        <Box flexDirection="column" marginTop={1}>
          {suggestions.map((suggestion, index) => (
            <Text key={suggestion} color={index === selectedSuggestion ? theme.accent : theme.muted} bold={index === selectedSuggestion}>
              {index === selectedSuggestion ? "› " : "  "}
              {suggestion}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {submitting
            ? "working…"
            : leadingAction
              ? "leader key — press a shortcut (h help, q exit, n new, l sessions, t thinking, d details)"
              : "ctrl+x leader • / commands • @ files • ! shell • Tab autocomplete"}
        </Text>
      </Box>
    </Box>
  );
}