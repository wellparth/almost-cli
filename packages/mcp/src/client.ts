import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonRpcParser, frame, request as buildRequest } from "./jsonrpc.js";

import type { AgentTool, ToolResult } from "@almost/agent-core";

/**
 * Model Context Protocol client over the stdio transport. Speaks JSON-RPC 2.0
 * with Content-Length framing, performs the initialize handshake, discovers
 * tools via tools/list, and dispatches tools/call. Ownership of the child
 * process lifecycle lives with the caller (McpClient.close()).
 */

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Result shape returned by an MCP tools/call. */
export interface McpCallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

export interface McpClientOptions {
  /** Friendly id used in the AgentTool permission details and logging. */
  serverId: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Initialization timeout in ms (default 15s). */
  timeoutMs?: number;
  onLog?: (line: string) => void;
}

export const MCP_PROTOCOL_VERSION = "2024-11-05";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TOOL_OUTPUT_LENGTH = 64 * 1024;

interface IncomingMessage {
  id?: number;
  result?: unknown;
  error?: { code?: number; message: string };
  method?: string;
}

export class McpClient {
  readonly #options: McpClientOptions;
  readonly emitters = new EventEmitter();
  readonly #parser = new JsonRpcParser();
  #child?: ChildProcessWithoutNullStreams;
  #nextId = 1;
  readonly #pending = new Map<number, { resolve: (msg: unknown) => void; reject: (err: Error) => void }>();
  #tools: McpToolSpec[] = [];
  #closed = false;

  constructor(options: McpClientOptions) {
    this.#options = options;
  }

  get serverId(): string {
    return this.#options.serverId;
  }

  get tools(): McpToolSpec[] {
    return this.#tools;
  }

  get isConnected(): boolean {
    return this.#child !== undefined && !this.#closed;
  }

  /** Spawn the server process, run the initialize handshake, and list tools. */
  async connect(): Promise<void> {
    const child = spawn(this.#options.command, this.#options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.#options.env ?? {}) },
    });
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      for (const message of this.#parser.push(chunk)) {
        this.#dispatch(message as IncomingMessage);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trimEnd();
      if (line.length > 0) this.#options.onLog?.(line);
      this.emitters.emit("log", line);
    });
    child.on("exit", (code, signal) => {
      const message = `mcp server '${this.#options.serverId}' exited (${signal ?? code ?? "unknown"})`;
      this.#options.onLog?.(message);
      for (const { reject } of this.#pending.values()) {
        reject(new Error(message));
      }
      this.#pending.clear();
    });

    const result = await this.#request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "almost-cli", version: "0.1.0" },
    });
    const capabilities = (result as { capabilities?: { tools?: { listChanged?: boolean } } })?.capabilities;
    if (!capabilities?.tools) {
      this.#tools = [];
    } else {
      await this.#request("notifications/initialized", undefined, true);
      const listed = (await this.#request("tools/list", {})) as { tools?: McpToolSpec[] };
      this.#tools = listed.tools ?? [];
    }
  }

  async callTool(name: string, args: unknown): Promise<ToolResult> {
    const { content, isError } = (await this.#request("tools/call", {
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    })) as McpCallResult;
    const text = (content ?? [])
      .map((item) => (typeof item?.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n");
    if (isError) {
      return { ok: false, error: text.slice(0, MAX_TOOL_OUTPUT_LENGTH) || "mcp tool returned an error" };
    }
    return { ok: true, output: text.slice(0, MAX_TOOL_OUTPUT_LENGTH) };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const child = this.#child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // stdin may already be closed
    }
    const exit = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 500).unref();
    });
    await exit;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    for (const { reject } of this.#pending.values()) {
      reject(new Error("mcp client closed"));
    }
    this.#pending.clear();
    this.#child = undefined;
  }

  #dispatch(message: IncomingMessage): void {
    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`mcp error: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    // Server-initiated notification or request (ignored for our purposes;
    // tools/list_changed would invalidate the cached tool list).
    if (message.method === "notifications/tools/list_changed") {
      this.#tools = [];
    }
  }

  async #request(method: string, params: Record<string, unknown> | undefined, notification = false): Promise<unknown> {
    if (!this.#child || this.#closed) throw new Error(`mcp server '${this.#options.serverId}' is not connected`);
    if (notification) {
      this.#child.stdin.write(frame({ jsonrpc: "2.0", method, params }));
      return undefined;
    }
    const id = this.#nextId++;
    this.#child.stdin.write(frame(buildRequest(id, method, params)));
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`mcp request timed out: ${method}`));
      }, this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }
}

/** Adapt an MCP tool into the AgentTool the executor understands. */
export function toAgentTool(client: McpClient, tool: McpToolSpec, prefix = "mcp"): AgentTool {
  return {
    name: `${prefix}_${tool.name}`,
    description: tool.description ?? `MCP tool '${tool.name}' from server '${client.serverId}'`,
    inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    permissions: ["mcp"],
    async execute(input) {
      return client.callTool(tool.name, input);
    },
  };
}