import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, createBuiltinRegistry } from "./index.js";

describe("provider registry", () => {
  it("registers all four builtin providers", () => {
    const registry = createBuiltinRegistry();
    expect(registry.ids()).toEqual(["openai", "gemini", "deepseek", "nvidia"]);
    expect(BUILTIN_PROVIDERS).toHaveLength(4);
  });

  it("constructs a deepseek provider on demand", () => {
    const registry = createBuiltinRegistry();
    const provider = registry.get("deepseek");
    expect(provider.id).toBe("deepseek");
  });
});