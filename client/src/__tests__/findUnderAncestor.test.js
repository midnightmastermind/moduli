import { describe, it, expect } from "vitest";
import { executeActionItem, hasAncestorRuleOf, recordsUnder } from "../helpers/operationActions.js";

// Schedule: Build Schedule asks, for each off-screen day column, "is anything under it ticked or touched?" — a
// FIND over every occurrence. ~60 columns x ~22k rows per date step on poms grid (2026-11-06).
let reads = 0;
const rec = (id, anc, done = false) => {
  const r = { id, moduleId: "m", fields: { c: { value: done } } };
  Object.defineProperty(r, "_ancestors", { enumerable: true, get() { reads++; return anc; } });
  return r;
};
const list = () => [
  rec("a", ["col1", "page"], true), rec("b", ["col1", "page"]), rec("c", ["col2", "page"], true),
  rec("d", ["page"]), rec("e", undefined), rec("f", ["slot", "col1", "page"], true), rec("g", ["col1", "col1"], true),
];
const predicate = { operator: "AND", rules: [
  { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$col" },
  { operator: "OR", rules: [{ left: "fields.c.value", comparator: "IS", right: true }] },
] };
const find = (items, col, p = predicate) => {
  const $vars = { $allOccurrences: items, $col: col };
  executeActionItem("FIND", { predicate: p, itemIdVar: "$ids", multiple: true }, $vars, {}, {});
  return $vars.$ids;
};

describe("FIND reads the records under an ancestor from an index", () => {
  it("recognises a plain AND rule, and nothing else", () => {
    expect(hasAncestorRuleOf(predicate, { $col: "col1" })).toBe("col1");
    expect(hasAncestorRuleOf({ ...predicate, operator: "OR" }, { $col: "col1" })).toBe(null);
    expect(hasAncestorRuleOf(predicate, { $col: "" })).toBe(null);
    expect(hasAncestorRuleOf(predicate, { $col: ["col1"] })).toBe(null);
    // a $var on the LEFT is a variable, not the record — not this index
    expect(hasAncestorRuleOf({ rules: [{ left: "$x._ancestors", comparator: "HAS_ANCESTOR", right: "$col" }] }, { $col: "col1" })).toBe(null);
  });

  it("scans on the first ask of a list and indexes from the second", () => {
    const l = list();
    expect(recordsUnder(l, "col1")).toBe(null);
    expect(recordsUnder(l, "col1").map((r) => r.id)).toEqual(["a", "b", "f", "g"]);   // list order, g once
    expect(recordsUnder(l, "nothing")).toEqual([]);
  });

  it("finds exactly what the full scan finds, every time", () => {
    const l = list();
    const scan = (col) => list().filter((r) => (r._ancestors || []).includes(col) && r.fields.c.value === true).map((r) => r.id);
    for (const col of ["col1", "col2", "page", "slot", "none", "col1"]) expect(find(l, col)).toEqual(scan(col));
  });

  it("tests only the records under the ancestor once indexed", () => {
    const l = list();
    find(l, "col1"); find(l, "col1");          // second ask builds the index
    reads = 0;
    find(l, "col2");
    expect(reads).toBe(1);                      // only "c" is under col2; a scan reads all 7 records' ancestors
  });

  it("a new list (a CREATE replaced the array) is not served the old list's index", () => {
    const l = list(); find(l, "col1"); find(l, "col1");
    const grown = [...l, rec("h", ["col1"], true)];
    expect(find(grown, "col1")).toContain("h");
    expect(find(grown, "col1")).toContain("h");
  });
});
