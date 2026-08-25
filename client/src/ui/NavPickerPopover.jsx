// ui/NavPickerPopover.jsx
// Date picker for filter nav. Supports single / range / multi / week / month / year
// modes via DrilldownTimePicker (custom; replaced react-multi-date-picker
// 2026-05-21 in commit 0c18352f). Auto-detects mode from selection:
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
import MenuSurface from "./MenuSurface.jsx";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar, DateObject } from "react-multi-date-picker";
import DatePanel from "react-multi-date-picker/plugins/date_panel";
import Toolbar from "react-multi-date-picker/plugins/toolbar";
import "react-multi-date-picker/styles/backgrounds/bg-dark.css";
import "react-multi-date-picker/styles/colors/teal.css";
import "./filterCalendar.css";
import { summarizeSelection } from "./filterSummary";
import { seedSelection, cycleDay, barPosition } from "./daySelectionCycle";

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

// Pretty summary for the trigger button — lists distinct days and ranges
// ("May 6, May 9–12, May 20") via the shared formatter.
function formatSummary(shape) {
  if (!shape || !shape.value) return "Pick";
  return summarizeSelection(shape, { maxSegments: 3 }) || "Pick";
}

export default function NavPickerPopover({ value, onCommit, constraints, triggerLabel = null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);

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
      // The popover is PORTALED to <body> (to escape the filter dropdown's
      // overflow clip), so it's outside wrapRef in the DOM — check it explicitly
      // or clicking a date would close the picker.
      const inTrigger = wrapRef.current && wrapRef.current.contains(e.target);
      const inPopover = popoverRef.current && popoverRef.current.contains(e.target);
      if (!inTrigger && !inPopover) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Day list carried by the incoming persisted shape (multi → dates[];
  // range → value..value+span-1; single → [value]). Used to seed the picker's
  // working state when it opens.
  const initialDays = (sh) => {
    if (Array.isArray(sh.dates) && sh.dates.length) return sh.dates.map(s => s.slice(0, 10));
    if (sh.value && sh.span > 1) {
      const s = parseISO(sh.value);
      const out = [];
      for (let i = 0; i < sh.span; i++) out.push(toISO(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)));
      return out;
    }
    if (sh.value) return [String(sh.value).slice(0, 10)];
    return [];
  };

  // Working selection while the popover is open — the on/link/off model.
  // (Seeded from the persisted shape; local state is authoritative while open.)
  const [sel, setSel] = useState(() => seedSelection(initialDays(shape)));
  // Re-seed each time the popover opens so external value changes are picked up.
  useEffect(() => {
    if (open) setSel(seedSelection(initialDays(shape)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Day-clicks are handled by us (mapDays onClick); set a guard so the
  // library's own onChange (fired in same tick when value prop changes
  // OR same-day toggle in `multiple` mode) doesn't clobber the click we
  // just processed and overwrite the distinct/range kind map.
  const clickGuard = useRef(false);
  // Stash the keys snapshot from our most recent cycleDay commit so we can
  // detect when the library's onChange is just echoing our value back. If
  // the picked days exactly match what we just set, it's an echo — no-op
  // (otherwise seedSelection would re-derive every adjacent pair as a
  // bar and clobber a deliberately-distinct neighbor pair).
  const lastCommittedKeys = useRef([]);

  // Push a working selection out to the parent in the persisted shape.
  const commit = (nextSel) => {
    let working = nextSel;
    if (maxDays && working.keys.length > maxDays) {
      working = seedSelection(working.keys.slice(-maxDays)); // keep most recent N
    }
    setSel(working);
    lastCommittedKeys.current = working.keys;
    if (!working.keys.length) {
      onCommit?.({ kind: "single", value: null, span: 1, dates: null, unit: "day" });
      return;
    }
    const next = classifySelection(working.keys.map(parseISO));
    if (!next) return;
    if (allowedKinds && !allowedKinds.includes(next.kind)) {
      if (next.kind === "multi" && allowedKinds.includes("range")) next.kind = "range";
      else if (!allowedKinds.includes("single")) return;
    }
    onCommit?.(next);
  };

  const handleDayClick = (dateObj) => {
    const d = typeof dateObj?.toDate === "function" ? dateObj.toDate() : new Date(dateObj);
    if (isNaN(d?.getTime())) return;
    clickGuard.current = true;
    commit(cycleDay(sel, toISO(d)));
    // rAF (not setTimeout 0) keeps the guard alive past any microtask /
    // synchronous onChange the library fires during click handling. The
    // guard releases on the next paint, well after React has flushed the
    // post-click render and the library has settled.
    requestAnimationFrame(() => { clickGuard.current = false; });
  };

  // Fires from the side panel × (remove), toolbar deselect, OR — depending
  // on library version — as an echo right after our day-click. We block
  // echos two ways: clickGuard for the same-tick path, and an
  // identity check against the keys we just committed for any later echo.
  const handleExternalChange = (picked) => {
    if (clickGuard.current) return;
    const toJs = (d) => (typeof d?.toDate === "function" ? d.toDate() : new Date(d));
    const days = [];
    const arr = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const e of arr) {
      const d = toJs(Array.isArray(e) ? e[0] : e);
      if (d && !isNaN(d.getTime())) days.push(toISO(d));
    }
    // Echo check: if the library is just reporting our committed keys back,
    // do nothing. Otherwise seedSelection would re-derive contiguous days
    // as range and overwrite a deliberate distinct-pair (the original bug
    // that broke distinct → range fill: library echoed a fresh-distinct
    // back, seedSelection promoted it to "range" because of an adjacent
    // distinct, then on the next click cycleDay saw "range" instead of
    // "distinct" and jumped straight to "off").
    const last = lastCommittedKeys.current || [];
    const lastSorted = [...last].sort();
    const daysSorted = [...days].sort();
    if (lastSorted.length === daysSorted.length &&
        lastSorted.every((k, i) => k === daysSorted[i])) {
      return;
    }
    commit(seedSelection(days));
  };

  const todayKey = toISO(new Date());
  // Per-day classes: today = square marker, selected distinct = circle,
  // selected ranged = connected bar (start/mid/end for rounding).
  const mapDays = ({ date }) => {
    const d = typeof date?.toDate === "function" ? date.toDate() : new Date(date);
    const key = toISO(d);
    const classes = [];
    if (key === todayKey) classes.push("moduli-today");
    const kind = sel.kind[key];
    if (kind === "distinct") classes.push("moduli-distinct");
    else if (kind === "range") {
      classes.push("moduli-ranged");
      const pos = barPosition(sel, key);
      if (pos) classes.push(`moduli-range-${pos}`);
    }
    return { className: classes.join(" "), onClick: () => handleDayClick(date) };
  };

  const pickerValue = useMemo(() => sel.keys, [sel.keys]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Pick date / range / multi / weeks / months"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: triggerLabel ? "1px 8px" : "1px 6px",
          // The date pill in a page/panel header. 12/10 -> 13/11 (user,
          // 2026-08-25: "the pill for the filters (the date in the example)
          // should be bigger as well", then "make those 12s be 13s"). It sits
          // beside the chips FilterNavWidgets draws at `FILTER_FONT_PX`, so the
          // two have to move together or the header reads at two sizes.
          fontSize: triggerLabel ? 13 : 11,
          minWidth: triggerLabel ? 96 : "auto",
          justifyContent: "center",
          background: "transparent", color: "inherit",
          border: "1px solid var(--panel-border, #374151)", borderRadius: 4,
          cursor: "pointer",
        }}
      >
        <CalendarIcon size={11} />
        <span>{triggerLabel || summary}</span>
      </button>
      {open && (
        <MenuSurface
          surfaceRef={popoverRef}
          className="filter-daypicker-popover"
          zIndex={9999}
          onClose={() => setOpen(false)}
          position={(() => {
            const r = wrapRef.current?.getBoundingClientRect();
            const EST_W = 400; // calendar + selected-dates panel
            const top = r ? r.bottom + 4 : 8;
            const left = r ? Math.max(6, Math.min(r.left, window.innerWidth - EST_W - 8)) : 8;
            return { top, left };
          })()}
        >
          <Calendar
            multiple
            format="YYYY-MM-DD"
            value={pickerValue}
            onChange={handleExternalChange}
            mapDays={mapDays}
            className="bg-dark teal moduli-calendar"
            plugins={[
              <DatePanel key="panel" position="right" sort="date" removeButton />,
              <Toolbar key="toolbar" position="bottom" sort={["today", "deselect", "close"]} />,
            ]}
          />
          {maxDays && (
            <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4, textAlign: "center" }}>
              Up to {maxDays} day{maxDays === 1 ? "" : "s"}
            </div>
          )}
        </MenuSurface>
      )}
    </span>
  );
}

export { classifySelection, formatSummary, hydrateSelection };
