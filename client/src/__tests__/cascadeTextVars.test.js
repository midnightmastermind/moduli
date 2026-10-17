// The styling cascade's text colour / font / size reach text that sets its own, and beat a skin that
// paints every element (Terminal) — user 2026-10-17. A derived ink is not a choice and sets no var.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { styleToCSS } from "../helpers/StyleHelpers";

describe("cascade text vars", () => {
  it("a chosen colour, font and size each travel as a custom property", () => {
    const css = styleToCSS({ textColor: "#ff0000", fontFamily: "Georgia, serif", fontSize: "20px" });
    expect(css["--cascade-ink"]).toBe("#ff0000");
    expect(css["--cascade-font"]).toBe("Georgia, serif");
    expect(css["--cascade-font-size"]).toBe("20px");
  });
  it("nothing chosen sets nothing, and a derived ink is not a choice", () => {
    const css = styleToCSS({ bg: "#ffffff" });
    expect(css["--cascade-ink"]).toBeUndefined();
    expect(css["--cascade-font"]).toBeUndefined();
    expect(css["--cascade-font-size"]).toBeUndefined();
  });
  it("terminal paints green and mono only where the cascade chose nothing; prose takes the cascade size", () => {
    const src = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");
    expect(src).toMatch(/color: var\(--cascade-ink, var\(--term-green\)\) !important/);
    expect(src).toMatch(/font-family: var\(--cascade-font, var\(--font-mono\)\) !important/);
    expect(src).toMatch(/font-family: var\(--cascade-font, var\(--font-display\)\) !important/);
    expect(src).toMatch(/font-size: var\(--cascade-font-size, var\(--instance-label-px, 17px\)\)/);
    expect(src).toMatch(/font-size-adjust: 0\.48/);
    expect(src).toMatch(/\.container-header \* \{ font-size-adjust: 0\.66; \}/);
  });
});
