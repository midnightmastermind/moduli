// ui/commandCenter/OperationsTab.jsx
// OperationsTab + OperationPill + OperationEditor + TriggerDataHint + OpItem + getTriggerVars

import React, { useState, useMemo, useContext, useEffect, useRef, useCallback } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Plus, FolderPlus, ChevronLeft, GripVertical, Trash2, Play } from "lucide-react";

import { GridActionsContext, useGridActions } from "../../GridActionsContext";
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

// Event types come from the shared triggerTypes module so the editor and
// the runtime executor share one source of truth. VISIBLE_EVENT_TYPES
// hides alias-only entries (onCreate / onNavigation / onDrop).
import { VISIBLE_EVENT_TYPES as EVENT_TYPES } from "../../helpers/triggerTypes";

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

// $trigger.* variables inferred from (eventType, subjectType).
// itemId = the placement (was occurrenceId); templateId = the template (was moduleId).
export function getTriggerVars(eventType, subjectType) {
  const base = [];
  if (subjectType === "module" || subjectType === "item") {
    base.push("$trigger.itemId", "$trigger.templateId", "$trigger.role", "$trigger.kind", "$trigger.label");
    if (eventType === "onChange")  base.push("$trigger.changedField", "$trigger.value", "$trigger.previousValue");
    if (eventType === "onAdd" || eventType === "onRemove") base.push("$trigger.parentId");
    if (eventType === "onMove")    base.push("$trigger.fromParentId", "$trigger.toParentId");
    if (eventType === "onComplete") base.push("$trigger.fieldId", "$trigger.value");
  } else if (subjectType === "field") {
    base.push("$trigger.fieldId", "$trigger.itemId", "$trigger.templateId", "$trigger.value", "$trigger.previousValue", "$trigger.flow");
  } else if (subjectType === "grid") {
    base.push("$trigger.gridId");
  } else if (subjectType === "filterNav") {
    base.push("$trigger.activeFilterValues", "$trigger.date", "$trigger.previousValue");
  } else if (subjectType === "transaction") {
    base.push("$trigger.transactionId", "$trigger.transactionType", "$trigger.templateId");
  }
  base.push("$trigger.userId", "$trigger.timestamp");
  return base;
}


// ============================================================
// OP ITEM (Pragmatic DnD draggable — drag to instance to add operationBinding)
// ============================================================
export function OpItem({ op, selected, onClick, onPreview, isDuplicate = false }) {
  const ref = useRef(null);
  const { state, fieldsById, occurrencesById } = useGridActions();

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
      {/* Header row: grip + name + preview/run button. Priority lives on each
          trigger row inside OperationEditor — see the trigger list editor. */}
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
    const short = { onChange: "Δ", onDrop: "↓", onCreate: "+", onDelete: "✕", onMove: "→", onComplete: "✓", onModuleUpdate: "M↑", onFilterChange: "⟳", onLoad: "⬛", onWebhook: "⚡", manual: "▶" };
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
// SCHEDULE EDITOR — cadence config for time-based ops
// ============================================================
const SCHEDULE_UNITS = [
  { value: "second", label: "second(s)" },
  { value: "minute", label: "minute(s)" },
  { value: "hour",   label: "hour(s)" },
  { value: "day",    label: "day(s)" },
];

export function ScheduleEditor({ schedule, onChange }) {
  const labelSt = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "block", marginBottom: 3 };
  const inputSt = { fontSize: 11, fontFamily: "monospace", padding: "3px 6px", border: "1px solid var(--border-default)", background: "var(--input-bg)", color: "var(--text-primary)", borderRadius: 4 };
  const kind = schedule?.kind || "interval";
  const setKind = (k) => onChange({ ...(schedule || {}), kind: k });

  // Cost hint: extrapolate the cadence into fires/hour to guide the author.
  const cadenceHint = useMemo(() => {
    if (!schedule) return null;
    if (kind === "interval") {
      const unitMs = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 }[schedule.unit] || 60000;
      const cms = Math.max(1000, (Number(schedule.every) || 1) * unitMs);
      const firesPerHour = 3_600_000 / cms;
      const subMinute = cms < 60_000;
      return { cms, firesPerHour, subMinute };
    }
    if (kind === "atTimes") {
      const n = Array.isArray(schedule.times) ? schedule.times.length : 0;
      return { firesPerHour: n / 24, subMinute: false, atTimesCount: n };
    }
    return null;
  }, [schedule, kind]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10, border: "1px solid var(--accent-blue-border, var(--border-default))", borderRadius: 6, background: "var(--accent-blue-bg, var(--input-bg))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: "var(--accent-blue-text)" }}>⏱ Schedule</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{ marginLeft: "auto", fontSize: 9, fontFamily: "monospace", padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-faint)", cursor: "pointer" }}
          title="Convert back to event-triggered op"
        >
          Remove schedule
        </button>
      </div>

      {/* Kind switcher */}
      <div style={{ display: "flex", gap: 4 }}>
        {[{ k: "interval", label: "Every N" }, { k: "atTimes", label: "At specific times" }].map(({ k, label }) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              fontSize: 10, fontFamily: "monospace", padding: "3px 9px", borderRadius: 4, cursor: "pointer",
              border: `1px solid ${kind === k ? "var(--accent-blue)" : "var(--border-default)"}`,
              background: kind === k ? "var(--accent-blue-bg)" : "transparent",
              color: kind === k ? "var(--accent-blue-text)" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "interval" && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div>
            <span style={labelSt}>Every</span>
            <input
              type="number"
              min="1"
              value={schedule?.every ?? 1}
              onChange={(e) => onChange({ ...(schedule || {}), kind: "interval", every: Number(e.target.value) || 1 })}
              style={{ ...inputSt, width: 70 }}
            />
          </div>
          <div>
            <span style={labelSt}>Unit</span>
            <select
              value={schedule?.unit || "minute"}
              onChange={(e) => onChange({ ...(schedule || {}), kind: "interval", unit: e.target.value })}
              style={{ ...inputSt, minWidth: 120 }}
            >
              {SCHEDULE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {kind === "atTimes" && (
        <div>
          <span style={labelSt}>Times of day (HH:MM)</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(schedule?.times || []).map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 4 }}>
                <input
                  type="time"
                  value={t}
                  onChange={(e) => {
                    const next = [...(schedule.times || [])];
                    next[i] = e.target.value;
                    onChange({ ...schedule, kind: "atTimes", times: next });
                  }}
                  style={{ ...inputSt, width: 110 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (schedule.times || []).filter((_, j) => j !== i);
                    onChange({ ...schedule, kind: "atTimes", times: next });
                  }}
                  style={{ fontSize: 10, padding: "2px 7px", border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", color: "var(--text-faint)", cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange({ ...(schedule || {}), kind: "atTimes", times: [...(schedule?.times || []), "09:00"] })}
              style={{ alignSelf: "flex-start", fontSize: 10, fontFamily: "monospace", padding: "3px 8px", borderRadius: 4, border: "1px dashed var(--border-default)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
            >
              + Add time
            </button>
          </div>
        </div>
      )}

      {/* Notification suppression */}
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!schedule?.suppressNotifications}
          onChange={(e) => onChange({ ...(schedule || {}), suppressNotifications: e.target.checked })}
        />
        Suppress notifications
      </label>

      {/* Cost surface */}
      {cadenceHint && (
        <div style={{ fontSize: 9, fontFamily: "monospace", color: cadenceHint.subMinute ? "var(--danger-text)" : "var(--text-faint)", lineHeight: 1.4 }}>
          {kind === "interval" && (
            <>
              ≈ {cadenceHint.firesPerHour < 1 ? `1 fire / ${Math.round(1 / cadenceHint.firesPerHour)} hours` : `${cadenceHint.firesPerHour.toFixed(1)} fires/hour`}
              {cadenceHint.subMinute && (
                <span> · ⚠ sub-minute cadence — only display-only effects will run (no socket writes).</span>
              )}
            </>
          )}
          {kind === "atTimes" && (
            <>{cadenceHint.atTimesCount} time{cadenceHint.atTimesCount === 1 ? "" : "s"} per day</>
          )}
        </div>
      )}

      {/* Trigger conflict warning */}
      <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)", lineHeight: 1.4 }}>
        Scheduled ops are time-only — event triggers (onChange / onAdd / etc.) are ignored when a schedule is set.
      </div>
    </div>
  );
}

// ============================================================
// OPERATION EDITOR
// ============================================================
export function OperationEditor({ operation, fields, onSave, onDelete, onRun, categoryFolders = [], isDuplicate = false }) {
  const { modulesById, occurrencesById, fieldsById, operationsById, roleByModuleId } = useGridActions();
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
        if (eventType === "onLoad") return { eventType, subjectType: "grid", targetId: "", priority: 5 };
        if (eventType === "onFilterChange") return { eventType, subjectType: "filterNav", targetId: "", priority: 5 };
        return { eventType, subjectType: "field", targetId: "", priority: 5 };
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
      ? { eventType, subjectType: eventType === "onLoad" ? "grid" : "filterNav", targetId: "", priority: 5 }
      : { eventType, subjectType: "field", targetId: "", priority: 5 };
    commitTriggerObjects([...triggerObjects, defaults]);
  };

  const updateTriggerObject = (idx, patch) => {
    const next = triggerObjects.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    commitTriggerObjects(next);
  };

  const removeTriggerObject = (idx) => {
    commitTriggerObjects(triggerObjects.filter((_, i) => i !== idx));
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

      {/* ── Schedule (time-based) ── */}
      {local.schedule ? (
        <ScheduleEditor
          schedule={local.schedule}
          onChange={(next) => {
            if (next === null) {
              // Remove schedule → revert to event-trigger op shape.
              setLocal((p) => {
                const { schedule, ...rest } = p;
                return { ...rest, schedule: null };
              });
            } else {
              setLocal((p) => ({ ...p, schedule: next }));
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setLocal((p) => ({
            ...p,
            schedule: { kind: "interval", every: 1, unit: "hour", suppressNotifications: false, lastFiredAt: null },
            // Scheduled ops have no event triggers — clear them.
            triggerObjects: [],
            triggerTypes: [],
            triggerType: "manual",
          }))}
          style={{ alignSelf: "flex-start", fontSize: 10, fontFamily: "monospace", padding: "4px 10px", borderRadius: 4, border: "1px dashed var(--border-default)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
        >
          ⏱ Convert to scheduled op
        </button>
      )}

      {/* ── Triggers (hidden when schedule is set) ── */}
      {!local.schedule && (
      <div>
        <span style={labelStyle}>Triggers</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {triggerObjects.map((trigObj, idx) => {
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
                  onChange={e => {
                    const next = e.target.value;
                    // Snap subject to a sensible default when the event has no module/field subject.
                    if (next === "onLoad")          updateTriggerObject(idx, { eventType: next, subjectType: "grid",      subjectRole: "", targetId: "" });
                    else if (next === "onFilterChange") updateTriggerObject(idx, { eventType: next, subjectType: "filterNav", subjectRole: "", targetId: "" });
                    else                            updateTriggerObject(idx, { eventType: next });
                  }}
                  style={{ ...inputStyle, width: "auto", minWidth: 110, fontSize: 10 }}
                >
                  {EVENT_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
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
                {/* Per-trigger priority (1 = highest, 10 = lowest, 5 = default) */}
                <select
                  value={trigObj.priority ?? 5}
                  title="Priority for this trigger — lower runs first"
                  onChange={e => updateTriggerObject(idx, { priority: Number(e.target.value) })}
                  style={{ ...inputStyle, width: "auto", minWidth: 44, fontSize: 10, marginLeft: "auto" }}
                >
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>P{n}</option>)}
                </select>
                {/* Remove trigger */}
                <button
                  onClick={() => removeTriggerObject(idx)}
                  style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}
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
                {/* Ancestor scoping for onFilterChange (B16) — fire only when an */}
                {/* ancestor of the changed occurrence matches by id or label.    */}
                {eventType === "onFilterChange" && (
                  <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 2, paddingTop: 4, borderTop: "1px dashed var(--accent-blue-border)" }}>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>only fire when an ancestor matches:</span>
                    <span style={{ fontSize: 9, color: "var(--text-faint)" }}>id</span>
                    <input
                      value={trigObj.ancestorId || ""}
                      onChange={e => updateTriggerObject(idx, { ancestorId: e.target.value || undefined })}
                      placeholder="(any)"
                      style={{ ...inputStyle, width: 130, fontSize: 10 }}
                    />
                    <span style={{ fontSize: 9, color: "var(--text-faint)" }}>or label</span>
                    <input
                      value={trigObj.ancestorLabel || ""}
                      onChange={e => updateTriggerObject(idx, { ancestorLabel: e.target.value || undefined })}
                      placeholder='e.g. "Physical"'
                      style={{ ...inputStyle, width: 130, fontSize: 10 }}
                    />
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
      )}

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

      {/* Save-time validation warnings (soft — don't block save, just surface) */}
      {(() => {
        if (!local.schedule) return null;
        const issues = [];
        if (Array.isArray(local.triggerObjects) && local.triggerObjects.length > 0) {
          issues.push("Scheduled ops can't have event triggers — they'll be ignored at runtime.");
        }
        // Cadence cost check: extrapolate writes/hour against the persistent-effect floor.
        if (local.schedule.kind === "interval") {
          const unitMs = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 }[local.schedule.unit] || 60000;
          const cms = Math.max(1000, (Number(local.schedule.every) || 1) * unitMs);
          if (cms < 60_000) {
            // Scan pipeline for non-display effects. Display actions write to
            // computedValues; UPDATE/CREATE/COPY_LINK/NOTIFY/DELETE/APPLY_TEMPLATE
            // emit socket-writing effects.
            const persistentTypes = new Set(["UPDATE", "CREATE", "COPY_LINK", "NOTIFY", "DELETE", "APPLY_TEMPLATE", "ADD_CHILD", "DATE_ADD"]);
            const walkSteps = (steps = []) => {
              for (const s of steps) {
                if (s?.type === "action") {
                  const t = s.config?.type || s.actionType;
                  if (persistentTypes.has(t)) return true;
                } else if (s?.type === "if") {
                  if (walkSteps(s.then || [])) return true;
                  if (walkSteps(s.else || [])) return true;
                } else if (s?.type === "loop") {
                  if (walkSteps(s.body || [])) return true;
                }
              }
              return false;
            };
            if (walkSteps(local.pipeline?.steps || [])) {
              issues.push(`Sub-minute cadence: persistent-effect actions in this pipeline won't run. Move to minute+ cadence or remove the persistent actions.`);
            }
          }
        }
        if (!issues.length) return null;
        return (
          <div style={{ padding: "6px 10px", borderRadius: 5, background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", fontSize: 10, fontFamily: "monospace", color: "rgba(251,146,60,0.9)" }}>
            {issues.map((m, i) => <div key={i}>⚠ {m}</div>)}
          </div>
        );
      })()}

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
  const ctx = useGridActions();
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

  // Category folders are a SHARED namespace with the Fields tab (both stamp
  // folderId onto the same folderType:"category" records). Rendering every
  // category as an ops column buried the op categories behind a wall of empty
  // field-category columns (Nutrition/Wellness/…) — the user's "categories
  // aren't organizing the ops" (2026-07-12). The AXIS is data the folder
  // carries: `categoryKind` ("field" | "op"), stamped at creation by the tab
  // that minted it + by the seed (2026-07-13 — identity as data, per the
  // no-hardcoding rule). LEGACY folders (categoryKind null, pre-stamp) fall
  // back to the old contents inference: holds fields but no ops → field
  // category → not an ops column. Empty-of-both legacy categories stay
  // visible so ops can be dragged into them.
  const allOps = useMemo(() => Object.values(operationsById || {}), [operationsById]);
  const categoryFolders = useMemo(() => {
    const fieldFolderIds = new Set(Object.values(fieldsById || {}).map((f) => f?.folderId).filter(Boolean));
    const opFolderIds = new Set(allOps.map((o) => o?.folderId).filter(Boolean));
    return Object.values(foldersById || {})
      .filter((f) => f.gridId === gridId && f.folderType === "category")
      .filter((f) => f.categoryKind
        ? f.categoryKind === "op"
        : (opFolderIds.has(f.id) || !fieldFolderIds.has(f.id)))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [foldersById, gridId, fieldsById, allOps]);

  // Split ops by schedule presence. Action ops include legacy ops with
  // schedule undefined; scheduled ops are those with op.schedule != null.
  // Declared BEFORE opsByFolder so its dep array doesn't TDZ-fail
  // during render (the dep array is evaluated synchronously every render).
  const actionOps = useMemo(() => gridOperations.filter(o => !o.schedule), [gridOperations]);
  const scheduledOps = useMemo(() => gridOperations.filter(o => !!o.schedule), [gridOperations]);

  const opsByFolder = useMemo(() => {
    const groups = { uncategorized: [] };
    for (const f of categoryFolders) groups[f.id] = [];
    // Action ops only — scheduled ops live in a separate sub-tab.
    for (const op of actionOps) {
      const key = op.folderId && groups[op.folderId] !== undefined ? op.folderId : "uncategorized";
      groups[key].push(op);
    }
    return groups;
  }, [actionOps, categoryFolders]);

  // Detect duplicate operations: same triggerType + same display-field write target.
  // Display writes are now `UPDATE { path: "$display.<fieldId>.<itemId>" }` — the
  // fieldId is extracted from the path's first segment.
  const duplicateOpIds = useMemo(() => {
    const seen = {};
    const dupes = new Set();
    const displayPathRe = /^\$display\.([^.]+)/;
    for (const op of gridOperations) {
      const trigger = op.triggers?.[0]?.triggerType || op.triggerType;
      const updateStep = op.pipeline?.steps?.find(s => {
        if (s.type !== "action" || s.config?.type !== "UPDATE") return false;
        return typeof s.config?.path === "string" && displayPathRe.test(s.config.path);
      });
      const fieldId = updateStep?.config?.path?.match(displayPathRe)?.[1];
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
  // Sub-tab: Actions (event-triggered ops) vs Schedules (time-triggered ops).
  // Same op records; the only difference is `op.schedule != null`.
  const [subTab, setSubTab] = useState("actions");

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
    const newOp = { id: uid(), gridId, name: "New Operation", description: "", pipeline: { sources: [], steps: [] }, triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 5 }], triggerTypes: ["onLoad"], triggerType: "onLoad", enabled: true, sortOrder: gridOperations.length, folderId };
    CommitHelpers.createOperation({ dispatch, socket, operation: newOp });
    setSelectedOpId(newOp.id);
  };

  const handleCreateSchedule = () => {
    // New scheduled op: hour cadence + no triggers (enforced — schedule and
    // triggerObjects are mutually exclusive). Author opens the editor to set
    // pipeline + adjust cadence.
    const newOp = {
      id: uid(), gridId, name: "New Schedule", description: "",
      pipeline: { sources: [], steps: [] },
      triggerObjects: [], triggerTypes: [], triggerType: "manual",
      schedule: { kind: "interval", every: 1, unit: "hour", suppressNotifications: false, lastFiredAt: null },
      enabled: true, sortOrder: gridOperations.length, folderId: null,
    };
    CommitHelpers.createOperation({ dispatch, socket, operation: newOp });
    setSelectedOpId(newOp.id);
  };

  const handleCreateCategory = () => {
    const folder = { id: uid(), gridId, name: "New Category", folderType: "category", categoryKind: "op", sortOrder: categoryFolders.length, isExpanded: true };
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
          <button
            onClick={() => setSelectedOpId(null)}
            style={{ marginLeft: "auto", padding: "3px 12px", borderRadius: 5, fontSize: 11, fontFamily: "monospace", background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)", color: "var(--accent-blue-text)", cursor: "pointer", fontWeight: 600 }}
            title="Save and return to operations list (changes are auto-saved as you edit)"
          >
            Save
          </button>
        </div>
        {/* Editor + Log panel side-by-side. Alarm-managed ops (op.alarm set)
            are READ-ONLY here — the Alarms tab is their only editor, so the
            alarm UI and the operation can never drift apart. */}
        <div style={{ padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 60%", minWidth: 0 }}>
            {selectedOp.alarm ? (
              <div style={{ padding: "18px 16px", borderRadius: 8, border: "1px solid rgba(252,211,77,0.3)", background: "rgba(252,211,77,0.06)", fontFamily: "monospace" }}>
                <div style={{ fontSize: 12, color: "rgb(252,211,77)", fontWeight: 600, marginBottom: 6 }}>
                  ⏰ Managed by the Alarms tab
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  This operation is controlled by the alarm
                  {selectedOp.alarm.label ? ` “${selectedOp.alarm.label}”` : ""} at {selectedOp.alarm.time}.
                  Edit its time, label, type, or enabled state in the Alarms tab — it can't be
                  edited here. Deleting the alarm deletes this operation.
                </div>
              </div>
            ) : (
            <OperationEditor
              operation={selectedOp}
              fields={gridFields}
              categoryFolders={categoryFolders}
              isDuplicate={duplicateOpIds.has(selectedOp?.id)}
              onSave={(updated) => CommitHelpers.updateOperation({ dispatch, socket, operation: updated })}
              onDelete={() => { CommitHelpers.deleteOperation({ dispatch, socket, operationId: selectedOpId }); setSelectedOpId(null); }}
              onRun={() => { setSelectedOpId(null); handleRun(selectedOp); }}
            />
            )}
          </div>
          <div style={{ flex: "1 1 40%", minWidth: 280, position: "sticky", top: 50 }}>
            <OperationLogPanel operation={selectedOp} />
          </div>
        </div>
      </div>
    );
  }

  const subTabBtnStyle = (active) => ({
    fontSize: 11, fontFamily: "monospace", padding: "4px 14px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent-blue)" : "var(--border-default)"}`,
    background: active ? "var(--accent-blue-bg)" : "transparent",
    color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
  });

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Sub-tab switcher: Actions vs Schedules */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={() => setSubTab("actions")} style={subTabBtnStyle(subTab === "actions")}>
          Actions ({actionOps.length})
        </button>
        <button onClick={() => setSubTab("schedules")} style={subTabBtnStyle(subTab === "schedules")}>
          ⏱ Schedules ({scheduledOps.length})
        </button>
        <div style={{ marginLeft: "auto" }}>
          {subTab === "actions" ? (
            <button
              onClick={handleCreateCategory}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px dashed var(--border-default)", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <FolderPlus style={{ width: 10, height: 10 }} /> Category
            </button>
          ) : (
            <button
              onClick={handleCreateSchedule}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontFamily: "monospace", background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border, var(--border-default))", color: "var(--accent-blue-text)", cursor: "pointer" }}
            >
              <Plus style={{ width: 10, height: 10 }} /> New Schedule
            </button>
          )}
        </div>
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
      {/* Category columns (Actions sub-tab) */}
      {subTab === "actions" && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
          {renderOpColumn("uncategorized", "Uncategorized", opsByFolder.uncategorized)}
          {categoryFolders.map((folder) =>
            renderOpColumn(folder.id, folder.name, opsByFolder[folder.id] || [])
          )}
        </div>
      )}

      {/* Schedules list (Schedules sub-tab) — flat list with cadence preview */}
      {subTab === "schedules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {scheduledOps.length === 0 && (
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-faint)", fontStyle: "italic", padding: "20px 6px" }}>
              No scheduled operations yet. Click "+ New Schedule" to create one.
            </div>
          )}
          {scheduledOps.map((op) => {
            const sched = op.schedule || {};
            let cadenceLabel = "—";
            if (sched.kind === "interval") cadenceLabel = `every ${sched.every || 1} ${sched.unit || "minute"}${(sched.every || 1) === 1 ? "" : "s"}`;
            else if (sched.kind === "atTimes") cadenceLabel = `at ${(sched.times || []).join(", ") || "(no times)"}`;
            const lastFired = sched.lastFiredAt ? new Date(sched.lastFiredAt).toLocaleString() : "never";
            return (
              <div
                key={op.id}
                onClick={() => toggleSelect(op.id)}
                style={{
                  display: "flex", flexDirection: "column", gap: 3,
                  padding: "8px 12px", borderRadius: 6,
                  border: `1px solid ${selectedOpId === op.id ? "var(--accent-blue)" : "var(--border-subtle)"}`,
                  background: selectedOpId === op.id ? "var(--accent-blue-bg)" : "var(--input-bg)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: "var(--text-primary)" }}>
                    {op.enabled === false ? "⏸ " : "⏱ "}{op.name}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "monospace", color: "var(--accent-blue-text)" }}>
                    {cadenceLabel}
                  </span>
                </div>
                {op.description && (
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {op.description}
                  </span>
                )}
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)" }}>
                  last fired: {lastFired}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
