// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { setFilterNavAction } from "../state/actions";
import { resolveOptions } from "../helpers/optionsResolver";

// Period units exposed in the D/W/M/Y toggle. Stepping uses Date#setDate /
// setMonth / setFullYear (NOT fixed ms deltas — month/year vary in length).
const UNIT_LABELS = { day: "D", week: "W", month: "M", year: "Y" };
const UNIT_ORDER = ["day", "week", "month", "year"];

function readValueShape(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const span = Number(v.span);
    return {
      value: v.value ?? null,
      unit: v.unit || "day",
      span: Number.isFinite(span) && span > 1 ? Math.floor(span) : 1,
    };
  }
  return { value: v ?? null, unit: "day", span: 1 };
}

function stepByUnit(date, unit, direction) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === "week")       d.setDate(d.getDate() + direction * 7);
  else if (unit === "month") d.setMonth(d.getMonth() + direction);
  else if (unit === "year")  d.setFullYear(d.getFullYear() + direction);
  else                       d.setDate(d.getDate() + direction);
  return d;
}

function formatPeriodLabel(date, unit) {
  if (unit === "week") {
    const start = new Date(date);
    const dow = start.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + offset);
    return `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  if (unit === "month") return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (unit === "year")  return String(date.getFullYear());
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Resolve the write path: if `onNav` is provided, call that (used by the
// HeaderDropdown to auto-unlock the filter for this module via filterOverride).
// Otherwise dispatch the global setFilterNavAction (grid-wide active filter value).
function makeWriter(filter, onNav, dispatch) {
  return (value) => {
    if (typeof onNav === "function") onNav(value);
    else dispatch(setFilterNavAction(filter.id, value));
  };
}

// `new Date("2026-05-14")` parses as UTC midnight; toLocaleDateString / getTime
// then renders in local tz, which drops back a calendar day for tz west of UTC.
// Parse YYYY-MM-DD digits as local-tz components so the displayed/stepped date
// matches the value the user sees in FiltersSection.
function parseDateValue(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return v ? new Date(v) : new Date();
}

function localDayISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// React-Day-Picker popover in range mode. Single click commits a 1-day range;
// click-drag (or click + click-on-end) commits a multi-day range with span =
// days inclusive. Writes back via `onCommit(YYYY-MM-DD, span)` so the parent
// can fold it into the value shape.
function DateRangePickerPopover({ anchor, span, onCommit }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const from = anchor ? parseDateValue(anchor) : null;
  const to = from && span > 1
    ? (() => { const d = new Date(from); d.setDate(d.getDate() + span - 1); return d; })()
    : from;

  const handleSelect = (range) => {
    if (!range || !range.from) return;
    const newFrom = range.from;
    const newTo = range.to || range.from;
    const dayMs = 24 * 60 * 60 * 1000;
    const startMs = new Date(newFrom.getFullYear(), newFrom.getMonth(), newFrom.getDate()).getTime();
    const endMs = new Date(newTo.getFullYear(), newTo.getMonth(), newTo.getDate()).getTime();
    const nextSpan = Math.max(1, Math.round((endMs - startMs) / dayMs) + 1);
    onCommit(localDayISO(newFrom), nextSpan);
    // Auto-close once the user picks a complete range. Single-day picks (no
    // `to`) keep the popover open so the user can drag out a range.
    if (range.to) setOpen(false);
  };

  const summary = from
    ? (span > 1
        ? `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${(to || from).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : from.toLocaleDateString(undefined, { month: "short", day: "numeric" }))
    : "Pick";

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Pick date or range"
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
            background: "hsl(var(--popover-1, 220 13% 12%))",
            border: "1px solid var(--border-default, #374151)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 6,
          }}
        >
          <DayPicker
            mode="range"
            selected={from ? { from, to: to || from } : undefined}
            onSelect={handleSelect}
            numberOfMonths={1}
            showOutsideDays
          />
        </div>
      )}
    </span>
  );
}

function ArrowsWidget({ filter, value, dispatch, onNav }) {
  const shape = readValueShape(value);
  // Unit precedence: the value's own unit (object form) wins over the filter's
  // static timeUnit. Lets users pick D/W/M/Y per-occurrence without rewriting
  // the named filter.
  const unit = shape.unit || filter.timeUnit || "day";
  const span = shape.span || 1;
  const allowedUnits = Array.isArray(filter?.units) && filter.units.length
    ? filter.units.filter(u => UNIT_ORDER.includes(u))
    : null;
  const write = makeWriter(filter, onNav, dispatch);
  // Object shape is required as soon as the value carries unit != "day" OR a
  // span > 1 — otherwise trackers / visibility predicates would lose the
  // period. Day-unit + span=1 preserves the bare-string form for byte-identical
  // legacy serialization.
  const wasObjectShape = value && typeof value === "object" && !Array.isArray(value);
  const writeNext = (dateStr, nextUnit, nextSpan = span) => {
    if (wasObjectShape || nextUnit !== "day" || nextSpan > 1) {
      const out = { value: dateStr, unit: nextUnit };
      if (nextSpan > 1) out.span = nextSpan;
      write(out);
    } else {
      write(dateStr);
    }
  };
  const onPrev = () => {
    const next = stepByUnit(parseDateValue(shape.value || new Date()), unit, -1);
    writeNext(localDayISO(next), unit);
  };
  const onNext = () => {
    const next = stepByUnit(parseDateValue(shape.value || new Date()), unit, +1);
    writeNext(localDayISO(next), unit);
  };
  const onUnitChange = (u) => {
    const dateStr = shape.value ? localDayISO(parseDateValue(shape.value)) : localDayISO(new Date());
    // Switching off day-unit clears the span (day-only feature for now).
    writeNext(dateStr, u, u === "day" ? span : 1);
  };
  // When span > 1 the label reads "Mon May 18 + 2 days" so the user knows the
  // window. Single-day still shows the regular formatted period label.
  const baseLabel = shape.value ? formatPeriodLabel(parseDateValue(shape.value), unit) : "—";
  const label = unit === "day" && span > 1 ? `${baseLabel} + ${span - 1} day${span === 2 ? "" : "s"}` : baseLabel;
  const inputDate = shape.value ? localDayISO(parseDateValue(shape.value)) : "";
  const showToggle = !allowedUnits || allowedUnits.length > 1;
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={onPrev} title="Prev" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronLeft size={14} /></button>
      <span style={{ minWidth: 96, textAlign: "center", fontSize: 12 }}>{label}</span>
      <button onClick={onNext} title="Next" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronRight size={14} /></button>
      {unit === "day" && (
        <DateRangePickerPopover
          anchor={inputDate}
          span={span}
          onCommit={(dateStr, nextSpan) => writeNext(dateStr, "day", nextSpan)}
        />
      )}
      {showToggle && (
        <div style={{ display: "inline-flex", gap: 2, marginLeft: 4 }}>
          {(allowedUnits || UNIT_ORDER).map(u => (
            <button
              key={u}
              onClick={() => onUnitChange(u)}
              title={u}
              style={{
                padding: "1px 5px", fontSize: 10, lineHeight: "12px",
                borderRadius: 4,
                border: "1px solid var(--panel-border, #374151)",
                background: u === unit ? "var(--accent, #14b8a6)" : "transparent",
                color: "inherit", cursor: "pointer",
              }}
            >{UNIT_LABELS[u]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function PillsWidget({ filter, value, options, dispatch, onNav }) {
  const write = makeWriter(filter, onNav, dispatch);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {(options || []).map(opt => (
        <button
          key={String(opt)}
          onClick={() => write(opt)}
          style={{
            padding: "2px 8px", borderRadius: 999, fontSize: 11,
            border: "1px solid var(--panel-border, #374151)",
            background: opt === value ? "var(--accent, #14b8a6)" : "transparent",
            color: "inherit", cursor: "pointer",
          }}
        >{String(opt)}</button>
      ))}
    </div>
  );
}

// Real <select> dropdown — used when there are too many options for the pills
// layout (e.g. the 48 schedule timeslots) or when the author wants a compact
// chrome. Includes an empty option that clears the filter so the user can
// fall back to "all".
function SelectWidget({ filter, value, options, dispatch, onNav }) {
  const write = makeWriter(filter, onNav, dispatch);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => write(e.target.value || null)}
      style={{
        padding: "2px 6px", fontSize: 11,
        background: "transparent", color: "inherit",
        border: "1px solid var(--panel-border, #374151)", borderRadius: 4,
        minWidth: 96, maxWidth: 200,
      }}
    >
      <option value="">— any —</option>
      {(options || []).map(opt => (
        <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
      ))}
    </select>
  );
}

function InputWidget({ filter, value, dispatch, onNav }) {
  const [local, setLocal] = useState(value || "");
  const timer = useRef(null);
  const write = makeWriter(filter, onNav, dispatch);
  useEffect(() => { setLocal(value || ""); }, [value]);
  const onChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => write(v), 250);
  };
  return (
    <input
      value={local} onChange={onChange}
      style={{
        padding: "2px 6px", fontSize: 11,
        background: "transparent", color: "inherit",
        border: "1px solid var(--panel-border, #374151)", borderRadius: 4, width: 140,
      }}
    />
  );
}

export default function FilterNavWidget({ filter, navConfig, value, fieldsById, occurrencesById, modulesById, foldersById, dispatch, onNav }) {
  const style = navConfig?.style || defaultStyleForFilter(filter, fieldsById);
  const ctx = { occurrencesById, modulesById, foldersById };
  const options = navConfig?.options || derivedOptionsForFilter(filter, fieldsById, ctx);
  if (style === "arrows") return <ArrowsWidget filter={filter} value={value} dispatch={dispatch} onNav={onNav} />;
  if (style === "pills" || style === "custom") return <PillsWidget filter={filter} value={value} options={options} dispatch={dispatch} onNav={onNav} />;
  if (style === "select") return <SelectWidget filter={filter} value={value} options={options} dispatch={dispatch} onNav={onNav} />;
  if (style === "input") return <InputWidget filter={filter} value={value} dispatch={dispatch} onNav={onNav} />;
  return null;
}

export function defaultStyleForFilter(filter, fieldsById) {
  const fieldId = filter?.primaryDateFieldId;
  const fld = fieldId ? fieldsById?.[fieldId] : null;
  if (fld?.type === "date") return "arrows";
  if (fld?.type === "select" || fld?.type === "boolean") return "pills";
  if (fld?.type === "number") return "arrows";
  return "input";
}

export function derivedOptionsForFilter(filter, fieldsById, ctx = {}) {
  const fld = filter?.primaryDateFieldId ? fieldsById?.[filter.primaryDateFieldId] : null;
  if (fld?.type === "boolean") return [true, false];
  if (fld?.type === "select") return resolveOptions(fld, { fieldsById, ...ctx }).options.map(o => o.value);
  return [];
}
