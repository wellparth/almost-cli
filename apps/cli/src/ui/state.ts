// Message model for the TUI chat pane (issue #31).
export type MessageRole = "user" | "agent" | "system" | "error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Set while content is still streaming; renders with a cursor. */
  streaming?: boolean;
}

let counter = 0;

export function newMessage(role: MessageRole, content: string, streaming = false): Message {
  counter += 1;
  return {
    id: `m-${Date.now().toString(36)}-${counter.toString(36)}`,
    role,
    content,
    streaming,
  };
}