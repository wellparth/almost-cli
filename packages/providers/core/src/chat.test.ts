import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider, parseSSE } from "./index.js";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("parseSSE", () => {
  it("yields data payloads split across chunks", async () => {
    const stream = sseStream([
      'data: {"a":1}\n\n',
      'data: {"b":2}\ndata: {"c":3}\n\n',
      "data: [DONE]\n\n",
    ]);
    const events: string[] = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual(['{"a":1}', '{"b":2}', '{"c":3}', "[DONE]"]);
  });
});

describe("OpenAICompatibleProvider", () => {
  it("maps a streaming tool-call response to ModelEvents", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "fake",
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "FAKE_KEY",
    });
    provider.setApiKey("k");

    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\"/tmp/x\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]);

    const events: Array<{ type: string }> = [];
    const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
    for await (const event of provider.drain(body, toolCalls, "fake-model")) {
      events.push(event);
      if (event.type === "TOOL_CALL") {
        expect(event.name).toBe("read_file");
        expect(event.input).toEqual({ path: "/tmp/x" });
      }
      if (event.type === "USAGE") {
        expect(event.usage.inputTokens).toBe(10);
      }
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual(["USAGE", "TOOL_CALL", "FINISH"]);
  });

  it("maps a text response to TEXT_DELTA + FINISH", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "fake",
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "FAKE_KEY",
    });
    provider.setApiKey("k");
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const events: Array<{ type: string }> = [];
    for await (const event of provider.drain(body, new Map(), "fake-model")) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types).toEqual(["TEXT_DELTA", "TEXT_DELTA", "FINISH"]);
  });

  it("errors without an API key", async () => {
    delete process.env.FAKE_KEY;
    const provider = new OpenAICompatibleProvider({
      id: "fake",
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "FAKE_KEY",
    });
    const events: Array<{ type: string }> = [];
    for await (const event of provider.generate({ model: "m", messages: [] })) {
      events.push(event);
    }
    expect(events[0]?.type).toBe("ERROR");
  });
});