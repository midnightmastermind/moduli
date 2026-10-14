// A scheduled op may also carry event triggers (user, 2026-10-14). poms' "Schedule:
// Mark Passed Slots" runs every 5 minutes AND On Load — the On Load run scrolls to
// the current slot — and the editor hid triggers whenever a schedule was set, so a
// grid built by clicking could never get that. Source guards: OperationsTab needs
// the whole command-center context to mount.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("operations editor — schedule plus triggers", () => {
  it("the Triggers section is not gated on the schedule", () => {
    expect(code).not.toMatch(/!local\.schedule\s*&&\s*\(\s*<div>\s*<span style=\{labelStyle\}>Triggers/);
  });
  it("converting to a scheduled op keeps the triggers", () => {
    const i = code.indexOf("Convert to scheduled op");
    const block = code.slice(Math.max(0, i - 900), i);
    expect(block).toMatch(/schedule:\s*\{\s*kind:\s*"interval"/);           // control: it is the convert handler
    expect(block).not.toMatch(/triggerObjects:\s*\[\]/);
  });
  it("the Triggers section still exists (control)", () => {
    expect(code).toMatch(/<span style=\{labelStyle\}>Triggers<\/span>/);
  });
});
