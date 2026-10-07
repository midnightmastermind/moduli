// A mini textblock (inline chip) a doc OWNS goes when the doc stops drawing it.
// Before 2026-10-07 removing a chip — its radial "Remove", Backspace, or typing
// over a selection holding it — only removed the NODE; the row stayed, parented
// to the textblock and embedded nowhere (two found on the rebuild grid).
import { describe, it, expect } from "vitest";
import { inlineChipIds, orphanedOwnedChips } from "../helpers/chipLifecycle";

const chip = (id) => ({ type: "instanceTextblockInline", attrs: { occurrenceId: id } });
const doc = (...inline) => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });
const text = (t) => ({ type: "text", text: t });
const mods = { mChip: { id: "mChip", role: "textblock", kind: "inline" }, mInst: { id: "mInst", role: "instance" } };

describe("inlineChipIds", () => {
  it("finds chips at any depth, nothing else", () => {
    const tm = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [chip("a")] }] }] }, { type: "moduleEmbed", attrs: { occurrenceId: "e" } }] };
    expect([...inlineChipIds(tm)]).toEqual(["a"]);
    expect(inlineChipIds("H4sI…compressed").size).toBe(0);
  });
});

describe("orphanedOwnedChips", () => {
  const base = () => ({
    host: { id: "host", textmap: doc(text("x")) },
    a: { id: "a", parentId: "host", moduleId: "mChip" },
  });
  it("a chip the host owns, dropped from its text and embedded nowhere else, is orphaned", () => {
    const occ = base();
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(text("x")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual(["a"]);
  });
  it("CONTROL: a chip still in the host's text is kept", () => {
    const occ = base();
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(chip("a")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual([]);
  });
  it("a chip pasted into ANOTHER doc is kept (cut from here, pasted there)", () => {
    const occ = { ...base(), other: { id: "other", textmap: doc(chip("a")) } };
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(text("x")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual([]);
  });
  it("a chip placed from elsewhere (another parent) is only unlinked, never deleted", () => {
    const occ = { ...base(), a: { id: "a", parentId: "someone-else", moduleId: "mChip" } };
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(text("x")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual([]);
  });
  it("only textblocks: a non-textblock row the host happens to parent is not touched", () => {
    const occ = { ...base(), a: { id: "a", parentId: "host", moduleId: "mInst" } };
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(text("x")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual([]);
  });
  it("an id no longer in the store is skipped", () => {
    const occ = { host: base().host };
    expect(orphanedOwnedChips({ prevTextmap: doc(chip("a")), nextTextmap: doc(text("x")), hostId: "host", occurrencesById: occ, modulesById: mods })).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";
describe("wiring", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
  it("the editor's save hands dropped chips to the rule, inside the save's gesture", () => {
    const ed = read("../ui/Editor.jsx");
    const i = ed.indexOf("const doSave = () => {");
    expect(i).toBeGreaterThan(0);                                  // control: the save path exists
    const body = ed.slice(i, i + 2600);
    expect(body).toMatch(/orphanedOwnedChips\(/);
    expect(body).toMatch(/runInAction\(cap, run\)/);
  });
  it("the chip's own Remove deletes a row its doc owns", () => {
    const n = read("../docs/pills/InstanceTextblockInlineNode.jsx");
    const i = n.indexOf('label: "Remove"');
    expect(i).toBeGreaterThan(0);
    expect(n.slice(i, i + 900)).toMatch(/embedRemoval\(occ, hostId\) === "delete"/);
  });
});
