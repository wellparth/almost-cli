import { describe, expect, it } from "vitest";
import { newMessage } from "./state.js";
import { resolveLeaderAction } from "./keybinds.js";
import { DEFAULT_TUI_CONFIG } from "./config.js";
import { fileRefToken, suggestFiles } from "./files.js";
import { runSlashCommand, isSlashCommand, isAppCommand, commandName, COMMAND_HELP } from "./commands.js";
import { openStorage, defaultPaths } from "@almost/storage";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter, listSkills } from "./skills.js";

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

  it("/connect lists providers and sets default-provider", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-ui-"));
    const state = await openStorage(defaultPaths());

    const list = await runSlashCommand("/connect", state);
    expect(list.title).toBe("Providers");
    expect(list.lines.join("\n")).toContain("openai");

    const set = await runSlashCommand("/connect openai", state);
    expect(state.config.get("defaultProvider")).toBe("openai");
    expect(set.lines.join(" ")).toContain("no API key found");

    await expect(runSlashCommand("/connect not-real", state)).resolves.toMatchObject({
      title: "Connect",
    });
  });

  it("provides interactive pickers for no-arg list commands", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-ui-"));
    const state = await openStorage(defaultPaths());

    const agents = await runSlashCommand("/agents", state);
    expect(agents.picker?.length).toBeGreaterThan(0);
    expect(agents.picker?.[0]?.action).toMatch(/^\/config set agent /);

    const models = await runSlashCommand("/models", state);
    expect(models.picker).toBeUndefined();
    expect(models.lines.join(" ")).toContain("no provider configured");

    const connect = await runSlashCommand("/connect", state);
    expect(connect.picker?.some((i) => i.label.startsWith("openai"))).toBe(true);

    const sessions = await runSlashCommand("/sessions", state);
    expect(sessions.lines.join(" ")).toBe("no sessions");

    const skillDir = await mkdtemp(join(tmpdir(), "myagent-skills-"));
    await mkdir(join(skillDir, "banner-design"), { recursive: true });
    await writeFile(join(skillDir, "banner-design", "SKILL.md"), "---\nname: banner-design\ndescription: Make banners.\n---\n");
    process.env.MYAGENT_SKILLS_DIR = skillDir;
    const skills = await runSlashCommand("/skill", {} as never);
    expect(skills.picker?.some((i) => i.label === "banner-design")).toBe(true);

    const detail = await runSlashCommand("/skill banner-design", {} as never);
    expect(detail.lines.join("\n")).toContain("Make banners.");
  });

  it("/sessions returns a picker when sessions exist", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-ui-"));
    const state = await openStorage(defaultPaths());
    await state.sessions.create({ cwd: "/tmp" });

    const sessions = await runSlashCommand("/sessions", state);
    expect(sessions.picker?.length).toBe(1);
    expect(sessions.picker?.[0]?.action).toMatch(/^\/sessions show session-/);
  });
});

describe("ui/skills", () => {
  it("parses SKILL.md frontmatter", () => {
    const raw = "---\nname: foo\n description:  Bar baz\n---\n# Content\n";
    expect(parseSkillFrontmatter(raw, "fallback")).toEqual({ name: "foo", description: "Bar baz" });
    expect(parseSkillFrontmatter("no frontmatter", "fallback").name).toBeUndefined();
  });
});