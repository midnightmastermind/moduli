// The mobile layout is decided in JS (useMobileDetect) and styled in CSS
// (index.css RESPONSIVE block). If the two numbers differ, the band between them
// gets the desktop layout with mobile styling, or the reverse.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOBILE_BREAKPOINT } from "../hooks/useMobileDetect";

describe("mobile breakpoint", () => {
  it("index.css's RESPONSIVE block uses the same width as useMobileDetect", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const i = css.indexOf("15. RESPONSIVE");
    expect(i).toBeGreaterThan(-1);
    const m = /@media \(max-width: (\d+)px\)/.exec(css.slice(i));
    expect(Number(m[1])).toBe(MOBILE_BREAKPOINT);
  });
});
