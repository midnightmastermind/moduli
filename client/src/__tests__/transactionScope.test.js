// "MODULE HISTORY" SHOWED NOTHING, ON ANY GRID.
//
// Found rebuilding poms grid through the UI (2026-09-22): opening History from
// a container's radial reads
//
//   Module History | 98 active, 0 undone | No transactions found | 0 of 100
//
// while the grid held 242 transactions. The filter matched `measure.panelId`,
// `measure.containerId`, `occurrence_list.*.containerId` and `entity.moduleId`
// — and NONE of those exist in the data:
//
//   rebuild   242 transactions   200 SnapshotOp (operations[] EMPTY, payload in docs[])
//                                 42 MeasureOp  (measure = occurrenceId/fieldId/value/flow)
//   poms     1200 transactions   15,831 measure payloads, ZERO with panelId or
//                                containerId; no occurrence_list or entity ops at all
//
// So the panel could never show a row. What a transaction actually names is an
// OCCURRENCE (or the module itself), so that is what the scope test reads.
import { describe, it, expect } from "vitest";
import { transactionTouchesModule } from "../helpers/transactionScope";

const MOD = "mod-mind";
const scope = { moduleId: MOD, occurrenceIds: new Set(["occ-a", "occ-b"]) };

const snapshot = (ids, model = "occurrence") =>
  ({ type: "SnapshotOp", operations: [], docs: ids.map((id) => ({ model, id })) });
const measure = (occurrenceId) =>
  ({ type: "MeasureOp", docs: [], operations: [{ type: "measure", measure: { occurrenceId, fieldId: "f", value: 1 } }] });

describe("which transactions belong to a module", () => {
  it("a SnapshotOp naming one of the module's occurrences", () => {
    expect(transactionTouchesModule(snapshot(["occ-a"]), scope)).toBe(true);
  });

  it("a SnapshotOp naming the module itself", () => {
    expect(transactionTouchesModule(snapshot([MOD], "module"), scope)).toBe(true);
  });

  it("a MeasureOp on one of the module's occurrences", () => {
    expect(transactionTouchesModule(measure("occ-b"), scope)).toBe(true);
  });

  // THE CONTROL. Without it, "the panel shows rows again" is equally satisfied
  // by a filter that passes everything — which is a grid-wide list wearing the
  // word "Module".
  it("NOT one that touches someone else's occurrence", () => {
    expect(transactionTouchesModule(snapshot(["occ-elsewhere"]), scope)).toBe(false);
    expect(transactionTouchesModule(measure("occ-elsewhere"), scope)).toBe(false);
  });

  it("the legacy op shapes still match, so older data keeps working", () => {
    const legacy = { operations: [{ measure: { containerId: MOD } }] };
    const legacyList = { operations: [{ occurrence_list: { to: { containerId: MOD } } }] };
    const legacyEntity = { operations: [{ entity: { moduleId: MOD } }] };
    expect(transactionTouchesModule(legacy, scope)).toBe(true);
    expect(transactionTouchesModule(legacyList, scope)).toBe(true);
    expect(transactionTouchesModule(legacyEntity, scope)).toBe(true);
  });

  it("with no moduleId every transaction passes (the grid-wide panel)", () => {
    expect(transactionTouchesModule(snapshot(["occ-elsewhere"]), { moduleId: null })).toBe(true);
  });

  it("a transaction with neither docs nor operations does not throw", () => {
    expect(transactionTouchesModule({}, scope)).toBe(false);
    expect(transactionTouchesModule(null, scope)).toBe(false);
  });
});
