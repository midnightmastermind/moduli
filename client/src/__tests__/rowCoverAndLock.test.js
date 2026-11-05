// A row's radial changes its cover (user, 2026-11-05), and a doc's lock is not left under a lead picture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("a row's cover", () => {
  const src = read("modules/ModuleInstance.jsx");
  it("is offered on the radial for rows, not only artifacts", () => {
    expect(src).toMatch(/\["artifact", "instance"\]\.includes\(instance\?\.role\)/);
  });
  it("is what the row shows, ahead of its media field", () => {
    expect(src).toMatch(/const rowCover = instance\?\.role === "instance" \? occurrence\?\.meta\?\.cover/);
    expect(src).toMatch(/const mediaSrc = rowCover \|\| primaryMedia\?\.src/);
    expect(src).toMatch(/const showMedia = !renderBody\s+&& \(!!mediaBinding \|\| !!filesFieldIdFor\(instance\) \|\| !!rowCover\)/);
  });
});

describe("the lock", () => {
  it("sits above a floated lead picture", () => {
    expect(read("modules/DocContent.jsx")).toMatch(/position: "absolute", top: 4, right: 4, zIndex: 30/);
  });
});

describe("pick lists name themselves", () => {
  const f = read("ui/Field.jsx");
  it("the option list is a listbox, its search boxes and + are named", () => {
    expect(f).toMatch(/role="listbox"/);
    expect(f).toMatch(/aria-label=\{searchPlaceholder\}/);
    expect(f).toMatch(/aria-label="Search or add"/);
    expect(f).toMatch(/aria-label="Add this option"/);
  });
});
