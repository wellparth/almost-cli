export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType?: string }
  | { type: "tool_use"; toolCall: ToolCall }
  | { type: "tool_result"; toolCallId: string; output: string };

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface Conversation {
  messages: Message[];
}