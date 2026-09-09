import path from "node:path";
import type { AgentDefinition } from "@almost/agents";
import { AgentRegistry } from "@almost/agents";
import type { PermissionSet } from "@almost/agent-core";
import type { AppState } from "@almost/storage";

function registryFor(state: AppState): AgentRegistry {
  return new AgentRegistry({ agentsDir: path.join(state.paths.root, "agents") });
}

export async function agentCommand(args: string[], state: AppState): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "list") {
    return listAgents(state);
  }
  if (sub === "show") {
    const id = rest[0];
    if (!id) throw new Error("usage: myagent agent show <id>");
    const agent = await registryFor(state).get(id);
    printAgent(agent);
    return 0;
  }
  if (sub === "create") {
    return createAgent(rest, state);
  }
  if (sub === "remove") {
    const id = rest[0];
    if (!id) throw new Error("usage: myagent agent remove <id>");
    await registryFor(state).remove(id);
    process.stdout.write(`removed agent ${id}\n`);
    return 0;
  }
  throw new Error(`unknown agent subcommand '${sub}' (available: list, show, create, remove)`);
}

async function listAgents(state: AppState): Promise<number> {
  const registry = registryFor(state);
  const agents = await registry.listAgents();
  if (agents.length === 0) {
    process.stdout.write("no agents\n");
    return 0;
  }
  process.stdout.write("agents:\n");
  for (const agent of agents) {
    const tools = agent.tools.map((t) => t.name).join(", ");
    const model = agent.defaultModelHint ?? "(default model)";
    process.stdout.write(`- ${agent.id}  ${agent.name}  [${model}]  tools: ${tools}\n`);
  }
  process.stdout.write(`available tools: ${registry.toolNames.join(", ")}\n`);
  return 0;
}

function printAgent(agent: AgentDefinition): void {
  const tools = agent.tools.map((t) => t.name);
  process.stdout.write(`id: ${agent.id}\n`);
  process.stdout.write(`name: ${agent.name}\n`);
  process.stdout.write(`model: ${agent.defaultModelHint ?? "(default model)"}\n`);
  process.stdout.write(`tools: ${tools.join(", ")}\n`);
  process.stdout.write(`permissions:\n`);
  process.stdout.write(`  filesystem: ${JSON.stringify(agent.permissionDefaults.filesystem)}\n`);
  process.stdout.write(`  shell: ${JSON.stringify(agent.permissionDefaults.shell)}\n`);
  process.stdout.write(`  git: ${JSON.stringify(agent.permissionDefaults.git)}\n`);
  process.stdout.write(`systemPrompt:\n${agent.systemPrompt}\n`);
}

const CREATE_HELP = `usage: myagent agent create <id> [options]

Options:
  --name <name>           human-readable name (default: <id>)
  --prompt <text>         system prompt for the agent
  --tools <a,b,c>         tools to expose (default: all built-in tools)
  --model <model-id>      default model hint
  --allow-shell           allow shell.execute (default: false)
  --allow-delete          allow filesystem.delete (default: false)
  --allow-git-write       allow git.write (default: false)
  --allow-network         allow network access (default: false)
  --allow-mcp             allow mcp (default: false)
  --allow-spawn           allow spawning agents (default: false)`;

async function createAgent(args: string[], state: AppState): Promise<number> {
  const id = args[0];
  if (!id) throw new Error(CREATE_HELP);

  const readFlag = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(name);

  const name = readFlag("--name") ?? id;
  const prompt = readFlag("--prompt");
  const toolsArg = readFlag("--tools");
  const model = readFlag("--model");

  const tools: string[] =
    toolsArg !== undefined
      ? toolsArg.split(",").map((t) => t.trim()).filter(Boolean)
      : (await registryFor(state).toolNames);

  const permissionDefaults: PermissionSet = {
    filesystem: { read: true, write: true, delete: hasFlag("--allow-delete") },
    shell: { execute: hasFlag("--allow-shell") },
    git: { read: true, write: hasFlag("--allow-git-write") },
    network: hasFlag("--allow-network"),
    mcp: hasFlag("--allow-mcp"),
    spawnAgents: hasFlag("--allow-spawn"),
  };

  if (!prompt) throw new Error("--prompt <text> is required");
  const registry = registryFor(state);
  const agent = await registry.create({
    id,
    name,
    systemPrompt: prompt,
    tools,
    permissionDefaults,
    defaultModelHint: model,
  });
  process.stdout.write(`created agent ${agent.id} (${name})\n`);
  printAgent(agent);
  return 0;
}