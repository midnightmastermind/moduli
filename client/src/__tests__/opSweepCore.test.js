// The worker's sweep must produce the page's effects: run over the poms fixture after a structured-clone
// round trip (what a worker receives), compared with the page's own runMatchingOperations on the same data.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { runSweepSnapshot, workerSafeOp } from "../helpers/opSweepCore";

vi.setConfig({ testTimeout: 120000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
// Random picks (Daily Question) and wall-clock stamps differ run to run; compare everything else.
// Every minted id (random UUIDs) is replaced by its first-seen ORDER, so two runs that mint in the same
// order compare equal; wall-clock stamps are dropped.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const normAll = (list) => { const seen = new Map(); return list.map((u) => JSON.stringify(u, (k, v) => (k === "timestamp" ? undefined : v)).replace(UUID, (m) => { if (!seen.has(m)) seen.set(m, `#${seen.size}`); return seen.get(m); })); };
const pageSweep = () => {
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const operationsById = Object.fromEntries(fx.operations.map((o) => [o.id, o]));
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map((o) => [o.id, { ...o }]));
  const state = { ...fx, grid: fx.grid, gridId: fx.grid._id, occurrencesById, operations: fx.operations, fields: fx.fields };
  return runMatchingOperations(fx.operations, null, null, { state, fieldsById, operationsById, occurrencesById, modulesById });
};
const sameShare = (a, b) => { const x = normAll(a), y = normAll(b); return x.filter((v, i) => v === y[i]).length / Math.max(x.length, 1); };

describe("op sweep in a worker", () => {
  it("produces the same effects as the page's sweep", () => {
    const snap = structuredClone({ occurrences: fx.occurrences, modules: fx.modules, fields: fx.fields, operations: fx.operations,
      grid: fx.grid, gridId: fx.grid._id, folders: fx.folders || [] });
    const fromWorker = runSweepSnapshot(snap);
    const onPage = pageSweep(), onPage2 = pageSweep();
    expect(fromWorker.updates.length).toBeGreaterThan(20);
    expect(fromWorker.updates.length).toBe(onPage.length);
    const baseline = sameShare(onPage, onPage2), got = sameShare(fromWorker.updates, onPage);
    if (process.env.SWEEP_REPORT) writeFileSync(process.env.SWEEP_REPORT, `page vs page ${baseline.toFixed(3)} · worker vs page ${got.toFixed(3)} · n ${onPage.length}`);
    expect(got).toBeGreaterThanOrEqual(baseline - 0.01);
    expect(fromWorker.ran.length).toBeGreaterThan(0);
    expect(fromWorker.errors).toEqual([]);
    expect(() => structuredClone(fromWorker)).not.toThrow(); // the result must cross back to the page
  });
  it("keeps ops that need the page out of the worker", () => {
    expect(workerSafeOp({ pipeline: { steps: [{ type: "action", config: { type: "SET_VAR" } }] } })).toBe(true);
    expect(workerSafeOp({ pipeline: { steps: [{ type: "if", then: [{ config: { type: "GET_USER_INPUT" } }] }] } })).toBe(false);
    expect(workerSafeOp({ pipeline: { steps: [{ type: "loop", body: [{ config: { type: "NOTIFY" } }] }] } })).toBe(false);
    expect(workerSafeOp({ pipeline: { steps: [{ config: { type: "CALL_API" } }] } })).toBe(false);
  });
});

import { loadSweepWorkerSafe } from "../helpers/opSweepCore";
describe("which load sweeps may run in the worker", () => {
  const load = (name, steps) => ({ id: name, name, enabled: true, triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "" }], triggerTypes: ["onLoad"], pipeline: { steps } });
  // Shaped like helpers/alarmOps.buildAlarmOperation: an explicitly EMPTY triggerTypes means "scheduler only".
  const alarm = { id: "al", name: "Alarm", enabled: true, schedule: { atTimes: ["17:00"] }, triggerObjects: [], triggerTypes: [], triggerType: "manual", pipeline: { steps: [{ config: { type: "NOTIFY" } }] } };
  it("ignores an op the load never runs (an alarm)", () => {
    expect(loadSweepWorkerSafe([load("a", [{ config: { type: "SET_VAR" } }]), alarm])).toBe(true);
  });
  it("refuses when a load op, or one it calls, needs the page", () => {
    expect(loadSweepWorkerSafe([load("a", [{ config: { type: "NOTIFY" } }])])).toBe(false);
    const callee = { id: "c", name: "Callee", enabled: true, triggerObjects: [], pipeline: { steps: [{ config: { type: "GET_USER_INPUT" } }] } };
    expect(loadSweepWorkerSafe([load("a", [{ config: { type: "RUN_OPERATION", operationName: "Callee" } }]), callee])).toBe(false);
  });
  it("the poms fixture's load sweep can run in the worker", () => {
    expect(loadSweepWorkerSafe(fx.operations)).toBe(true);
  });
});
