import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "./index.js";

describe("gemini provider", () => {
  it("exposes the gemini id and capabilities", () => {
    const provider = createGeminiProvider();
    expect(provider.id).toBe("gemini");
    expect(provider.supports("vision")).toBe(true);
    expect(provider.supports("tool_calling")).toBe(true);
  });
});