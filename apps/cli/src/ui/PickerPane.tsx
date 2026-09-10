// Interactive arrow-key selection overlay for the TUI (issue #44).
import React from "react";
import { Box, Text } from "ink";
import type { PickerItem } from "./commands.js";
import type { Theme } from "./themes.js";

export interface PickerState {
  title: string;
  items: PickerItem[];
  selected: number;
}

export function PickerPane({ picker, theme }: { picker: PickerState; theme: Theme }) {
  const labelPad = Math.min(24, Math.max(...picker.items.map((i) => i.label.length)));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} margin={1} paddingX={1}>
      <Text color={theme.accent}>
        {picker.title}  <Text color={theme.muted}>↑/↓ move · enter select · esc cancel</Text>
      </Text>
      <Box flexDirection="column">
        {picker.items.map((item, index) => {
          const selected = index === picker.selected;
          return (
            <Box key={item.label}>
              <Text color={selected ? theme.accent : theme.muted}>{selected ? "›" : " "} </Text>
              <Text color={selected ? theme.accent : theme.system} bold={selected}>
                {item.label.padEnd(labelPad)}
              </Text>
              {item.hint ? (
                <Text color={selected ? theme.accent : theme.muted}>{item.hint.slice(0, 48)}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}