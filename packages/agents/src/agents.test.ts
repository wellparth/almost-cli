import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS, CODING_AGENT, getAgent } from "./index.js";

describe("built-in agents", () => {
  it("ships a coding agent with tools and permissions", () => {
    expect(CODING_AGENT.id).toBe("coding");
    expect(CODING_AGENT.tools.length).toBeGreaterThan(10);
    expect(CODING_AGENT.permissionDefaults.filesystem.read).toBe(true);
    expect(CODING_AGENT.permissionDefaults.filesystem.delete).toBe(false);
    expect(CODING_AGENT.permissionDefaults.shell.execute).toBe(false);
    expect(CODING_AGENT.permissionDefaults.git.write).toBe(false);
  });

  it("looks agents up by id", () => {
    expect(getAgent("coding")).toBe(CODING_AGENT);
    expect(() => getAgent("nope")).toThrow(/unknown agent/);
  });

  it("covers phase 4 registry surface", () => {
    expect(BUILTIN_AGENTS.map((a) => a.id)).toContain("coding");
  });
});