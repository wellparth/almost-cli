import { TaskGraph } from "./task-graph.js";
import type { TaskOutcome, TaskSpec } from "./task-graph.js";

export interface SchedulerOptions {
  runTask: (task: TaskSpec) => Promise<TaskOutcome>;
  concurrency?: number;
  onProgress?: (outcomes: Map<string, TaskOutcome>) => void;
}

export interface ScheduledRun {
  outcomes: Map<string, TaskOutcome>;
  ranTasks: number;
}

/**
 * Runs a task graph respecting dependencies, with bounded concurrency.
 * A failed task cancels (skips) all of its descendants.
 */
export async function runGraph(
  graph: TaskGraph,
  options: SchedulerOptions,
): Promise<ScheduledRun> {
  const { runTask, concurrency = 1, onProgress } = options;
  const validation = graph.validate();
  if (!validation.valid) {
    throw new Error(`invalid task graph: ${validation.errors.join("; ")}`);
  }

  const outcomes = new Map<string, TaskOutcome>();
  const cancelled = new Set<string>();
  let ran = 0;

  const launched = () => new Set(outcomes.keys());

  const cancelDescendants = (id: string) => {
    for (const dep of graph.descendants(id)) {
      if (!outcomes.has(dep)) cancelled.add(dep);
    }
  };

  const total = graph.size();
  while (launched().size + cancelled.size < total) {
    const ready = graph.readyTasks(launched(), cancelled);
    if (ready.length === 0) {
      // Every remaining task is cancelled or blocked by a cancelled task.
      // Avoid spinning.
      break;
    }

    const batch = ready.slice(0, Math.max(1, concurrency));
    const results = await Promise.all(
      batch.map(async (task) => ({ task, outcome: await runTask(task) })),
    );
    for (const { task, outcome } of results) {
      ran++;
      outcomes.set(task.id, outcome);
      outcome.status === "failed" && cancelDescendants(task.id);
    }
    onProgress?.(outcomes);
  }

  for (const id of cancelled) {
    if (!outcomes.has(id)) outcomes.set(id, { id, status: "cancelled" });
  }

  return { outcomes, ranTasks: ran };
}