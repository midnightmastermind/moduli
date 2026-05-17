// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFilterNavAction } from "../state/actions";
import { resolveOptions } from "../helpers/optionsResolver";

const stepByUnit = { day: 86400000, week: 86400000 * 7, month: 86400000 * 30, year: 86400000 * 365 };

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
  const unit = filter.timeUnit || "day";
  const stepMs = stepByUnit[unit] || stepByUnit.day;
  const write = makeWriter(filter, onNav, dispatch);
  const isDateString = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
  const onPrev = () => {
    const d = parseDateValue(value).getTime();
    const next = new Date(d - stepMs);
    write(isDateString || !value ? localDayISO(next) : next.toISOString());
  };
  const onNext = () => {
    const d = parseDateValue(value).getTime();
    const next = new Date(d + stepMs);
    write(isDateString || !value ? localDayISO(next) : next.toISOString());
  };
  const label = value ? parseDateValue(value).toLocaleDateString() : "—";
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button onClick={onPrev} title="Prev" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronLeft size={14} /></button>
      <span style={{ minWidth: 80, textAlign: "center", fontSize: 12 }}>{label}</span>
      <button onClick={onNext} title="Next" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronRight size={14} /></button>
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

export default function FilterNavWidget({ filter, navConfig, value, fieldsById, dispatch, onNav }) {
  const style = navConfig?.style || defaultStyleForFilter(filter, fieldsById);
  const options = navConfig?.options || derivedOptionsForFilter(filter, fieldsById);
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

export function derivedOptionsForFilter(filter, fieldsById) {
  const fld = filter?.primaryDateFieldId ? fieldsById?.[filter.primaryDateFieldId] : null;
  if (fld?.type === "boolean") return [true, false];
  if (fld?.type === "select") return resolveOptions(fld, {}).options.map(o => o.value);
  return [];
}
