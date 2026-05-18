import { describe, it, expect } from "vitest";
import {
  emptyCellDoc, makeEmbedCellDoc, cellKey, getCellSortValue,
} from "../helpers/tableCells.js";
import { fillRange } from "../helpers/tableCells.js";

describe("tableCells", () => {
  it("cellKey formats r:c", () => {
    expect(cellKey(3, 1)).toBe("3:1");
  });

  it("emptyCellDoc is an empty tiptap paragraph doc", () => {
    expect(emptyCellDoc()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("makeEmbedCellDoc wraps a single moduleEmbed node", () => {
    const doc = makeEmbedCellDoc("occ_9");
    expect(doc.type).toBe("doc");
    expect(doc.content[0].type).toBe("moduleEmbed");
    expect(doc.content[0].attrs.occurrenceId).toBe("occ_9");
  });

  it("getCellSortValue: numeric plain text coerces to Number", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " 42 " }] }] };
    expect(getCellSortValue(doc, { displayFieldId: null }, {})).toBe(42);
  });

  it("getCellSortValue: non-numeric plain text stays string", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
    expect(getCellSortValue(doc, { displayFieldId: null }, {})).toBe("hello");
  });

  it("getCellSortValue: embed + column displayFieldId → that field value", () => {
    const doc = makeEmbedCellDoc("occ_1");
    const ctx = {
      occurrencesById: { occ_1: { id: "occ_1", fields: { fld_p: { value: 31 } } } },
    };
    expect(getCellSortValue(doc, { displayFieldId: "fld_p" }, ctx)).toBe(31);
  });

  it("getCellSortValue: embed, no displayFieldId → occurrence label", () => {
    const doc = makeEmbedCellDoc("occ_1");
    const ctx = {
      occurrencesById: { occ_1: { id: "occ_1", targetId: "mod_1" } },
      modulesById: { mod_1: { id: "mod_1", label: "Protein" } },
    };
    expect(getCellSortValue(doc, { displayFieldId: null }, ctx)).toBe("Protein");
  });

  it("getCellSortValue: empty doc → empty string", () => {
    expect(getCellSortValue(emptyCellDoc(), { displayFieldId: null }, {})).toBe("");
  });
});

describe("fillRange", () => {
  const src = { r: 1, c: 1 };
  it("horizontal when |dc| >= |dr|", () => {
    expect(fillRange(src, { r: 1, c: 4 })).toEqual([
      { r: 1, c: 2 }, { r: 1, c: 3 }, { r: 1, c: 4 },
    ]);
  });
  it("vertical when |dr| > |dc|", () => {
    expect(fillRange(src, { r: 4, c: 2 })).toEqual([
      { r: 2, c: 1 }, { r: 3, c: 1 }, { r: 4, c: 1 },
    ]);
  });
  it("backwards horizontal", () => {
    expect(fillRange(src, { r: 1, c: -1 }).map(p => p.c)).toEqual([0]);
  });
  it("excludes the source cell and returns [] when target == source", () => {
    expect(fillRange(src, { r: 1, c: 1 })).toEqual([]);
  });
});
