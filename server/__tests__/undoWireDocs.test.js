// Undo sends the restored rows to every tab. Their textmap is stored COMPRESSED
// in the snapshot; the client must get the object (2026-10-02: an undone doc
// drop stayed on screen because the store took a base64 string as the text).
import { describe, it, expect, vi } from "vitest";
vi.mock("../models/Transaction.js", () => ({ default: {} }));
const { wireRestoreDocs } = await import("../socketHandlers/transactions.js");
const { compressTextmap } = await import("../utils/textmapCompression.js");

const tm = { type: "doc", content: [{ type: "paragraph" }] };
describe("wireRestoreDocs", () => {
  it("decompresses an occurrence's textmap", () => {
    const [d] = wireRestoreDocs([{ model: "occurrence", id: "o", doc: { id: "o", textmap: compressTextmap(tm) } }]);
    expect(d.doc.textmap).toEqual(tm);
  });
  it("leaves a deletion, a raw textmap and other models alone", () => {
    const docs = [
      { model: "occurrence", id: "a", doc: null },
      { model: "occurrence", id: "b", doc: { id: "b", textmap: tm } },
      { model: "field", id: "f", doc: { id: "f", textmap: "not a doc" } },
    ];
    expect(wireRestoreDocs(docs)).toEqual(docs);
  });
});
