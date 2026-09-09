import { describe, expect, it } from "vitest";
import { createOpenAIProvider } from "./index.js";

describe("openai provider", () => {
  it("exposes the openai id and capabilities", () => {
    const provider = createOpenAIProvider();
    expect(provider.id).toBe("openai");
    expect(provider.supports("tool_calling")).toBe(true);
    expect(provider.supports("vision")).toBe(false);
  });
});