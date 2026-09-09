import { createInterface } from "node:readline";
import type { EventSink } from "@almost/agent-core";
import { runAgentLoop } from "@almost/agent-runtime";
import type { AgentRunResult } from "@almost/agent-runtime";
import type { Runner } from "./runner.js";
import { toAgentMessage } from "./persistence.js";
import type { SessionPersistence } from "./persistence.js";

export interface RunOptions {
  runner: Runner;
  input: string;
  onEvent?: EventSink;
  onToken?: (delta: string, phase: "reasoning" | "output") => void;
  printThinking?: boolean;
}

export async function executeRun(options: RunOptions): Promise<AgentRunResult> {
  const { runner, input, onEvent, onToken, printThinking = true } = options;
  const textSink = onToken ?? ((delta, phase) => {
    if (phase === "reasoning" && printThinking) process.stderr.write(delta);
    if (phase === "output") process.stdout.write(delta);
  });
  return await runAgentLoop({
    provider: runner.provider,
    model: runner.model,
    agentId: runner.agent.id,
    executor: runner.executor,
    system: runner.agent.systemPrompt,
    input,
    onEvent,
    onToken: textSink,
  });
}

export async function persistTurn(
  store: { appendMessage: (sessionId: string, message: import("@almost/agent-core").AgentMessage) => Promise<void> },
  sessionId: string,
  runner: Runner,
  input: string,
  result: AgentRunResult,
): Promise<void> {
  await store.appendMessage(sessionId, toAgentMessage("user", runner.agent.id, input, "QUESTION"));
  if (result.status === "completed") {
    await store.appendMessage(
      sessionId,
      toAgentMessage("agent", runner.agent.id, result.output ?? "", "IMPLEMENTATION_COMPLETE"),
    );
  } else {
    await store.appendMessage(
      sessionId,
      toAgentMessage("agent", runner.agent.id, result.error ?? "failed", "BLOCKED"),
    );
  }
}

export function startRepl(runner: Runner, persistence?: SessionPersistence): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const banner = `myagent — ${runner.agent.name} (${runner.provider.id}/${runner.model})`;
  console.log(banner);
  if (persistence) console.log(`session: ${persistence.sessionId}`);
  console.log("Type Ctrl+C or /quit to exit.");
  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    rl.pause();
    try {
      if (line === "/quit" || line === "/exit") {
        rl.close();
        return;
      }
      if (!line) {
        rl.prompt();
        return;
      }
      process.stdout.write("\n");
      const result = await executeRun({
        runner,
        input: line,
        onEvent: persistence?.sink,
      });
      process.stdout.write("\n");
      if (persistence) await persistTurn(persistence.store, persistence.sessionId, runner, line, result);
      if (result.status === "completed") {
        process.stdout.write(`\n✔ done (${result.iterations} iterations)\n`);
      } else {
        process.stderr.write(`\n✘ ${result.error ?? "failed"}\n`);
      }
    } catch (error) {
      process.stderr.write(`\n✘ ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      rl.resume();
      rl.prompt();
    }
  });

  rl.on("close", () => {
    process.stdout.write("\n");
    void runner.mcp?.closeAll().catch(() => undefined);
    process.exit(0);
  });
}