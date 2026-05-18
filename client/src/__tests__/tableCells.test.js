import { describe, it, expect } from "vitest";
import {
  emptyCellDoc, makeEmbedCellDoc, cellKey, getCellSortValue,
} from "../helpers/tableCells.js";
import { fillRange } from "../helpers/tableCells.js";
import { deleteColumn, insertColumn } from "../helpers/tableCells.js";

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

describe("column structural ops", () => {
  const base = {
    columns: [{ id: "a" }, { id: "b" }, { id: "c" }],
    rowCount: 2,
    cells: { "0:0": 1, "0:1": 2, "0:2": 3, "1:1": 9 },
  };
  it("deleteColumn removes col + reindexes cell keys", () => {
    const out = deleteColumn(base, 1);
    expect(out.columns.map(c => c.id)).toEqual(["a", "c"]);
    expect(out.cells).toEqual({ "0:0": 1, "0:1": 3 });
  });
  it("insertColumn at index shifts keys right", () => {
    const out = insertColumn(base, 1, { id: "x" });
    expect(out.columns.map(c => c.id)).toEqual(["a", "x", "b", "c"]);
    expect(out.cells["0:0"]).toBe(1);
    expect(out.cells["0:2"]).toBe(2);
    expect(out.cells["0:3"]).toBe(3);
    expect(out.cells["1:2"]).toBe(9);
  });
});
