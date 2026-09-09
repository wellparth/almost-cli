import { promises as fs } from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  name: string;
  command: string;
  /** Extra arguments passed to the server command. */
  args?: string[];
  /** Extra environment variables for the server process. */
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

export function emptyMcpConfig(): McpConfig {
  return { servers: [] };
}

/** Read the MCP server config from `<root>/mcp.json` (missing file => no servers). */
export async function loadMcpConfig(root: string): Promise<McpConfig> {
  const file = path.join(root, "mcp.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as McpConfig).servers)) {
      throw new Error("mcp.json must contain a { \"servers\": [...] } array");
    }
    return { servers: (parsed as McpConfig).servers.filter(isValidServer) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyMcpConfig();
    throw error;
  }
}

/** Persist the MCP server config to `<root>/mcp.json`. */
export async function saveMcpConfig(root: string, config: McpConfig): Promise<void> {
  const file = path.join(root, "mcp.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8" });
}

export function isValidServer(server: unknown): server is McpServerConfig {
  const s = server as McpServerConfig;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.name === "string" &&
    s.name.length > 0 &&
    typeof s.command === "string" &&
    s.command.length > 0
  );
}