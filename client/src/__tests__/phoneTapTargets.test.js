// The phone sweep measured controls down to 10x15px, and a close button that only appeared on hover.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("every control can be seen and pressed"));

describe("phone controls", () => {
  it("a hover-only close is shown", () => expect(block).toMatch(/page-header-close-btn \{ opacity: 1; \}/));
  it.each(["Remove column", "Move up", "Close", "Clear history"])("%s gets a tap box", (t) => expect(block).toContain(`button[title="${t}"]`));
  it("tick boxes grow, and only on the phone layout", () => {
    expect(block).toMatch(/body\[data-layout="mobile"\] :is\(input\[type="checkbox"\], input\[type="radio"\]\) \{ width: 22px; height: 22px; \}/);
    for (const rule of block.split("}").filter((r) => r.includes("{"))) expect(rule).toMatch(/body\[data-layout="mobile"\]/);
  });
});
