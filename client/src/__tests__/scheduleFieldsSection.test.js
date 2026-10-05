// @vitest-environment jsdom
// grid.meta.scheduleFieldIds could only be written by the seed; the Grid tab sets it now.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { schedulePageOptions, withScheduleField } from "../ui/ScheduleFieldsSection.jsx";

describe("ScheduleFieldsSection", () => {
  it("lists every page, by label", () => {
    const mods = [{ id: "m1", role: "page", label: "Schedule" }, { id: "m2", role: "container", label: "Todo" }, { id: "m3", role: "page", label: "Day Page" }];
    const occs = [{ id: "o1", moduleId: "m1" }, { id: "o2", moduleId: "m2" }, { id: "o3", moduleId: "m3" }];
    expect(schedulePageOptions(occs, mods).map((o) => o.label)).toEqual(["Day Page", "Schedule"]);
  });
  it("sets one key and keeps the rest of meta", () => {
    const meta = { defaultStyle: { bg: "x" }, scheduleFieldIds: { dateFieldId: "d" } };
    expect(withScheduleField(meta, "timeslotFieldId", "t")).toEqual({ defaultStyle: { bg: "x" }, scheduleFieldIds: { dateFieldId: "d", timeslotFieldId: "t" } });
  });
  it("clearing the last key removes scheduleFieldIds", () => {
    expect(withScheduleField({ a: 1, scheduleFieldIds: { dateFieldId: "d" } }, "dateFieldId", null)).toEqual({ a: 1 });
  });
  it("the Grid tab mounts it", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/GridSettingsTab.jsx"), "utf8");
    expect(src).toMatch(/<ScheduleFieldsSection[\s\S]*?onMetaChange/);
  });
});
