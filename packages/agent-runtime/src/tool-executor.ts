import type { AgentTool, Permission, PermissionChecker, PermissionDecision, ToolContext, ToolResult } from "@almost/agent-core";
import { toToolDefinition } from "@almost/agent-core";

/**
 * Wraps a checker so each permission is decided once per run. Permission
 * decisions are session-scoped: denying or approving "filesystem.write"
 * applies to the whole run, so tool-side re-checks hit the same cache as the
 * loop's own check and users are never prompted twice for one action.
 */
export function memoizeDecisions(checker: PermissionChecker): PermissionChecker {
  const cache = new Map<Permission, PermissionDecision>();
  return {
    async check(permission, _detail) {
      const cached = cache.get(permission);
      if (cached) return cached;
      const decision = await checker.check(permission);
      cache.set(permission, decision);
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
  readonly permissions: PermissionChecker;

  constructor(options: ToolExecutorOptions) {
    this.#tools = new Map(options.tools.map((t) => [t.name, t]));
    this.#context = {
      ...options.context,
      permissions: memoizeDecisions(options.context.permissions),
    };
    this.permissions = this.#context.permissions;
  }

  get definitions() {
    return [...this.#tools.values()].map(toToolDefinition);
  }

  /** The tools this executor was built with. */
  get tools(): AgentTool[] {
    return [...this.#tools.values()];
  }

  /**
   * A clone bound to a different workspace root (e.g. a per-task git
   * worktree). Permission decisions are shared with the original executor so
   * approvals/denials stay consistent across cases.
   */
  scoped(workspaceRoot: string, cwd?: string): ToolExecutor {
    return new ToolExecutor({
      tools: this.tools,
      context: {
        ...this.#context,
        workspaceRoot,
        cwd: cwd ?? workspaceRoot,
      },
    });
  }

  /**
   * Primary permission required by a tool. Unknown tools register as
   * `undefined` so the loop fails closed instead of guessing permissions.
   */
  permissionFor(name: string): Permission | undefined {
    return this.#tools.get(name)?.permissions[0];
  }

  async execute(name: string, id: string, input: unknown): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };
    return await tool.execute(input, this.#context);
  }
}