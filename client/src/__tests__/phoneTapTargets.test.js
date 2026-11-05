// The phone sweep measured controls down to 10x15px, and a close button that only appeared on hover.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("every control can be seen and pressed"));

describe("phone controls", () => {
  it("a hover-only close is shown", () => expect(block).toMatch(/page-header-close-btn \{ opacity: 1; \}/));
  it.each(["Remove column", "Move up", "Close", "Clear history"])("%s gets a tap box", (t) => expect(block).toContain(`button[title="${t}"]`));
  it("a bare dot button is not stretched into an oval", () => expect(block).toMatch(/button:not\(\[role="switch"\]\):not\(:empty\)/));
  it("tick boxes grow, and only on the phone layout", () => {
    expect(block).toMatch(/body\[data-layout="mobile"\] :is\(input\[type="checkbox"\], input\[type="radio"\]\) \{ width: 22px; height: 22px; \}/);
    for (const rule of block.split("}").filter((r) => r.includes("{"))) expect(rule).toMatch(/body\[data-layout="mobile"\]/);
  });
});

describe("a row's corner buttons on a phone", () => {
  const src = readFileSync(new URL("../modules/ModuleInstance.jsx", import.meta.url), "utf8");
  it("step by their own width, so + does not cover Show notes", () => {
    expect(css).toMatch(/--row-btn-step: 32px/);
    expect(src).toMatch(/var\(--row-btn-step, 20px\)/);
  });
  it("keep no invisible tap area past their box", () => {
    expect(css).not.toMatch(/\.instance-field-add-btn[^{]*\)::after/);
  });
});
