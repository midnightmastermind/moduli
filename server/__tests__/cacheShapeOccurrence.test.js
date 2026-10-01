import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheShapeOccurrence } from "../utils/cacheOccurrence.js";
import { compressTextmap } from "../utils/textmapCompression.js";

// 2026-10-01: a textblock created inside a doc container linked into its parent
// with findOneAndUpdate, and the RETURNED Mongo row — textmap still the stored
// gzip+base64 string — went straight into the warm cache. Every later
// full_state served the string and the doc rendered blank.
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };

describe("cacheShapeOccurrence", () => {
  it("decompresses a stored textmap", () => {
    const row = { id: "a", textmap: compressTextmap(doc), occurrences: ["x"] };
    expect(cacheShapeOccurrence(row)).toEqual({ id: "a", textmap: doc, occurrences: ["x"] });
  });
  it("leaves an already-shaped row untouched (idempotent)", () => {
    const row = { id: "a", textmap: doc };
    expect(cacheShapeOccurrence(row)).toBe(row);
    expect(cacheShapeOccurrence({ id: "b" })).toEqual({ id: "b" });
  });
  it("unwraps a mongoose document", () => {
    const row = { toObject: () => ({ id: "a", textmap: compressTextmap(doc) }) };
    expect(cacheShapeOccurrence(row).textmap).toEqual(doc);
  });
});

// The class, not the instance: nothing in crud.js may cache a row it got back
// from Mongo without shaping it first.
describe("crud.js caches Mongo rows only through cacheShapeOccurrence", () => {
  const src = readFileSync(join(__dirname, "..", "socketHandlers", "crud.js"), "utf8");
  it("no parent row is cached straight from toObject()", () => {
    expect(src).not.toMatch(/const parentObj = typeof updatedParent\.toObject/);
  });
  it("every findOneAndUpdate parent link shapes its row", () => {
    // CONTROL that the guard reads real code: the shaped form is present.
    expect((src.match(/cacheShapeOccurrence\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
