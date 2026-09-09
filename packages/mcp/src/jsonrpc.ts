/**
 * Minimal JSON-RPC 2.0 + stdio framing for the Model Context Protocol.
 *
 * MCP's stdio transport frames each JSON-RPC message with the same headers
 * as an HTTP request has (Content-Length), exactly as LSP does.
 */

/** A JSON-RPC 2.0 request we send to the server. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

/** Frame a message as a Buffer for the stdio transport. */
export function frame(message: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([head, body]);
}

/** Incremental parser that yields complete JSON-RPC messages from a buffer. */
export class JsonRpcParser {
  #buffer = Buffer.alloc(0);

  /**
   * Append a chunk and return any complete messages parsed. Messages that are
   * still incomplete remain buffered.
   */
  push(chunk: Buffer): JsonRpcMessage[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const parsed = this.#parseOne();
      if (parsed === undefined) break;
      messages.push(parsed);
    }
    return messages;
  }

  #parseOne(): JsonRpcMessage | undefined {
    const headerEnd = this.#buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return undefined;
    const headerText = this.#buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(headerText);
    if (!match) {
      throw new Error(`malformed MCP frame (missing Content-Length): ${headerText.slice(0, 100)}`);
    }
    const length = Number(match[1]);
    if (length < 0 || !Number.isInteger(length)) {
      throw new Error(`invalid Content-Length: ${match[1]}`);
    }
    const bodyStart = headerEnd + 4;
    if (this.#buffer.length < bodyStart + length) return undefined;
    const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    this.#buffer = this.#buffer.subarray(bodyStart + length);
    return JSON.parse(body) as JsonRpcMessage;
  }
}

/** Build a JSON-RPC request message payload. */
export function request(id: number, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}