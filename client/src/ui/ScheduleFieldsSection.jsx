// Grid settings › Schedule — writes `grid.meta.scheduleFieldIds`
// ({ dateFieldId, timeslotFieldId, scheduleFormatFieldId, pageOccurrenceId }).
//
// The Alarms dropdown reads it to file a fired alarm into today's Schedule slot
// (helpers/alarmOps.alarmScheduleSteps) and the Pomodoro timer reads its Time Slot
// field. Only the seed ever wrote it, so a grid built in the UI could make an alarm
// that rang and never reached the Schedule (2026-09-22 (16)); the rebuild got real
// day columns on 2026-10-05, which is what makes the setting worth having.
import React, { useMemo } from "react";
import FieldSelect from "./FieldSelect.jsx";
import DestinationPicker from "./DestinationPicker.jsx";

/** Every page on the grid as a picker option. Pure. */
export function schedulePageOptions(occurrences = [], modules = []) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  return occurrences
    .filter((o) => modById.get(o.moduleId)?.role === "page")
    .map((o) => ({ id: o.id, label: o.label || modById.get(o.moduleId)?.label || o.id, hint: modById.get(o.moduleId)?.kind || "page" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** `meta` with one key of scheduleFieldIds set (or removed when empty). Pure. */
export function withScheduleField(meta, key, value) {
  const next = { ...(meta || {}) };
  const ids = { ...(next.scheduleFieldIds || {}) };
  if (value) ids[key] = value; else delete ids[key];
  if (Object.keys(ids).length) next.scheduleFieldIds = ids; else delete next.scheduleFieldIds;
  return next;
}

export default function ScheduleFieldsSection({ grid, fields = [], occurrences = [], modules = [], onMetaChange }) {
  const ids = grid?.meta?.scheduleFieldIds || {};
  const pages = useMemo(() => schedulePageOptions(occurrences, modules), [occurrences, modules]);
  const ofType = (t) => fields.filter((f) => f?.type === t);
  const set = (key) => (value) => onMetaChange?.(withScheduleField(grid?.meta, key, value || null));
  const row = { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 };
  const lab = { width: 130, fontSize: 11, color: "var(--text-muted)" };
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Schedule</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        Where a fired alarm files itself, and which slot field the Pomodoro timer stamps.
      </div>
      <div style={row}><span style={lab}>Schedule page</span>
        <DestinationPicker options={pages} value={ids.pageOccurrenceId || null} onChange={set("pageOccurrenceId")} noneLabel="(none)" placeholder="Choose a page…" searchPlaceholder="Search pages…" ariaLabel="Schedule page" /></div>
      <div style={row}><span style={lab}>Date field</span>
        <FieldSelect fields={ofType("date")} value={ids.dateFieldId || null} onChange={set("dateFieldId")} noneLabel="(none)" ariaLabel="Schedule date field" /></div>
      <div style={row}><span style={lab}>Time slot field</span>
        <FieldSelect fields={ofType("select")} value={ids.timeslotFieldId || null} onChange={set("timeslotFieldId")} noneLabel="(none)" ariaLabel="Schedule time slot field" /></div>
      <div style={row}><span style={lab}>Day-column format field</span>
        <FieldSelect fields={ofType("select")} value={ids.scheduleFormatFieldId || null} onChange={set("scheduleFormatFieldId")} noneLabel="(none)" ariaLabel="Schedule format field" /></div>
    </div>
  );
}
