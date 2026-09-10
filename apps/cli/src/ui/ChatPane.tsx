import { Box, Text } from "ink";
import type { Message } from "./state.js";
import type { Theme } from "./themes.js";

const ROLE_LABEL: Record<Message["role"], string> = {
  user: "you",
  agent: "agent",
  system: "sys",
  error: "err",
};

export function ChatPane({ messages, theme }: { messages: Message[]; theme: Theme }) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={theme.muted}>— start typing below; use / for commands, @ for files, ! for shell —</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {messages.map((message) => (
        <Box key={message.id} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={roleColor(message.role, theme)} bold>
              {ROLE_LABEL[message.role]}
            </Text>
            <Text color={theme.muted}> │ </Text>
            {message.streaming ? <Text color={roleColor(message.role, theme)}>{message.content}▌</Text> : null}
            {message.streaming ? null : <Text color={roleColor(message.role, theme)}>{message.content}</Text>}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function roleColor(role: Message["role"], theme: Theme): string {
  switch (role) {
    case "user":
      return theme.user;
    case "agent":
      return theme.agent;
    case "system":
      return theme.system;
    case "error":
      return theme.error;
  }
}