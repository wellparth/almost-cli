import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@almost/agent-core";
import { ConfigStore } from "./config-store.js";
import { CredentialStore } from "./credential-store.js";
import { DiskSessionStore } from "./session-store.js";
import type { StoragePaths } from "./fs.js";

let root: string;
let paths: StoragePaths;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "almost-storage-"));
  paths = {
    root,
    configFile: join(root, "config.json"),
    credentialsFile: join(root, "credentials.json"),
    sessionsDir: join(root, "sessions"),
  };
});

describe("DiskSessionStore", () => {
  function makeMessage(id: string): AgentMessage {
    return { id, from: "me", to: "agent", type: "QUESTION", payload: { text: "hi" }, timestamp: Date.now() };
  }

  it("persists a session across instances", async () => {
    const store = new DiskSessionStore(paths.sessionsDir);
    const created = await store.create({ modelProvider: "openai", model: "gpt-4o", cwd: root });
    expect(created.metadata.id).toMatch(/^session-/);

    const message = makeMessage("m1");
    await store.appendMessage(created.metadata.id, message);

    const reload = new DiskSessionStore(paths.sessionsDir);
    const loaded = await reload.load(created.metadata.id);
    expect(loaded?.metadata.modelProvider).toBe("openai");
    expect(loaded?.messages).toEqual([message]);
    expect(loaded?.events).toEqual([]);
  });

  it("lists sessions newest-updated first", async () => {
    const store = new DiskSessionStore(paths.sessionsDir);
    const a = await store.create({ cwd: root });
    const b = await store.create({ cwd: root });
    await store.appendMessage(a.metadata.id, makeMessage("m"));
    const list = await store.list();
    expect(list[0]?.id).toEqual(a.metadata.id);
    expect(list[1]?.id).toEqual(b.metadata.id);
  });

  it("rejects traversal session ids", async () => {
    const store = new DiskSessionStore(paths.sessionsDir);
    await expect(store.appendMessage("../x", makeMessage("m"))).rejects.toThrow("invalid session id");
  });

  it("serializes concurrent appends without corrupting the log", async () => {
    const store = new DiskSessionStore(paths.sessionsDir);
    const session = await store.create({ cwd: root });
    const batches = 10;
    for (let b = 0; b < batches; b++) {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.appendMessage(session.metadata.id, makeMessage(`m-${b}-${i}`)),
        ),
      );
    }
    const loaded = await store.load(session.metadata.id);
    expect(loaded?.messages.length).toBe(batches * 20);
  });
});

describe("ConfigStore", () => {
  it("reads and writes config", async () => {
    const store = await ConfigStore.open(paths);
    store.set("defaultProvider", "openai");
    await store.save();

    const again = await ConfigStore.open(paths);
    expect(again.get("defaultProvider")).toBe("openai");
  });
});

describe("CredentialStore", () => {
  it("round-trips creds without exposing values and writes 0600", async () => {
    const store = await CredentialStore.open(paths);
    store.set("OPENAI_API_KEY", "sk-secret");
    await store.save();

    const raw = await readFile(paths.credentialsFile, "utf8");
    if (process.platform !== "win32") {
      const stat = await import("node:fs/promises").then((m) => m.stat(paths.credentialsFile));
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(raw).toContain("OPENAI_API_KEY");
    expect(raw).toContain("sk-secret");

    const again = await CredentialStore.open(paths);
    expect(again.get("OPENAI_API_KEY")).toBe("sk-secret");
  });

  it("resolve falls back to process env", async () => {
    const store = await CredentialStore.open(paths);
    process.env.MYAGENT_TEST_KEY = "from-env";
    try {
      expect(store.resolve("MYAGENT_TEST_KEY")).toBe("from-env");
    } finally {
      delete process.env.MYAGENT_TEST_KEY;
    }
  });
});