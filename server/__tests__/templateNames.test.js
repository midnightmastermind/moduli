// Guards 0261. It renames live templates and mints one, so each test answers
// "could this rename the wrong thing, or lose the day a workout belongs to?"
import { describe, it, expect } from "vitest";
import { planTemplateNames, WORKOUT_PREFIX } from "../migrations/0261-name-schedule-templates.mjs";

const FIELDS = [{ id: "f-ts", name: "Time Slot" }, { id: "f-wd", name: "Weekday" }];
const MODS = [
  { id: "m-c", role: "container" },
  { id: "m-page", role: "page" },
  { id: "m-sun", role: "container", label: "Schedule - Sunday" },
];
const slots = (pfx) => Array.from({ length: 45 }, (_, i) => ({ id: `${pfx}s${i}`, moduleId: "m-c", occurrences: [], fields: { "f-ts": { value: `${i}:00` } } }));
function tpl(id, label, days) {
  const s = slots(id);
  return [{ id, moduleId: "m-c", label, occurrences: s.map((x) => x.id),
    fields: days ? { "f-wd": { value: days } } : {} }, ...s];
}
function world(defs, pageLabel = "Schedule Template") {
  const parts = defs.flatMap(([id, label, days]) => tpl(id, label, days));
  const rootIds = defs.map(([id]) => id);
  return [{ id: "pg", moduleId: "m-page", label: pageLabel, occurrences: rootIds }, ...parts];
}
const plan = (occ, mods = MODS) => planTemplateNames({ occurrences: occ, modules: mods, fields: FIELDS });

describe("0261 — naming the schedule templates", () => {
  it("builds the name from the Weekday FIELD, not the old label", () => {
    const p = plan(world([["t1", "Cardio", ["Friday"]]]));
    expect(p.renames[0].to).toBe(`${WORKOUT_PREFIX}Friday`);   // "Cardio" says nothing about Friday
  });

  it("renames Day and Routine, and leaves a multi-day template alone", () => {
    const p = plan(world([["t1", "Day", null], ["t2", "Routine", ["Monday", "Sunday"]],
                          ["t3", "Meals", ["Monday", "Tuesday"]]]));
    const by = Object.fromEntries(p.renames.map((r) => [r.from, r.to]));
    expect(by["Day"]).toBe("Schedule: Layout");
    expect(by["Routine"]).toBe("Schedule: Routine");
    expect(by["Meals"]).toBeUndefined();          // a third "other" — deliberately untouched
  });

  it("a template claiming SEVERAL weekdays is not a per-day workout", () => {
    const p = plan(world([["t1", "Meals", ["Monday", "Tuesday", "Wednesday"]]]));
    expect(p.renames).toEqual([]);
  });

  it("ignores a live day column — only what the TEMPLATES page lists", () => {
    const p = plan(world([["t1", "Schedule - Wednesday", null]], "Schedule"));
    expect(p.templateCount).toBe(0);
    expect(p.renames).toEqual([]);
  });

  it("mints Sunday from the EXISTING unplaced module, never a new one", () => {
    const p = plan(world([["t1", "Cardio", ["Friday"]]]));
    expect(p.sunday.already).toBe(false);
    expect(p.sunday.moduleId).toBe("m-sun");     // the module sweepOrphans has been keeping
    expect(p.sunday.exemplarId).toBe("t1");
  });

  it("does nothing for Sunday when it is already placed", () => {
    const w = world([["t1", "Cardio", ["Friday"]]]);
    w.push({ id: "sun", moduleId: "m-sun", occurrences: [], fields: {} });
    expect(plan(w).sunday.already).toBe(true);
  });

  it("REFUSES when there is no Sunday module to place", () => {
    const p = plan(world([["t1", "Cardio", ["Friday"]]]), MODS.filter((m) => m.id !== "m-sun"));
    expect(p.refusals.join(" ")).toMatch(/Schedule - Sunday/);
  });
});
