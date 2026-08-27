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

import { splitSections, localProviderKeys } from "../helpers/mergedOptionSearch";
import { useProviderSearch } from "../hooks/useProviderSearch";
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
import { X, Plus, Check, ChevronDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Equal, Shuffle, Link2, Pause, Play, Square, Star, Minus, AlertCircle, AlertTriangle, ImagePlus, MapPin } from "lucide-react";

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
import { setOccurrenceFieldValue, updateModule, updateField } from "../helpers/CommitHelpers";
import { normalizeAddNewTargets, targetOptionsForAddNew, createOptionUnderParent, promptEntryFields } from "../helpers/addNewOption";
import { openImagePicker } from "./ImagePickerMenu";
import { openAddressPicker } from "./AddressPickerMenu";
import { readAddress, addressSummary } from "../helpers/geocode";
import { openArtifactSpread } from "./ArtifactSpreadHost";
import { primaryMediaOf } from "../helpers/occurrenceMedia";
import { resolveFileRef } from "../helpers/fileRef";
import RepresentationView from "./RepresentationView";
import AutoMarquee from "./AutoMarquee";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { useGridActionsSelector } from "../GridActionsContext";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "../state/actions";
import LoadingImage from "./LoadingImage.jsx";
import { searchProviderConfig, mapProviderFields } from "../helpers/providerFieldMap.js";

// The type size of a field on a row — its pill and its caption. ONE constant,
// because these were scattered inline literals and an inline style is exactly
// what this repo keeps losing an hour to when a size "silently does nothing".
// 10 -> 12 -> 13 (user, 2026-08-24: "you can one up fields to 12px", then
// reporting it still read unchanged on a tracker tile). 13 sits a clear step
// under the 16px instance label above it and is unmistakably larger than the
// 10 it replaced.
// ONE size for every piece of field text on the grid — label, value, unit,
// column header, in a compact pill or a full input, on an instance row or in a
// container header. User, 2026-08-25: *"the instance label and input/display
// fields need to be bigger … the fields should also be the same size"* and
// *"the containers fields are way too big in size and should be whatever size
// it is for instances. it should be the same size anywhere we have fields."*
//
// Those two asks are one rule, and the thing that broke it was `compact`:
// ModuleInstance renders its fields with `compact={true}` and ModuleContainer
// does not, and the compact branches picked 10/11 where the full ones picked
// 12/13. So the same field read at four different sizes depending on where it
// sat. `compact` now governs the BOX only (the fixed pill, its padding) —
// never the type size.
//
// The VALUE does not move — it was already 13. What changes is that every site
// now uses it: the compact branches were 10/11 and a scatter of inline literals
// were 12, so a field measured 12px on an instance row and 13px in a container.
// Instance field text therefore goes up exactly ONE step, which is what the
// user asked for ("when i say bigger, i mean one size bigger"), and every field
// on the grid lands on the same number.
export const FIELD_FONT_PX = 13;
// The value now lives in index.css so media queries can shrink it below tablet
// width (2026-08-26). Inline styles use THIS, not the number — a `var()` in an
// inline style resolves at computed-value time, so it follows the breakpoints;
// a number cannot. FIELD_FONT_PX stays as the documented desktop maximum and as
// the var()'s fallback.
export const FIELD_FONT = `var(--field-font-px, ${FIELD_FONT_PX}px)`;

// ─── FlowToggle (popover with 3 flow options) ─────────────────
// Whole-control tints per flow (2026-07-11, per user): the control CARRYING a
// flow toggle is colored by the flow — green=in(+), blue=replace, red=out(−).
export const FLOW_TINTS = {
  in:      { bg: "rgba(34,197,94,0.16)",   border: "rgba(34,197,94,0.35)",   text: "rgb(134,239,172)" },
  out:     { bg: "rgba(248,113,113,0.16)", border: "rgba(248,113,113,0.35)", text: "rgb(252,165,165)" },
  replace: { bg: "rgba(59,130,246,0.16)",  border: "rgba(59,130,246,0.35)",  text: "rgb(147,197,253)" },
};
// ─── The neutral pill surface ────────────────────────────────────────────────
// USER, 2026-08-19: *"the account dropdowns are very hard to read currently
// colour wise"*, *"any dropdown select really is hard to read"*, *"ingrediant
// too."*
//
// THREE CONTROLS HARDCODED A DARK-SURFACE COLOUR, which is invisible on a light
// theme. The compact SELECT pill and the compact DATE pill were
// `bg-white/5 border-white/10 text-white/60` — white ink at 55-60% opacity, fine
// over near-black and gone over cream — and the multi-select CHIPS (Ingredient,
// Movement, People) were `bg-primary/20 text-primary`, which resolves to a
// washed mid-green under a light theme and to NEAR-WHITE under any theme that
// does not redefine `--primary`.
//
// `--occ-pill` / `--occ-pill-text` is the token pair that already exists for
// exactly this and is defined by every one of the six themes, with ink chosen
// against that theme's own surface. Using it means a pill is legible in each
// theme by construction rather than by luck, and a seventh theme gets it free.
// Measured before the change on the live grid: the select and date pills scored
// **1.4:1** against their own background where the number pills beside them
// scored 8.9:1. WCAG wants 4.5:1 for body text.
export const OCC_PILL = {
  bg:     "rgba(var(--occ-pill) / 0.14)",
  // THE EDGE IS ITS OWN TOKEN (user, 2026-08-19: *"those pills need a border,
  // at least in the stardew valley one"*). It was `rgba(var(--occ-pill) / 0.30)`
  // — and on a light theme that composites to within a few points of the
  // surface it sits on: brown at 30% over cream is (168,143,108) against a
  // (164,157,133) background, which is not an edge. The green value pills next
  // to it read fine at the same alpha only because green separates from tan and
  // brown does not, so no single alpha is right for both. The default below is
  // today's value exactly, so every DARK theme is unchanged; the light themes
  // override it.
  //
  // THE FIRST PASS FIXED THREE CALL SITES AND THERE WERE TEN. The OCCURRENCE
  // dropdowns — the ones a user actually names, because they are the ones with
  // words in them — render through `MultiSelectWithAdd` and four other
  // wrappers, each carrying its OWN hardcoded `rgba(var(--occ-pill) / 0.25)`:
  // LIGHTER than the pills the first pass fixed, which is exactly why the
  // report came back as "they do, they are just way too light". All seven read
  // the token now, each keeping its own alpha as the dark-theme fallback.
  // GREP `--occ-pill` BEFORE ADDING AN ELEVENTH.
  border: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.30))",
  text:   "var(--occ-pill-text)",
};
// A CHIP sits INSIDE one of those pills, so it needs to read against the pill
// rather than against the row — hence a stronger fill than OCC_PILL.bg.
export const OCC_CHIP = {
  bg:   "rgba(var(--occ-pill) / 0.28)",
  text: "var(--occ-pill-text)",
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
              <span className="text-[12px] text-muted-foreground ml-auto">{opt.desc}</span>
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
// ─── OptionSearchList ───────────────────────────────────────────
// THE BODY OF AN OCCURRENCE DROPDOWN: the "Add new…" box that doubles as a
// SEARCH box, the destination chooser, your own options, and a provider's
// results — for single-select and multi-select alike.
//
// ── WHY THIS IS ONE COMPONENT AND NOT TWO ──────────────────────────────────
//
// It used to be two. `MultiSelectWithAdd` grew the merged grid+provider search
// on 2026-08-23; the single-select dropdown kept `AddNewOccurrenceRow`, which
// can only type a plain value. So the search reached the multi-select fields
// and no others — measured on this grid:
//
//   occurrence fields          48       multi 15      single 33
//   single WITH a provider      2       Song, Location      <- search unreachable
//   single with addNew         31                           <- no search box at all
//
// User, 2026-08-27: *"the adding new item to select isnt giving me the location
// search (the one that grabs it from that api), it just lets me add plain
// values."* `Location` is single-select, so its provider had never been
// reachable — the config was right and nothing rendered it.
//
// ── WHAT STAYS DIFFERENT, AND WHY ──────────────────────────────────────────
//
// `multi` draws the tick box and nothing else. The SELECT-vs-APPEND decision
// belongs to the caller (`onPick`), and so does the optimistic slug write after
// an add (`onAdded`) — the multi-select fires one because its own `onChange`
// carries the array, while the single path lets `handleOccurrenceAddNew` write
// the real occurrence id directly. Folding those in here is how the two would
// drift again.
function OptionSearchList({
  options,
  selected = [],
  onPick,
  multi = false,
  onAddOption = null,
  onAdded = null,
  addNewTargets = null,
  searchProvider = null,
  onImportResult = null,
  renderOption = null,
  emptyText = "No options available",
}) {
  const [newValue, setNewValue] = useState("");
  const [choosingDest, setChoosingDest] = useState(false);
  // A PROVIDER RESULT AWAITING ITS DESTINATION. The typed "+ Add new" has asked
  // which board since 2026-07-25; picking a search result minted straight into
  // `targets[0]` without asking. One question, whichever way the row arrived.
  const [pendingImport, setPendingImport] = useState(null);

  // ── SEARCHING YOUR GRID AND A PROVIDER AT ONCE ──────────────────────────
  // The local list filters SYNCHRONOUSLY as you type; the provider's results
  // are APPENDED when they arrive. A provider that is slow or down degrades to
  // exactly the behaviour this dropdown had before.
  const haveKeys = useMemo(() => [...localProviderKeys(options)], [options]);
  const { results: remoteResults, state: remoteState } =
    useProviderSearch({ provider: searchProvider, query: newValue, haveKeys, enabled: !!searchProvider });
  const sections = useMemo(
    () => splitSections({ options, query: newValue, remote: remoteResults, remoteState }),
    [options, newValue, remoteResults, remoteState],
  );

  const doAdd = useCallback((parentOccurrenceId = null) => {
    const value = newValue.toLowerCase().replace(/\s+/g, "_");
    onAddOption?.({ value, label: newValue.trim(), parentOccurrenceId });
    onAdded?.(value);
    setNewValue("");
    setChoosingDest(false);
  }, [newValue, onAddOption, onAdded]);

  const handleAddNew = useCallback(() => {
    if (!newValue.trim()) return;
    setPendingImport(null);
    if ((addNewTargets?.length || 0) > 1) { setChoosingDest(true); return; }
    doAdd(addNewTargets?.[0]?.id ?? null);
  }, [newValue, addNewTargets, doAdd]);

  const doImport = useCallback((r, parentOccurrenceId = null) => {
    setPendingImport(null);
    setChoosingDest(false);
    setNewValue("");
    onImportResult?.(r, parentOccurrenceId);
  }, [onImportResult]);

  const handlePickRemote = useCallback((r) => {
    if ((addNewTargets?.length || 0) > 1) { setPendingImport(r); setChoosingDest(true); return; }
    doImport(r, addNewTargets?.[0]?.id ?? null);
  }, [addNewTargets, doImport]);

  return (
    <>
      {onAddOption && (
        <div className="p-2 border-b border-border" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Input type="text" value={newValue} onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddNew()}
              className="h-6 text-xs flex-1"
              placeholder={searchProvider ? `Search or add…` : "Search or add…"} />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddNew} disabled={!newValue.trim()}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {choosingDest && (
            <div className="mt-1">
              <div className="text-[12px] text-muted-foreground px-1 py-0.5">
                Add “{pendingImport ? pendingImport.title : newValue.trim()}” to:
              </div>
              {(addNewTargets || []).map(t => (
                <button key={t.id} type="button"
                  onClick={() => (pendingImport ? doImport(pendingImport, t.id) : doAdd(t.id))}
                  className="w-full px-2 py-1 rounded-sm text-left text-xs hover:bg-muted">
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto p-1">
        {/* A HEADING ONLY WHEN THERE ARE TWO SOURCES. With no provider
            configured this renders exactly as it always did — one plain list,
            no ceremony. */}
        {searchProvider && sections.local.length > 0 && (
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground px-2 pt-1 pb-0.5">On your grid</div>
        )}
        {sections.local.length === 0 && !searchProvider
          ? <div className="py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
          : sections.local.map(o => (
              <button key={o.value} type="button" onClick={() => onPick?.(o.value)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-xs transition-colors
                  ${selected.includes(o.value) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                {multi && (
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                    ${selected.includes(o.value) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                    {selected.includes(o.value) && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                )}
                {renderOption ? renderOption(o) : <span className="truncate">{o.label}</span>}
              </button>
            ))}
        {/* THE PROVIDER SECTION. Visibly separate because picking here IMPORTS
            — it mints an occurrence and fills its fields — while picking above
            merely SELECTS one you already have. One undifferentiated list would
            make the second look like the first and quietly grow the board. */}
        {searchProvider && newValue.trim() && (
          <>
            <div className="text-[12px] uppercase tracking-wide text-muted-foreground px-2 pt-2 pb-0.5 border-t border-border/40 mt-1">
              From {searchProvider}
              {sections.remoteState === "searching" && <span className="ml-1 opacity-60">searching…</span>}
              {sections.remoteState === "error" && <span className="ml-1 opacity-60">unavailable</span>}
            </div>
            {/* "searching" is why an empty list is not "nothing found" — a
                distinction the user has to see, or a slow provider looks like a
                wrong answer. */}
            {sections.remoteState === "done" && sections.external.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nothing found</div>
            )}
            {sections.external.map(r => (
              <button key={`${r.provider}:${r.externalId || r.title}`} type="button"
                onClick={() => handlePickRemote(r)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-xs hover:bg-muted">
                <Plus className="h-3 w-3 flex-shrink-0 opacity-60" />
                <span className="truncate">
                  {r.title}
                  {r.subtitle && <span className="opacity-60"> — {String(r.subtitle).slice(0, 60)}</span>}
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function MultiSelectWithAdd({ name, options, selected, onChange, onAddOption, disabled, compact, showLabel, randomize, renderOption, fieldName, addNewTargets = null, searchProvider = null, onImportResult = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOptions = useMemo(() => options.filter(o => selected.includes(o.value)), [options, selected]);
  const toggle = useCallback(
    (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]),
    [selected, onChange],
  );
  // The search box, the destination chooser and the provider section all live
  // in `OptionSearchList` now — the single-select dropdown renders the same one
  // rather than a second copy that never grew the search.
  return (
    <div className={compact ? "field-input field-input-select-multi inline-flex" : "field-input field-input-select-multi"}>
      {showLabel && <Label className="text-xs text-muted-foreground mb-1">{name}</Label>}
      {/* Border lives on this wrapper so the randomize dice can sit INSIDE it
          (a divided trailing segment) instead of as a separate sibling button.
          COMPACT renders the same PILL as the single-select occurrence dropdown
          (rounded-full, inline, no fixed height): the two sat side by side on
          one instance row at different heights and corner radii, and neither
          lined up with the boolean/number pills beside them (user 2026-07-29).
          Height comes from the trigger's padding, exactly like the single
          variant, so all the pills on a row share one box model. */}
      <div className={compact
        ? "inline-flex items-stretch rounded-full border overflow-hidden"
        : "flex items-stretch w-full rounded border overflow-hidden h-7"}
        style={{ borderColor: fieldName ? "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))" : "var(--input-border, hsl(var(--border)))",
                 ...(compact && fieldName ? { background: "rgba(var(--occ-pill) / 0.1)" } : {}) }}>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" disabled={disabled}
              className={compact
                ? "justify-between font-normal border-0 rounded-none h-auto px-1.5 py-0.5 text-[12px]"
                : "w-full justify-between font-normal border-0 rounded-none h-7 text-sm"}
              style={fieldName
                ? { background: compact ? "transparent" : "rgba(var(--occ-pill) / 0.08)", color: "var(--occ-pill-text)" }
                : undefined}>
              {/* occurrence field-pill: always show the field name so it reads
                  as a labelled pill (fixes "occurrence selects show no field
                  name / no pill"). */}
              {/* The caption's dimming is a TOKEN, not a number. Measured
                  2026-08-23: this 0.7 compounds with a pill-text colour that
                  already carries alpha, putting the field name at 1.76:1 on
                  moduli-light and ~3.1 on midnight — below readable on every
                  skin, while the VALUE beside it was fine. A theme can now
                  lift it; the default is today's value, so nothing moves
                  until a theme says so. */}
              {fieldName && <span className="text-[12px] mr-1 flex-shrink-0" style={{ opacity: "var(--field-caption-alpha, 0.7)" }}>{fieldName}:</span>}
              {selectedOptions.length === 0
                ? <span className="text-muted-foreground">{compact ? (fieldName ? "—" : name) : "Select..."}</span>
                : <div className="flex flex-wrap gap-1 items-center overflow-hidden">
                    {selectedOptions.slice(0, 2).map(o => (
                      <span key={o.value} className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[12px] rounded-full"
                        style={{ background: OCC_CHIP.bg, color: OCC_CHIP.text,
                                 border: `1px solid ${OCC_PILL.border}` }}>
                        {o.label}
                        <X className="h-2.5 w-2.5 cursor-pointer" onClick={e => { e.stopPropagation(); onChange(selected.filter(v => v !== o.value)); }} />
                      </span>
                    ))}
                    {selectedOptions.length > 2 && <span className="text-[12px] text-muted-foreground">+{selectedOptions.length - 2}</span>}
                  </div>}
              <ChevronDown className="h-3 w-3 opacity-50 flex-shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <OptionSearchList
              options={options}
              selected={selected}
              onPick={toggle}
              multi
              onAddOption={onAddOption}
              // The optimistic SLUG write stays here: `handleOccurrenceAddNew`
              // overwrites it with the real occurrence id in a microtask, and
              // that dance is the multi-select caller's, not the list's.
              onAdded={(value) => onChange([...selected, value])}
              addNewTargets={addNewTargets}
              searchProvider={searchProvider}
              onImportResult={onImportResult}
              renderOption={renderOption}
            />
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
/**
 * Whole days from today to `value` — negative when it has passed. Null when the
 * value is not a date.
 *
 * ONE definition, because the same arithmetic was written three times in this
 * file (the input's relative badge, the display string, and now the colour) and
 * a fourth copy is how they start disagreeing.
 *
 * A `YYYY-MM-DD` string is parsed as LOCAL midnight. `new Date("2026-08-11")`
 * is parsed as UTC and lands a day early anywhere west of Greenwich — this
 * codebase has lost a day to that repeatedly.
 */
export function dayDiffFromToday(value) {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    ? new Date(value + "T00:00:00")
    : new Date(value);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

/** A date that has already gone by. Today is NOT overdue — you still have it. */
export function isOverdueDate(value) {
  const diff = dayDiffFromToday(value);
  return diff !== null && diff < 0;
}

/**
 * The affix picker — a divided segment fused into the pill, the same idiom as
 * FlowToggle (leading) and RandomizeSegment (trailing). A third pattern for
 * "small chooser attached to a value" would just be a third thing to keep
 * aligned.
 *
 * `side` places the divider on the correct edge so prefix and postfix each read
 * as part of the same control rather than a button parked next to it.
 *
 * Sizing is INLINE because the pills it sits in set their own metrics inline,
 * and an inline style beats any stylesheet rule regardless of specificity —
 * recorded five times in CLAUDE.md.
 */
function AffixSegment({ value, options, onPick, side = "postfix", compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  if (!options?.length) return null;
  const label = value === "" || value == null ? "—" : value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Unit: ${value || "none"} — click to change`}
          className={`inline-flex items-center justify-center flex-shrink-0 ${compact ? "px-1" : "px-1.5"}
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-white/10"}`}
          style={{
            [side === "prefix" ? "borderRight" : "borderLeft"]: "1px solid rgba(255,255,255,0.18)",
            color: "var(--text-muted)",
            fontSize: FIELD_FONT,
            lineHeight: 1,
            minWidth: compact ? 14 : 18,
          }}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-28 p-1" align="start" side="bottom">
        {options.map((opt) => (
          <button key={opt || "__none__"} type="button"
            onClick={() => { onPick?.(opt); setOpen(false); }}
            className={`w-full flex items-center px-2 py-1.5 rounded-sm text-xs transition-colors
              ${value === opt ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          >
            {opt === "" ? <span className="opacity-60">none</span> : opt}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function valueSignColor(value, type) {
  // A DATE is not "filled or empty", it is early or late — and the generic
  // string fallthrough below painted every date green, so an overdue Due date
  // read as healthy. User 2026-08-08: "the due field should be colored red if
  // the date passed."
  if (type === "date") {
    if (value == null || value === "") return "var(--accent-blue-text, #bfdbfe)";
    return isOverdueDate(value) ? "var(--danger-text)" : "var(--accent-green-text)";
  }
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
function valueSignPillTint(value, type) {
  // Mirrors valueSignColor's date branch — the compact pill is the SAME signal
  // at a different density, and letting the two disagree is how a date reads
  // red in one place and green in the other.
  if (type === "date") {
    if (value == null || value === "") {
      return { bg: "rgba(var(--signal-zero) / 0.18)", border: "rgba(var(--signal-zero) / 0.35)" };
    }
    return isOverdueDate(value)
      ? { bg: "rgba(var(--signal-neg) / 0.2)", border: "rgba(var(--signal-neg) / 0.35)" }
      : { bg: "rgba(var(--signal-pos) / 0.2)", border: "rgba(var(--signal-pos) / 0.35)" };
  }
  if (value == null || value === "" || value === 0) {
    return { bg: "rgba(var(--signal-zero) / 0.18)", border: "rgba(var(--signal-zero) / 0.35)" };
  }
  if (typeof value === "number") {
    return value < 0
      ? { bg: "rgba(var(--signal-neg) / 0.2)", border: "rgba(var(--signal-neg) / 0.35)" }
      : { bg: "rgba(var(--signal-pos) / 0.2)",  border: "rgba(var(--signal-pos) / 0.35)" };
  }
  if (typeof value === "boolean") {
    return value
      ? { bg: "rgba(var(--signal-pos) / 0.2)",  border: "rgba(var(--signal-pos) / 0.35)" }
      : { bg: "rgba(var(--signal-zero) / 0.18)", border: "rgba(var(--signal-zero) / 0.35)" };
  }
  if (Array.isArray(value)) {
    return value.length > 0
      ? { bg: "rgba(var(--signal-pos) / 0.2)",  border: "rgba(var(--signal-pos) / 0.35)" }
      : { bg: "rgba(var(--signal-zero) / 0.18)", border: "rgba(var(--signal-zero) / 0.35)" };
  }
  // Every branch above reads `--signal-*`; this one used to paint a HARDCODED
  // `rgba(34,197,94,…)` emerald, so a TEXT value ignored the theme entirely and
  // sat next to a number pill in a different green. Stardew's `--signal-pos` is
  // a muted (74,158,63); the literal was (34,197,94).
  return { bg: "rgba(var(--signal-pos) / 0.2)", border: "rgba(var(--signal-pos) / 0.35)" };
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
  const mod = modulesById?.[occ.moduleId] || null;
  const bindings = Array.isArray(mod?.fieldBindings) ? mod.fieldBindings : [];
  const showMedia = chipDisplay ? chipDisplay.showMedia !== false : true;
  // Resolved through occurrenceMedia: the media value is an artifact occurrence
  // id, so a chip's poster is the artifact's fileRef rather than a raw string.
  // This is the highest-traffic reader of that value — every option row of
  // every occurrence dropdown — so it goes through the one resolver too.
  const mediaVal = showMedia
    ? (primaryMediaOf(occ, { occurrencesById, modulesById, fieldsById })?.src ?? null)
    : null;
  const showLabel = chipDisplay ? chipDisplay.showLabel !== false : true;

  // An OCCURRENCE-typed field holds ids, so printing the stored value verbatim
  // renders a chip full of uuids — "in the meals dropdown ingredients are being
  // showin as ids and not labels" (user, 2026-08-14). Resolved here from the
  // maps this function already has, rather than from a field's
  // `_resolvedOptions`: an option chip is drawn OUTSIDE FieldRenderer, so that
  // cache is not populated for the inner field and never will be.
  const readableValue = (f, v) => {
    if (f?.type !== "occurrence" || v == null) return v;
    const ids = Array.isArray(v) ? v : [v];
    const names = ids
      .map((id) => {
        const t = occurrencesById?.[id];
        if (!t) return null;
        return t.label ?? modulesById?.[t.moduleId]?.label ?? null;
      })
      .filter(Boolean);
    // Fall back to the raw value rather than blanking it — an unresolvable id is
    // information, an empty chip is not.
    return names.length ? names.join(", ") : v;
  };

  let fieldVals;
  if (chipDisplay && Array.isArray(chipDisplay.fieldIds)) {
    // Explicit field list — render in the configured order. Skip empty/missing
    // values (rendering "name: undefined" is worse than rendering nothing).
    fieldVals = chipDisplay.fieldIds
      .map(fid => {
        const v = occ.fields?.[fid]?.value;
        if (v == null || v === "") return null;
        const f = fieldsById?.[fid];
        return f ? { name: f.name, value: readableValue(f, v) } : null;
      })
      .filter(Boolean);
  } else {
    // Auto-derive (legacy heuristic) — first 3 non-hidden, non-media bindings.
    fieldVals = bindings
      .filter(b => b.role !== "media" && !b.hidden && occ.fields?.[b.fieldId]?.value != null && occ.fields?.[b.fieldId]?.value !== "")
      .slice(0, 3)
      .map(b => {
        const f = fieldsById?.[b.fieldId];
        return f ? { name: f.name, value: readableValue(f, occ.fields[b.fieldId].value) } : null;
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
          {/* The slot is `position: relative`, so LoadingImage's default
              `display: contents` wrapper lets the spinner cover exactly this
              box. A chip's picture is remote (a poster, a face, an ingredient
              photo) — without the spinner the slot reads as "no image", which
              is what a MISSING one looks like. */}
          {mediaVal && isImg
            ? (
              <LoadingImage
                src={resolveFileRef(mediaVal)}
                imgStyle={{ width: "100%", height: "100%", objectFit: "cover" }}
                spinnerSize="xs"
                errorSize={12}
              />
            )
            : <Link2 style={{ width: 12, height: 12, opacity: 0.4 }} />}
          {onSetImage && !(mediaVal && isImg) && (
            // "Set image" — Calibre-style cover lookup for THIS option, offered
            // only while the option has NO image; once one is set the row shows
            // the picture alone (2026-07-25, per user). A real click target
            // inside the option row: swallow the event so it doesn't select the
            // option or close the popover.
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
          <div style={{ fontWeight: 600, fontSize: FIELD_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        )}
        {card?.fieldVals?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {card.fieldVals.map((fv, i) => (
              <span key={i} style={{ fontSize: FIELD_FONT, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
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
 * - affixPrefix / affixPostfix — the affix THIS ROW shows (resolved upstream by
 *   helpers/fieldAffix: the row's pick, else the field default). Falls back to
 *   `meta.prefix` when not supplied, so every existing call site is unchanged.
 * - affixPrefixMenu / affixPostfixMenu + onAffixChange — present only when the
 *   field offers a choice; that is what makes the picker segment render.
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
  affixPrefix = null,
  affixPostfix = null,
  affixPrefixMenu = [],
  affixPostfixMenu = [],
  onAffixChange = null,
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
  // The provider value carries these inside `state`, not top-level (the bare
  // s.gridId read was silently undefined → createLeafInstanceInParent bailed
  // and "+ Add new" never minted anything; caught by the 2026-07-25 probe).
  const gridId = useGridActionsSelector(s => s.gridId ?? s.state?.gridId);
  const userId = useGridActionsSelector(s => s.userId ?? s.state?.userId);
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
  // SINGLE-select occurrence dropdowns take "+ Add" too (2026-07-25 — every
  // board dropdown mints new options, not just multi-selects).
  const occurrenceAddNewCfg = field?.type === "occurrence" ? field?.meta?.optionsSource?.addNew : null;

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
    const mod = modulesById?.[occ.moduleId] || null;
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
  const handleOccurrenceAddNew = useCallback(({ label: newLabel, parentOccurrenceId = null, occMeta = null, extraFields = null } = {}) => {
    if (!occurrenceAddNewCfg || !newLabel?.trim()) return;
    // Multi-target addNew (2026-07-25): the caller passes the CHOSEN parent
    // occurrence id; a single-target config falls back to its only entry.
    const targets = normalizeAddNewTargets(occurrenceAddNewCfg);
    const parentOcc = getOcc(parentOccurrenceId || targets[0]);
    if (!parentOcc) return;

    // Capture current selections BEFORE the slug write that MultiSelectWithAdd fires after us.
    const currentVal = Array.isArray(localValue) ? localValue : localValue ? [localValue] : [];

    // Stamps = legacy config stampFields + the chosen parent's OWN values for
    // the dropdown's predicate fields (the run-time tag mechanism — a board
    // container carries its own boardCategory value).
    const result = createOptionUnderParent({
      // Records WHERE this row came from when it was imported from a search
      // provider. Nothing else reads it; the dropdown does, to avoid offering the
      // same result again.
      occMeta,
      // Values the field's authored provider mapping asked for.
      extraFields,
      field, parentOcc, label: newLabel,
      dispatch, socket, gridId, userId,
    });
    if (!result) return;

    const isMulti = field?.meta?.multiSelect === true;
    const newSelected = isMulti ? [...currentVal, result.occurrenceId] : result.occurrenceId;
    // Overwrite the slug with the real occurrence ID via a microtask so it fires after
    // MultiSelectWithAdd's own onChange([...selected, slug]) in the same event flush.
    Promise.resolve().then(() => {
      handleChange(newSelected);
      onCommit?.(newSelected);
    });

    // Entry fields (addNew.fieldIds): chained questions through the EXISTING
    // GET_USER_INPUT modal; answers land as normal field writes.
    if (result.entryFieldIds?.length) {
      promptEntryFields({
        entryFieldIds: result.entryFieldIds,
        occurrenceId: result.occurrenceId,
        fieldsById,
        ctx: occMaps,
        dispatch, socket,
      });
    }
  }, [occurrenceAddNewCfg, field, getOcc, localValue, dispatch, socket, gridId, userId, handleChange, onCommit, fieldsById, occMaps]);

  // Candidate destinations for the add flow, labeled by LIVE occurrence data.
  const addNewTargetOptions = occurrenceAddNewCfg ? targetOptionsForAddNew(occurrenceAddNewCfg, occMaps) : null;

  // ── THE PROVIDER WIRING, ONCE ────────────────────────────────────────────
  // A provider is DATA on the field. Absent, every occurrence dropdown behaves
  // exactly as it always has — no heading, no second section.
  //
  // This used to be written inline in the two MULTI-select branches, which is
  // why the two SINGLE-select branches had no provider at all: `Location` and
  // `Song` carry an enabled provider that nothing rendered.
  const occSearchCfg = searchProviderConfig(field);
  const occSearchProvider = occSearchCfg?.provider || null;
  const occAddNewFn = occurrenceAddNewCfg ? handleOccurrenceAddNew : null;
  // Picking a provider row IMPORTS: it mints the option and stamps the provider
  // identity so the same result is not offered again.
  const importProviderResult = (occAddNewFn && occSearchProvider)
    ? async (r, parentOccurrenceId = null) => {
        // A SEARCH result carries no fields — only `detail()` does — so the
        // mapped values need a second request, made once, at the moment of
        // import rather than for every row in the list.
        let mapped = null;
        if (Object.keys(occSearchCfg.fieldMap || {}).length) {
          try {
            const j = await fetch(
              `/api/search/${encodeURIComponent(occSearchProvider)}/detail`
              + `?title=${encodeURIComponent(r?.title || "")}`
              + `&externalId=${encodeURIComponent(r?.externalId ?? "")}`,
              { headers: { Accept: "application/json" } },
            ).then((x) => x.json());
            mapped = mapProviderFields(j?.result?.fields, occSearchCfg.fieldMap, fieldsById, occSearchCfg.valueAliases).values;
          } catch {
            // The row is still worth minting. Losing the prefill is a smaller
            // failure than losing the pick the user just made.
          }
        }
        occAddNewFn({
          label: r?.title,
          // The CHOSEN board, when the dropdown asked. Without threading it the
          // question is asked and then ignored, which is worse than never asking.
          parentOccurrenceId,
          occMeta: { searchProvider: r?.provider, searchExternalId: r?.externalId ?? null },
          extraFields: mapped,
        });
      }
    : null;

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

  // The destructure moved ABOVE the guard so the hoisted hooks below can read
  // `type` and `meta`. `field || {}` keeps it safe for the null case the guard
  // still handles two lines down — and a dep array is evaluated at RENDER time,
  // so leaving it below produced `Cannot access 'type' before initialization`,
  // the TDZ trap `CanvasContent` paid for on 2026-05-21.
  const { type, name, unit, meta } = field || {};

  // ── HOISTED ABOVE THE FIRST EARLY RETURN (2026-08-23) ────────────────────
  // These four hooks lived in the DISPLAY-ONLY section, below `if (isEditable)
  // { … }` and its many returns — so a field rendered as an INPUT called four
  // fewer hooks than the same field rendered as a DISPLAY. That is only safe if
  // a mounted Field can never switch, and it can: `inputEnabled`,
  // `displayEnabled` and `type` are all editable in the Command Center's Fields
  // tab, and editing one re-renders every Field bound to it. React answers a
  // changing hook count by taking the component down.
  //
  // Same class as the three fixed the same day (ActionConfig, ModuleContainer,
  // TextblockCard) and as BoundHeader before them.
  //
  // Running them for an input field is cheap: `formattedValue` is a pure switch
  // over the already-computed `rawDisplayValue`, and the three target hooks
  // short-circuit on `hasTarget`. Their only dependency declared above is
  // `meta` (line ~1115), which precedes this point.
  // Formatted value for display
  const formattedValue = useMemo(() => {
    if (rawDisplayValue === null || rawDisplayValue === undefined) {
      // A field may name what its EMPTY state means. `Tracker Date` uses it to
      // read "Total" when no date filter is set, because an empty period on a
      // tracker means "aggregate everything" rather than "no data" — so a dash
      // there is actively misleading. Generic and configured as DATA: nothing
      // here learns what a tracker is, which `noDomainKnowledge` enforces.
      // Checked before the numeric defaults so a labelled number field says its
      // label rather than 0.
      const empty = field?.meta?.emptyLabel;
      if (typeof empty === "string" && empty) return empty;
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
      // Reads whichever shape the value is in — a bare string (every address
      // written before this type existed) or the picker's object.
      case "address": return addressSummary(rawDisplayValue) || (compact ? "-" : "—");
      case "date": {
        // Unreachable for null/undefined (handled above, emptyLabel included);
        // this catches "" and other falsy shapes a date field can carry.
        if (!rawDisplayValue) return (typeof field?.meta?.emptyLabel === "string" && field.meta.emptyLabel) || "—";
        try {
          const parseLocalDay = (v) => {
            if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
            return new Date(v);
          };
          const date = parseLocalDay(rawDisplayValue);
          const diff = dayDiffFromToday(rawDisplayValue);   // one definition
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

  // ── HOISTED (2026-08-23), the fifth of five ──────────────────────────────
  // This lived inside `case type === "date"` of the INPUT section, so a Field
  // called one more hook for a date than for anything else — and a field's TYPE
  // is editable in the Command Center, so switching a field to or from `date`
  // changed the hook count on every mounted Field bound to it.
  //
  // `dayDiffFromToday` is a pure parse, so computing it for a non-date field is
  // free and the result is simply unread.
  const relativeDateLabel = useMemo(() => {
    const diff = dayDiffFromToday(localValue);
    if (diff === null) return null;
    if (diff === 0) return { text: "today", color: "#22c55e" };
    if (diff === 1) return { text: "tomorrow", color: "#22c55e" };
    if (diff > 0) return { text: `in ${diff} days`, color: diff <= 7 ? "#f59e0b" : "#64748b" };
    if (diff === -1) return { text: "yesterday", color: "#ef4444" };
    return { text: `${Math.abs(diff)} days overdue`, color: "#ef4444" };
  }, [localValue]);

  if (!field) return null;

  // `affixPrefix` is already row-resolved (pick -> field default) by
  // FieldRenderer; the `?? meta.prefix` keeps every other call site — forms,
  // previews, tests that render <Field> directly — byte-identical.
  const prefix = hidePrefix ? "" : (affixPrefix ?? meta?.prefix ?? "");
  const postfix = hidePostfix ? "" : (affixPostfix ?? meta?.postfix ?? "");
  const canPickPrefix = !!onAffixChange && affixPrefixMenu.length > 0 && !hidePrefix;
  const canPickPostfix = !!onAffixChange && affixPostfixMenu.length > 0 && !hidePostfix;
  // When the affix PICKER renders, it already shows the unit as its own segment
  // — appending it to the value text too reads "3oz oz" (user, 2026-08-14). So
  // the inline copy is suppressed exactly when a picker is present. A field with
  // one fixed affix and no options keeps it inline, byte-identical.
  const inlinePrefix = canPickPrefix ? "" : prefix;
  const inlinePostfix = canPickPostfix ? "" : postfix;
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
          fontSize: FIELD_FONT,
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
      // The value is an artifact OCCURRENCE ID now, not a URL string — resolved
      // through the one resolver every thumbnail site reads (2026-08-06).
      const src = primaryMediaOf(hostOccurrence, occMaps)?.src || null;
      const hostLabel = modulesById?.[hostOccurrence?.moduleId]?.label
        || hostOccurrence?.label || "";
      return (
        <button type="button" disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            // Clicking the face opens the SPREAD — every file this occurrence
            // has, with adding one available in there. The pill deliberately
            // stopped being an entry point to the picker so there is exactly
            // one way to attach.
            if (hostOccurrence?.id) {
              openArtifactSpread(hostOccurrence.id, e.currentTarget.getBoundingClientRect());
            }
          }}
          className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[12px] rounded-full border transition-all
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
          style={{ background: "rgba(var(--occ-pill) / 0.1)", borderColor: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))", color: "var(--occ-pill-text)" }}
          title={`${name}: ${localValue || "no image"} — click to set`}
        >
          {src
            ? <img src={src} alt="" style={{ width: 14, height: 18, objectFit: "cover", borderRadius: 2 }} />
            : <ImagePlus style={{ width: 10, height: 10, opacity: 0.7 }} />}
          {/* Same caption, same token — see the note above. */}
          {!hideName && name && <span style={{ opacity: "var(--field-caption-alpha, 0.7)" }}>{name}</span>}
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
      // The affix picker rides INSIDE the same pill as the flow toggle. When
      // the field offers a choice but no flow toggle, the pill still has to
      // exist to hold the divider — hence the `|| canPickAffix` arm.
      const canPickAffix = canPickPrefix || canPickPostfix;
      const withFlowToggle = (inner) => (!showFlowToggle && !canPickAffix) ? inner : (
        <span className={`inline-flex items-stretch rounded-full border overflow-hidden ${disabled ? "opacity-50" : ""}`}
          style={showFlowToggle
            ? { background: flowPillTint.bg, borderColor: flowPillTint.border, color: flowPillTint.text }
            : { borderColor: "rgba(255,255,255,0.18)" }}>
          {showFlowToggle && (
            <FlowToggle flow={flow || "in"} onChange={onFlowChange} compact disabled={disabled} segment />
          )}
          {canPickPrefix && (
            <AffixSegment value={prefix} options={affixPrefixMenu} side="prefix"
              onPick={(v) => onAffixChange("prefix", v)} compact disabled={disabled} />
          )}
          {inner}
          {canPickPostfix && (
            <AffixSegment value={postfix} options={affixPostfixMenu} side="postfix"
              onPick={(v) => onAffixChange("postfix", v)} compact disabled={disabled} />
          )}
        </span>
      );
      // Empty-input display: number/duration → 0, text/notes → "—".
      const rawNum = localValue ?? ((type === "number" || type === "duration") ? 0 : "—");
      // The DISPLAY path already rounds to `precision`; this INPUT pill printed
      // the bare number, so a price of 2.50 read "$2.5" (user, 2026-08-14).
      // Integers stay integers — "6 oz", not "6.00 oz".
      const displayNum = (type === "number" && typeof rawNum === "number" && !Number.isInteger(rawNum))
        ? rawNum.toFixed(binding?.display?.precision ?? 2)
        : rawNum;
      const formattedDisplay = `${inlinePrefix}${displayNum}${inlinePostfix}`;
      // Pill tint:
      //   - target present  → target-met (green) / not-met (red)
      //   - no target       → value-direction colors (red <0, blue 0/null, green >0)
      const pillTint = hasTarget
        ? (targetMet
            ? { bg: "rgba(34,197,94,0.2)",  border: "rgba(34,197,94,0.35)",  text: "rgb(134,239,172)" }
            : { bg: "rgba(248,113,113,0.2)", border: "rgba(248,113,113,0.35)", text: "rgb(252,165,165)" })
        : (() => {
            const t = valueSignPillTint(localValue, type);
            return { ...t, text: valueSignColor(localValue, type) };
          })();

      if (isClickEditing) {
        return withFlowToggle(
          <div className={`field-input editing inline-flex items-center gap-0.5 ${showFlowToggle ? "px-1" : ""}`}>
            {inlinePrefix && <span className="text-[12px] text-muted-foreground">{inlinePrefix}</span>}
            <Input ref={inputRef} type={type === "number" ? "number" : "text"}
              value={localValue ?? ""}
              onChange={(e) => handleChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
              onKeyDown={handleKeyDown} onBlur={handleCommit} disabled={disabled}
              // TEXT gets a wide, left-aligned box (2026-07-25, per user: editing
              // an email in a 56px centered box was unusable). Numbers/durations
              // keep the narrow centered field — they're a few glyphs wide.
              className={`${compact ? "h-5 text-[12px]" : "h-6 text-xs"} ${
                type === "number" ? (compact ? "w-14" : "w-16") + " text-center" : "w-full text-left"
              } px-1 ${showFlowToggle ? "border-0 bg-transparent" : ""}`}
              style={{
                minWidth: type === "number" ? 40 : 180,
                ...(type === "number" ? {} : { maxWidth: "min(420px, 60vw)" }),
                ...(showFlowToggle ? { color: "inherit" } : {}),
              }} />
            {inlinePostfix && <span className="text-[12px] text-muted-foreground">{inlinePostfix}</span>}
          </div>
        );
      }

      return withFlowToggle(
        <button type="button" disabled={disabled}
          onClick={() => !disabled && setIsClickEditing(true)}
          className={`field-input inline-flex items-center gap-1
            ${compact ? "px-1.5 py-0.5 text-[12px]" : "px-2 py-1 text-xs"}
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
          ${isOn ? "bg-green-500/20 border-green-500/30" : "moduli-pill-off"}
          ${disabled ? "opacity-50" : ""}`}
          title={`${name}: ${isOn ? "on" : "off"}`}
        >
          <Switch checked={isOn} disabled={disabled}
            onCheckedChange={v => { handleChange(v); onCommit?.(v); }} />
          {!hideName && name && (
            <span style={{ fontSize: FIELD_FONT, color: isOn ? "var(--accent-green-text)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
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
              className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[12px] rounded-full border transition-all
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: OCC_PILL.bg, borderColor: OCC_PILL.border, color: OCC_PILL.text }}
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
        <label className={`field-input inline-flex items-center gap-1 px-1.5 py-0.5 text-[12px] rounded-full border transition-all
          cursor-pointer hover:brightness-110
          ${disabled ? "opacity-50 pointer-events-none" : ""}`}
          style={{ background: OCC_PILL.bg, borderColor: OCC_PILL.border, color: OCC_PILL.text }}
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
          {!hideName && name && <span style={{ fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginRight: 2 }}>{name}:</span>}
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
        // When addNew is configured, wire handleOccurrenceAddNew (accepts { value, label, parentOccurrenceId } from MultiSelectWithAdd).
        const occAddNew = occurrenceAddNewCfg ? handleOccurrenceAddNew : null;
        return (
          <MultiSelectWithAdd name={showLabel ? name : ""} options={options} selected={selectedValues}
            onChange={vals => { handleChange(vals); onCommit?.(vals); }}
            onAddOption={occAddNew} disabled={disabled} compact={compact}
            showLabel={showLabel} randomize={randomize} renderOption={renderOccurrenceOption} fieldName={name}
            addNewTargets={addNewTargetOptions}
            searchProvider={occSearchProvider} onImportResult={importProviderResult} />
        );
      }
      const currentLabel = options.find(o => o.value === localValue)?.label || localValue || "—";
      return (
        // Border on the wrapper so the randomize dice sits INSIDE the pill.
        <div className="field-input inline-flex items-stretch rounded-full border overflow-hidden"
          style={{ background: "rgba(var(--occ-pill) / 0.1)", borderColor: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))" }}>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[12px] transition-all
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: "transparent", border: "none", color: "var(--occ-pill-text)" }}
              title={`${name}: ${currentLabel}`}
            >
              <Link2 style={{ width: 10, height: 10, opacity: 0.6 }} />
              {!hideName && name && <span style={{ opacity: 0.7 }}>{name}:</span>}
              {/* THE SELECTION IS A CHIP, exactly as the multi-select renders
                  each of its own (user, 2026-08-19: *"make selectors like meal
                  show a pill inside like ingredient does. so one selected
                  should look like one that has multiple selected"*).
                  A single-pick and a multi-pick over the same board were two
                  different-looking controls for the same idea; one is now the
                  N=1 case of the other, down to the clear button.
                  EMPTY STAYS PLAIN — a chip around an em-dash reads as a
                  selection you cannot remove. */}
              {localValue
                ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full"
                    style={{ background: OCC_CHIP.bg, color: OCC_CHIP.text,
                             border: `1px solid ${OCC_PILL.border}` }}>
                    {currentLabel}
                    <X className="h-2.5 w-2.5 cursor-pointer"
                      onClick={e => { e.stopPropagation(); handleChange(null); onCommit?.(null); }} />
                  </span>
                : <span>{currentLabel}</span>}
              <ChevronDown style={{ width: 10, height: 10, opacity: 0.5 }} />
            </button>
          </PopoverTrigger>
          {/* THE SAME LIST THE MULTI-SELECT RENDERS. It used to be a plain
              option list under a type-a-value row, so the search — local AND
              provider — reached the 15 multi-select occurrence fields and none
              of the 33 single ones. */}
          <PopoverContent className="w-56 p-0" align="start" side="bottom">
            <OptionSearchList
              options={options}
              selected={localValue ? [localValue] : []}
              onPick={(v) => { handleChange(v); onCommit?.(v); }}
              onAddOption={occAddNewFn}
              addNewTargets={addNewTargetOptions}
              searchProvider={occSearchProvider}
              onImportResult={importProviderResult}
              emptyText="No occurrences available"
              renderOption={(o) => (
                <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps}
                  chipDisplay={chipDisplay} onSetImage={handleSetOptionImage} />
              )}
            />
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
    const inputLabelStyle = { fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 };

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
              {canPickPrefix && (
                <AffixSegment value={prefix} options={affixPrefixMenu} side="prefix"
                  onPick={(v) => onAffixChange("prefix", v)} compact={compact} disabled={disabled} />
              )}
              <Input type="number" value={localValue ?? ""} disabled={disabled}
                placeholder="0"
                className={`border-0 rounded-none bg-transparent ${compact ? "h-6 text-xs w-16" : "h-7 text-sm"}`}
                style={{ color: "inherit" }}
                onChange={e => handleChange(e.target.value === "" ? null : Number(e.target.value))}
                onBlur={handleCommit} onKeyDown={handleKeyDown}
                // `increment` is the key the DATA carries — 71 fields across four
                // grids (Steps 500, Calories 50, Liquid Amount 8, macros 0.1). This
                // read used to ask for `meta.step`, which NOTHING writes and 0 fields
                // carry, so every number field silently stepped by the browser's
                // default of 1 — and a 0.1 field was unusable, since a step of 1
                // makes the browser reject a fractional value outright.
                min={meta?.min} max={meta?.max} step={meta?.increment} />
              {canPickPostfix && (
                <AffixSegment value={postfix} options={affixPostfixMenu} side="postfix"
                  onPick={(v) => onAffixChange("postfix", v)} compact={compact} disabled={disabled} />
              )}
            </div>
            {showUnit && <span style={{ fontSize: FIELD_FONT, color: "var(--text-faint)" }}>{unit}</span>}
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
        // Same merge as the compact pill: the value is an artifact occurrence
        // id, and clicking opens the spread rather than the picker.
        const src = primaryMediaOf(hostOccurrence, occMaps)?.src || null;
        const hostLabel = modulesById?.[hostOccurrence?.moduleId]?.label
          || hostOccurrence?.label || "";
        return (
          <div className="field-input field-input-media" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {showLabel && <span style={inputLabelStyle}>{name}</span>}
            <button type="button" disabled={disabled}
              onClick={(e) => {
                if (disabled) return;
                if (hostOccurrence?.id) {
                  openArtifactSpread(hostOccurrence.id, e.currentTarget.getBoundingClientRect());
                }
              }}
              className={`inline-flex items-center gap-2 px-2 py-1 text-xs rounded border transition-all self-start
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
              style={{ background: "rgba(var(--occ-pill) / 0.1)", borderColor: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))", color: "var(--occ-pill-text)" }}
              title={`${name}: ${localValue || "no image"} — click to set`}
            >
              {src
                ? <img src={src} alt="" style={{ width: 24, height: 32, objectFit: "cover", borderRadius: 3 }} />
                : <ImagePlus style={{ width: 14, height: 14, opacity: 0.7 }} />}
              <span>{src ? "Files…" : "Add a file…"}</span>
            </button>
          </div>
        );
      }
      // Prose wants room. `meta.multiline` sits on Person Notes / Allergies /
      // Interests / How We Met / Excerpt and was read by nothing — only a
      // `markdown`-TYPED field ever got a textarea, so every one of those
      // rendered as a single-line box.
      //
      // COMPACT is deliberately excluded: a row's field pills share one
      // centreline (2026-07-28) and a growing box breaks that alignment, so
      // multiline is a full-size-editor affordance. The compact pill's own
      // click-to-edit still opens the value for editing.
      //
      // handleKeyDown is NOT wired here, unlike the single-line input: it
      // commits on Enter, which in a textarea is the key that makes a new line.
      if (meta?.multiline && !compact) {
        return (
          <div className="field-input field-input-text field-input-text-multiline" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {showLabel && <span style={inputLabelStyle}>{name}</span>}
            <textarea
              value={localValue ?? ""}
              disabled={disabled}
              rows={meta?.rows || 3}
              onChange={e => handleChange(e.target.value)}
              onBlur={handleCommit}
              style={{
                width: "100%", resize: "vertical", padding: "4px 8px",
                fontSize: FIELD_FONT, fontFamily: "var(--font-mono)",
                background: "var(--input-bg)", border: "1px solid var(--input-border)",
                borderRadius: 4, color: "var(--text-primary)", outline: "none",
                lineHeight: 1.5, minHeight: 60,
              }}
            />
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

    // An ADDRESS is a searchable thing, so its editor is the map picker rather
    // than a text box. Same control at both densities — an address is never
    // short enough for a compact inline input to be the right shape, and the
    // picker is where the coordinates come from.
    if (type === "address") {
      const addr = readAddress(localValue);
      return (
        <div className="field-input field-input-address" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <button type="button" disabled={disabled}
            onClick={() => {
              if (disabled) return;
              openAddressPicker({
                title: name || "Set address",
                // Seed the search from the row's own name — looking up "Dewey
                // Center" is nearly always what you meant when you clicked the
                // address field on a row called Dewey Center.
                query: addr?.label
                  || modulesById?.[hostOccurrence?.moduleId]?.label
                  || hostOccurrence?.label
                  || "",
                value: addr,
                onPick: (loc) => { handleChange(loc); handleCommit(loc); },
              });
            }}
            className={`inline-flex items-start gap-2 px-2 py-1 text-xs rounded border transition-all self-start text-left
              ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
            style={{
              background: "rgba(var(--occ-pill) / 0.1)",
              borderColor: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))",
              color: "var(--occ-pill-text)",
              maxWidth: "100%",
            }}
            title={addr ? [addr.label, addr.address].filter(Boolean).join(" — ") : "Search for an address"}
          >
            <MapPin style={{ width: 13, height: 13, opacity: 0.7, flexShrink: 0, marginTop: 1 }} />
            {addr ? (
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                {addr.label && <span style={{ fontWeight: 600 }}>{addr.label}</span>}
                {addr.address && (
                  <span style={{ opacity: 0.75, fontSize: FIELD_FONT }}>{addr.address}</span>
                )}
              </span>
            ) : (
              <span style={{ opacity: 0.75 }}>Set an address…</span>
            )}
          </button>
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
              fontSize: FIELD_FONT, fontFamily: "var(--font-mono)",
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
              {showLabel && <span style={{ fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
            </>
          ) : (
            <>
              <Checkbox checked={!!localValue} disabled={disabled}
                onCheckedChange={v => { handleChange(v); onCommit?.(v); }} />
              {showLabel && <span style={{ fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
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
                        width: "100%", height: 28, fontSize: FIELD_FONT, fontFamily: "monospace",
                        background: "var(--input-bg)", border: "1px solid var(--input-border)",
                        borderRadius: 5, color: "var(--text-primary)", padding: "0 8px",
                        outline: "none", marginBottom: 6,
                      }}
                    />
                  )}
                  {filteredOpts.length === 0 ? (
                    <div style={{ fontSize: FIELD_FONT, fontStyle: "italic", color: "var(--text-faint)", padding: 6 }}>
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

      return (
        <div className="field-input field-input-date" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Input type="date" value={localValue ?? ""} disabled={disabled}
              className={compact ? "h-6 text-xs" : "h-7 text-sm"}
              onChange={e => handleChange(e.target.value)} onBlur={handleCommit} />
            {relativeDateLabel && (
              <span style={{ fontSize: FIELD_FONT, color: relativeDateLabel.color, whiteSpace: "nowrap", fontWeight: 500 }}>
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
            <span style={{ fontSize: FIELD_FONT, opacity: 0.7 }}>h</span>
            <Input type="number" value={minutes} disabled={disabled} min={0} max={59} step={5} placeholder="0"
              className={`border-0 rounded-none bg-transparent ${compact ? "h-6 text-xs w-12" : "h-7 text-sm w-14"}`}
              style={{ color: "inherit" }}
              onChange={e => updateDuration(hours, parseInt(e.target.value) || 0)}
              onBlur={handleCommit} onKeyDown={handleKeyDown} />
            <span style={{ fontSize: FIELD_FONT, opacity: 0.7, paddingRight: 6 }}>m</span>
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
            showLabel={showLabel} randomize={randomize} renderOption={renderOccurrenceOption} fieldName={name}
            addNewTargets={addNewTargetOptions}
            searchProvider={occSearchProvider} onImportResult={importProviderResult} />
        );
      }
      return (
        <div className="field-input field-input-occurrence" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {showLabel && <span style={inputLabelStyle}>{name}</span>}
          {/* Border on this row so the randomize dice sits INSIDE the pill. */}
          <div className="inline-flex items-stretch self-start overflow-hidden"
            style={{ background: "rgba(var(--occ-pill) / 0.08)", border: "1px solid var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))", borderRadius: 5 }}>
          <Popover open={selectOpen} onOpenChange={setSelectOpen}>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled}
                style={{
                  minHeight: 28, fontSize: FIELD_FONT, fontFamily: "var(--font-mono)",
                  background: "transparent", border: "none",
                  color: "var(--occ-pill-text)", padding: "4px 8px", outline: "none",
                  display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}>
                {localValue
                  ? <div style={{ flex: 1, minWidth: 0 }}><OccurrenceOption occId={localValue} fallbackLabel={localValue} maps={occMaps} chipDisplay={chipDisplay} /></div>
                  : <span style={{ flex: 1, opacity: 0.6 }}>Select occurrence...</span>}
                <ChevronDown style={{ width: 12, height: 12, opacity: 0.5, flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start" side="bottom">
              <OptionSearchList
                options={options}
                selected={localValue ? [localValue] : []}
                onPick={(v) => { handleChange(v); onCommit?.(v); setSelectOpen(false); }}
                onAddOption={occAddNewFn}
                addNewTargets={addNewTargetOptions}
                searchProvider={occSearchProvider}
                onImportResult={importProviderResult}
                emptyText="No occurrences available"
                renderOption={(o) => (
                  <OccurrenceOption occId={o.value} fallbackLabel={o.label} maps={occMaps} />
                )}
              />
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

    return <div style={{ fontSize: FIELD_FONT, color: "var(--text-faint)" }}>Unknown field type: {type}</div>;
  }

  // ══════════════════════════════════════════════════════════════
  // DISPLAY-ONLY — READ-ONLY RENDERING
  // ══════════════════════════════════════════════════════════════


  const fmt = (v) => typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
  const valueDisplay = hasTarget && scaledTarget !== null
    ? `${inlinePrefix}${fmt(rawDisplayValue ?? 0)}/${fmt(scaledTarget)}${inlinePostfix}`
    : `${inlinePrefix}${formattedValue}${inlinePostfix}`;

  // Shared style for read-only "input-like" boxes
  // Non-compact value color precedence:
  //   1. displayRule.color (rule from $displayRules in pipeline)
  //   2. target-met / not-met (when field has a target)
  //   3. value-direction colors (red <0, blue 0/null, green >0/filled)
  const valueColor = displayRule?.color
    ? displayRule.color
    : hasTarget
    ? (targetMet ? "var(--accent-green-text)" : "var(--danger-text)")
    : valueSignColor(rawDisplayValue, type);
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
    fontSize: FIELD_FONT, color: valueColor,
    fontFamily: "var(--font-mono)",
    flexShrink: 0,
  };
  const labelStyle = { fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 };

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
      const tint = valueSignPillTint(rawDisplayValue, type);
      pillColor  = tint.bg;
      pillBorder = tint.border;
      pillText   = valueSignColor(rawDisplayValue, type);
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
      fontSize: FIELD_FONT, fontFamily: "var(--font-mono)",
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
          background: "rgba(var(--occ-pill) / 0.1)", borderColor: "var(--occ-pill-border, rgba(var(--occ-pill) / 0.25))", color: "var(--occ-pill-text)",
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
          {!hideName && name && <span style={{ fontSize: FIELD_FONT, opacity: 0.6, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{name}:</span>}
          {/* When the columns overflow the tile, the WHOLE table box marquees
              (AutoMarquee is static when it fits) — width:max-content lets the
              grid take its natural width so the overflow is measurable. */}
          <AutoMarquee>
          <div style={{
            display: "grid", gridTemplateColumns, columnGap: 6,
            fontSize: FIELD_FONT, fontFamily: "var(--font-mono)",
            background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
            borderRadius: 4, padding: "3px 6px", width: "max-content",
          }}>
            {compactColumns.map((c, i) => (
              <div key={`h${i}`} style={{ fontWeight: 600, opacity: 0.55, fontSize: FIELD_FONT, color: "var(--text-muted)", paddingBottom: 1 }}>
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
          fontSize: FIELD_FONT, fontFamily: "var(--font-mono)", lineHeight: 1.6,
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
        {showLabel && <span style={{ fontSize: FIELD_FONT, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{name}</span>}
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
          <span style={{ fontSize: FIELD_FONT, color: "var(--text-faint)" }}>h</span>
          <div style={{ ...roBox, minWidth: 36, justifyContent: "center" }}>{dm}</div>
          <span style={{ fontSize: FIELD_FONT, color: "var(--text-faint)" }}>m</span>
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
          fontSize: FIELD_FONT,
          fontFamily: "var(--font-mono)",
          background: "var(--input-bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 4,
          padding: "4px 8px",
          width: "max-content",
        }}>
          {cols.map((c, i) => (
            <div key={`h${i}`} style={{ fontWeight: 600, opacity: 0.55, fontSize: FIELD_FONT, color: "var(--text-muted)", paddingBottom: 2 }}>
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
        {showUnit && <span style={{ fontSize: FIELD_FONT, color: "var(--text-faint)" }}>{unit}</span>}
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
          <span style={{ fontSize: FIELD_FONT, color: "var(--text-faint)", marginTop: 2, display: "block" }}>
            {targetProgress.met ? "✓ target met" : `target: ${targetProgress.target}${unit ? ` ${unit}` : ""}`}
          </span>
        </div>
      )}
    </div>
  );
}

export default React.memo(Field);
