// `) , (` — a dropped list entry between two parentheticals, from the Wikipedia
// importer. The Eminem infobox's Spouses cell reads
// "Kimberly Anne Scott (m. 1999; div. 2001) , (m. 2006; div. 2006)": the same
// person twice, the name stated once by the source, the separator kept anyway.
import { describe, it, expect } from "vitest";
import { repairOrphanedSeparator, cellText, repairCellDoc }
  from "../migrations/0194-an-orphaned-separator-in-an-imported-table.mjs";

const LIVE = "Kimberly Anne Scott (m. 1999; div. 2001) , (m. 2006; div. 2006)";

describe("repairOrphanedSeparator", () => {
  it("collapses the live case", () => {
    expect(repairOrphanedSeparator(LIVE))
      .toBe("Kimberly Anne Scott (m. 1999; div. 2001) (m. 2006; div. 2006)");
  });

  it("does NOT touch an ordinary list — the whole reason the pattern is `) , (`", () => {
    // A general "space before a comma" repair would be a licence to rewrite
    // prose. Each of these is left exactly as it is.
    for (const s of [
      "Albums, singles, production, videography",
      "Detroit, Michigan",
      "a sentence , with sloppy spacing",
      "Scott (m. 1999), Smith (m. 2006)",
    ]) expect(repairOrphanedSeparator(s)).toBeNull();
  });

  it("returns null when there is nothing to do, so a no-op cannot be written", () => {
    expect(repairOrphanedSeparator("clean")).toBeNull();
    expect(repairOrphanedSeparator(undefined)).toBeNull();
  });

  it("repairs several in one cell", () => {
    expect(repairOrphanedSeparator("A (1) , (2) , (3)")).toBe("A (1) (2) (3)");
  });

  it("does not invent the missing name", () => {
    // Guessing a name into a biography is the class 0052 refused for phone
    // numbers. The source states it once; so does the repair.
    expect(repairOrphanedSeparator(LIVE)).not.toMatch(/Kimberly.*Kimberly/);
  });
});

describe("repairCellDoc walks a ProseMirror cell", () => {
  const doc = () => ({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: LIVE }] }] });

  it("rewrites the text node in place and reports it", () => {
    const d = doc();
    expect(repairCellDoc(d)).toBe(true);
    expect(cellText(d)).toBe("Kimberly Anne Scott (m. 1999; div. 2001) (m. 2006; div. 2006)");
  });

  it("reports false on a clean cell — the control", () => {
    const d = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Detroit, Michigan" }] }] };
    expect(repairCellDoc(d)).toBe(false);
    expect(cellText(d)).toBe("Detroit, Michigan");
  });

  it("leaves the rest of the document untouched", () => {
    const d = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "keep me, please" }] },
      { type: "paragraph", content: [{ type: "text", text: LIVE }] }] };
    repairCellDoc(d);
    expect(cellText(d.content[0])).toBe("keep me, please");
  });
});
