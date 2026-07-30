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

// The alarm's time as a slot-style timeslot label ("17:00" → "5:00pm",
// "17:15" → "5:15pm"). `exactSlot` is set only when the minute lands on a real
// half-hour slot (0/30) — used to MATCH an existing slot container.
function alarmTimeslotLabel(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return { label: null, exactSlot: null };
  const hour = Number(m[1]);
  const min = Number(m[2]);
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  const label = `${h}:${String(min).padStart(2, "0")}${ampm}`;
  return { label, exactSlot: min === 0 || min === 30 ? label : null };
}

// When `sched` ({ dateFieldId, timeslotFieldId, scheduleFormatFieldId }) is set,
// an alarm firing also drops an instance into TODAY's Schedule (like Pomodoro:
// Start): resolve today's day-col, target the slot matching the alarm's timeslot
// (else the day-col itself), and create the alarm instance once per day —
// matching + de-duping on the TIMESLOT field (not the label) and stamping it on
// the created instance. MUST mirror the server's alarmScheduleSteps in
// utils/liveSystemBuilders.js.
function alarmScheduleSteps({ sched, instanceLabel, time }) {
  if (!sched || !sched.dateFieldId || !sched.scheduleFormatFieldId
      || !sched.timeslotFieldId || !sched.pageOccurrenceId) return [];
  const df = sched.dateFieldId;
  const sf = sched.scheduleFormatFieldId;
  const tf = sched.timeslotFieldId;
  const { label: tsLabel, exactSlot } = alarmTimeslotLabel(time);
  if (!tsLabel) return [];
  return [
    { id: uid(), type: "action", config: { type: "FIND", over: "$allPages",
      predicate: { operator: "AND", rules: [
        { id: uid(), left: "id", comparator: "IS", right: sched.pageOccurrenceId },
      ] }, itemIdVar: "$alSchedPage" } },
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [{ id: uid(), left: "$alSchedPage", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [
        { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alSchedPage" },
            { id: uid(), left: `fields.${sf}.value`, comparator: "IS", right: "day-col" },
            { id: uid(), left: `fields.${df}.value`, comparator: "SAME_DAY", right: "$today" },
          ] }, itemIdVar: "$alDayCol" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$alDayCol", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "SET_VAR", name: "$alTarget", expr: "$alDayCol" } },
            ...(exactSlot ? [
              { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alDayCol" },
                  { id: uid(), left: `fields.${tf}.value`, comparator: "IS", right: exactSlot },
                ] }, itemIdVar: "$alSlot" } },
              { id: uid(), type: "if",
                condition: { operator: "AND", rules: [{ id: uid(), left: "$alSlot", comparator: "IS_NOT_EMPTY", right: "" }] },
                then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$alTarget", expr: "$alSlot" } }],
                else: [] },
            ] : []),
            { id: uid(), type: "action", config: { type: "FIND", over: "$allInstances",
              predicate: { operator: "AND", rules: [
                { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$alDayCol" },
                { id: uid(), left: `fields.${tf}.value`, comparator: "IS", right: tsLabel },
                { id: uid(), left: "label", comparator: "IS", right: instanceLabel },
              ] }, itemIdVar: "$alExisting" } },
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$alExisting", comparator: "IS_EMPTY", right: "" }] },
              then: [
                { id: uid(), type: "action", config: {
                  // No `kind`: it is inert on an instance leaf and the icon
                  // resolver prefers kind over role, so a stray kind:"list" made
                  // every fired alarm draw the BOARD icon on the Schedule
                  // (2026-07-29). The server twin makeAlarmOp already omits it —
                  // these two builders must stay in sync.
                  type: "CREATE", role: "instance", name: instanceLabel,
                  parent: "$alTarget", fields: { [df]: "$today", [tf]: tsLabel },
                  fieldHidden: { [df]: true, [tf]: true },
                } },
              ], else: [] },
          ], else: [] },
      ], else: [] },
  ];
}

function alarmPipeline({ type, label, time, sched }) {
  const ring = type === "alarm";
  const instanceLabel = `${ring ? "⏰" : "🔔"} ${label || (ring ? "Alarm" : "Reminder")}`;
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
      ...alarmScheduleSteps({ sched, instanceLabel, time }),
    ],
  };
}

function alarmName({ type, label, time }) {
  return `${type === "alarm" ? "Alarm" : "Reminder"}: ${label || formatAlarmTime(time)}`;
}

// Mint a fresh alarm/reminder Operation. `time` is "HH:MM" 24h.
// `sched` ({ dateFieldId, timeslotFieldId, scheduleFormatFieldId }) opts the alarm
// into also dropping an instance onto today's Schedule when it fires (see
// alarmScheduleSteps). Stored on op.alarm.sched so applyAlarmToOperation preserves
// it. Resolved from grid.meta.scheduleFieldIds by the Alarms dropdown.
export function buildAlarmOperation({ id = uid(), gridId, userId = undefined, type = "alarm", label = "", time = "08:00", enabled = true, sortOrder = 0, sched = null }) {
  const alarm = { type, label, time, ...(sched ? { sched } : {}) };
  return {
    id, gridId, ...(userId ? { userId } : {}),
    name: alarmName({ type, label, time }),
    description: "Managed by the Alarms tab — edit it there.",
    alarm,
    schedule: { kind: "atTimes", times: [time], suppressNotifications: false, lastFiredAt: null },
    triggerObjects: [], triggerTypes: [], triggerType: "manual",
    pipeline: alarmPipeline(alarm),
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
