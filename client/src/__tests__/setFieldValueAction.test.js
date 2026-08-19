// __tests__/setFieldValueAction.test.js
//
// The two picker actions that had no executor case (found 2026-08-18 by
// building an operation with them through the UI and watching the tile stay
// at 0). Both were fully present everywhere ELSE — the action picker, the
// step editor, `operationIntrospection` — which is exactly what made them
// silent: every surface said the step was configured and nothing ran it.
//
// The tests assert the EFFECTS THAT LEAVE the action, not that a case exists:
// a case that emits the wrong effect shape is the same defect wearing a
// different hat.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const ctx = () => ({ state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {} });

describe("SET_FIELD_VALUE", () => {
  it("writes the field on the occurrence the step names", () => {
    const out = executeActionItem(
      "SET_FIELD_VALUE",
      { occurrenceIdExpr: "$row.id", fieldId: "f-minutes", valueExpr: "$total" },
      { $row: { id: "occ-1" }, $total: 45 },
      ctx(),
      null,
    );
    expect(out).toEqual([
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ-1", fieldId: "f-minutes", value: 45, subKind: "value" },
    ]);
  });

  it("defaults to the trigger occurrence when no target is named", () => {
    const out = executeActionItem(
      "SET_FIELD_VALUE",
      { fieldId: "f-done", value: true },
      { $trigger: { occurrenceId: "occ-trigger" } },
      ctx(),
      null,
    );
    expect(out[0].itemId).toBe("occ-trigger");
    expect(out[0].value).toBe(true);
  });

  it("accepts a bound RECORD, not just an id", () => {
    const out = executeActionItem(
      "SET_FIELD_VALUE",
      { occurrenceIdExpr: "$row", fieldId: "f-x", valueExpr: "literal:7" },
      { $row: { id: "occ-2", fields: {} } },
      ctx(),
      null,
    );
    expect(out[0].itemId).toBe("occ-2");
  });

  it("writes flow ONLY when the step names one, and after the value", () => {
    const withFlow = executeActionItem(
      "SET_FIELD_VALUE",
      { occurrenceIdExpr: "$row.id", fieldId: "f-amt", value: 12, flow: "out" },
      { $row: { id: "occ-3" } },
      ctx(),
      null,
    );
    expect(withFlow).toHaveLength(2);
    expect(withFlow[1]).toMatchObject({ subKind: "flow", value: "out" });

    const noFlow = executeActionItem(
      "SET_FIELD_VALUE",
      { occurrenceIdExpr: "$row.id", fieldId: "f-amt", value: 12 },
      { $row: { id: "occ-3" } },
      ctx(),
      null,
    );
    expect(noFlow).toHaveLength(1);
  });

  it("refuses a multi-match binding rather than picking one", () => {
    expect(() =>
      executeActionItem(
        "SET_FIELD_VALUE",
        { occurrenceIdExpr: "$rows", fieldId: "f-x", value: 1 },
        { $rows: [{ id: "a" }, { id: "b" }] },
        ctx(),
        null,
      ),
    ).toThrow(/matched 2 records/);
  });

  it("writes nothing without a field", () => {
    const out = executeActionItem(
      "SET_FIELD_VALUE",
      { occurrenceIdExpr: "$row.id", value: 1 },
      { $row: { id: "occ-1" } },
      ctx(),
      null,
    );
    expect(out).toEqual([]);
  });
});

describe("LINK_OCCURRENCE_TO_PARENT", () => {
  it("emits the re-parent effect, which unlists, re-parents AND re-lists", () => {
    const out = executeActionItem(
      "LINK_OCCURRENCE_TO_PARENT",
      { parentId: "$dest.id", childId: "$row.id" },
      { $dest: { id: "parent-1" }, $row: { id: "child-1" } },
      ctx(),
      null,
    );
    expect(out).toEqual([
      { _effect: "UPDATE_ITEM_PARENT", itemId: "child-1", toParentId: "parent-1" },
    ]);
  });

  it("accepts bound records on either side", () => {
    const out = executeActionItem(
      "LINK_OCCURRENCE_TO_PARENT",
      { parentId: "$dest", childId: "$row" },
      { $dest: { id: "p" }, $row: { id: "c" } },
      ctx(),
      null,
    );
    expect(out[0]).toMatchObject({ itemId: "c", toParentId: "p" });
  });

  it("writes nothing when either side is missing, or when they are the same node", () => {
    const vars = { $row: { id: "c" } };
    expect(executeActionItem("LINK_OCCURRENCE_TO_PARENT", { childId: "$row.id" }, vars, ctx(), null)).toEqual([]);
    expect(executeActionItem("LINK_OCCURRENCE_TO_PARENT", { parentId: "$row.id" }, vars, ctx(), null)).toEqual([]);
    expect(
      executeActionItem("LINK_OCCURRENCE_TO_PARENT", { parentId: "$row.id", childId: "$row.id" }, vars, ctx(), null),
    ).toEqual([]);
  });
});
