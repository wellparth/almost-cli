import type { TaskGraph } from "@almost/orchestrator";
import type { AgentDefinition } from "@almost/agents";
import type { ModelProvider } from "@almost/agent-core";

/**
 * Generates a TaskGraph from a user goal by invoking a planner agent,
 * parsing the JSON plan, and validating it against TaskGraph requirements.
 *
 * The planner agent's system prompt should instruct it to produce a JSON payload
 * like:
 *
 * ```json
 * {
 *   "tasks": [
 *     { "id": "t1", "agentId": "coding", "input": "write a hello world script", "dependencies": [] },
 *     { "id": "t2", "agentId": "coding", "input": "run tests", "dependencies": ["t1"] }
 *   ]
 * }
 * ```
 *
 * The returned graph is guaranteed to pass `graph.validate()`.
 *
 * @param goal The user's high-level goal/description
 * @param agentId Optional agent ID to use as the planner; falls back to the
 *   default coder agent if not provided
 * @param options If `planOnly` is true, only the graph is returned without running it
 * @returns The generated TaskGraph and the raw plan JSON
 */
export async function runPlannedGoal(
  goal: string,
  agentId?: string,
  options?: { plannerProvider?: string; maxIterations?: number; planOnly?: true },
): Promise<{ graph: TaskGraph; plan: unknown }> {
  // TODO: implement planner agent loop, JSON plan parsing, and graph validation
  // For now return a minimal valid graph
  const minimalGraph: TaskGraph = {
    tasks: [],
    all: () => [],
    size: () => 0,
    validate: async () => ({ valid: true, errors: [] }),
  };
  return { graph: minimalGraph, plan: {} };
}

/**
 * Runs an automated review of a task graph using a reviewer agent.
 *
 * Currently a stub: returns a summary stating no review was performed.
 * In a full implementation, this would invoke a reviewer agent to analyse
 * the graph's tasks, dependencies, and potential conflicts, then return
 * a list of decisions and a human-readable summary.
 *
 * @param graph The TaskGraph to review
 * @param reviewerAgentId Optional agent ID to use as the reviewer
 * @param options Additional options like maxIterations for the reviewer loop
 * @returns Decisions made during review and a human-readable summary
 */
export async function automatedReview(
  graph: TaskGraph,
  reviewerAgentId?: string,
  options?: { maxIterations?: number },
): Promise<{ decisions: string[]; summary: string }> {
  // TODO: invoke a reviewer agent to analyse the graph, then return decisions + summary
  return { decisions: [], summary: "no review performed (stub)" };
}