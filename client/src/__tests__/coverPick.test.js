// helpers/coverPick — "choose a cover" for one placement. Covers live on
// `occurrence.meta.cover` (the module is shared across every row of a kind).
import { describe, it, expect, vi, beforeEach } from "vitest";

const pickerCalls = [];
vi.mock("../ui/ImagePickerMenu", () => ({ openImagePicker: (req) => pickerCalls.push(req) }));
const writes = [];
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: (a) => writes.push(a.occurrence) }));

const { coverSearchQuery, coverMetaPatch, setCover, openCoverPicker } = await import("../helpers/coverPick");

beforeEach(() => { pickerCalls.length = 0; writes.length = 0; });

describe("coverPick", () => {
  it("searches by title plus the kind's hint, trimmed", () => {
    expect(coverSearchQuery({ label: "A Guide to Recognizing Your Saints ", kind: "movie" }))
      .toBe("A Guide to Recognizing Your Saints movie poster");
    expect(coverSearchQuery({ label: "Dune", kind: "book" })).toBe("Dune book cover");
    expect(coverSearchQuery({ label: "Notes", kind: "bookmark" })).toBe("Notes"); // no hint for other kinds
  });

  it("sets the cover and keeps every other meta key", () => {
    expect(coverMetaPatch({ source: "share", externalId: "x" }, " https://a/b.jpg "))
      .toEqual({ source: "share", externalId: "x", cover: "https://a/b.jpg" });
  });

  it("clearing REMOVES the key rather than storing null", () => {
    const out = coverMetaPatch({ cover: "u", source: "share" }, null);
    expect(out).toEqual({ source: "share" });
    expect("cover" in out).toBe(false);
  });

  it("opens the picker seeded with the title and writes the pick to meta.cover", () => {
    const occ = { id: "o1", label: "World War Z", meta: { mediaDrive: "Baldr" } };
    openCoverPicker({ getOccurrence: () => occ, module: { kind: "movie", label: "Movie" } });
    expect(pickerCalls).toHaveLength(1);
    expect(pickerCalls[0].query).toBe("World War Z movie poster");
    pickerCalls[0].onPick("https://img/p.jpg");
    expect(writes).toEqual([{ id: "o1", meta: { mediaDrive: "Baldr", cover: "https://img/p.jpg" } }]);
  });

  it("reads the instance at PICK time, so meta that changed while the picker was open survives", () => {
    let occ = { id: "o1", label: "X", meta: { a: 1 } };
    openCoverPicker({ getOccurrence: () => occ, module: { kind: "movie" } });
    occ = { id: "o1", label: "X", meta: { a: 1, userTouched: true } }; // changed meanwhile
    pickerCalls[0].onPick("u");
    expect(writes[0].meta).toEqual({ a: 1, userTouched: true, cover: "u" });
  });

  it("does nothing without an occurrence", () => {
    expect(openCoverPicker({ getOccurrence: () => null })).toBe(false);
    expect(setCover({ getOccurrence: () => null }, "u")).toBe(false);
    expect(pickerCalls.length + writes.length).toBe(0);
  });
});
