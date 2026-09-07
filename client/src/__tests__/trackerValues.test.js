// EVERY TRACKER, DRIVEN THROUGH THE REAL SWEEP, ASSERTED ON THE VALUE IT WRITES.
//
// User, 2026-09-07: *"make sure all the ops are working for updating trackers.
// make sure are tests are making sure values are updated (my ops specifically)"*
//
// WHY THE EXISTING SUITES COULD NOT ANSWER THAT. An audit of all 74 enabled ops
// over the live grid found 50 that write — and almost every one of them writes
// **0**, because today's schedule is nearly empty. `Steps 0 · Water 0 · Pages 0
// · Spent 0 · Earned 0 · Sleep 0 · Coffee 0`. A zero is exactly what a DEAD op
// produces too, so a suite that asserted those numbers would pass against a
// tracker that had silently stopped counting — which is precisely what happened
// to `Savings Balance`, which had no operation at all and nothing noticed
// (2026-09-05).
//
// So nothing here asserts an absolute. Each case SWEEPS, injects one real row
// on today's schedule column, SWEEPS again, and asserts the tracker moved by the
// amount that row is worth. A dead op moves nothing and fails; a
// double-counting op moves twice and fails.
//
// AND EVERY CASE CARRIES ITS OWN CONTROL — a tracker that must NOT move. Without
// one, "the duration landed in Reading Time" is also satisfied by an op that
// counts every duration on the grid, which is the defect this file found.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { TODAY, labelOf as label0, fieldId as fid0, ensureTodaysColumn } from "./helpers/scheduleWorld";

vi.setConfig({ testTimeout: 120000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let base;
beforeAll(() => { base = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString()); });

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}

const labelOf = label0;
const fieldId = fid0;

/** Every field the sweep writes, keyed "Tile.Field" — what a tile would show. */
function sweep(w) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const grid = w.fx.grid;
  const updates = runMatchingOperations(ops, null, null, {
    state: { grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
      fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];

  const out = {};
  for (const e of updates) {
    const oid = e.itemId || e.occurrenceId || e.payload?.itemId || e.payload?.occurrenceId;
    const fid = e.fieldId || e.payload?.fieldId;
    if (!oid || !fid) continue;
    const key = `${labelOf(w, w.occurrencesById[oid])}.${w.fieldsById[fid]?.name}`;
    // LAST write wins, which is what the store does — an earlier op's value is
    // not the one the tile ends up showing.
    out[key] = e.value ?? e.payload?.value;
  }
  return out;
}

/** Today's schedule day column — constructed when the fixture predates today. */
const todaysColumn = ensureTodaysColumn;

// LABELS REPEAT ON THIS GRID and picking the wrong one invents a failure.
// Five occurrences are called "Water" (the tracker tile, a utility bill, the
// beverage option, two artifacts) and "Sleep" names both a routine and its
// tracker tile. Every lookup below therefore states what it is looking FOR and
// refuses when that is not exactly one thing — the first version of this file
// silently cloned the Sleep TILE and asserted the Sleep op was broken.
function parentOf(w, occ) {
  return w.fx.occurrences.find((p) => (p.occurrences || []).includes(occ.id));
}

/** Ancestor ids, walked through the child listings the executor derives from. */
function ancestorsOf(w, occ) {
  const out = [];
  let cur = parentOf(w, occ);
  for (let i = 0; cur && i < 50; i++) { out.push(cur.id); cur = parentOf(w, cur); }
  return out;
}

/**
 * A TASK from the Tasks page. This is not the same thing as a routine: `0008`
 * made every Routines action carry the hidden `Habit` marker, so cloning
 * "Exercise" produces a HABIT and the task counter correctly ignores it. The
 * first version of this file asserted otherwise and reported a working op as
 * broken. A task is a row that binds `Completed` and does NOT bind `Habit`.
 */
function taskRow(w, name) {
  const doneF = fieldId(w, "Completed"), habitF = fieldId(w, "Habit");
  const hits = w.fx.occurrences.filter((o) => {
    if (labelOf(w, o) !== name) return false;
    const mod = w.modulesById[o.moduleId];
    if (mod?.role !== "instance") return false;
    const bound = (mod.fieldBindings || []).map((b) => b.fieldId);
    return bound.includes(doneF) && !bound.includes(habitF);
  });
  expect(hits.length, `"${name}" does not resolve to exactly one task (${hits.length})`).toBe(1);
  return hits[0];
}

/** The Routines page — the catalog every logged row is a copy OF. */
function routinesPage(w) {
  const hits = w.fx.occurrences.filter(
    (o) => labelOf(w, o) === "Routines" && (o.occurrences || []).length > 3);
  expect(hits.length, `"Routines" does not resolve to exactly one page (${hits.length})`).toBe(1);
  return hits[0];
}

/**
 * The catalog action a user drags onto their day (Read, Drink, Spend, …).
 * An action is an instance whose module binds `Completed` — that is what makes
 * it something you can DO — and which lives in the Routines catalog rather than
 * on a schedule or a tracker page.
 */
function catalogAction(w, name) {
  const doneF = fieldId(w, "Completed");
  const cat = routinesPage(w).id;
  const hits = w.fx.occurrences.filter((o) => {
    if (labelOf(w, o) !== name) return false;
    const mod = w.modulesById[o.moduleId];
    if (mod?.role !== "instance") return false;
    if (!(mod.fieldBindings || []).some((b) => b.fieldId === doneF)) return false;
    // IN THE CATALOG — not one of the many copies already placed on a cycle
    // template or a past day column (9 Drinks, 13 Sleeps, 25 Exercises).
    return ancestorsOf(w, o).includes(cat);
  });
  expect(hits.length, `"${name}" does not resolve to exactly one catalog action (${hits.length})`).toBe(1);
  return hits[0];
}

let seq = 0;
/**
 * Log one action on today's column: completed, dated today, with the values a
 * user would have entered. Keeps the source's own Tags — that is what the
 * dimension trackers gate on.
 */
function logAction(w, name, values = {}, source = null) {
  const src = source || catalogAction(w, name);
  const col = todaysColumn(w);
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = `tracker-value-probe-${++seq}`;
  clone.parentId = col.id;
  clone.fields = { ...(clone.fields || {}) };
  clone.fields[fieldId(w, "Date")] = { value: TODAY, flow: "in" };
  clone.fields[fieldId(w, "Completed")] = { value: true, flow: "in" };
  for (const [fname, v] of Object.entries(values)) {
    const val = v && typeof v === "object" && "value" in v ? v : { value: v, flow: "in" };
    clone.fields[fieldId(w, fname)] = val;
  }
  w.fx.occurrences.push(clone);
  w.occurrencesById[clone.id] = clone;
  col.occurrences = [...(col.occurrences || []), clone.id];
  return clone;
}

/**
 * An option a dropdown offers — a Beverage, a Movement, a Meal. Scoped by the
 * BOARD it sits on, because "Water" is also a tracker tile and a utility bill.
 */
function optionId(w, label, board) {
  const hits = w.fx.occurrences.filter(
    (o) => labelOf(w, o) === label && labelOf(w, parentOf(w, o)) === board);
  expect(hits.length, `"${label}" on the ${board} board does not resolve to exactly one option (${hits.length})`).toBe(1);
  return hits[0].id;
}

const moved = (before, after, key) => (after[key] ?? 0) - (before[key] ?? 0);

describe("a logged action moves the tracker it belongs to", () => {
  // [name, action, values, expected moves, expected NON-moves]
  //
  // The non-moves are half the point. Every one of these trackers sums the same
  // shape of input, so "Water counted my drink" is also satisfied by a Water op
  // that counts everything.
  const CASES = [
    { name: "water", action: "Drink", values: (w) => ({ "Liquid Amount": 16, Beverage: optionId(w, "Water", "Beverages") }),
      moves: { "Water.Daily Water": 16 }, still: ["Coffee.Daily Coffee", "Steps.Daily Steps"] },
    { name: "coffee", action: "Drink", values: (w) => ({ "Liquid Amount": 8, Beverage: optionId(w, "Coffee", "Beverages") }),
      moves: { "Coffee.Daily Coffee": 8 }, still: ["Water.Daily Water"] },
    { name: "steps", action: "Walk", values: () => ({ Steps: 5000 }),
      moves: { "Steps.Daily Steps": 5000 }, still: ["Water.Daily Water"] },
    { name: "pages", action: "Read", values: () => ({ Pages: 30 }),
      moves: { "Pages Read.Pages Read": 30 }, still: ["Steps.Daily Steps"] },
    { name: "a spend", action: "Spend", values: () => ({ Amount: { value: 40, flow: "out" } }),
      moves: { "Spent.Spent": 40 }, still: ["Income.Earned"] },
    { name: "income", action: "Earn", values: () => ({ Income: 250 }),
      moves: { "Income.Earned": 250 }, still: ["Spent.Spent"] },
    { name: "a social hour", action: "Mentor", values: () => ({ Duration: 60 }),
      moves: { "Connection Time.Time Spent": 60 },
      // Productivity is the day's TOTAL, so it must move for every dimension —
      // without it, gating Reading Time correctly is indistinguishable from
      // gating every duration tracker into silence.
      alsoMoves: { "Productivity.Time Spent": 60 },
      still: ["Practice Duration.Time Spent", "Work Duration.Time Spent", "Creative Duration.Time Spent",
              "Reading Time.Time Spent", "Reading Stats.Reading Time"] },
    // THE POSITIVE CONTROL for the two cases below. "A social hour does not land
    // in Reading Time" is also satisfied by a Reading Time op that counts
    // nothing at all — which is exactly what over-gating it would produce. An
    // intellectual action must still move it, and `Study` (not `Read`) is the
    // discriminating one: the tile is named for reading but tracks the whole
    // dimension, per the user.
    { name: "study time as intellectual time", action: "Study", values: () => ({ Duration: 45 }),
      moves: { "Reading Time.Time Spent": 45, "Reading Stats.Reading Time": 45,
               "Productivity.Time Spent": 45 },
      still: ["Connection Time.Time Spent", "Practice Duration.Time Spent"] },
    { name: "meditation", action: "Meditate", values: () => ({ Duration: 20 }),
      moves: { "Practice Duration.Time Spent": 20 },
      still: ["Connection Time.Time Spent", "Work Duration.Time Spent",
              "Reading Time.Time Spent", "Reading Stats.Reading Time"] },
  ];

  for (const c of CASES) {
    it(`counts ${c.name}`, () => {
      const w = world();
      const before = sweep(w);
      logAction(w, c.action, c.values(w));
      const after = sweep(w);

      for (const [key, want] of Object.entries({ ...c.moves, ...(c.alsoMoves || {}) })) {
        expect(moved(before, after, key), `${key} did not move by ${want}`).toBeCloseTo(want, 2);
      }
      for (const key of c.still) {
        expect(moved(before, after, key), `${key} moved and should not have`).toBeCloseTo(0, 2);
      }
    });
  }

  it("counts a completed sleep as one 30-minute slot", () => {
    const w = world();
    const before = sweep(w);
    logAction(w, "Sleep");
    // Sleep binds no Duration — per the user, "the operation should just count
    // each one as 30 min", so the op counts occurrences rather than summing.
    expect(moved(before, sweep(w), "Sleep.Sleep Time")).toBeCloseTo(30, 2);
  });

  it("counts a workout", () => {
    const w = world();
    const before = sweep(w);
    logAction(w, "Exercise", { Movement: optionId(w, "Barbell Bench Press", "Movements") });
    expect(moved(before, sweep(w), "Fitness Stats.Total Workouts")).toBeCloseTo(1, 2);
  });

  it("puts a meal's macros on the nutrition tile", () => {
    const w = world();
    const before = sweep(w);
    logAction(w, "Eat", { Calories: 400, Protein: 30, Carbs: 45, Fats: 12,
      Meal: optionId(w, "Greek Yogurt Bowl", "Meals") });
    const after = sweep(w);
    expect(moved(before, after, "Meal Nutrition.Total Calories")).toBeCloseTo(400, 2);
    expect(moved(before, after, "Meal Nutrition.Total Protein")).toBeCloseTo(30, 2);
    expect(moved(before, after, "Meal Nutrition.Total Carbs")).toBeCloseTo(45, 2);
    expect(moved(before, after, "Meal Nutrition.Total Fats")).toBeCloseTo(12, 2);
  });
});

describe("a habit and a task are counted apart", () => {
  // The discriminator is the module BINDING, never a stored value — `Read`
  // binds the hidden `Habit` marker and `Exercise` does not. Asserting both
  // directions is what stops this degrading into "everything is a habit".
  it("a completed HABIT moves the habit count and not the task count", () => {
    const w = world();
    const before = sweep(w);
    logAction(w, "Read", { Pages: 10 });
    const after = sweep(w);
    expect(moved(before, after, "Completed Habits.Habits Completed"), "the habit was not counted").toBeCloseTo(1, 2);
    expect(moved(before, after, "Completed Tasks.Tasks Completed"), "a habit was counted as a task").toBeCloseTo(0, 2);
  });

  it("a completed TASK moves the task count and its countdown", () => {
    const w = world();
    const before = sweep(w);
    // A real task off the Tasks page — NOT a routine, which is always a habit.
    logAction(w, "Organize files", {}, taskRow(w, "Organize files"));
    const after = sweep(w);
    expect(moved(before, after, "Completed Tasks.Tasks Completed"), "the task was not counted").toBeCloseTo(1, 2);
    expect(moved(before, after, "Completed Habits.Habits Completed"), "a task was counted as a habit").toBeCloseTo(0, 2);
    // The countdown is the same number read the other way — 10 down to 9.
    expect(moved(before, after, "Completed Tasks.Tasks Left"), "the countdown did not move").toBeCloseTo(-1, 2);
  });
});

describe("the trackers that read the catalogue rather than the day", () => {
  // These do NOT depend on today's schedule, so an absolute IS the honest
  // assertion — and a zero here would mean the op died.
  it("counts the media actually owned", () => {
    const w = world();
    const got = sweep(w);
    for (const key of ["Media Owned.Movies Owned", "Media Owned.Books Owned", "Media Owned.Albums Owned"]) {
      expect(got[key], `${key} is not counting`).toBeGreaterThan(0);
    }
  });

  it("totals the monthly bills", () => {
    const w = world();
    expect(sweep(w)["Monthly Bills.Amount"], "the bills total is not computed").toBeGreaterThan(0);
  });

  it("sums Net Worth from the account balances", () => {
    const w = world();
    const got = sweep(w);
    const sum = (got["Accounts.Checking Balance"] ?? 0)
      + (got["Accounts.Savings Balance"] ?? 0) + (got["Accounts.Cash"] ?? 0);
    expect(got["Net Worth.Net Worth"], "Net Worth is not the sum of the accounts").toBeCloseTo(sum, 2);
  });
});
