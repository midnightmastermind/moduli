// __tests__/placementActions.test.js
//
// The two placement DECISION actions: SLOTS_COVERED and IS_DUE_ON.
//
// `slotSpan.js` and `dueSpan.js` are already tested as pure functions. What is
// tested HERE is the seam — that a stored pipeline can reach them, that its
// exprs resolve, and that the defaults are what the ops rely on. Every case
// below fails outright when the two action cases are removed (the switch falls
// through and the var is never bound), which is what makes them discriminating
// rather than a restatement of the helpers' own suites.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const ctx = () => ({ state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {} });

// A real day: 48 half-hour labels, in clock order, the way the Time Slot
// field's own options are shaped.
const DAY_LABELS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2);
  const min = i % 2 ? "30" : "00";
  const mer = h24 < 12 ? "am" : "pm";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${min}${mer}`;
});

describe("SLOTS_COVERED", () => {
  it("binds every slot a 60-minute appointment covers", () => {
    const $vars = { $start: "2:00pm", $mins: 60, $labels: DAY_LABELS };
    executeActionItem(
      "SLOTS_COVERED",
      { start: "$start", duration: "$mins", slotLabels: "$labels", to: "$covered" },
      $vars, [], ctx(),
    );
    expect($vars.$covered).toEqual(["2:00pm", "2:30pm"]);
  });

  it("defaults the target var to $slotsCovered", () => {
    const $vars = { $labels: DAY_LABELS };
    executeActionItem(
      "SLOTS_COVERED",
      { start: "literal:6:00pm", duration: "literal:120", slotLabels: "$labels" },
      $vars, [], ctx(),
    );
    expect($vars.$slotsCovered).toEqual(["6:00pm", "6:30pm", "7:00pm", "7:30pm"]);
  });

  // The half-open interval, asserted through the action rather than only the
  // helper: two back-to-back appointments must not both claim 3:00pm, or the
  // 3:00pm slot shows the one that already ended.
  it("does not claim the slot an appointment ends on", () => {
    const $vars = { $labels: DAY_LABELS };
    executeActionItem(
      "SLOTS_COVERED",
      { start: "literal:2:00pm", duration: "literal:60", slotLabels: "$labels", to: "$a" },
      $vars, [], ctx(),
    );
    executeActionItem(
      "SLOTS_COVERED",
      { start: "literal:3:00pm", duration: "literal:60", slotLabels: "$labels", to: "$b" },
      $vars, [], ctx(),
    );
    expect($vars.$a).not.toContain("3:00pm");
    expect($vars.$b[0]).toBe("3:00pm");
  });

  // A missing label list must bind an EMPTY array, not undefined — the op
  // loops the result, and looping undefined is a crash inside a pipeline that
  // is otherwise fine.
  it("binds an empty array when the day has no slot labels", () => {
    const $vars = {};
    executeActionItem(
      "SLOTS_COVERED",
      { start: "literal:2:00pm", duration: "literal:60", slotLabels: "$missing", to: "$covered" },
      $vars, [], ctx(),
    );
    expect($vars.$covered).toEqual([]);
  });

  it("writes no effects — it is a decision, not a placement", () => {
    const $vars = { $labels: DAY_LABELS };
    const updates = [];
    executeActionItem(
      "SLOTS_COVERED",
      { start: "literal:2:00pm", duration: "literal:60", slotLabels: "$labels" },
      $vars, updates, ctx(),
    );
    expect(updates).toEqual([]);
  });
});

describe("IS_DUE_ON", () => {
  it("is true up to and including the due date", () => {
    const $vars = { $due: "2026-08-11" };
    for (const day of ["2026-08-08", "2026-08-11"]) {
      executeActionItem("IS_DUE_ON", { due: "$due", day: `literal:${day}`, to: "$d" }, $vars, [], ctx());
      expect($vars.$d, day).toBe(true);
    }
  });

  it("shows an overdue task for three days through the ACTION, then stops", () => {
    // The pipeline verb has to carry the same contract as the helper — an op
    // deciding placement from a stale rule is how a schedule and its own tests
    // end up disagreeing. Updated with the helper on 2026-08-18 (user: "not put
    // past dues in the todo list after 3 days").
    const $vars = { $due: "2026-08-11" };
    executeActionItem("IS_DUE_ON", { due: "$due", day: "literal:2026-08-14", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(true);   // 3 days over — still listed
    executeActionItem("IS_DUE_ON", { due: "$due", day: "literal:2026-08-15", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(false);  // 4 days over — the schedule lets go
    executeActionItem("IS_DUE_ON", { due: "$due", day: "literal:2026-08-20", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(false);
  });

  it("stops the day AFTER completion, and still shows on the day it was done", () => {
    const $vars = { $due: "2026-08-11", $done: "2026-08-09" };
    executeActionItem("IS_DUE_ON", { due: "$due", completedOn: "$done", day: "literal:2026-08-09", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(true);
    executeActionItem("IS_DUE_ON", { due: "$due", completedOn: "$done", day: "literal:2026-08-10", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(false);
  });

  // The guard that keeps "Work on Paul's website" on the Tasks page instead of
  // leaking into every Due container forever.
  it("is false when there is no due date", () => {
    const $vars = {};
    executeActionItem("IS_DUE_ON", { due: "$nothing", day: "literal:2026-08-08", to: "$d" }, $vars, [], ctx());
    expect($vars.$d).toBe(false);
  });

  it("defaults the target var to $isDue", () => {
    const $vars = {};
    executeActionItem("IS_DUE_ON", { due: "literal:2026-08-11", day: "literal:2026-08-08" }, $vars, [], ctx());
    expect($vars.$isDue).toBe(true);
  });

  it("writes no effects", () => {
    const updates = [];
    executeActionItem("IS_DUE_ON", { due: "literal:2026-08-11", day: "literal:2026-08-08" }, {}, updates, ctx());
    expect(updates).toEqual([]);
  });
});
