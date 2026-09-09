export interface TaskSpec {
  id: string;
  agentId: string;
  input: string;
  dependencies: string[];
  options?: { model?: string; providerId?: string };
}

export type TaskOutcomeStatus = "completed" | "failed" | "cancelled";

export interface TaskOutcome {
  id: string;
  status: TaskOutcomeStatus;
  output?: string;
  error?: string;
  iterations?: number;
}

export class TaskGraph {
  readonly #tasks = new Map<string, TaskSpec>();

  addTask(spec: TaskSpec): this {
    if (this.#tasks.has(spec.id)) throw new Error(`duplicate task id '${spec.id}'`);
    this.#tasks.set(spec.id, spec);
    return this;
  }

  get(id: string): TaskSpec | undefined {
    return this.#tasks.get(id);
  }

  all(): TaskSpec[] {
    return Array.from(this.#tasks.values());
  }

  size(): number {
    return this.#tasks.size;
  }

  /** Returns true unless a dependency is missing or a cycle exists. */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const task of this.#tasks.values()) {
      for (const dep of task.dependencies) {
        if (!this.#tasks.has(dep)) {
          errors.push(`task '${task.id}' depends on missing task '${dep}'`);
        }
      }
    }
    const cycle = this.#findCycle();
    if (cycle) errors.push(`dependency cycle detected: ${cycle.join(" -> ")}`);
    return { valid: errors.length === 0, errors };
  }

  /** Tasks whose dependencies are all complete and that have not been launched or cancelled. */
  readyTasks(launched: Set<string>, cancelled: Set<string>): TaskSpec[] {
    const ready: TaskSpec[] = [];
    for (const task of this.#tasks.values()) {
      if (launched.has(task.id)) continue;
      if (cancelled.has(task.id)) continue;
      const blocked = task.dependencies.some(
        (dep) => !launched.has(dep) && !cancelled.has(dep),
      );
      if (!blocked) ready.push(task);
    }
    return ready;
  }

  /** All tasks that (transitively) depend on `id`. */
  descendants(id: string): Set<string> {
    const depends = new Map<string, string[]>();
    for (const task of this.#tasks.values()) {
      for (const dep of task.dependencies) {
        const list = depends.get(dep) ?? [];
        list.push(task.id);
        depends.set(dep, list);
      }
    }
    const found = new Set<string>();
    const stack = [...(depends.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || found.has(next)) continue;
      found.add(next);
      stack.push(...(depends.get(next) ?? []));
    }
    return found;
  }

  #findCycle(): string[] | undefined {
    const VISITING = 1;
    const DONE = 2;
    const state = new Map<string, number>();
    const stack: string[] = [];

    const dfs = (id: string): string[] | undefined => {
      if (state.get(id) === DONE) return undefined;
      if (state.get(id) === VISITING) {
        const cut = stack.indexOf(id);
        return [...stack.slice(cut), id];
      }
      state.set(id, VISITING);
      stack.push(id);
      for (const dep of this.#tasks.get(id)?.dependencies ?? []) {
        if (!this.#tasks.has(dep)) continue;
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
      stack.pop();
      state.set(id, DONE);
      return undefined;
    };

    for (const id of this.#tasks.keys()) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
    return undefined;
  }
}