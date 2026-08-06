// ui/FieldRenderer.jsx
// ============================================================
// Smart orchestrator: resolves values from store/socket, then
// renders <Field> for everything — display and input unified.
//
// Field.jsx handles all rendering. FieldRenderer handles:
// - Reading computedValues from context
// - Building onCommit / onFlowChange callbacks (socket)
// - Determining inputEnabled / displayEnabled from field schema
// ============================================================

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import Field from "./Field";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { useGridActionsSelector } from "../GridActionsContext";
import { bumpRender, useRenderAttribution } from "../helpers/renderProbe";
import { useComputedValueWithFallback } from "../state/computedValuesStore";
import { resolveOptions } from "../helpers/optionsResolver";
import { getEffectiveFilterForOccurrence } from "../state/selectors";
import { planPrefill, prefillFieldsPatch } from "../helpers/prefillFromPick";

function FieldRenderer({
  field,
  binding,
  occurrence,
  instance,
  context,
  state,
  dispatch,
  socket,
  compact = false,
  disabled = false,
}) {
  bumpRender("field");
  // Per-slice selectors instead of useGridActions() — the full-context
  // subscription re-rendered EVERY mounted FieldRenderer on every occurrence
  // write (part of the multi-second drop pause). occurrencesById (rebuilt per
  // write) is read at compute time via the non-subscribing getter; the option
  // pool re-resolves when the occurrence SET changes (create/delete), when the
  // field/meta or owner occurrence changes, or when this component re-renders
  // for any other reason. A field-value edit elsewhere that flips a find-mode
  // predicate refreshes on the next of those — the always-fresh recompute per
  // write was the render storm this replaces.
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const foldersById = useGridActionsSelector(s => s.foldersById);
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const occSetKey = useGridActionsSelector(s => (s.state.occurrences || []).length);

  // DIAG (window.__RENDER_ATTR): which input changed → this render.
  useRenderAttribution("field", {
    p_field: field, p_binding: binding, p_occurrence: occurrence,
    p_instance: instance, p_context: context, p_state: state,
    p_dispatch: dispatch, p_socket: socket, p_compact: compact, p_disabled: disabled,
    s_modulesById: modulesById, s_fieldsById: fieldsById, s_foldersById: foldersById,
    s_getOccMap: getOccMap, s_occSetKey: occSetKey,
  }, field?.name);

  // Resolve dynamic options for select and occurrence fields via optionsResolver.
  // Pass the owner occurrence as $this so find-mode predicates can reference
  // sibling field values on the same instance (e.g. `$this.fields.type.value`).
  // Also resolve for any field carrying `meta.randomizable === true` — the
  // display-only randomize button needs a candidate pool (e.g. journalQuestion
  // text field with an optionsSource.find).
  const { options: resolvedOptions, totalMatched } = useMemo(() => {
    const wantsResolve =
      field?.type === "select" ||
      field?.type === "occurrence" ||
      field?.meta?.randomizable === true;
    if (!wantsResolve) return { options: [], totalMatched: 0 };
    // occSetKey (occurrence count) is the reactive dep; the map is a fresh
    // read at compute time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return resolveOptions(field, { occurrencesById: getOccMap(), modulesById, fieldsById, foldersById }, occurrence ?? null);
  }, [field, occSetKey, getOccMap, modulesById, fieldsById, foldersById, occurrence]);

  // Expose resolved options under _resolvedOptions for select and occurrence
  // fields (other types don't render an options chooser so the meta isn't read).
  const effectiveField = useMemo(() => {
    if (field?.type !== "select" && field?.type !== "occurrence") return field;
    return { ...field, meta: { ...field.meta, _resolvedOptions: resolvedOptions, _totalMatched: totalMatched } };
  }, [field, resolvedOptions, totalMatched]);

  // Determine field role — module.meta.disabled forces display-only
  const inputEnabled = !disabled && field.inputEnabled !== false;
  const displayEnabled = field.displayEnabled === true;

  // Per-occurrence stored value + display flags
  // Task #60 — `field.meta.autoStampFromFilter: true` substitutes the
  // value from the occurrence's effective filter for this field when
  // the stored value is null/empty. Read-time only — no DB write. Lets
  // a date / timeslot field on a slot container show the current day-
  // filter's date without anyone having to stamp it. Container-level
  // only by convention (per "trust the cascade — don't pre-stamp" memory):
  // instances opting in here is allowed but unusual.
  const gridFilters = state?.grid?.activeFilterValues || null;
  // Auto-stamp source value — a dedicated REACTIVE selector (the effective-
  // filter walk reads ancestor occurrences, which the prop-driven memo below
  // can't see change). Returns the stored value ref / scalar, so Object.is
  // keeps it stable across unrelated writes. Null when the field doesn't
  // opt in — the selector then never re-renders this component.
  const autoStampFromFilter = useGridActionsSelector(s => {
    if (field?.meta?.autoStampFromFilter !== true || !occurrence) return null;
    const eff = getEffectiveFilterForOccurrence(occurrence, {
      grid: { activeFilterValues: gridFilters || {} },
      occurrencesById: s.occurrencesById,
    });
    return eff?.[field.id] ?? null;
  });
  const { value: inputValue, flow: currentFlow, hideName, hidePrefix, hidePostfix } = useMemo(() => {
    if (!occurrence?.fields || !field?.id) {
      return { value: undefined, flow: "in", hideName: false, hidePrefix: false, hidePostfix: false };
    }
    const stored = occurrence.fields[field.id];
    let value, flow = "in";
    if (stored && typeof stored === "object" && "value" in stored) {
      value = stored.value;
      flow = stored.flow || "in";
    } else {
      value = stored;
      flow = field?.meta?.flow || "in";
    }
    // Auto-stamp from filter when set + stored is empty.
    if ((value == null || value === "") && autoStampFromFilter != null && autoStampFromFilter !== "") {
      value = (typeof autoStampFromFilter === "object" && "value" in autoStampFromFilter)
        ? autoStampFromFilter.value
        : autoStampFromFilter;
    }
    return {
      value,
      flow,
      hideName: stored?.hideName === true,
      hidePrefix: stored?.hidePrefix === true,
      hidePostfix: stored?.hidePostfix === true,
    };
  }, [occurrence, autoStampFromFilter, field?.id, field?.meta?.flow]);

  // Computed result from operation executor — per-key subscription: this
  // component re-renders ONLY when its own entry changes, not on every
  // SET_COMPUTED_VALUES batch (which used to re-render every mounted field).
  const wantsComputed = !!field?.id && displayEnabled;
  const computedResult = useComputedValueWithFallback(
    wantsComputed && occurrence?.id ? `${field.id}:${occurrence.id}` : null,
    wantsComputed ? field.id : null
  );

  // DIAG (window.__RENDER_ATTR): late-stage inputs (per-key store + memos).
  useRenderAttribution("field-late", { computedResult }, field?.name);

  const computedValue = computedResult != null && typeof computedResult === "object" && "value" in computedResult
    ? computedResult.value : computedResult;
  const computedTarget = computedResult != null && typeof computedResult === "object"
    ? computedResult.target : null;
  // Display-rule outputs (color / icon / suffix / replaceValue) ride
  // alongside the value on the computed-value slot when the pipeline
  // had a $displayRules match for this occurrence. All nullable.
  const computedDisplayRule = useMemo(() => {
    if (!computedResult || typeof computedResult !== "object") return null;
    const { color, icon, suffix, replaceValue } = computedResult;
    if (color == null && icon == null && suffix == null && replaceValue == null) return null;
    return { color, icon, suffix, replaceValue };
  }, [computedResult]);

  const displayValue = displayEnabled ? (computedValue ?? inputValue) : inputValue;

  // TN4 — Delta indicator: track previous displayValue and show floating +/- popup on change
  const prevDisplayRef = useRef(undefined);
  const [delta, setDelta] = useState(null);
  useEffect(() => {
    if (!displayEnabled) { prevDisplayRef.current = displayValue; return; }
    const prev = prevDisplayRef.current;
    if (prev !== undefined && displayValue !== prev && typeof displayValue === "number" && typeof prev === "number") {
      const diff = displayValue - prev;
      if (diff !== 0) {
        setDelta({ diff, positive: diff > 0, key: Date.now() });
        const t = setTimeout(() => setDelta(null), 2600);
        prevDisplayRef.current = displayValue;
        return () => clearTimeout(t);
      }
    }
    prevDisplayRef.current = displayValue;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue]);

  // Commit callback (only provided when inputEnabled)
  const handleCommit = useCallback((newValue, flowOverride) => {
    if (!occurrence?.id || !field?.id || !inputEnabled) return;
    const flow = flowOverride || currentFlow || field?.meta?.flow || "in";
    // Build full updated occurrence so localOccsById has the new value before executor runs
    const nextFields = { ...(occurrence.fields || {}), [field.id]: { value: newValue, flow } };

    // PREFILL: picking an occurrence fills the fields that pick implies —
    // an ingredient brings its macros, a meal brings its ingredients AND their
    // summed macros (helpers/prefillFromPick owns the decision; the config is
    // per-field data). The fills are merged into THIS write rather than sent
    // after it: the target is the occurrence being edited, so a pick and its
    // fills are one socket write, one server round-trip, and — because
    // `withAction` groups a single call — ONE undo step. That grouping is not
    // cosmetic here: a pick always overwrites, so undo is the only way back to
    // a value it replaced.
    const { writes } = planPrefill({
      field,
      value: newValue,
      target: { ...occurrence, fields: nextFields },
      ctx: { occurrencesById: getOccMap(), modulesById, fieldsById },
    });
    if (writes.length) Object.assign(nextFields, prefillFieldsPatch(writes));

    const fullUpdatedOcc = { ...occurrence, fields: nextFields };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: fullUpdatedOcc,
      emit: true,
      // One trigger per field the write actually changed — a filled Protein has
      // to move the day's Protein tracker exactly as a typed one does.
      triggerField: [
        { fieldId: field.id, value: newValue, instanceId: occurrence.moduleId },
        ...writes.map(w => ({ fieldId: w.fieldId, value: w.value, instanceId: occurrence.moduleId })),
      ],
    });
  }, [occurrence, field, currentFlow, inputEnabled, dispatch, socket, getOccMap, modulesById, fieldsById]);

  const handleFlowChange = useCallback((newFlow) => {
    if (!occurrence?.id || !field?.id || !inputEnabled) return;
    const stored = occurrence.fields?.[field.id];
    const currentValue = stored && typeof stored === "object" && "value" in stored ? stored.value : stored;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, fields: { ...((occurrence.fields) || {}), [field.id]: { value: currentValue, flow: newFlow } } },
      emit: true,
    });
  }, [occurrence, field?.id, inputEnabled, dispatch, socket]);

  if (!field) return null;

  const canRandomize = (field?.type === "select" || field?.type === "occurrence") && resolvedOptions.length > 1;
  // Display-only randomize: any field carrying `meta.randomizable === true` +
  // having an optionsSource.find that resolves to >1 candidates. Powers the
  // Daily Question 🎲 button — the journalQuestion text field is display-only
  // but should still be re-rollable from the questions library.
  const canRandomizeDisplay = field?.meta?.randomizable === true && resolvedOptions.length > 1;

  // Randomize for display-only fields: writes directly via updateOccurrence
  // (handleCommit isn't wired for the display-only branch — input-side only).
  // Uses `triggerField` so any downstream ops listening for journalQuestion
  // changes still fire as if a user edited it.
  function handleRandomizeDisplay() {
    if (!resolvedOptions.length || !occurrence?.id || !field?.id) return;
    const pick = resolvedOptions[Math.floor(Math.random() * resolvedOptions.length)];
    if (!pick) return;
    const stored = occurrence.fields?.[field.id];
    const flow = (stored && typeof stored === "object" && "flow" in stored) ? stored.flow : "in";
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: occurrence.id,
        fields: { ...(occurrence.fields || {}), [field.id]: { value: pick.value, flow } },
      },
      emit: true,
      triggerField: { fieldId: field.id, value: pick.value, instanceId: occurrence.moduleId },
    });
  }

  // Display-only: no onCommit. Wrap in the SAME column-flex shell as the
  // input branch below so a display field (e.g. Daily Journal's
  // `journalQuestion`) sits on the same baseline as sibling input fields
  // (checkbox / duration / answer). Previously the display-only branch used
  // a bare row inline-flex which read as a vertically misaligned pill next
  // to the column-stacked input renderers.
  if (displayEnabled && !inputEnabled) {
    return (
      <div style={{ display: "inline-flex", justifyContent: "start", flexDirection: "column", alignItems: "flex-start" }}>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Field
            field={effectiveField}
            binding={binding}
            hostOccurrence={occurrence}
            value={displayValue}
            target={computedTarget}
            displayRule={computedDisplayRule}
            state={state}
            context={context}
            compact={compact}
            hideName={hideName}
            hidePrefix={hidePrefix}
            hidePostfix={hidePostfix}
          />
          {canRandomizeDisplay && (
            <button
              onClick={handleRandomizeDisplay}
              title={`Pick a random ${field?.name || "value"}`}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--text-faint)", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              &#x1F3B2;
            </button>
          )}
          {delta && (
            // THE one transient +N/−N badge (Field.jsx's duplicate DeltaBadge
            // was removed 2026-07-13 — the plus showed twice). Absolute
            // superscript at the value's top right; color marks the GOOD
            // direction per the field's flow (flow:"out" countdowns show a
            // −1 as green progress, not red).
            <span
              key={delta.key}
              className={`delta-popup ${((field?.meta?.flow || "in") === "out" ? delta.diff < 0 : delta.diff > 0) ? "positive" : "negative"}`}
              style={{ right: 0, top: -2 }}
            >
              {delta.positive ? "+" : ""}{delta.diff % 1 === 0 ? delta.diff : delta.diff.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Input role only
  const role = binding?.role || "input";

  if (role === "display") {
    return (
      <Field
        field={effectiveField}
        binding={binding}
        hostOccurrence={occurrence}
        value={inputValue}
        displayRule={computedDisplayRule}
        compact={compact}
        hideName={hideName}
        hidePrefix={hidePrefix}
        hidePostfix={hidePostfix}
      />
    );
  }

  // Input (or both input+display)
  const showDisplay = displayEnabled || role === "both";

  return (
    <div style={{ display: "inline-flex", justifyContent: "start", flexDirection: "column"}} className={showDisplay ? "field-renderer-both" : undefined}>
      {showDisplay && (
        <Field
          field={effectiveField}
          binding={binding}
          hostOccurrence={occurrence}
          value={displayValue}
          target={computedTarget}
          displayRule={computedDisplayRule}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
        />
      )}
      <div style={{ display: "inline-flex", alignItems: "stretch", gap: 0 }}>
        <Field
          field={effectiveField}
          binding={binding}
          hostOccurrence={occurrence}
          value={inputValue}
          flow={currentFlow}
          onCommit={handleCommit}
          onFlowChange={handleFlowChange}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
          // Both select AND occurrence fields render the randomize dice INSIDE
          // the pill border (Field owns it). canRandomize is only ever true for
          // those two types, so there's no longer an appended side-segment.
          randomize={canRandomize && inputEnabled}
        />
      </div>
    </div>
  );
}

export default React.memo(FieldRenderer);
