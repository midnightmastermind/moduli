// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFilterNavAction } from "../state/actions";
import { resolveOptions } from "../helpers/optionsResolver";
import NavPickerPopover from "./NavPickerPopover.jsx";
import { summarizeSelection } from "./filterSummary";

// The type size of the filter controls that sit in a page/panel HEADER — the
// option chips, the select and the text box. One constant rather than three
// inline literals, for the reason `FIELD_FONT_PX` exists: an inline size is
// what this repo loses time to when a stylesheet bump "silently does nothing".
// 11 -> 12 (user, 2026-08-24: "make the filter button pill in the headrs one
// font size bigger too"), then 12 -> 13 (user, 2026-08-25: "the pill for the
// filters (the date in the example) should be bigger as well" — one step). It
// tracks `FIELD_FONT_PX` deliberately: the pill sits directly above the field
// pills, and the two reading at different sizes is what both reports were about.
const FILTER_FONT_PX = 13;

// Period units exposed in the D/W/M/Y toggle. Stepping uses Date#setDate /
// setMonth / setFullYear (NOT fixed ms deltas — month/year vary in length).
const UNIT_ORDER = ["day", "week", "month", "year"];

// Filter value shape: { value, unit, span?, kind?, dates? }
//   value: ISO date string (YYYY-MM-DD) — the anchor / start
//   unit:  "day" | "week" | "month" | "year"
//   span:  number of days covered (>=1)
//   kind:  "single" | "range" | "multi" | "week" | "month" | "year"
//          Drives downstream rendering branch (Schedule op reads day count;
//          kind preserves intent for richer display).
//   dates: ISO[] — only set when kind === "multi" (non-consecutive). When set,
//          dates wins over value+span in the cascade.
function readValueShape(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const span = Number(v.span);
    return {
      value: v.value ?? null,
      unit: v.unit || "day",
      span: Number.isFinite(span) && span > 1 ? Math.floor(span) : 1,
      kind: v.kind || (Number.isFinite(span) && span > 1 ? "range" : "single"),
      dates: Array.isArray(v.dates) ? v.dates : null,
    };
  }
  return { value: v ?? null, unit: "day", span: 1, kind: "single", dates: null };
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

// DateRangePickerPopover removed — replaced by NavPickerPopover which supports
// single/range/multi/week/month/year selection in one component.

// Resolve nav-arrow behavior. Cascade priority (per design):
//   1. kind === "multi" (non-consecutive days) → arrows DISABLED
//   2. span > 1 (range / week / month / year)  → arrows shift by span (in days)
//   3. single                                  → arrows shift by step.n of step.unit
//                                                (step from navConfig override, then filter, defaults to 1 day)
function resolveArrowBehavior(shape, navConfig, filter) {
  if (shape.kind === "multi") return { disabled: true, stepUnit: "day", stepN: 0 };
  const step = navConfig?.step || filter?.step || null;
  if (shape.span > 1) {
    // Range / week / month / year — step by the period itself.
    return { disabled: false, stepUnit: "day", stepN: shape.span };
  }
  return {
    disabled: false,
    stepUnit: step?.unit || shape.unit || filter?.timeUnit || "day",
    stepN: Number.isFinite(step?.n) && step.n > 0 ? step.n : 1,
  };
}

function ArrowsWidget({ filter, navConfig, value, dispatch, onNav }) {
  const shape = readValueShape(value);
  // Unit precedence: the value's own unit (object form) wins over the filter's
  // static timeUnit. Lets users pick D/W/M/Y per-occurrence without rewriting
  // the named filter.
  const unit = shape.unit || filter.timeUnit || "day";
  const span = shape.span || 1;
  const allowedUnits = Array.isArray(filter?.units) && filter.units.length
    ? filter.units.filter(u => UNIT_ORDER.includes(u))
    : null;
  // Cascaded constraints — occurrence's navConfig.constraints wins, then filter's.
  const constraints = navConfig?.constraints || filter?.constraints || null;
  const write = makeWriter(filter, onNav, dispatch);

  // Object shape is required as soon as the value carries unit != "day" OR a
  // span > 1 OR a discrete dates[] OR a non-default kind. Day-unit + span=1 +
  // single kind preserves the bare-string form for byte-identical legacy
  // serialization.
  const wasObjectShape = value && typeof value === "object" && !Array.isArray(value);
  const writeNext = (dateStr, nextUnit, nextSpan = span, extras = null) => {
    const needsObject = wasObjectShape || nextUnit !== "day" || nextSpan > 1 || extras;
    if (needsObject) {
      const out = { value: dateStr, unit: nextUnit };
      if (nextSpan > 1) out.span = nextSpan;
      if (extras?.kind) out.kind = extras.kind;
      if (extras?.dates) out.dates = extras.dates;
      write(out);
    } else {
      write(dateStr);
    }
  };

  const arrow = resolveArrowBehavior(shape, navConfig, filter);
  const onPrev = () => {
    if (arrow.disabled) return;
    const anchor = parseDateValue(shape.value || new Date());
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (arrow.stepUnit === "week")       d.setDate(d.getDate() - arrow.stepN * 7);
    else if (arrow.stepUnit === "month") d.setMonth(d.getMonth() - arrow.stepN);
    else if (arrow.stepUnit === "year")  d.setFullYear(d.getFullYear() - arrow.stepN);
    else                                  d.setDate(d.getDate() - arrow.stepN);
    writeNext(localDayISO(d), unit, span);
  };
  const onNext = () => {
    if (arrow.disabled) return;
    const anchor = parseDateValue(shape.value || new Date());
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (arrow.stepUnit === "week")       d.setDate(d.getDate() + arrow.stepN * 7);
    else if (arrow.stepUnit === "month") d.setMonth(d.getMonth() + arrow.stepN);
    else if (arrow.stepUnit === "year")  d.setFullYear(d.getFullYear() + arrow.stepN);
    else                                  d.setDate(d.getDate() + arrow.stepN);
    writeNext(localDayISO(d), unit, span);
  };
  const onUnitChange = (u) => {
    const dateStr = shape.value ? localDayISO(parseDateValue(shape.value)) : localDayISO(new Date());
    // Switching off day-unit clears the span (day-only feature for now).
    writeNext(dateStr, u, u === "day" ? span : 1);
  };

  // Label reads from the persisted shape's kind for richer display.
  const baseLabel = shape.value ? formatPeriodLabel(parseDateValue(shape.value), unit) : "—";
  const label = (() => {
    // Multi or multi-day span → list the actual days/ranges. Single + week/
    // month/year keep the weekday/period label for at-a-glance reading.
    const isListed = (shape.kind === "multi" && Array.isArray(shape.dates) && shape.dates.length)
      || (unit === "day" && span > 1);
    if (isListed) return summarizeSelection(shape, { maxSegments: 3 }) || baseLabel;
    return baseLabel;
  })();
  const showToggle = !allowedUnits || allowedUnits.length > 1;

  // NavPicker emits { kind, value, span, dates, unit } — fold into our shape.
  const onPickerCommit = (next) => {
    const extras = {};
    if (next.kind) extras.kind = next.kind;
    if (next.kind === "multi" && Array.isArray(next.dates)) extras.dates = next.dates;
    writeNext(next.value, next.unit || "day", next.span || 1, extras);
  };

  // Wrap the central label as the calendar trigger so the picker is
  // discoverable — clicking the date opens the full multi-date-picker
  // calendar popover. Prev/next arrows stay for quick day stepping.
  // D/W/M/Y toggle removed per user direction — the calendar handles
  // ranges and multi-day natively via the picker's own modes.
  return (
    <div style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={onPrev}
        disabled={arrow.disabled}
        title={arrow.disabled ? "Arrows disabled — discrete days selected" : "Prev"}
        style={{
          background: "transparent", border: 0,
          color: arrow.disabled ? "var(--text-faint, #666)" : "inherit",
          cursor: arrow.disabled ? "not-allowed" : "pointer",
          opacity: arrow.disabled ? 0.4 : 1,
        }}
      ><ChevronLeft size={14} /></button>
      <NavPickerPopover
        value={value}
        constraints={constraints}
        onCommit={onPickerCommit}
        triggerLabel={label}
      />
      <button
        onClick={onNext}
        disabled={arrow.disabled}
        title={arrow.disabled ? "Arrows disabled — discrete days selected" : "Next"}
        style={{
          background: "transparent", border: 0,
          color: arrow.disabled ? "var(--text-faint, #666)" : "inherit",
          cursor: arrow.disabled ? "not-allowed" : "pointer",
          opacity: arrow.disabled ? 0.4 : 1,
        }}
      ><ChevronRight size={14} /></button>
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
            padding: "2px 8px", borderRadius: 999, fontSize: FILTER_FONT_PX,
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
        padding: "2px 6px", fontSize: FILTER_FONT_PX,
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
        padding: "2px 6px", fontSize: FILTER_FONT_PX,
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
  if (style === "arrows") return <ArrowsWidget filter={filter} navConfig={navConfig} value={value} dispatch={dispatch} onNav={onNav} />;
  if (style === "pills" || style === "custom") return <PillsWidget filter={filter} value={value} options={options} dispatch={dispatch} onNav={onNav} />;
  if (style === "select") return <SelectWidget filter={filter} value={value} options={options} dispatch={dispatch} onNav={onNav} />;
  if (style === "input") return <InputWidget filter={filter} value={value} dispatch={dispatch} onNav={onNav} />;
  return null;
}

// Resolve the filter's primary field. Two seed shapes in the wild:
//   - legacy: filter.primaryDateFieldId (removed Apr 24 in favor of isNav)
//   - current: filter.fieldId (local occurrence filters) OR the first nav-flagged
//     condition's fieldId (grid namedFilters)
function primaryFieldOf(filter) {
  if (!filter) return null;
  if (filter.primaryDateFieldId) return filter.primaryDateFieldId;
  if (filter.fieldId) return filter.fieldId;
  const navCond = (filter.conditions || []).find(c => c?.isNav && c.fieldId);
  return navCond?.fieldId || null;
}

export function defaultStyleForFilter(filter, fieldsById) {
  // Author-set style wins (e.g. Schedule's timeslot filter pins "select").
  if (filter?.style) return filter.style;
  const fld = (() => {
    const fid = primaryFieldOf(filter);
    return fid ? fieldsById?.[fid] : null;
  })();
  if (fld?.type === "date") return "arrows";
  if (fld?.type === "select" || fld?.type === "boolean") return "pills";
  if (fld?.type === "number") return "arrows";
  return "input";
}

export function derivedOptionsForFilter(filter, fieldsById, ctx = {}) {
  if (Array.isArray(filter?.options) && filter.options.length) return filter.options;
  const fid = primaryFieldOf(filter);
  const fld = fid ? fieldsById?.[fid] : null;
  if (fld?.type === "boolean") return [true, false];
  if (fld?.type === "select") return resolveOptions(fld, { fieldsById, ...ctx }).options.map(o => o.value);
  return [];
}
