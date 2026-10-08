// A deleted field's bindings and values leave the client store too (2026-10-07).
import { describe, it, expect } from "vitest";
import { masterReducer } from "../state/masterReducer.js";
import { ActionTypes } from "../state/actions.js";

const state = {
  fields: [{ id: "f1" }, { id: "f2" }],
  modules: [{ id: "m1", fieldBindings: [{ fieldId: "f1" }, { fieldId: "f2" }] }, { id: "m2", fieldBindings: [{ fieldId: "f2" }] }],
  occurrences: [{ id: "a", fields: { f1: { value: 1 }, f2: { value: 2 } } }, { id: "b", fields: { f2: { value: 3 } } }],
};
describe("DELETE_FIELD", () => {
  const next = masterReducer(state, { type: ActionTypes.DELETE_FIELD, payload: { fieldId: "f1" } });
  it("drops the field, its bindings and its values", () => {
    expect(next.fields.map((f) => f.id)).toEqual(["f2"]);
    expect(next.modules[0].fieldBindings).toEqual([{ fieldId: "f2" }]);
    expect(next.occurrences[0].fields).toEqual({ f2: { value: 2 } });
  });
  it("CONTROL — rows that never carried it keep their identity", () => {
    expect(next.modules[1]).toBe(state.modules[1]);
    expect(next.occurrences[1]).toBe(state.occurrences[1]);
  });
});
