import { describe, expect, it } from "vitest";
import { openStorage, defaultPaths } from "@almost/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerAuthEnvNames, injectCredentials, migrateLegacyCredentials } from "./runner.js";

describe("runner/provider auth", () => {
  it("maps nvidia to NVIDIA_API_KEY", () => {
    expect(providerAuthEnvNames("nvidia")).toEqual(["NVIDIA_API_KEY"]);
  });

  it("migrates legacy NVIDIA_NIM_API_KEY to NVIDIA_API_KEY", async () => {
    process.env.MYAGENT_HOME = await mkdtemp(join(tmpdir(), "myagent-runner-"));
    const state = await openStorage(defaultPaths());
    state.credentials.set("NVIDIA_NIM_API_KEY", "sk-test");
    await state.credentials.save();

    migrateLegacyCredentials(state);
    injectCredentials(state);

    expect(state.credentials.get("NVIDIA_API_KEY")).toBe("sk-test");
    expect(process.env.NVIDIA_API_KEY).toBe("sk-test");
  });
});