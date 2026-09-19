// 0343 — the Check In the Mood op creates must be EMBEDDED in the day column's
// textmap in the same run, or it is listed and invisible until a reload.
// Drives the migration's own steps through the REAL executor.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { embedNewCheckIn, embedSteps }
  from "../../../server/migrations/0343-a-check-in-appears-the-moment-it-is-picked.mjs";

const COL = "occ-col", WHEEL = "occ-wheel", CI = "occ-checkin";

function run(colTextmap) {
  const occurrencesById = {
    [COL]: { id: COL, moduleId: "m-col", occurrences: [WHEEL, CI], textmap: colTextmap, fields: {} },
    [WHEEL]: { id: WHEEL, moduleId: "m-wheel", fields: {} },
    [CI]: { id: CI, moduleId: "m-ci", parentId: COL, fields: {} },
  };
  const modulesById = {
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Friday" },
    "m-wheel": { id: "m-wheel", role: "container", label: "Emotions Wheel" },
    "m-ci": { id: "m-ci", role: "instance", label: "Check In" },
  };
  const grid = { _id: "g" };
  const ctx = {
    state: { grid, gridId: "g", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById,
      fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [],
  };
  const pipeline = { sources: [], steps: [
    { id: "f", type: "action", config: { type: "FIND", over: "$allOccurrences", itemVar: "$col",
      predicate: { operator: "AND", rules: [{ left: "id", comparator: "IS", right: COL }] } } },
    { id: "n", type: "action", config: { type: "INIT_VAR", name: "$newCheckIn", expr: `literal:${CI}` } },
    ...embedSteps(),
  ] };
  const out = executePipeline({ id: "op", name: "Mood", pipeline }, ctx, { type: "GraphSelectOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects.filter((e) => (e.itemId || e.occurrence?.id) === COL && (e.textmap || e.occurrence?.textmap));
}

const body = [
  { type: "paragraph" },
  { type: "moduleEmbed", attrs: { occurrenceId: WHEEL } },
];

describe("0343 — a picked emotion's Check In is embedded in the same run", () => {
  it("appends the Check In's embed after the column's existing body", () => {
    const writes = run({ type: "doc", content: body });
    expect(writes).toHaveLength(1);
    const tm = writes[0].textmap || writes[0].occurrence.textmap;
    expect(tm.content.map((n) => n.attrs?.occurrenceId || n.type))
      .toEqual(["paragraph", WHEEL, CI]);
  });

  // THE CONTROL: the wheel and the rest survive — a write of ONLY the check-in
  // is the failure this guard exists for.
  it("never writes over a column that has no body", () => {
    expect(run(null)).toHaveLength(0);
    expect(run({ type: "doc", content: [] })).toHaveLength(0);
  });
});

describe("the migration planner", () => {
  const moodOp = () => ({ steps: [{ id: "t", type: "if", condition: {}, then: [], else: [
    { id: "c", type: "action", actionType: "COPY_LINK", config: { parent: "$col.id", itemIdVar: "$newCheckIn" } },
    { id: "after", type: "action", actionType: "RUN_OPERATION", config: {} },
  ] }] });

  it("inserts the embed directly after the COPY_LINK", () => {
    const { pipeline } = embedNewCheckIn(moodOp());
    expect(pipeline.steps[0].else.map((s) => s.id)).toEqual(["c", "embedNewCheckIn", "after"]);
  });

  it("is idempotent", () => {
    const once = embedNewCheckIn(moodOp()).pipeline;
    expect(embedNewCheckIn(once).changed).toBe(0);
  });

  it("refuses when the COPY_LINK is not found", () => {
    expect(() => embedNewCheckIn({ steps: [] })).toThrow(/expected exactly 1/);
  });
});
