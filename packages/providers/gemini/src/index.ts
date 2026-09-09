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

export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: { name: string; content: unknown } };
}

interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

const DEFAULT_CAPABILITIES: Capability[] = [
  "streaming",
  "tool_calling",
  "vision",
  "structured_output",
  "reasoning",
];

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini";
  readonly baseUrl: string = GEMINI_BASE_URL;
  readonly apiKeyEnvVar: string = GEMINI_API_KEY_ENV;
  readonly #capabilities: Set<Capability>;
  #apiKeyOverride?: string;

  constructor() {
    this.#capabilities = new Set(DEFAULT_CAPABILITIES);
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
    if (!key) throw new Error(`no API key for provider 'gemini' (${this.apiKeyEnvVar})`);
    const res = await fetch(
      `${this.baseUrl}/models?key=${key}&pageSize=1000`,
    );
    if (!res.ok) throw new Error(`listModels failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({ id: m.name.replace("models/", ""), name: m.name }));
  }

  async *generate(request: ModelRequest): AsyncIterable<ModelEvent> {
    const key = this.apiKey;
    if (!key) {
      yield {
        type: "ERROR",
        message: `no API key for provider 'gemini' (${this.apiKeyEnvVar})`,
      };
      return;
    }

    const system = request.system;
    const contents: GeminiContent[] = [];
    for (const m of request.messages) {
      if (m.role === "system") continue;
      contents.push(toGeminiContent(m));
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (request.tools && request.tools.length > 0) {
      body.tools = [{ functionDeclarations: request.tools.map(toGeminiTool) }];
    }

    const url =
      `${this.baseUrl}/models/${request.model}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(key)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        message: `Gemini provider error ${res.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    let callId = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let parsed: GeminiResponse;
            try {
              parsed = JSON.parse(data) as GeminiResponse;
            } catch {
              continue;
            }
            const events = this.#mapChunk(parsed, request.model, ++callId);
            for (const event of events) yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  #mapChunk(chunk: GeminiResponse, model: string, callId: number): ModelEvent[] {
    if (chunk.error?.message) {
      return [{ type: "ERROR", message: chunk.error.message }];
    }
    const events: ModelEvent[] = [];
    for (const candidate of chunk.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) events.push({ type: "TEXT_DELTA", content: part.text });
        if (part.functionCall) {
          events.push({
            type: "TOOL_CALL",
            id: `gemini_${callId}`,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
        }
      }
      if (candidate.finishReason) {
        events.push({ type: "FINISH", stopReason: mapFinishReason(candidate.finishReason) });
      }
    }
    const usageMeta = chunk.usageMetadata;
    if (usageMeta) {
      const usage: Usage = {
        inputTokens: usageMeta.promptTokenCount ?? 0,
        outputTokens: usageMeta.candidatesTokenCount ?? 0,
      };
      events.push({ type: "USAGE", usage, model });
    }
    return events;
  }
}

function toGeminiContent(message: Message): GeminiContent {
  if (message.role === "user") {
    const text = Array.isArray(message.content)
      ? message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n")
      : message.content;
    return { role: "user", parts: [{ text }] };
  }
  if (message.role === "assistant") {
    const parts: GeminiPart[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      parts.push({
        functionCall: { name: call.name, args: recordize(call.input) },
      });
    }
    return { role: "model", parts };
  }
  if (message.role === "tool") {
    return {
      role: "function",
      parts: [{ functionResponse: { name: "", response: { name: "", content: message.content } } }],
    };
  }
  return { role: "user", parts: [{ text: message.content }] };
}

function recordize(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function toGeminiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    case "MALFORMED_FUNCTION_CALL":
    case "RECITATION":
      return "error";
    default:
      return "stop";
  }
}

export function createGeminiProvider(): GeminiProvider {
  return new GeminiProvider();
}