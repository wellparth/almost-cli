import type { AgentTool, PermissionChecker, PermissionDecision, ToolContext, ToolResult } from "@almost/agent-core";
import { toToolDefinition } from "@almost/agent-core";

/**
 * Wraps a checker so each (permission, detail) decision is resolved once.
 * The loop performs the authoritative permission check before executing a
 * tool; tools re-check internally, and this avoids prompting twice.
 */
export function memoizeDecisions(checker: PermissionChecker): PermissionChecker {
  const cache = new Map<string, PermissionDecision>();
  return {
    async check(permission, detail) {
      const key = `${permission}\u0000${detail ?? ""}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const decision = await checker.check(permission, detail);
      cache.set(key, decision);
      return decision;
    },
  };
}

export interface LoopToolCall {
  id: string;
  name: string;
  input: unknown;
  result: ToolResult;
}

export interface ToolExecutorOptions {
  tools: AgentTool[];
  context: ToolContext;
}

export class ToolExecutor {
  readonly #tools: Map<string, AgentTool>;
  readonly #context: ToolContext;

  constructor(options: ToolExecutorOptions) {
    this.#tools = new Map(options.tools.map((t) => [t.name, t]));
    this.#context = {
      ...options.context,
      permissions: memoizeDecisions(options.context.permissions),
    };
  }

  get definitions() {
    return [...this.#tools.values()].map(toToolDefinition);
  }

  async execute(name: string, id: string, input: unknown): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };
    return await tool.execute(input, this.#context);
  }
}