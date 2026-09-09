import process from "node:process";
import { McpClient, loadMcpConfig, saveMcpConfig } from "@almost/mcp";
import type { AppState } from "@almost/storage";

export async function mcpCommand(args: string[], state: AppState): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "list") return listServers(state);
  if (sub === "add") return addServer(rest, state);
  if (sub === "remove") return removeServer(rest, state);
  if (sub === "test") return testServer(rest, state);
  throw new Error(`unknown mcp subcommand '${sub}' (available: list, add, remove, test)`);
}

async function listServers(state: AppState): Promise<number> {
  const config = await loadMcpConfig(state.paths.root);
  if (config.servers.length === 0) {
    process.stdout.write("no MCP servers configured (add one: myagent mcp add <name> <command> [args...])\n");
    return 0;
  }
  process.stdout.write("MCP servers:\n");
  for (const server of config.servers) {
    const args = (server.args ?? []).length > 0 ? ` ${(server.args ?? []).join(" ")}` : "";
    const envCount = Object.keys(server.env ?? {}).length;
    process.stdout.write(`- ${server.name}  ${server.command}${args}${envCount > 0 ? `  (${envCount} env vars)` : ""}\n`);
  }
  return 0;
}

async function addServer(args: string[], state: AppState): Promise<number> {
  const name = args[0];
  const command = args[1];
  if (!name || !command) {
    throw new Error('usage: myagent mcp add <name> <command> [args...]');
  }
  const config = await loadMcpConfig(state.paths.root);
  const existing = config.servers.findIndex((s) => s.name === name);
  const entry = { name, command, args: args.slice(2) };
  if (existing >= 0) {
    config.servers[existing] = entry;
  } else {
    config.servers.push(entry);
  }
  await saveMcpConfig(state.paths.root, config);
  process.stdout.write(`configured MCP server ${name} (${state.paths.root}/mcp.json)\n`);
  return 0;
}

async function removeServer(args: string[], state: AppState): Promise<number> {
  const name = args[0];
  if (!name) throw new Error("usage: myagent mcp remove <name>");
  const config = await loadMcpConfig(state.paths.root);
  const before = config.servers.length;
  config.servers = config.servers.filter((s) => s.name !== name);
  if (config.servers.length === before) {
    process.stdout.write(`no MCP server '${name}'\n`);
    return 0;
  }
  await saveMcpConfig(state.paths.root, config);
  process.stdout.write(`removed MCP server ${name}\n`);
  return 0;
}

async function testServer(args: string[], state: AppState): Promise<number> {
  const name = args[0];
  if (!name) throw new Error("usage: myagent mcp test <name>");
  const config = await loadMcpConfig(state.paths.root);
  const server = config.servers.find((s) => s.name === name);
  if (!server) throw new Error(`no MCP server '${name}' (available: ${config.servers.map((s) => s.name).join(", ")})`);
  const client = new McpClient({
    serverId: server.name,
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  });
  process.stdout.write(`connecting ${server.name} (${server.command} ${(server.args ?? []).join(" ")})\n`);
  await client.connect();
  try {
    if (client.tools.length === 0) {
      process.stdout.write("connected; server exposes no tools\n");
      return 0;
    }
    process.stdout.write(`connected; ${client.tools.length} tools:\n`);
    for (const tool of client.tools) {
      process.stdout.write(`- mcp_${tool.name}  ${tool.description ?? ""}\n`);
    }
    return 0;
  } finally {
    await client.close();
  }
}