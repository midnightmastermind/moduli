// 0344 — un-picking deletes the Check In AND rewrites the day column without
// its embed, in the same run. Drives the migration's own steps through the REAL
// executor.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { unembedStaleCheckIn, unembedSteps }
  from "../../../server/migrations/0344-an-unpicked-check-in-leaves-no-embed.mjs";

const COL = "occ-col", WHEEL = "occ-wheel", CI = "occ-ci", OTHER = "occ-ci2";
const embed = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });

function run(colTextmap) {
  const occurrencesById = {
    [COL]: { id: COL, moduleId: "m-col", occurrences: [WHEEL, CI, OTHER], textmap: colTextmap, fields: {} },
    [WHEEL]: { id: WHEEL, moduleId: "m-w", fields: {} },
    [CI]: { id: CI, moduleId: "m-ci", fields: {} },
    [OTHER]: { id: OTHER, moduleId: "m-ci", fields: {} },
  };
  const modulesById = {
    "m-col": { id: "m-col", role: "container", kind: "doc" },
    "m-w": { id: "m-w", role: "container" }, "m-ci": { id: "m-ci", role: "instance", label: "Check In" },
  };
  const ctx = {
    state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById),
      occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [],
  };
  const find = (v, id) => ({ id: `f${v}`, type: "action", config: { type: "FIND", over: "$allOccurrences", itemVar: v,
    predicate: { operator: "AND", rules: [{ left: "id", comparator: "IS", right: id }] } } });
  const pipeline = { sources: [], steps: [find("$col", COL), find("$staleCheckIn", CI), ...unembedSteps()] };
  const out = executePipeline({ id: "op", name: "Mood", pipeline }, ctx, { type: "GraphSelectOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects.filter((e) => (e.itemId || e.occurrence?.id) === COL && (e.textmap || e.occurrence?.textmap))
    .map((e) => e.textmap || e.occurrence.textmap);
}

describe("0344 — an un-picked Check In leaves no embed", () => {
  it("removes exactly that Check In's embed and keeps everything else", () => {
    const [tm] = run({ type: "doc", content: [{ type: "paragraph" }, embed(WHEEL), embed(CI), embed(OTHER)] });
    expect(tm.content.map((n) => n.attrs?.occurrenceId || n.type)).toEqual(["paragraph", WHEEL, OTHER]);
  });

  // THE CONTROL: never write a document built from nothing.
  it("writes nothing over a column without a body", () => {
    expect(run(null)).toHaveLength(0);
  });
});

describe("the migration planner", () => {
  const op = () => ({ steps: [{ id: "t", type: "if", then: [
    { id: "d", type: "action", actionType: "DELETE", config: { itemIdExpr: "$staleCheckIn.id" } },
  ], else: [] }] });
  it("inserts right after the DELETE", () => {
    expect(unembedStaleCheckIn(op()).pipeline.steps[0].then.map((s) => s.id)).toEqual(["d", "unembedStaleCheckIn"]);
  });
  it("is idempotent", () => {
    expect(unembedStaleCheckIn(unembedStaleCheckIn(op()).pipeline).changed).toBe(0);
  });
  it("refuses without its anchor", () => {
    expect(() => unembedStaleCheckIn({ steps: [] })).toThrow(/expected exactly 1/);
  });
});
