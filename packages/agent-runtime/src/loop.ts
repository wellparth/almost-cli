import type {
  EventSink,
  ModelProvider,
  ModelRequest,
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
const MAX_TOOL_OUTPUT = 64 * 1024;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const {
    provider,
    model,
    agentId,
    executor,
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

    try {
      for await (const event of provider.generate(request)) {
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
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : String(streamError);
      await onEvent?.({ type: "AgentFailed", sessionId: "", agentId, error: message, timestamp: Date.now() });
      return { status: "failed", error: message, iterations: iteration + 1, messages, usage: totalUsage };
    }

    if (error) {
      await onEvent?.({ type: "AgentFailed", sessionId: "", agentId, error, timestamp: Date.now() });
      return { status: "failed", error, iterations: iteration + 1, messages, usage: totalUsage };
    }

    messages.push({ role: "assistant", content: text, toolCalls: [...toolCalls.values()] });

    if (stopReason === "length" && toolCalls.size === 0) {
      await onEvent?.({ type: "AgentFailed", sessionId: "", agentId, error: "output truncated (length)", timestamp: Date.now() });
      return {
        status: "failed",
        error: "provider output truncated (stop reason: length)",
        iterations: iteration + 1,
        messages,
        usage: totalUsage,
        stopReason: finalStopReason,
      };
    }

    if (toolCalls.size === 0) {
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
      const permission = executor.permissionFor(call.name);
      if (!permission) {
        messages.push({ role: "tool", toolCallId: id, content: `denied: unknown tool "${call.name}"` });
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
      const decision = await executor.permissions.check(permission);
      await onEvent?.({
        type: "PermissionRequested",
        sessionId: "",
        agentId,
        permission,
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
      messages.push({
        role: "tool",
        toolCallId: id,
        content:
          output.length > MAX_TOOL_OUTPUT
            ? `${output.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated ${output.length - MAX_TOOL_OUTPUT} chars]`
            : output,
      });
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