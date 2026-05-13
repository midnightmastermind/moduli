// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFilterNavAction } from "../state/actions";

const stepByUnit = { day: 86400000, week: 86400000 * 7, month: 86400000 * 30, year: 86400000 * 365 };

function ArrowsWidget({ filter, value, dispatch }) {
  const unit = filter.timeUnit || "day";
  const stepMs = stepByUnit[unit] || stepByUnit.day;
  const onPrev = () => {
    const d = value ? new Date(value).getTime() : Date.now();
    dispatch(setFilterNavAction(filter.id, new Date(d - stepMs).toISOString()));
  };
  const onNext = () => {
    const d = value ? new Date(value).getTime() : Date.now();
    dispatch(setFilterNavAction(filter.id, new Date(d + stepMs).toISOString()));
  };
  const label = value ? new Date(value).toLocaleDateString() : "—";
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button onClick={onPrev} title="Prev" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronLeft size={14} /></button>
      <span style={{ minWidth: 80, textAlign: "center", fontSize: 12 }}>{label}</span>
      <button onClick={onNext} title="Next" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronRight size={14} /></button>
    </div>
  );
}

function PillsWidget({ filter, value, options, dispatch }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {(options || []).map(opt => (
        <button
          key={String(opt)}
          onClick={() => dispatch(setFilterNavAction(filter.id, opt))}
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

function InputWidget({ filter, value, dispatch }) {
  const [local, setLocal] = useState(value || "");
  const timer = useRef(null);
  useEffect(() => { setLocal(value || ""); }, [value]);
  const onChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dispatch(setFilterNavAction(filter.id, v)), 250);
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

export default function FilterNavWidget({ filter, navConfig, value, fieldsById, dispatch }) {
  const style = navConfig?.style || defaultStyleForFilter(filter, fieldsById);
  const options = navConfig?.options || derivedOptionsForFilter(filter, fieldsById);
  if (style === "arrows") return <ArrowsWidget filter={filter} value={value} dispatch={dispatch} />;
  if (style === "pills" || style === "custom") return <PillsWidget filter={filter} value={value} options={options} dispatch={dispatch} />;
  if (style === "input") return <InputWidget filter={filter} value={value} dispatch={dispatch} />;
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
  if (fld?.type === "select") return (fld.meta?.options || []).map(o => o.value ?? o);
  return [];
}
