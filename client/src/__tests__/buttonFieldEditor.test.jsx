// A button field's settings make its operation: one press of "New operation for this button".
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
vi.mock("../helpers/CommitHelpers", () => ({
  createOperation: (args) => calls.push(["createOperation", args, actionId()]),
}));
import { getActionId } from "../helpers/actionScope";
const actionId = () => getActionId();

import { makeButtonOperation, createButtonOperation, takeRequestedOperation } from "../helpers/buttonOperation.js";
import { orderButtonOperationChoices } from "../ui/commandCenter/FieldsTab.jsx";

beforeEach(() => { calls.length = 0; });

describe("New operation for this button", () => {
  const field = { id: "f9", name: "New movie", type: "button", meta: { buttonLabel: "Add movie" } };

  it("an onButton operation on this field, named for the button", () => {
    const op = makeButtonOperation(field, { gridId: "g", id: "op1" });
    expect(op).toMatchObject({
      id: "op1", gridId: "g", name: "Add movie", enabled: true, triggerTypes: ["onButton"],
      triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: "f9" }],
      pipeline: { sources: [], steps: [] },
    });
    expect(makeButtonOperation({ ...field, meta: {} }, { gridId: "g" }).name).toBe("New movie");
  });

  it("creates it and points the field at it, in one action, then asks to open it", () => {
    const onSave = vi.fn((f) => calls.push(["save", f, actionId()]));
    const id = createButtonOperation({ field, gridId: "g", dispatch: () => {}, socket: null, onSave });
    expect(calls.map((c) => c[0])).toEqual(["createOperation", "save"]);
    expect(calls[0][1].operation.id).toBe(id);
    expect(calls[1][1].meta).toMatchObject({ buttonLabel: "Add movie", operationId: id });
    expect(calls[0][2]).toBeTruthy();
    expect(calls[1][2]).toBe(calls[0][2]);
    expect(takeRequestedOperation()).toBe(id);
    expect(takeRequestedOperation()).toBe(null);
  });
});

describe("the operation picker", () => {
  it("lists button operations first, then the rest under Other", () => {
    const ops = [
      { id: "a", name: "Zed", triggerTypes: ["onButton"] },
      { id: "b", name: "Alpha", triggerTypes: ["onLoad"] },
      { id: "c", name: "Beta", triggerTypes: ["onButton"] },
      { id: "d", name: "Alarm", alarm: { time: "1" }, triggerTypes: ["onButton"] },
    ];
    expect(orderButtonOperationChoices(ops)).toEqual({ button: ["c", "a"], other: ["b"] });
  });
});
