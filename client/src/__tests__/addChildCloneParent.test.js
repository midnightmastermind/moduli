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
    expect(updates).toEqual([{ _effect: "UPDATE_OCCURRENCE", occurrence: { id: "col", occurrences: ["a", "b"] }, occurrencesBase: ["a"] }]);
  });

  // THE SECOND REPORT: the clone's CREATE_ITEM payload and its stub share one
  // `childIds` array. If ADD_CHILD grows a NEW array, the create still carries
  // only the template's children and — landing after the ADD_CHILD writes —
  // resets the list. Both ADD_CHILDs must reach the create payload.
  test("the clone's own CREATE payload carries every child added after it", () => {
    const childIds = ["journal", "notes"];
    const createPayload = { id: "col", occurrences: childIds };
    const stub = { id: "col", occurrences: childIds };
    const $vars = { $allOccurrences: [stub], $col: stub };
    executeActionItem("ADD_CHILD", { parentId: "col", childId: "wheel" }, $vars, ctx(), null);
    executeActionItem("ADD_CHILD", { parentId: "col", childId: "todo" }, $vars, ctx(), null);
    expect(createPayload.occurrences).toEqual(["journal", "notes", "wheel", "todo"]);
  });

  // A second ADD_CHILD must build on the first, not on the pre-first list.
  test("a second ADD_CHILD's write keeps the first child", () => {
    const stub = { id: "col", occurrences: ["a"] };
    const $vars = { $allOccurrences: [stub] };
    executeActionItem("ADD_CHILD", { parentId: "col", childId: "wheel" }, $vars, ctx(), null);
    const u = executeActionItem("ADD_CHILD", { parentId: "col", childId: "todo" }, $vars, ctx(), null);
    expect(u[0].occurrence.occurrences).toEqual(["a", "wheel", "todo"]);
  });

  // An EXISTING column: the store holds it, and a FIND bound the read-model
  // copy. The copy `$col` holds must see the child; the store object must not
  // be touched, and neither must the array they share.
  test("an existing parent's read-model copy sees the child; the store does not move", () => {
    const shared = ["journal"];
    const storeObj = { id: "P", occurrences: shared };
    const readModel = { ...storeObj, label: "Friday" };
    const $vars = { $allOccurrences: [readModel], $col: readModel };
    executeActionItem("ADD_CHILD", { parentId: "P", childId: "wheel" }, $vars, ctx({ P: storeObj }), null);
    expect($vars.$col.occurrences).toEqual(["journal", "wheel"]);
    expect(storeObj.occurrences).toEqual(["journal"]);
    expect(shared).toEqual(["journal"]);
  });

  test("a $vars entry that IS the store object is left alone", () => {
    const storeObj = { id: "P", occurrences: ["a"] };
    executeActionItem("ADD_CHILD", { parentId: "P", childId: "b" },
      { $allOccurrences: [storeObj] }, ctx({ P: storeObj }), null);
    expect(storeObj.occurrences).toEqual(["a"]);
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
