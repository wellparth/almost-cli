import { describe, expect, it } from "vitest";
import { LockRegistry } from "./resource-lock.js";
import { detectConflicts, hasConflicts } from "./conflict.js";
import type { TaskChangeSet } from "./conflict.js";

describe("LockRegistry", () => {
  it("serializes access for the same key", async () => {
    const locks = new LockRegistry();
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      await locks.withLock("repo", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    };
    await Promise.all([work(), work(), work(), work()]);
    expect(maxActive).toBe(1);
  });

  it("lets different keys run in parallel", async () => {
    const locks = new LockRegistry();
    let active = 0;
    let maxActive = 0;
    const work = async (key: string) => {
      await locks.withLock(key, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    };
    await Promise.all([work("a"), work("b"), work("c")]);
    expect(maxActive).toBe(3);
  });

  it("releases the lock when the body throws", async () => {
    const locks = new LockRegistry();
    await expect(
      locks.withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let entered = false;
    await locks.withLock("k", async () => {
      entered = true;
    });
    expect(entered).toBe(true);
  });

  it("hands the lock to queued waiters in FIFO order", async () => {
    const locks = new LockRegistry();
    const order: string[] = [];
    await Promise.all(
      ["first", "second", "third"].map((name) =>
        locks.withLock("gate", async () => {
          order.push(name);
          await new Promise((r) => setTimeout(r, 2));
        }),
      ),
    );
    expect(order).toEqual(["first", "second", "third"]);
  });
});

describe("ConflictDetector", () => {
  it("reports no conflicts for disjoint files", () => {
    const report = detectConflicts([
      { task: "a", changes: [{ file: "src/a.ts", kind: "modified" }] },
      { task: "b", changes: [{ file: "src/b.ts", kind: "added" }] },
    ]);
    expect(report.conflicts).toEqual([]);
    expect(report.touched).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("detects the same file edited by two tasks", () => {
    const report = detectConflicts([
      { task: "a", changes: [{ file: "src/shared.ts", kind: "modified" }] },
      { task: "b", changes: [{ file: "src/shared.ts", kind: "modified" }] },
      { task: "c", changes: [{ file: "src/other.ts", kind: "added" }] },
    ]);
    expect(report.conflicts).toEqual([{ file: "src/shared.ts", tasks: ["a", "b"] }]);
  });

  it("detects a delete competing with any other change on the same file", () => {
    const report = detectConflicts([
      { task: "a", changes: [{ file: "x.txt", kind: "deleted" }] },
      { task: "b", changes: [{ file: "x.txt", kind: "modified" }] },
    ]);
    expect(report.conflicts).toHaveLength(1);
  });

  it("documents paths are matched verbatim (no normalization)", () => {
    const report = detectConflicts([
      { task: "a", changes: [{ file: "./src/a.ts", kind: "modified" }] },
      { task: "b", changes: [{ file: "src/a.ts", kind: "modified" }] },
    ]);
    expect(report.conflicts).toHaveLength(0);
  });

  it("flags conflicts via the hasConflicts convenience check", () => {
    const sets: TaskChangeSet[] = [
      { task: "a", changes: [{ file: "src/shared.ts", kind: "modified" }] },
      { task: "b", changes: [{ file: "src/shared.ts", kind: "deleted" }] },
    ];
    expect(hasConflicts(sets)).toBe(true);
    expect(hasConflicts([sets[0]!])).toBe(false);
  });
});