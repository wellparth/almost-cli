import { describe, expect, it } from "vitest";
import { createDeepSeekProvider } from "./index.js";

describe("deepseek provider", () => {
  it("exposes the deepseek id and capabilities", () => {
    const provider = createDeepSeekProvider();
    expect(provider.id).toBe("deepseek");
    expect(provider.supports("reasoning")).toBe(true);
  });
});