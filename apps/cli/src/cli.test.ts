import { describe, expect, it } from "vitest";
import { cli } from "./cli.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cli", () => {
  it("prints help", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-cli-"));
    const code = await cli(["help"]);
    expect(code).toBe(0);
  });

  it("config set/get round-trips", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-cli-"));
    let code = await cli(["config", "set", "default-model", "gpt-4o"]);
    expect(code).toBe(0);
    code = await cli(["config", "get", "default-model"]);
    expect(code).toBe(0);
  });

  it("rejects unknown providers in config", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-cli-"));
    await expect(cli(["config", "set", "default-provider", "not-real"])).rejects.toThrow(/unknown provider/);
  });

  it("init scaffolds config", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-cli-"));
    const code = await cli(["init"]);
    expect(code).toBe(0);
  });

  it("auth set requires an env var", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-cli-"));
    await expect(cli(["auth", "set", "OPENAI_API_KEY"])).rejects.toThrow(/no value in environment/);
  });
});