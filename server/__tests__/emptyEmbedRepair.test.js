// __tests__/emptyEmbedRepair.test.js
//
// Migration 0336. The risk is entirely WHICH nodes go: CLAUDE.md 2026-08-01 (19)
// records a dangling-embed scrub that WAS the regression, because it removed the
// only node rendering a surviving sibling. This one only ever removes an embed
// that names the EMPTY STRING — which cannot be rendering anything — so these
// tests are about it leaving every real pointer alone.
import { describe, it, expect } from "vitest";
import { isEmptyEmbed, repairTextmap } from "../migrations/0336-empty-embed-in-a-short-wrap-group.mjs";

const doc = (...content) => ({ type: "doc", content });
const embed = (occurrenceId) => ({ type: "moduleEmbed", attrs: { occurrenceId, align: "full" } });
const group = (...content) => ({ type: "wrapGroup", attrs: { side: "left" }, content });
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("isEmptyEmbed", () => {
  it("catches the shapes ProseMirror's schema repair actually mints", () => {
    expect(isEmptyEmbed(embed(""))).toBe(true);
    expect(isEmptyEmbed({ type: "moduleEmbed", attrs: {} })).toBe(true);
    expect(isEmptyEmbed({ type: "moduleEmbed", attrs: { occurrenceId: "   " } })).toBe(true);
    expect(isEmptyEmbed({ type: "instanceTextblockInline", attrs: { occurrenceId: "" } })).toBe(true);
  });

  // THE CONTROL, and the whole safety of the migration. A real id is left alone
  // whether or not it resolves today — "does this pointer resolve?" across a
  // whole grid is the 2026-08-01 (19) regression.
  it("leaves any embed that names something, resolving or not", () => {
    expect(isEmptyEmbed(embed("e027b531"))).toBe(false);
    expect(isEmptyEmbed(embed("an-id-that-no-longer-exists"))).toBe(false);
    expect(isEmptyEmbed(para("not an embed"))).toBe(false);
  });
});

describe("repairTextmap", () => {
  // The exact shape measured on poms grid 2026-09-17.
  it("clears the live defect and keeps the surviving article section", () => {
    const res = repairTextmap(doc(group(embed("e027b531"), embed("")), para("after")));
    expect(res.removed).toBe(1);
    expect(res.flattened).toBe(1);
    expect(res.textmap.content[0]).toEqual(embed("e027b531"));
    expect(res.textmap.content[1]).toEqual(para("after"));
  });

  it("leaves no wrapGroup and no empty id behind", () => {
    const res = repairTextmap(doc(group(embed("keep"), embed(""))));
    const json = JSON.stringify(res.textmap);
    expect(json).not.toContain("wrapGroup");
    expect(json).not.toContain('"occurrenceId":""');
  });

  it("keeps a group that still has two real members", () => {
    const res = repairTextmap(doc(group(embed("a"), embed("b"), embed(""))));
    expect(res.textmap.content[0].type).toBe("wrapGroup");
    expect(res.textmap.content[0].content).toHaveLength(2);
    expect(res.textmap.content[0].attrs).toEqual({ side: "left" });
  });

  it("returns null when there is nothing to do, so the write is skipped", () => {
    expect(repairTextmap(doc(group(embed("a"), embed("b")), para("x")))).toBeNull();
    expect(repairTextmap(doc(para("just prose")))).toBeNull();
    expect(repairTextmap(null)).toBeNull();
  });

  // A group that was ALREADY short is not this pass's doing — reshaping it would
  // be the "merely because it is empty" sweep the scrub deliberately refuses.
  it("does not touch a short group it did not shrink", () => {
    const before = doc(group(embed("lonely")), embed(""));
    const res = repairTextmap(before);
    expect(res.removed).toBe(1);
    expect(res.flattened).toBe(0);
    expect(res.textmap.content[0]).toEqual(group(embed("lonely")));
  });

  it("reaches an embed nested below the top level", () => {
    const res = repairTextmap(doc({ type: "blockquote", content: [para("a"), embed("")] }));
    expect(res.removed).toBe(1);
    expect(res.textmap.content[0].content.map((n) => n.type)).toEqual(["paragraph"]);
  });
});
