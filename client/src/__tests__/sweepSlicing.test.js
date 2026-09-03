// __tests__/sweepSlicing.test.js
//
// THE OP SWEEP, DRIVEN TWO WAYS, OVER THE LIVE GRID'S OWN PIPELINES.
//
// The load sweep is ~68 ops in ONE synchronous task. On the device it measured
// `load:1x2544ms/231fx` — a two-and-a-half-second freeze that a finger already
// on the screen cannot interrupt, which is what a 150ms lift timer arriving at
// 5,268ms (`via=move-late`) reports.
//
// `runMatchingOperationsSliced` yields between ops so the browser can paint and
// deliver input. It shares ONE generator body with the synchronous driver,
// because two implementations of a sweep is how they drift — and this is the
// shared execute path this repo has been damaged on repeatedly.
//
// SO THE TEST THAT MATTERS IS EQUIVALENCE, not that slicing "works": the two
// drivers must produce byte-identical effects over the real fixture. A refactor
// that quietly changed one op's output would be invisible to every other suite
// here, because they all drive the sync path.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, runMatchingOperationsSliced } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 120000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let fx, operations;

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  operations = fx.operations.filter(o => o.enabled !== false);
});

/** A FRESH context per run — `_parentByChildId` and `_allItemsCache` are
 *  memoised onto the object, and `liveOccs` is copied from it. Sharing one
 *  would let the first run seed the second and hide a real divergence. */
function buildCtx() {
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  const state = {
    grid: fx.grid, gridId: fx.grid?._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  };
  return { state, fieldsById, operationsById, occurrencesById, modulesById };
}

/** Replace every generated id with a token, numbered by first appearance. */
function tokenise(updates) {
  const GENERATED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{13}-[a-z0-9]{9,}\b/g;
  const seen = new Map();
  return JSON.stringify(updates).replace(GENERATED, (id) => {
    if (!seen.has(id)) seen.set(id, `«gen${seen.size}»`);
    return seen.get(id);
  });
}

describe("the two drivers agree", () => {
  let sync, sliced, syncEmitters, slicedEmitters, rnd;

  it("both actually run the grid's operations — the control", async () => {
    // Without this every assertion below is vacuously true: two sweeps that
    // matched nothing agree perfectly. This is the trap `pomsGridOps` records
    // making its own load-sweep test pass against a planted throwing pipeline.
    //
    // THE SWEEP IS NOT DETERMINISTIC ON ITS OWN, and finding that out is what
    // made this test meaningful. The first comparison failed on a single
    // effect: `Daily Question Rotator` picks a question at random, so two runs
    // of the SAME driver disagree there too. Pinning `Math.random` is what
    // separates "the sweep is random" from "slicing changed the answer" —
    // without it this assertion is either flaky or has to be weakened into
    // something that could not catch a real divergence.
    rnd = vi.spyOn(Math, "random").mockReturnValue(0.42);
    syncEmitters = []; slicedEmitters = [];
    sync = runMatchingOperations(operations, null, null, buildCtx(),
      { onSuccess: (name, e) => syncEmitters.push(`${name}:${e.length}`) });
    sliced = await runMatchingOperationsSliced(operations, null, null, buildCtx(),
      { onSuccess: (name, e) => slicedEmitters.push(`${name}:${e.length}`) });
    expect(syncEmitters.length).toBeGreaterThan(20);
    expect(slicedEmitters.length).toBeGreaterThan(20);
    // and the pin is load-bearing rather than decorative — the sweep really
    // does consult it, so removing it would make this suite flaky, not stricter.
    expect(rnd.mock.calls.length).toBeGreaterThan(0);
    rnd.mockRestore();
  });

  it("emit the same effects, in the same order, from the same ops", () => {
    // Order is load-bearing: the ops are priority-sorted and each one's effects
    // are visible to the next through `liveOccs`.
    expect(slicedEmitters).toEqual(syncEmitters);
    expect(sliced.length).toBe(sync.length);
    // A RAW COMPARE CAN NEVER MATCH: a CREATE_ITEM mints a fresh uuid per run,
    // so the two sweeps legitimately differ on every generated id. Migration
    // `0274` hit this exact wall and reported a rewrite on every run until it
    // stripped them.
    //
    // Tokenising by order of first appearance is STRONGER than stripping: a
    // minted id referenced later as a `parentId` maps to the same token in both
    // runs, so this also pins that the RELATIONSHIPS between created rows are
    // identical — which stripping would silently discard.
    expect(tokenise(sliced)).toBe(tokenise(sync));
  });
});

describe("the slicing itself", () => {
  it("yields between ops, and a zero budget still completes", async () => {
    // do/while means one op minimum per slice — a budget under the cost of a
    // single op must not spin forever. `sliceWork.js` records the first attempt
    // at this defect, where 194 slices ran for 195 items.
    let yields = 0;
    const out = await runMatchingOperationsSliced(operations, null, null, buildCtx(), {},
      { budgetMs: 0, yieldFn: async () => { yields++; } });
    expect(Array.isArray(out)).toBe(true);
    expect(yields).toBeGreaterThan(10);          // it really did slice
  });

  it("a budget larger than the whole sweep yields NOT AT ALL", async () => {
    // The control for the case above: without it, "it yields" could be true of
    // a driver that yields unconditionally and the budget would mean nothing.
    let yields = 0;
    await runMatchingOperationsSliced(operations, null, null, buildCtx(), {},
      { budgetMs: 10 * 60 * 1000, yieldFn: async () => { yields++; } });
    expect(yields).toBe(0);
  });

  it("runs EVERY step inside the caller's scope", async () => {
    // The load sweep is derived, and `runDerived` restores on RETURN — so a
    // continuation that resumed outside the scope would open an undo action per
    // write. That is 2026-08-27 (3): a page load pushing 26 undo steps, so
    // Ctrl+Z reverted a tracker recomputation instead of the user's last edit.
    let inside = 0, steps = 0;
    await runMatchingOperationsSliced(operations, null, null, buildCtx(), {},
      { budgetMs: 0, yieldFn: async () => {}, wrap: (fn) => { inside++; const r = fn(); steps++; return r; } });
    expect(steps).toBeGreaterThan(10);
    expect(inside).toBe(steps);                  // never a step outside the wrap
  });

  it("returns the sweep's updates through the wrap, not undefined", async () => {
    // `wrap` sits between the driver and the generator; a wrap that dropped the
    // return value would end the sweep silently on its first step.
    const out = await runMatchingOperationsSliced(operations, null, null, buildCtx(), {},
      { budgetMs: 0, yieldFn: async () => {}, wrap: (fn) => fn() });
    expect(out.length).toBeGreaterThan(0);
  });
});
