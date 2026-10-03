// 0390: eight poms ops were stored in the seed's step dialect (action/cfg,
// conjunction). The executor reads it; the operations EDITOR does not — every
// action opened as a blank default. normalizeSteps rewrites them in the editor's
// shape, and this drives the REAL executor over the live grid fixture to show
// each op produces exactly the same effects before and after.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { normalizeSteps, hasSeedDialect } from "../../../server/utils/pipelineShape.js";

vi.setConfig({ testTimeout: 60000 });
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "pomsGrid.json.br");
let base;
beforeAll(() => { base = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString()); });

const run = (op) => {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  const ctx = { state: { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: fx.modules, operations: fx.operations }, fieldsById: by(fx.fields), modulesById: by(fx.modules), occurrencesById: by(fx.occurrences), operationsById: by(fx.operations) };
  const out = executePipeline(op, ctx, null) || [];
  return JSON.stringify(out).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
};

describe("the seed step dialect, normalized", () => {
  it("the fixture still carries dialect ops (or this test proves nothing)", () => {
    expect(base.operations.filter((o) => hasSeedDialect(o.pipeline?.steps)).length).toBeGreaterThan(3);
  });
  it("every dialect op produces the same effects in the editor's shape", () => {
    const ops = base.operations.filter((o) => hasSeedDialect(o.pipeline?.steps));
    let nonEmpty = 0;
    for (const op of ops) {
      if (run(op) !== "[]") nonEmpty++;
      const steps = normalizeSteps(op.pipeline.steps);
      expect(hasSeedDialect(steps), op.name).toBe(false);
      expect(run({ ...op, pipeline: { ...op.pipeline, steps } }), op.name).toBe(run(op));
    }
    // CONTROL: equal-and-empty proves nothing — most of them must actually write.
    expect(nonEmpty).toBeGreaterThanOrEqual(4);
  });
  it("the editor's shape: config.type carries the action, every step has an id, groups say operator", () => {
    const op = base.operations.find((o) => o.name === "Movies Watched");
    const s = normalizeSteps(op.pipeline.steps);
    expect(s[0].config.type).toBe("INIT_VAR");
    expect(s[0].action).toBeUndefined();
    const walk = (xs) => xs.flatMap((x) => [x, ...walk(x.then || []), ...walk(x.else || []), ...walk(x.body || [])]);
    expect(walk(s).every((x) => x.id)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/"conjunction"/);
  });
  it("is idempotent", () => {
    const op = base.operations.find((o) => o.name === "Movies Watched");
    const once = normalizeSteps(op.pipeline.steps);
    expect(normalizeSteps(once)).toEqual(once);
  });
});
