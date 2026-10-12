import { describe, it, expect } from "vitest";
import { planReminderOps, reminderOpId } from "../helpers/reminderSync.js";
import { isDueAt } from "../state/useScheduler.js";

const field = { id: "fRem", gridId: "g", name: "Reminder", type: "when", meta: { reminder: true } };
const plain = { id: "fWhen", gridId: "g", name: "Schedule", type: "when", meta: {} };
const when = { mode: "once", date: "2026-10-13", time: "09:00" };
const occ = (id, w = when, extra = {}) => ({ id, moduleId: "m1", label: `Item ${id}`, fields: { fRem: { value: w } }, ...extra });

describe("reminder fields -> Alarms list", () => {
  it("creates one reminder per value, named after the occurrence; a field without the option makes none", () => {
    const { create } = planReminderOps({ fields: [field, plain], occurrences: [occ("a"), { id: "b", fields: { fWhen: { value: when } } }], gridId: "g" });
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({ id: reminderOpId("a", "fRem"), name: "Reminder: Item a", enabled: true,
      alarm: { type: "reminder", when, source: { occurrenceId: "a", fieldId: "fRem" } }, schedule: { kind: "when", when } });
  });

  it("is a no-op once in step; an edited value reschedules and re-arms", () => {
    const first = planReminderOps({ fields: [field], occurrences: [occ("a")], gridId: "g" }).create;
    const rung = [{ ...first[0], enabled: false, schedule: { ...first[0].schedule, lastFiredAt: "2026-10-13T14:00:00Z" } }];
    expect(planReminderOps({ fields: [field], occurrences: [occ("a")], operations: rung, gridId: "g" })).toEqual({ create: [], update: [], remove: [] });
    const later = { mode: "once", date: "2026-10-14", time: "09:00" };
    const { update } = planReminderOps({ fields: [field], occurrences: [occ("a", later)], operations: rung, gridId: "g" });
    expect(update[0]).toMatchObject({ enabled: true, schedule: { when: later, lastFiredAt: null } });
  });

  it("removes a reminder whose value was cleared, but not one whose occurrence has not loaded yet", () => {
    const ops = planReminderOps({ fields: [field], occurrences: [occ("a")], gridId: "g" }).create;
    expect(planReminderOps({ fields: [field], occurrences: [occ("a", null)], operations: ops, gridId: "g" }).remove).toEqual([ops[0].id]);
    expect(planReminderOps({ fields: [field], occurrences: [], operations: ops, gridId: "g", complete: false }).remove).toEqual([]);
    expect(planReminderOps({ fields: [field], occurrences: [], operations: ops, gridId: "g", complete: true }).remove).toEqual([ops[0].id]);
  });

  it("skips feed copies and placed copies (a copy carries its source's value)", () => {
    expect(planReminderOps({ fields: [field], occurrences: [occ("c", when, { meta: { feedSourceId: "a" } })], gridId: "g" }).create).toEqual([]);
    expect(planReminderOps({ fields: [field], occurrences: [occ("d", when, { meta: { appliedFromTemplateId: "a" } })], gridId: "g" }).create).toEqual([]);
  });

  it("the scheduler fires a when-schedule once per moment, within a grace window", () => {
    const sched = { kind: "when", when: { mode: "weekdays", days: [1], time: "09:00" } };
    const monday905 = new Date(2026, 9, 12, 9, 5);
    expect(isDueAt(sched, monday905, null)).toBe(true);
    expect(isDueAt(sched, monday905, new Date(2026, 9, 12, 9, 0, 30).toISOString())).toBe(false);
    expect(isDueAt(sched, new Date(2026, 9, 12, 11, 0), null)).toBe(false);   // two hours late: not rung
  });
});
