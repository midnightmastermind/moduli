// "+ Item" adds to the placement the user clicked — never to "the first
// occurrence of this module". Copy-linked containers (every day column's slots
// are copy-links of the Schedule template's) share ONE module, so the old
// lookup by module id put the new instance into the template's slot
// (2026-09-29: 6 of 6 adds from today's 3:00pm landed in the template).
// App.addInstanceToContainer needs the whole store, so the wiring is pinned
// from source, with controls that the code under guard still exists.
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const body = (src, start, len = 3500) => src.slice(src.indexOf(start), src.indexOf(start) + len);

describe("adding an instance targets the clicked placement", () => {
  test("ModuleContainer hands App the PLACEMENT's id, not the module's", () => {
    const src = read("modules/ModuleContainer.jsx");
    const line = src.split("\n").find((l) => /const onAdd = useCallback/.test(l));
    expect(line).toBeTruthy(); // control: the adder still exists
    expect(line).toMatch(/addInstanceToContainer\(containerOccurrence\?\.id/);
    expect(line).not.toMatch(/addInstanceToContainer\(module\.id/);
    // AND it must come AFTER `containerOccurrence` is declared: reading a
    // const in a render-time deps array before its declaration is a TDZ
    // ReferenceError that takes down EVERY container (shipped 2026-09-29 for
    // ~5 minutes; no test mounts ModuleContainer, so only this ordering pin
    // can see it).
    expect(src.indexOf("const containerOccurrence = ")).toBeGreaterThan(0);
    expect(src.indexOf("const onAdd = useCallback")).toBeGreaterThan(src.indexOf("const containerOccurrence = "));
  });

  test("App resolves the placement by its own id and never by module id", () => {
    const fn = body(read("App.jsx"), "const addInstanceToContainer = useCallback(");
    expect(fn).toMatch(/LayoutHelpers\.createInstanceInContainer/); // control
    expect(fn).toMatch(/o\.id === containerOccurrenceId/);
    expect(fn).not.toMatch(/o\.moduleId === containerId/);
  });
});
