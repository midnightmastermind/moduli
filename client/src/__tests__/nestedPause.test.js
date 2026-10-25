// A pause (a question, a form, an API call) inside an IF, a loop or a called operation WAITS for its answer and then
// runs what follows it — it used to be pushed into the parent's results and the steps after it were dropped.
import { describe, it, expect, afterEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor.js";
import { operationsBridge } from "../state/bindSocketToStore.js";

const ask = (id = "ask") => ({ id, type: "action", config: { type: "GET_USER_INPUT", question: "?" } });
const mark = (id, value) => ({ id, type: "action", config: { type: "SHOW_VALUE", name: "$m_" + id, value } });
const op = (steps, id = "op") => ({ id, name: id, enabled: true, pipeline: { steps } });

function run(operation, { answers = [], operationsById = {} } = {}) {
  const queue = [...answers];
  operationsBridge.requestUserInput = () => {
    const next = queue.shift();
    return next === "CANCEL" ? Promise.reject(new Error("cancel")) : Promise.resolve(next);
  };
  const applied = [];
  operationsBridge.applyEffect = (e) => applied.push(e);
  return new Promise((resolve) => {
    executePipeline(operation, {
      state: { grid: { _id: "g" }, modules: [], occurrences: [] },
      fieldsById: {}, occurrencesById: {}, operationsById,
      _onPipelineDone: (all) => resolve({ all, applied }),
    }, { type: "ButtonOp" });
  }).then(({ all }) => all.filter((u) => u && String(u.name || "").startsWith("$m_")).map((u) => String(u.value)));
}

afterEach(() => { operationsBridge.requestUserInput = null; operationsBridge.applyEffect = null; });

describe("a pause anywhere in an operation", () => {
  it("top level: waits, then runs what follows (unchanged)", async () => {
    expect(await run(op([ask(), mark("a", "after")]), { answers: ["x"] })).toEqual(["after"]);
  });

  it("inside IF: the rest of the branch AND the steps after the IF run, in order", async () => {
    const pipeline = op([
      { id: "if1", type: "if", condition: { operator: "AND", rules: [] }, then: [ask(), mark("t", "after-ask")], else: [] },
      mark("b", "after-if"),
    ]);
    expect(await run(pipeline, { answers: ["x"] })).toEqual(["after-ask", "after-if"]);
  });

  it("inside a loop: one pause per item, each iteration finishes, then the step after the loop", async () => {
    const pipeline = op([
      { id: "l1", type: "loop", overExpr: "$items", as: "$it", body: [ask(), mark("i", "${$it}:${$userInput}")] },
      mark("d", "done"),
    ]);
    pipeline.pipeline.steps.unshift({ id: "init", type: "action", config: { type: "INIT_VAR", name: "$items", value: "json:[1,2,3]" } });
    expect(await run(pipeline, { answers: ["a", "b", "c"] })).toEqual(["1:a", "2:b", "3:c", "done"]);
  });

  it("cancelling inside a loop stops everything after it", async () => {
    const pipeline = op([
      { id: "init", type: "action", config: { type: "INIT_VAR", name: "$items", value: "json:[1,2,3]" } },
      { id: "l1", type: "loop", overExpr: "$items", as: "$it", body: [ask(), mark("i", "${$it}")] },
      mark("d", "done"),
    ]);
    expect(await run(pipeline, { answers: ["a", "CANCEL"] })).toEqual(["1"]);
  });

  it("inside a called operation: the caller waits for the callee, and keeps its own variables", async () => {
    const callee = op([ask(), mark("c", "callee-after")], "callee");
    const caller = op([
      { id: "v", type: "action", config: { type: "INIT_VAR", name: "$who", value: "caller" } },
      { id: "r", type: "action", config: { type: "RUN_OPERATION", operationId: "callee" } },
      mark("k", "${$who}-after"),
    ], "caller");
    expect(await run(caller, { answers: ["x"], operationsById: { callee } })).toEqual(["callee-after", "caller-after"]);
  });
});
