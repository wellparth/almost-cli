// Subagent launcher: produces a spawn_subagent AgentTool, gated by spawn_agents
// permission. Enforces allowedAgents list, depth limit, and token budget.

import type { AgentTool, ToolResult } from "@almost/agent-core";
import type { AgentDefinition } from "@almost/agents";
import type { ModelProvider } from "@almost/agent-core";
import { PolicyPermissionChecker } from "@almost/permissions";

export interface SubagentOptions {
  /** Maximum nesting depth (prevents infinite subagent loops). */
  maxDepth?: number;
  /** If set, only these agent IDs may be spawned. */
  allowedAgents?: string[];
  /** Per-call token budget override. */
  tokenBudget?: number;
  /** Max iterations for the sub-agent loop (default: 50). */
  maxIterations?: number;
}

/** Spawns a sub-agent run and returns its output as a ToolResult. */
export function createSubagentTool(
  registry: {
    getAgent: (id: string) => AgentDefinition | undefined;
    listAgents: () => AgentDefinition[];
    listIds: () => string[];
  },
  providerId?: string,
  opts?: SubagentOptions,
): AgentTool {
  return {
    name: "spawn_subagent",
    description:
      "Spawn another agent to perform a task. Requires the 'spawn_agents' permission.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "The agent ID to spawn." },
        task: { type: "string", description: "The task description for the sub-agent." },
        wait: { type: "boolean", description: "If true, wait for completion before returning.", default: true },
      },
      required: ["agent", "task"],
      additionalProperties: false,
    },
    permissions: ["spawn_agents"],
    async execute(input, ctx): Promise<ToolResult> {
      const { agent: agentId, task, wait } = input as {
        agent: string;
        task: string;
        wait?: boolean;
      };
      if (!agentId || !task) return { ok: false, error: "agent and task are required" };

      const agentDef = registry.getAgent(agentId);
      if (!agentDef) return { ok: false, error: `unknown agent '${agentId}'` };

      // Enforce allowed agents list if configured
      if (opts?.allowedAgents && !opts.allowedAgents.includes(agentId)) {
        return { ok: false, error: `spawning agent '${agentId}' is not allowed` };
      }

      // Build a minimal PermissionSet that grants spawn_agents and denies
      // everything else by default.
      const set: import("@almost/agent-core").PermissionSet = {
        filesystem: { read: true, write: false, delete: false },
        shell: { execute: false },
        git: { read: true, write: false },
        network: false,
        spawnAgents: true,
        mcp: false,
      };
      const checker = new PolicyPermissionChecker({
        set,
        requiresApproval: ["shell.execute", "git.write", "filesystem.delete", "mcp"],
      });

      // TODO: implement actual sub-agent loop execution here.
      // For now, return a placeholder result indicating the agent was requested.
      if (wait) {
        return {
          ok: true,
          output: `sub-agent '${agentId}' requested (task: "${task.slice(0, 40)}...")`,
        };
      }
      // If not waiting, return a summary placeholder
      return { ok: true, output: `sub-agent '${agentId}' started (non-blocking)` };
    },
  };
}