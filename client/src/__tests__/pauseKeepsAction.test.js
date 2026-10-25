// A paused operation resumes INSIDE the action that was open when it paused, so a button press → form → Create
// is one undo step (2026-10-25: the Create after a form was a derived write, Ctrl+Z skipped it and undid the
// step before).
import { describe, it, expect, afterEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor.js";
import { operationsBridge } from "../state/bindSocketToStore.js";
import { withAction, getActionId, _resetActionScope, setActionCloseHook } from "../helpers/actionScope.js";

const op = { id: "op", name: "op", enabled: true, pipeline: { steps: [
  { id: "f", type: "action", config: { type: "ASK_FORM", items: [{ key: "name", label: "Name", type: "text" }] } },
  { id: "s", type: "action", config: { type: "SHOW_VALUE", name: "$m_after", value: "$form.values.name" } },
] } };

afterEach(() => { operationsBridge.requestUserInput = null; operationsBridge.applyEffect = null; _resetActionScope(); });

function press(answer) {
  const seen = [];
  operationsBridge.requestUserInput = () => (answer === "CANCEL" ? Promise.reject(new Error("cancel")) : Promise.resolve(answer));
  operationsBridge.applyEffect = (eff) => seen.push({ eff, actionId: getActionId() });
  let pressId = null;
  const done = new Promise((resolve) => {
    withAction("Pressed op", () => {
      pressId = getActionId();
      executePipeline(op, { state: { grid: { _id: "g" }, modules: [], occurrences: [] }, fieldsById: {}, occurrencesById: {}, operationsById: {},
        _onPipelineDone: () => resolve() }, { type: "ButtonOp" });
    });
  });
  return done.then(() => ({ pressId, seen }));
}

describe("a pause keeps its action", () => {
  it("the steps after a form run under the press's action", async () => {
    const { pressId, seen } = await press({ name: "Dune" });
    expect(pressId).toBeTruthy();
    const after = seen.find((s) => s.eff?.name === "$m_after");
    expect(after?.eff.value).toBe("Dune");
    expect(after.actionId).toBe(pressId);
    expect(getActionId()).toBeNull(); // and nothing is left open afterwards
  });

  it("the close signal waits until the continuation is done", async () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    const { pressId } = await press({ name: "x" });
    expect(closed).toContain(pressId);
  });

  it("a cancel still releases it", async () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    const { pressId, seen } = await press("CANCEL");
    expect(seen.find((s) => s.eff?.name === "$m_after")).toBeUndefined();
    expect(closed).toContain(pressId);
  });
});
