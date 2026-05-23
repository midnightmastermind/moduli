// ui/DrilldownDatePicker.jsx
//
// Calendar-style multi-select date picker with zoom drilldown.
//
// Four levels of granularity, each a grid the user can click cells in:
//   - "day"   — 7-col month grid (Sun→Sat). Cells are individual dates.
//   - "week"  — 5–6 row stack of week-strips inside the current month.
//   - "month" — 4×3 grid of months in the current year.
//   - "year"  — 4×3 grid of years around the anchor year.
//
// Header has [drill-up ◁] [level title] [drill-up ▷]. Clicking the
// title (or a cell at month/year level) drills DOWN by one level into
// the focused tile.
//
// Nav arrows ([◀] [▶]) shift the anchor by one period at the current
// level (1 day / 1 week / 1 month / 1 year). At "day" and "week" levels,
// if the user has selected N items, every selected item shifts forward
// or backward by the configurable INCREMENT — so 3 days selected with
// increment=2, pressing ▶ shifts each selected day forward by 2 (set
// becomes the same 3-day shape moved 2 days right). Non-consecutive
// selections shift each item independently.
//
// Increment input only renders on day/week levels (months and years
// always advance by 1).
//
// Selection model: a Set of ISO "YYYY-MM-DD" date strings at the day
// level; the week/month/year tiles map to / from this set:
//   - week  → the 7 day-strings inside the visible week-strip
//   - month → every day in the month
//   - year  → every day in the year (kept logical even if big)
//
// onChange fires with the selection as an array of "YYYY-MM-DD"
// strings. Parent owns persistence — the picker is otherwise pure.
//
// Props:
//   value     — array of "YYYY-MM-DD" strings (initial / controlled)
//   onChange  — (next) => void
//   defaultIncrement — initial increment (1)

import React, { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";

// ─── Date helpers ────────────────────────────────────────────────────

const _pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
const fromISO = (s) => {
  if (!s || typeof s !== "string") return new Date(NaN);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addYears  = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };
const startOfWeek = (d) => addDays(d, -d.getDay()); // Sunday
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_LABELS        = ["S","M","T","W","T","F","S"];

// ─── Styling primitives ──────────────────────────────────────────────

const FRAME = {
  display: "inline-flex", flexDirection: "column",
  background: "var(--surface, #1f2125)",
  border: "1px solid var(--border-default)",
  borderRadius: 8, padding: 8, gap: 6,
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: "var(--text-primary)", minWidth: 260,
};
const HEADER = { display: "flex", alignItems: "center", gap: 4 };
const ICON_BTN = {
  width: 22, height: 22, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
  background: "transparent", border: "none",
  color: "var(--text-muted)", cursor: "pointer",
  borderRadius: 4,
};
const TITLE_BTN = {
  flex: 1, height: 22, padding: "0 8px", border: "none",
  background: "transparent", color: "var(--text-primary)",
  cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
  fontWeight: 600, textAlign: "center",
};
const CELL_BASE = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, fontFamily: "var(--font-mono)",
  border: "1px solid transparent", borderRadius: 4,
  cursor: "pointer", userSelect: "none",
  background: "transparent", color: "var(--text-primary)",
};

// ─── Subgrids ────────────────────────────────────────────────────────

function DayGrid({ anchor, selected, onToggle, onShiftToggle }) {
  const m = startOfMonth(anchor);
  const firstCol = m.getDay();
  const days = endOfMonth(anchor).getDate();
  const cells = [];
  // Leading blanks
  for (let i = 0; i < firstCol; i++) cells.push(null);
  // Days
  for (let i = 1; i <= days; i++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), i));
  // Pad to multiple of 7
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
        {DAY_LABELS.map((d, i) => (
          <div key={i} style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 9 }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ height: 26 }} />;
          const iso = toISO(d);
          const isSelected = selected.has(iso);
          const isToday = sameDay(d, today);
          return (
            <button
              key={i}
              onClick={(e) => (e.shiftKey ? onShiftToggle(iso) : onToggle(iso))}
              style={{
                ...CELL_BASE, height: 26,
                background: isSelected ? "rgba(96,165,250,0.22)" : "transparent",
                borderColor: isToday ? "rgba(96,165,250,0.55)" : (isSelected ? "rgba(96,165,250,0.5)" : "transparent"),
                color: isSelected ? "rgb(186,214,255)" : (isToday ? "rgb(186,214,255)" : "var(--text-primary)"),
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ anchor, selected, onToggleWeek }) {
  // List the weeks that intersect the current month, anchored on Sunday.
  const m = startOfMonth(anchor);
  const me = endOfMonth(anchor);
  const weeks = [];
  let cur = startOfWeek(m);
  while (cur <= me) {
    weeks.push(cur);
    cur = addDays(cur, 7);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {weeks.map((wkStart, i) => {
        const wkEnd = addDays(wkStart, 6);
        const wkDays = [];
        for (let k = 0; k < 7; k++) wkDays.push(toISO(addDays(wkStart, k)));
        const allSelected = wkDays.every(d => selected.has(d));
        const someSelected = !allSelected && wkDays.some(d => selected.has(d));
        return (
          <button
            key={i}
            onClick={() => onToggleWeek(wkDays, !allSelected)}
            style={{
              ...CELL_BASE, height: 26, padding: "0 8px", justifyContent: "space-between",
              background: allSelected ? "rgba(96,165,250,0.22)" : someSelected ? "rgba(96,165,250,0.08)" : "transparent",
              borderColor: allSelected ? "rgba(96,165,250,0.5)" : someSelected ? "rgba(96,165,250,0.25)" : "transparent",
            }}
          >
            <span>Week of {MONTH_NAMES_SHORT[wkStart.getMonth()]} {wkStart.getDate()}</span>
            <span style={{ color: "var(--text-faint)", fontSize: 9 }}>
              {wkDays.filter(d => selected.has(d)).length}/7
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MonthGrid({ anchor, onPickMonth }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
      {MONTH_NAMES_SHORT.map((name, mi) => (
        <button
          key={mi}
          onClick={() => onPickMonth(new Date(anchor.getFullYear(), mi, 1))}
          style={{
            ...CELL_BASE, height: 30,
            background: mi === anchor.getMonth() ? "rgba(96,165,250,0.12)" : "transparent",
            borderColor: mi === anchor.getMonth() ? "rgba(96,165,250,0.35)" : "transparent",
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function YearGrid({ anchor, onPickYear }) {
  // Show a 12-year band centered on the anchor.
  const base = anchor.getFullYear() - 5;
  const years = Array.from({ length: 12 }, (_, i) => base + i);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
      {years.map((y) => (
        <button
          key={y}
          onClick={() => onPickYear(new Date(y, 0, 1))}
          style={{
            ...CELL_BASE, height: 30,
            background: y === anchor.getFullYear() ? "rgba(96,165,250,0.12)" : "transparent",
            borderColor: y === anchor.getFullYear() ? "rgba(96,165,250,0.35)" : "transparent",
          }}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────

// Renamed from DrilldownDatePicker 2026-05-22 — separates from the action
// drilldown (now DrilldownPicker). Future: drill further into hours / minutes
// / seconds for datetime inputs (operations + scheduler).
export default function DrilldownTimePicker({ value = [], onChange, defaultIncrement = 1 }) {
  const [level, setLevel] = useState("day");
  const [anchor, setAnchor] = useState(() => {
    const first = Array.isArray(value) && value[0] ? fromISO(value[0]) : new Date();
    return isNaN(first.getTime()) ? new Date() : first;
  });
  const [increment, setIncrement] = useState(defaultIncrement);
  const [lastClicked, setLastClicked] = useState(null);

  // Selection lives as a Set for cheap toggle; we materialize on change.
  const selected = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);

  const emit = useCallback((next) => {
    if (typeof onChange === "function") onChange(Array.from(next).sort());
  }, [onChange]);

  // ── Selection mutators ─────────────────────────────────────────────
  const toggleDay = useCallback((iso) => {
    const next = new Set(selected);
    if (next.has(iso)) next.delete(iso); else next.add(iso);
    setLastClicked(iso);
    emit(next);
  }, [selected, emit]);

  const shiftToggleDay = useCallback((iso) => {
    if (!lastClicked) { toggleDay(iso); return; }
    const a = fromISO(lastClicked);
    const b = fromISO(iso);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const next = new Set(selected);
    for (let d = new Date(lo); d <= hi; d = addDays(d, 1)) next.add(toISO(d));
    emit(next);
  }, [lastClicked, selected, emit, toggleDay]);

  const toggleWeek = useCallback((dayISOs, addAll) => {
    const next = new Set(selected);
    for (const iso of dayISOs) addAll ? next.add(iso) : next.delete(iso);
    emit(next);
  }, [selected, emit]);

  // ── Arrow navigation ───────────────────────────────────────────────
  // At day/week level: if there's a selection, shift every selected
  // date by `increment` days; otherwise just step the anchor.
  // At month/year level: always step by 1 unit (no selection-shift —
  // user spec: "only have it for days and week select").
  const shiftSelectionDays = useCallback((step) => {
    if (selected.size === 0) return false;
    const next = new Set();
    for (const iso of selected) {
      const d = addDays(fromISO(iso), step);
      next.add(toISO(d));
    }
    emit(next);
    return true;
  }, [selected, emit]);

  const onPrev = useCallback(() => {
    if (level === "day"   && shiftSelectionDays(-increment)) return;
    if (level === "week"  && shiftSelectionDays(-increment * 7)) return;
    setAnchor(prev => {
      if (level === "year")  return addYears(prev, -12);
      if (level === "month") return addYears(prev, -1);
      if (level === "week")  return addMonths(prev, -1);
      return addMonths(prev, -1);
    });
  }, [level, increment, shiftSelectionDays]);

  const onNext = useCallback(() => {
    if (level === "day"   && shiftSelectionDays(increment)) return;
    if (level === "week"  && shiftSelectionDays(increment * 7)) return;
    setAnchor(prev => {
      if (level === "year")  return addYears(prev, 12);
      if (level === "month") return addYears(prev, 1);
      if (level === "week")  return addMonths(prev, 1);
      return addMonths(prev, 1);
    });
  }, [level, increment, shiftSelectionDays]);

  // ── Drilldown ──────────────────────────────────────────────────────
  const drillUp = useCallback(() => {
    if (level === "day")   setLevel("week");
    else if (level === "week")  setLevel("month");
    else if (level === "month") setLevel("year");
  }, [level]);
  const drillDown = useCallback(() => {
    if (level === "year")  setLevel("month");
    else if (level === "month") setLevel("week");
    else if (level === "week")  setLevel("day");
  }, [level]);

  const titleText = useMemo(() => {
    if (level === "year")  return "Years";
    if (level === "month") return String(anchor.getFullYear());
    if (level === "week")  return `Weeks of ${MONTH_NAMES_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
    return `${MONTH_NAMES_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }, [level, anchor]);

  // ── Render ─────────────────────────────────────────────────────────
  const supportsIncrement = level === "day" || level === "week";

  return (
    <div style={FRAME}>
      {/* Drill bar */}
      <div style={HEADER}>
        <button style={ICON_BTN} onClick={drillDown} disabled={level === "day"}
          title="Zoom in" >
          <ChevronDown size={14} style={{ opacity: level === "day" ? 0.25 : 0.85 }} />
        </button>
        <button style={TITLE_BTN} onClick={drillUp} disabled={level === "year"} title="Zoom out">
          {titleText}
        </button>
        <button style={ICON_BTN} onClick={drillUp} disabled={level === "year"} title="Zoom out">
          <ChevronUp size={14} style={{ opacity: level === "year" ? 0.25 : 0.85 }} />
        </button>
      </div>

      {/* Nav bar */}
      <div style={HEADER}>
        <button style={ICON_BTN} onClick={onPrev} title="Previous">
          <ChevronLeft size={14} />
        </button>
        {supportsIncrement && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>step</span>
            <input
              type="number"
              min={1}
              value={increment}
              onChange={(e) => setIncrement(Math.max(1, Number(e.target.value) || 1))}
              style={{
                width: 40, height: 20, padding: "0 4px",
                border: "1px solid var(--border-default)", borderRadius: 4,
                background: "var(--input-bg)", color: "var(--text-primary)",
                fontFamily: "var(--font-mono)", fontSize: 10, textAlign: "center",
              }}
            />
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>
              {selected.size > 0 ? `${selected.size} selected` : "no selection"}
            </span>
          </span>
        )}
        {!supportsIncrement && <span style={{ flex: 1 }} />}
        <button style={ICON_BTN} onClick={onNext} title="Next">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Body — level-dispatched */}
      <div>
        {level === "day"   && <DayGrid anchor={anchor} selected={selected} onToggle={toggleDay} onShiftToggle={shiftToggleDay} />}
        {level === "week"  && <WeekGrid anchor={anchor} selected={selected} onToggleWeek={toggleWeek} />}
        {level === "month" && <MonthGrid anchor={anchor} onPickMonth={(d) => { setAnchor(d); setLevel("week"); }} />}
        {level === "year"  && <YearGrid  anchor={anchor} onPickYear={(d)  => { setAnchor(d); setLevel("month"); }} />}
      </div>

      {/* Footer — selection summary + clear */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderTop: "1px solid var(--border-subtle)", paddingTop: 4, marginTop: 2 }}>
          <span style={{ fontSize: 9, color: "var(--text-faint)" }}>
            {selected.size === 1 ? "1 date" : `${selected.size} dates`} selected
          </span>
          <button
            onClick={() => emit(new Set())}
            style={{
              ...ICON_BTN, width: "auto", padding: "0 8px",
              fontSize: 9, color: "var(--danger-text)",
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
