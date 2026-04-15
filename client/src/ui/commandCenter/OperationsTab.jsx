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
  { value: "onChange",     label: "On Change",     desc: "Fires when a value or property changes" },
  { value: "onAdd",        label: "On Add",        desc: "Fires when something is added or created" },
  { value: "onRemove",     label: "On Remove",     desc: "Fires when something is removed from a parent" },
  { value: "onDelete",     label: "On Delete",     desc: "Fires when something is permanently deleted" },
  { value: "onMove",       label: "On Move",       desc: "Fires when something is moved between parents" },
  { value: "onReorder",    label: "On Reorder",    desc: "Fires when something is reordered within a parent" },
  { value: "onComplete",   label: "On Complete",   desc: "Fires when a module or field reaches a done state" },
  { value: "onUncomplete", label: "On Uncomplete", desc: "Fires when a completion is reversed" },
  { value: "onLoad",       label: "On Load",       desc: "Fires once when the grid loads" },
  { value: "onIteration",  label: "On Iteration",  desc: "Fires when the date or category filter changes" },
  { value: "onSchedule",   label: "On Schedule",   desc: "Fires at a specific time (cron)" },
  { value: "onWebhook",    label: "On Webhook",    desc: "Fires via HTTP POST to the webhook URL" },
  { value: "onButton",     label: "On Button",     desc: "Fires when the operation trigger button is pressed" },
  { value: "onNodeInput",  label: "On Node Input", desc: "Fires when a local field input on the operation node changes or Run is clicked" },
  { value: "manual",       label: "Manual",        desc: "Only runs when manually triggered from UI" },
];

// Subject types — WHAT KIND of entity the event is about
const SUBJECT_TYPES = [
  { value: "module",      label: "Module",      desc: "Any panel, container, or instance",  roles: ["panel","container","instance"] },
  { value: "field",       label: "Field",        desc: "A field value on a module" },
  { value: "grid",        label: "Grid",         desc: "The workspace grid" },
  { value: "iteration",   label: "Iteration",    desc: "An iteration definition or value" },
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
  } else if (subjectType === "iteration") {
    base.push("$trigger.iterationId", "$trigger.iterationValue", "$trigger.categoryValue", "$trigger.previousValue");
  } else if (subjectType === "transaction") {
    base.push("$trigger.transactionId", "$trigger.transactionType", "$trigger.moduleId");
  }
  base.push("$trigger.userId", "$trigger.timestamp");
  return base;
}

// Source entity types — what can be bound as a pipeline variable
const SOURCE_ENTITY_TYPES = [
  { value: "module",      label: "Module",       desc: "Panel, container, or instance (filter by role/kind/label)" },
  { value: "field",       label: "Field",        desc: "A field definition" },
  { value: "fieldValue",  label: "Field Value",  desc: "Aggregated value of a field across modules" },
  { value: "grid",        label: "Grid",         desc: "The current grid" },
  { value: "iteration",   label: "Iteration",    desc: "Current or named iteration" },
  { value: "view",        label: "View",         desc: "A view / rendering config" },
  { value: "template",    label: "Template",     desc: "A saved template" },
  { value: "transaction", label: "Transaction",  desc: "Transaction records (audit)" },
  { value: "folder",      label: "Folder",       desc: "A manifest folder" },
  { value: "trigger",     label: "$trigger",     desc: "The trigger event context" },
  { value: "date",        label: "Date/Time",    desc: "Built-in: $now, $today, $currentHour" },
];

// Legacy map for backwards-compat display in preview (old triggerType values)
const TRIGGER_TYPES = EVENT_TYPES;

// ============================================================
// OP ITEM (Pragmatic DnD draggable — drag to instance to add operationBinding)
// ============================================================
export function OpItem({ op, selected, onClick, onPreview, isDuplicate = false }) {
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
      {/* Header row: grip + name + preview/run button */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <GripVertical style={{ width: 8, height: 8, opacity: 0.3, flexShrink: 0 }} />
        <span style={{ color: op.enabled ? "rgb(196,181,253)" : "var(--text-faint)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {op.name}
        </span>
        {isDuplicate && (
          <span title="Another operation uses the same trigger + target field" style={{ fontSize: 9, color: "rgba(251,146,60,0.9)", flexShrink: 0 }}>⚠</span>
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
    const short = { onChange: "Δ", onDrop: "↓", onCreate: "+", onDelete: "✕", onMove: "→", onComplete: "✓", onModuleUpdate: "M↑", onIteration: "⟳", onLoad: "⬛", onWebhook: "⚡", manual: "▶" };
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
  if (!operation) return null;
  const { modulesById, operationsById, roleByModuleId } = useContext(GridActionsContext);
  const [local, setLocal] = useState(operation);
  useMemo(() => setLocal(operation), [operation?.id]);

  // Helper to update triggerConfig sub-keys
  const setTriggerConfig = (triggerKey, patch) =>
    setLocal(p => ({
      ...p,
      triggerConfig: {
        ...(p.triggerConfig || {}),
        [triggerKey]: { ...(p.triggerConfig?.[triggerKey] || {}), ...patch },
      },
    }));

  // Active trigger types (support both legacy string and new array)
  const activeTriggerTypes = Array.isArray(local.triggerTypes)
    ? local.triggerTypes
    : local.triggerType ? [local.triggerType] : ["manual"];

  const toggleTriggerType = (type) => {
    const current = activeTriggerTypes;
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type];
    const primary = next[0] || "manual";
    setLocal(p => ({ ...p, triggerType: primary, triggerTypes: next.length > 1 ? next : undefined }));
  };

  const isTriggerActive = (type) => activeTriggerTypes.includes(type);

  // Container + panel options for onDrop config
  const getRole = useCallback((m) => roleByModuleId?.[m.id] || m.role || "instance", [roleByModuleId]);
  const allContainers = useMemo(() => Object.values(modulesById || {}).filter(m => getRole(m) === "container"), [modulesById, getRole]);
  const allPanels = useMemo(() => Object.values(modulesById || {}).filter(m => getRole(m) === "panel"), [modulesById, getRole]);

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
        <div>
          <span style={labelStyle}>Target Field (legacy)</span>
          <select
            value={local.targetFieldId || ""}
            onChange={(e) =>
              setLocal((p) => ({ ...p, targetFieldId: e.target.value || null }))
            }
            style={{ ...inputStyle, width: "auto", minWidth: 120 }}
          >
            <option value="">None</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name || f.type}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Triggers ── */}
      <div>
        <span style={labelStyle}>Triggers</span>
        {/* On Load switch — separate from configurable trigger rows */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "4px 8px", borderRadius: 5, background: "var(--input-bg)", border: "1px solid var(--border-subtle)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", flex: 1 }}>
            <span
              onClick={() => toggleTriggerType("onLoad")}
              style={{
                display: "inline-block", width: 28, height: 14, borderRadius: 7, cursor: "pointer",
                background: isTriggerActive("onLoad") ? "rgb(52,211,153)" : "var(--border-default)",
                position: "relative", transition: "background 0.15s",
              }}
            >
              <span style={{
                position: "absolute", top: 2, left: isTriggerActive("onLoad") ? 14 : 2,
                width: 10, height: 10, borderRadius: "50%", background: "#fff",
                transition: "left 0.15s",
              }} />
            </span>
            Run on load
          </label>
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>fires once when grid opens</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activeTriggerTypes.filter(t => t !== "onLoad").map((trigType) => {
            const idx = activeTriggerTypes.indexOf(trigType);
            const trigObj = local.triggerObjects?.[idx] || {};
            const eventType = trigObj.eventType || trigType;
            const subjectType = trigObj.subjectType || "module";
            const subjectRole = trigObj.subjectRole || "";
            const targetId = trigObj.targetId || "";
            const updateTrigObj = (patch) => {
              const arr = local.triggerObjects ? [...local.triggerObjects] : activeTriggerTypes.map(() => ({}));
              arr[idx] = { ...(arr[idx] || {}), ...patch };
              setLocal(p => ({ ...p, triggerObjects: arr }));
            };
            const subjectInfo = SUBJECT_TYPES.find(s => s.value === subjectType);
            const entitiesForSubject = subjectType === "module"
              ? (subjectRole ? Object.values(modulesById || {}).filter(m => getRole(m) === subjectRole) : Object.values(modulesById || {}))
              : subjectType === "field" ? fields
              : subjectType === "iteration" ? []
              : [];
            return (
              <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)", borderRadius: 5, padding: "6px 8px" }}>
                {/* Event type */}
                <select
                  value={eventType}
                  title="Event type"
                  onChange={e => { toggleTriggerType(trigType); toggleTriggerType(e.target.value); updateTrigObj({ eventType: e.target.value }); }}
                  style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                >
                  {EVENT_TYPES.filter(et => et.value !== "onLoad").map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
                </select>
                {/* Subject type */}
                <select
                  value={subjectType}
                  title="What kind of thing"
                  onChange={e => updateTrigObj({ subjectType: e.target.value, subjectRole: "", targetId: "" })}
                  style={{ ...inputStyle, width: "auto", minWidth: 90, fontSize: 10 }}
                >
                  {SUBJECT_TYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>
                {/* Role filter for modules */}
                {subjectType === "module" && (
                  <select
                    value={subjectRole}
                    title="Module role"
                    onChange={e => updateTrigObj({ subjectRole: e.target.value, targetId: "" })}
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
                    onChange={e => updateTrigObj({ targetId: e.target.value })}
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
                    onChange={e => updateTrigObj({ targetId: e.target.value })}
                    style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                  >
                    <option value="">Any {subjectRole || "module"}</option>
                    {entitiesForSubject.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                  </select>
                )}
                {/* Remove trigger */}
                <button
                  onClick={() => toggleTriggerType(trigType)}
                  style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}
                  title="Remove trigger"
                >×</button>
                {/* $trigger var hints */}
                <TriggerDataHint eventType={eventType} subjectType={subjectType} />
                {/* Schedule time picker */}
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
            onClick={() => toggleTriggerType("onChange")}
            style={{ alignSelf: "flex-start", padding: "3px 10px", borderRadius: 5, fontSize: 10, fontFamily: "monospace", cursor: "pointer", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)" }}
          >
            + Add Trigger
          </button>
        </div>
      </div>

      {/* ── Sources (variable assignments) ── */}
      <div>
        <span style={labelStyle}>Sources <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>— assign variables for the pipeline</span></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {(local.pipeline?.sources || []).map((src, idx) => {
            const updateSrc = (patch) => {
              const next = [...(local.pipeline?.sources || [])];
              next[idx] = { ...next[idx], ...patch };
              setLocal(p => ({ ...p, pipeline: { ...(p.pipeline || {}), sources: next } }));
            };
            const removeSrc = () => {
              const next = (local.pipeline?.sources || []).filter((_, i) => i !== idx);
              setLocal(p => ({ ...p, pipeline: { ...(p.pipeline || {}), sources: next } }));
            };
            const entityType = src.entityType || "module";
            const subjectRole = src.subjectRole || "";
            const entitiesForSrc = entityType === "module"
              ? (subjectRole ? Object.values(modulesById || {}).filter(m => getRole(m) === subjectRole) : Object.values(modulesById || {}))
              : entityType === "field" ? fields
              : [];
            return (
              <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", background: "var(--input-bg)", border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "5px 8px" }}>
                {/* Variable name */}
                <input
                  value={src.varName || ""}
                  onChange={e => updateSrc({ varName: e.target.value })}
                  placeholder="$varName"
                  title="Variable name (use in pipeline as $varName)"
                  style={{ ...inputStyle, width: 90, fontSize: 10, color: "var(--accent-green-text)", fontFamily: "monospace" }}
                />
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>=</span>
                {/* Entity type */}
                <select
                  value={entityType}
                  onChange={e => updateSrc({ entityType: e.target.value, subjectRole: "", entityId: "" })}
                  style={{ ...inputStyle, width: "auto", minWidth: 100, fontSize: 10 }}
                >
                  {SOURCE_ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
                </select>
                {/* Role filter for modules */}
                {entityType === "module" && (
                  <select
                    value={subjectRole}
                    onChange={e => updateSrc({ subjectRole: e.target.value, entityId: "" })}
                    style={{ ...inputStyle, width: "auto", minWidth: 90, fontSize: 10 }}
                  >
                    <option value="">Any role</option>
                    <option value="panel">Panel</option>
                    <option value="container">Container</option>
                    <option value="instance">Instance</option>
                  </select>
                )}
                {/* Specific entity */}
                {entitiesForSrc.length > 0 && (
                  <select
                    value={src.entityId || ""}
                    onChange={e => updateSrc({ entityId: e.target.value })}
                    style={{ ...inputStyle, width: "auto", minWidth: 120, fontSize: 10 }}
                  >
                    <option value="">All {entityType === "module" ? (subjectRole || "modules") : entityType + "s"}</option>
                    {entitiesForSrc.map(m => <option key={m.id} value={m.id}>{m.label || m.name || m.id}</option>)}
                  </select>
                )}
                <button onClick={removeSrc} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: "0 2px" }} title="Remove source">×</button>
              </div>
            );
          })}
          <button
            onClick={() => {
              const next = [...(local.pipeline?.sources || []), { varName: `$source${(local.pipeline?.sources?.length || 0) + 1}`, entityType: "module", subjectRole: "", entityId: "" }];
              setLocal(p => ({ ...p, pipeline: { ...(p.pipeline || {}), sources: next } }));
            }}
            style={{ alignSelf: "flex-start", padding: "3px 10px", borderRadius: 5, fontSize: 10, fontFamily: "monospace", cursor: "pointer", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)" }}
          >
            + Add Source
          </button>
        </div>
      </div>

      {/* Pipeline editor */}
      <PipelineEditor
        pipeline={local.pipeline || { sources: [], steps: [] }}
        onChange={(pipeline) => setLocal(p => ({ ...p, pipeline }))}
        fields={fields}
        modulesById={modulesById || {}}
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
    () => (state?.operations || []).filter((o) => o.gridId === gridId),
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
    const newOp = { id: uid(), gridId, name: "New Operation", description: "", pipeline: { sources: [], steps: [] }, targetFieldId: null, triggerType: "onChange", triggerTypes: ["onChange", "onLoad"], enabled: true, sortOrder: gridOperations.length, folderId };
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

  // Drill-down: if an operation is selected, show editor full-pane with back button
  // Guard: if the operation was deleted while selected, clear selection
  if (selectedOpId && !selectedOp) { setSelectedOpId(null); }
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
        {/* Editor content */}
        <div style={{ padding: "10px 14px" }}>
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
        const triggerInfo = triggerTypes.map(t => TRIGGER_TYPES.find(tt => tt.value === t)).filter(Boolean);
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
