// helpers/alarmOps.js
// Pure builders for alarm/reminder Operations (the Alarms tab's data layer).
//
// An alarm IS an operation: `op.alarm = { type, label, time }` marks it as
// managed by the Alarms tab, `op.schedule = { kind:"atTimes", times:[time] }`
// makes useScheduler fire it daily at that HH:MM, and the pipeline is a single
// NOTIFY (sound on for alarms, silent for reminders). The Operations tab
// renders alarm-managed ops READ-ONLY — the only editor is the Alarms tab.
import { uid } from "../uid";

// "17:00" → "5:00 PM" (Android-style display).
export function formatAlarmTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return String(hhmm || "");
  let h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

function alarmPipeline({ type, label, time }) {
  const ring = type === "alarm";
  return {
    sources: [],
    steps: [
      {
        id: uid(),
        type: "action",
        config: {
          type: "NOTIFY",
          message: `${ring ? "⏰" : "🔔"} ${label || (ring ? "Alarm" : "Reminder")} — ${formatAlarmTime(time)}`,
          sound: ring,
          // Alarms linger like Android's notification until dismissed-ish;
          // reminders use a long-but-finite toast.
          duration: ring ? 60_000 : 15_000,
        },
      },
    ],
  };
}

function alarmName({ type, label, time }) {
  return `${type === "alarm" ? "Alarm" : "Reminder"}: ${label || formatAlarmTime(time)}`;
}

// Mint a fresh alarm/reminder Operation. `time` is "HH:MM" 24h.
export function buildAlarmOperation({ id = uid(), gridId, userId = undefined, type = "alarm", label = "", time = "08:00", enabled = true, sortOrder = 0 }) {
  return {
    id, gridId, ...(userId ? { userId } : {}),
    name: alarmName({ type, label, time }),
    description: "Managed by the Alarms tab — edit it there.",
    alarm: { type, label, time },
    schedule: { kind: "atTimes", times: [time], suppressNotifications: false, lastFiredAt: null },
    triggerObjects: [], triggerTypes: [], triggerType: "manual",
    pipeline: alarmPipeline({ type, label, time }),
    enabled,
    sortOrder,
    folderId: null,
    priority: 5,
  };
}

// Apply an Alarms-tab edit to an existing alarm op — rewrites the derived
// pieces (name, schedule.times, NOTIFY step) from the new alarm config so the
// op can never drift from what the tab shows. lastFiredAt is preserved except
// when the TIME changes (a moved alarm should fire at its new time today).
export function applyAlarmToOperation(op, patch = {}) {
  const alarm = { ...(op.alarm || {}), ...patch };
  const timeChanged = op.alarm?.time !== alarm.time;
  return {
    ...op,
    name: alarmName(alarm),
    alarm,
    schedule: {
      ...(op.schedule || {}),
      kind: "atTimes",
      times: [alarm.time],
      lastFiredAt: timeChanged ? null : (op.schedule?.lastFiredAt ?? null),
    },
    pipeline: alarmPipeline(alarm),
    enabled: "enabled" in patch ? !!patch.enabled : op.enabled,
  };
}

// The Alarms tab's list: alarm-managed ops for this grid, stable time order.
export function listAlarmOperations(operationsById, gridId) {
  return Object.values(operationsById || {})
    .filter((op) => op && op.alarm && (!gridId || op.gridId === gridId))
    .sort((a, b) => String(a.alarm.time).localeCompare(String(b.alarm.time)) || String(a.id).localeCompare(String(b.id)));
}
