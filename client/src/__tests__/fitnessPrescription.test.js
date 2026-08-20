// `Fitness: Today's Prescription` — the day's movements, and whether each is done.
//
// USER, 2026-08-19: *"the goals for working out match what day we are on and
// shows if i did each of those workouts (one display field per workout)"*.
//
// THIS OP HAS BEEN PARKED TWICE, and both parkings are the reason this file is
// shaped the way it is.
//
//   0150  it ran clean and wrote NOTHING — `INIT_VAR` assigns `cfg.value` raw,
//         so `value: "${$n}"` stored six literal characters and the index test
//         below it was false on every iteration.
//   d7e31b74  the tile came up with slots 1-3 blank and 4-6 holding the previous
//         list. That shape is not one this pipeline can emit: it clears all six
//         and then writes slot `$n` in order, so its outputs are six values, a
//         PREFIX, or six blanks. `1-3 blank, 4-6 filled` needs the CLEARS to be
//         applied and then abandoned partway — which is what `bindSocketToStore`
//         did until `6b6a5d1d`, the same morning.
//
// So the cases below are not a general sample; each is a state this grid has
// actually been in on a morning, and the last two are the ones no amount of
// looking at a healthy day would have caught.
//
// THE CLOCK IS PINNED TO THE FIXTURE'S OWN EXPORT DATE. The fixture is a
// snapshot of one day and the op resolves `$today` at run time, so without this
// every assertion here would go red the morning after it was written — and a
// suite that fails by the calendar gets disabled rather than read.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Integration scale: each case replays the full op sweep over poms grid's own
// 3,300 occurrences. `liveOpsBehavioral` and `pomsGridOps` raise it likewise.
vi.setConfig({ testTimeout: 60000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
const OP = "Fitness: Today's Prescription";
const TILE = "kg860us2nhc", COMPLETED = "tZWiPDQUDP74", MOVEMENT = "gF1S8FoNc4An", FORMAT = "vQ0ELZP_zxnx";

// Only `Date` is faked. Faking the timer queue as well would stall anything in
// the sweep that defers, and nothing here needs the clock to move.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(fx._exportedAt)); });
afterAll(() => { vi.useRealTimers(); });

// `only` runs a single op instead of the whole sweep, and the rollover cases
// below NEED it — not for speed. Deleting today's movement rows and running the
// full sweep does not produce a column with no movements on it: `Schedule: Place
// Cycle Day` merges the cycle template back in during the same sweep and
// RE-PLACES them, which is the self-healing behaviour CLAUDE.md documents for a
// truncated build. The first version of these two tests deleted six rows,
// confirmed the map no longer held them, and still read six movements out of the
// tile — the system repairing itself, not a broken probe.
// `world` starts from a previous sweep's result instead of the raw fixture, and
// three cases below NEED it. Since 0162 retired the cycle, today's column holds
// no movement rows until `Schedule: Place Weekday` puts them there — which
// happens DURING the sweep. A test that mutates a row has to run one sweep to
// materialise the day first, then mutate, then sweep again. That is also the
// real order: Build Schedule -> Place Weekday -> this op reads the result.
function sweep(mutate, only, world) {
  const operations = fx.operations.filter(o => o.enabled !== false)
    .filter(o => !only || o.name === only);
  const occurrencesById = world
    ? Object.fromEntries(Object.entries(world).map(([k, v]) => [k, structuredClone(v)]))
    : Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
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
    return tile?.fields?.[f?.id]?.value || null;   // "" is a cleared slot, not a value
  });
  return { slots, errors, occurrencesById };
}

// The day column, and its exercise rows — found the way the OP finds them, by
// ancestry rather than by the row's date. That is the whole change `0157` made.
const todayColumn = (occ) =>
  Object.values(occ).find(o => o.fields?.[FORMAT]?.value === "day-col");
const rowsOnToday = (occ) => {
  const parentOf = {};
  for (const o of Object.values(occ)) for (const c of o.occurrences || []) parentOf[c] = o.id;
  const col = todayColumn(occ);
  const under = (id) => { let cur = id, seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const p = parentOf[cur] ?? occ[cur]?.parentId;
      if (!p) break; if (p === col.id) return true; cur = p; } return false; };
  return Object.values(occ).filter(o => o.fields?.[MOVEMENT]?.value && !o.meta?.feedSourceId && under(o.id));
};

describe("Fitness: Today's Prescription", () => {
  // THE CONTROL. Everything below asserts what the tile does NOT say in some
  // broken world; none of it means anything unless the healthy world fills it.
  it("fills one slot per movement on the current cycle day", () => {
    const { slots, errors } = sweep();
    expect(errors.filter(e => /Prescription/.test(e))).toEqual([]);
    const filled = slots.filter(Boolean);
    expect(filled.length).toBeGreaterThan(0);
    for (const s of filled) expect(s).toMatch(/ — (done|not yet)$/);
  });

  it("names the movement, not the row — every row is labelled \"Exercise\"", () => {
    // A board row is the OPTION you pick; the routine is the thing you do
    // (2026-08-13). Showing "Exercise" six times would be useless.
    for (const s of sweep().slots.filter(Boolean)) expect(s).not.toMatch(/^Exercise —/);
  });

  it("flips exactly the ticked movement to done, and only that one", () => {
    const placed = sweep();                       // materialise the day first
    const before = placed.slots;
    const after = sweep((occ) => {
      rowsOnToday(occ)[0].fields[COMPLETED] = { value: true, flow: "in" };
    }, null, placed.occurrencesById).slots;
    expect(before[0]).toMatch(/— not yet$/);
    expect(after[0]).toMatch(/— done$/);
    // The discrimination that matters: one tick must not move the others.
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it("clears its slots each run, so a Rest day cannot show yesterday's list", () => {
    const placed = sweep();
    const { slots } = sweep((occ) => {
      for (const r of rowsOnToday(occ)) delete r.fields[MOVEMENT];
    }, OP, placed.occurrencesById);
    expect(slots.filter(Boolean)).toEqual([]);
  });

  // ---- the two rollover states, which is what parked it on 2026-08-20 -------

  it("goes BLANK, never stale, when the day's rows are not placed yet", () => {
    // The morning window between the column being built and `Place Cycle Day`
    // filling it. The tile is pre-loaded with a previous list so a survivor is
    // visible as one — without that the assertion would pass on an empty tile.
    const placed = sweep();
    const { slots } = sweep((occ) => {
      const wf = fx.fields.filter(f => /^Workout [1-6]$/.test(f.name));
      wf.forEach((f, i) => { occ[TILE].fields[f.id] = { value: `STALE ${i + 1}` }; });
      for (const r of rowsOnToday(occ)) delete occ[r.id];
    }, OP, placed.occurrencesById);
    expect(slots).toEqual([null, null, null, null, null, null]);
  });

  it("shows a PREFIX of the day, never a gap, while the build is still draining", () => {
    // A pm2 restart truncates the create queue mid-build (CLAUDE.md 2026-08-20),
    // so a column can legitimately hold 3 of its 6 movements for a while. The
    // honest answer is the three that exist and blanks after them — the shape
    // that was reported, 1-3 blank with 4-6 filled, is the one that must be
    // impossible.
    const placed = sweep();
    const { slots } = sweep((occ) => {
      const wf = fx.fields.filter(f => /^Workout [1-6]$/.test(f.name));
      wf.forEach((f, i) => { occ[TILE].fields[f.id] = { value: `STALE ${i + 1}` }; });
      rowsOnToday(occ).slice(3).forEach(r => delete occ[r.id]);
    }, OP, placed.occurrencesById);
    expect(slots.filter(Boolean).length).toBe(3);
    expect(slots.slice(3)).toEqual([null, null, null]);      // no stale tail
    for (const s of slots.slice(0, 3)) expect(s).toMatch(/ — (done|not yet)$/);
  });

  it("reads the COLUMN, so an unstamped date cannot empty the tile", () => {
    // `Place Cycle Day` puts the rows on the column; the date stamp is a
    // separate write. Scoping by the row's date made the tile go blank in that
    // window — this is the A/B for `0157`, and it fails against the old scope.
    const placed = sweep();
    const { slots } = sweep((occ) => {
      for (const r of rowsOnToday(occ)) delete occ[r.id].fields["Eh7oi4HKdbHB"];
    }, null, placed.occurrencesById);
    expect(slots.filter(Boolean).length).toBe(6);
  });
});
