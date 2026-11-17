// 0506 — a shift copy orphaned by a schedule rebuild goes back into its start slot; a deleted copy stays deleted;
// Hours reads "9am-3pm". Real executor, the migration's own steps.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { rehomeSteps, hoursPipeline, withRehome } from "../../../server/migrations/0506-shift-start-slot-and-hours.mjs";

const DAY = "2026-11-17", DATE = "Eh7oi4HKdbHB", SLOT = "nSccAtADyUGW", DUR = "1wNjBBeOTwA2", SCHED = "sched", FMT = "fmt";
function world({ orphan }) {
  const occ = {
    page: { id: "page", moduleId: "mP", occurrences: ["col"] },
    col: { id: "col", moduleId: "mC", occurrences: ["s9"], fields: { [FMT]: { value: "day-col" } } },
    s9: { id: "s9", moduleId: "mS", occurrences: [], fields: { [FMT]: { value: "slot" }, [SLOT]: { value: "9:00am" } } },
    ws: { id: "ea0ffa77-3947-4158-91a5-cc5bba96ab51", moduleId: "mW", occurrences: ["shift"] },
    shift: { id: "shift", moduleId: "mI", parentId: "ea0ffa77-3947-4158-91a5-cc5bba96ab51", fields: { [DATE]: { value: DAY }, [SLOT]: { value: "9:00am" }, [DUR]: { value: 360 }, [SCHED]: { value: true } } },
  };
  if (orphan) occ.orphan = { id: "orphan", moduleId: "mI", parentId: "gone", meta: { copyLinkSource: "shift", datedWork: true }, fields: { [DATE]: { value: DAY }, [SLOT]: { value: "9:00am" } } };
  const mod = { mP: { id: "mP", role: "page" }, mC: { id: "mC", role: "container" }, mS: { id: "mS", role: "container" }, mW: { id: "mW", role: "container" }, mI: { id: "mI", role: "instance", label: "Cook" } };
  return { occ, mod };
}
function run(op, w, transaction = { type: "ButtonOp" }) {
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(w.mod), occurrencesById: w.occ, modulesById: w.mod, fieldsById: {} },
    fieldsById: {}, occurrencesById: w.occ, modulesById: w.mod, operationsById: {}, operations: [op] };
  const out = executePipeline(op, ctx, transaction, {});
  return Array.isArray(out) ? out : (out?.effects || out?.updates || []);
}
// The placement block of Place Dated Work, in miniature: find the slot, look for today's copy in it, then 0506's
// re-home, then 0484's gate (copy only while Scheduled is not ticked).
const placeOp = () => ({ id: "p", enabled: true, pipeline: { sources: [], steps: [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$day", expr: `literal:${DAY}` } },
  { id: "b", type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "literal:page" } },
  { id: "c", type: "action", config: { type: "FIND", over: "$allInstances", itemVar: "$appt", predicate: { operator: "AND", rules: [{ id: "r", left: "id", comparator: "IS", right: "shift" }] } } },
  { id: "d", type: "action", config: { type: "INIT_VAR", name: "$slotId", expr: "literal:s9" } },
  { id: "e", type: "action", config: { type: "FIND", over: "$allInstances", itemIdVar: "$apptCopyId", predicate: { operator: "AND", rules: [
    { id: "r1", left: "meta.copyLinkSource", comparator: "IS", right: "$appt.id" }, { id: "r2", left: "parentId", comparator: "IS", right: "$slotId" }] } } },
  ...rehomeSteps(),
  { id: "g", type: "if", condition: { operator: "AND", rules: [{ id: "g1", left: "$apptCopyId", comparator: "IS_EMPTY", right: "" }, { id: "g2", left: `$appt.fields.${SCHED}.value`, comparator: "IS_NOT", right: true }] },
    then: [{ id: "h", type: "action", config: { type: "COPY_LINK", sourceId: "$appt.id", parent: "$slotId", meta: { datedWork: true } } }], else: [] },
] } });

describe("0506 — the shift's start slot", () => {
  it("an orphaned copy is moved into today's slot (no new copy)", () => {
    const fx = run(placeOp(), world({ orphan: true }));
    expect(fx.find((e) => e._effect === "UPDATE_ITEM_PARENT")).toMatchObject({ itemId: "orphan", toParentId: "s9" });
    expect(fx.some((e) => e._effect === "CREATE_ITEM")).toBe(false);
  });
  it("a copy the user deleted (Scheduled ticked, no copy left) stays deleted", () => {
    const fx = run(placeOp(), world({ orphan: false }));
    expect(fx.filter((e) => e._effect)).toEqual([]);
  });
  it("is inserted once after the $apptCopyId FIND, and not twice", () => {
    const pipe = { steps: [{ id: "x", type: "if", then: [{ id: "f", type: "action", config: { type: "FIND", itemIdVar: "$apptCopyId" } }, { id: "z", type: "action", config: { type: "NOTIFY" } }] }] };
    const [once, n] = withRehome(pipe);
    expect(n).toBe(1);
    expect(once.steps[0].then.map((s) => s.id)).toEqual(["f", "rehome-find", "rehome-if", "z"]);
    expect(withRehome(once)[1]).toBe(0);
  });
});

describe("0506 — Hours", () => {
  it("writes \"9am-3pm\" on a shift under Work Shifts", () => {
    const op = { id: "h", enabled: true, pipeline: hoursPipeline("HRS") };
    const w = world({ orphan: false });
    w.occ.shift._ancestors = undefined;
    const fx = run(op, w);
    const set = fx.find((e) => e._effect === "UPDATE_ITEM_FIELD" && e.fieldId === "HRS");
    expect(set).toMatchObject({ itemId: "shift", value: "9am-3pm" });
  });
});
