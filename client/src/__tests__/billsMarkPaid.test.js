// "Bills: Mark Paid" — ticking a `Pay Bill` row ticks the BILL it names.
//
// The BEHAVIOURAL half of migration 0209. The migration's log proves the
// pipeline was WRITTEN; only this proves it RUNS. It boots the real executor on
// the migration's OWN exported builder — not a copy — so it cannot drift from
// what ships to a grid, and asserts by DIFFING state.
//
// User, 2026-08-23: *"make sure when i pay a bill with the pay occurance, that
// that gets set to complete."*
import { describe, it, expect, beforeEach } from "vitest";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { buildMarkPaidPipeline } from "../../../server/migrations/0209-paying-a-bill-ticks-it.mjs";

const BILL = "fld-bill", COMPLETED = "fld-completed", AMOUNT = "fld-amount";
const PAYROW = "occ-payrow";        // a `Pay Bill` row on the schedule
const PLAINPAY = "occ-plainpay";    // a `Pay` row — binds no Bill
const NETFLIX = "occ-netflix";      // the bill it names
const SPOTIFY = "occ-spotify";      // a bill nothing points at — the control

let occurrencesById, operations, operationsById, fieldsById, modulesById, grid;

const makeOp = () => ({
  id: "op-mark-paid", name: "Bills: Mark Paid", enabled: true, priority: 2,
  triggerTypes: ["onChange"],
  triggerObjects: [{ eventType: "onChange", subjectType: "field", targetId: COMPLETED, priority: 2 }],
  pipeline: buildMarkPaidPipeline({ billFieldId: BILL, completedFieldId: COMPLETED }),
});

beforeEach(() => {
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [BILL]: { id: BILL, name: "Bill", type: "occurrence" },
    [COMPLETED]: { id: COMPLETED, name: "Completed", type: "boolean" },
    [AMOUNT]: { id: AMOUNT, name: "Amount", type: "number" },
  };
  modulesById = {
    "m-paybill": { id: "m-paybill", label: "Pay Bill", role: "instance",
                   fieldBindings: [{ fieldId: COMPLETED }, { fieldId: BILL }, { fieldId: AMOUNT }] },
    "m-pay": { id: "m-pay", label: "Pay", role: "instance",
               fieldBindings: [{ fieldId: COMPLETED }, { fieldId: AMOUNT }] },
    "m-bill": { id: "m-bill", label: "Netflix", role: "instance",
                fieldBindings: [{ fieldId: AMOUNT }, { fieldId: COMPLETED }] },
  };
  occurrencesById = {
    [PAYROW]: { id: PAYROW, moduleId: "m-paybill", occurrences: [],
                fields: { [BILL]: { value: NETFLIX }, [COMPLETED]: { value: false }, [AMOUNT]: { value: 15.99 } } },
    [PLAINPAY]: { id: PLAINPAY, moduleId: "m-pay", occurrences: [],
                  fields: { [COMPLETED]: { value: false }, [AMOUNT]: { value: 85 } } },
    [NETFLIX]: { id: NETFLIX, moduleId: "m-bill", occurrences: [],
                 fields: { [AMOUNT]: { value: 15.99 }, [COMPLETED]: { value: false } } },
    [SPOTIFY]: { id: SPOTIFY, moduleId: "m-bill", occurrences: [],
                 fields: { [AMOUNT]: { value: 11.99 }, [COMPLETED]: { value: false } } },
  };
  operations = [makeOp()];
  operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
});

const ctx = () => ({
  state: { grid, gridId: grid._id, fields: Object.values(fieldsById), modules: Object.values(modulesById),
           occurrencesById, modulesById, fieldsById, operationsById, operations },
  fieldsById, operationsById, occurrencesById, modulesById,
});

/**
 * Exactly what a checkbox click reports — the shape `CommitHelpers` emits.
 * A field change carries a `fields` MAP; my first version passed
 * `fieldId`/`value` and the op never matched its trigger at all, which reads
 * exactly like a broken pipeline. RUNS: 0 is a claim about the probe.
 */
function setCompleted(occId, value) {
  occurrencesById[occId].fields[COMPLETED] = { value };
  const tx = { type: "MeasureOp", occurrenceId: occId, instanceId: occurrencesById[occId].moduleId,
               fields: { [COMPLETED]: value }, _ancestorIds: [], _ancestorLabels: [] };
  const updates = runMatchingOperations(operations, "MeasureOp", tx, ctx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}
const paid = (id) => occurrencesById[id].fields[COMPLETED]?.value;

describe("Bills: Mark Paid", () => {
  it("ticking a Pay Bill row marks the bill it names", () => {
    expect(paid(NETFLIX)).toBe(false);
    setCompleted(PAYROW, true);
    expect(paid(NETFLIX)).toBe(true);
  });

  it("leaves every OTHER bill alone — the control", () => {
    // Without this, an op that ticked all bills would pass the test above.
    setCompleted(PAYROW, true);
    expect(paid(SPOTIFY)).toBe(false);
  });

  it("UN-ticking writes nothing — asserted from an UNPAID bill", () => {
    // One way only: bills recur, so two Pay Bill rows can name one bill across
    // months and "this row is no longer complete" does not mean "unpaid".
    //
    // THE STARTING STATE IS THE WHOLE TEST. The first version ticked first and
    // then asserted the bill was STILL true — which cannot tell "did nothing"
    // from "wrote true again", and passed against a pipeline with the
    // `Completed IS true` rule deleted.
    expect(paid(NETFLIX)).toBe(false);
    const effects = setCompleted(PAYROW, false);
    expect(paid(NETFLIX)).toBe(false);
    expect(effects).toEqual([]);
  });

  it("un-ticking does not CLEAR a bill already paid", () => {
    setCompleted(PAYROW, true);
    setCompleted(PAYROW, false);
    expect(paid(NETFLIX)).toBe(true);
  });

  it("ignores a plain `Pay` row, which names no bill", () => {
    setCompleted(PLAINPAY, true);
    expect(paid(NETFLIX)).toBe(false);
    expect(paid(SPOTIFY)).toBe(false);
  });

  it("a DELETED bill writes nothing and throws nothing", () => {
    // Measured, not assumed: a FIND that binds nothing leaves the UPDATE
    // emitting no effect. This is why 0209 carries no `$billId` guard — one was
    // written, and the A/B showed it changed nothing.
    delete occurrencesById[NETFLIX];
    let effects;
    expect(() => { effects = setCompleted(PAYROW, true); }).not.toThrow();
    expect(effects).toEqual([]);
  });

  it("does nothing when the Bill picker is empty", () => {
    occurrencesById[PAYROW].fields[BILL] = { value: "" };
    setCompleted(PAYROW, true);
    expect(paid(NETFLIX)).toBe(false);
  });

  it("is idempotent — ticking again writes the same state", () => {
    setCompleted(PAYROW, true);
    setCompleted(PAYROW, true);
    expect(paid(NETFLIX)).toBe(true);
  });
});
