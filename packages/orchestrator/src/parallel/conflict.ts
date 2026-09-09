/**
 * Conflict detection between parallel tasks. Each task reports the files it
 * touched (relative paths, from a common base revision). A conflict is any
 * file touched by more than one task; distinct files never conflict.
 */

export type ChangeKind = "added" | "modified" | "deleted";

export interface FileChange {
  file: string;
  kind: ChangeKind;
}

export interface TaskChangeSet {
  task: string;
  changes: FileChange[];
}

export interface FileConflict {
  file: string;
  tasks: string[];
}

export interface ConflictReport {
  conflicts: FileConflict[];
  touched: string[];
}

/** Files present in more than one task's change set. */
export function detectConflicts(sets: TaskChangeSet[]): ConflictReport {
  const byFile = new Map<string, { tasks: string[]; kinds: Set<ChangeKind> }>();
  for (const set of sets) {
    for (const change of set.changes) {
      const entry = byFile.get(change.file) ?? { tasks: [], kinds: new Set<ChangeKind>() };
      if (!entry.tasks.includes(set.task)) entry.tasks.push(set.task);
      entry.kinds.add(change.kind);
      byFile.set(change.file, entry);
    }
  }
  const conflicts: FileConflict[] = [];
  const touched: string[] = [];
  for (const [file, entry] of byFile) {
    touched.push(file);
    if (entry.tasks.length > 1) {
      conflicts.push({ file, tasks: entry.tasks });
    }
  }
  return { conflicts, touched };
}

/** Whether the change sets are disjoint across tasks. */
export function hasConflicts(sets: TaskChangeSet[]): boolean {
  return detectConflicts(sets).conflicts.length > 0;
}