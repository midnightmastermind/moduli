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

import React, { useCallback, useContext, useMemo, useRef, useState, useEffect } from "react";
import Field from "./Field";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { GridActionsContext } from "../GridActionsContext";
import { GridLiveContext } from "../GridLiveContext";
import { resolveOptions } from "../helpers/optionsResolver";

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
  const { occurrencesById, modulesById, fieldsById, foldersById } = useContext(GridActionsContext);
  const { computedValues } = useContext(GridLiveContext);

  // Resolve dynamic options for select and occurrence fields via optionsResolver.
  // Pass the owner occurrence as $this so find-mode predicates can reference
  // sibling field values on the same instance (e.g. `$this.fields.type.value`).
  const { options: resolvedOptions, totalMatched } = useMemo(() => {
    if (field?.type !== "select" && field?.type !== "occurrence") return { options: [], totalMatched: 0 };
    return resolveOptions(field, { occurrencesById, modulesById, fieldsById, foldersById }, occurrence ?? null);
  }, [field, occurrencesById, modulesById, fieldsById, foldersById, occurrence]);

  // Expose resolved options under _resolvedOptions for select and occurrence fields.
  const effectiveField = useMemo(() => {
    if (field?.type !== "select" && field?.type !== "occurrence") return field;
    return { ...field, meta: { ...field.meta, _resolvedOptions: resolvedOptions, _totalMatched: totalMatched } };
  }, [field, resolvedOptions, totalMatched]);

  // Determine field role — module.meta.disabled forces display-only
  const inputEnabled = !disabled && field.inputEnabled !== false;
  const displayEnabled = field.displayEnabled === true;

  // Per-occurrence stored value + display flags
  const { value: inputValue, flow: currentFlow, hideName, hidePrefix, hidePostfix } = useMemo(() => {
    if (!occurrence?.fields || !field?.id) {
      return { value: undefined, flow: "in", hideName: false, hidePrefix: false, hidePostfix: false };
    }
    const stored = occurrence.fields[field.id];
    if (stored && typeof stored === "object" && "value" in stored) {
      return {
        value: stored.value,
        flow: stored.flow || "in",
        hideName: stored.hideName === true,
        hidePrefix: stored.hidePrefix === true,
        hidePostfix: stored.hidePostfix === true,
      };
    }
    return { value: stored, flow: field?.meta?.flow || "in", hideName: false, hidePrefix: false, hidePostfix: false };
  }, [occurrence?.fields, field?.id, field?.meta?.flow]);

  // Computed result from operation executor
  const computedResult = useMemo(() => {
    if (!field?.id || !displayEnabled) return undefined;
    const occKey = occurrence?.id ? `${field.id}:${occurrence.id}` : null;
    if (occKey && computedValues[occKey] !== undefined) return computedValues[occKey];
    return computedValues[field.id];
  }, [field?.id, displayEnabled, occurrence?.id, computedValues]);

  const computedValue = computedResult != null && typeof computedResult === "object" && "value" in computedResult
    ? computedResult.value : computedResult;
  const computedTarget = computedResult != null && typeof computedResult === "object"
    ? computedResult.target : null;

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
    const fullUpdatedOcc = {
      ...occurrence,
      fields: { ...(occurrence.fields || {}), [field.id]: { value: newValue, flow } },
    };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: fullUpdatedOcc,
      emit: true,
      triggerField: { fieldId: field.id, value: newValue, instanceId: occurrence.moduleId },
    });
  }, [occurrence, field?.id, currentFlow, field?.meta?.flow, inputEnabled, dispatch, socket]);

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

  // Randomize: pick a random option from any multi-option select
  function handleRandomize() {
    if (!resolvedOptions.length) return;
    const pick = resolvedOptions[Math.floor(Math.random() * resolvedOptions.length)];
    if (pick) handleCommit(pick.value);
  }

  // Display-only: no onCommit
  if (displayEnabled && !inputEnabled) {
    return (
      <div style={{ position: "relative", display: "inline-flex" }}>
        <Field
          field={effectiveField}
          binding={binding}
          value={displayValue}
          target={computedTarget}
          state={state}
          context={context}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
        />
        {delta && (
          <span
            key={delta.key}
            className={`delta-popup ${delta.positive ? "positive" : "negative"}`}
            style={{ right: 0, top: -2 }}
          >
            {delta.positive ? "+" : ""}{delta.diff % 1 === 0 ? delta.diff : delta.diff.toFixed(1)}
          </span>
        )}
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
        value={inputValue}
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
          value={displayValue}
          target={computedTarget}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
        />
      )}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        <Field
          field={effectiveField}
          binding={binding}
          value={inputValue}
          flow={currentFlow}
          onCommit={handleCommit}
          onFlowChange={handleFlowChange}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
        />
        {canRandomize && inputEnabled && (
          <button
            onClick={handleRandomize}
            title="Pick a random option"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--text-faint)", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
          >
            &#x1F3B2;
          </button>
        )}
      </div>
    </div>
  );
}

export default React.memo(FieldRenderer);
