// A picture (or any non-text block) as a LEAD fills the band beside the float.
// Measured as text it read 0, the blank-band guard stacked the group, and an
// "image + textblock on one side" wrap never wrapped (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "../docs/WrapGroupNode.jsx"), "utf8");

describe("WrapGroupNode band measurement", () => {
  it("counts a non-text lead's box toward the band and the fill", () => {
    expect(src).toMatch(/if \(!prose && i < textEls\.length - 1\)[\s\S]{0,200}textArea \+= r\.width \* r\.height[\s\S]{0,120}bandBottomReach = Math\.min\(r\.bottom, bottom\)/);
  });
  it("still measures the host as text (control)", () => {
    expect(src).toMatch(/const m = measureProseText\(prose, top, bottom\)/);
  });
});
