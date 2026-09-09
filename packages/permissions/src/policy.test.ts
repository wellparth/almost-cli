import { describe, expect, it } from "vitest";
import { PolicyPermissionChecker } from "./policy.js";
import type { PermissionSet } from "@almost/agent-core";

const writeOnlySet: PermissionSet = {
  filesystem: { read: true, write: true, delete: false },
  shell: { execute: false },
  git: { read: true, write: false },
};

describe("PolicyPermissionChecker", () => {
  it("allows granted permissions", async () => {
    const policy = new PolicyPermissionChecker({ set: writeOnlySet });
    const decision = await policy.check("filesystem.write");
    expect(decision.verdict).toBe("allowed");
  });

  it("denies ungranted permissions", async () => {
    const policy = new PolicyPermissionChecker({ set: writeOnlySet });
    const decision = await policy.check("shell.execute");
    expect(decision.verdict).toBe("denied");
    expect(decision).toMatchObject({ reason: expect.stringContaining("not granted") });
  });

  it("denies filesystem.delete unless granted", async () => {
    const policy = new PolicyPermissionChecker({ set: writeOnlySet });
    const decision = await policy.check("filesystem.delete");
    expect(decision.verdict).toBe("denied");
  });

  it("requires approval for flagged permissions without a handler", async () => {
    const policy = new PolicyPermissionChecker({
      set: writeOnlySet,
      requiresApproval: ["filesystem.write"],
    });
    const decision = await policy.check("filesystem.write");
    expect(decision.verdict).toBe("requires_approval");
  });

  it("routes approval through the handler", async () => {
    const seen: Array<{ permission: string; detail?: string }> = [];
    const policy = new PolicyPermissionChecker({
      set: writeOnlySet,
      requiresApproval: ["filesystem.write"],
      onApprovalRequested: async (permission, detail) => {
        seen.push({ permission, detail });
        return true;
      },
    });
    const decision = await policy.check("filesystem.write", "write README");
    expect(decision.verdict).toBe("allowed");
    expect(seen).toEqual([{ permission: "filesystem.write", detail: "write README" }]);
  });

  it("does not escalate permissions through the handler", async () => {
    const policy = new PolicyPermissionChecker({
      set: writeOnlySet,
      requiresApproval: ["shell.execute"],
      onApprovalRequested: async () => true,
    });
    const decision = await policy.check("shell.execute");
    expect(decision.verdict).toBe("denied");
  });
});