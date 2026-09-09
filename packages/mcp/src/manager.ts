import type { AgentTool, ToolResult } from "@almost/agent-core";
import { McpClient, toAgentTool } from "./client.js";
import type { McpConfig } from "./config.js";

/**
 * Owns the life of one MCP server per configured entry, hosts connection
 * failures so a single broken server never breaks a run, and turns discovered
 * tools into AgentTools the executor can call (gated by the "mcp" permission).
 */
export class McpManager {
  readonly #config: McpConfig;
  readonly #clients = new Map<string, McpClient>();
  readonly #onLog?: (name: string, line: string) => void;
  readonly #toolPrefix: string;

  constructor(config: McpConfig, options: { onLog?: (name: string, line: string) => void; toolPrefix?: string } = {}) {
    this.#config = config;
    this.#onLog = options.onLog;
    this.#toolPrefix = options.toolPrefix ?? "mcp";
  }

  get servers(): string[] {
    return [...this.#clients.keys()];
  }

  /** Tool specs discovered so far across all connected servers. */
  get toolCount(): number {
    let count = 0;
    for (const client of this.#clients.values()) count += client.tools.length;
    return count;
  }

  /** Whether any servers are configured. */
  get hasServers(): boolean {
    return this.#config.servers.length > 0;
  }

  /** Connect every configured server. Failures are logged and skipped. */
  async connectAll(): Promise<void> {
    for (const server of this.#config.servers) {
      if (this.#clients.has(server.name)) continue;
      const client = new McpClient({
        serverId: server.name,
        command: server.command,
        args: server.args ?? [],
        env: server.env,
        onLog: (line) => this.#onLog?.(server.name, line),
      });
      try {
        await client.connect();
        this.#clients.set(server.name, client);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#onLog?.(server.name, `failed to connect: ${message}`);
        await client.close().catch(() => undefined);
      }
    }
  }

  /** AgentTools for every discovered MCP tool. */
  get agentTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const client of this.#clients.values()) {
      for (const tool of client.tools) {
        tools.push(toAgentTool(client, tool, this.#toolPrefix));
      }
    }
    return tools;
  }

  async closeAll(): Promise<void> {
    const failures: string[] = [];
    for (const client of this.#clients.values()) {
      try {
        await client.close();
      } catch (error) {
        failures.push(`${client.serverId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.#clients.clear();
    if (failures.length > 0) {
      throw new Error(`failed to close mcp servers: ${failures.join("; ")}`);
    }
  }

  /** Convenience for one-shot calls (used by CLI `mcp call`). */
  async callServerTool(serverId: string, toolName: string, args: unknown): Promise<ToolResult> {
    const client = this.#clients.get(serverId);
    if (!client) return { ok: false, error: `mcp server '${serverId}' is not connected` };
    if (!client.tools.some((t) => t.name === toolName)) {
      return { ok: false, error: `unknown mcp tool '${toolName}' on server '${serverId}'` };
    }
    return client.callTool(toolName, args);
  }
}