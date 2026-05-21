// ui/NavPickerPopover.jsx
// Date picker for filter nav. Supports single / range / multi / week / month / year
// modes via react-multi-date-picker. Auto-detects mode from selection:
//   1 day                          → kind: "single"
//   N consecutive days             → kind: "range"
//   N non-consecutive days         → kind: "multi"
//   whole calendar week selected   → kind: "week"
//   whole calendar month selected  → kind: "month"
//   whole calendar year selected   → kind: "year"
//
// Constraints (from filterNavConfig.constraints, cascaded over the named filter's
// own constraints) gate the picker UI:
//   maxDays         → mapDays disables days that would push selection past max
//   minDays         → commit blocked until reached
//   allowedUnits    → hides zoom buttons for disallowed units
//   allowedKinds    → suppresses range-drag or multi-mode if disallowed
//
// Emits via `onCommit({ kind, value, span, dates, unit })`. The parent (ArrowsWidget)
// folds that into the persisted filter value shape.
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Calendar } from "lucide-react";
import DrilldownDatePicker from "./DrilldownDatePicker";

const UNIT_LABELS = { day: "D", week: "W", month: "M", year: "Y" };
const UNIT_ORDER = ["day", "week", "month", "year"];

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(s) {
  if (s instanceof Date) return s;
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

// Given an array of Date objects (any order), classify the selection.
// Returns { kind, value, span, dates, unit }.
function classifySelection(dates, currentUnit = "day") {
  if (!dates || dates.length === 0) return null;
  // Sort + dedupe by day string.
  const seen = new Set();
  const sorted = [];
  for (const d of dates) {
    const iso = toISO(d);
    if (!seen.has(iso)) {
      seen.add(iso);
      sorted.push(d);
    }
  }
  sorted.sort((a, b) => a.getTime() - b.getTime());
  const isoList = sorted.map(toISO);

  if (sorted.length === 1) {
    return { kind: "single", value: isoList[0], span: 1, dates: isoList, unit: currentUnit };
  }

  // Consecutive?
  let consecutive = true;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
    if (toISO(expected) !== toISO(curr)) {
      consecutive = false;
      break;
    }
  }

  if (!consecutive) {
    return { kind: "multi", value: isoList[0], span: sorted.length, dates: isoList, unit: "day" };
  }

  // Consecutive — check if it spans a whole calendar week/month/year.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Whole calendar month: first = day 1, last = last day of same month
  if (
    first.getDate() === 1 &&
    last.getMonth() === first.getMonth() &&
    last.getFullYear() === first.getFullYear()
  ) {
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    if (last.getDate() === lastDay) {
      return { kind: "month", value: isoList[0], span: sorted.length, dates: isoList, unit: "month" };
    }
  }

  // Whole calendar year
  if (
    first.getDate() === 1 && first.getMonth() === 0 &&
    last.getDate() === 31 && last.getMonth() === 11 &&
    last.getFullYear() === first.getFullYear()
  ) {
    return { kind: "year", value: isoList[0], span: sorted.length, dates: isoList, unit: "year" };
  }

  // Whole calendar week (Sun-Sat). Two valid week starts: Sun (0) or Mon (1).
  if (sorted.length === 7) {
    if (first.getDay() === 0 || first.getDay() === 1) {
      return { kind: "week", value: isoList[0], span: 7, dates: isoList, unit: "week" };
    }
  }

  return { kind: "range", value: isoList[0], span: sorted.length, dates: isoList, unit: "day" };
}

// Inverse: given our value shape, hydrate a DateObject[] to pass to the picker.
function hydrateSelection({ value, span = 1, dates }) {
  if (Array.isArray(dates) && dates.length > 0) {
    return dates.map(iso => new DateObject(parseISO(iso)));
  }
  if (!value) return [];
  if (span > 1) {
    const start = parseISO(value);
    const arr = [];
    for (let i = 0; i < span; i++) {
      arr.push(new DateObject(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }
    return arr;
  }
  return [new DateObject(parseISO(value))];
}

// Pretty summary for the trigger button.
function formatSummary({ kind, value, span, dates }) {
  if (!value) return "Pick";
  const start = parseISO(value);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (kind === "single") return fmt(start);
  if (kind === "month") return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (kind === "year") return String(start.getFullYear());
  if (kind === "week") return `Week of ${fmt(start)}`;
  if (kind === "multi" && Array.isArray(dates)) {
    if (dates.length <= 3) return dates.map(d => fmt(parseISO(d))).join(", ");
    return `${fmt(parseISO(dates[0]))} +${dates.length - 1}`;
  }
  if (kind === "range") {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (span - 1));
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return fmt(start);
}

export default function NavPickerPopover({ value, onCommit, constraints }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Read shape
  const shape = useMemo(() => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        kind: value.kind || (value.span > 1 ? "range" : "single"),
        value: value.value || null,
        span: value.span || 1,
        dates: Array.isArray(value.dates) ? value.dates : null,
        unit: value.unit || "day",
      };
    }
    return { kind: "single", value: value ?? null, span: 1, dates: null, unit: "day" };
  }, [value]);

  const summary = formatSummary(shape);

  // Constraint reads — cascade is resolved by the caller; we just consume.
  const maxDays = constraints?.maxDays ?? null;
  const allowedUnits = Array.isArray(constraints?.allowedUnits) && constraints.allowedUnits.length
    ? constraints.allowedUnits
    : UNIT_ORDER;
  const allowedKinds = Array.isArray(constraints?.allowedKinds) && constraints.allowedKinds.length
    ? constraints.allowedKinds
    : null;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // DrilldownDatePicker emits a sorted array of "YYYY-MM-DD" strings.
  // Convert to Date[] for classifySelection (the shared classifier
  // detects single / range / multi / week / month / year and emits the
  // persisted filter shape).
  const handleChange = (isoStrings) => {
    if (!Array.isArray(isoStrings) || isoStrings.length === 0) return;
    const jsDates = isoStrings.map(s => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    });
    // Enforce maxDays: trim oldest if exceeded.
    const trimmed = maxDays && jsDates.length > maxDays ? jsDates.slice(-maxDays) : jsDates;
    const next = classifySelection(trimmed);
    if (!next) return;
    // Suppress disallowed kinds — fall back to range/single if multi disallowed.
    if (allowedKinds && !allowedKinds.includes(next.kind)) {
      if (next.kind === "multi" && allowedKinds.includes("range")) {
        next.kind = "range";
      } else if (!allowedKinds.includes("single")) {
        return;
      }
    }
    onCommit?.(next);
  };

  // The DrilldownDatePicker is controlled — feed it the current
  // selection as an ISO string array. Maps from the shape's `dates`
  // (preferred), else the single `value`, else empty.
  const pickerValue = useMemo(() => {
    if (Array.isArray(shape.dates) && shape.dates.length) return shape.dates;
    if (shape.value) return [shape.value];
    return [];
  }, [shape.dates, shape.value]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Pick date / range / weeks / months"
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "1px 6px", fontSize: 10,
          background: "transparent", color: "inherit",
          border: "1px solid var(--panel-border, #374151)", borderRadius: 4,
          cursor: "pointer",
        }}
      >
        <Calendar size={11} />
        <span>{summary}</span>
      </button>
      {open && (
        <div
          className="filter-daypicker-popover"
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            zIndex: 50,
          }}
        >
          {/* The DrilldownDatePicker has its own header chrome (zoom
              chevrons, increment-shift arrows, level title). No outer
              zoom toolbar needed. */}
          <DrilldownDatePicker
            value={pickerValue}
            onChange={handleChange}
          />
          {maxDays && (
            <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4, textAlign: "center" }}>
              Up to {maxDays} day{maxDays === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export { classifySelection, formatSummary, hydrateSelection };
