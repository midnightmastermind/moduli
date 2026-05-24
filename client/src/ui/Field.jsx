// ui/Field.jsx
// ============================================================
// Unified field component — replaces FieldDisplay, FieldPillDisplay,
// FieldInput, and FieldPillInput. One component for all field rendering.
//
// Behavior:
// - No onCommit prop → display only (read-only)
// - onCommit provided → editable
// - compact=true + numeric/text/duration types → click-to-edit (was FieldPillInput)
// - compact=true + boolean/select → full input controls (they're already small)
// - compact=false → full input controls (was FieldInput)
// ============================================================

import React, { useState, useCallback, useEffect, useMemo, useRef, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Plus, Check, ChevronDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Equal, Shuffle, Link2, Pause, Play, Square, Star, Minus, AlertCircle, AlertTriangle } from "lucide-react";

// Icon-name → lucide component lookup for display rules.
// Authored values are short names (e.g. "ArrowUp", "Pause"); resolved
// at render time. Unknown names render no icon (silent — keeps a typo
// from breaking the display).
const RULE_ICONS = {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Check, X, Pause, Play, Square, Star,
  Minus, Plus, Equal, AlertCircle, AlertTriangle,
};
import {
  checkTarget,
  getScaledTargetValue,
  calculateProgress,
} from "../helpers/CalculationHelpers";
import { createLeafInstanceInParent } from "../helpers/CommitHelpers";
import { resolveFileRef } from "../helpers/fileRef";
import { GridActionsContext } from "../GridActionsContext";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "../state/actions";

// ─── FlowToggle (popover with 3 flow options) ─────────────────
function FlowToggle({ flow = "in", onChange, compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const configs = {
    in:      { icon: ArrowUp,   color: "text-green-400 bg-green-500/20 border-green-500/30", label: "In (+)", desc: "Positive" },
    out:     { icon: ArrowDown, color: "text-red-400 bg-red-500/20 border-red-500/30",       label: "Out (−)", desc: "Negative" },
    replace: { icon: Equal,     color: "text-blue-400 bg-blue-500/20 border-blue-500/30",    label: "Replace", desc: "Overwrites" },
  };
  const options = ["in", "out", "replace"];
  const config = configs[flow] || configs.in;
  const Icon = config.icon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Flow: ${config.label}`}
          className={`inline-flex items-center justify-center rounded border transition-colors flex-shrink-0
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-125"}
            ${config.color} ${compact ? "w-5 h-5" : "w-6 h-6"}`}
        >
          <Icon className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start" side="bottom">
        {options.map((key) => {
          const opt = configs[key];
          const OptIcon = opt.icon;
          return (
            <button key={key} type="button"
              onClick={() => { onChange?.(key); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors
                ${flow === key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
            >
              <OptIcon className={`w-3 h-3 ${flow === key ? "" : "opacity-60"}`} />
              <span>{opt.label}</span>
              <span className="text-[9px] text-muted-foreground ml-auto">{opt.desc}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─── MultiSelectWithAdd ─────────────────────────────────────────
function MultiSelectWithAdd({ name, options, selected, onChange, onAddOption, disabled, compact, showLabel, randomize, renderOption, fieldName }) {
  const [isOpen, setIsOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const selectedOptions = useMemo(() => options.filter(o => selected.includes(o.value)), [options, selected]);
  const toggle = useCallback((v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]), [selected, onChange]);
  const handleAddNew = useCallback(() => {
    if (!newValue.trim()) return;
    const value = newValue.toLowerCase().replace(/\s+/g, "_");
    onAddOption?.({ value, label: newValue.trim() });
    onChange([...selected, value]);
    setNewValue("");
  }, [newValue, selected, onChange, onAddOption]);
  return (
    <div className="field-input field-input-select-multi">
      {showLabel && <Label className="text-xs text-muted-foreground mb-1">{name}</Label>}
      <div className="flex items-center gap-1">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" disabled={disabled}
              className={`w-full justify-between font-normal ${compact ? "h-6 text-xs" : "h-7 text-sm"}`}
              style={fieldName ? { background: "rgba(6,182,212,0.08)", borderColor: "rgba(6,182,212,0.25)", color: "rgb(180,225,245)" } : undefined}>
              {/* occurrence field-pill: always show the field name so it reads
                  as a labelled pill (fixes "occurrence selects show no field
                  name / no pill"). */}
              {fieldName && <span className="text-[10px] mr-1 flex-shrink-0" style={{ opacity: 0.7 }}>{fieldName}:</span>}
              {selectedOptions.length === 0
                ? <span className="text-muted-foreground">{compact ? (fieldName ? "—" : name) : "Select..."}</span>
                : <div className="flex flex-wrap gap-1 items-center overflow-hidden">
                    {selectedOptions.slice(0, 2).map(o => (
                      <span key={o.value} className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] rounded-full bg-primary/20 text-primary">
                        {o.label}
                        <X className="h-2.5 w-2.5 cursor-pointer" onClick={e => { e.stopPropagation(); onChange(selected.filter(v => v !== o.value)); }} />
                      </span>
                    ))}
                    {selectedOptions.length > 2 && <span className="text-[10px] text-muted-foreground">+{selectedOptions.length - 2}</span>}
                  </div>}
              <ChevronDown className="h-3 w-3 opacity-50 flex-shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            {onAddOption && (
              <div className="flex items-center gap-1 p-2 border-b border-border">
                <Input type="text" value={newValue} onChange={e => setNewValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddNew()}
                  className="h-6 text-xs flex-1" placeholder="Add new..." />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddNew} disabled={!newValue.trim()}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto p-1">
              {options.length === 0
                ? <div className="py-4 text-center text-xs text-muted-foreground">No options available</div>
                : options.map(o => (
                    <button key={o.value} type="button" onClick={() => toggle(o.value)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-xs transition-colors
                        ${selected.includes(o.value) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                        ${selected.includes(o.value) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                        {selected.includes(o.value) && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      {renderOption ? renderOption(o) : <span className="truncate">{o.label}</span>}
                    </button>
                  ))}
            </div>
          </PopoverContent>
        </Popover>
        {randomize && options.length > 0 && (
          <Button variant="ghost" size="icon" className={compact ? "h-6 w-6" : "h-7 w-7"} title="Pick random" disabled={disabled}
            onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) onChange([p.value]); }}>
            <Shuffle className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Live-value helpers ────────────────────────────────────────
// Fields with meta.liveSource = "currentTime" | "endOfDayCountdown"
// self-update on a setInterval — no operation/socket churn. Granularity
// is "seconds" (default) or "minutes". The interval lives in React; the
// stored field value is irrelevant (display-only).
const _pad2 = (n) => String(n).padStart(2, "0");
function formatTimeOfDay(d, granularity) {
  const h24 = d.getHours();
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1; // 0→12, 13→1, etc.
  const m = _pad2(d.getMinutes());
  if (granularity === "minutes") return `${h12}:${m} ${period}`;
  return `${h12}:${m}:${_pad2(d.getSeconds())} ${period}`;
}
function formatDurationMs(ms, granularity) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (granularity === "minutes") return `${_pad2(h)}:${_pad2(m)}`;
  return `${_pad2(h)}:${_pad2(m)}:${_pad2(s)}`;
}
// Parse "HH:MM" into a Date at today's wall clock with hours/minutes set.
// Returns null for unparseable. Accepts "24:00" as "next midnight" shorthand.
function _parseHHMM(now, str) {
  if (typeof str !== "string") return null;
  const [hStr, mStr = "0"] = str.split(":");
  const h = Number(hStr); const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(now);
  if (h === 24) {
    d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  } else {
    d.setHours(h, m, 0, 0);
  }
  return d;
}
function useLiveFieldValue(field) {
  const source = field?.meta?.liveSource || null;
  const granularity = field?.meta?.liveGranularity || "seconds";
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!source) return;
    const ms = granularity === "minutes" ? 30_000 : 1_000;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [source, granularity]);
  // Tick reads `Date.now()` at render so the value reflects the latest
  // wall clock without holding stale state.
  if (!source) return null;
  void tick;
  const now = new Date();
  if (source === "currentTime") return formatTimeOfDay(now, granularity);
  if (source === "endOfDayCountdown") {
    // Configurable start/target window. `liveStartTime` ("HH:MM") sets when
    // the countdown should be at full value; `liveTargetTime` ("HH:MM") sets
    // when it should reach zero. Defaults: midnight → next midnight (24:00).
    // Outside the window: clamped to full or zero so the field always
    // displays a sensible duration.
    const targetStr = field?.meta?.liveTargetTime || "24:00";
    const startStr  = field?.meta?.liveStartTime  || null;
    let target = _parseHHMM(now, targetStr);
    if (!target) {
      target = new Date(now); target.setHours(24, 0, 0, 0);
    } else if (target <= now) {
      target.setDate(target.getDate() + 1);
    }
    const start = startStr ? _parseHHMM(now, startStr) : null;
    // Clamp: before start window, show full duration; after target, show 0.
    if (start && now < start) {
      const total = target - start;
      return formatDurationMs(Math.max(0, total), granularity);
    }
    return formatDurationMs(Math.max(0, target - now), granularity);
  }
  return null;
}

// ─── Flow-aware delta indicator ────────────────────────────────
// Tracks the last numeric value and surfaces a transient +N / -N badge
// whenever it changes. Color uses the field's `meta.flow` to mark the
// "good direction" — flow:"in" treats positive deltas as green, flow:"out"
// treats negative deltas as green (so a countdown -1 is positive feedback).
function useFlowDelta(value, holdMs = 1500) {
  const prevRef = useRef(null);
  const [delta, setDelta] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    const numNow = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numNow) && Number.isFinite(prev) && numNow !== prev) {
      setDelta(numNow - prev);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setDelta(null), holdMs);
    }
    if (Number.isFinite(numNow)) prevRef.current = numNow;
    return () => clearTimeout(timerRef.current);
  }, [value, holdMs]);
  return delta;
}
// valueSignColor — picks a color from the field's stored value, used
// when the field has NO target (trackers / unbound numeric fields).
//   red   → negative numeric
//   blue  → null / 0 / empty (the "unfilled / zero" state)
//   green → positive numeric, or any non-empty value (filled)
// Fields that DO have a target use the target-met / target-not-met
// colors instead (see targetMet checks at the call sites).
function valueSignColor(value) {
  if (value == null || value === "" || value === 0) {
    return "var(--accent-blue-text, #bfdbfe)";
  }
  if (typeof value === "number") {
    return value < 0 ? "var(--danger-text)" : "var(--accent-green-text)";
  }
  if (typeof value === "boolean") {
    return value ? "var(--accent-green-text)" : "var(--accent-blue-text, #bfdbfe)";
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? "var(--accent-green-text)" : "var(--accent-blue-text, #bfdbfe)";
  }
  return "var(--accent-green-text)";
}

// Same scheme as valueSignColor but tuned for translucent pill
// backgrounds (used by the compact display variant).
function valueSignPillTint(value) {
  if (value == null || value === "" || value === 0) {
    return { bg: "rgba(96,165,250,0.18)", border: "rgba(96,165,250,0.35)" };
  }
  if (typeof value === "number") {
    return value < 0
      ? { bg: "rgba(248,113,113,0.2)", border: "rgba(248,113,113,0.35)" }
      : { bg: "rgba(34,197,94,0.2)",  border: "rgba(34,197,94,0.35)" };
  }
  if (typeof value === "boolean") {
    return value
      ? { bg: "rgba(34,197,94,0.2)",  border: "rgba(34,197,94,0.35)" }
      : { bg: "rgba(96,165,250,0.18)", border: "rgba(96,165,250,0.35)" };
  }
  if (Array.isArray(value)) {
    return value.length > 0
      ? { bg: "rgba(34,197,94,0.2)",  border: "rgba(34,197,94,0.35)" }
      : { bg: "rgba(96,165,250,0.18)", border: "rgba(96,165,250,0.35)" };
  }
  return { bg: "rgba(34,197,94,0.2)", border: "rgba(34,197,94,0.35)" };
}

function flowDeltaColor(delta, flow) {
  if (delta == null) return null;
  const goodDirection = (flow === "out" && delta < 0) || (flow !== "out" && delta > 0);
  return goodDirection ? "var(--accent-green-text)" : "var(--danger-text)";
}

// ─── Star renderer ─────────────────────────────────────────────
function Stars({ rating, max = 5, size = "w-4 h-4" }) {
  // Parse pixel size from tailwind class (w-3→12, w-4→16, w-5→20)
  const px = size.startsWith("w-3") ? 12 : size.startsWith("w-5") ? 20 : 16;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {Array.from({ length: max }, (_, i) => i + 1).map(star => (
        <svg key={star}
          style={{ width: px, height: px,
            color: star <= Number(rating) ? "#facc15" : "var(--text-faint)",
            fill: star <= Number(rating) ? "#facc15" : "transparent" }}
          viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

// ─── OccurrenceOption — rich picker row ─────────────────────────
// Renders a referenced occurrence the way a "flushed out" search result
// would: poster image (from a role:"media" binding), the label, and a few
// of its field values. Used in every occurrence-type picker so selecting
// an occurrence shows its media + fields + label, not bare text.
// Resolve an occurrence id to the data needed to render an OccurrenceOption.
// `chipDisplay` (optional) is `field.meta.optionsSource.chipDisplay`:
//   { fieldIds: string[], showMedia: boolean, showLabel: boolean }
// When set, the explicit `fieldIds` order wins (any non-empty value renders,
// in the picked order). When null/undefined, falls back to the original
// heuristic: first 3 non-hidden, non-media bindings with non-empty values.
function resolveOccCard(occId, { occurrencesById, modulesById, fieldsById }, chipDisplay = null) {
  const occ = occurrencesById?.[occId];
  if (!occ) return null;
  const mod = modulesById?.[occ.moduleId || occ.targetId] || null;
  const bindings = Array.isArray(mod?.fieldBindings) ? mod.fieldBindings : [];
  const mediaB = bindings.find(b => b.role === "media");
  const showMedia = chipDisplay ? chipDisplay.showMedia !== false : true;
  const mediaVal = (showMedia && mediaB) ? (occ.fields?.[mediaB.fieldId]?.value ?? null) : null;
  const showLabel = chipDisplay ? chipDisplay.showLabel !== false : true;

  let fieldVals;
  if (chipDisplay && Array.isArray(chipDisplay.fieldIds)) {
    // Explicit field list — render in the configured order. Skip empty/missing
    // values (rendering "name: undefined" is worse than rendering nothing).
    fieldVals = chipDisplay.fieldIds
      .map(fid => {
        const v = occ.fields?.[fid]?.value;
        if (v == null || v === "") return null;
        const f = fieldsById?.[fid];
        return f ? { name: f.name, value: v } : null;
      })
      .filter(Boolean);
  } else {
    // Auto-derive (legacy heuristic) — first 3 non-hidden, non-media bindings.
    fieldVals = bindings
      .filter(b => b.role !== "media" && !b.hidden && occ.fields?.[b.fieldId]?.value != null && occ.fields?.[b.fieldId]?.value !== "")
      .slice(0, 3)
      .map(b => {
        const f = fieldsById?.[b.fieldId];
        return f ? { name: f.name, value: occ.fields[b.fieldId].value } : null;
      })
      .filter(Boolean);
  }

  return {
    label: showLabel ? (mod?.label || occ.label || null) : null,
    mediaVal, fieldVals,
  };
}

function OccurrenceOption({ occId, fallbackLabel, maps, chipDisplay = null }) {
  const card = resolveOccCard(occId, maps, chipDisplay);
  const label = card?.label || (card && chipDisplay && chipDisplay.showLabel === false ? null : (fallbackLabel || occId));
  const mediaVal = card?.mediaVal;
  const ext = typeof mediaVal === "string" ? (mediaVal.split(".").pop() || "").toLowerCase() : "";
  const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext);
  // Hide the media slot entirely when chipDisplay opts out (showMedia=false).
  const renderMediaSlot = chipDisplay ? chipDisplay.showMedia !== false : true;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
      {renderMediaSlot && (
        <div style={{ width: 34, height: 46, flexShrink: 0, borderRadius: 4, overflow: "hidden",
          background: "var(--input-bg, rgba(255,255,255,0.04))", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {mediaVal && isImg
            ? <img src={resolveFileRef(mediaVal)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <Link2 style={{ width: 12, height: 12, opacity: 0.4 }} />}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {label != null && (
          <div style={{ fontWeight: 600, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        )}
        {card?.fieldVals?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {card.fieldVals.map((fv, i) => (
              <span key={i} style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                {fv.name}: {String(fv.value)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN: Field
// ══════════════════════════════════════════════════════════════
/**
 * Field — unified display + input for any field value.
 *
 * Display-only when onCommit is not provided.
 * Editable when onCommit is provided.
 *
 * Props (display):
 * - field, binding, value, target, state, context
 * - compact, hideName, hidePrefix, hidePostfix
 *
 * Props (input, all optional — omit for display-only):
 * - flow, onCommit, onChange, onFlowChange
 * - disabled, usedCompletedValues, onAddOption
 */
function Field({
  // Common
  field,
  binding,
  compact = false,
  hideName = false,
  hidePrefix = false,
  hidePostfix = false,
  // Host occurrence — used by button-type fields so the click handler
  // can pass `$trigger.occurrenceId` to the fired operation. Optional
  // for other field types.
  hostOccurrence = null,
  // Display
  value,
  target: targetProp,
  state,
  context,
  // Display rule output ({ color, icon, suffix, replaceValue } | null)
  // emitted by the operation executor when $displayRules matched this
  // occurrence. When set, the rule's color overrides the value-sign /
  // target-met defaults below; icon renders before the value; suffix
  // appends after; replaceValue substitutes the value entirely.
  displayRule = null,
  // Input (omit for display-only)
  flow,
  onCommit,
  onChange,
  onFlowChange,
  disabled = false,
  usedCompletedValues = [],
  onAddOption,
}) {
  const isEditable = typeof onCommit === "function";
  const currentTimeFilter = context?.currentIteration || "daily";
  const currentSpan = Number(context?.currentSpan) > 1 ? Math.floor(Number(context.currentSpan)) : 1;
  const scaleOpts = currentSpan > 1 ? { span: currentSpan } : {};
  const displayConfigTarget = useMemo(() => {
    const dc = field?.displayConfig;
    if (!dc || dc.targetValue == null) return null;
    // targetOp lets a field flip "met" semantics — countdown fields use "<="
    // so green = at-or-below 0 (target reached). Default ">=" keeps existing
    // counter fields (Tasks Completed etc.) green-at-or-above-target.
    //
    // startValue defines the "0% progress" anchor. Counters use start=0,
    // target=10 (default behavior — 0%→100% as value rises). Countdowns
    // use start=10, target=0 with op="<=" (0%→100% as value falls).
    // calculateProgress handles either direction by sign of (target - start).
    return {
      value: dc.targetValue,
      start: typeof dc.startValue === "number" ? dc.startValue : undefined,
      op: dc.targetOp || ">=",
      period: dc.targetPeriod || "daily",
    };
  }, [field?.displayConfig]);
  const target = targetProp || displayConfigTarget || null;
  const hasTarget = target?.value !== undefined && target?.value !== null;

  // Live-value override (currentTime / endOfDayCountdown). When set, the
  // field self-updates via setInterval — `rawDisplayValue` ignores the
  // stored field value and reflects the live tick. No operation or socket
  // emit is involved; the cost is one React re-render per interval on
  // mounted instances of this field. Seconds is cheap; minutes is even
  // cheaper.
  const liveDisplayValue = useLiveFieldValue(field);

  // Flow-aware change indicator. Only tracks numeric stored values
  // (skipped for live fields since the time string isn't a comparable
  // numeric quantity). +N / -N badge auto-clears after 1.5s; color
  // depends on whether the change matches the field's "good direction"
  // per meta.flow (in = up is good; out = down is good).
  const rawNumericValue = useMemo(() => {
    if (liveDisplayValue != null) return null;
    const v = value && typeof value === "object" && "value" in value ? value.value : value;
    return typeof v === "number" ? v : (typeof v === "string" && v !== "" ? Number(v) : null);
  }, [value, liveDisplayValue]);
  const fieldFlow = field?.meta?.flow || "in";
  const valueDelta = useFlowDelta(rawNumericValue);
  const deltaColorVal = flowDeltaColor(valueDelta, fieldFlow);

  // ─── Value resolution (display) ─────────────────────────────
  const rawDisplayValue = useMemo(() => {
    if (liveDisplayValue != null) return liveDisplayValue;
    if (value && typeof value === "object") {
      if ("value" in value) return value.value;
      return undefined;
    }
    return value;
  }, [value, liveDisplayValue]);

  // ─── Input state ─────────────────────────────────────────────
  const extractValue = (v) => (v && typeof v === "object" ? ("value" in v ? v.value : undefined) : v);
  const defaultValue = field?.meta?.defaultValue ?? (field?.type === "boolean" ? false : undefined);
  const resolveInputVal = (v) => { const raw = extractValue(v); return (raw === null || raw === undefined) ? (defaultValue ?? raw) : raw; };

  const [localValue, setLocalValue] = useState(() => resolveInputVal(value));
  const [isClickEditing, setIsClickEditing] = useState(false); // for compact click-to-edit
  const [selectQuery, setSelectQuery] = useState(""); // for full-mode select search
  const [selectOpen, setSelectOpen] = useState(false); // for full-mode select popover
  const inputRef = useRef(null);

  // Context needed for occurrence add-new: create a new instance in the library container
  const { dispatch, socket, gridId, userId, occurrencesById, modulesById, fieldsById, operationsById, state: ctxState } = useContext(GridActionsContext);
  // Use the prop-passed state when present, fall back to context's. Most
  // callers thread the latest state via prop; the context is the safe net.
  const effectiveOpState = state ?? ctxState;

  // occurrenceAddNewCfg is derived from field meta — stable reference, safe to compute here.
  // Read via field?.meta because the `meta` destructure happens later in the function.
  const occurrenceAddNewCfg = field?.type === "occurrence" && field?.meta?.multiSelect ? field?.meta?.optionsSource?.addNew : null;

  // Rich occurrence-picker row renderer (poster + label + field values).
  // chipDisplay = the field's `meta.optionsSource.chipDisplay` config (or null).
  // When set, drives which fields/media render on each chip; otherwise the
  // OccurrenceOption auto-derives from the referenced module's bindings.
  const occMaps = useMemo(() => ({ occurrencesById, modulesById, fieldsById }), [occurrencesById, modulesById, fieldsById]);
  const chipDisplay = field?.meta?.optionsSource?.chipDisplay || null;
  const renderOccurrenceOption = useCallback(
    (o) => <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} chipDisplay={chipDisplay} />,
    [occMaps, chipDisplay]
  );

  useEffect(() => {
    if (!isClickEditing) setLocalValue(resolveInputVal(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isClickEditing]);

  useEffect(() => {
    if (isClickEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isClickEditing]);

  const handleChange = useCallback((newVal) => {
    // NaN prevention for number fields
    if (field?.type === "number" && typeof newVal === "number" && isNaN(newVal)) return;
    setLocalValue(newVal);
    onChange?.(newVal);
  }, [onChange, field?.type]);

  // Build the occurrence add-new handler AFTER handleChange so we can close over it.
  // MultiSelectWithAdd calls onAddOption({ value: slug, label }) AND then immediately
  // calls onChange([...selected, slug]) with the slug. We capture localValue BEFORE
  // the onChange fires, then call handleChange again with the real occurrence ID to
  // overwrite the intermediate slug state.
  const handleOccurrenceAddNew = useCallback(({ label: newLabel } = {}) => {
    if (!occurrenceAddNewCfg || !newLabel?.trim()) return;
    const { parentOccurrenceId, stampFields = {} } = occurrenceAddNewCfg;
    const parentOcc = occurrencesById?.[parentOccurrenceId];
    if (!parentOcc) return;

    // Capture current selections BEFORE the slug write that MultiSelectWithAdd fires after us.
    const currentVal = Array.isArray(localValue) ? localValue : localValue ? [localValue] : [];

    const result = createLeafInstanceInParent({
      dispatch, socket, gridId, userId,
      parentOccurrence: parentOcc,
      label: newLabel.trim(),
      initialFields: stampFields,
    });
    if (!result) return;

    // Overwrite the slug with the real occurrence ID via a microtask so it fires after
    // MultiSelectWithAdd's own onChange([...selected, slug]) in the same event flush.
    const newSelected = [...currentVal, result.occurrenceId];
    Promise.resolve().then(() => {
      handleChange(newSelected);
      onCommit?.(newSelected);
    });
  }, [occurrenceAddNewCfg, occurrencesById, localValue, dispatch, socket, gridId, userId, handleChange, onCommit]);

  const handleCommit = useCallback(() => {
    setIsClickEditing(false);
    let val = localValue;
    // Clamp number fields to min/max if defined in meta
    if (field?.type === "number" && typeof val === "number" && !isNaN(val)) {
      const min = field.meta?.min;
      const max = field.meta?.max;
      if (min != null && val < min) val = min;
      if (max != null && val > max) val = max;
      if (val !== localValue) setLocalValue(val);
    }
    onCommit?.(val);
  }, [localValue, onCommit, field?.type, field?.meta?.min, field?.meta?.max]);
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") { e.preventDefault(); handleCommit(); }
    else if (e.key === "Escape") { setIsClickEditing(false); setLocalValue(resolveInputVal(value)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleCommit, value]);

  if (!field) return null;

  const { type, name, unit, meta } = field;
  const prefix = hidePrefix ? "" : (meta?.prefix || "");
  const postfix = hidePostfix ? "" : (meta?.postfix || "");
  const showLabel = !compact && !hideName && binding?.display?.showLabel !== false;
  const showUnit = unit && binding?.display?.showUnit !== false;

  // ══════════════════════════════════════════════════════════════
  // BUTTON FIELD — runs an operation when clicked (#46 polish 2026-05-23)
  // ══════════════════════════════════════════════════════════════
  // `field.type === "button"` is a special field shape: no value, no
  // input, no display. Renders as a click-to-run button. The operation
  // id lives at `field.meta.operationId`. Fires a `ButtonOp` transaction
  // with the host occurrence as the trigger context — pipelines can read
  // `$trigger.occurrenceId` / `$trigger.instanceId` to know which row
  // was clicked.
  if (type === "button") {
    const opId = meta?.operationId;
    const op = opId && operationsById ? operationsById[opId] : null;
    const buttonLabel = meta?.buttonLabel || name || "Run";
    const tooltip = op ? `Run: ${op.name}` : (opId ? `Operation not found: ${opId}` : "No operation configured");
    const enabled = !disabled && !!op;
    const onClick = (e) => {
      e.stopPropagation();
      if (!op) return;
      const occId = hostOccurrence?.id || null;
      const transaction = {
        type: "ButtonOp",
        operationId: op.id,
        occurrenceId: occId || null,
        instanceId: occId || null,
        fieldId: field.id,
      };
      const updates = runMatchingOperations(
        Object.values(operationsById || {}),
        "ButtonOp", transaction,
        { state: effectiveOpState, fieldsById, operationsById, occurrencesById },
      );
      if (updates.length > 0) {
        const displayUpdates = updates.filter(u => !u._effect);
        if (displayUpdates.length > 0) dispatch?.(setComputedValuesAction(displayUpdates));
      }
    };
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!enabled}
        title={tooltip}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: compact ? "2px 8px" : "3px 10px",
          borderRadius: 999,
          fontSize: compact ? 10 : 11,
          fontFamily: "var(--font-mono)",
          cursor: enabled ? "pointer" : "not-allowed",
          background: enabled ? "var(--accent-blue-bg)" : "var(--input-bg)",
          border: `1px solid ${enabled ? "var(--accent-blue-border)" : "var(--border-subtle)"}`,
          color: enabled ? "var(--accent-blue-text)" : "var(--text-faint)",
          opacity: enabled ? 1 : 0.55,
        }}
      >
        <Play style={{ width: 9, height: 9 }} />
        {buttonLabel}
      </button>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // EDITABLE — INPUT RENDERING
  // ══════════════════════════════════════════════════════════════
  if (isEditable) {
    // Compact click-to-edit mode for numeric/text/duration fields
    const useClickToEdit = compact && (type === "number" || type === "text" || type === "duration");

    if (useClickToEdit) {
      const displayNum = localValue ?? (type === "number" ? 0 : "");
      const formattedDisplay = `${prefix}${displayNum}${postfix}`;
      // Pill tint:
      //   - target present  → target-met (green) / not-met (red)
      //   - no target       → value-direction colors (red <0, blue 0/null, green >0)
      const pillTint = hasTarget
        ? (targetMet
            ? { bg: "rgba(34,197,94,0.2)",  border: "rgba(34,197,94,0.35)",  text: "rgb(134,239,172)" }
            : { bg: "rgba(248,113,113,0.2)", border: "rgba(248,113,113,0.35)", text: "rgb(252,165,165)" })
        : (() => {
            const t = valueSignPillTint(localValue);
            return { ...t, text: valueSignColor(localValue) };
          })();

      if (isClickEditing) {
        return (
          <div className="field-input editing inline-flex items-center gap-0.5">
            {prefix && <span className="text-[10px] text-muted-foreground">{prefix}</span>}
            <Input ref={inputRef} type={type === "number" ? "number" : "text"}
              value={localValue ?? ""}
              onChange={(e) => handleChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
              onKeyDown={handleKeyDown} onBlur={handleCommit} disabled={disabled}
              className={`${compact ? "h-5 text-[10px] w-14" : "h-6 text-xs w-16"} px-1 text-center`}
              style={{ minWidth: 40 }} />
            {postfix && <span className="text-[10px] text-muted-foreground">{postfix}</span>}
          </div>
        );
      }

      return (
        <button type="button" disabled={disabled}
          onClick={() => !disabled && setIsClickEditing(true)}
          className={`field-input inline-flex items-center gap-1
            ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"}
            rounded-full border transition-all
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
          style={{ background: pillTint.bg, borderColor: pillTint.border, color: pillTint.text }}
          title={`${name ? name + ": " : ""}Click to edit`}
        >
          {!hideName && name && <span className="opacity-70">{name}:</span>}
          <span>{formattedDisplay}</span>
        </button>
      );
    }

    // ── Compact non-flow types (boolean, select, date, rating) ──────────────
    // All render as inline pills matching the useClickToEdit style

    if (compact && type === "boolean") {
      const isOn = !!localValue;
      return (
        <div className={`field-input inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border transition-all
          ${isOn ? "bg-green-500/20 border-green-500/30" : "bg-white/5 border-white/10"}
          ${disabled ? "opacity-50" : ""}`}
          title={`${name}: ${isOn ? "on" : "off"}`}
        >
          <Switch checked={isOn} disabled={disabled}
            onCheckedChange={v => { handleChange(v); onCommit?.(v); }} />
          {!hideName && name && (
            <span style={{ fontSize: 10, color: isOn ? "var(--accent-green-text)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {name}
            </span>
          )}
        </div>
      );
    }

    if (compact && type === "select") {
      const allOpts = meta?._resolvedOptions || [];
      const displayOpts = meta?.removeOnComplete ? allOpts.filter(o => !usedCompletedValues.includes(o.value)) : allOpts;
      const currentLabel = Array.isArray(localValue)
        ? localValue.map(v => displayOpts.find(o => o.value === v)?.label ?? v).join(", ") || "—"
        : displayOpts.find(o => o.value === localValue)?.label ?? localValue ?? "—";
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled}
              className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border transition-all
                bg-white/5 border-white/10 text-white/60
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              title={`${name}: ${currentLabel}`}
            >
              {!hideName && name && <span className="opacity-70">{name}:</span>}
              <span>{currentLabel}</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="start" side="bottom">
            {displayOpts.map(o => (
              <button key={o.value} type="button"
                onClick={() => { handleChange(o.value); onCommit?.(o.value); }}
                className={`w-full flex items-center px-2 py-1 rounded text-xs transition-colors
                  ${localValue === o.value ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                {o.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }

    if (compact && type === "date") {
      // Parse YYYY-MM-DD as local midnight so toLocaleDateString renders the
      // intended day. `new Date("2026-05-07")` is UTC midnight — in any tz
      // west of UTC that formats as the previous day.
      const parseLocalDay = (v) => {
        if (!v) return null;
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
        return new Date(v);
      };
      // <input type="date"> only accepts yyyy-MM-dd. Stored values can be
      // ISO timestamps (seed data) — normalize before binding to the input,
      // otherwise the picker opens empty and the user can't see the current value.
      const toInputDate = (v) => {
        if (!v) return "";
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = parseLocalDay(v);
        if (!d || Number.isNaN(d.getTime())) return "";
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      };
      const inputDate = toInputDate(localValue);
      const formatted = inputDate
        ? parseLocalDay(inputDate)?.toLocaleDateString(undefined, { month: "short", day: "numeric" }) ?? "date"
        : "date";
      // The hidden input has 0 size + pointer-events:none, so the browser
      // can't auto-open its picker via label-click forwarding. Trigger
      // showPicker() on click so the user can actually pick a date.
      const openPicker = (e) => {
        if (disabled) return;
        const el = inputRef.current;
        if (el?.showPicker) {
          e.preventDefault();
          try { el.showPicker(); } catch { /* picker may throw if already open */ }
        }
      };
      return (
        <label className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border transition-all
          bg-white/5 border-white/10 text-white/55 cursor-pointer hover:brightness-110
          ${disabled ? "opacity-50 pointer-events-none" : ""}`}
          title={`${name}: ${formatted} — Click to change`}
          onClick={openPicker}
        >
          {!hideName && name && <span style={{ fontFamily: "var(--font-mono)", opacity: 0.6 }}>{name}:</span>}
          <span style={{ fontFamily: "var(--font-mono)" }}>{formatted}</span>
          <input ref={inputRef} type="date" value={inputDate} disabled={disabled}
            onChange={e => { handleChange(e.target.value); onCommit?.(e.target.value); }}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
            tabIndex={-1} />
        </label>
      );
    }

    if (compact && type === "rating") {
      const maxRating = meta?.max || 5;
      const currentRating = localValue ?? 0;
      return (
        <div className="field-input inline-flex items-center gap-0.5" title={`${name}: ${currentRating}/${maxRating}`}>
          {!hideName && name && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginRight: 2 }}>{name}:</span>}
          {Array.from({ length: maxRating }, (_, i) => i + 1).map(star => (
            <button key={star} type="button" disabled={disabled}
              style={{ padding: 1, cursor: disabled ? "not-allowed" : "pointer" }}
              onClick={() => { const v = star === currentRating ? 0 : star; handleChange(v); onCommit?.(v); }}>
              <svg style={{ width: 12, height: 12,
                color: star <= currentRating ? "#facc15" : "var(--text-faint)",
                fill: star <= currentRating ? "#facc15" : "transparent" }}
                viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          ))}
        </div>
      );
    }

    if (compact && type === "occurrence") {
      const options = meta?._resolvedOptions || [];
      const isMulti = meta?.multiSelect === true;
      if (isMulti) {
        const selectedValues = Array.isArray(localValue) ? localValue : localValue ? [localValue] : [];
        // When addNew is configured, wire handleOccurrenceAddNew (accepts { value, label } from MultiSelectWithAdd).
        const occAddNew = occurrenceAddNewCfg ? handleOccurrenceAddNew : null;
        return (
          <MultiSelectWithAdd name={showLabel ? name : ""} options={options} selected={selectedValues}
            onChange={vals => { handleChange(vals); onCommit?.(vals); }}
            onAddOption={occAddNew} disabled={disabled} compact={compact}
            showLabel={showLabel} randomize={false} renderOption={renderOccurrenceOption} fieldName={name} />
        );
      }
      const currentLabel = options.find(o => o.value === localValue)?.label || localValue || "—";
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled}
              className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border transition-all
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)", color: "rgb(180,225,245)" }}
              title={`${name}: ${currentLabel}`}
            >
              <Link2 style={{ width: 10, height: 10, opacity: 0.6 }} />
              {!hideName && name && <span style={{ opacity: 0.7 }}>{name}:</span>}
              <span>{currentLabel}</span>
              <ChevronDown style={{ width: 10, height: 10, opacity: 0.5 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start" side="bottom">
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {options.length === 0
                ? <div style={{ padding: "16px 0", textAlign: "center", fontSize: 11, color: "var(--text-faint)" }}>No occurrences available</div>
                : options.map(o => (
                    <button key={o.value} type="button"
                      onClick={() => { handleChange(o.value); onCommit?.(o.value); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", padding: "4px 8px",
                        borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)",
                        background: localValue === o.value ? "rgba(6,182,212,0.15)" : "transparent",
                        color: localValue === o.value ? "rgb(180,225,245)" : "var(--text-muted)",
                        border: "none", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} chipDisplay={chipDisplay} />
                    </button>
                  ))}
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    // Shared label style for full (non-compact) inputs
    const inputLabelStyle = { fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 };

    // Full input controls
    if (type === "number") {
      return (
        <div className="field-input field-input-number" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact={compact} disabled={disabled} />
            <Input type="number" value={localValue ?? ""} disabled={disabled}
              placeholder="0"
              className={compact ? "h-6 text-xs w-16" : "h-7 text-sm"}
              onChange={e => handleChange(e.target.value === "" ? null : Number(e.target.value))}
              onBlur={handleCommit} onKeyDown={handleKeyDown}
              min={meta?.min} max={meta?.max} step={meta?.step} />
            {showUnit && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{unit}</span>}
          </div>
        </div>
      );
    }

    if (type === "text") {
      return (
        <div className="field-input field-input-text" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <Input type="text" value={localValue ?? ""} disabled={disabled}
            placeholder=""
            className={compact ? "h-6 text-xs" : "h-7 text-sm"}
            onChange={e => handleChange(e.target.value)}
            onBlur={handleCommit} onKeyDown={handleKeyDown} />
        </div>
      );
    }

    if (type === "markdown") {
      return (
        <div className="field-input field-input-markdown" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <textarea
            value={localValue ?? ""}
            disabled={disabled}
            placeholder={meta?.placeholder || ""}
            onChange={e => handleChange(e.target.value)}
            onBlur={handleCommit}
            rows={meta?.rows || 3}
            style={{
              width: "100%", resize: "vertical", padding: "4px 8px",
              fontSize: compact ? 11 : 12, fontFamily: "var(--font-mono)",
              background: "var(--input-bg)", border: "1px solid var(--input-border)",
              borderRadius: 4, color: "var(--text-primary)", outline: "none",
              lineHeight: 1.5, minHeight: compact ? 28 : 60,
            }}
          />
        </div>
      );
    }

    if (type === "boolean") {
      const useSwitch = meta?.variant !== "checkbox" && binding?.display?.variant !== "checkbox";
      return (
        <div className="field-input field-input-boolean" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {useSwitch ? (
            <>
              <Switch checked={!!localValue} disabled={disabled}
                onCheckedChange={v => { handleChange(v); onCommit?.(v); }} />
              {showLabel && <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
            </>
          ) : (
            <>
              <Checkbox checked={!!localValue} disabled={disabled}
                onCheckedChange={v => { handleChange(v); onCommit?.(v); }} />
              {showLabel && <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
            </>
          )}
        </div>
      );
    }

    if (type === "select") {
      const allOptions = meta?._resolvedOptions || [];
      const isMulti = meta?.multiSelect === true;
      const options = meta?.removeOnComplete
        ? allOptions.filter(o => !usedCompletedValues.includes(o.value))
        : allOptions;
      const selectedValues = isMulti
        ? (Array.isArray(localValue) ? localValue : localValue ? [localValue] : [])
        : [];

      if (!isMulti) {
        const currentLabel = options.find(o => o.value === localValue)?.label ?? localValue ?? "Select...";
        const filteredOpts = options.length > 10 && selectQuery
          ? options.filter(o => o.label.toLowerCase().includes(selectQuery.toLowerCase()))
          : options;
        return (
          <div className="field-input field-input-select" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {showLabel && <span style={inputLabelStyle}>{name}</span>}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Popover open={selectOpen} onOpenChange={(o) => { setSelectOpen(o); if (!o) setSelectQuery(""); }}>
                <PopoverTrigger asChild>
                  <button type="button" disabled={disabled}
                    className={`inline-flex items-center justify-between gap-1 px-2 rounded border bg-background
                      ${compact ? "h-6 text-xs" : "h-7 text-sm"}
                      ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted"}`}
                    style={{ minWidth: 80, borderColor: "var(--input-border, hsl(var(--border)))", color: "var(--text-primary)" }}
                  >
                    <span className="truncate">{currentLabel}</span>
                    <ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-2" align="start" style={{ minWidth: 160, maxHeight: 280, overflowY: "auto" }}>
                  {options.length > 10 && (
                    <input
                      autoFocus
                      value={selectQuery}
                      onChange={(e) => setSelectQuery(e.target.value)}
                      placeholder="Filter options…"
                      style={{
                        width: "100%", height: 28, fontSize: 11, fontFamily: "monospace",
                        background: "var(--input-bg)", border: "1px solid var(--input-border)",
                        borderRadius: 5, color: "var(--text-primary)", padding: "0 8px",
                        outline: "none", marginBottom: 6,
                      }}
                    />
                  )}
                  {filteredOpts.length === 0 ? (
                    <div style={{ fontSize: 10, fontStyle: "italic", color: "var(--text-faint)", padding: 6 }}>
                      No matches — check the field's options source
                    </div>
                  ) : (
                    filteredOpts.map(o => (
                      <button key={String(o.value)} type="button"
                        onClick={() => { handleChange(o.value); onCommit?.(o.value); setSelectQuery(""); setSelectOpen(false); }}
                        className={`w-full flex items-center px-2 py-1 rounded text-xs transition-colors
                          ${localValue === o.value ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                      >
                        {o.label}
                      </button>
                    ))
                  )}
                </PopoverContent>
              </Popover>
              {meta?.randomize && options.length > 0 && (
                <Button variant="ghost" size="icon" className={compact ? "h-6 w-6 flex-shrink-0" : "h-7 w-7 flex-shrink-0"}
                  title="Pick random" disabled={disabled}
                  onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) { handleChange(p.value); onCommit?.(p.value); } }}>
                  <Shuffle className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      }

      return (
        <MultiSelectWithAdd name={showLabel ? name : ""} options={options} selected={selectedValues}
          onChange={vals => { handleChange(vals); onCommit?.(vals); }}
          onAddOption={onAddOption} disabled={disabled} compact={compact}
          showLabel={showLabel} randomize={!!meta?.randomize} />
      );
    }

    if (type === "date") {
      const relativeDateLabel = useMemo(() => {
        if (!localValue) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        // Parse YYYY-MM-DD as local midnight (UTC parse drifts a day west of UTC).
        const d = (typeof localValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(localValue))
          ? new Date(localValue + "T00:00:00")
          : new Date(localValue);
        d.setHours(0, 0, 0, 0);
        const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
        if (diff === 0) return { text: "today", color: "#22c55e" };
        if (diff === 1) return { text: "tomorrow", color: "#22c55e" };
        if (diff > 0) return { text: `in ${diff} days`, color: diff <= 7 ? "#f59e0b" : "#64748b" };
        if (diff === -1) return { text: "yesterday", color: "#ef4444" };
        return { text: `${Math.abs(diff)} days overdue`, color: "#ef4444" };
      }, [localValue]);

      return (
        <div className="field-input field-input-date" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Input type="date" value={localValue ?? ""} disabled={disabled}
              className={compact ? "h-6 text-xs" : "h-7 text-sm"}
              onChange={e => handleChange(e.target.value)} onBlur={handleCommit} />
            {relativeDateLabel && (
              <span style={{ fontSize: 10, color: relativeDateLabel.color, whiteSpace: "nowrap", fontWeight: 500 }}>
                {relativeDateLabel.text}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (type === "rating") {
      const maxRating = meta?.max || 5;
      const currentRating = localValue ?? 0;
      return (
        <div className="field-input field-input-rating" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {Array.from({ length: maxRating }, (_, i) => i + 1).map(star => (
              <button key={star} type="button" disabled={disabled}
                style={{ padding: 2, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "transform 0.1s" }}
                onClick={() => { const v = star === currentRating ? 0 : star; handleChange(v); onCommit?.(v); }}>
                <svg style={{ width: compact ? 14 : 18, height: compact ? 14 : 18,
                  color: star <= currentRating ? "#facc15" : "var(--text-faint)",
                  fill: star <= currentRating ? "#facc15" : "transparent" }}
                  viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (type === "duration") {
      const totalMinutes = localValue ?? 0;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const updateDuration = (h, m) => { const v = h * 60 + m; handleChange(v); };
      return (
        <div className="field-input field-input-duration" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact={compact} disabled={disabled} />
            <Input type="number" value={hours} disabled={disabled} min={0} max={23} placeholder="0"
              className={compact ? "h-6 text-xs w-12" : "h-7 text-sm w-14"}
              onChange={e => updateDuration(parseInt(e.target.value) || 0, minutes)}
              onBlur={handleCommit} onKeyDown={handleKeyDown} />
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>h</span>
            <Input type="number" value={minutes} disabled={disabled} min={0} max={59} step={5} placeholder="0"
              className={compact ? "h-6 text-xs w-12" : "h-7 text-sm w-14"}
              onChange={e => updateDuration(hours, parseInt(e.target.value) || 0)}
              onBlur={handleCommit} onKeyDown={handleKeyDown} />
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>m</span>
          </div>
        </div>
      );
    }

    if (type === "occurrence") {
      const options = meta?._resolvedOptions || [];
      const isMulti = meta?.multiSelect === true;
      if (isMulti) {
        const selectedValues = Array.isArray(localValue) ? localValue : localValue ? [localValue] : [];
        const occAddNew = occurrenceAddNewCfg ? handleOccurrenceAddNew : null;
        return (
          <MultiSelectWithAdd name={showLabel ? name : ""} options={options} selected={selectedValues}
            onChange={vals => { handleChange(vals); onCommit?.(vals); }}
            onAddOption={occAddNew} disabled={disabled} compact={compact}
            showLabel={showLabel} randomize={false} renderOption={renderOccurrenceOption} fieldName={name} />
        );
      }
      return (
        <div className="field-input field-input-occurrence" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <Popover open={selectOpen} onOpenChange={setSelectOpen}>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled}
                style={{
                  minHeight: 28, fontSize: 12, fontFamily: "var(--font-mono)",
                  background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)",
                  borderRadius: 5, color: "rgb(180,225,245)", padding: "4px 8px", outline: "none",
                  display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}>
                {localValue
                  ? <div style={{ flex: 1, minWidth: 0 }}><OccurrenceOption occId={localValue} fallbackLabel={localValue} maps={occMaps} chipDisplay={chipDisplay} /></div>
                  : <span style={{ flex: 1, opacity: 0.6 }}>Select occurrence...</span>}
                <ChevronDown style={{ width: 12, height: 12, opacity: 0.5, flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1" align="start" side="bottom">
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                {options.length === 0
                  ? <div style={{ padding: "16px 0", textAlign: "center", fontSize: 11, color: "var(--text-faint)" }}>No occurrences available</div>
                  : options.map(o => (
                      <button key={o.value} type="button"
                        onClick={() => { handleChange(o.value); onCommit?.(o.value); setSelectOpen(false); }}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", padding: "5px 6px",
                          borderRadius: 4, border: "none", cursor: "pointer", textAlign: "left",
                          background: localValue === o.value ? "rgba(6,182,212,0.15)" : "transparent",
                        }}>
                        <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} />
                      </button>
                    ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    }

    return <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Unknown field type: {type}</div>;
  }

  // ══════════════════════════════════════════════════════════════
  // DISPLAY-ONLY — READ-ONLY RENDERING
  // ══════════════════════════════════════════════════════════════

  // Formatted value for display
  const formattedValue = useMemo(() => {
    if (rawDisplayValue === null || rawDisplayValue === undefined) return compact ? "-" : "—";
    switch (type) {
      case "number": {
        const num = Number(rawDisplayValue);
        if (isNaN(num)) return rawDisplayValue;
        const precision = binding?.display?.precision ?? 2;
        return Number.isInteger(num) ? num.toString() : num.toFixed(precision);
      }
      case "boolean": return rawDisplayValue ? "Yes" : "No";
      case "date": {
        if (!rawDisplayValue) return "—";
        try {
          // Parse YYYY-MM-DD as local midnight (UTC parse drifts a day west of UTC).
          const parseLocalDay = (v) => {
            if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
            return new Date(v);
          };
          const date = parseLocalDay(rawDisplayValue);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const d = parseLocalDay(rawDisplayValue); d.setHours(0, 0, 0, 0);
          const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
          const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          if (diff === 0) return `${dateStr} · today`;
          if (diff === 1) return `${dateStr} · tomorrow`;
          if (diff > 0) return `${dateStr} · in ${diff}d`;
          if (diff === -1) return `${dateStr} · yesterday`;
          return `${dateStr} · ${Math.abs(diff)}d overdue`;
        } catch { return rawDisplayValue; }
      }
      case "select": {
        const options = meta?._resolvedOptions || [];
        if (Array.isArray(rawDisplayValue)) {
          return rawDisplayValue.map(v => options.find(o => o.value === v)?.label ?? v).join(", ") || "—";
        }
        return options.find(o => o.value === rawDisplayValue)?.label ?? rawDisplayValue;
      }
      case "duration": {
        const totalMin = Number(rawDisplayValue ?? 0);
        if (isNaN(totalMin)) return rawDisplayValue;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
      }
      case "rating": return rawDisplayValue;
      case "occurrence": {
        const options = meta?._resolvedOptions || [];
        if (Array.isArray(rawDisplayValue)) {
          return rawDisplayValue.map(v => options.find(o => o.value === v)?.label ?? v).join(", ") || "—";
        }
        return options.find(o => o.value === rawDisplayValue)?.label || rawDisplayValue || "—";
      }
      default: return rawDisplayValue !== undefined && rawDisplayValue !== null ? String(rawDisplayValue) : "—";
    }
  }, [field, rawDisplayValue, compact, binding, type]);

  // Target/progress calculations
  const scaledTarget = useMemo(
    () => hasTarget ? getScaledTargetValue(target, currentTimeFilter, scaleOpts) : null,
    [hasTarget, target, currentTimeFilter, currentSpan]
  );
  const targetMet = useMemo(() => {
    if (!hasTarget) return null;
    return checkTarget(rawDisplayValue ?? 0, target, currentTimeFilter, scaleOpts);
  }, [hasTarget, target, rawDisplayValue, currentTimeFilter, currentSpan]);
  const targetProgress = useMemo(() => {
    if (!hasTarget || rawDisplayValue == null) return null;
    if (typeof target.value !== "number") return null;
    const current = Number(rawDisplayValue);
    if (isNaN(current)) return null;
    const scaledT = getScaledTargetValue(target, currentTimeFilter, scaleOpts);
    const progress = calculateProgress(current, target, currentTimeFilter, scaleOpts) ?? 0;
    const met = checkTarget(current, target, currentTimeFilter, scaleOpts) ?? false;
    return { progress, met, target: scaledT };
  }, [hasTarget, target, rawDisplayValue, currentTimeFilter, currentSpan]);

  const fmt = (v) => typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
  const valueDisplay = hasTarget && scaledTarget !== null
    ? `${prefix}${fmt(rawDisplayValue ?? 0)}/${fmt(scaledTarget)}${postfix}`
    : `${prefix}${formattedValue}${postfix}`;

  // Shared style for read-only "input-like" boxes
  // Non-compact value color precedence:
  //   1. displayRule.color (rule from $displayRules in pipeline)
  //   2. target-met / not-met (when field has a target)
  //   3. value-direction colors (red <0, blue 0/null, green >0/filled)
  const valueColor = displayRule?.color
    ? displayRule.color
    : hasTarget
    ? (targetMet ? "var(--accent-green-text)" : "var(--danger-text)")
    : valueSignColor(rawDisplayValue);
  const RuleIconNC = displayRule?.icon ? RULE_ICONS[displayRule.icon] : null;
  const ruleSuffixNC = displayRule?.suffix || null;
  const ruleDisplayNC = displayRule?.replaceValue != null
    ? String(displayRule.replaceValue)
    : null;
  const roBox = {
    display: "inline-flex", alignItems: "center",
    height: 28, minWidth: 52, padding: "0 8px",
    borderRadius: 4,
    border: "1px solid var(--border-default)",
    background: "var(--input-bg)",
    fontSize: 12, color: valueColor,
    fontFamily: "var(--font-mono)",
    flexShrink: 0,
  };
  const labelStyle = { fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 };

  if (compact) {
    // Compact display pill color precedence:
    //   1. displayRule.color (rule from $displayRules in pipeline)
    //   2. target-met / not-met (when field has a target)
    //   3. value-direction colors (red <0, blue 0/null, green >0/filled)
    let pillColor, pillBorder, pillText;
    if (displayRule?.color) {
      pillText   = displayRule.color;
      pillColor  = "transparent";
      pillBorder = "transparent";
    } else if (hasTarget) {
      pillColor  = targetMet ? "rgba(34,197,94,0.2)"  : "rgba(248,113,113,0.2)";
      pillBorder = targetMet ? "rgba(34,197,94,0.35)" : "rgba(248,113,113,0.35)";
      pillText   = targetMet ? "var(--accent-green-text)" : "var(--danger-text)";
    } else {
      const tint = valueSignPillTint(rawDisplayValue);
      pillColor  = tint.bg;
      pillBorder = tint.border;
      pillText   = valueSignColor(rawDisplayValue);
    }
    const RuleIcon = displayRule?.icon ? RULE_ICONS[displayRule.icon] : null;
    const ruleSuffix = displayRule?.suffix || null;
    // replaceValue overrides the formatted display string entirely.
    const ruleDisplay = displayRule?.replaceValue != null
      ? String(displayRule.replaceValue)
      : null;
    const pillBase = {
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 6px", borderRadius: 999,
      border: `1px solid ${pillBorder}`,
      background: pillColor,
      fontSize: 10, fontFamily: "var(--font-mono)",
      color: pillText, flexShrink: 0,
    };

    if (type === "rating") {
      return (
        <div className="field-display field-display-compact" style={{ ...pillBase }}>
          {!hideName && name && <span style={{ opacity: 0.6 }}>{name}:</span>}
          <Stars rating={rawDisplayValue} max={meta?.max || 5} size="w-3 h-3" />
        </div>
      );
    }

    if (type === "boolean") {
      const isOn = !!rawDisplayValue;
      return (
        <div className="field-display field-display-compact" style={{ ...pillBase,
          background: isOn ? "rgba(34,197,94,0.2)" : "var(--input-bg)",
          borderColor: isOn ? "rgba(34,197,94,0.35)" : "var(--border-default)",
          color: isOn ? "var(--accent-green-text)" : "var(--text-faint)",
        }}>
          {!hideName && name && <span style={{ opacity: 0.7 }}>{name}:</span>}
          <span>{isOn ? "yes" : "no"}</span>
        </div>
      );
    }

    if (type === "occurrence") {
      return (
        <div className="field-display field-display-compact" style={{ ...pillBase,
          background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)", color: "rgb(180,225,245)",
        }}>
          <Link2 style={{ width: 10, height: 10, opacity: 0.6 }} />
          {!hideName && name && <span style={{ opacity: 0.6 }}>{name}:</span>}
          <span>{valueDisplay}</span>
        </div>
      );
    }

    if (type === "markdown") {
      const firstLine = (rawDisplayValue || "").split("\n").find(l => l.trim()) || "";
      // Strip common markdown symbols for compact preview
      const stripped = firstLine.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\*/g, "").replace(/`/g, "");
      return (
        <div className="field-display field-display-compact" style={{ ...pillBase, maxWidth: 180 }}>
          {!hideName && name && <span style={{ opacity: 0.6 }}>{name}:</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripped || "—"}</span>
        </div>
      );
    }

    return (
      <div className="field-display field-display-compact" style={{ ...pillBase }}>
        {!hideName && name && <span style={{ opacity: 0.6 }}>{name}:</span>}
        {RuleIcon && <RuleIcon size={10} style={{ flexShrink: 0, opacity: 0.85 }} />}
        <span>{ruleDisplay ?? valueDisplay}</span>
        {ruleSuffix && <span style={{ opacity: 0.7, marginLeft: 2 }}>{ruleSuffix}</span>}
        {showUnit && <span style={{ opacity: 0.5 }}>{unit}</span>}
        {valueDelta != null && (
          <span style={{ marginLeft: 2, color: deltaColorVal, fontWeight: 600 }}>
            {valueDelta > 0 ? `+${valueDelta}` : valueDelta}
          </span>
        )}
      </div>
    );
  }

  // Markdown — display as plain text (read-only textarea-like block)
  if (type === "markdown") {
    const text = rawDisplayValue || "";
    return (
      <div className="field-display field-display-markdown" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <div style={{
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.6,
          color: "var(--text-primary)", padding: "4px 8px",
          background: "var(--input-bg)", borderRadius: 4,
          border: "1px solid var(--border-subtle)", minHeight: 36,
        }}>
          {text || <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>—</span>}
        </div>
      </div>
    );
  }

  // Rating
  if (type === "rating") {
    return (
      <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <Stars rating={rawDisplayValue} max={meta?.max || 5} size="w-5 h-5" />
      </div>
    );
  }

  // Boolean — disabled Switch matching input variant
  if (type === "boolean") {
    return (
      <div className="field-display" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Switch checked={!!rawDisplayValue} disabled />
        {showLabel && <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
      </div>
    );
  }

  // Select — show selected value in a select-like box
  if (type === "select") {
    return (
      <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ ...roBox, minWidth: 80, justifyContent: "space-between", flex: 1, maxWidth: 200 }}>
            <span>{formattedValue}</span>
            <ChevronDown style={{ width: 10, height: 10, opacity: 0.3, flexShrink: 0, marginLeft: 4 }} />
          </div>
        </div>
      </div>
    );
  }

  // Duration — two boxes for h + m
  if (type === "duration") {
    const totalMin = Number(rawDisplayValue ?? 0);
    const dh = isNaN(totalMin) ? 0 : Math.floor(totalMin / 60);
    const dm = isNaN(totalMin) ? 0 : totalMin % 60;
    return (
      <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ ...roBox, minWidth: 36, justifyContent: "center" }}>{dh}</div>
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>h</span>
          <div style={{ ...roBox, minWidth: 36, justifyContent: "center" }}>{dm}</div>
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>m</span>
        </div>
      </div>
    );
  }

  // Array display with columns — when displayConfig.columns is set and value is an array
  const displayColumns = field?.displayConfig?.columns;
  if (Array.isArray(rawDisplayValue) && Array.isArray(displayColumns) && displayColumns.length > 0) {
    const cols = displayColumns;
    const gridTemplateColumns = cols.map(c => c.width ? `${c.width}px` : "1fr").join(" ");
    return (
      <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <div style={{
          display: "grid",
          gridTemplateColumns,
          columnGap: 8,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          background: "var(--input-bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 4,
          padding: "4px 8px",
        }}>
          {cols.map((c, i) => (
            <div key={`h${i}`} style={{ fontWeight: 600, opacity: 0.55, fontSize: 10, color: "var(--text-muted)", paddingBottom: 2 }}>
              {c.header || c.path}
            </div>
          ))}
          {rawDisplayValue.map((row, ri) =>
            cols.map((c, ci) => (
              <div key={`${ri}-${ci}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                {row[c.path] == null ? "" : String(row[c.path])}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Number / text / date / default
  return (
    <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {showLabel && <span style={labelStyle}>{name}</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {RuleIconNC && <RuleIconNC size={12} style={{ flexShrink: 0, color: valueColor }} />}
        <div style={{ ...roBox, flex: type === "text" || type === "date" ? 1 : undefined }}>
          {ruleDisplayNC ?? valueDisplay}
          {ruleSuffixNC && <span style={{ marginLeft: 4, opacity: 0.7 }}>{ruleSuffixNC}</span>}
        </div>
        {showUnit && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{unit}</span>}
        {valueDelta != null && (
          <span style={{ fontSize: 11, color: deltaColorVal, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {valueDelta > 0 ? `+${valueDelta}` : valueDelta}
          </span>
        )}
      </div>
      {targetProgress && (
        <div style={{ marginTop: 3 }}>
          <div style={{ height: 3, background: "var(--border-default)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: targetProgress.met ? "var(--accent-green-text)" : "var(--accent-blue)",
              width: `${Math.min(100, targetProgress.progress)}%`,
              transition: "width 0.3s",
            }} />
          </div>
          <span style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 2, display: "block" }}>
            {targetProgress.met ? "✓ target met" : `target: ${targetProgress.target}${unit ? ` ${unit}` : ""}`}
          </span>
        </div>
      )}
    </div>
  );
}

export default React.memo(Field);
