// A field's default flow (meta.flow) is settable in the Fields tab — the renderer
// reads it for every new value, 77 seeded fields carry one, and no UI wrote it (2026-10-03).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const tab = fs.readFileSync(path.join(__dirname, "../ui/commandCenter/FieldsTab.jsx"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../ui/FieldRenderer.jsx"), "utf8");
describe("Fields tab default flow", () => {
  it("offers in / out / replace and writes meta.flow", () => {
    expect(tab).toMatch(/aria-label="Default flow"/);
    expect(tab).toMatch(/meta: \{ \.\.\.\(p\.meta \|\| \{\}\), flow: e\.target\.value \}/);
    for (const v of ["in", "out", "replace"]) expect(tab).toContain(`<option value="${v}">`);
  });
  it("is the key the renderer reads (the control)", () => { expect(renderer).toMatch(/field\?\.meta\?\.flow \|\| "in"/); });
});
