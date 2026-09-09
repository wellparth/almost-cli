import { describe, expect, it } from "vitest";
import { createNVIDIAProvider } from "./index.js";

describe("nvidia provider", () => {
  it("exposes the nvidia id and capabilities", () => {
    const provider = createNVIDIAProvider();
    expect(provider.id).toBe("nvidia");
    expect(provider.supports("streaming")).toBe(true);
  });
});