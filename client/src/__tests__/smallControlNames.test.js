// The sweep measured the date arrows at 14x30 with the name "Prev", and the picture search box with no name at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the date arrows", () => {
  const src = read("ui/FilterNavWidgets.jsx");
  it("say what they do", () => {
    expect(src).toMatch(/aria-label="Previous date"/);
    expect(src).toMatch(/aria-label="Next date"/);
  });
  it("are at least 24px across, and 32 on a phone", () => {
    const css = read("index.css");
    expect(src.match(/className="date-nav-arrow"/g)).toHaveLength(2);
    expect(css).toMatch(/\.date-nav-arrow \{[^}]*min-width: 24px;[^}]*min-height: 24px;/);
    expect(css).toMatch(/body\[data-layout="mobile"\] \.date-nav-arrow \{ min-width: 32px; min-height: 32px; \}/);
  });
});

describe("the picture search box", () => {
  it("has a name", () => {
    expect(read("ui/ImagePickerMenu.jsx")).toMatch(/aria-label="Search the web for an image"/);
  });
});
