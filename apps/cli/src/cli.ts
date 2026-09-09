import { createBuiltinRegistry } from "@almost/providers";
import { BUILTIN_AGENTS } from "@almost/agents";
import { openStorage, defaultPaths } from "@almost/storage";
import { executeRun, persistTurn, startRepl } from "./repl.js";
import { buildRunner, listModelsFor, resolveModel, resolveProvider } from "./runner.js";
import { openPersistence } from "./persistence.js";
import type { Runner } from "./runner.js";

const HELP = `myagent — BYOK multi-agent coding CLI

Usage: myagent <command> [args]

Commands:
  (no args)                    start interactive REPL
  run "<prompt>"               run a one-shot task
  init                         scaffold ~/.myagent config
  auth list                    list configured credentials (names only)
  auth set <env-var-name>      store a key from an env var for the matching provider
  auth remove <env-var-name>   remove a stored credential
  models [provider]            list available models
  config get <key>             read config (providers: default-provider, default-model, agent)
  config set <key> <value>     write config
  sessions                     list sessions (newest first)
  sessions show <id>           show messages + events for a session
  sessions rm <id>             delete a session
  help                         show this help

Examples:
  myagent config set default-provider openai
  myagent config set default-model gpt-4o
  myagent auth set OPENAI_API_KEY
  myagent run "add a --version flag to the CLI"
`;

export async function cli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (!cmd) {
    return await replCommand();
  }

  if (cmd === "init") {
    return initCommand();
  }

  if (cmd === "auth") return authCommand(rest);

  if (cmd === "models") return modelsCommand(rest);

  if (cmd === "config") return configCommand(rest);

  if (cmd === "sessions") return sessionsCommand(rest);

  if (cmd === "run") {
    const input = argv.slice(1).join(" ").trim();
    if (!input) throw new Error("usage: myagent run \"<prompt>\"");
    return await runOnce(input, undefined);
  }

  throw new Error(`unknown command '${cmd}' (run: myagent help)`);
}

async function initCommand(): Promise<number> {
  const state = await openStorage();
  const registry = createBuiltinRegistry();
  if (!state.config.get("defaultProvider")) {
    state.config.set("defaultProvider", "openai");
    await state.config.save();
  }
  process.stdout.write(`initialized ~/.myagent (config: ${state.paths.configFile})\n`);
  process.stdout.write(`providers: ${registry.ids().join(", ")}\n`);
  process.stdout.write(`agents: ${BUILTIN_AGENTS.map((a) => a.id).join(", ")}\n`);
  return 0;
}

async function authCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const state = await openStorage();

  if (sub === "list") {
    const names = state.credentials.keys().sort();
    if (names.length === 0) {
      process.stdout.write("no stored credentials\n");
      return 0;
    }
    process.stdout.write("stored credentials:\n");
    for (const name of names) process.stdout.write(`- ${name}\n`);
    return 0;
  }

  if (sub === "set") {
    const name = rest[0];
    if (!name) throw new Error("usage: myagent auth set <env-var-name>");
    const value = process.env[name];
    if (!value) {
      throw new Error(`no value in environment variable ${name}; export it first`);
    }
    state.credentials.set(name, value);
    await state.credentials.save();
    process.stdout.write(`stored credential ${name} (${state.paths.credentialsFile})\n`);
    return 0;
  }

  if (sub === "remove") {
    const name = rest[0];
    if (!name) throw new Error("usage: myagent auth remove <env-var-name>");
    for (const key of state.credentials.keys()) {
      if (key === name) state.credentials.set(key, "");
    }
    await state.credentials.save();
    process.stdout.write(`removed credential ${name}\n`);
    return 0;
  }

  throw new Error("usage: myagent auth <list|set|remove>");
}

async function modelsCommand(args: string[]): Promise<number> {
  const state = await openStorage();
  const [providerId] = args;
  const provider = resolveProvider(state, providerId);
  const models = await listModelsFor(state, providerId);
  process.stdout.write(`${provider.id} models:\n`);
  for (const m of models) process.stdout.write(`- ${m}\n`);
  if (models.length === 0) process.stdout.write("  (model listing not available for this provider)\n");
  return 0;
}

async function configCommand(args: string[]): Promise<number> {
  const [sub, key, value] = args;
  const state = await openStorage();
  const KEYS = ["default-provider", "default-model", "agent"] as const;
  const KEY_MAP: Record<(typeof KEYS)[number], "defaultProvider" | "defaultModel" | "agent"> = {
    "default-provider": "defaultProvider",
    "default-model": "defaultModel",
    agent: "agent",
  };

  if (sub === "get") {
    if (!key) throw new Error("usage: myagent config get <key>");
    const internal = KEY_MAP[key as keyof typeof KEY_MAP];
    if (!internal) throw new Error(`unknown config key '${key}' (available: ${KEYS.join(", ")})`);
    const valueText = (state.config as unknown as { all(): Record<string, string> }).all()[internal];
    process.stdout.write(`${valueText ?? "(unset)"}\n`);
    return 0;
  }

  if (sub === "set") {
    if (!key || value === undefined) throw new Error("usage: myagent config set <key> <value>");
    const internal = KEY_MAP[key as keyof typeof KEY_MAP];
    if (!internal) throw new Error(`unknown config key '${key}' (available: ${KEYS.join(", ")})`);
    if (key === "default-provider") {
      const registry = createBuiltinRegistry();
      if (!registry.has(value)) throw new Error(`unknown provider '${value}' (available: ${registry.ids().join(", ")})`);
    }
    if (key === "agent") {
      if (!BUILTIN_AGENTS.some((a) => a.id === value)) {
        throw new Error(`unknown agent '${value}' (available: ${BUILTIN_AGENTS.map((a) => a.id).join(", ")})`);
      }
    }
    state.config.set(internal, value);
    await state.config.save();
    process.stdout.write(`config: ${key} = ${value}\n`);
    return 0;
  }

  throw new Error("usage: myagent config <get|set>");
}

async function sessionsCommand(args: string[]): Promise<number> {
  const [sub, id] = args;
  const state = await openStorage();

  if (!sub || sub === "list") {
    const list = await state.sessions.list();
    if (list.length === 0) {
      process.stdout.write("no sessions\n");
      return 0;
    }
    for (const meta of list) {
      const ts = new Date(meta.updatedAt).toISOString();
      process.stdout.write(`${meta.id}  ${meta.cwd ?? ""}  (${ts})\n`);
    }
    return 0;
  }

  if (sub === "show") {
    if (!id) throw new Error("usage: myagent sessions show <id>");
    const session = await state.sessions.load(id);
    if (!session) throw new Error(`no session '${id}'`);
    process.stdout.write(`session ${session.metadata.id}\n`);
    for (const ev of session.events) {
      process.stdout.write(`  [event] ${ev.type}\n  ${JSON.stringify(ev).slice(0, 300)}\n`);
    }
    for (const msg of session.messages) {
      const text = (msg.payload as { text?: unknown })?.text ?? "";
      process.stdout.write(`  [${msg.from}] ${String(text).slice(0, 400)}\n`);
    }
    return 0;
  }

  if (sub === "rm") {
    if (!id) throw new Error("usage: myagent sessions rm <id>");
    await state.sessions.remove(id);
    process.stdout.write(`removed session ${id}\n`);
    return 0;
  }

  throw new Error("usage: myagent sessions <list|show|rm>");
}

async function runOnce(input: string, providerId?: string): Promise<number> {
  const state = await openStorage(defaultPaths());
  const runner = await runnerOf(state, providerId);
  const persistence = await openPersistence(state.paths.sessionsDir, runner.agent.id);
  process.stdout.write(`agent: ${runner.agent.id} | ${runner.provider.id}/${runner.model}\n`);
  process.stdout.write(`session: ${persistence.sessionId}\n`);
  process.stdout.write("\n");
  const result = await executeRun({ runner, input, onEvent: persistence.sink });
  process.stdout.write("\n");
  await persistTurn(persistence.store, persistence.sessionId, runner, input, result);
  if (result.status === "completed") {
    process.stdout.write(`\n✔ done (${result.iterations} iterations)\n`);
    if (process.env.MYAGENT_VISIBLE_REASONING === "1" && result.reasoning) {
      process.stdout.write(`\n— reasoning —\n${result.reasoning}\n`);
    }
    return 0;
  }
  process.stderr.write(`\n✘ ${result.error ?? "failed"}\n`);
  return 1;
}

async function replCommand(): Promise<number> {
  const state = await openStorage(defaultPaths());
  const runner = await runnerOf(state);
  const persistence = await openPersistence(state.paths.sessionsDir, runner.agent.id);
  startRepl(runner, persistence);
  return 0;
}

async function runnerOf(state: import("@almost/storage").AppState, providerId?: string): Promise<Runner> {
  const provider = resolveProvider(state, providerId);
  const model = await resolveModel(state);
  return buildRunner({ state, providerId, model });
}