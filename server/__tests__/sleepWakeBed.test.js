// Guards 0253. It MINTS modules and places 14 rows on a live template, so each
// test answers "could this place the wrong thing, place it twice, or mint a
// routine that lands in the wrong count?"
import { describe, it, expect } from "vitest";
import { planSleepWakeBed, SLEEP_SLOTS, WAKE_SLOT, BED_SLOT } from "../migrations/0253-sleep-wake-bed.mjs";

const TS = { id: "f-ts", name: "Time Slot", type: "select" };
const FIELDS = [TS, { id: "f-done", name: "Completed" }, { id: "f-habit", name: "Habit" }];
const sleepMod = {
  id: "m-sleep", role: "instance", label: "Sleep",
  fieldBindings: [{ fieldId: "f-done", order: 0, role: "input" }, { fieldId: "f-habit", order: 9, role: "input", hidden: true }],
};
const MODS = [sleepMod, { id: "m-tpl", role: "container", label: "Routine" }];

const slot = (label) => ({ id: `s-${label}`, moduleId: "m-slot", occurrences: [], fields: { "f-ts": { value: label } } });
const ALL = ["11:00pm", "11:30pm", "12:00am", "12:30am", "1:00am", "1:30am", "2:00am", "2:30am",
             "3:00am", "3:30am", "4:00am", "4:30am", "5:00am", "6:00am"];
function world(extra = []) {
  const slots = ALL.map(slot);
  // pad to a full day so the "holds a day of slots" test passes
  for (let i = 0; i < 40; i++) slots.push({ id: `pad${i}`, moduleId: "m-slot", occurrences: [], fields: { "f-ts": { value: `pad${i}` } } });
  const tpl = { id: "tpl", moduleId: "m-tpl", label: "Routine", occurrences: slots.map((s) => s.id) };
  const catalog = { id: "cat-sleep", moduleId: "m-sleep", parentId: "rest", occurrences: [] };
  return [tpl, catalog, ...slots, ...extra];
}
const plan = (occ, mods = MODS) => planSleepWakeBed({ occurrences: occ, modules: mods, fields: FIELDS });

describe("0253 — sleep across the night, wake up, go to bed", () => {
  it("plans twelve Sleep rows — a slot is the unit of duration, not a field", () => {
    const p = plan(world());
    expect(p.refusals).toEqual([]);
    expect(SLEEP_SLOTS).toHaveLength(12);                       // 6 hours of half-hours
    expect(p.plan.filter((x) => x.what === "Sleep")).toHaveLength(12);
    expect(SLEEP_SLOTS[0]).toBe("11:30pm");
    expect(SLEEP_SLOTS[SLEEP_SLOTS.length - 1]).toBe("5:00am"); // the 5:00 slot ENDS at 5:30
  });

  it("places Wake Up and Go to Bed at the hours asked for", () => {
    const p = plan(world());
    expect(p.plan.find((x) => x.what === "Wake Up").slotLabel).toBe(WAKE_SLOT);
    expect(p.plan.find((x) => x.what === "Go to Bed").slotLabel).toBe(BED_SLOT);
    expect(WAKE_SLOT).toBe("6:00am");
    expect(BED_SLOT).toBe("11:00pm");
  });

  it("finds the catalog parent from the Sleep action, so the new ones sit beside it", () => {
    expect(plan(world()).catalogParentId).toBe("rest");
  });

  it("REFUSES the TRACKER tile of the same name — it binds no Habit", () => {
    const tile = { id: "m-tile", role: "instance", label: "Sleep", fieldBindings: [{ fieldId: "f-sleeptime" }] };
    const p = plan(world(), [...MODS, tile]);
    expect(p.refusals).toEqual([]);                 // the tile is ignored, not ambiguous
    expect(p.exemplar.id).toBe("m-sleep");
  });

  it("REFUSES when two real Sleep ACTIONS exist rather than guessing", () => {
    const twin = { ...sleepMod, id: "m-sleep2" };
    const p = plan(world(), [...MODS, twin]);
    expect(p.refusals.join(" ")).toMatch(/exactly one Sleep ACTION/);
  });

  it("REFUSES when the Routine template is ambiguous", () => {
    const w = world();
    const p = planSleepWakeBed({ occurrences: [...w, { ...w[0], id: "tpl2" }], modules: MODS, fields: FIELDS });
    expect(p.refusals.join(" ")).toMatch(/exactly one "Routine" template/);
  });

  it("REFUSES when a named slot does not exist, instead of silently dropping it", () => {
    const w = world().filter((o) => o.id !== "s-6:00am");
    const p = planSleepWakeBed({ occurrences: w, modules: MODS, fields: FIELDS });
    expect(p.refusals.join(" ")).toMatch(/no slot for: 6:00am/);
  });

  it("marks a slot that ALREADY holds the action, so a re-run places nothing", () => {
    const w = world();
    const s = w.find((o) => o.id === "s-11:30pm");
    s.occurrences = ["already"];
    w.push({ id: "already", moduleId: "m-sleep", parentId: s.id, occurrences: [] });
    const p = planSleepWakeBed({ occurrences: w, modules: MODS, fields: FIELDS });
    expect(p.plan.find((x) => x.slotLabel === "11:30pm").already).toBe(true);
    expect(p.plan.filter((x) => !x.already)).toHaveLength(13);
  });
});
