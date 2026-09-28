// Every $trigger prop the seed's operations READ must be pickable.
//
// Measured 2026-09-28: live operations read 18 distinct `$trigger.<prop>`s, and
// the picker (TRIGGER_PROP_KEYS, from getTriggerVars) listed none of
// occurrenceId (23 uses), sourceOccurrenceId (12), minutes (9), fields (9),
// containerId/containerLabel (4), targetContainerId, slotLabel, pomoNumber,
// phase. getTriggerVars was written from the EDITOR's side; what a trigger
// carries is decided by the code that FIRES it (CommitHelpers' NavigationOp
// fan-out, the create/delete/measure ops, PomodoroTimer). The seed is the spec
// for poms' operations, so this reads the props it uses rather than a list.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTriggerVars } from "../helpers/triggerTypes";
import { itemsForLevel } from "../ui/DrilldownPicker.jsx";
// Ask the PICKER, not the helper list: its `trigger` shape adds `occurrence`
// (a drillable record) on top of TRIGGER_PROP_KEYS.
const offered = itemsForLevel([], { fields: [] }, [], "trigger").items.map((i) => i.value);

const ops = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../server/seed/operations.json"), "utf8"));
const used = new Set();
for (const o of ops) for (const m of JSON.stringify(o.pipeline || {}).matchAll(/\$trigger\.([A-Za-z_]+)/g)) used.add(m[1]);

describe("$trigger props the seed reads are pickable", () => {
  it("CONTROL: the scan finds the seed's trigger reads", () => {
    expect([...used]).toEqual(expect.arrayContaining(["occurrence", "type", "sourceOccurrenceId", "minutes"]));
  });
  it("every one is offered — except `fields`, whose shape depends on the emitter", () => {
    // 3 live onChange ops (Schedule: Route by Timeslot, Project: Status Router,
    // Project: Sync To Todo List) read `$trigger.fields.<id>.value`, which is
    // undefined when the change came from a UI edit (CommitHelpers sends the
    // raw value). Offering it would help author more of that; see
    // triggerPathPicker.test.js. Reported, not fixed here.
    expect([...used].filter((k) => k !== "fields" && !offered.includes(k))).toEqual([]);
  });
  it("a filter-nav change carries the occurrence it happened on", () => {
    expect(getTriggerVars("onFilterChange", "filterNav")).toContain("$trigger.sourceOccurrenceId");
  });
  it("a pomodoro start carries its number, phase, slot and destination", () => {
    expect(getTriggerVars("onPomoStart", "grid")).toEqual(expect.arrayContaining(["$trigger.minutes", "$trigger.pomoNumber", "$trigger.phase", "$trigger.slotLabel", "$trigger.targetContainerId"]));
  });
  it("an add carries the occurrence and its container", () => {
    expect(getTriggerVars("onAdd", "module")).toEqual(expect.arrayContaining(["$trigger.occurrenceId", "$trigger.containerId", "$trigger.containerLabel"]));
  });
});
