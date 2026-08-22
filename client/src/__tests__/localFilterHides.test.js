// A container can now HIDE rows by predicate — opt-in, and inert without the flag.
//
// User, 2026-08-22: *"tasks that are being completed in the task container (not dragged
// to schedule though), is not moving to the completed section"*. Measured first: the
// `Completed` feed IS receiving them. What does not happen is the ORIGINAL leaving its
// category container, so a done task shows in both places. `0179` tried MOVING the rows
// and `0180` retracted it — `Completed` is a materialized feed, not a folder — so the
// answer has to hide the source, not move it.
//
// There was no per-container way to do that: `getLocalFilterConditions` deliberately
// drops condition-bearing entries, because the Trackers page uses one to rescope NUMBERS
// and gating visibility by it would empty the page. Hence an opt-in flag rather than a
// changed default.
import { describe, it, expect } from "vitest";
import { getLocalFilterConditions, isOccurrenceVisible } from "../state/selectors";

const COMPLETED = "tZWiPDQUDP74";
const notDone = {
  operator: "AND",
  rules: [{ id: "r", left: `$occ.fields.${COMPLETED}.value`, comparator: "IS_NOT", right: true }],
};
const container = (entry) => ({ id: "c", filters: [entry] });
const task = (done) => ({ id: "t", fields: done === undefined ? {} : { [COMPLETED]: { value: done } } });

describe("getLocalFilterConditions — the opt-in", () => {
  it("contributes the condition group when the entry says `hides`", () => {
    const out = getLocalFilterConditions(container({ id: "f", active: true, hides: true, condition: notDone }));
    expect(out).toEqual([notDone]);
  });

  it("does NOT hide when the entry declares `hides: false` — the Trackers category axis", () => {
    // Declared, not defaulted. This entry rescopes the NUMBERS and must leave the screen
    // alone; 2026-08-20 (5) measured that hiding by `Tags` would empty the Trackers page.
    expect(getLocalFilterConditions(container({ id: "f", active: true, hides: false, condition: notDone }))).toEqual([]);
  });

  it("ignores an inactive entry even when it opts in", () => {
    expect(getLocalFilterConditions(container({ id: "f", active: false, hides: true, condition: notDone }))).toEqual([]);
  });

  it("leaves the plain fieldId form exactly as it was", () => {
    const out = getLocalFilterConditions(container({ id: "f", active: true, fieldId: "abc" }));
    expect(out).toEqual([{ fieldId: "abc", comparator: "IS" }]);
  });
});

describe("what a hiding container actually shows", () => {
  const conds = getLocalFilterConditions(container({ id: "f", active: true, hides: true, condition: notDone }));

  it("hides a COMPLETED task", () => {
    expect(isOccurrenceVisible(task(true), {}, conds)).toBe(false);
  });

  it("keeps an unticked task", () => {
    expect(isOccurrenceVisible(task(false), {}, conds)).toBe(true);
  });

  it("keeps a task that has never been ticked at all — the discriminating case", () => {
    // Most rows carry NO value for Completed. If they were hidden the container would
    // empty, which is the exact failure this opt-in exists to avoid.
    expect(isOccurrenceVisible(task(undefined), {}, conds)).toBe(true);
  });
});
