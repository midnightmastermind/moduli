// A button press names its operation (helpers/operationExecutor matchesTrigger).
// Found rebuilding a grid through the UI, 2026-09-21: the row widget and the
// `button` field both stamp `operationId` on their ButtonOp and nothing read
// it, so one press ran EVERY onButton op, and an op whose onButton trigger was
// scoped to a field could never run from a widget.
import { describe, it, expect } from "vitest";
import { computeTriggerMatch } from "../helpers/operationExecutor";

const op = (id, subject = { subjectType: "grid", targetId: "" }) => ({
  id, enabled: true, triggerTypes: ["onButton"],
  triggerObjects: [{ eventType: "onButton", ...subject }],
});
const press = (operationId) => ({ type: "ButtonOp", operationId, instanceId: "i1", occurrenceId: "o1" });

describe("ButtonOp matches only the operation it names", () => {
  it("runs the pressed op", () => {
    expect(computeTriggerMatch(op("a"), "ButtonOp", press("a"))).toBeTruthy();
  });

  it("does not run a different onButton op", () => {
    expect(computeTriggerMatch(op("b"), "ButtonOp", press("a"))).toBe(false);
  });

  it("runs the pressed op even when its trigger is scoped to a field", () => {
    const scoped = op("a", { subjectType: "field", targetId: "f1" });
    expect(computeTriggerMatch(scoped, "ButtonOp", press("a"))).toBeTruthy();
  });

  it("still needs an onButton trigger — naming an onChange op runs nothing", () => {
    const other = { id: "a", enabled: true, triggerTypes: ["onChange"], triggerObjects: [] };
    expect(computeTriggerMatch(other, "ButtonOp", press("a"))).toBe(false);
  });

  it("a disabled op stays off", () => {
    expect(computeTriggerMatch({ ...op("a"), enabled: false }, "ButtonOp", press("a"))).toBe(false);
  });

  it("CONTROL: an unnamed ButtonOp keeps the subject-filter behaviour", () => {
    expect(computeTriggerMatch(op("b"), "ButtonOp", { type: "ButtonOp" })).toBeTruthy();
  });
});

import { buttonOperations } from "../ui/commandCenter/FieldsTab";

describe("buttonOperations (the Fields tab's picker list)", () => {
  it("lists only onButton operations, alarms excluded, by name", () => {
    const ops = [
      { id: "z", name: "Zeta", triggerTypes: ["onButton"] },
      { id: "c", name: "Change", triggerTypes: ["onChange"] },
      { id: "a", name: "Alpha", triggerType: "onButton" },
      { id: "al", name: "Alarm", triggerTypes: ["onButton"], alarm: { time: "07:00" } },
    ];
    expect(buttonOperations(ops).map(o => o.id)).toEqual(["a", "z"]);
  });
});
