// Renaming an artifact through Settings › Label wrote only the module label, while the card shows
// `meta.originalName` first — so the rename visibly did nothing. renameLeaf moves the shown name too.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renameLeaf } from "../helpers/CommitHelpers.js";

const run = (module, label) => { const out = []; renameLeaf({ dispatch: (a) => out.push(a), socket: null, module, label }); return out.map((a) => a.payload?.module || a.payload || a.module || a).filter(Boolean); };

describe("renameLeaf", () => {
  it("an artifact's displayed name follows the rename, the rest of meta kept", () => {
    const [m] = run({ id: "a", role: "artifact", label: "dummy.pdf", meta: { external: true, originalName: "dummy.pdf" } }, "W3C dummy.pdf");
    expect(m).toMatchObject({ id: "a", label: "W3C dummy.pdf", meta: { external: true, originalName: "W3C dummy.pdf" } });
  });
  it("control: an instance gets only its label (no meta written)", () => {
    const [m] = run({ id: "i", role: "instance", label: "Old", meta: { x: 1 } }, "New");
    expect(m).toEqual({ id: "i", label: "New" });
  });
  it("control: an artifact with no originalName keeps its meta untouched", () => {
    const [m] = run({ id: "b", role: "artifact", kind: "bookmark", label: "x.org", meta: { external: true } }, "X");
    expect(m).toEqual({ id: "b", label: "X" });
  });
  it("the row's Settings and inline renames go through it", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleInstance.jsx"), "utf8");
    expect(src.match(/CommitHelpers\.renameLeaf\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
