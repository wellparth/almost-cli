import type {
  Capability,
  Message,
  Model,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  StopReason,
  ToolDefinition,
  Usage,
} from "@almost/agent-core";
import { parseSSE } from "./sse.js";

export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  capabilities?: Capability[];
  contextWindow?: number;
}

const DEFAULT_CAPABILITIES: Capability[] = [
  "streaming",
  "tool_calling",
  "parallel_tool_calls",
];

interface OpenAIMessage {
  role: string;
  content?: string | Array<{ type: string; text: string }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  name: string;
  input: unknown;
}

function toOpenAIMessage(message: Message): OpenAIMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user": {
      if (!Array.isArray(message.content)) {
        return { role: "user", content: message.content };
      }
      const content = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => ({ type: "text", text: part.text } as const));
      return { role: "user", content };
    }
    case "assistant": {
      const toolCalls = message.toolCalls?.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      }));
      return { role: "assistant", content: message.content, tool_calls: toolCalls };
    }
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
}

export function toOpenAITools(tools: ToolDefinition[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        type?: string;
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKeyEnvVar: string;
  readonly contextWindow: number;
  readonly #capabilities: Set<Capability>;
  #apiKeyOverride?: string;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKeyEnvVar = config.apiKeyEnvVar;
    this.contextWindow = config.contextWindow ?? 128_000;
    this.#capabilities = new Set(config.capabilities ?? DEFAULT_CAPABILITIES);
  }

  get apiKey(): string | undefined {
    return this.#apiKeyOverride ?? process.env[this.apiKeyEnvVar];
  }

  setApiKey(key: string): void {
    this.#apiKeyOverride = key;
  }

  supports(capability: Capability): boolean {
    return this.#capabilities.has(capability);
  }

  async listModels(): Promise<Model[]> {
    const key = this.apiKey;
    if (!key) throw new Error(`no API key for provider '${this.id}' (${this.apiKeyEnvVar})`);
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`listModels failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: this.contextWindow,
      capabilities: Array.from(this.#capabilities),
    }));
  }

  async *generate(request: ModelRequest): AsyncIterable<ModelEvent> {
    const key = this.apiKey;
    if (!key) {
      yield { type: "ERROR", message: `no API key for provider '${this.id}' (${this.apiKeyEnvVar})` };
      return;
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.tools && request.tools.length > 0) body.tools = toOpenAITools(request.tools);
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      yield { type: "ERROR", message: `request failed: ${String(error)}` };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text();
      yield {
        type: "ERROR",
        message: `provider error ${res.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
    yield* this.drain(res.body, toolCalls, request.model);
  }

  async *drain(
    body: ReadableStream<Uint8Array>,
    toolCalls: Map<number, { id?: string; name?: string; arguments: string }>,
    model: string,
  ): AsyncGenerator<ModelEvent> {
    for await (const data of parseSSE(body)) {
      if (data === "[DONE]") break;
      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue;
      }
      if (chunk.error?.message) {
        yield { type: "ERROR", message: chunk.error.message };
        return;
      }
      if (chunk.usage) {
        const usage: Usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
          reasonTokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
        };
        yield { type: "USAGE", usage, model };
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {};
        if (delta.content) yield { type: "TEXT_DELTA", content: delta.content };
        if (delta.reasoning_content) {
          yield { type: "REASONING_DELTA", content: delta.reasoning_content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const existing = toolCalls.get(idx) ?? { arguments: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCalls.set(idx, existing);
        }
        const finish = choice.finish_reason;
        if (finish) {
          if (finish === "tool_calls") {
            for (const call of toolCalls.values()) {
              const parsed: OpenAIToolCall = {
                id: call.id ?? "call_unknown",
                name: call.name ?? "unknown",
                input: this.#tryParseArguments(call.arguments),
              };
              yield {
                type: "TOOL_CALL",
                id: parsed.id,
                name: parsed.name,
                input: parsed.input,
              };
            }
          }
          yield { type: "FINISH", stopReason: this.mapStopReason(finish) };
        }
      }
    }
  }

  #tryParseArguments(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  mapStopReason(finish: string): StopReason {
    switch (finish) {
      case "tool_calls":
        return "tool_calls";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "error":
      case "server_error":
        return "error";
      case "stop":
      default:
        return "stop";
    }
  }
}