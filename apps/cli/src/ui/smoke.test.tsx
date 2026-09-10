import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import App from "./App.js";

describe("ui/App smoke", () => {
  it("renders the TUI to a string without throwing", async () => {
    const output = await renderToString(<App />, {});
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("build");
  });
});