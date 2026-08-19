// `Fitness: Today's Prescription` — the day's movements, and whether each is done.
//
// USER, 2026-08-19: *"the goals for working out match what day we are on and
// shows if i did each of those workouts (one display field per workout)"*.
//
// It reads TODAY'S COLUMN rather than re-resolving the cycle template, because
// `Schedule: Place Cycle Day` already puts the movements there and a second
// source for one answer drifts the first time a row is edited by hand.
//
// THIS TEST EXISTS BECAUSE THE OP SHIPPED BROKEN AND SILENT. It ran clean and
// wrote nothing for four attempts: `INIT_VAR` assigns `cfg.value` RAW, so
// `value: "${$n}"` stored six literal characters and the index test below it was
// false on every iteration. Nothing errored — the op simply produced nothing,
// which is the failure mode the whole poms-grid harness exists to catch.
import { describe, it, expect, vi } from "vitest";

// Integration scale: each case replays the FULL op sweep over poms grid's own
// 3,300 occurrences. Isolated that is ~1.5s; under full-suite parallelism it
// measured 10.5s and tripped the 5s default, which reads as a broken test
// rather than a slow one. `liveOpsBehavioral` and `pomsGridOps` raise it for
// the same reason.
vi.setConfig({ testTimeout: 60000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
const TILE = "kg860us2nhc", COMPLETED = "tZWiPDQUDP74", MOVEMENT = "gF1S8FoNc4An";

function sweep(mutate) {
  const operations = fx.operations.filter(o => o.enabled !== false);
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  mutate?.(occurrencesById);
  const operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: Object.values(fieldsById),
    modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById, modulesById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  applyEffectsToLiveOccs(occurrencesById, ups);
  const tile = occurrencesById[TILE];
  const slots = Array.from({ length: 6 }, (_, i) => {
    const f = Object.values(fieldsById).find(x => x.name === `Workout ${i + 1}`);
    return tile?.fields?.[f?.id]?.value ?? null;
  });
  return { slots, errors, occurrencesById };
}

// The day column's exercise rows, found the way the op finds them.
const rowsOnToday = (occ) => {
  const parentOf = {};
  for (const o of Object.values(occ)) for (const c of o.occurrences || []) parentOf[c] = o.id;
  const col = Object.values(occ).find(o => o.fields?.["vQ0ELZP_zxnx"]?.value === "day-col");
  const under = (id) => { let cur = id, seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const p = parentOf[cur] ?? occ[cur]?.parentId;
      if (!p) break; if (p === col.id) return true; cur = p; } return false; };
  return Object.values(occ).filter(o => o.fields?.[MOVEMENT]?.value && under(o.id));
};

describe("Fitness: Today's Prescription", () => {
  it("fills one slot per movement on the current cycle day", () => {
    const { slots, errors } = sweep();
    expect(errors.filter(e => /Prescription/.test(e))).toEqual([]);
    // The grid's cycle days carry six movements each; a Rest day carries none.
    const filled = slots.filter(Boolean);
    expect(filled.length).toBeGreaterThan(0);
    for (const s of filled) expect(s).toMatch(/ — (done|not yet)$/);
  });

  it("names the movement, not the row — every row is labelled \"Exercise\"", () => {
    const { slots } = sweep();
    // A board row is the OPTION you pick; the routine is the thing you do
    // (2026-08-13). Showing "Exercise" six times would be useless.
    for (const s of slots.filter(Boolean)) expect(s).not.toMatch(/^Exercise —/);
  });

  it("flips exactly the ticked movement to done, and only that one", () => {
    const before = sweep().slots;
    const after = sweep((occ) => {
      const row = rowsOnToday(occ)[0];
      row.fields[COMPLETED] = { value: true, flow: "in" };
    }).slots;
    expect(before[0]).toMatch(/— not yet$/);
    expect(after[0]).toMatch(/— done$/);
    // The discrimination that matters: one tick must not move the others.
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it("clears its slots each run, so a Rest day cannot show yesterday's list", () => {
    // Remove every movement from today and the slots must go blank rather than
    // keep the previous run's values — the stalest kind of wrong, because it
    // looks exactly like a correct answer.
    const { slots } = sweep((occ) => {
      for (const r of rowsOnToday(occ)) delete r.fields[MOVEMENT];
    });
    expect(slots.filter(Boolean)).toEqual([]);
  });
});
