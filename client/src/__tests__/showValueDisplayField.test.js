// __tests__/showValueDisplayField.test.js
//
// "Display → field" authored in the Operations builder did NOTHING. Built on
// prod 2026-09-21 by clicking: INIT_VAR $total = 0 → LOOP $allInstances →
// ADD_TO_VAR $total += $item.fields.<Glasses>.value → Display → field. The run
// history showed the loop reaching 3 (the value typed into the instance), and
// the row still read `Total Water: 0` with `computedValues` empty.
//
// Three UI surfaces speak one config and the executor speaks another:
//
//   ui/actionTree.js       "Display → field" · "Write computed value to a display field"
//   OperationsBuilder.jsx  writes { targetFieldId, sourceExpr }
//   OperationLogPanel.jsx  renders cfg.targetFieldId and cfg.sourceExpr
//   operationActions.js    reads  { name, value }          <- the odd one out
//
// So the field picker's value was never read and the action staged
// { name: "$result", value: undefined }. A mis-keyed config does not fail
// closed — it runs and produces nothing, which is the same class as the
// `step.condition` vs `step.predicate` trap recorded in server/CLAUDE.md.
//
// The staging half is LIVE on poms grid ("Import from Wikipedia" stores
// { name: "$importedTitle", value: "$importResp.source.title" }), so it has a
// control here: SHOW_VALUE without a target field must keep staging exactly
// as before.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const ctx = (extra = {}) => ({
  state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {}, ...extra,
});

describe("SHOW_VALUE publishes to the display field its own editor picks", () => {
  it("emits UPDATE_DISPLAY_VALUE for the picked field", () => {
    const updates = executeActionItem("SHOW_VALUE", {
      targetFieldId: "f_total_water",
      sourceExpr: "$total",
    }, { $total: 3 }, ctx());
    const disp = updates.find((u) => u._effect === "UPDATE_DISPLAY_VALUE");
    expect(disp, "no UPDATE_DISPLAY_VALUE — the picked field was never written").toBeTruthy();
    expect(disp.fieldId).toBe("f_total_water");
    expect(disp.value).toBe(3);
  });

  it("resolves the expression rather than publishing its text", () => {
    const updates = executeActionItem("SHOW_VALUE", {
      targetFieldId: "f_total_water", sourceExpr: "$total",
    }, { $total: 42 }, ctx());
    expect(updates.find((u) => u._effect === "UPDATE_DISPLAY_VALUE").value).toBe(42);
  });

  it("scopes to one occurrence when the config names one", () => {
    const updates = executeActionItem("SHOW_VALUE", {
      targetFieldId: "f_total_water", sourceExpr: "$total", targetItemId: "occ-1",
    }, { $total: 3 }, ctx());
    expect(updates.find((u) => u._effect === "UPDATE_DISPLAY_VALUE").itemId).toBe("occ-1");
  });

  it("publishes grid-wide (itemId null) when no occurrence is named", () => {
    // masterReducer keys computedValues by `fieldId` alone when occurrenceId is
    // falsy, so every binding of the field renders it. That is what the
    // builder's field-only editor can express.
    const updates = executeActionItem("SHOW_VALUE", {
      targetFieldId: "f_total_water", sourceExpr: "$total",
    }, { $total: 3 }, ctx());
    expect(updates.find((u) => u._effect === "UPDATE_DISPLAY_VALUE").itemId ?? null).toBe(null);
  });

  it("still stages the result for the API bridge and the log panel", () => {
    const updates = executeActionItem("SHOW_VALUE", {
      targetFieldId: "f_total_water", sourceExpr: "$total",
    }, { $total: 3 }, ctx());
    const staged = updates.find((u) => u._effect === "SHOW_VALUE");
    expect(staged, "the staged result disappeared").toBeTruthy();
    expect(staged.value).toBe(3);
  });
});

describe("the staging-only shape is untouched", () => {
  // THE CONTROL. poms grid's "Import from Wikipedia" stores exactly this, and
  // /api/v1/operations/:id/run surfaces it under `vars`. If this stops working
  // the fix has traded one broken action for another.
  it("stages { name, value } and writes no display value", () => {
    const updates = executeActionItem("SHOW_VALUE", {
      name: "$importedTitle", value: "$importResp.title",
    }, { $importResp: { title: "Eminem" } }, ctx());
    const staged = updates.find((u) => u._effect === "SHOW_VALUE");
    expect(staged.name).toBe("$importedTitle");
    expect(staged.value).toBe("Eminem");
    expect(updates.find((u) => u._effect === "UPDATE_DISPLAY_VALUE")).toBeUndefined();
  });

  it("defaults the staged name to $result", () => {
    const updates = executeActionItem("SHOW_VALUE", { value: "x" }, {}, ctx());
    expect(updates.find((u) => u._effect === "SHOW_VALUE").name).toBe("$result");
  });

  it("prefixes a bare name with $", () => {
    const updates = executeActionItem("SHOW_VALUE", { name: "total", value: 1 }, {}, ctx());
    expect(updates.find((u) => u._effect === "SHOW_VALUE").name).toBe("$total");
  });
});
