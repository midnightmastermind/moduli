/**
 * linkedFanSkipsPlacementFields.test.js
 *
 * `updateOccurrence` pushes a field write onto every copy-link sibling in the
 * same frame. The server's fan-out (socketHandlers/occurrences.js) leaves out
 * the per-PLACEMENT fields — the ones the grid filters on (Date) and the ones
 * an operation stamps from the destination container (Time Slot) — so the
 * client must too. Otherwise setting Date on one copy shows it on every
 * sibling in this tab, and it vanishes on the next sync because the server
 * never stored it there.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { linkedFanFields } from "../helpers/linkedFanFields";
import { operationsBridge } from "../state/bindSocketToStore";

const DATE = "fDate", SLOT = "fSlot", DONE = "fDone";

const STATE = {
  grid: { _id: "g1", activeFilterValues: { [DATE]: "2026-09-25" } },
  operations: [{
    id: "stamp", gridId: "g1",
    pipeline: { steps: [{ type: "action", config: {
      type: "UPDATE", path: `$item.fields.${SLOT}.value`, value: "$trigger.containerLabel",
    } }] },
  }],
};

let local;
beforeEach(() => {
  local = {
    a: { id: "a", linkedGroupId: "lg", fields: {} },
    b: { id: "b", linkedGroupId: "lg", fields: {} },
  };
  operationsBridge.updateLocalOcc = (o) => { if (o?.id) local[o.id] = { ...local[o.id], ...o }; };
  operationsBridge.getLocalOcc = (id) => local[id] || null;
  operationsBridge.getLinkedOccs = (lg, exclude) => Object.values(local).filter(o => o.linkedGroupId === lg && o.id !== exclude);
  operationsBridge.getAncestorChain = () => ({ ids: [], labels: [] });
  operationsBridge.getFilterContext = () => ({ state: STATE, occurrencesById: local });
});
afterEach(() => {
  for (const k of ["updateLocalOcc", "getLocalOcc", "getLinkedOccs", "getAncestorChain", "getFilterContext"]) operationsBridge[k] = null;
});

const siblingPatches = (dispatch) => dispatch.mock.calls
  .map(([action]) => action?.payload || action?.occurrence || action)
  .filter(p => p?.id === "b");

describe("copy-link fan-out on the client", () => {
  test("Date and Time Slot stay on the edited copy; other fields still reach the sibling", () => {
    const dispatch = vi.fn();
    updateOccurrence({
      dispatch, socket: { emit: vi.fn(), connected: true },
      occurrence: { id: "a", fields: {
        [DATE]: { value: "2026-09-25", flow: "in" },
        [SLOT]: { value: "9:00am", flow: "in" },
        [DONE]: { value: true, flow: "in" },
      } },
    });
    expect(local.b.fields[DATE]).toBeUndefined();
    expect(local.b.fields[SLOT]).toBeUndefined();
    expect(local.b.fields[DONE]).toEqual({ value: true, flow: "in" });
  });

  test("a write of ONLY placement fields touches no sibling", () => {
    const dispatch = vi.fn();
    updateOccurrence({
      dispatch, socket: { emit: vi.fn(), connected: true },
      occurrence: { id: "a", fields: { [DATE]: { value: "2026-09-25", flow: "in" } } },
    });
    expect(siblingPatches(dispatch)).toHaveLength(0);
    expect(local.b.fields).toEqual({});
  });

  test("fails open with no grid known, exactly as the server does", () => {
    const fields = { [DATE]: { value: "x" } };
    expect(linkedFanFields(fields, null)).toBe(fields);
    expect(linkedFanFields(fields, {})).toBe(fields);
  });

  test("another grid's operations do not decide this grid's placement fields", () => {
    const state = { ...STATE, grid: { _id: "g2" }, operations: STATE.operations };
    const fields = { [SLOT]: { value: "9:00am" } };
    expect(linkedFanFields(fields, state)).toEqual(fields);
  });
});
