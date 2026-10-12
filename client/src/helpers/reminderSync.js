// helpers/reminderSync.js
//
// A REMINDER FIELD's values become entries in the Alarms list (user, 2026-10-12: "a field named reminder
// thats a date and time or an interval … that sets reminders in the alarms area"). Which fields count is
// DATA: a `when` field with `meta.reminder` set in the Fields tab — nothing here knows a field's name.
//
// Each (occurrence, field) with a value owns exactly one operation, id `rem:<occurrenceId>:<fieldId>`, so
// every tab computes the same plan and a create can never duplicate. The operation is an ordinary alarm
// op (`op.alarm`) with `alarm.source` naming where it came from, `schedule.kind: "when"` (useScheduler),
// and a NOTIFY step. It follows its value: an edit reschedules it, a cleared value or a deleted
// occurrence removes it. A one-time reminder that rang is switched off by the scheduler, not removed.
import { describeWhen, isWhen } from "./when.js";
import { occurrenceDisplayLabel } from "./occurrenceLabel.js";

export const reminderOpId = (occurrenceId, fieldId) => `rem:${occurrenceId}:${fieldId}`;

const sameWhen = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** PURE. The op a reminder value implies. `existing` keeps its enabled flag and last fire unless the value moved. */
export function reminderOperation({ occurrence, module, field, when, gridId, existing = null }) {
  const label = occurrenceDisplayLabel(occurrence, module, "Reminder");
  const moved = !existing || !sameWhen(existing.alarm?.when, when);
  return {
    ...(existing || {}),
    id: reminderOpId(occurrence.id, field.id),
    gridId,
    name: `Reminder: ${label}`,
    description: `From the ${field.name} field — change it there.`,
    alarm: { type: "reminder", label, when, source: { occurrenceId: occurrence.id, fieldId: field.id } },
    schedule: { kind: "when", when, suppressNotifications: false, lastFiredAt: moved ? null : existing.schedule?.lastFiredAt ?? null },
    triggerObjects: [], triggerTypes: [], triggerType: "manual",
    pipeline: { sources: [], steps: [{ id: `${reminderOpId(occurrence.id, field.id)}:notify`, type: "action",
      config: { type: "NOTIFY", message: `🔔 ${label} — ${describeWhen(when)}`, sound: false, duration: 15_000 } }] },
    // A moved value re-arms a reminder that had rung; otherwise the user's on/off choice stands.
    enabled: moved ? true : existing.enabled !== false,
    folderId: existing?.folderId ?? null,
    priority: existing?.priority ?? 5,
  };
}

const opDiffers = (a, b) => a.name !== b.name || a.enabled !== b.enabled
  || !sameWhen(a.alarm, b.alarm) || !sameWhen(a.schedule?.when, b.schedule?.when)
  || (a.schedule?.lastFiredAt ?? null) !== (b.schedule?.lastFiredAt ?? null)
  || a.pipeline?.steps?.[0]?.config?.message !== b.pipeline?.steps?.[0]?.config?.message;

/**
 * PURE. What to create, update and remove so the Alarms list matches the reminder values.
 * `complete` says every occurrence is loaded; until it is, nothing is removed (an occurrence still in the
 * deferred load half is not a deleted one).
 */
export function planReminderOps({ fields = [], occurrences = [], modulesById = {}, operations = [], gridId, complete = true }) {
  const reminderFields = fields.filter((f) => f?.type === "when" && f.meta?.reminder && (!gridId || f.gridId === gridId));
  const existing = new Map(operations.filter((op) => op?.alarm?.source && (!gridId || op.gridId === gridId)).map((op) => [op.id, op]));
  const create = [], update = [], keep = new Set();
  if (reminderFields.length) {
    for (const occ of occurrences) {
      // A feed copy or a placed copy (the Schedule field's per-day copies carry `appliedFromTemplateId`)
      // carries its source's value; only the source owns the reminder.
      if (!occ?.fields || occ.meta?.feedSourceId || occ.meta?.appliedFromTemplateId) continue;
      for (const f of reminderFields) {
        const when = occ.fields[f.id]?.value;
        if (!isWhen(when)) continue;
        const id = reminderOpId(occ.id, f.id);
        keep.add(id);
        const prev = existing.get(id) || null;
        const next = reminderOperation({ occurrence: occ, module: modulesById[occ.moduleId], field: f, when, gridId, existing: prev });
        if (!prev) create.push(next);
        else if (opDiffers(prev, next)) update.push(next);
      }
    }
  }
  const occIds = complete ? null : new Set(occurrences.map((o) => o?.id));
  const remove = [];
  for (const [id, op] of existing) {
    if (keep.has(id)) continue;
    // Not loaded yet ≠ gone: wait for the whole grid before deciding the occurrence was deleted.
    if (!complete && !occIds.has(op.alarm.source.occurrenceId)) continue;
    remove.push(id);
  }
  return { create, update, remove };
}
