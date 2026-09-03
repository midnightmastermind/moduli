// CAN A PROJECTED CATALOGUE ROW STAND IN FOR THE FULL ONE?
//
// The load's largest remaining item is the catalogue's bytes: the device's load
// line shows nothing between `contentReady=2422ms` and the first chunk at
// `rest=7571ms` except socket.io receiving, inflating and parsing the frame,
// and `restWrite=0ms` says the store write itself is free.
//
// Projecting rows down to what the grid's declarations reference cuts them from
// 15.33 MB to ~3.9 MB — but only if nothing NOTICES. Two things read these rows
// before anything renders them, and both are checked here against the live
// grid's own data rather than a fixture written to pass:
//
//   1. the load sweep — 71 real pipelines, byte-identical effects required
//   2. every find-mode dropdown — identical option lists required
//
// THIS IS THE GATE THAT REPLACES A URL FLAG. The previous two load changes were
// shipped opt-in and measured on the device; this one ships on, so the proof has
// to be here.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { splitFullState } from "../../../server/utils/splitFullState.js";
import { makeReferenceTest, projectDeferredRows } from "../../../server/utils/deferredProjection.js";

vi.setConfig({ testTimeout: 180000 });

const here = path.dirname(fileURLToPath(import.meta.url));
let fx, operations, split, isReferenced, projected, fullRows;

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
  operations = fx.operations.filter((o) => o.enabled !== false);
  split = splitFullState(fx.occurrences, fx.modules);
  isReferenced = makeReferenceTest({ operations: fx.operations, fields: fx.fields, grid: fx.grid });
  projected = projectDeferredRows(split.deferred, isReferenced);
  fullRows = split.deferred;
});

function buildCtx(occList) {
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(occList.map((o) => [o.id, structuredClone(o)]));
  const operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  const state = {
    grid: fx.grid, gridId: fx.grid?._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  };
  return { state, fieldsById, operationsById, occurrencesById, modulesById };
}

/** Generated ids tokenised by first appearance, so relationships are pinned too. */
function tokenise(updates) {
  const GEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{13}-[a-z0-9]{9,}\b/g;
  const seen = new Map();
  return JSON.stringify(updates).replace(GEN, (id) => {
    if (!seen.has(id)) seen.set(id, `«g${seen.size}»`);
    return seen.get(id);
  });
}

describe("a projected catalogue row stands in for the full one", () => {
  it("the projection actually removes something — the control", () => {
    // Without this every assertion below is vacuously true.
    const size = (x) => Buffer.byteLength(JSON.stringify(x));
    const before = size(fullRows), after = size(projected);
    expect(fullRows.length).toBeGreaterThan(1000);
    // MEASURED ON WHAT THE PROJECTION TARGETS, not on the whole row. The rest
    // of a row is structural keys and nulls, and the nulls are `omitNullKeys`'s
    // job at the emit site — asserting a whole-row halving here would be
    // measuring the wrong thing and would fail for a reason unrelated to this.
    const part = (rows, k) => size(rows.map((r) => r[k] || {}));
    const f0 = part(fullRows, "fields"), f1 = part(projected, "fields");
    const m0 = part(fullRows, "meta"), m1 = part(projected, "meta");
    console.log(`deferred rows ${fullRows.length}: ${(before / 1048576).toFixed(2)}MB -> `
      + `${(after / 1048576).toFixed(2)}MB (${((after / before) * 100).toFixed(0)}%)   `
      + `fields ${(f0 / 1048576).toFixed(2)}->${(f1 / 1048576).toFixed(2)}MB   `
      + `meta ${(m0 / 1048576).toFixed(2)}->${(m1 / 1048576).toFixed(2)}MB`);
    expect(f1).toBeLessThan(f0 * 0.5);
    expect(m1).toBeLessThan(m0 * 0.6);
    expect(after).toBeLessThan(before);
  });

  it("keeps every field the grid's declarations reference, and drops the rest", () => {
    const kept = new Set(), dropped = new Set();
    for (let i = 0; i < fullRows.length; i++) {
      for (const k of Object.keys(fullRows[i].fields || {})) {
        (projected[i].fields?.[k] !== undefined ? kept : dropped).add(k);
      }
    }
    // Nothing kept may be unreferenced, and nothing dropped may be referenced —
    // the second is the one that would silently break an operation.
    for (const k of kept) expect(isReferenced(k)).toBe(true);
    for (const k of dropped) expect(isReferenced(k)).toBe(false);
    expect(kept.size).toBeGreaterThan(0);
    expect(dropped.size).toBeGreaterThan(0);
  });

  it("THE SWEEP EMITS BYTE-IDENTICAL EFFECTS over projected rows", () => {
    // `Daily Question Rotator` picks at random, so the pin is what separates
    // "the sweep is random" from "the projection changed the answer", and it is
    // asserted to be CONSULTED so it cannot go decorative.
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.42);
    const withFull = runMatchingOperations(operations, null, null,
      buildCtx([...split.core, ...fullRows]), {});
    const withSlim = runMatchingOperations(operations, null, null,
      buildCtx([...split.core, ...projected]), {});
    expect(rnd.mock.calls.length).toBeGreaterThan(0);
    rnd.mockRestore();
    expect(withFull.length).toBeGreaterThan(100);
    expect(tokenise(withSlim)).toBe(tokenise(withFull));
  });

  it("EVERY find-mode dropdown resolves an identical option list", async () => {
    // 60% of the option pool is the catalogue (2026-09-01 (3)), so this is the
    // half a sweep-only check would miss — and an ancestor-scoped dropdown
    // silently resolving to ZERO options is a documented failure here.
    const { resolveOptions } = await import("../helpers/optionsResolver");
    const mk = (rows) => ({
      occurrencesById: Object.fromEntries(rows.map((o) => [o.id, o])),
      modulesById: Object.fromEntries(fx.modules.map((m) => [m.id, m])),
      fieldsById: Object.fromEntries(fx.fields.map((f) => [f.id, f])),
    });
    const A = mk([...split.core, ...fullRows]), B = mk([...split.core, ...projected]);
    const findFields = fx.fields.filter((f) => f.meta?.optionsSource?.mode === "find");
    expect(findFields.length).toBeGreaterThan(10);   // control: there ARE some
    let nonEmpty = 0;
    for (const f of findFields) {
      // `resolveOptions` returns `{ options, totalMatched }`, not an array.
      const a = resolveOptions(f, A)?.options || [], b = resolveOptions(f, B)?.options || [];
      if (a.length) nonEmpty++;
      expect(b.map((o) => o?.value ?? o)).toEqual(a.map((o) => o?.value ?? o));
    }
    // And a pool that is empty on BOTH sides proves nothing — at least some
    // must actually resolve, or "identical" is two empty lists.
    expect(nonEmpty).toBeGreaterThan(5);
  });
});
