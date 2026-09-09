import type {
  EventSink,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  PermissionChecker,
  StopReason,
  ToolCall,
  Usage,
} from "@almost/agent-core";
import type { Message } from "@almost/agent-core";
import type { ToolExecutor } from "./tool-executor.js";

export interface AgentLoopOptions {
  provider: ModelProvider;
  model: string;
  agentId: string;
  executor: ToolExecutor;
  permissions: PermissionChecker;
  system?: string;
  input: string;
  maxIterations?: number;
  onEvent?: EventSink;
  onToken?: (delta: string, phase: "reasoning" | "output") => void;
}

export interface AgentRunResult {
  status: "completed" | "failed";
  output?: string;
  reasoning?: string;
  error?: string;
  usage?: Usage;
  stopReason?: StopReason;
  iterations: number;
  messages: Message[];
}

const DEFAULT_MAX_ITERATIONS = 50;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const {
    provider,
    model,
    agentId,
    executor,
    permissions,
    system,
    input,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    onEvent,
    onToken,
  } = options;

  const messages: Message[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: input });

  let totalUsage: Usage | undefined;
  let finalStopReason: StopReason | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const request: ModelRequest = {
      model,
      system,
      messages,
      tools: executor.definitions,
    };

    let text = "";
    let reasoning = "";
    let stopReason: StopReason | undefined;
    let error: string | undefined;
    const toolCalls = new Map<string, ToolCall>();

    for await (const event of streamFrom(provider, request)) {
      switch (event.type) {
        case "TEXT_DELTA":
          text += event.content;
          onToken?.(event.content, "output");
          break;
        case "REASONING_DELTA":
          reasoning += event.content;
          onToken?.(event.content, "reasoning");
          break;
        case "TOOL_CALL":
          toolCalls.set(event.id, { id: event.id, name: event.name, input: event.input });
          break;
        case "USAGE":
          totalUsage = event.usage;
          break;
        case "FINISH":
          stopReason = event.stopReason;
          finalStopReason = event.stopReason;
          break;
        case "ERROR":
          error = event.message;
          break;
      }
    }

    if (error) {
      await onEvent?.({ type: "AgentFailed", sessionId: "", agentId, error, timestamp: Date.now() });
      return { status: "failed", error, iterations: iteration + 1, messages, usage: totalUsage };
    }

    messages.push({ role: "assistant", content: text, toolCalls: [...toolCalls.values()] });

    if (stopReason !== "tool_calls" && toolCalls.size === 0) {
      await onEvent?.({ type: "AgentCompleted", sessionId: "", agentId, timestamp: Date.now() });
      return {
        status: "completed",
        output: text,
        reasoning,
        iterations: iteration + 1,
        messages,
        usage: totalUsage,
        stopReason: finalStopReason,
      };
    }

    for (const [id, call] of toolCalls) {
      await onEvent?.({
        type: "ToolRequested",
        sessionId: "",
        agentId,
        tool: call.name,
        input: call.input,
        timestamp: Date.now(),
      });
      const decision = await permissions.check(
        mapPermission(call.name),
        JSON.stringify(call.input).slice(0, 500),
      );
      await onEvent?.({
        type: "PermissionRequested",
        sessionId: "",
        agentId,
        permission: mapPermission(call.name),
        timestamp: Date.now(),
      });
      if (decision.verdict !== "allowed") {
        const reason = decision.verdict === "denied" ? decision.reason : "requires approval";
        messages.push({ role: "tool", toolCallId: id, content: `denied: ${reason}` });
        await onEvent?.({
          type: "ToolExecuted",
          sessionId: "",
          agentId,
          tool: call.name,
          ok: false,
          timestamp: Date.now(),
        });
        continue;
      }
      const result = await executor.execute(call.name, id, call.input);
      const output = result.ok ? result.output : `error: ${result.error}`;
      messages.push({ role: "tool", toolCallId: id, content: output });
      await onEvent?.({
        type: "ToolExecuted",
        sessionId: "",
        agentId,
        tool: call.name,
        ok: result.ok,
        timestamp: Date.now(),
      });
    }
  }

  await onEvent?.({ type: "AgentFailed", sessionId: "", agentId, error: "max iterations exceeded", timestamp: Date.now() });
  return {
    status: "failed",
    error: `max iterations (${maxIterations}) exceeded`,
    iterations: maxIterations,
    messages,
    usage: totalUsage,
    stopReason: finalStopReason,
  };
}

async function* streamFrom(
  provider: ModelProvider,
  request: ModelRequest,
): AsyncIterable<ModelEvent> {
  yield* provider.generate(request);
}

const PERMISSION_BY_TOOL: Record<string, import("@almost/agent-core").Permission> = {
  read_file: "filesystem.read",
  write_file: "filesystem.write",
  edit_file: "filesystem.write",
  delete_file: "filesystem.delete",
  list_directory: "filesystem.read",
  search_files: "filesystem.read",
  grep: "filesystem.read",
  shell: "shell.execute",
  git_status: "git.read",
  git_diff: "git.read",
  git_log: "git.read",
  git_branch: "git.read",
};

function mapPermission(toolName: string): import("@almost/agent-core").Permission {
  return PERMISSION_BY_TOOL[toolName] ?? "shell.execute";
}