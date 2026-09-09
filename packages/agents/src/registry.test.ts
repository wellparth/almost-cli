import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRegistry, BUILTIN_AGENTS, CODING_AGENT, validateSerialized } from "./index.js";

const tmpDirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almost-agents-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function serialized(overrides: Partial<import("./index.js").SerializedAgent> = {}) {
  return {
    id: "tester",
    name: "Tester",
    systemPrompt: "You verify code.",
    tools: ["read_file", "grep"],
    permissionDefaults: {
      filesystem: { read: true, write: true, delete: false },
      shell: { execute: false },
      git: { read: true, write: false },
    },
    defaultModelHint: "gpt-4o",
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  it("lists built-in agents alongside loaded user agents", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    await registry.create(serialized());
    const ids = await registry.listIds();
    expect(ids).toContain("coding");
    expect(ids).toContain("tester");
  });

  it("resolves user agent tool names to real tool implementations", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    const agent = await registry.create(serialized({ tools: ["read_file", "grep"] }));
    expect(agent.tools[0]?.name).toBe("read_file");
  });

  it("get() prefers user agents and falls back to built-ins", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    await registry.create(serialized());
    expect(await registry.get("tester")).toBeDefined();
    expect((await registry.get("coding")).id).toBe("coding");
    await expect(registry.get("ghost")).rejects.toThrow(/unknown agent 'ghost'/);
  });

  it("persists agents to disk and reloads them", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    await registry.create(serialized());
    const reloaded = new AgentRegistry({ agentsDir: dir });
    expect(await reloaded.has("tester")).toBe(true);
  });

  it("removes user agents but refuses to remove built-ins", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    await registry.create(serialized());
    await registry.remove("tester");
    expect(await registry.has("tester")).toBe(false);
    await expect(registry.remove("coding")).rejects.toThrow(/cannot remove built-in/);
  });

  it("skips malformed agent files without failing the registry", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "broken-agent.json"), "not json");
    await fs.writeFile(path.join(dir, "invalid-agent.json"), JSON.stringify(serialized({ tools: ["nope"] })));
    const registry = new AgentRegistry({ agentsDir: dir });
    const ids = await registry.listIds();
    expect(ids).toEqual(BUILTIN_AGENTS.map((a) => a.id));
  });

  it("rejects invalid definitions on create", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    await expect(registry.create(serialized({ id: "../evil" }))).rejects.toThrow(/invalid agent/);
    await expect(registry.create(serialized({ tools: ["unknown_tool"] }))).rejects.toThrow(/unknown tool/);
  });

  it("validates tool names against the built-in registry", () => {
    expect(validateSerialized(serialized({ tools: ["read_file"] }))).toEqual([]);
    expect(validateSerialized(serialized({ tools: ["not_a_tool"] }))[0]).toMatch(/unknown tool/);
  });
});

describe("custom agent defaults", () => {
  it("starts from sensible permissions (no accidental escalation)", async () => {
    const dir = await tmpDir();
    const registry = new AgentRegistry({ agentsDir: dir });
    const agent = await registry.create(serialized());
    expect(agent.permissionDefaults.filesystem.delete).toBe(false);
    expect(agent.permissionDefaults.shell.execute).toBe(false);
    expect(agent.permissionDefaults.git.write).toBe(false);
  });

  it("shares the coding agent's tool surface by default", async () => {
    expect(CODING_AGENT.tools.length).toBeGreaterThanOrEqual(12);
  });
});