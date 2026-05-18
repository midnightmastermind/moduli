// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFilterNavAction } from "../state/actions";
import { resolveOptions } from "../helpers/optionsResolver";

// Period units exposed in the D/W/M/Y toggle. Stepping uses Date#setDate /
// setMonth / setFullYear (NOT fixed ms deltas — month/year vary in length).
const UNIT_LABELS = { day: "D", week: "W", month: "M", year: "Y" };
const UNIT_ORDER = ["day", "week", "month", "year"];

function readValueShape(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return { value: v.value ?? null, unit: v.unit || "day" };
  return { value: v ?? null, unit: "day" };
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

function ArrowsWidget({ filter, value, dispatch, onNav }) {
  const shape = readValueShape(value);
  // Unit precedence: the value's own unit (object form) wins over the filter's
  // static timeUnit. Lets users pick D/W/M/Y per-occurrence without rewriting
  // the named filter.
  const unit = shape.unit || filter.timeUnit || "day";
  const allowedUnits = Array.isArray(filter?.units) && filter.units.length
    ? filter.units.filter(u => UNIT_ORDER.includes(u))
    : null;
  const write = makeWriter(filter, onNav, dispatch);
  // Preserve the shape (bare string vs object) of the incoming value when
  // writing back — except when the unit isn't "day", in which case the
  // {value, unit} form is required so trackers can see the period.
  const wasObjectShape = value && typeof value === "object" && !Array.isArray(value);
  const writeNext = (dateStr, nextUnit) => {
    if (wasObjectShape || nextUnit !== "day") write({ value: dateStr, unit: nextUnit });
    else write(dateStr);
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
    writeNext(dateStr, u);
  };
  const label = shape.value ? formatPeriodLabel(parseDateValue(shape.value), unit) : "—";
  const showToggle = !allowedUnits || allowedUnits.length > 1;
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button onClick={onPrev} title="Prev" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronLeft size={14} /></button>
      <span style={{ minWidth: 96, textAlign: "center", fontSize: 12 }}>{label}</span>
      <button onClick={onNext} title="Next" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronRight size={14} /></button>
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
