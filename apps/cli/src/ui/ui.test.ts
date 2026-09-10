import { describe, expect, it } from "vitest";
import { newMessage } from "./state.js";
import { resolveLeaderAction } from "./keybinds.js";
import { DEFAULT_TUI_CONFIG } from "./config.js";
import { fileRefToken, suggestFiles } from "./files.js";
import { runSlashCommand, isSlashCommand, isAppCommand, commandName, COMMAND_HELP } from "./commands.js";
import { openStorage, defaultPaths } from "@almost/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ui/state", () => {
  it("creates unique messages with roles", () => {
    const a = newMessage("user", "hello");
    const b = newMessage("agent", "hi");
    expect(a.id).not.toBe(b.id);
    expect(a.role).toBe("user");
    expect(b.role).toBe("agent");
    expect(a.streaming).toBe(false);
  });
});

describe("ui/keybinds", () => {
  it("resolves leader shortcuts", () => {
    expect(resolveLeaderAction(DEFAULT_TUI_CONFIG, "h")).toBe("help");
    expect(resolveLeaderAction(DEFAULT_TUI_CONFIG, "q")).toBe("exit");
    expect(resolveLeaderAction(DEFAULT_TUI_CONFIG, "exit")).toBe("exit");
  });

  it("returns undefined for unknown shortcuts", () => {
    expect(resolveLeaderAction(DEFAULT_TUI_CONFIG, "z")).toBeUndefined();
  });
});

describe("ui/files", () => {
  it("extracts file ref token after @", () => {
    expect(fileRefToken("look at @src/")).toBe("src/");
    expect(fileRefToken("no refs here")).toBeUndefined();
    expect(fileRefToken("email me@example.com")).toBeUndefined();
  });

  it("suggests existing files from the repo", async () => {
    const matches = await suggestFiles("package", 3);
    expect(Array.isArray(matches)).toBe(true);
  });
});

describe("ui/commands", () => {
  it("detects slash commands", () => {
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("hello")).toBe(false);
    expect(isAppCommand("/new")).toBe(true);
    expect(isAppCommand("/agents")).toBe(false);
    expect(commandName("/config set default-model gpt-4o")).toBe("/config");
  });

  it("exposes documented command list", () => {
    expect(COMMAND_HELP["/help"]).toBeTruthy();
    expect(Object.keys(COMMAND_HELP).length).toBeGreaterThan(5);
  });

  it("runs /agents, /models, /config and /auth against temp storage", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-ui-"));
    const state = await openStorage(defaultPaths());

    const agents = await runSlashCommand("/agents", state);
    expect(agents.lines.length).toBeGreaterThan(0);

    const config = await runSlashCommand("/config set default-model gpt-5", state);
    expect(config.lines.join(" ")).toContain("gpt-5");

    const auth = await runSlashCommand("/auth", state);
    expect(auth.lines.join(" ")).toBe("no stored credentials");

    const unknown = await runSlashCommand("/nope", state);
    expect(unknown.title).toBe("Unknown command");
  });
});