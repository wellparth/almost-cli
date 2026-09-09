import type { AgentTool, PermissionDecision, ToolResult } from "@almost/agent-core";

export function denied(decision: PermissionDecision): ToolResult {
  if (decision.verdict === "denied") return { ok: false, error: decision.reason };
  if (decision.verdict === "requires_approval") {
    return { ok: false, error: "denied: requires approval" };
  }
  return { ok: false, error: "denied" };
}

export class WorkspaceEscapeError extends Error {
  override readonly name = "WorkspaceEscapeError";
}

export function wrapTool(tool: AgentTool): AgentTool {
  return {
    ...tool,
    async execute(input, context) {
      try {
        return await tool.execute(input, context);
      } catch (error) {
        if (error instanceof WorkspaceEscapeError) {
          return { ok: false, error: error.message };
        }
        return { ok: false, error: String(error) };
      }
    },
  };
}