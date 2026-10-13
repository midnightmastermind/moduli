import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { revealNewRow } from "../helpers/revealNewRow.js";

const now = (fn) => fn();

describe("revealNewRow", () => {
  it("jumps to a new row that did not mount (past a long list's window)", () => {
    const jump = vi.fn();
    revealNewRow("occ-new", { find: () => null, jump, schedule: now });
    expect(jump).toHaveBeenCalledWith("occ-new");
  });
  it("leaves a row already on screen alone (control)", () => {
    const jump = vi.fn();
    revealNewRow("occ-new", { find: () => ({}), jump, schedule: now });
    expect(jump).not.toHaveBeenCalled();
  });
  it("does nothing without an id", () => {
    const jump = vi.fn();
    revealNewRow(null, { find: () => null, jump, schedule: now });
    expect(jump).not.toHaveBeenCalled();
  });
  it("createInstanceInContainer returns the new occurrence, and both add paths reveal it", () => {
    const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
    expect(read("../helpers/LayoutHelpers.js")).toMatch(/return \{ instance, occurrence \}/);
    expect(read("../App.jsx")).toMatch(/revealNewRow\(/);
    expect(read("../ui/InsertGap.jsx")).toMatch(/revealNewRow\(/);
  });
});
