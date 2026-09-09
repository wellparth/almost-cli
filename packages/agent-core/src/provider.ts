export type Capability =
  | "streaming"
  | "tool_calling"
  | "parallel_tool_calls"
  | "reasoning"
  | "vision"
  | "structured_output"
  | "context_caching"
  | "responses_api";

export interface Model {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: Capability[];
}

export interface ModelRequest {
  model: string;
  system?: string;
  messages: import("./message.js").Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasonTokens?: number;
}

export type ModelEvent =
  | { type: "TEXT_DELTA"; content: string }
  | { type: "REASONING_DELTA"; content: string }
  | { type: "TOOL_CALL"; id: string; name: string; input: unknown }
  | { type: "TOOL_RESULT"; id: string; result: ToolResult }
  | { type: "USAGE"; usage: Usage; model: string }
  | { type: "FINISH"; stopReason: string }
  | { type: "ERROR"; message: string };

export type StopReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

export interface ModelProvider {
  readonly id: string;

  listModels(): Promise<Model[]>;

  generate(request: ModelRequest): AsyncIterable<ModelEvent>;

  supports(capability: Capability): boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolResult =
  | { ok: true; output: string; meta?: Record<string, unknown> }
  | { ok: false; error: string; meta?: Record<string, unknown> };