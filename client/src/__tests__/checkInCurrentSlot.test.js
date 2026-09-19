// 0347 — a picked mood's Check In is listed in the Schedule's CURRENT timeslot
// for that day. Drives the migration's own steps through the REAL executor.
import { describe, it, expect, afterEach, vi } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { slotSteps } from "../../../server/migrations/0347-a-check-in-lands-in-the-current-timeslot.mjs";

const IDS = { schedulePageId: "SP", formatFieldId: "fmt", dateFieldId: "date", timeslotFieldId: "ts" };
const slot = (id, label) => ({ id, moduleId: "m-slot", fields: { fmt: { value: "slot" }, ts: { value: label } } });

function run({ at, day = "2026-09-19" }) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`2026-09-19T${at}:00`));
  const occurrencesById = {
    SP: { id: "SP", moduleId: "m-page", occurrences: ["DC", "DC2"], fields: {} },
    DC: { id: "DC", moduleId: "m-dc", parentId: "SP", occurrences: ["s600", "s700", "s730", "s800"],
      fields: { fmt: { value: "day-col" }, date: { value: "2026-09-19" } } },
    DC2: { id: "DC2", moduleId: "m-dc", parentId: "SP", occurrences: ["t700"],
      fields: { fmt: { value: "day-col" }, date: { value: "2026-09-20" } } },
    s600: slot("s600", "6:00am"), s700: slot("s700", "7:00am"), s730: slot("s730", "7:30am"),
    s800: slot("s800", "8:00am"), t700: slot("t700", "7:00am"),
    CI: { id: "CI", moduleId: "m-ci", fields: {} },
  };
  const modulesById = {
    "m-page": { id: "m-page", role: "page" }, "m-dc": { id: "m-dc", role: "container" },
    "m-slot": { id: "m-slot", role: "container" }, "m-ci": { id: "m-ci", role: "instance" },
  };
  const ctx = {
    state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById),
      occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [],
  };
  const pipeline = { sources: [], steps: [
    { id: "d", type: "action", config: { type: "INIT_VAR", name: "$day", expr: `literal:${day}` } },
    { id: "n", type: "action", config: { type: "INIT_VAR", name: "$newCheckIn", expr: "literal:CI" } },
    ...slotSteps(IDS),
  ] };
  const out = executePipeline({ id: "op", name: "Mood", pipeline }, ctx, { type: "GraphSelectOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects.filter((e) => e._effect === "UPDATE_OCCURRENCE" && e.occurrence?.occurrences?.includes("CI"))
    .map((e) => e.occurrence.id);
}
afterEach(() => vi.useRealTimers());

describe("0347 — the Check In lands in the current timeslot", () => {
  it("picks the latest slot at or before now (07:40 -> 7:30am, not 8:00am)", () => {
    expect(run({ at: "07:40" })).toEqual(["s730"]);
  });
  it("counts a slot starting exactly now", () => {
    expect(run({ at: "07:30" })).toEqual(["s730"]);
  });
  // THE CONTROL: before the day's first slot there is nowhere to put it.
  it("lists it nowhere before the first slot", () => {
    expect(run({ at: "05:00" })).toEqual([]);
  });
  it("uses the Schedule column of the day that was picked on", () => {
    expect(run({ at: "07:40", day: "2026-09-20" })).toEqual(["t700"]);
  });
});
