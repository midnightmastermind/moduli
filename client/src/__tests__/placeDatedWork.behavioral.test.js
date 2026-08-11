// __tests__/placeDatedWork.behavioral.test.js
//
// Drives the REAL `Schedule: Place Dated Work` pipeline through the REAL
// executor against a hand-built Schedule, and asserts on the PLACEMENTS that
// land — not on the shape of the JSON.
//
// Why behavioral rather than structural: this project's builder tests assert
// pipeline shape, and shape has repeatedly been right while behaviour was
// wrong (a LOOP whose `over` silently iterated the whole grid; an `if` reading
// `step.predicate` instead of `step.condition` and running its branch
// unconditionally; APPLY_TEMPLATE's mode-gated signature). A pipeline is a
// program, and the only honest test of a program is running it.
import { describe, it, expect, beforeEach } from "vitest";
import { executePipeline, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import {
  makeSchedulePlaceDatedWorkOp,
  makeStampCompletedOnOp,
} from "../../../server/utils/liveSystemBuilders.js";

// ── field ids, fixed so assertions can name them ───────────────────────────
const DATE = "f-date", TIMESLOT = "f-timeslot", DURATION = "f-duration";
const DUE = "f-due", COMPLETED_ON = "f-completedon", SCHED_FMT = "f-schedfmt";
const COMPLETED = "f-completed";
const APPT_TPL = "mod-appointment";
const SCHED_PAGE = "occ-schedule-page";

const DAY = "2026-08-10";
const OTHER_DAY = "2026-08-11";

// 48 half-hour labels, the shape the Time Slot field's own options carry.
const LABELS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2), min = i % 2 ? "30" : "00";
  const mer = h24 < 12 ? "am" : "pm", h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${min}${mer}`;
});

let occurrencesById, modulesById;

const fv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, flow: "in" }]));

function occ(id, { role, kind, moduleId, parentId, fields = {}, occurrences = [], meta = {}, label }) {
  occurrencesById[id] = { id, role, kind, moduleId, parentId, fields: fv(fields), occurrences, meta, label };
  return id;
}

/** Build a Schedule with one day column: a TODO container + 48 slot containers.
 *
 * This fixture held a "Due" container until 2026-08-11. Due and Todo were the
 * same thing under two markers — same role, kind and binding — so they were
 * merged and due-dated work now lands in Todo (migration 0070). The container
 * is still matched by its MARKER, never its label. */
function buildDay(dayKey, dayColId) {
  const slotIds = LABELS.map((label, i) => {
    const id = `${dayColId}-slot-${i}`;
    occ(id, {
      role: "container", kind: "board", moduleId: `mod-slot-${i}`, parentId: dayColId,
      label, fields: { [SCHED_FMT]: "slot", [TIMESLOT]: label, [DATE]: dayKey },
    });
    return id;
  });
  const dueId = `${dayColId}-due`;
  occ(dueId, {
    role: "container", kind: "board", moduleId: "mod-due", parentId: dayColId,
    label: "Todo", fields: { [TIMESLOT]: "Todo", [DATE]: dayKey },
  });
  occ(dayColId, {
    role: "container", kind: "board", moduleId: `mod-daycol-${dayKey}`, parentId: SCHED_PAGE,
    label: `Schedule - ${dayKey}`, fields: { [SCHED_FMT]: "day-col", [DATE]: dayKey },
    occurrences: [dueId, ...slotIds],
  });
  return { dueId, slotIds };
}

function ctx() {
  return {
    state: {
      grid: { _id: "g", activeFilterValues: {} },
      gridId: "g",
      fields: [], modules: Object.values(modulesById), occurrencesById, modulesById,
      fieldsById: {}, operationsById: {}, operations: [],
    },
    fieldsById: {}, operationsById: {}, occurrencesById, modulesById,
  };
}

/** Run an op's pipeline and fold its effects back into the world. */
function run(op, transaction = {}) {
  // NOTE the argument order — (operation, CONTEXT, TRANSACTION). Getting it
  // backwards hands the executor a context with no occurrences, `$allItems`
  // comes back empty, and every assertion below fails in a way that reads
  // exactly like a broken pipeline. Cost one debugging round.
  const updates = executePipeline(op, ctx(), transaction) || [];
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}

const childrenOf = (id) => occurrencesById[id]?.occurrences || [];
const slotAt = (slotIds, label) => slotIds[LABELS.indexOf(label)];

const placeOp = () => makeSchedulePlaceDatedWorkOp({
  userId: "u", gridId: "g",
  dateFieldId: DATE, timeslotFieldId: TIMESLOT, durationFieldId: DURATION,
  dueFieldId: DUE, completedOnFieldId: COMPLETED_ON, scheduleFormatFieldId: SCHED_FMT,
  schedulePageOccId: SCHED_PAGE, appointmentTemplateId: APPT_TPL,
});

let dayCol;

beforeEach(() => {
  occurrencesById = {};
  modulesById = {
    [APPT_TPL]: { id: APPT_TPL, label: "Appointment", role: "instance", fieldBindings: [] },
    "mod-task": { id: "mod-task", label: "Task", role: "instance", fieldBindings: [] },
    "mod-due": { id: "mod-due", label: "Todo", role: "container", kind: "board", fieldBindings: [] },
  };
  LABELS.forEach((l, i) => {
    modulesById[`mod-slot-${i}`] = { id: `mod-slot-${i}`, label: l, role: "container", kind: "board", fieldBindings: [] };
  });
  modulesById[`mod-daycol-${DAY}`] = { id: `mod-daycol-${DAY}`, label: "day", role: "container", kind: "board", fieldBindings: [] };
  occ(SCHED_PAGE, { role: "page", kind: "board", moduleId: "mod-schedpage", label: "Schedule", occurrences: [] });
  modulesById["mod-schedpage"] = { id: "mod-schedpage", label: "Schedule", role: "page", kind: "board", fieldBindings: [] };
  dayCol = buildDay(DAY, "daycol-1");
  occurrencesById[SCHED_PAGE].occurrences = ["daycol-1"];
  // The op reads $activePeriodDates off the Schedule page's filter cascade.
  occurrencesById[SCHED_PAGE].filterOverride = { [DATE]: DAY };
});

// ============================================================
// PHASE 1 — appointments
// ============================================================
describe("Place Dated Work — an appointment covers every slot it spans", () => {
  it("a 2:00pm–3:00pm appointment lands in BOTH the 2:00pm and 2:30pm slots", () => {
    occ("appt-therapy", {
      role: "instance", moduleId: APPT_TPL, label: "Therapy with Keith",
      fields: { [DATE]: DAY, [TIMESLOT]: "2:00pm", [DURATION]: 60 },
    });
    run(placeOp());

    expect(childrenOf(slotAt(dayCol.slotIds, "2:00pm"))).toContain("appt-therapy");
    expect(childrenOf(slotAt(dayCol.slotIds, "2:30pm"))).toContain("appt-therapy");
    // Half-open: the slot it ENDS on is free.
    expect(childrenOf(slotAt(dayCol.slotIds, "3:00pm"))).not.toContain("appt-therapy");
    expect(childrenOf(slotAt(dayCol.slotIds, "1:30pm"))).not.toContain("appt-therapy");
  });

  it("places ONE occurrence in several parents — never a copy per slot", () => {
    occ("appt-group", {
      role: "instance", moduleId: APPT_TPL, label: "Peer Support Group",
      fields: { [DATE]: DAY, [TIMESLOT]: "6:00pm", [DURATION]: 120 },
    });
    const before = Object.keys(occurrencesById).length;
    run(placeOp());

    for (const l of ["6:00pm", "6:30pm", "7:00pm", "7:30pm"]) {
      expect(childrenOf(slotAt(dayCol.slotIds, l)), l).toContain("appt-group");
    }
    // The whole point of multi-parenting: no new rows exist, so ticking it in
    // one slot is ticking THE appointment.
    expect(Object.keys(occurrencesById).length).toBe(before);
  });

  it("is idempotent — a second run adds nothing", () => {
    occ("appt-1", { role: "instance", moduleId: APPT_TPL, fields: { [DATE]: DAY, [TIMESLOT]: "9:00am", [DURATION]: 60 } });
    run(placeOp());
    const after1 = childrenOf(slotAt(dayCol.slotIds, "9:00am")).slice();
    run(placeOp());
    expect(childrenOf(slotAt(dayCol.slotIds, "9:00am"))).toEqual(after1);
  });

  it("moving the appointment SWEEPS the slots it no longer covers", () => {
    occ("appt-move", { role: "instance", moduleId: APPT_TPL, fields: { [DATE]: DAY, [TIMESLOT]: "2:00pm", [DURATION]: 60 } });
    run(placeOp());
    expect(childrenOf(slotAt(dayCol.slotIds, "2:00pm"))).toContain("appt-move");

    // The user edits the time.
    occurrencesById["appt-move"] = {
      ...occurrencesById["appt-move"],
      fields: { ...occurrencesById["appt-move"].fields, [TIMESLOT]: { value: "4:00pm", flow: "in" } },
    };
    run(placeOp());

    expect(childrenOf(slotAt(dayCol.slotIds, "2:00pm"))).not.toContain("appt-move");
    expect(childrenOf(slotAt(dayCol.slotIds, "2:30pm"))).not.toContain("appt-move");
    expect(childrenOf(slotAt(dayCol.slotIds, "4:00pm"))).toContain("appt-move");
  });

  it("leaves a NON-appointment sitting in a slot alone", () => {
    // A dragged task is not this op's to move. The sweep must be narrow.
    occ("task-dragged", { role: "instance", moduleId: "mod-task", fields: { [DATE]: DAY, [TIMESLOT]: "2:00pm" } });
    const slot = slotAt(dayCol.slotIds, "2:00pm");
    occurrencesById[slot].occurrences = ["task-dragged"];
    run(placeOp());
    expect(childrenOf(slot)).toContain("task-dragged");
  });

  it("ignores an appointment on a different day", () => {
    occ("appt-other", { role: "instance", moduleId: APPT_TPL, fields: { [DATE]: OTHER_DAY, [TIMESLOT]: "2:00pm", [DURATION]: 60 } });
    run(placeOp());
    expect(childrenOf(slotAt(dayCol.slotIds, "2:00pm"))).not.toContain("appt-other");
  });
});

// ============================================================
// PHASE 2 — due-dated work
// ============================================================
describe("Place Dated Work — due-dated tasks fill the Todo container", () => {
  const task = (id, fields) => occ(id, { role: "instance", moduleId: "mod-task", fields });

  it("an outstanding task due later lands in today's Todo", () => {
    task("task-signup", { [DUE]: OTHER_DAY });
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toContain("task-signup");
  });

  it("a task with NO due date never enters Todo", () => {
    task("task-paul", {}); // "Work on Paul's website" — organized on Tasks, not dated
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).not.toContain("task-paul");
  });

  it("still shows on the day it was completed, and is swept the day after", () => {
    task("task-done", { [DUE]: "2026-08-11", [COMPLETED_ON]: DAY });
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toContain("task-done");

    // Tomorrow's column gets built and the op runs for it.
    const tomorrow = buildDay(OTHER_DAY, "daycol-2");
    modulesById[`mod-daycol-${OTHER_DAY}`] = { id: `mod-daycol-${OTHER_DAY}`, role: "container", kind: "board", fieldBindings: [] };
    occurrencesById[SCHED_PAGE].occurrences = ["daycol-1", "daycol-2"];
    occurrencesById[SCHED_PAGE].filterOverride = { [DATE]: OTHER_DAY };
    run(placeOp());

    expect(childrenOf(tomorrow.dueId)).not.toContain("task-done");
    // …and the day it WAS done still reads truthfully.
    expect(childrenOf(dayCol.dueId)).toContain("task-done");
  });

  // THE DISCRIMINATING CASE for the phase-2 sweep. The "swept the day after"
  // test above passes even with the sweep disabled, because the task was never
  // placed on tomorrow to begin with — it asserts an absence that was never a
  // presence. This one places it FIRST, then stops it being due, so only a real
  // unlink can satisfy it.
  it("completing it earlier REMOVES it from a day that already listed it", () => {
    task("task-sweep", { [DUE]: OTHER_DAY });
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toContain("task-sweep");

    // Completed two days ago — so today should no longer show it.
    occurrencesById["task-sweep"] = {
      ...occurrencesById["task-sweep"],
      fields: { ...occurrencesById["task-sweep"].fields, [COMPLETED_ON]: { value: "2026-08-08", flow: "in" } },
    };
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).not.toContain("task-sweep");
  });

  it("un-completing brings it back", () => {
    task("task-undo", { [DUE]: OTHER_DAY, [COMPLETED_ON]: "2026-08-01" });
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).not.toContain("task-undo");

    occurrencesById["task-undo"] = {
      ...occurrencesById["task-undo"],
      fields: { ...occurrencesById["task-undo"].fields, [COMPLETED_ON]: { value: null, flow: "in" } },
    };
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toContain("task-undo");
  });

  it("leaves a child with no due date in Todo exactly where it was", () => {
    // A Pay Bill copy seeded by another op. Narrow sweep or the user loses it.
    occ("bill-copy", { role: "instance", moduleId: "mod-task", label: "Pay Bill" });
    occurrencesById[dayCol.dueId].occurrences = ["bill-copy"];
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toContain("bill-copy");
  });

  it("is idempotent", () => {
    task("task-idem", { [DUE]: OTHER_DAY });
    run(placeOp());
    const after1 = childrenOf(dayCol.dueId).slice();
    run(placeOp());
    expect(childrenOf(dayCol.dueId)).toEqual(after1);
  });
});

// ============================================================
// The stamp that phase 2 depends on
// ============================================================
describe("Stamp Completed On", () => {
  const stampOp = () => makeStampCompletedOnOp({
    userId: "u", gridId: "g", completedFieldId: COMPLETED, completedOnFieldId: COMPLETED_ON,
  });
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("stamps today when Completed goes true", () => {
    occ("t1", { role: "instance", moduleId: "mod-task", fields: { [COMPLETED]: true } });
    run(stampOp(), { occurrenceId: "t1", fieldId: COMPLETED, value: true });
    expect(occurrencesById["t1"].fields[COMPLETED_ON]?.value).toBe(today());
  });

  // `false` is not empty — an IS_NOT_EMPTY gate here would stamp on the
  // un-tick, which is exactly backwards and would strand the task forever.
  it("CLEARS the stamp when Completed goes false", () => {
    occ("t2", { role: "instance", moduleId: "mod-task", fields: { [COMPLETED]: false, [COMPLETED_ON]: "2026-08-01" } });
    run(stampOp(), { occurrenceId: "t2", fieldId: COMPLETED, value: false });
    expect(occurrencesById["t2"].fields[COMPLETED_ON]?.value ?? null).toBeNull();
  });
});
