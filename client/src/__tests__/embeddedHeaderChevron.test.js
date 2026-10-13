// A container embedded in a doc (a day-page section, a graph on a day page, an imported
// article section) had NO way into its own header menu — Filter · Sort · Data · Fields ·
// Layout. The HeaderChevron was added to the STANDARD header only (e1bae5e8); the embedded
// header kept an empty slot where its old inline filter nav used to be. So an embedded
// graph's feed, or an embedded section's field visibility, could not be edited at all.
//
// Mounting ModuleContainer needs the whole grid store, so the wiring is asserted at the
// source, with a control that the standard header still has its own.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleContainer.jsx"), "utf8");
const embStart = src.indexOf("{embedded ? (");
const embEnd = src.indexOf("/* Standard single-row layout */");
const embeddedBranch = src.slice(embStart, embEnd);
const standardBranch = src.slice(embEnd, src.indexOf("{items.length > 0 && (", embEnd));

describe("embedded container header", () => {
  it("finds both header branches (control)", () => {
    expect(embStart).toBeGreaterThan(0);
    expect(embEnd).toBeGreaterThan(embStart);
    expect(standardBranch).toMatch(/<HeaderChevron/);
  });
  it("renders the HeaderChevron that opens the container's own menu", () => {
    expect(embeddedBranch).toMatch(/<HeaderChevron[\s\S]*?onClick=\{openDropdown\}/);
  });
  it("marks the slot so it can reveal on hover instead of sitting on every section header", () => {
    expect(embeddedBranch).toMatch(/className="embedded-header-menu/);
    const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/\.embedded-container-header:hover \.embedded-header-menu/);
  });
});
