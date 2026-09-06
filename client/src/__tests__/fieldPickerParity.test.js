// One field picker, two surfaces.
//
// User, 2026-09-06: *"the menu to add a field to a new occurance thats been
// added via the multiselect, should have the same field picker as the quick add
// menu, not some new popup."*
//
// The popup was mine. The add-an-option flow asked for fields one at a time
// through the GET_USER_INPUT modal — a chain of questions — while the quick-add
// menu already had a searchable, sectioned, tick-and-type panel. Two pickers for
// one job is how the labels, the section order and the which-fields-appear rule
// start disagreeing, so the panel is lifted out and BOTH render it.
//
// What is asserted here is the WRITE half, because that is where being wrong is
// silent: a ticked field that gets stored but not BOUND renders nowhere, which
// is the half of `0047` that looks like the write failed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes = [];
const binds = [];
vi.mock("../helpers/CommitHelpers", () => ({
  setOccurrenceFieldValue: (a) => writes.push(a),
  updateOccurrence: () => {},
  createLeafInstanceInParent: () => ({ moduleId: "m", occurrenceId: "o" }),
  ensureModuleBindingsForOccurrenceFields: (a) => binds.push(a),
}));

const { applyPickedFields } = await import("../helpers/addNewOption");

const FIELDS = {
  f_num: { id: "f_num", name: "Calories", type: "number" },
  f_txt: { id: "f_txt", name: "Notes", type: "text" },
  f_sel: { id: "f_sel", name: "Tags", type: "select" },
};
const ctx = { occurrencesById: { occ1: { id: "occ1", moduleId: "mod1", fields: {} } } };
const run = (picked, values) =>
  applyPickedFields({ picked, values, occurrenceId: "occ1", fieldsById: FIELDS, ctx, dispatch: () => {}, socket: {} });

beforeEach(() => { writes.length = 0; binds.length = 0; });

describe("the picked fields land on the new option", () => {
  it("writes the value the user typed", () => {
    run(["f_num"], { f_num: "42" });
    expect(writes).toHaveLength(1);
    expect(writes[0].fieldId).toBe("f_num");
    expect(writes[0].value).toBe(42);           // coerced to the field's type
  });

  it("BINDS every ticked field, including one left blank", () => {
    // The reason a blank tick is not a no-op: ticking without typing is how you
    // give the row somewhere to put the number later. Bound-but-empty is a
    // control on the row; unbound-but-stored renders nowhere.
    run(["f_num", "f_txt"], { f_num: "7" });
    expect(writes.map((w) => w.fieldId)).toEqual(["f_num"]);   // only one had a value
    expect(binds).toHaveLength(1);
    expect(Object.keys(binds[0].occurrence.fields).sort()).toEqual(["f_num", "f_txt"]);
  });

  it("binds against the occurrence's own module", () => {
    // A binding written against the wrong module is stored and renders on
    // nothing — the failure mode is silence, so the module is asserted.
    run(["f_txt"], { f_txt: "hi" });
    expect(binds[0].occurrence.moduleId).toBe("mod1");
    expect(binds[0].occurrence.id).toBe("occ1");
  });

  it("does nothing when nothing was ticked", () => {
    expect(run([], {})).toBe(0);
    expect(writes).toHaveLength(0);
    expect(binds).toHaveLength(0);
  });

  it("ignores a field id the grid does not have", () => {
    // The picker's list comes from the caller, so a stale id is possible; it
    // must not mint a binding to a field that does not exist.
    expect(run(["f_num", "ghost"], { f_num: "1" })).toBe(1);
    expect(Object.keys(binds[0].occurrence.fields)).toEqual(["f_num"]);
  });
});
