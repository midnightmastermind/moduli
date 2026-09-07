// __tests__/tasksLeftHabits.test.js
//
// User, 2026-09-06: *"tasks left display field is updating when i complete a
// routine. it should just be for tasks, not habit occurances"*.
//
// Measured on the live grid: of 55 completed rows, **46 are habit-bound
// routines** (Eat, Sleep, Check In, Cook…) and 9 are real tasks. `Tasks Left`
// read -2 — a countdown driven past zero by rows it was never meant to count.
//
// THE DISCRIMINATOR IS THE MODULE BINDING, NOT A STORED VALUE. 2026-07-30 (3)
// established it: every Routines action binds a hidden `Habit` marker, and the
// counts split on `_boundFieldIds`, which a copy carries correctly because it
// is a fact about the module rather than a value that can be edited off.
// `Completed Tasks` had the rule; `Task Countdown` did not.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { normalizeFilterDateValue } from "../helpers/filterFieldStamp";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));

let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
});

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}

const fid = (w, n) => w.fx.fields.find((f) => f.name === n)?.id;
const lbl = (w, o) => (o ? (o.label || w.modulesById[o.moduleId]?.label) : "?");

function unguard(w) {
  // Strip the habit rule from Task Countdown — the state before `0306`.
  const habit = fid(w, "Habit");
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (Array.isArray(n.rules)) n.rules = n.rules.filter(
      (r) => !(String(r?.left || "") === "$item._boundFieldIds" && r.right === habit));
    Object.values(n).forEach(walk);
  };
  walk(w.fx.operations.find((o) => o.name === "Task Countdown")?.pipeline);
}

function tasksLeft(w) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const grid = w.fx.grid;
  const updates = runMatchingOperations(ops, null, null, {
    state: { grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
             occurrencesById: w.occurrencesById, modulesById: w.modulesById,
             fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];
  const f = fid(w, "Tasks Left");
  const hit = updates.find((e) => (e.fieldId || e.payload?.fieldId) === f);
  return hit ? (hit.value ?? hit.payload?.value) : undefined;
}

// Tick a row that IS a habit (its module binds the marker) / is NOT.
function completeOne(w, wantHabit) {
  const habit = fid(w, "Habit"), done = fid(w, "Completed"), date = fid(w, "Date");
  // Local, not UTC — see normalizeFilterDateValue. The executor's $today is
  // local, so a UTC day string makes this file red every evening.
  const today = normalizeFilterDateValue(new Date());
  const col = w.fx.occurrences.find((o) => o.fields?.[fid(w, "Schedule Format")]?.value === "day-col");
  expect(col, "no day column").toBeTruthy();
  const src = w.fx.occurrences.find((o) => {
    const b = w.modulesById[o.moduleId]?.fieldBindings || [];
    return b.some((x) => x.fieldId === done) && (b.some((x) => x.fieldId === habit) === wantHabit);
  });
  expect(src, `no ${wantHabit ? "habit" : "task"} row to clone`).toBeTruthy();
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = `tl-${wantHabit ? "habit" : "task"}-row`;
  clone.parentId = col.id;
  clone.fields[done] = { value: true, flow: "in" };
  clone.fields[date] = { value: today, flow: "in" };
  w.fx.occurrences.push(clone);
  w.occurrencesById[clone.id] = clone;
  col.occurrences = [...(col.occurrences || []), clone.id];
  return lbl(w, clone);
}

describe("Tasks Left counts tasks, not habits", () => {
  it("completing a HABIT does not move it", () => {
    const before = tasksLeft(world());
    expect(before, "nothing writes Tasks Left — the op is gone").toBeTypeOf("number");
    const w = world();
    completeOne(w, true);
    if (process.env.AB_UNGUARD === "1") unguard(w);
    expect(tasksLeft(w), "a routine moved the task countdown").toBe(before);
  });

  it("completing a TASK does move it", () => {
    // THE CONTROL. Without it, "a habit does not move it" is equally satisfied
    // by a countdown that has stopped counting anything at all.
    const before = tasksLeft(world());
    const w = world();
    completeOne(w, false);
    expect(tasksLeft(w), "a real task did NOT move the countdown").not.toBe(before);
  });
});
