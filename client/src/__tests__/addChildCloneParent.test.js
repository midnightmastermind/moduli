// ADD_CHILD on a parent that exists ONLY in the pipeline — a column cloned a
// few steps earlier by APPLY_TEMPLATE.
//
// 2026-09-19: today's Day Page column was built fresh and `Day Page: Build`
// listed the Emotions Wheel under it (the write reached Mongo) — but the step
// that builds the column's textmap loops over `$col.occurrences`, and `$col` is
// the clone stub a FIND bound BEFORE the ADD_CHILD. ADD_CHILD only patched
// `context.occurrencesById`, where a same-pipeline clone does not live, so the
// loop never saw the wheel and the textmap was written without it. A doc
// container renders its TEXTMAP, so the wheel was listed and invisible.
import { describe, test, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const ctx = (occurrencesById = {}) => ({ occurrencesById, modulesById: {}, fieldsById: {}, state: {} });

describe("ADD_CHILD onto a same-pipeline clone", () => {
  test("the variable holding the clone sees the new child", () => {
    const stub = { id: "col", occurrences: ["journal", "notes"] };
    const $vars = { $allOccurrences: [stub], $col: stub };
    executeActionItem("ADD_CHILD", { parentId: "col", childId: "wheel" }, $vars, ctx(), null);
    expect($vars.$col.occurrences).toEqual(["journal", "notes", "wheel"]);
  });

  test("a FIND over $allOccurrences after it sees the child too", () => {
    const stub = { id: "col", occurrences: [] };
    const $vars = { $allOccurrences: [stub] };
    executeActionItem("ADD_CHILD", { parentId: "col", childId: "wheel" }, $vars, ctx(), null);
    expect($vars.$allOccurrences.find((o) => o.id === "col").occurrences).toEqual(["wheel"]);
  });

  test("still emits the write that persists the listing", () => {
    const stub = { id: "col", occurrences: ["a"] };
    const updates = executeActionItem("ADD_CHILD", { parentId: "col", childId: "b" },
      { $allOccurrences: [stub] }, ctx(), null);
    expect(updates).toEqual([{ _effect: "UPDATE_OCCURRENCE", occurrence: { id: "col", occurrences: ["a", "b"] } }]);
  });

  // THE CONTROL: a parent in the store overlay is the store's own object. It
  // must be REPLACED, never mutated — mutating it would change React state
  // behind the reducer's back.
  test("a store-backed parent is replaced, never mutated in place", () => {
    const original = { id: "P", occurrences: ["a"] };
    const occurrencesById = { P: original };
    executeActionItem("ADD_CHILD", { parentId: "P", childId: "b" }, {}, ctx(occurrencesById), null);
    expect(original.occurrences).toEqual(["a"]);
    expect(occurrencesById.P).not.toBe(original);
    expect(occurrencesById.P.occurrences).toEqual(["a", "b"]);
  });
});
