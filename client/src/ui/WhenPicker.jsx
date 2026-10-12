// ui/WhenPicker.jsx
//
// The time menu for a `when` field (helpers/when.js): ONE moment, a repeat EVERY N minutes/hours/days/weeks/
// months from a start, or chosen WEEKDAYS at a time. Used by the Reminder and Schedule fields (2026-10-12).
// Edits a draft; nothing is written until Save, so trying a mode out never fires a reminder.
import React, { useState } from "react";
import { describeWhen, isWhen, WHEN_UNITS, WEEKDAY_SHORT, dayKey } from "../helpers/when.js";

const MODES = [["once", "Once"], ["every", "Every"], ["weekdays", "On days"]];
const box = { fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border-default)",
  background: "var(--input-bg)", color: "var(--text-primary)" };
const chip = (on) => ({ ...box, cursor: "pointer", padding: "3px 7px",
  ...(on ? { background: "var(--accent-blue-bg, rgba(59,130,246,0.18))", borderColor: "var(--accent-blue-border, #3b82f6)" } : {}) });

/** A starting draft from a stored value (or a sensible new one). */
export function draftFrom(value, now = new Date()) {
  const today = dayKey(now);
  const base = {
    once: { mode: "once", date: today, time: "09:00" },
    every: { mode: "every", every: 1, unit: "day", start: { date: today, time: "09:00" } },
    weekdays: { mode: "weekdays", days: [now.getDay()], time: "09:00" },
  };
  if (isWhen(value)) base[value.mode] = structuredClone(value);
  return { mode: isWhen(value) ? value.mode : "once", ...base };
}

export default function WhenPicker({ value, onSave, onClear, onCancel }) {
  const [draft, setDraft] = useState(() => draftFrom(value));
  const cur = draft[draft.mode];
  const set = (patch) => setDraft((d) => ({ ...d, [d.mode]: { ...d[d.mode], ...patch } }));
  const setStart = (patch) => set({ start: { ...cur.start, ...patch } });
  const subDay = cur.mode === "every" && (cur.unit === "minute" || cur.unit === "hour");

  return (
    <div data-testid="when-picker" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, minWidth: 250, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 4 }} role="tablist">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={draft.mode === m}
            onClick={() => setDraft((d) => ({ ...d, mode: m }))} style={chip(draft.mode === m)}>{label}</button>
        ))}
      </div>

      {cur.mode === "once" && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" aria-label="Date" value={cur.date || ""} onChange={(e) => set({ date: e.target.value })} style={box} />
          <input type="time" aria-label="Time" value={cur.time || ""} onChange={(e) => set({ time: e.target.value })} style={box} />
          {cur.time && <button type="button" style={{ ...box, cursor: "pointer" }} onClick={() => set({ time: "" })}>all day</button>}
        </div>
      )}

      {cur.mode === "every" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            every
            <input type="number" min={1} aria-label="Every" value={cur.every}
              onChange={(e) => set({ every: Math.max(1, Number(e.target.value) || 1) })} style={{ ...box, width: 56 }} />
            <select aria-label="Unit" value={cur.unit} onChange={(e) => set({ unit: e.target.value })} style={box}>
              {WHEN_UNITS.map((u) => <option key={u} value={u}>{u}{cur.every > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {subDay ? "starting" : "from"}
            <input type="date" aria-label="Start date" value={cur.start?.date || ""} onChange={(e) => setStart({ date: e.target.value })} style={box} />
            {subDay ? "at" : "at"}
            <input type="time" aria-label="Start time" value={cur.start?.time || ""} onChange={(e) => setStart({ time: e.target.value })} style={box} />
          </div>
        </div>
      )}

      {cur.mode === "weekdays" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = cur.days.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} style={chip(on)}
                  onClick={() => set({ days: on ? cur.days.filter((x) => x !== d) : [...cur.days, d] })}>{WEEKDAY_SHORT[d]}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            at <input type="time" aria-label="Time" value={cur.time || ""} onChange={(e) => set({ time: e.target.value })} style={box} />
          </div>
        </div>
      )}

      <div style={{ color: "var(--text-muted)", minHeight: 16 }}>{isWhen(cur) ? describeWhen(cur) : "Pick at least a date or a day"}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {onClear && value != null && <button type="button" style={{ ...box, cursor: "pointer", marginRight: "auto" }} onClick={onClear}>Clear</button>}
        {onCancel && <button type="button" style={{ ...box, cursor: "pointer" }} onClick={onCancel}>Cancel</button>}
        <button type="button" disabled={!isWhen(cur)} onClick={() => onSave(normalize(cur))}
          style={{ ...chip(true), cursor: isWhen(cur) ? "pointer" : "not-allowed", opacity: isWhen(cur) ? 1 : 0.5 }}>Save</button>
      </div>
    </div>
  );
}

/** Drop empty times so "all day" is stored as no time rather than "". */
function normalize(v) {
  const out = structuredClone(v);
  if (out.mode === "once" && !out.time) delete out.time;
  if (out.mode === "weekdays" && !out.time) delete out.time;
  if (out.mode === "every" && !out.start?.time) delete out.start.time;
  if (out.mode === "weekdays") out.days = [...new Set(out.days.map(Number))].sort();
  return out;
}
