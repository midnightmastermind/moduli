// A graph click is one undo step (helpers/graphSelect). Before this, the mood
// pick's writes carried no action id and the undo stack skipped all of them.
import { describe, it, expect, afterEach } from "vitest";
import { fireGraphSelect } from "../helpers/graphSelect";
import { getActionId, getActionLabel, _resetActionScope } from "../helpers/actionScope";
import { operationsBridge } from "../state/bindSocketToStore";

describe("fireGraphSelect", () => {
  const saved = operationsBridge.fireOperations;
  afterEach(() => { operationsBridge.fireOperations = saved; _resetActionScope?.(); });

  it("runs the op inside a user action, so its writes are undoable", () => {
    let seen = null;
    operationsBridge.fireOperations = (type, tx) => { seen = { type, tx, action: getActionId(), label: getActionLabel() }; };
    fireGraphSelect({ type: "GraphSelectOp", name: "Lonely", occurrenceId: "o1" });
    expect(seen.type).toBe("GraphSelectOp");
    expect(seen.tx.occurrenceId).toBe("o1");
    expect(seen.action).toBeTruthy();
    expect(seen.label).toBe("Selected Lonely");
  });

  it("control: outside it, no action is open", () => {
    expect(getActionId()).toBeFalsy();
  });
});
