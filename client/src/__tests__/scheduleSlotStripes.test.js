// 0349 — Schedule slots alternate between two shades, like table rows.
//
// Drives the REAL executor over poms grid's live "Schedule: Mark Passed Slots"
// pipeline (fixture dumped from prod 2026-09-21), before and after the
// migration's own transform. The `before` arm is the control: it paints every
// passed slot the same red and clears every idle one, which is the report.
import { describe, it, expect, afterEach, vi } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import live from "./fixtures/markPassedSlots.pipeline.json";
import { stripeSlotPaint, PASSED_A, PASSED_B, IDLE_B } from "../../../server/migrations/0349-schedule-slots-alternate-shades.mjs";

const GREEN = "rgba(74,222,128,0.16)";
const PAGE = "llpF10Bda5nu", FMT = "vQ0ELZP_zxnx", DATE = "Eh7oi4HKdbHB", TS = "nSccAtADyUGW";
const slot = (id, label, bg) => ({ id, moduleId: "m-slot", ownStyle: bg ? { bg } : undefined,
  fields: { [FMT]: { value: "slot" }, [TS]: { value: label } } });

// Today at 10:10 — 8:00..9:30 passed, 10:00 current, 10:30.. idle. A non-slot
// row sits between 8:30 and 9:00 and must not shift the pattern.
function run(pipeline, { seed = {} } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T10:10:00"));
  const order = ["s800", "s830", "row", "s900", "s930", "s1000", "s1030", "s1100", "s1130"];
  const labels = { s800: "8:00am", s830: "8:30am", s900: "9:00am", s930: "9:30am", s1000: "10:00am",
    s1030: "10:30am", s1100: "11:00am", s1130: "11:30am" };
  const occurrencesById = {
    [PAGE]: { id: PAGE, moduleId: "m-page", occurrences: ["DC"], fields: {} },
    DC: { id: "DC", moduleId: "m-dc", parentId: PAGE, occurrences: order,
      fields: { [FMT]: { value: "day-col" }, [DATE]: { value: "2026-09-21" } } },
    row: { id: "row", moduleId: "m-row", parentId: "DC", fields: {} },
    ...Object.fromEntries(Object.entries(labels).map(([id, l]) => [id, slot(id, l, seed[id])])),
  };
  const modulesById = { "m-page": { id: "m-page", role: "page" }, "m-dc": { id: "m-dc", role: "container" },
    "m-slot": { id: "m-slot", role: "container" }, "m-row": { id: "m-row", role: "instance" } };
  const ctx = {
    state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById),
      occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [],
  };
  const out = executePipeline({ id: "op", name: "Schedule: Mark Passed Slots", pipeline }, ctx, { type: "ScheduleTick" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const bg = {};
  for (const e of effects) if (e._effect === "UPDATE_ITEM_OWN_STYLE" && e.styleKey === "bg") bg[e.itemId] = e.value;
  return bg;
}
afterEach(() => vi.useRealTimers());

const after = () => stripeSlotPaint(live).pipeline;

describe("0349 — schedule slots alternate shades", () => {
  it("CONTROL: the shipped pipeline paints one red and clears the rest", () => {
    expect(run(live)).toEqual({ s800: PASSED_A, s830: PASSED_A, s900: PASSED_A, s930: PASSED_A, s1000: GREEN });
  });

  it("alternates red, keeps green single, alternates idle — skipping non-slot rows", () => {
    expect(run(after())).toEqual({
      s800: PASSED_A, s830: PASSED_B, s900: PASSED_A, s930: PASSED_B,
      s1000: GREEN,
      s1030: IDLE_B, s1130: IDLE_B,   // s1100 is shade A = cleared, already empty -> no write
    });
  });

  it("stays dedup'd: a column already painted correctly writes nothing", () => {
    const seed = { s800: PASSED_A, s830: PASSED_B, s900: PASSED_A, s930: PASSED_B, s1000: GREEN, s1030: IDLE_B, s1130: IDLE_B };
    expect(run(after(), { seed })).toEqual({});
  });

  it("clears a stale B shade off an A slot", () => {
    expect(run(after(), { seed: { s1100: IDLE_B, s1030: IDLE_B, s1130: IDLE_B } })).toMatchObject({ s1100: null });
  });

  it("is idempotent", () => {
    const once = after();
    const twice = stripeSlotPaint(once);
    expect(twice.changed).toBe(false);
    expect(twice.pipeline).toEqual(once);
  });
});
