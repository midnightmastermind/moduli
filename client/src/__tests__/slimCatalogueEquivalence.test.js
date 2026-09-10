// CAN THE ARTIFACT CATALOGUE SHIP WITH ONLY THE FIELDS ANYTHING READS?
//
// The artifact rows are 16.16 MB of a 21.74 MB occurrence payload — 74% of it,
// 15,709 of 21,333 rows — and `ops:start` on the device is most of a 30-second
// load tail spent waiting for them. `splitFullState` already defers them; this
// asks the next question, which is whether they need to be FULL.
//
// Measured on the live grid, the derived keep-set leaves artifacts carrying
// THREE fields — Board Category, Owned, Tags — and drops seventeen (Artist,
// URL, Album, Songs, File Path, Drive, Cover, Saved, Size, Year …):
//
//   artifact rows        16.16 MB -> 3.73 MB   (-77%)
//   whole payload        21.74 MB -> 9.32 MB   (-57%)
//
// WHAT THIS FILE DECIDES, and what it deliberately does not. It decides that the
// LOAD SWEEP is indifferent to the dropped fields — 370 effects either way,
// byte-identical over the grid's own pipelines. It says NOTHING about what a
// board RENDERS: `Artist` and `Album` are read by the card, not by any op, which
// is exactly why a projection has to be paired with fetching full rows when a
// board is opened. Do not read a green run here as "the fields are unused".
//
// THE KEEP-SET IS DERIVED, NEVER WRITTEN DOWN — from the grid's own operation
// pipelines, its dropdowns' `optionsSource` predicates, and its filter fields.
// A hand-listed keep-set is one migration away from silently starving an op, and
// the count has ALREADY moved: this was four fields on 2026-09-03 (`Episodes`
// was referenced then and is not now).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { stripDayColumns } from "./freshDay";

vi.setConfig({ testTimeout: 300000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let fx, operations, fieldById, modById, keep;
const roleOf = (o) => o.role || modById[o.moduleId]?.role || null;

/** Every field id the grid DECLARES an interest in, from its own records. */
function deriveKeepSet(f) {
  const out = new Set();
  const add = (fid) => { if (fieldById[fid]) out.add(fid); };
  const scan = (obj) => {
    for (const m of JSON.stringify(obj || {}).matchAll(/fields\.([A-Za-z0-9_-]{4,})/g)) add(m[1]);
  };
  for (const op of operations) scan(op.pipeline);
  for (const fld of f.fields) scan(fld.meta?.optionsSource);
  for (const fid of Object.keys(f.grid?.activeFilterValues || {})) add(fid);
  for (const nf of (f.grid?.namedFilters || [])) for (const c of (nf.conditions || [])) add(c.fieldId);
  return out;
}

const slimWith = (set) => (o) => {
  if (roleOf(o) !== "artifact") return o;
  const fields = {};
  for (const fid of Object.keys(o.fields || {})) if (set.has(fid)) fields[fid] = o.fields[fid];
  return { ...o, fields };
};

function sweep(occList) {
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(occList.map((o) => [o.id, structuredClone(o)]));
  // The sweep must have a day to build, or half of what it emits depends on
  // whether the fixture was exported before that morning's build ran.
  stripDayColumns(occurrencesById, Object.values(fieldsById));
  const operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  const ctx = {
    state: { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: fx.modules,
             occurrencesById, modulesById, fieldsById, operationsById, operations },
    fieldsById, operationsById, occurrencesById, modulesById,
  };
  // `Daily Question Rotator` picks at random, so two runs of the SAME input
  // disagree without this — pinning separates "the sweep is random" from "the
  // projection changed the answer".
  const rnd = vi.spyOn(Math, "random").mockReturnValue(0.42);
  try { return runMatchingOperations(operations, null, null, ctx, {}) || []; }
  finally { rnd.mockRestore(); }
}

/** Generated uuids differ per run, so tokenise by order of first appearance —
 *  a minted id referenced later as a parentId maps to the same token in both
 *  runs, which pins the RELATIONSHIPS between created rows and not just their
 *  shapes. (`0274` hit this wall and only stripped.) */
const canonical = (effects) => {
  const seen = new Map();
  return JSON.stringify(effects).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (u) => { if (!seen.has(u)) seen.set(u, "U" + seen.size); return seen.get(u); },
  );
};

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  operations = fx.operations.filter((o) => o.enabled !== false);
  fieldById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  modById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  keep = deriveKeepSet(fx);
});

describe("a projected artifact catalogue", () => {
  // THE CONTROL THAT MAKES THE REST MEAN ANYTHING. "Byte-identical" is also
  // satisfied by a projection that removed nothing at all.
  it("actually removes most of what artifacts carry", () => {
    const arts = fx.occurrences.filter((o) => roleOf(o) === "artifact");
    expect(arts.length).toBeGreaterThan(10000);
    const before = arts.reduce((a, o) => a + Object.keys(o.fields || {}).length, 0);
    const after = arts.map(slimWith(keep)).reduce((a, o) => a + Object.keys(o.fields || {}).length, 0);
    expect(before).toBeGreaterThan(40000);
    expect(after).toBeLessThan(before * 0.5);
  });

  it("derives its keep-set from the grid, and artifacts need only a handful of it", () => {
    expect(keep.size).toBeGreaterThan(50);          // it read the grid at all
    const carried = new Set();
    for (const o of fx.occurrences) {
      if (roleOf(o) !== "artifact") continue;
      for (const fid of Object.keys(o.fields || {})) if (keep.has(fid)) carried.add(fid);
    }
    // Three today. Asserted as a BOUND, not an equality: a new tracker reading
    // one more artifact field is a legal change, not a failure.
    expect(carried.size).toBeLessThanOrEqual(6);
  });

  it("emits BYTE-IDENTICAL effects — the sweep does not read the dropped fields", () => {
    const full = sweep(fx.occurrences);
    const slim = sweep(fx.occurrences.map(slimWith(keep)));
    expect(full.length).toBeGreaterThan(100);       // the sweep ran at all
    expect(slim.length).toBe(full.length);
    expect(canonical(slim)).toBe(canonical(full));
  });

  // THE DISCRIMINATING CASE. Drop a field the ops DO read and the effects must
  // diverge — otherwise the test above could pass against a broken comparison.
  it("DIVERGES when a field the ops read is dropped too", () => {
    const bc = fx.fields.find((f) => f.name === "Board Category");
    expect(bc, "the fixture has no Board Category — this arm proves nothing").toBeTruthy();
    const over = new Set([...keep].filter((fid) => fid !== bc.id));
    expect(canonical(sweep(fx.occurrences.map(slimWith(over))))).not.toBe(canonical(sweep(fx.occurrences)));
  });
});
