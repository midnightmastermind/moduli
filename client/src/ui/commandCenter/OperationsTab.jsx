// ui/commandCenter/OperationsTab.jsx
// OperationsTab + OperationPill + OperationEditor + TriggerDataHint + OpItem + getTriggerVars

import React, { useState, useMemo, useContext, useEffect, useRef, useCallback } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Plus, FolderPlus, ChevronLeft, GripVertical, Trash2, Play } from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import { uid } from "../../uid";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { PipelineEditor } from "../../blocks";
import { executePipeline } from "../../helpers/operationExecutor";
import Field from "../Field";
import OperationLogPanel from "./OperationLogPanel";

// Shared style helpers
const labelStyle = {
  fontSize: 10,
  color: "var(--text-muted)",
  fontFamily: "monospace",
  display: "block",
  marginBottom: 3,
};

const inputStyle = {
  height: 28,
  fontSize: 11,
  fontFamily: "monospace",
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 5,
  color: "var(--text-primary)",
  padding: "0 8px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// Event types — WHAT happened
const EVENT_TYPES = [
  { value: "onChange",       label: "On Change",        desc: "Fires when a value or property changes" },
  { value: "onFieldChange",  label: "On Field Change",  desc: "Fires when a field value changes (alias of onChange, respects allowedFields)" },
  { value: "onAdd",          label: "On Add",           desc: "Fires when something is added or created" },
  { value: "onRemove",       label: "On Remove",        desc: "Fires when something is removed from a parent" },
  { value: "onDelete",       label: "On Delete",        desc: "Fires when something is permanently deleted" },
  { value: "onMove",         label: "On Move",          desc: "Fires when something is moved between parents" },
  { value: "onReorder",      label: "On Reorder",       desc: "Fires when something is reordered within a parent" },
  { value: "onComplete",     label: "On Complete",      desc: "Fires when a module or field reaches a done state" },
  { value: "onUncomplete",   label: "On Uncomplete",    desc: "Fires when a completion is reversed" },
  { value: "onLoad",         label: "On Load",          desc: "Fires once when the grid loads" },
  { value: "onFilterChange", label: "On Filter Change", desc: "Fires when the date filter nav or named filter changes" },
  { value: "onSchedule",     label: "On Schedule",      desc: "Fires at a specific time (cron)" },
  { value: "onWebhook",      label: "On Webhook",       desc: "Fires via HTTP POST to the webhook URL" },
  { value: "onButton",       label: "On Button",        desc: "Fires when the operation trigger button is pressed" },
  { value: "onNodeInput",    label: "On Node Input",    desc: "Fires when a local field input on the operation node changes or Run is clicked" },
  { value: "manual",         label: "Manual",           desc: "Only runs when manually triggered from UI" },
];

// Subject types — WHAT KIND of entity the event is about
const SUBJECT_TYPES = [
  { value: "module",      label: "Module",      desc: "Any panel, container, or instance",  roles: ["panel","container","instance"] },
  { value: "field",       label: "Field",        desc: "A field value on a module" },
  { value: "grid",        label: "Grid",         desc: "The workspace grid" },
  { value: "filterNav",   label: "Filter Nav",   desc: "A date filter navigation event" },
  { value: "view",        label: "View",         desc: "A view / rendering config" },
  { value: "style",       label: "Style",        desc: "A style property change" },
  { value: "template",    label: "Template",     desc: "A saved template being applied" },
  { value: "transaction", label: "Transaction",  desc: "An audit-trail transaction" },
  { value: "folder",      label: "Folder",       desc: "A manifest folder" },
];

// $trigger.* variables inferred from (eventType, subjectType)
export function getTriggerVars(eventType, subjectType) {
  const base = [];
  if (subjectType === "module") {
    base.push("$trigger.moduleId", "$trigger.role", "$trigger.kind", "$trigger.label");
    if (eventType === "onChange")  base.push("$trigger.changedField", "$trigger.value", "$trigger.previousValue");
    if (eventType === "onAdd" || eventType === "onRemove") base.push("$trigger.parentId");
    if (eventType === "onMove")    base.push("$trigger.fromParentId", "$trigger.toParentId");
    if (eventType === "onComplete") base.push("$trigger.fieldId", "$trigger.value");
  } else if (subjectType === "field") {
    base.push("$trigger.fieldId", "$trigger.moduleId", "$trigger.value", "$trigger.previousValue", "$trigger.flow");
  } else if (subjectType === "grid") {
    base.push("$trigger.gridId");
  } else if (subjectType === "filterNav") {
    base.push("$trigger.iterationId", "$trigger.iterationValue", "$trigger.categoryValue", "$trigger.previousValue");
  } else if (subjectType === "transaction") {
    base.push("$trigger.transactionId", "$trigger.transactionType", "$trigger.moduleId");
  }
  base.push("$trigger.userId", "$trigger.timestamp");
  return base;
}


// ============================================================
// OP ITEM (Pragmatic DnD draggable — drag to instance to add operationBinding)
// ============================================================
export function OpItem({ op, selected, onClick, onPreview, isDuplicate = false, onPriorityChange }) {
  const ref = useRef(null);
  const { state, fieldsById, occurrencesById } = useContext(GridActionsContext);

  // Detect localField sources with nodeInput: true
  const nodeInputSources = useMemo(() =>
    (op.pipeline?.sources || []).filter(s => s.entityType === "localField" && s.nodeInput && s.entityId),
    [op.pipeline?.sources]
  );

  // Transient node input values — reset when component unmounts (CC closes)
  const [nodeInputValues, setNodeInputValues] = useState({});
  const [nodeDisplayRows, setNodeDisplayRows] = useState([]);

  const handleNodeInputCommit = useCallback((variableName, value) => {
    setNodeInputValues(prev => ({ ...prev, [variableName]: value }));
  }, []);

  const handleRun = useCallback((e) => {
    e.stopPropagation();
    if (!op.pipeline) return;
    const context = {
      state,
      fieldsById: fieldsById || {},
      occurrencesById: occurrencesById || {},
      operationsById: {},
    };
    const syntheticTrigger = { type: "nodeInput", timestamp: Date.now() };
    const results = executePipeline(op, context, syntheticTrigger, nodeInputValues);
    // Handle DISPLAY_LOCAL_FIELDS effects
    for (const r of results) {
      if (r._effect === "DISPLAY_LOCAL_FIELDS") {
        setNodeDisplayRows(r.rows || []);
      }
    }
  }, [op, state, fieldsById, occurrencesById, nodeInputValues]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "operation",
        id: op.id,
        data: op,
        sourceType: "command-center",
      }),
    });
  }, [op]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      title={`${op.name} — drag to instance to add as runnable widget`}
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "4px 8px", borderRadius: 5, cursor: "grab",
        background: selected ? "var(--accent-purple-bg)" : "var(--input-bg)",
        border: `1px solid ${selected ? "var(--accent-purple-border)" : "var(--border-subtle)"}`,
        fontSize: 11, fontFamily: "monospace", userSelect: "none",
      }}
    >
      {/* Header row: grip + name + priority + preview/run button */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <GripVertical style={{ width: 8, height: 8, opacity: 0.3, flexShrink: 0 }} />
        <span style={{ color: op.enabled ? "rgb(196,181,253)" : "var(--text-faint)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {op.name}
        </span>
        {isDuplicate && (
          <span title="Another operation uses the same trigger + target field" style={{ fontSize: 9, color: "rgba(251,146,60,0.9)", flexShrink: 0 }}>⚠</span>
        )}
        {onPriorityChange && (
          <select
            value={op.priority ?? 5}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); onPriorityChange(Number(e.target.value)); }}
            title="Priority — lower runs first (1 = highest)"
            style={{
              fontSize: 9, fontFamily: "monospace",
              background: "var(--input-bg)", color: "var(--text-muted)",
              border: "1px solid var(--input-border)", borderRadius: 3,
              padding: "0 2px", height: 16, cursor: "pointer", flexShrink: 0,
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>P{n}</option>
            ))}
          </select>
        )}
        {nodeInputSources.length > 0 ? (
          <button
            onClick={handleRun}
            style={{ background: "var(--accent-green-bg)", border: "1px solid var(--accent-green-border)", borderRadius: 3, cursor: "pointer", color: "var(--accent-green-text)", padding: "1px 6px", fontSize: 9 }}
            title="Run with node inputs"
          >
            Run
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0 }}
            title="Preview operation"
          >
            <Play style={{ width: 8, height: 8 }} />
          </button>
        )}
      </div>

      {/* Node input fields */}
      {nodeInputSources.length > 0 && (
        <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 13 }}>
          {nodeInputSources.map(src => {
            const field = fieldsById?.[src.entityId];
            if (!field) return null;
            return (
              <div key={src.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>{src.variableName}</span>
                <Field
                  field={field}
                  value={nodeInputValues[src.variableName]}
                  onCommit={(val) => handleNodeInputCommit(src.variableName, val)}
                  compact
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Display rows from DISPLAY_LOCAL_FIELDS */}
      {nodeDisplayRows.length > 0 && (
        <div onClick={e => e.stopPropagation()} style={{ paddingLeft: 13, borderTop: "1px solid var(--border-subtle)", paddingTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
          {nodeDisplayRows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
              <span style={{ color: "var(--text-muted)" }}>{row.label}:</span>
              <span style={{ color: "var(--accent-green-text)", fontWeight: 600 }}>{row.value == null ? "—" : String(row.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// OPERATION PILL (click-only — no drag-to-grid; sort-only within columns)
// ============================================================
export function OperationPill({ op, selected, onClick, onRun, onToggleEnabled }) {
  const isEnabled = op.enabled !== false;
  const triggerLabel = (() => {
    const types = Array.isArray(op.triggerTypes) ? op.triggerTypes : [op.triggerType].filter(Boolean);
    if (types.length === 0) return "manual";
    const short = { onChange: "Δ", onDrop: "↓", onCreate: "+", onDelete: "✕", onMove: "→", onComplete: "✓", onModuleUpdate: "M↑", onFilterChange: "⟳", onIteration: "⟳", onLoad: "⬛", onWebhook: "⚡", manual: "▶" };
    return types.map(t => short[t] || t).join("+");
  })();

  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px 3px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: "monospace",
        cursor: "pointer",
        transition: "all 0.15s",
        userSelect: "none",
        background: selected ? "var(--accent-green-bg)" : isEnabled ? "var(--accent-green-bg)" : "var(--input-bg)",
        border: `1px solid ${selected ? "var(--accent-green-border)" : isEnabled ? "var(--accent-green-border)" : "var(--border-default)"}`,
        color: isEnabled ? "var(--accent-green-text)" : "var(--text-faint)",
        outline: "none",
        opacity: isEnabled ? 1 : 0.7,
      }}
    >
      {/* Enabled/disabled toggle dot */}
      <span
        onClick={onToggleEnabled}
        title={isEnabled ? "Active — click to disable" : "Disabled — click to enable"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: isEnabled ? "rgb(52,211,153)" : "var(--border-default)",
          border: isEnabled ? "none" : "1px solid var(--border-default)",
          flexShrink: 0,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      />
      <span>{op.name || "Untitled"}</span>
      {/* Trigger type badge */}
      <span style={{
        fontSize: 9, padding: "0 4px", borderRadius: 3,
        background: "var(--border-subtle)", color: "var(--text-faint)",
      }}>
        {triggerLabel}
      </span>
      {/* Run button */}
      <span
        onClick={onRun}
        title="Run now"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%",
          background: "var(--accent-green-bg)", color: "var(--accent-green-text)",
          marginLeft: 1, cursor: "pointer",
        }}
      >
        <Play style={{ width: 8, height: 8 }} />
      </span>
    </button>
  );
}

// ============================================================
// TRIGGER DATA HINT — shows $trigger.* properties for a trigger type
// ============================================================
export function TriggerDataHint({ eventType, subjectType }) {
  const vars = getTriggerVars(eventType, subjectType);
  if (!vars.length) return null;
  return (
    <div style={{
      fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)",
      padding: "3px 6px", lineHeight: 1.6,
    }}>
      <span style={{ color: "var(--text-muted)" }}>$trigger: </span>
      {vars.join(" · ")}
    </div>
  );
}

// ============================================================
// OPERATION EDITOR
// ============================================================
export function OperationEditor({ operation, fields, onSave, onDelete, onRun, categoryFolders = [], isDuplicate = false }) {
  const { modulesById, occurrencesById, fieldsById, operationsById, roleByModuleId } = useContext(GridActionsContext);
  const [local, setLocal] = useState(operation);
  useMemo(() => setLocal(operation), [operation?.id]);

  // triggerObjects is authoritative. triggerTypes is a derived index for dispatch.
  // Migrate older ops (triggerObjects null/missing) by deriving from triggerTypes/triggerType
  // so the Triggers section never renders empty when the op clearly has triggers wired up.
  const triggerObjects = useMemo(() => {
    if (Array.isArray(local.triggerObjects)) return local.triggerObjects;
    const types = Array.isArray(local.triggerTypes)
      ? local.triggerTypes
      : (local.triggerType ? [local.triggerType] : []);
    return types
      .filter(t => t && t !== "manual")
      .map(eventType => {
        if (eventType === "onLoad") return { eventType, subjectType: "grid", targetId: "" };
        if (eventType === "onFilterChange") return { eventType, subjectType: "filterNav", targetId: "" };
        return { eventType, subjectType: "field", targetId: "" };
      });
  }, [local.triggerObjects, local.triggerTypes, local.triggerType]);

  const setTriggerConfig = (triggerKey, patch) =>
    setLocal(p => ({
      ...p,
      triggerConfig: {
        ...(p.triggerConfig || {}),
        [triggerKey]: { ...(p.triggerConfig?.[triggerKey] || {}), ...patch },
      },
    }));

  const commitTriggerObjects = (next) => {
    const uniqueTypes = [...new Set(next.map(t => t?.eventType).filter(Boolean))];
    setLocal(p => ({
      ...p,
      triggerObjects: next,
      triggerTypes: uniqueTypes,
      triggerType: uniqueTypes[0] || "manual",
    }));
  };

  const addTriggerObject = (eventType = "onChange") => {
    const defaults = eventType === "onLoad" || eventType === "onFilterChange"
      ? { eventType, subjectType: eventType === "onLoad" ? "grid" : "filterNav", targetId: "" }
      : { eventType, subjectType: "field", targetId: "" };
    commitTriggerObjects([...triggerObjects, defaults]);
  };

  const updateTriggerObject = (idx, patch) => {
    const next = triggerObjects.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    commitTriggerObjects(next);
  };

  const removeTriggerObject = (idx) => {
    commitTriggerObjects(triggerObjects.filter((_, i) => i !== idx));
  };

  const hasOnLoad = triggerObjects.some(t => t.eventType === "onLoad");
  const toggleOnLoad = () => {
    if (hasOnLoad) {
      commitTriggerObjects(triggerObjects.filter(t => t.eventType !== "onLoad"));
    } else {
      commitTriggerObjects([...triggerObjects, { eventType: "onLoad", subjectType: "grid", targetId: "" }]);
    }
  };

  // Container + panel options for onDrop config
  const getRole = useCallback((m) => roleByModuleId?.[m.id] || m.role || "instance", [roleByModuleId]);
  const allContainers = useMemo(() => Object.values(modulesById || {}).filter(m => getRole(m) === "container"), [modulesById, getRole]);
  const allPanels = useMemo(() => Object.values(modulesById || {}).filter(m => getRole(m) === "panel"), [modulesById, getRole]);

  if (!local) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {isDuplicate && (
        <div style={{ padding: "5px 9px", borderRadius: 5, background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", fontSize: 10, fontFamily: "monospace", color: "rgba(251,146,60,0.9)" }}>
          ⚠ Another operation uses the same trigger type and target field. Both may fire and conflict.
        </div>
      )}
      {/* Row 1: Name + enabled */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 120px" }}>
          <span style={labelStyle}>Name</span>
          <input
            value={local.name || ""}
            onChange={(e) => setLocal((p) => ({ ...p, name: e.target.value }))}
            style={inputStyle}
          />
        </div>
        {categoryFolders.length > 0 && (
          <div>
            <span style={labelStyle}>Category</span>
            <select
              value={local.folderId || ""}
              onChange={(e) => setLocal((p) => ({ ...p, folderId: e.target.value || null }))}
              style={{ ...inputStyle, width: "auto", minWidth: 110 }}
            >
              <option value="">Uncategorized</option>
              {categoryFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Triggers ── */}
      <div>
        <span style={labelStyle}>Triggers</span>
        {/* On Load switch — quick toggle for the no-subject "fire on grid open" case */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "4px 8px", borderRadius: 5, background: "var(--input-bg)", border: "1px solid var(--border-subtle)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", flex: 1 }}>
            <span
              onClick={toggleOnLoad}
              style={{
                display: "inline-block", width: 28, height: 14, borderRadius: 7, cursor: "pointer",
                background: hasOnLoad ? "rgb(52,211,153)" : "var(--border-default)",
                position: "relative", transition: "background 0.15s",
              }}
            >
              <span style={{
                position: "absolute", top: 2, left: hasOnLoad ? 14 : 2,
                width: 10, height: 10, borderRadius: "50%", background: "#fff",
                transition: "left 0.15s",
              }} />
            </span>
            Run on load
          </label>
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>fires once when grid opens</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {triggerObjects.map((trigObj, idx) => {
            if (trigObj.eventType === "onLoad") return null;
            const eventType = trigObj.eventType || "onChange";
            const subjectType = trigObj.subjectType || "field";
            const subjectRole = trigObj.subjectRole || "";
            const targetId = trigObj.targetId || "";
            const entitiesForSubject = subjectType === "module"
              ? (subjectRole ? Object.values(modulesById || {}).filter(m => getRole(m) === subjectRole) : Object.values(modulesById || {}))
              : subjectType === "field" ? fields
              : subjectType === "filterNav" ? []
              : [];
            // English readout: "onChange · Field · Water"
            const subjectLabel = subjectType === "field" ? "Field"
              : subjectType === "filterNav" ? "Filter"
              : subjectType === "grid" ? "Grid"
              : subjectRole ? subjectRole.charAt(0).toUpperCase() + subjectRole.slice(1)
              : "Module";
            const targetLabel = !targetId ? "Any"
              : subjectType === "field" ? (fieldsById?.[targetId]?.name ?? targetId.slice(-6))
              : (modulesById?.[targetId]?.label ?? targetId.slice(-6));
            return (
              <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)", borderRadius: 5, padding: "6px 8px" }}>
                {/* Event type */}
                <select
                  value={eventType}
                  title="Event type"
                  onChange={e => updateTriggerObject(idx, { eventType: e.target.value })}
                  style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                >
                  {EVENT_TYPES.filter(et => et.value !== "onLoad").map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
                </select>
                {/* Subject type */}
                <select
                  value={subjectType}
                  title="What kind of thing"
                  onChange={e => updateTriggerObject(idx, { subjectType: e.target.value, subjectRole: "", targetId: "" })}
                  style={{ ...inputStyle, width: "auto", minWidth: 90, fontSize: 10 }}
                >
                  {SUBJECT_TYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>
                {/* Role filter for modules */}
                {subjectType === "module" && (
                  <select
                    value={subjectRole}
                    title="Module role"
                    onChange={e => updateTriggerObject(idx, { subjectRole: e.target.value, targetId: "" })}
                    style={{ ...inputStyle, width: "auto", minWidth: 90, fontSize: 10 }}
                  >
                    <option value="">Any role</option>
                    <option value="panel">Panel</option>
                    <option value="container">Container</option>
                    <option value="instance">Instance</option>
                  </select>
                )}
                {/* Field filter for onChange + field */}
                {subjectType === "field" && (
                  <select
                    value={targetId}
                    title="Specific field"
                    onChange={e => updateTriggerObject(idx, { targetId: e.target.value })}
                    style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                  >
                    <option value="">Any field</option>
                    {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
                {/* Specific entity picker (module) */}
                {subjectType === "module" && entitiesForSubject.length > 0 && (
                  <select
                    value={targetId}
                    title="Specific module (optional)"
                    onChange={e => updateTriggerObject(idx, { targetId: e.target.value })}
                    style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                  >
                    <option value="">Any {subjectRole || "module"}</option>
                    {entitiesForSubject.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                  </select>
                )}
                {/* Inline English readout */}
                <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", marginLeft: 4 }}>
                  {eventType} · {subjectLabel} · {targetLabel}
                </span>
                {/* Remove trigger */}
                <button
                  onClick={() => removeTriggerObject(idx)}
                  style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, marginLeft: "auto" }}
                  title="Remove trigger"
                >×</button>
                {/* $trigger var hints */}
                <TriggerDataHint eventType={eventType} subjectType={subjectType} />
                {/* Schedule time picker — onSchedule semantics still live in triggerConfig (no subject/target) */}
                {eventType === "onSchedule" && (
                  <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>time:</span>
                    <input
                      type="number"
                      min={0} max={23}
                      value={local.triggerConfig?.onSchedule?.hour ?? ""}
                      onChange={e => setTriggerConfig("onSchedule", { hour: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="HH"
                      style={{ ...inputStyle, width: 40, fontSize: 10, textAlign: "center" }}
                    />
                    <span style={{ color: "var(--text-muted)" }}>:</span>
                    <input
                      type="number"
                      min={0} max={59}
                      value={local.triggerConfig?.onSchedule?.minute ?? ""}
                      onChange={e => setTriggerConfig("onSchedule", { minute: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="MM"
                      style={{ ...inputStyle, width: 40, fontSize: 10, textAlign: "center" }}
                    />
                    <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>24h (leave blank = fire every minute)</span>
                  </div>
                )}
                {/* Webhook URL */}
                {eventType === "onWebhook" && (
                  <div style={{ width: "100%", fontSize: 9, fontFamily: "monospace", padding: "3px 6px", borderRadius: 4, background: "var(--accent-purple-bg)", color: "var(--accent-purple-text)", wordBreak: "break-all", userSelect: "all" }}>
                    POST: {`${window.location.origin}/api/webhooks/${local.id}`}
                  </div>
                )}
              </div>
            );
          })}
          {/* Add trigger button */}
          <button
            onClick={() => addTriggerObject("onChange")}
            style={{ alignSelf: "flex-start", padding: "3px 10px", borderRadius: 5, fontSize: 10, fontFamily: "monospace", cursor: "pointer", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)" }}
          >
            + Add Trigger
          </button>
        </div>
      </div>

      {/* Pipeline editor (Sources + Steps) */}
      <PipelineEditor
        pipeline={local.pipeline || { sources: [], steps: [] }}
        onChange={(pipeline) => setLocal(p => ({ ...p, pipeline }))}
        fields={fields}
        fieldsById={fieldsById || {}}
        modulesById={modulesById || {}}
        occurrencesById={occurrencesById || {}}
        operationsById={operationsById || {}}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onSave(local)}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
            color: "var(--accent-blue-text)", cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={onRun}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--accent-purple-bg)", border: "1px solid var(--accent-purple-border)",
            color: "var(--accent-purple-text)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
          title="Preview trigger data and steps structure"
        >
          <Play style={{ width: 10, height: 10 }} />
          Preview
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
            color: "var(--danger-text)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <Trash2 style={{ width: 10, height: 10 }} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================
// OPERATIONS TAB — pills in a wrapping flex row
// ============================================================
export function OperationsTab() {
  const ctx = useContext(GridActionsContext);
  const { state, operationsById, foldersById, fieldsById, socket, dispatch } = ctx;
  const gridId = state?.gridId;

  const gridOperations = useMemo(
    () => (state?.operations || [])
      .filter((o) => o.gridId === gridId)
      .sort((a, b) => (a.sortOrder ?? 50) - (b.sortOrder ?? 50)),
    [state?.operations, gridId]
  );

  const gridFields = useMemo(
    () => (state?.fields || []).filter((f) => f.gridId === gridId),
    [state?.fields, gridId]
  );

  const categoryFolders = useMemo(
    () => Object.values(foldersById || {})
      .filter((f) => f.gridId === gridId && f.folderType === "category")
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [foldersById, gridId]
  );

  const opsByFolder = useMemo(() => {
    const groups = { uncategorized: [] };
    for (const f of categoryFolders) groups[f.id] = [];
    for (const op of gridOperations) {
      const key = op.folderId && groups[op.folderId] !== undefined ? op.folderId : "uncategorized";
      groups[key].push(op);
    }
    return groups;
  }, [gridOperations, categoryFolders]);

  // Detect duplicate operations: same triggerType + same SHOW_VALUE targetFieldId
  const duplicateOpIds = useMemo(() => {
    const seen = {};
    const dupes = new Set();
    for (const op of gridOperations) {
      const trigger = op.triggers?.[0]?.triggerType || op.triggerType;
      const showStep = op.pipeline?.steps?.find(s => s.type === "action" && s.config?.type === "SHOW_VALUE");
      const fieldId = showStep?.config?.targetFieldId;
      if (!trigger || !fieldId) continue;
      const key = `${trigger}:${fieldId}`;
      if (seen[key]) { dupes.add(seen[key]); dupes.add(op.id); }
      else seen[key] = op.id;
    }
    return dupes;
  }, [gridOperations]);

  const [selectedOpId, setSelectedOpId] = useState(null);
  const selectedOp = selectedOpId ? operationsById?.[selectedOpId] : null;
  const [dragOpId, setDragOpId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const [previewOp, setPreviewOp] = useState(null);

  // Track Pragmatic DnD op drags so column HTML5 onDrop can read the dragged op
  useEffect(() => {
    return monitorForElements({
      onDragStart({ source }) {
        if (source.data?.type === "operation") setDragOpId(source.data.id);
      },
      onDrop() { setDragOpId(null); setOverColumn(null); },
    });
  }, []);

  const handleCreate = (folderId = null) => {
    const newOp = { id: uid(), gridId, name: "New Operation", description: "", pipeline: { sources: [], steps: [] }, triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "" }], triggerTypes: ["onLoad"], triggerType: "onLoad", enabled: true, sortOrder: gridOperations.length, priority: 5, folderId };
    CommitHelpers.createOperation({ dispatch, socket, operation: newOp });
    setSelectedOpId(newOp.id);
  };

  const handleCreateCategory = () => {
    const folder = { id: uid(), gridId, name: "New Category", folderType: "category", sortOrder: categoryFolders.length, isExpanded: true };
    CommitHelpers.createFolder({ dispatch, socket, folder });
  };

  const handleDropOnFolder = (folderId) => {
    if (!dragOpId) return;
    const op = operationsById?.[dragOpId];
    if (op) CommitHelpers.updateOperation({ dispatch, socket, operation: { ...op, folderId: folderId || null } });
    setDragOpId(null);
    setOverColumn(null);
  };

  // Run = preview only — shows trigger data + steps structure without executing
  const handleRun = useCallback((op) => {
    if (!op) return;
    setPreviewOp(op);
  }, []);

  const toggleSelect = (opId) => setSelectedOpId((prev) => (prev === opId ? null : opId));

  const colStyle = (isOver) => ({
    minWidth: 160, flex: "0 0 auto", borderRadius: 8, padding: "8px 10px",
    display: "flex", flexDirection: "column", gap: 5, transition: "background 0.15s, border-color 0.15s",
    border: `1px solid ${isOver ? "var(--accent-purple-border)" : "var(--border-subtle)"}`,
    background: isOver ? "var(--accent-purple-bg)" : "var(--input-bg)",
  });

  const addBtnStyle = {
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 7px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
    background: "none", border: "1px dashed var(--border-default)",
    color: "var(--text-faint)", cursor: "pointer", alignSelf: "flex-start",
  };

  const renderOpColumn = (colKey, label, ops) => (
    <div
      key={colKey}
      style={colStyle(overColumn === colKey)}
      onDragOver={(e) => { e.preventDefault(); setOverColumn(colKey); }}
      onDragLeave={() => setOverColumn(null)}
      onDrop={(e) => { e.preventDefault(); handleDropOnFolder(colKey === "uncategorized" ? null : colKey); }}
    >
      <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", marginBottom: 2 }}>
        {label}
      </span>
      <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {ops.map((op) => (
          <OpItem
            key={op.id}
            op={op}
            selected={selectedOpId === op.id}
            onClick={() => toggleSelect(op.id)}
            onPreview={() => handleRun(op)}
            isDuplicate={duplicateOpIds.has(op.id)}
            onPriorityChange={(priority) =>
              CommitHelpers.updateOperation({ dispatch, socket, operation: { ...op, priority } })
            }
          />
        ))}
        {ops.length === 0 && (
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", fontStyle: "italic" }}>
            drag operations here
          </span>
        )}
      </div>
      <button style={addBtnStyle} onClick={() => handleCreate(colKey === "uncategorized" ? null : colKey)}>
        <Plus style={{ width: 8, height: 8 }} /> Operation
      </button>
    </div>
  );

  // Guard: if the operation was deleted while selected, clear selection
  useEffect(() => {
    if (selectedOpId && !selectedOp) setSelectedOpId(null);
  }, [selectedOpId, selectedOp]);

  // Drill-down: if an operation is selected, show editor full-pane with back button
  if (selectedOp) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Back bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)", position: "sticky", top: 0, zIndex: 2 }}>
          <button
            onClick={() => setSelectedOpId(null)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <ChevronLeft style={{ width: 11, height: 11 }} /> Operations
          </button>
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>{selectedOp.name}</span>
        </div>
        {/* Editor + Log panel side-by-side */}
        <div style={{ padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 60%", minWidth: 0 }}>
            <OperationEditor
              operation={selectedOp}
              fields={gridFields}
              categoryFolders={categoryFolders}
              isDuplicate={duplicateOpIds.has(selectedOp?.id)}
              onSave={(updated) => CommitHelpers.updateOperation({ dispatch, socket, operation: updated })}
              onDelete={() => { CommitHelpers.deleteOperation({ dispatch, socket, operationId: selectedOpId }); setSelectedOpId(null); }}
              onRun={() => { setSelectedOpId(null); handleRun(selectedOp); }}
            />
          </div>
          <div style={{ flex: "1 1 40%", minWidth: 280, position: "sticky", top: 50 }}>
            <OperationLogPanel operation={selectedOp} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={handleCreateCategory}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px dashed var(--border-default)", color: "var(--text-muted)", cursor: "pointer" }}
        >
          <FolderPlus style={{ width: 10, height: 10 }} /> Category
        </button>
      </div>
      {/* Preview panel — shown when Run is clicked */}
      {previewOp && (() => {
        const triggerTypes = Array.isArray(previewOp.triggerTypes) ? previewOp.triggerTypes : [previewOp.triggerType].filter(Boolean);
        const triggerInfo = triggerTypes.map(t => EVENT_TYPES.find(tt => tt.value === t)).filter(Boolean);
        const sources = previewOp.pipeline?.sources || [];
        const steps = previewOp.pipeline?.steps || [];
        const describeStep = (s) => {
          if (s.type === "if") return `if (${(s.condition?.rules || []).length} rule${(s.condition?.rules || []).length !== 1 ? "s" : ""}) → ${(s.then || []).length} action${(s.then || []).length !== 1 ? "s" : ""}`;
          return s.config?.type || "action";
        };
        return (
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--accent-purple-bg)", border: "1px solid var(--accent-purple-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "var(--accent-purple-text)" }}>{previewOp.name}</span>
              <button onClick={() => setPreviewOp(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>
            {previewOp.description && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 6 }}>{previewOp.description}</div>
            )}
            <div style={{ fontSize: 10, fontFamily: "monospace", marginBottom: 4 }}>
              <span style={{ color: "var(--accent-purple-text)" }}>trigger: </span>
              <span style={{ color: "var(--text-primary)" }}>{triggerTypes.join(", ") || "manual"}</span>
            </div>
            {sources.length > 0 && (
              <div style={{ fontSize: 10, fontFamily: "monospace", marginTop: 6, marginBottom: 4 }}>
                <span style={{ color: "var(--accent-purple-text)" }}>sources: </span>
                <span style={{ color: "var(--text-muted)" }}>{sources.map(s => `${s.varName || ("$" + s.variableName) || "$src"}(${s.entityType || "module"})`).join(", ")}</span>
              </div>
            )}
            {steps.length > 0 && (
              <div style={{ fontSize: 10, fontFamily: "monospace", marginTop: 4 }}>
                <span style={{ color: "var(--accent-purple-text)" }}>steps: </span>
                {steps.map((s, i) => (
                  <div key={i} style={{ paddingLeft: 8, color: "var(--text-muted)", fontSize: 9, marginTop: 1 }}>
                    {i + 1}. {describeStep(s)}
                  </div>
                ))}
              </div>
            )}
            {steps.length === 0 && sources.length === 0 && (
              <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", marginTop: 4, fontStyle: "italic" }}>no sources or steps configured</div>
            )}
          </div>
        );
      })()}
      {/* Category columns */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
        {renderOpColumn("uncategorized", "Uncategorized", opsByFolder.uncategorized)}
        {categoryFolders.map((folder) =>
          renderOpColumn(folder.id, folder.name, opsByFolder[folder.id] || [])
        )}
      </div>
    </div>
  );
}
