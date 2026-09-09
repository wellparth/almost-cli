import { afterEach, describe, expect, it } from "vitest";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpClient, toAgentTool } from "./client.js";
import { McpManager } from "./manager.js";
import { loadMcpConfig, saveMcpConfig, emptyMcpConfig } from "./config.js";
import type { AgentTool } from "@almost/agent-core";
import { promises as fs } from "node:fs";
import os from "node:os";

const SERVER = fileURLToPath(new URL("../test/fixtures/mcp-test-server.mjs", import.meta.url));
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function connectClient(): Promise<McpClient> {
  const client = new McpClient({ serverId: "test", command: process.execPath, args: [SERVER] });
  await client.connect();
  return client;
}

describe("McpClient", () => {
  it("handshakes and discovers tools", async () => {
    const client = await connectClient();
    try {
      expect(client.isConnected).toBe(true);
      const names = client.tools.map((t) => t.name);
      expect(names).toContain("echo");
      expect(names).toContain("boom");
      expect(names).toContain("die");
    } finally {
      await client.close();
    }
  });

  it("calls a tool and returns text output", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool("echo", { text: "hello mcp" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toContain("echo: hello mcp");
    } finally {
      await client.close();
    }
  });

  it("surfaces server-provided tool errors", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool("boom", {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("boom failed");
    } finally {
      await client.close();
    }
  });

  it("rejects unknown tools", async () => {
    const client = await connectClient();
    try {
      await expect(client.callTool("nope", {})).rejects.toThrow(/mcp error/);
    } finally {
      await client.close();
    }
  });

  it("fails requests once the server process exits", async () => {
    const client = await connectClient();
    await expect(client.callTool("die", {})).rejects.toThrow(/exited/);
  });

  it("adapts MCP tools into permission-gated AgentTools", async () => {
    const client = await connectClient();
    try {
      const tools = client.tools.map((t) => toAgentTool(client, t));
      const tool = tools.find((t) => t.name === "mcp_echo") as AgentTool;
      expect(tool.permissions).toEqual(["mcp"]);
      const result = await tool.execute({ text: "x" }, { workspaceRoot: "", cwd: "", env: {}, permissions: { check: async () => ({ verdict: "allowed" }) } });
      expect(result.ok).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("McpManager", () => {
  it("connects servers and aggregates tools", async () => {
    const manager = new McpManager({ servers: [{ name: "test", command: process.execPath, args: [SERVER] }] });
    await manager.connectAll();
    try {
      expect(manager.servers).toEqual(["test"]);
      expect(manager.toolCount).toBe(3);
      expect(manager.agentTools.map((t) => t.name)).toContain("mcp_echo");
      const result = await manager.callServerTool("test", "echo", { text: "hi" });
      if (result.ok) expect(result.output).toContain("echo: hi");
    } finally {
      await manager.closeAll();
    }
  });

  it("skips servers that fail to connect", async () => {
    const manager = new McpManager({
      servers: [
        { name: "bad", command: process.execPath, args: ["/does/not/exist.mjs"] },
        { name: "test", command: process.execPath, args: [SERVER] },
      ],
    });
    const logs: string[] = [];
    const managerWithLog = new McpManager(
      { servers: [{ name: "bad", command: process.execPath, args: ["/does/not/exist.mjs"] }] },
      { onLog: (_, line) => void logs.push(line) },
    );
    await manager.connectAll();
    await managerWithLog.connectAll();
    try {
      expect(manager.servers).toEqual(["test"]);
      expect(managerWithLog.servers).toEqual([]);
      expect(logs.some((line) => line.includes("failed to connect"))).toBe(true);
    } finally {
      await manager.closeAll();
      await managerWithLog.closeAll();
    }
  });
});

describe("Mcp config", () => {
  it("round-trips server config through mcp.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almost-mcp-"));
    tmpDirs.push(dir);
    await saveMcpConfig(dir, {
      servers: [{ name: "test", command: process.execPath, args: ["a.mjs"], env: { A: "1" } }],
    });
    const loaded = await loadMcpConfig(dir);
    expect(loaded.servers).toMatchObject([{ name: "test", command: process.execPath, args: ["a.mjs"], env: { A: "1" } }]);
  });

  it("returns an empty config when the file is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almost-mcp-"));
    tmpDirs.push(dir);
    expect(await loadMcpConfig(dir)).toEqual(emptyMcpConfig());
  });

  it("filters invalid server entries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almost-mcp-"));
    tmpDirs.push(dir);
    await saveMcpConfig(dir, { servers: [{ name: "", command: "x" }, { name: "ok", command: "node" }] } as never);
    const loaded = await loadMcpConfig(dir);
    expect(loaded.servers).toEqual([{ name: "ok", command: "node" }]);
  });
});