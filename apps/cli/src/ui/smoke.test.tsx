import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import App from "./App.js";
import { PickerPane } from "./PickerPane.js";
import { resolveTheme } from "./themes.js";

describe("ui/App smoke", () => {
  it("renders the TUI to a string without throwing", async () => {
    const output = await renderToString(<App />, {});
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("build");
  });
});

describe("ui/PickerPane", () => {
  it("renders a selection list with a highlighted cursor", async () => {
    const output = await renderToString(
      <PickerPane
        theme={resolveTheme("default")}
        picker={{
          title: "Providers",
          items: [
            { label: "openai  ●", hint: "connected", action: "/connect openai" },
            { label: "gemini", hint: "missing key", action: "/connect gemini" },
          ],
          selected: 0,
        }}
      />,
      {},
    );
    expect(output).toContain("openai");
    expect(output).toContain("gemini");
  });
});