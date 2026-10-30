// The filter menu's "Nav" switch did nothing on the container (user, 2026-10-30) → it is "Show" now: it shows or hides
// that filter's value pill on the header. The menu's own nav widget appears for every ACTIVE filter automatically.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");

describe("filter menu", () => {
  const fs = read("ui/FiltersSection.jsx");
  it("has Show switches, no Nav switch", () => {
    expect(fs).not.toMatch(/label="Nav"/);
    expect((fs.match(/label="Show"/g) || []).length).toBe(2);
    expect(fs).toMatch(/filterPills: pills/);
  });
  it("draws a nav widget for every active filter, not only switched-on ones", () => {
    expect(fs).toMatch(/for \(const row of \[\.\.\.ancestorRows, \.\.\.localRows\]\)/);
    expect(fs).not.toMatch(/explicitOn|isActiveDefault/);
  });
});

describe("header pill", () => {
  it("skips a field whose Show is off", () => {
    expect(read("ui/HeaderChevron.jsx")).toMatch(/\.filter\(\(\[fid\]\) => hidden\[fid\] !== false\)/);
  });
});
