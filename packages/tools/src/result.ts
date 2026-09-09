import type { PermissionDecision, ToolResult } from "@almost/agent-core";

export function denied(decision: PermissionDecision): ToolResult {
  if (decision.verdict === "denied") return { ok: false, error: decision.reason };
  if (decision.verdict === "requires_approval") {
    return { ok: false, error: "denied: requires approval" };
  }
  return { ok: false, error: "denied" };
}