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
import { createInstanceInContainer } from "../helpers/CommitHelpers";

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
  const { occurrencesById, modulesById, state: ctxState } = useContext(GridActionsContext);
  const { computedValues } = useContext(GridLiveContext);

  // Resolve dynamic options for pool-sourced selects and module-reference fields.
  const effectiveField = useMemo(() => {
    // Module reference field: build options from all (non-trashed) modules
    if (field?.type === "module") {
      let filtered = Object.values(modulesById || {}).filter(m => !m.trashed);
      if (field.meta?.roleFilter) {
        filtered = filtered.filter(m => m.role === field.meta.roleFilter);
      }
      const moduleOptions = filtered.map(m => ({ value: m.id, label: m.label || "Untitled" }));
      return { ...field, meta: { ...field.meta, _moduleOptions: moduleOptions } };
    }
    // Pool-sourced select fields
    if (field?.type !== "select" || field?.meta?.sourceType !== "pool") return field;
    const poolIds = field.meta.poolContainerIds || (field.meta.poolContainerId ? [field.meta.poolContainerId] : []);
    if (!poolIds.length) return field;
    // Build targetId → occurrence map once for O(1) lookups (avoids O(n) scan per pool)
    const byTargetId = Object.create(null);
    for (const occ of Object.values(occurrencesById)) {
      if (occ.targetId) byTargetId[occ.targetId] = occ;
    }
    const poolOptions = [];
    const seenModIds = new Set();
    for (const poolContainerId of poolIds) {
      const poolOcc = byTargetId[poolContainerId];
      const childOccIds = poolOcc?.occurrences || [];
      for (const occId of childOccIds) {
        const occ = occurrencesById[occId];
        const mod = modulesById[occ?.targetId];
        if (mod && !seenModIds.has(mod.id)) {
          seenModIds.add(mod.id);
          poolOptions.push({ value: mod.id, label: mod.label || mod.name || "Untitled" });
        }
      }
    }
    return { ...field, meta: { ...field.meta, options: poolOptions } };
  }, [field, occurrencesById, modulesById]);

  // Quick-add for pool-sourced fields: creates new instance in the first pool container
  const handlePoolAddOption = useCallback((label) => {
    if (!field?.meta?.poolContainerId && !field?.meta?.poolContainerIds?.length) return;
    const poolContainerId = field.meta.poolContainerId || field.meta.poolContainerIds[0];
    const gridId = ctxState?.grid?._id;
    const userId = ctxState?.userId;
    if (!gridId || !userId || !poolContainerId) return;
    createInstanceInContainer({
      dispatch, socket,
      containerId: poolContainerId,
      instance: { id: crypto.randomUUID(), role: "instance", kind: "list", label, userId, gridId, fieldBindings: [] },
      emit: true,
    });
  }, [field?.meta, ctxState, dispatch, socket]);

  // Determine field role — module.meta.disabled forces display-only
  const inputEnabled = !disabled && field.inputEnabled !== false && field.mode !== "derived";
  const displayEnabled = field.displayEnabled === true || field.mode === "derived";

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
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, fields: { ...((occurrence.fields) || {}), [field.id]: { value: newValue, flow } } },
      emit: true,
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

  const isPoolSourced = field?.meta?.sourceType === "pool";
  const onAddOption = isPoolSourced ? handlePoolAddOption : undefined;

  // Randomize: pick a random option from pool-sourced select
  const handleRandomize = useCallback(() => {
    const opts = effectiveField?.meta?.options;
    if (!opts?.length || !inputEnabled) return;
    const pick = opts[Math.floor(Math.random() * opts.length)];
    if (pick) handleCommit(pick.value);
  }, [effectiveField?.meta?.options, inputEnabled, handleCommit]);

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
    <div className={showDisplay ? "field-renderer-both" : undefined}>
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
          onAddOption={onAddOption}
          compact={compact}
          hideName={hideName}
          hidePrefix={hidePrefix}
          hidePostfix={hidePostfix}
        />
        {isPoolSourced && inputEnabled && (
          <button
            onClick={handleRandomize}
            title="Random"
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
