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

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import { X, Plus, Check, ChevronDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Equal, Shuffle, Link2, Pause, Play, Square, Star, Minus, AlertCircle, AlertTriangle, ImagePlus } from "lucide-react";

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
import { createLeafInstanceInParent, setOccurrenceFieldValue, updateModule, updateField } from "../helpers/CommitHelpers";
import { openImagePicker } from "./ImagePickerMenu";
import { resolveFileRef } from "../helpers/fileRef";
import RepresentationView from "./RepresentationView";
import AutoMarquee from "./AutoMarquee";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { useGridActionsSelector } from "../GridActionsContext";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "../state/actions";

// ─── FlowToggle (popover with 3 flow options) ─────────────────
// Whole-control tints per flow (2026-07-11, per user): the control CARRYING a
// flow toggle is colored by the flow — green=in(+), blue=replace, red=out(−).
export const FLOW_TINTS = {
  in:      { bg: "rgba(34,197,94,0.16)",   border: "rgba(34,197,94,0.35)",   text: "rgb(134,239,172)" },
  out:     { bg: "rgba(248,113,113,0.16)", border: "rgba(248,113,113,0.35)", text: "rgb(252,165,165)" },
  replace: { bg: "rgba(59,130,246,0.16)",  border: "rgba(59,130,246,0.35)",  text: "rgb(147,197,253)" },
};
// `segment` renders it as a divided LEADING segment inside the parent control's
// border (the RandomizeSegment pattern) instead of a standalone square button —
// the parent owns border/background/overflow-hidden.
function FlowToggle({ flow = "in", onChange, compact = false, disabled = false, segment = false }) {
  const [open, setOpen] = useState(false);
  // Icon/label per flow; ALL flow coloring (segment + standalone) derives from
  // FLOW_TINTS so the palette has exactly one source.
  const configs = {
    in:      { icon: ArrowUp,   label: "In (+)", desc: "Positive" },
    out:     { icon: ArrowDown, label: "Out (−)", desc: "Negative" },
    replace: { icon: Equal,     label: "Replace", desc: "Overwrites" },
  };
  const options = ["in", "out", "replace"];
  const config = configs[flow] || configs.in;
  const tint = FLOW_TINTS[flow] || FLOW_TINTS.in;
  const Icon = config.icon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Flow: ${config.label}`}
          className={segment
            ? `inline-flex items-center justify-center flex-shrink-0 ${compact ? "px-1" : "px-1.5"}
               ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-white/10"}`
            : `inline-flex items-center justify-center rounded border transition-colors flex-shrink-0
               ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-125"}
               ${compact ? "w-5 h-5" : "w-6 h-6"}`}
          style={segment
            ? { borderRight: `1px solid ${tint.border}`, color: tint.text }
            : { background: tint.bg, borderColor: tint.border, color: tint.text }}
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

// ─── RandomizeSegment ──────────────────────────────────────────
// A divided trailing 🎲 segment that sits INSIDE a pill's border (the
// parent owns the border + overflow-hidden; this just adds a left divider).
// Shared by the select pill and every occurrence pill so the dice reads as
// part of the control instead of a tacked-on sibling button.
function RandomizeSegment({ onClick, disabled, compact }) {
  return (
    <button type="button" title="Pick random" disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center px-1.5 flex-shrink-0
        ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted"}`}
      style={{ borderLeft: "1px solid var(--input-border, hsl(var(--border)))", color: "var(--text-faint)" }}
    >
      <Shuffle className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
    </button>
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
      {/* Border lives on this wrapper so the randomize dice can sit INSIDE it
          (a divided trailing segment) instead of as a separate sibling button. */}
      <div className={`flex items-stretch w-full rounded border overflow-hidden ${compact ? "h-6" : "h-7"}`}
        style={{ borderColor: fieldName ? "rgba(6,182,212,0.25)" : "var(--input-border, hsl(var(--border)))" }}>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" disabled={disabled}
              className={`w-full justify-between font-normal border-0 rounded-none ${compact ? "h-6 text-xs" : "h-7 text-sm"}`}
              style={fieldName ? { background: "rgba(6,182,212,0.08)", color: "rgb(180,225,245)" } : undefined}>
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
          <RandomizeSegment compact={compact} disabled={disabled}
            onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) onChange([p.value]); }} />
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

// NOTE (2026-07-13): the transient +N/−N change badge lives in ONE place —
// FieldRenderer's `.delta-popup` (absolute, superscript at the value's top
// right). Field.jsx used to render a SECOND badge at the pill's right edge
// (useFlowDelta/DeltaBadge), so every goal update showed the plus twice
// (user: "remove the old little + … keep the higher one").

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

function OccurrenceOption({ occId, fallbackLabel, maps, chipDisplay = null, onSetImage = null }) {
  const card = resolveOccCard(occId, maps, chipDisplay);
  const label = card?.label || (card && chipDisplay && chipDisplay.showLabel === false ? null : (fallbackLabel || occId));
  const mediaVal = card?.mediaVal;
  const ext = typeof mediaVal === "string" ? (mediaVal.split(".").pop() || "").toLowerCase() : "";
  const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)
    || (typeof mediaVal === "string" && /^https?:\/\//.test(mediaVal)); // remote URLs often carry no extension
  // Hide the media slot entirely when chipDisplay opts out (showMedia=false).
  const renderMediaSlot = chipDisplay ? chipDisplay.showMedia !== false : true;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
      {renderMediaSlot && (
        <div style={{ width: 34, height: 46, flexShrink: 0, borderRadius: 4, overflow: "hidden", position: "relative",
          background: "var(--input-bg, rgba(255,255,255,0.04))", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {mediaVal && isImg
            ? <img src={resolveFileRef(mediaVal)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <Link2 style={{ width: 12, height: 12, opacity: 0.4 }} />}
          {onSetImage && (
            // "Set image" — Calibre-style cover lookup for THIS option. A real
            // click target inside the option row: swallow the event so it
            // doesn't select the option or close the popover.
            <span
              role="button"
              title="Set image…"
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSetImage(occId, label || fallbackLabel || ""); }}
              style={{
                position: "absolute", right: 1, bottom: 1, padding: 2, borderRadius: 4,
                background: "rgba(10,16,24,0.72)", color: "rgba(190,215,235,0.9)",
                display: "flex", alignItems: "center", cursor: "pointer",
              }}
            >
              <ImagePlus style={{ width: 11, height: 11 }} />
            </span>
          )}
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

// ─── ArrayCell — one cell of a columnar array-display field ──────────────────
// A cell value is either a scalar (rendered as text — the default, fully
// back-compatible) OR a descriptor object `{ kind, ... }` so any cell can be
// filled with arbitrary content independent of its column:
//   { kind: "occurrence", id }                 → RepresentationView chip (click-to-jump)
//   { kind: "field", id, fieldId }             → a projected field value off that occ
//   { kind: "media", src } | { id, fieldId? }  → image thumbnail (explicit src OR
//                                                 a media-role field on the occ)
//   { kind: "text", text }                     → explicit free text / note
// Anything unrecognized falls through to String(value).
export function ArrayCell({ value, maps }) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.kind) {
    const occurrencesById = maps?.occurrencesById;
    switch (value.kind) {
      case "occurrence": {
        const occ = occurrencesById?.[value.id];
        if (!occ) return value.id ?? "";
        return <RepresentationView occurrence={occ} size="sm" onJump={() => jumpToOccurrence(occ.id)} />;
      }
      case "field": {
        const occ = occurrencesById?.[value.id];
        const raw = occ?.fields?.[value.fieldId]?.value;
        if (raw == null || raw === "") return "";
        return Array.isArray(raw) ? `${raw.length} selected` : String(raw);
      }
      case "media": {
        let src = value.src;
        if (!src && value.id != null) {
          const occ = occurrencesById?.[value.id];
          src = value.fieldId ? occ?.fields?.[value.fieldId]?.value : resolveOccCard(value.id, maps)?.mediaVal;
        }
        if (!src) return "";
        return <img src={resolveFileRef(src)} alt="" style={{ height: 28, maxWidth: "100%", objectFit: "cover", borderRadius: 3, display: "block" }} />;
      }
      case "text":
        return value.text == null ? "" : String(value.text);
      default:
        return String(value);
    }
  }
  return value == null ? "" : String(value);
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
  // When true (and the field is a single-select), render a randomize "dice"
  // segment INSIDE the select pill's border (FieldRenderer routes its
  // `canRandomize` here so the dice reads as part of the pill, not a tacked-on
  // sibling button). `meta.randomize` also enables it.
  randomize = false,
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
  // ─── Value resolution (display) ─────────────────────────────
  const rawDisplayValue = useMemo(() => {
    if (liveDisplayValue != null) return liveDisplayValue;
    // ARRAYS pass through as-is (same contract as extractValue below):
    // FieldRenderer unwraps the stored {value, flow} wrapper and hands the
    // bare array to display fields — treating it as "object without a value
    // key" returned undefined, so every array-history field (Workouts /
    // Meals / Moods rows) rendered "—" unless a computed slot masked it
    // (found 2026-07-14: "last workout works but not Workouts").
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("value" in value) return value.value;
      return undefined;
    }
    return value;
  }, [value, liveDisplayValue]);

  // ─── Input state ─────────────────────────────────────────────
  // Unwrap a stored `{value, flow}` wrapper; pass everything else through.
  // ARRAYS must pass through as-is — FieldRenderer already unwraps the wrapper
  // and hands the bare array to multi-value fields (select/occurrence
  // multiSelect); treating an array as "object without a value key" returned
  // undefined and every stored multi-value rendered EMPTY on load (found
  // 2026-07-12 via the tags feed E2E).
  const extractValue = (v) => (v && typeof v === "object" && !Array.isArray(v) ? ("value" in v ? v.value : undefined) : v);
  const defaultValue = field?.meta?.defaultValue ?? (field?.type === "boolean" ? false : undefined);
  const resolveInputVal = (v) => { const raw = extractValue(v); return (raw === null || raw === undefined) ? (defaultValue ?? raw) : raw; };

  const [localValue, setLocalValue] = useState(() => resolveInputVal(value));
  const [isClickEditing, setIsClickEditing] = useState(false); // for compact click-to-edit
  const [selectQuery, setSelectQuery] = useState(""); // for full-mode select search
  const [selectOpen, setSelectOpen] = useState(false); // for full-mode select popover
  const inputRef = useRef(null);

  // Context needed for occurrence add-new: create a new instance in the library container.
  // Per-slice selectors instead of useGridActions() — the full-context subscription
  // re-rendered EVERY mounted Field on every occurrence write (part of the
  // multi-second drop pause). The per-write-rebuilt maps (occurrencesById /
  // state) are read at callback time via the non-subscribing getters.
  const dispatch = useGridActionsSelector(s => s.dispatch);
  const socket = useGridActionsSelector(s => s.socket);
  const gridId = useGridActionsSelector(s => s.gridId);
  const userId = useGridActionsSelector(s => s.userId);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const operationsById = useGridActionsSelector(s => s.operationsById);
  // Custom providers (tests, previews) may omit the getters — the fallback
  // closure reads the maps they DO provide. The closure identity is unstable
  // only for those providers; the app's getters are identity-stable.
  const getOcc = useGridActionsSelector(s => s.getOcc || ((oid) => (oid ? s.occurrencesById?.[oid] || null : null)));
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const getState = useGridActionsSelector(s => s.getState || (() => s.state || {}));
  // Ops want the FULL state (occurrences/instances/...) at RUN time. A caller
  // that still threads a full state via prop wins; the lite state-shaped props
  // (grid only) and absent props fall through to a fresh getState() read.
  const resolveOpState = () => (state && state.occurrences ? state : getState());

  // occurrenceAddNewCfg is derived from field meta — stable reference, safe to compute here.
  // Read via field?.meta because the `meta` destructure happens later in the function.
  const occurrenceAddNewCfg = field?.type === "occurrence" && field?.meta?.multiSelect ? field?.meta?.optionsSource?.addNew : null;

  // Rich occurrence-picker row renderer (poster + label + field values).
  // chipDisplay = the field's `meta.optionsSource.chipDisplay` config (or null).
  // When set, drives which fields/media render on each chip; otherwise the
  // OccurrenceOption auto-derives from the referenced module's bindings.
  // `occurrencesById` is a live getter property so chip renderers always read
  // the CURRENT map at render time without this component subscribing to it.
  const occMaps = useMemo(
    () => ({ get occurrencesById() { return getOccMap(); }, modulesById, fieldsById }),
    [getOccMap, modulesById, fieldsById]
  );
  const chipDisplay = field?.meta?.optionsSource?.chipDisplay || null;

  // "Set image" on a picker option — resolves the option occurrence's
  // media-role binding (fallback: a binding whose field is literally named
  // "Poster") and opens the global ImagePicker prefilled with a
  // Calibre-style lookup query ("<label> movie poster" / "<label> book
  // cover" when the occurrence carries a Library tag). The pick writes that
  // occurrence's media field, so the thumbnail updates everywhere the
  // occurrence renders (picker chips, representation views, table cells).
  const handleSetOptionImage = useCallback((occId, optLabel) => {
    const occMap = getOccMap();
    const occ = occMap?.[occId];
    if (!occ) return;
    const mod = modulesById?.[occ.moduleId || occ.targetId] || null;
    const bindings = Array.isArray(mod?.fieldBindings) ? mod.fieldBindings : [];
    let mediaFieldId =
      bindings.find(b => b.role === "media")?.fieldId ||
      bindings.find(b => (fieldsById?.[b.fieldId]?.name || "").toLowerCase() === "poster")?.fieldId ||
      null;
    // No media binding yet → bind the shared "Poster" field (hidden) so ANY
    // occurrence option can be given an image, not just movies/people that
    // shipped with one. The binding is what makes the thumbnail render in
    // picker chips / representation views.
    let bindOnPick = null;
    if (!mediaFieldId) {
      const posterField = Object.values(fieldsById || {}).find(f => (f?.name || "").toLowerCase() === "poster");
      if (!posterField || !mod) return;
      mediaFieldId = posterField.id;
      bindOnPick = () => {
        const already = (mod.fieldBindings || []).some(b => b.fieldId === posterField.id);
        if (already) return;
        updateModule({
          dispatch, socket,
          module: { ...mod, fieldBindings: [...(mod.fieldBindings || []), { fieldId: posterField.id, role: "media", hidden: true, order: 99 }] },
          emit: true,
        });
      };
    }
    // Query hint from the occurrence's Library tag when present.
    const libB = bindings.find(b => (fieldsById?.[b.fieldId]?.name || "").toLowerCase() === "library");
    const libVal = libB ? occ.fields?.[libB.fieldId]?.value : null;
    const suffix = libVal === "movie" ? " movie poster"
      : libVal === "book" ? " book cover"
      : libVal === "tv show" ? " tv show poster"
      : libVal === "podcast" ? " podcast cover"
      : "";
    const label = optLabel || mod?.label || occ.label || "";
    openImagePicker({
      query: `${label}${suffix}`.trim(),
      title: `Set image — ${label}`,
      onPick: (url) => {
        bindOnPick?.();
        setOccurrenceFieldValue({
          dispatch, socket,
          occurrencesById: getOccMap(),
          occurrenceId: occId,
          fieldId: mediaFieldId,
          value: url,
        });
      },
    });
  }, [getOccMap, modulesById, fieldsById, dispatch, socket]);

  const renderOccurrenceOption = useCallback(
    (o) => <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} chipDisplay={chipDisplay} onSetImage={handleSetOptionImage} />,
    [occMaps, chipDisplay, handleSetOptionImage]
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
    const parentOcc = getOcc(parentOccurrenceId);
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
  }, [occurrenceAddNewCfg, getOcc, localValue, dispatch, socket, gridId, userId, handleChange, onCommit]);

  // Quick-add for SELECT fields (tags pattern): a select with
  // `meta.allowNewOptions` lets the user type a new option straight into the
  // multi-select pill — the option is persisted onto the FIELD (manual
  // optionsSource values, or legacy meta.options) so it's offered everywhere
  // the field renders. MultiSelectWithAdd already handles appending the new
  // value to the occurrence's selection; we only persist the option itself.
  const handleSelectAddOption = useCallback(({ value: newValue, label: newLabel } = {}) => {
    if (!field?.id || !newValue) return;
    const meta = field.meta || {};
    const opt = { value: newValue, label: newLabel || newValue };
    let nextMeta;
    if (meta.optionsSource?.mode === "manual") {
      const values = Array.isArray(meta.optionsSource.values) ? meta.optionsSource.values : [];
      if (values.some(v => (v?.value ?? v) === newValue)) return;
      nextMeta = { ...meta, optionsSource: { ...meta.optionsSource, values: [...values, opt] } };
    } else {
      const opts = Array.isArray(meta.options) ? meta.options : [];
      if (opts.some(v => (v?.value ?? v) === newValue)) return;
      nextMeta = { ...meta, options: [...opts, opt] };
    }
    updateField({ dispatch, socket, field: { id: field.id, meta: nextMeta } });
  }, [field?.id, field?.meta, dispatch, socket]);
  const selectQuickAdd = field?.type === "select" && field?.meta?.allowNewOptions
    ? handleSelectAddOption : null;

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
        { state: resolveOpState(), fieldsById, operationsById, occurrencesById: getOccMap() },
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
    // ── Media-role binding (cover / photo URL) — image-picker pill ────────
    // A text field bound with role:"media" holds the occurrence's image URL
    // (movie poster, person photo, book cover). Instead of a raw URL text
    // pill, render a thumbnail + "Set image…" that opens the global
    // ImagePicker (search / upload / paste-URL). The pick commits through
    // the normal field path so onChange trackers fire like any edit.
    const isMediaBinding = binding?.role === "media";
    if (compact && isMediaBinding && type === "text" && !isClickEditing) {
      const src = typeof localValue === "string" && localValue ? resolveFileRef(localValue) : null;
      const hostLabel = modulesById?.[hostOccurrence?.moduleId || hostOccurrence?.targetId]?.label
        || hostOccurrence?.label || "";
      return (
        <button type="button" disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            openImagePicker({
              query: hostLabel,
              title: `Set image — ${hostLabel || name}`,
              onPick: (url) => { handleChange(url); onCommit?.(url); },
            });
          }}
          className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border transition-all
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
          style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)", color: "rgb(180,225,245)" }}
          title={`${name}: ${localValue || "no image"} — click to set`}
        >
          {src
            ? <img src={src} alt="" style={{ width: 14, height: 18, objectFit: "cover", borderRadius: 2 }} />
            : <ImagePlus style={{ width: 10, height: 10, opacity: 0.7 }} />}
          {!hideName && name && <span className="opacity-70">{name}</span>}
        </button>
      );
    }

    // Compact click-to-edit mode for numeric/text/duration fields
    const useClickToEdit = compact && (type === "number" || type === "text" || type === "duration");

    if (useClickToEdit) {
      // Flow side-button (2026-07-11): value-bearing fields that opt in via
      // field.meta.flowToggle get the green/blue/red in/replace/out FlowToggle
      // beside the compact pill (full inputs always render it). Opt-in because
      // most compact pills (water, steps, reps) have no meaningful flow.
      // Rendered OUTSIDE the rest↔editing swap at a stable tree position so
      // its popover survives the input's blur-commit.
      const showFlowToggle = field?.meta?.flowToggle === true && type !== "text";
      // Attached like the randomizer segment: ONE pill, toggle divided off the
      // left, and the WHOLE pill tinted by the flow (green/blue/red).
      const flowPillTint = showFlowToggle ? (FLOW_TINTS[flow] || FLOW_TINTS.in) : null;
      const withFlowToggle = (inner) => !showFlowToggle ? inner : (
        <span className={`inline-flex items-stretch rounded-full border overflow-hidden ${disabled ? "opacity-50" : ""}`}
          style={{ background: flowPillTint.bg, borderColor: flowPillTint.border, color: flowPillTint.text }}>
          <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact disabled={disabled} segment />
          {inner}
        </span>
      );
      // Empty-input display: number/duration → 0, text/notes → "—".
      const displayNum = localValue ?? ((type === "number" || type === "duration") ? 0 : "—");
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
        return withFlowToggle(
          <div className={`field-input editing inline-flex items-center gap-0.5 ${showFlowToggle ? "px-1" : ""}`}>
            {prefix && <span className="text-[10px] text-muted-foreground">{prefix}</span>}
            <Input ref={inputRef} type={type === "number" ? "number" : "text"}
              value={localValue ?? ""}
              onChange={(e) => handleChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
              onKeyDown={handleKeyDown} onBlur={handleCommit} disabled={disabled}
              className={`${compact ? "h-5 text-[10px] w-14" : "h-6 text-xs w-16"} px-1 text-center ${showFlowToggle ? "border-0 bg-transparent" : ""}`}
              style={{ minWidth: 40, ...(showFlowToggle ? { color: "inherit" } : {}) }} />
            {postfix && <span className="text-[10px] text-muted-foreground">{postfix}</span>}
          </div>
        );
      }

      return withFlowToggle(
        <button type="button" disabled={disabled}
          onClick={() => !disabled && setIsClickEditing(true)}
          className={`field-input inline-flex items-center gap-1
            ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"}
            ${showFlowToggle ? "" : "rounded-full border"} transition-all
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
          style={showFlowToggle
            ? { background: "transparent", color: "inherit" }
            : { background: pillTint.bg, borderColor: pillTint.border, color: pillTint.text }}
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
        ? parseLocalDay(inputDate)?.toLocaleDateString(undefined, { month: "short", day: "numeric" }) ?? "—"
        : "—";
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
            showLabel={showLabel} randomize={randomize} renderOption={renderOccurrenceOption} fieldName={name} />
        );
      }
      const currentLabel = options.find(o => o.value === localValue)?.label || localValue || "—";
      return (
        // Border on the wrapper so the randomize dice sits INSIDE the pill.
        <div className="field-input inline-flex items-stretch rounded-full border overflow-hidden"
          style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)" }}>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-all
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: "transparent", border: "none", color: "rgb(180,225,245)" }}
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
                      <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} chipDisplay={chipDisplay} onSetImage={handleSetOptionImage} />
                    </button>
                  ))}
            </div>
          </PopoverContent>
        </Popover>
        {randomize && options.length > 1 && (
          <RandomizeSegment compact disabled={disabled}
            onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) { handleChange(p.value); onCommit?.(p.value); } }} />
        )}
        </div>
      );
    }

    // Shared label style for full (non-compact) inputs
    const inputLabelStyle = { fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 };

    // Full input controls. The flow toggle is ATTACHED to the input (divided
    // leading segment, randomizer-style) and the whole input is tinted by the
    // flow — green=in, blue=replace, red=out (2026-07-11, per user).
    const fullFlowTint = FLOW_TINTS[flow] || FLOW_TINTS.in;
    if (type === "number") {
      return (
        <div className="field-input field-input-number" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className={`flex items-stretch rounded border overflow-hidden ${compact ? "h-6" : "h-7"}`}
              style={{ background: fullFlowTint.bg, borderColor: fullFlowTint.border, color: fullFlowTint.text }}>
              <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact={compact} disabled={disabled} segment />
              <Input type="number" value={localValue ?? ""} disabled={disabled}
                placeholder="0"
                className={`border-0 rounded-none bg-transparent ${compact ? "h-6 text-xs w-16" : "h-7 text-sm"}`}
                style={{ color: "inherit" }}
                onChange={e => handleChange(e.target.value === "" ? null : Number(e.target.value))}
                onBlur={handleCommit} onKeyDown={handleKeyDown}
                min={meta?.min} max={meta?.max} step={meta?.step} />
            </div>
            {showUnit && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{unit}</span>}
          </div>
        </div>
      );
    }

    if (type === "text") {
      // Media-role binding, full-size input: same ImagePicker affordance the
      // compact pill has (2026-07-07) — the value is an image URL the picker
      // owns, so a raw text box is the wrong control (profile pics / image
      // fields edited in forms had no search until 2026-07-11).
      if (binding?.role === "media") {
        const src = typeof localValue === "string" && localValue ? resolveFileRef(localValue) : null;
        const hostLabel = modulesById?.[hostOccurrence?.moduleId || hostOccurrence?.targetId]?.label
          || hostOccurrence?.label || "";
        return (
          <div className="field-input field-input-media" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {showLabel && <span style={inputLabelStyle}>{name}</span>}
            <button type="button" disabled={disabled}
              onClick={() => {
                if (disabled) return;
                openImagePicker({
                  query: hostLabel,
                  title: `Set image — ${hostLabel || name}`,
                  onPick: (url) => { handleChange(url); onCommit?.(url); },
                });
              }}
              className={`inline-flex items-center gap-2 px-2 py-1 text-xs rounded border transition-all self-start
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)", color: "rgb(180,225,245)" }}
              title={`${name}: ${localValue || "no image"} — click to set`}
            >
              {src
                ? <img src={src} alt="" style={{ width: 24, height: 32, objectFit: "cover", borderRadius: 3 }} />
                : <ImagePlus style={{ width: 14, height: 14, opacity: 0.7 }} />}
              <span>{src ? "Change image…" : "Set image…"}</span>
            </button>
          </div>
        );
      }
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
            {/* The pill border lives on this wrapper so the randomize dice can sit
                INSIDE it (a divided trailing segment) instead of as a separate
                tacked-on button. `items-stretch` makes the borderless trigger +
                dice fill the pill height; `overflow-hidden` clips to the radius. */}
            <div
              className={`inline-flex items-stretch self-start rounded border bg-background overflow-hidden
                ${compact ? "h-6 text-xs" : "h-7 text-sm"}
                ${disabled ? "opacity-50" : ""}`}
              style={{ borderColor: "var(--input-border, hsl(var(--border)))" }}
            >
              <Popover open={selectOpen} onOpenChange={(o) => { setSelectOpen(o); if (!o) setSelectQuery(""); }}>
                <PopoverTrigger asChild>
                  <button type="button" disabled={disabled}
                    className={`inline-flex items-center justify-between gap-1 px-2 bg-transparent
                      ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted"}`}
                    style={{ minWidth: 80, border: "none", color: "var(--text-primary)" }}
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
              {(meta?.randomize || randomize) && options.length > 0 && (
                <button type="button" title="Pick random" disabled={disabled}
                  onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) { handleChange(p.value); onCommit?.(p.value); } }}
                  className={`inline-flex items-center justify-center px-1.5 flex-shrink-0
                    ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted"}`}
                  style={{ borderLeft: "1px solid var(--input-border, hsl(var(--border)))", color: "var(--text-faint)" }}
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      }

      return (
        <MultiSelectWithAdd name={showLabel ? name : ""} options={options} selected={selectedValues}
          onChange={vals => { handleChange(vals); onCommit?.(vals); }}
          onAddOption={onAddOption || selectQuickAdd} disabled={disabled} compact={compact}
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
          <div className={`inline-flex items-center gap-1 rounded border overflow-hidden ${compact ? "h-6" : "h-7"}`}
            style={{ background: fullFlowTint.bg, borderColor: fullFlowTint.border, color: fullFlowTint.text, alignSelf: "flex-start" }}>
            <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact={compact} disabled={disabled} segment />
            <Input type="number" value={hours} disabled={disabled} min={0} max={23} placeholder="0"
              className={`border-0 rounded-none bg-transparent ${compact ? "h-6 text-xs w-12" : "h-7 text-sm w-14"}`}
              style={{ color: "inherit" }}
              onChange={e => updateDuration(parseInt(e.target.value) || 0, minutes)}
              onBlur={handleCommit} onKeyDown={handleKeyDown} />
            <span style={{ fontSize: 10, opacity: 0.7 }}>h</span>
            <Input type="number" value={minutes} disabled={disabled} min={0} max={59} step={5} placeholder="0"
              className={`border-0 rounded-none bg-transparent ${compact ? "h-6 text-xs w-12" : "h-7 text-sm w-14"}`}
              style={{ color: "inherit" }}
              onChange={e => updateDuration(hours, parseInt(e.target.value) || 0)}
              onBlur={handleCommit} onKeyDown={handleKeyDown} />
            <span style={{ fontSize: 10, opacity: 0.7, paddingRight: 6 }}>m</span>
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
            showLabel={showLabel} randomize={randomize} renderOption={renderOccurrenceOption} fieldName={name} />
        );
      }
      return (
        <div className="field-input field-input-occurrence" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          {/* Border on this row so the randomize dice sits INSIDE the pill. */}
          <div className="inline-flex items-stretch self-start overflow-hidden"
            style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 5 }}>
          <Popover open={selectOpen} onOpenChange={setSelectOpen}>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled}
                style={{
                  minHeight: 28, fontSize: 12, fontFamily: "var(--font-mono)",
                  background: "transparent", border: "none",
                  color: "rgb(180,225,245)", padding: "4px 8px", outline: "none",
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
          {randomize && options.length > 1 && (
            <RandomizeSegment disabled={disabled}
              onClick={() => { const p = options[Math.floor(Math.random() * options.length)]; if (p) { handleChange(p.value); onCommit?.(p.value); } }} />
          )}
          </div>
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
    if (rawDisplayValue === null || rawDisplayValue === undefined) {
      // Empty numeric displays read as 0 (e.g. Days Until Due, account
      // balances); everything else (date/text/select/…) reads as a dash.
      if (type === "number") return "0";
      if (type === "duration") return "0m";
      return compact ? "-" : "—";
    }
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
      case "text": {
        // Array-history values without a columns renderer in reach: empty →
        // "—", primitive rows join, object rows summarize (the columnar
        // branches render the real table when displayConfig.columns is set).
        if (Array.isArray(rawDisplayValue)) {
          if (!rawDisplayValue.length) return "—";
          return rawDisplayValue.every(r => r == null || typeof r !== "object")
            ? rawDisplayValue.join(", ")
            : `${rawDisplayValue.length} row${rawDisplayValue.length === 1 ? "" : "s"}`;
        }
        return String(rawDisplayValue);
      }
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

    // Array-with-columns history fields (Workouts / Meals / Moods rows…)
    // render the real columnar table even on compact tiles — the generic
    // pill below can only show a scalar, so these read as "—" forever
    // (2026-07-14: "last workout works but not Workouts"). Empty arrays
    // fall through to the pill.
    const compactColumns = field?.displayConfig?.columns;
    if (Array.isArray(rawDisplayValue) && rawDisplayValue.length > 0 &&
        Array.isArray(compactColumns) && compactColumns.length > 0) {
      const gridTemplateColumns = compactColumns.map(c => c.width ? `${c.width}px` : "auto").join(" ");
      return (
        <div className="field-display field-display-compact" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {!hideName && name && <span style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{name}:</span>}
          {/* When the columns overflow the tile, the WHOLE table box marquees
              (AutoMarquee is static when it fits) — width:max-content lets the
              grid take its natural width so the overflow is measurable. */}
          <AutoMarquee>
          <div style={{
            display: "grid", gridTemplateColumns, columnGap: 6,
            fontSize: 10, fontFamily: "var(--font-mono)",
            background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
            borderRadius: 4, padding: "3px 6px", width: "max-content",
          }}>
            {compactColumns.map((c, i) => (
              <div key={`h${i}`} style={{ fontWeight: 600, opacity: 0.55, fontSize: 9, color: "var(--text-muted)", paddingBottom: 1 }}>
                {c.header || c.path}
              </div>
            ))}
            {rawDisplayValue.map((row, ri) =>
              compactColumns.map((c, ci) => {
                const cell = row?.[c.path];
                const rich = cell && typeof cell === "object" && !Array.isArray(cell) && cell.kind;
                return (
                  <div
                    key={`${ri}-${ci}`}
                    style={rich
                      ? { minWidth: 0, color: "var(--text-primary)", display: "flex", alignItems: "center" }
                      : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}
                  >
                    <ArrayCell value={cell} maps={occMaps} />
                  </div>
                );
              })
            )}
          </div>
          </AutoMarquee>
        </div>
      );
    }

    return (
      <div className="field-display field-display-compact" style={{ ...pillBase, position: "relative" }}>
        {!hideName && name && <span style={{ opacity: 0.6 }}>{name}:</span>}
        {RuleIcon && <RuleIcon size={10} style={{ flexShrink: 0, opacity: 0.85 }} />}
        <span>{ruleDisplay ?? valueDisplay}</span>
        {ruleSuffix && <span style={{ opacity: 0.7, marginLeft: 2 }}>{ruleSuffix}</span>}
        {showUnit && <span style={{ opacity: 0.5 }}>{unit}</span>}
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
    // auto tracks (not 1fr) + width:max-content: the grid takes its natural
    // width so AutoMarquee can measure overflow and scroll the WHOLE table
    // box; when it fits, it renders statically.
    const gridTemplateColumns = cols.map(c => c.width ? `${c.width}px` : "auto").join(" ");
    return (
      <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {showLabel && <span style={labelStyle}>{name}</span>}
        <AutoMarquee>
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
          width: "max-content",
        }}>
          {cols.map((c, i) => (
            <div key={`h${i}`} style={{ fontWeight: 600, opacity: 0.55, fontSize: 10, color: "var(--text-muted)", paddingBottom: 2 }}>
              {c.header || c.path}
            </div>
          ))}
          {rawDisplayValue.map((row, ri) =>
            cols.map((c, ci) => {
              const cell = row?.[c.path];
              const rich = cell && typeof cell === "object" && !Array.isArray(cell) && cell.kind;
              return (
                <div
                  key={`${ri}-${ci}`}
                  style={rich
                    ? { minWidth: 0, color: "var(--text-primary)", display: "flex", alignItems: "center" }
                    : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}
                >
                  <ArrayCell value={cell} maps={occMaps} />
                </div>
              );
            })
          )}
        </div>
        </AutoMarquee>
      </div>
    );
  }

  // Number / text / date / default
  return (
    <div className="field-display" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {showLabel && <span style={labelStyle}>{name}</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {RuleIconNC && <RuleIconNC size={12} style={{ flexShrink: 0, color: valueColor }} />}
        <div style={{ ...roBox, position: "relative", flex: type === "text" || type === "date" ? 1 : undefined }}>
          {ruleDisplayNC ?? valueDisplay}
          {ruleSuffixNC && <span style={{ marginLeft: 4, opacity: 0.7 }}>{ruleSuffixNC}</span>}
        </div>
        {showUnit && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{unit}</span>}
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
