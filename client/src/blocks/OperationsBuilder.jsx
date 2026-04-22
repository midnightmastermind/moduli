// blocks/OperationsBuilder.jsx
// ============================================================
// Main component - Visual block programming editor
// Inspired by Snap!/Scratch
// ============================================================

import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { BlockDragProvider } from "./useBlockDnD";
import BlockPalette, { MiniPalette } from "./BlockPalette";
import OperationsCanvas, { CompactCanvas } from "./OperationsCanvas";
import { evaluateBlockTree, describeBlock, serializeBlockTree, deserializeBlockTree } from "../helpers/blockEvaluator";
import { createFieldBlocks } from "../helpers/blockTypes";
import { formatValue } from "../helpers/CalculationHelpers";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { GripVertical } from "lucide-react";
import { arrayMove } from "../helpers/LayoutHelpers";
import SelectDrilldown, { buildPathConfig, chainToPathString, pathStringToChain } from "../ui/SelectDrilldown";
import ConditionGroup from "./ConditionGroup";

/**
 * OperationsBuilder - Main visual block editor component
 *
 * Props:
 * - initialBlocks: Initial block structure (serialized format or full block)
 * - availableFields: Array of field definitions for field blocks
 * - context: Evaluation context { state, gridId, scope, timeFilter }
 * - onChange: (blockTree) => void - called when structure changes
 * - onEvaluate: (result) => void - called with evaluation result
 * - disabled: boolean
 * - compact: boolean - use compact layout
 */
export default function OperationsBuilder({
  initialBlocks,
  availableFields = [],
  context = {},
  onChange,
  onEvaluate,
  disabled = false,
  compact = false,
}) {
  // Deserialize initial blocks if needed
  const [rootBlock, setRootBlock] = useState(() => {
    if (!initialBlocks) return null;
    if (initialBlocks.id) return initialBlocks; // Already a full block
    return deserializeBlockTree(initialBlocks, { fields: availableFields });
  });

  // Build field lookup for evaluation
  const fieldsById = useMemo(() => {
    const map = {};
    for (const field of availableFields) {
      map[field.id] = field;
    }
    return map;
  }, [availableFields]);

  // Evaluate on change
  const [result, setResult] = useState(null);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!rootBlock) {
      setResult(null);
      setDescription("");
      onEvaluate?.(null);
      return;
    }

    // Evaluate the block tree
    const evalResult = evaluateBlockTree(rootBlock, {
      state: context.state || {},
      fieldsById,
      variables: {},
    });

    setResult(evalResult.value);
    setDescription(describeBlock(rootBlock));
    onEvaluate?.(evalResult.value);
  }, [rootBlock, context.state, fieldsById, onEvaluate]);

  // Handle structure changes
  const handleChange = useCallback((newRootBlock) => {
    setRootBlock(newRootBlock);

    // Serialize and emit change
    const serialized = serializeBlockTree(newRootBlock);
    onChange?.(serialized);
  }, [onChange]);

  // Handle block connection/movement
  const handleBlockMove = useCallback((block, target) => {
    // For canvas drops, this is handled by OperationsCanvas
  }, []);

  const handleBlockConnect = useCallback((block, targetBlockId, slotId) => {
    // For slot connections, this is handled by OperationsCanvas
  }, []);

  if (compact) {
    return (
      <CompactOperationsBuilder
        rootBlock={rootBlock}
        availableFields={availableFields}
        result={result}
        description={description}
        onChange={handleChange}
        disabled={disabled}
      />
    );
  }

  return (
    <BlockDragProvider
      onBlockMove={handleBlockMove}
      onBlockConnect={handleBlockConnect}
    >
      <div className={`
        operations-builder
        flex flex-col h-full
        border border-border rounded-lg
        bg-card overflow-hidden
        ${disabled ? "opacity-50 pointer-events-none" : ""}
      `}>
        {/* Header with result preview */}
        <div className="builder-header flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Expression:</span>
            <code className="text-xs text-foreground bg-background px-2 py-0.5 rounded">
              {description || "(empty)"}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Result:</span>
            <span className={`
              text-sm font-mono px-2 py-0.5 rounded
              ${result !== null ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}
            `}>
              {result !== null ? formatResultValue(result) : "—"}
            </span>
          </div>
        </div>

        {/* Main content: Palette + Canvas */}
        <div className="builder-content flex flex-1 overflow-hidden">
          {/* Block palette sidebar */}
          <BlockPalette
            fields={availableFields}
          />

          {/* Canvas area */}
          <div className="builder-canvas flex-1 p-4 overflow-auto">
            <OperationsCanvas
              rootBlock={rootBlock}
              onChange={handleChange}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </BlockDragProvider>
  );
}

/**
 * CompactOperationsBuilder - Smaller inline version
 */
function CompactOperationsBuilder({
  rootBlock,
  availableFields,
  result,
  description,
  onChange,
  disabled,
}) {
  const [showPalette, setShowPalette] = useState(false);

  return (
    <BlockDragProvider>
      <div className="compact-operations-builder space-y-2">
        {/* Compact canvas */}
        <CompactCanvas
          rootBlock={rootBlock}
          onChange={onChange}
          disabled={disabled}
          placeholder="Click to add blocks"
        />

        {/* Result preview */}
        {rootBlock && (
          <div className="flex items-center justify-between text-xs">
            <code className="text-muted-foreground truncate max-w-[200px]">
              {description}
            </code>
            <span className="font-mono text-primary">
              = {result !== null ? formatResultValue(result) : "?"}
            </span>
          </div>
        )}

        {/* Toggle palette button */}
        <button
          onClick={() => setShowPalette(!showPalette)}
          className="text-xs text-primary hover:underline"
        >
          {showPalette ? "Hide blocks" : "Show blocks"}
        </button>

        {/* Mini palette */}
        {showPalette && (
          <MiniPalette
            fields={availableFields}
            showCategories={["fields", "math", "aggregations"]}
          />
        )}
      </div>
    </BlockDragProvider>
  );
}

/**
 * Format a result value for display
 */
function formatResultValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

// ============================================================
// PIPELINE EDITOR — Steps-based code-flow operations editor
// Trigger type is managed in OperationEditor above.
//
// Pipeline format: { sources: [], steps: [] }
// Step types:
//   { id, type: "action", config: { type: "...", ...fields } }
//   { id, type: "if", condition: { operator, rules }, then: [...steps], else: [...steps] }
// ============================================================

const uid = () => Math.random().toString(36).slice(2, 9);

const COMPARATORS = [
  { value: "IS", label: "=" },
  { value: "IS_NOT", label: "≠" },
  { value: "GREATER", label: ">" },
  { value: "LESS", label: "<" },
  { value: "GREATER_OR_EQUAL", label: ">=" },
  { value: "LESS_OR_EQUAL", label: "<=" },
  { value: "CONTAINS", label: "contains" },
  { value: "IS_EMPTY", label: "is empty" },
  { value: "IS_NOT_EMPTY", label: "not empty" },
];

// Variable actions — individual math/assignment operations on local variables
const VAR_ACTION_TYPES = [
  { value: "INIT_VAR", label: "=  assign", hint: "$x = value or expr" },
  { value: "SET_VAR", label: "=  set", hint: "$x = any expression" },
  { value: "ADD_TO_VAR", label: "+= add", hint: "$x += expr" },
  { value: "SUBTRACT_FROM_VAR", label: "-= subtract", hint: "$x -= expr" },
  { value: "MULTIPLY_VAR", label: "*= multiply", hint: "$x *= expr" },
  { value: "DIV_VAR", label: "/= divide", hint: "$x /= expr" },
  { value: "INCREMENT_VAR", label: "++ increment", hint: "$x += N (default 1)" },
  { value: "DECREMENT_VAR", label: "-- decrement", hint: "$x -= N (default 1)" },
  { value: "PUSH_TO_VAR", label: "[] push", hint: "push value onto array $x" },
];

// System actions — modify system state
const SYSTEM_ACTION_TYPES = [
  { value: "SHOW_VALUE", label: "Display → field", hint: "Send computed value to a display field" },
  { value: "SET_FIELD_VALUE", label: "Set occurrence field", hint: "Write a value to occurrence.fields[id]" },
  { value: "INCREMENT_FIELD", label: "Increment field", hint: "Add/subtract from an occurrence field" },
  { value: "MARK_COMPLETE", label: "Mark complete", hint: "Set a boolean field to true/false" },
  { value: "MOVE_OCCURRENCE", label: "Move occurrence", hint: "Move occurrence to a container" },
  { value: "REMOVE_OCCURRENCE", label: "Remove occurrence", hint: "Delete an occurrence" },
  { value: "CREATE_OCCURRENCE", label: "Create occurrence", hint: "Create new occurrence in container" },
  { value: "UPDATE_MODULE", label: "Update module", hint: "Patch any module property (JSON)" },
  { value: "UPDATE_STYLE", label: "Set module style", hint: "Set ownStyle.background/color/etc." },
  { value: "DELETE_MODULE", label: "Delete module", hint: "Delete a module by ID" },
  { value: "APPEND_TO_DOC", label: "Append text to doc", hint: "Add paragraph to occurrence textmap" },
  { value: "NOTIFY", label: "Notification", hint: "Show toast message" },
  { value: "RUN_OPERATION", label: "Run operation", hint: "Call another operation by ID" },
  { value: "CREATE_OCCURRENCE_WITH_ITERATION", label: "Create page (by date)", hint: "Find/create occurrence for a date. Sets $lastCreatedOccurrenceId" },
  { value: "NAVIGATE_DAY_PAGE", label: "Navigate day page", hint: "Find/create day page + update panel view. cfg: moduleId, viewId" },
  { value: "UPDATE_VIEW", label: "Update view", hint: "Set activeOccurrenceId or other view fields. cfg: viewId, activeOccurrenceId" },
  { value: "APPLY_TEMPLATE", label: "Apply template", hint: "Fill container from template. cfg: containerId, templateId" },
  { value: "CREATE_FOLDER", label: "Create folder", hint: "Find/create folder by name. Sets $lastCreatedFolderId" },
  { value: "RESET_RECURRING_TASK", label: "Reset recurring task", hint: "Reset completion + advance dueDate by recurrenceDays" },
  { value: "DISPLAY_LOCAL_FIELDS", label: "Display on node", hint: "Show computed values on the operation node card. cfg: fields: [{label, expr}]" },
  { value: "CYCLE_FIELD_VALUE", label: "Cycle field options", hint: "Rotate through a select field's options by day-of-year. cfg: sourceFieldId, targetFieldId" },
  { value: "ADD_TO_POOL", label: "Add to pool", hint: "Create instance in pool container. cfg: poolContainerId, label / labelExpr" },
  { value: "REMOVE_FROM_POOL", label: "Remove from pool", hint: "Delete pool occurrence by module ID. cfg: poolContainerId, moduleIdExpr (default: $trigger.instanceId)" },
];

const ALL_ACTION_TYPES = [...VAR_ACTION_TYPES, ...SYSTEM_ACTION_TYPES];

// Property paths available per model type — shown as hints in ExprInput
const MODEL_PROPS = {
  occurrence: ["id", "targetId", "parentId", "fields.{fieldId}.value", "fields.{fieldId}.flow", "iteration.timeValue", "iteration.mode", "textmap"],
  module: ["id", "label", "role", "kind", "ownStyle.background", "ownStyle.color", "fieldBindings", "iteration.mode"],
  field: ["id", "name", "type", "unit", "inputEnabled", "displayEnabled"],
  grid: ["id", "currentIterationValue", "selectedIterationId", "currentCategoryValue"],
  folder: ["id", "name", "parentId", "kind"],
};

// Built-in array variables always available in $vars
const BUILTIN_ARRAYS = ["$allOccurrences", "$allModules", "$allFields", "$templates", "$iterationDefinitions"];

const AGGREGATION_TYPES = [
  "sum", "count", "countTrue", "avg", "min", "max", "last", "first", "median", "mode", "unique", "concat", "range", "stdDev", "product",
];

const ENTITY_TYPES = [
  { value: "instance", label: "Instance", hint: "$var.fieldId, $var.fieldId_flow" },
  { value: "container", label: "Container", hint: "$var.fieldId, $var.fieldId_flow" },
  { value: "panel", label: "Panel", hint: "$var.id, $var.label, $var.kind, $var.defaultDragMode" },
  { value: "occurrence", label: "Occurrence (by ID)", hint: "$var.id, $var.targetId, $var.fieldId, $var.fieldId_flow, $var._iterationTimeValue" },
  { value: "field", label: "Field (aggregated)", hint: "$var.id, $var.name, $var.type, $var.unit, $var.value, $var.flow" },
  { value: "grid", label: "Grid (whole grid)", hint: "$var.gridId, $var.currentIterationValue, $var.currentCategoryValue" },
  { value: "localField", label: "Local Field (node input)", hint: "$varName = value typed on the operation node — transient, not from DB" },
  { value: "trigger", label: "Trigger Event", hint: "Properties: fieldId, value, occurrenceId, instanceId, containerId, panelId, date, activeFilterValues" },
];

// ---- Shared styles ----
const pipelineStageStyle = {
  border: "1px solid var(--border-subtle)", borderRadius: 6, overflow: "hidden",
};
const pipelineHeaderStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "5px 10px", background: "var(--input-bg)",
  fontSize: 11, fontFamily: "monospace", fontWeight: 600,
  color: "var(--text-muted)", cursor: "pointer", userSelect: "none",
};
const pipelineBodyStyle = { padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 };
const addBtnStyle = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
  background: "var(--input-bg)", border: "1px dashed var(--border-default)",
  color: "var(--text-muted)", cursor: "pointer",
};
const rowStyle = {
  display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
  background: "var(--border-subtle)", borderRadius: 4, padding: "4px 6px",
};
const selectSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 4px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)",
};
const inputSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 5px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)", outline: "none", minWidth: 60,
};
const removeBtnSt = {
  marginLeft: "auto", fontSize: 10, color: "rgba(255,100,100,0.5)",
  background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1,
};
const moveBtnSt = {
  fontSize: 10, color: "var(--text-faint)",
  background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1,
};
const labelSt = { fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" };

const actionStepSt = {
  display: "flex", flexDirection: "column", gap: 4,
  background: "var(--border-subtle)", borderRadius: 5,
  border: "1px solid rgba(99,202,183,0.2)", padding: "5px 8px",
};
const ifStepSt = {
  display: "flex", flexDirection: "column", gap: 5,
  background: "var(--border-subtle)", borderRadius: 5,
  border: "1px solid rgba(251,191,36,0.2)", padding: "5px 8px",
};

/**
 * PipelineEditor — Steps-based code-flow UI
 * Props:
 * - pipeline: { sources, steps } or null
 * - onChange(pipeline): called with updated pipeline
 * - fields: all available Field objects
 * - modulesById: all modules
 * - operationsById: all operations (for Run Operation action)
 */
export function PipelineEditor({ pipeline, onChange, fields = [], modulesById = {}, operationsById = {} }) {
  const local = pipeline || { sources: [], steps: [] };
  const [showSources, setShowSources] = useState(false);

  const sources = local.sources || [];
  const steps = local.steps || [];

  const instanceModules = useMemo(() => Object.values(modulesById).filter(m => m.role === "instance"), [modulesById]);
  const containerModules = useMemo(() => Object.values(modulesById).filter(m => m.role === "container"), [modulesById]);
  const allFields = fields;

  const varOptions = sources.map(s => `$${s.variableName}`);

  const sharedProps = { fields, varOptions, modulesById, operationsById, sources };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

      {/* SOURCES — collapsible */}
      <div style={pipelineStageStyle}>
        <div style={pipelineHeaderStyle} onClick={() => setShowSources(!showSources)}>
          <span>📥 Sources <span style={{ fontSize: 9, opacity: 0.5 }}>({sources.length}) — bind named $vars from entities</span></span>
          <span style={{ fontSize: 9, opacity: 0.5 }}>{showSources ? "▲" : "▼"}</span>
        </div>
        {showSources && (
          <div style={pipelineBodyStyle}>
            {sources.length === 0 && (
              <span style={{ fontSize: 10, color: "var(--text-faint)", fontStyle: "italic" }}>No sources — $trigger is always available</span>
            )}
            {sources.map(src => (
              <SourceRow
                key={src.id}
                src={src}
                onUpdate={patch => onChange({ ...local, sources: sources.map(s => s.id === src.id ? { ...s, ...patch } : s) })}
                onRemove={() => onChange({ ...local, sources: sources.filter(s => s.id !== src.id) })}
                instanceModules={instanceModules}
                containerModules={containerModules}
                modulesById={modulesById}
                fields={allFields}
              />
            ))}
            <button style={addBtnStyle} onClick={() => onChange({ ...local, sources: [...sources, { id: uid(), variableName: "source" + (sources.length + 1), entityType: "instance", entityId: "" }] })}>
              + Add Source
            </button>
          </div>
        )}
      </div>

      {/* STEPS — main code flow */}
      <div style={pipelineStageStyle}>
        <div style={{ ...pipelineHeaderStyle, cursor: "default" }}>
          <span>⚡ Steps</span>
          <span style={{ fontSize: 9, opacity: 0.4 }}>top-down • actions run immediately • if blocks are conditional</span>
        </div>
        <div style={pipelineBodyStyle}>
          {steps.length === 0 && (
            <span style={{ fontSize: 10, color: "var(--text-faint)", fontStyle: "italic" }}>
              No steps — add an action or if block below
            </span>
          )}
          <StepsList steps={steps} onChange={st => onChange({ ...local, steps: st })} {...sharedProps} />
        </div>
      </div>

    </div>
  );
}

// ---- Source Row ----
function SourceRow({ src, onUpdate, onRemove, instanceModules, containerModules, modulesById, fields }) {
  const panelModules = useMemo(() => Object.values(modulesById || {}).filter(m => m.role === "panel"), [modulesById]);
  const entityTypeInfo = ENTITY_TYPES.find(et => et.value === src.entityType);

  const entityOptions = useMemo(() => {
    if (src.entityType === "instance") return instanceModules;
    if (src.entityType === "container") return containerModules;
    if (src.entityType === "panel") return panelModules;
    return [];
  }, [src.entityType, instanceModules, containerModules, panelModules]);

  const needsPicker = !["grid", "occurrence", "field", "localField", "trigger"].includes(src.entityType);
  const needsOccId = src.entityType === "occurrence";
  const needsFieldId = src.entityType === "field" || src.entityType === "localField";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={rowStyle}>
        <select value={src.entityType} onChange={e => onUpdate({ entityType: e.target.value, entityId: "" })} style={selectSt}>
          {ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
        {needsPicker && (
          <select value={src.entityId} onChange={e => onUpdate({ entityId: e.target.value })} style={selectSt}>
            <option value="">Pick...</option>
            {entityOptions.map(m => (
              <option key={m.id} value={m.id}>{m.label || m.id}</option>
            ))}
          </select>
        )}
        {needsOccId && (
          <input
            value={src.entityId}
            onChange={e => onUpdate({ entityId: e.target.value })}
            placeholder="occurrence ID or $trigger.occurrenceId"
            style={{ ...inputSt, width: 160 }}
          />
        )}
        {needsFieldId && (
          <select value={src.entityId} onChange={e => onUpdate({ entityId: e.target.value })} style={selectSt}>
            <option value="">Pick field...</option>
            {(fields || []).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        {src.entityType === "trigger" && (
          <select
            value={src.triggerProp || ""}
            onChange={e => onUpdate({ ...src, triggerProp: e.target.value })}
            style={selectSt}
          >
            <option value="">— pick property —</option>
            <option value="fieldId">fieldId</option>
            <option value="value">value</option>
            <option value="occurrenceId">occurrenceId</option>
            <option value="instanceId">instanceId</option>
            <option value="containerId">containerId</option>
            <option value="panelId">panelId</option>
            <option value="date">date</option>
            <option value="activeFilterValues">activeFilterValues</option>
            <option value="type">type (transactionType)</option>
          </select>
        )}
        <span style={labelSt}>→ as $</span>
        <input
          value={src.variableName}
          onChange={e => onUpdate({ variableName: e.target.value.replace(/\W/g, "") })}
          style={{ ...inputSt, width: 70 }}
          placeholder="varName"
        />
        <button style={removeBtnSt} onClick={onRemove}>✕</button>
      </div>
      {entityTypeInfo?.hint && (
        <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)", paddingLeft: 6 }}>
          {entityTypeInfo.hint}
        </div>
      )}
      {src.entityType === "localField" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6 }}>
          <input
            type="checkbox"
            id={`nodeInput-${src.id}`}
            checked={!!src.nodeInput}
            onChange={e => onUpdate({ nodeInput: e.target.checked })}
            style={{ cursor: "pointer" }}
          />
          <label htmlFor={`nodeInput-${src.id}`} style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
            Show as input on operation node
          </label>
        </div>
      )}
    </div>
  );
}

// ---- DraggableStepWrapper — drag handle + edge drop target per step ----
function DraggableStepWrapper({ step, depth, steps, onReorder, children }) {
  const containerRef = useRef(null);
  const handleRef = useRef(null);
  const [closestEdge, setClosestEdge] = useState(null);

  useLayoutEffect(() => {
    const handleEl = handleRef.current;
    const containerEl = containerRef.current;

    if (!(handleEl instanceof HTMLElement)) return;
    if (!(containerEl instanceof HTMLElement)) return;
    if (!step?.id) return;

    const cleanupDrag = draggable({
      element: handleEl,
      getInitialData: () => ({
        type: "pipeline-step",
        stepId: step.id,
        depth,
      }),
    });

    const cleanupDrop = dropTargetForElements({
      element: containerEl,
      canDrop: ({ source }) =>
        source?.data?.type === "pipeline-step" &&
        source?.data?.depth === depth &&
        source?.data?.stepId !== step.id,

      getData: ({ input }) =>
        attachClosestEdge(
          { stepId: step.id },
          { element: containerEl, input, allowedEdges: ["top", "bottom"] }
        ),

      onDrag: ({ self }) =>
        setClosestEdge(extractClosestEdge(self.data)),

      onDragLeave: () => setClosestEdge(null),

      onDrop: ({ source, self }) => {
        setClosestEdge(null);

        const sourceId = source?.data?.stepId;
        if (!sourceId) return;

        const fromIdx = steps.findIndex(s => s.id === sourceId);
        const toIdx = steps.findIndex(s => s.id === step.id);

        if (fromIdx === -1 || toIdx === -1) return;

        let insertAt =
          extractClosestEdge(self.data) === "top"
            ? toIdx
            : toIdx + 1;

        if (fromIdx < toIdx) insertAt--;

        onReorder(arrayMove(steps, fromIdx, insertAt));
      },
    });

    return () => {
      cleanupDrag?.();
      cleanupDrop?.();
    };
  }, [step.id, depth, steps, onReorder]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {closestEdge === "top" && <div style={topIndicator} />}

      {React.cloneElement(children, { dragHandleRef: handleRef })}

      {closestEdge === "bottom" && <div style={bottomIndicator} />}
    </div>
  );
}
// ---- Steps List (recursive for nested if/else) ----
function StepsList({ steps, onChange, fields, varOptions, modulesById, operationsById, sources = [], depth = 0 }) {
  const addAction = () => onChange([...steps, { id: uid(), type: "action", config: { type: "INIT_VAR" } }]);
  const addIf = () => onChange([...steps, {
    id: uid(), type: "if",
    condition: { operator: "AND", rules: [{ id: uid(), left: "$trigger.value", comparator: "IS", right: "" }] },
    then: [], else: [],
  }]);
  const addLoop = () => onChange([...steps, {
    id: uid(), type: "loop",
    overExpr: "$allOccurrences", as: "$item",
    body: [],
  }]);

  const updateStep = (id, patch) => onChange(steps.map(s => s.id === id ? { ...s, ...patch } : s));
  const removeStep = (id) => onChange(steps.filter(s => s.id !== id));

  const shared = { fields, varOptions, modulesById, operationsById, sources };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: depth > 0 ? 8 : 0 }}>
      {steps.map((step) => {
        const stepProps = {
          step,
          onUpdate: patch => updateStep(step.id, patch),
          onRemove: () => removeStep(step.id),
          ...shared,
        };

        const inner =
          step.type === "if"
            ? <IfStep {...stepProps} />
            : step.type === "loop"
              ? <LoopStep {...stepProps} />
              : <ActionStep {...stepProps} />;

        return (
          <DraggableStepWrapper
            key={step.id}
            step={step}
            depth={depth}
            steps={steps}
            onReorder={onChange}
          >
            {inner}
          </DraggableStepWrapper>
        );
      })}
      <div style={{ display: "flex", gap: 4 }}>
        <button style={addBtnStyle} onClick={addAction}>+ Action</button>
        <button style={addBtnStyle} onClick={addIf}>+ If</button>
        <button style={{ ...addBtnStyle, color: "rgba(167,139,250,0.7)" }} onClick={addLoop}>+ Loop</button>
      </div>
    </div>
  );
}

// ---- ExprInput — open text input accepting any expression ----
// Accepts: literals (5, "hello", true), variables ($item.label), built-ins ($allOccurrences),
//          model refs (occ:$id.fieldId.value, field:id.value), or any other expression string.
function ExprInput({ value, onChange, placeholder, width = 120, title }) {
  const hint = [
    "Literals: 5   true   \"text\"",
    "Variables: $myVar   $item.label   $item.calories",
    "Built-in arrays: $allOccurrences   $allModules   $allFields",
    "Built-ins: $today   $now   $iterationValue   $grid",
    "Trigger: $trigger.occurrenceId   $trigger.value",
    "Occurrence field: occ:$item.occurrenceId.fieldId.value",
    "Field (first match): field:fieldId.value",
  ].join("\n");
  return (
    <input
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || "expr or value"}
      title={title || hint}
      style={{ ...inputSt, width, fontFamily: "monospace", fontSize: 10 }}
    />
  );
}

// ---- ExprOrPath — toggles between free-text ExprInput and cascading PathPicker ----
// Use for fields that commonly take $trigger.* / $item.* expressions. Defaults to
// path mode when value starts with $, text mode otherwise.
function ExprOrPath({ value, onChange, placeholder, width = 160, sources = [], fields = [], inLoop = true }) {
  const initialMode = (value ?? "").trim().startsWith("$") || !value ? "path" : "text";
  const [mode, setMode] = useState(initialMode);
  const pathConfig = useMemo(() => buildPathConfig({ sources, fields, inLoop }), [sources, fields, inLoop]);
  const toggle = () => setMode(m => (m === "path" ? "text" : "path"));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <button
        onClick={toggle}
        title="Toggle path picker / free text"
        style={{ fontSize: 9, padding: "1px 4px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer" }}
      >
        {mode === "path" ? "path" : "text"}
      </button>
      {mode === "path"
        ? <SelectDrilldown
            config={pathConfig}
            value={value ? [pathStringToChain(value)] : []}
            onChange={chains => onChange(chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "")}
          />
        : <ExprInput value={value} onChange={onChange} placeholder={placeholder} width={width} />}
    </div>
  );
}

// ---- LoopStep ----
// loop [overExpr] as $[varName] { body steps }
function LoopStep({ step, onUpdate, onRemove, fields, varOptions, modulesById, operationsById, sources = [], dragHandleRef }) {
  const shared = { fields, varOptions, modulesById, operationsById, sources };
  const varName = (step.as || "$item").replace(/^\$/, "");

  return (
    <div style={{ ...ifStepSt, borderLeftColor: "rgba(167,139,250,0.4)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace", minWidth: 28 }}>loop</span>
        <ExprInput
          value={step.overExpr || ""}
          onChange={v => onUpdate({ overExpr: v })}
          placeholder="$allOccurrences or any array"
          width={180}
          title="Any expression that resolves to an array. Examples:\n$allOccurrences\n$allModules\n$myArr\n$allFields"
        />
        <span style={labelSt}>as $</span>
        <input
          value={varName}
          onChange={e => onUpdate({ as: `$${e.target.value.replace(/\W/g, "")}` })}
          placeholder="item"
          style={{ ...inputSt, width: 70, fontFamily: "monospace" }}
        />
        <div ref={dragHandleRef} style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <GripVertical style={{ width: 10, height: 10, opacity: 0.25, cursor: "grab", flexShrink: 0 }} />
          <button style={removeBtnSt} onClick={onRemove}>✕</button>
        </div>
      </div>
      {/* Body */}
      <div style={{ paddingLeft: 10, borderLeft: "2px solid rgba(167,139,250,0.2)", marginTop: 4 }}>
        <StepsList steps={step.body || []} onChange={body => onUpdate({ body })} {...shared} depth={1} />
      </div>
    </div>
  );
}

// ---- Action Step ----
function ActionStep({ step, onUpdate, onRemove, fields, varOptions, modulesById, operationsById, sources = [], dragHandleRef }) {
  const cfg = step.config || {};
  const actionType = cfg.type || "SHOW_VALUE";
  const setCfg = patch => onUpdate({ config: { ...cfg, ...patch } });

  return (
    <div style={actionStepSt}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 9, color: "rgba(99,202,183,0.6)", fontFamily: "monospace", minWidth: 38 }}>action</span>
        <select value={actionType} onChange={e => onUpdate({ config: { type: e.target.value } })} style={selectSt}>
          <optgroup label="— Variables —">
            {VAR_ACTION_TYPES.map(at => <option key={at.value} value={at.value}>{at.label}</option>)}
          </optgroup>
          <optgroup label="— System —">
            {SYSTEM_ACTION_TYPES.map(at => <option key={at.value} value={at.value}>{at.label}</option>)}
          </optgroup>
        </select>
        <div ref={dragHandleRef} style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <GripVertical style={{ width: 10, height: 10, opacity: 0.25, cursor: "grab", flexShrink: 0 }} />
          <button style={removeBtnSt} onClick={onRemove}>✕</button>
        </div>
      </div>
      <div style={{ paddingLeft: 44 }}>
        <ActionConfig actionType={actionType} cfg={cfg} setCfg={setCfg} fields={fields} varOptions={varOptions} modulesById={modulesById} operationsById={operationsById} sources={sources} />
      </div>
    </div>
  );
}

// ---- If Step ----
function IfStep({ step, onUpdate, onRemove, fields, varOptions, modulesById, operationsById, sources = [], dragHandleRef }) {
  const condition = step.condition || { operator: "AND", rules: [] };
  const [showElse, setShowElse] = useState((step.else || []).length > 0);

  const updateCond = patch => onUpdate({ condition: { ...condition, ...patch } });
  const addRule = () => updateCond({ rules: [...condition.rules, { id: uid(), left: "$trigger.value", comparator: "IS", right: "" }] });
  const updateRule = (rid, patch) => updateCond({ rules: condition.rules.map(r => r.id === rid ? { ...r, ...patch } : r) });
  const removeRule = rid => updateCond({ rules: condition.rules.filter(r => r.id !== rid) });

  const shared = { fields, varOptions, modulesById, operationsById, sources };
  console.log(step.id);
  return (
    <div key={step.id} style={ifStepSt}>
      {/* IF header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "rgba(251,191,36,0.8)", fontFamily: "monospace", minWidth: 16 }}>if</span>
        <span style={{ ...labelSt, fontStyle: "italic" }}>all/any of the following are true:</span>
        <div ref={dragHandleRef} style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <GripVertical style={{ width: 10, height: 10, opacity: 0.25, cursor: "grab", flexShrink: 0 }} />
          <button style={removeBtnSt} onClick={onRemove}>✕</button>
        </div>
      </div>

      {/* Condition groups (nested AND/OR) */}
      <div style={{ paddingLeft: 10 }}>
        <ConditionGroup
          group={condition}
          onChange={next => onUpdate({ condition: next })}
          sources={sources}
          fields={fields}
        />
      </div>

      {/* THEN */}
      <div style={{ paddingLeft: 10, borderLeft: "2px solid rgba(99,202,183,0.2)" }}>
        <span style={{ ...labelSt, display: "block", marginBottom: 3 }}>then:</span>
        <StepsList steps={step.then || []} onChange={then => onUpdate({ then })} {...shared} depth={1} />
      </div>

      {/* ELSE */}
      {!showElse ? (
        <div style={{ paddingLeft: 10 }}>
          <button style={addBtnStyle} onClick={() => setShowElse(true)}>+ else</button>
        </div>
      ) : (
        <div style={{ paddingLeft: 10, borderLeft: "2px solid rgba(252,165,165,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={labelSt}>else:</span>
            <button style={{ ...addBtnStyle, color: "rgba(255,100,100,0.4)" }} onClick={() => { setShowElse(false); onUpdate({ else: [] }); }}>remove else</button>
          </div>
          <StepsList steps={step.else || []} onChange={elseSteps => onUpdate({ else: elseSteps })} {...shared} depth={1} />
        </div>
      )}
    </div>
  );
}

// ---- Condition Rule ----
// All comparators including date and string variants
const ALL_COMPARATORS = [
  { value: "IS", label: "=" },
  { value: "IS_NOT", label: "≠" },
  { value: "GREATER", label: ">" },
  { value: "LESS", label: "<" },
  { value: "GREATER_OR_EQUAL", label: ">=" },
  { value: "LESS_OR_EQUAL", label: "<=" },
  { value: "CONTAINS", label: "contains" },
  { value: "NOT_CONTAINS", label: "not contains" },
  { value: "IS_EMPTY", label: "is empty" },
  { value: "IS_NOT_EMPTY", label: "not empty" },
  { value: "DATE_BEFORE_TODAY", label: "date before today" },
  { value: "DATE_IS_TODAY", label: "date is today" },
  { value: "DATE_AFTER_TODAY", label: "date after today" },
  { value: "DATE_WITHIN_DAYS", label: "date within N days" },
];

function ConditionRule({ rule, onUpdate, onRemove, fields = [], sources = [] }) {
  const noRight = ["IS_EMPTY", "IS_NOT_EMPTY", "DATE_BEFORE_TODAY", "DATE_IS_TODAY", "DATE_AFTER_TODAY"].includes(rule.comparator);
  const pathConfig = useMemo(() => buildPathConfig({ sources, fields, inLoop: true }), [sources, fields]);
  return (
    <div style={rowStyle}>
      <SelectDrilldown
        config={pathConfig}
        value={rule.left ? [pathStringToChain(rule.left)] : []}
        onChange={chains => onUpdate({ left: chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "" })}
      />
      <select value={rule.comparator} onChange={e => onUpdate({ comparator: e.target.value })} style={selectSt}>
        {ALL_COMPARATORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {!noRight && (
        <ExprInput value={rule.right} onChange={v => onUpdate({ right: v })} placeholder="right side" width={120} />
      )}
      <button style={removeBtnSt} onClick={onRemove}>✕</button>
    </div>
  );
}

// ---- Action Config (field config rendered below action type) ----
function ActionConfig({ actionType, cfg, setCfg, fields, varOptions, modulesById, operationsById, sources = [] }) {
  const allContainers = useMemo(() => Object.values(modulesById).filter(m => m.role === "container"), [modulesById]);
  const allInstances = useMemo(() => Object.values(modulesById).filter(m => m.role === "instance"), [modulesById]);
  const allOps = useMemo(() => Object.values(operationsById), [operationsById]);

  const fl = text => <span style={labelSt}>{text}</span>;

  // Helper: variable name input strip leading $
  const varNameInput = (key, placeholder = "varName") => (
    <input
      value={(cfg[key] || "").replace(/^\$/, "")}
      onChange={e => setCfg({ [key]: `$${e.target.value.replace(/\W/g, "")}` })}
      placeholder={placeholder}
      style={{ ...inputSt, width: 80, fontFamily: "monospace" }}
    />
  );

  switch (actionType) {
    // ---- Variable operations ----
    case "INIT_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("=")}
          <ExprInput value={cfg.expr ?? String(cfg.value ?? "")} onChange={v => setCfg({ expr: v, value: undefined })} placeholder="5   or   $item.label   or   false" width={150} />
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontStyle: "italic" }}>initial value (any type)</span>
        </div>
      );

    case "SET_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("=")}
          <ExprInput value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.calories   or   5" width={150} />
        </div>
      );

    case "ADD_TO_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("+=")}
          <ExprInput value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.value   or   5" width={150} />
        </div>
      );

    case "SUBTRACT_FROM_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("-=")}
          <ExprInput value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.value   or   3" width={150} />
        </div>
      );

    case "MULTIPLY_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("*=")}
          <ExprInput value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$factor   or   2" width={150} />
        </div>
      );

    case "DIV_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("/=")}
          <ExprInput value={cfg.by || ""} onChange={v => setCfg({ by: v })} placeholder="$count   or   100" width={150} />
        </div>
      );

    case "INCREMENT_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("+=")}
          <ExprInput value={cfg.by || "1"} onChange={v => setCfg({ by: v })} placeholder="1" width={80} />
        </div>
      );

    case "DECREMENT_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("-=")}
          <ExprInput value={cfg.by || "1"} onChange={v => setCfg({ by: v })} placeholder="1" width={80} />
        </div>
      );

    case "PUSH_TO_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("[].push")}
          <ExprInput value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item   or   value" width={150} />
        </div>
      );

    // ---- Display ----
    case "SHOW_VALUE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("field:")} <FieldPicker value={cfg.targetFieldId} onChange={v => setCfg({ targetFieldId: v })} fields={fields} />
          {fl("value:")} <ExprInput value={cfg.sourceExpr || ""} onChange={v => setCfg({ sourceExpr: v })} placeholder="$total   or   $item.value" />
        </div>
      );

    case "AGGREGATE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("source field:")}
          <select value={cfg.fieldId || ""} onChange={e => setCfg({ fieldId: e.target.value })} style={selectSt}>
            <option value="">All fields...</option>
            {fields.map(f => <option key={f.id} value={f.id}>{f.name || f.type}</option>)}
          </select>
          <select value={cfg.aggregation || "sum"} onChange={e => setCfg({ aggregation: e.target.value })} style={selectSt}>
            {AGGREGATION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={cfg.timeFilter || "daily"} onChange={e => setCfg({ timeFilter: e.target.value })} style={selectSt}>
            {["daily", "weekly", "monthly", "yearly", "all"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={cfg.flowFilter || "any"} onChange={e => setCfg({ flowFilter: e.target.value })} style={selectSt}>
            {["any", "in", "out"].map(f => <option key={f} value={f}>{f} flow</option>)}
          </select>
          {fl("→ display in:")} <FieldPicker value={cfg.targetFieldId} onChange={v => setCfg({ targetFieldId: v })} fields={fields} placeholder="Display in field..." />
          <input value={cfg.targetValue || ""} onChange={e => setCfg({ targetValue: e.target.value ? Number(e.target.value) : undefined })} style={{ ...inputSt, width: 50 }} placeholder="target" type="number" title="Target value for progress bar" />
          <select value={cfg.targetPeriod || "daily"} onChange={e => setCfg({ targetPeriod: e.target.value })} style={selectSt}>
            {["daily", "weekly", "monthly", "yearly"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      );

    case "SET_FIELD_VALUE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("occurrence:")}
          <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
          {fl("field:")} <FieldPicker value={cfg.fieldId} onChange={v => setCfg({ fieldId: v })} fields={fields} />
          {fl("=")}
          <ExprOrPath value={cfg.valueExpr || ""} onChange={v => setCfg({ valueExpr: v })} placeholder="$item.value or 5 or true" width={120} sources={sources} fields={fields} />
          <select value={cfg.flow || "replace"} onChange={e => setCfg({ flow: e.target.value })} style={selectSt}>
            {["replace", "in", "out"].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      );

    case "INCREMENT_FIELD":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("field:")} <FieldPicker value={cfg.targetFieldId} onChange={v => setCfg({ targetFieldId: v })} fields={fields} />
          {fl("by:")}
          <input value={cfg.amount ?? "1"} onChange={e => setCfg({ amount: e.target.value })} style={{ ...inputSt, width: 50 }} type="number" placeholder="1" />
          <span style={{ ...labelSt, fontStyle: "italic" }}>(negative = decrement)</span>
        </div>
      );

    case "MARK_COMPLETE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("completed field:")}
          <select value={cfg.completedFieldId || ""} onChange={e => setCfg({ completedFieldId: e.target.value })} style={selectSt}>
            <option value="">Pick boolean field...</option>
            {fields.filter(f => f.type === "boolean").map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={cfg.markValue !== false} onChange={e => setCfg({ markValue: e.target.checked })} />
            set checked
          </label>
        </div>
      );

    case "MOVE_OCCURRENCE": {
      const useExprTarget = !!cfg.toContainerIdExpr;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("occurrence:")}
            <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("to container:")}
            <button
              style={{ ...moveBtnSt, fontSize: 9, border: "1px solid var(--input-border)", borderRadius: 3, padding: "1px 5px" }}
              onClick={() => setCfg(useExprTarget ? { toContainerIdExpr: undefined } : { toContainerId: undefined })}
              title="Toggle static/dynamic container"
            >
              {useExprTarget ? "expr" : "static"}
            </button>
            {useExprTarget
              ? <ExprOrPath value={cfg.toContainerIdExpr || ""} onChange={v => setCfg({ toContainerIdExpr: v })} placeholder="$trigger.toContainerId or cont:id" sources={sources} fields={fields} />
              : (
                <select value={cfg.toContainerId || ""} onChange={e => setCfg({ toContainerId: e.target.value })} style={selectSt}>
                  <option value="">Pick container...</option>
                  {allContainers.map(c => <option key={c.id} value={c.id}>{c.label || c.id}</option>)}
                </select>
              )
            }
          </div>
        </div>
      );
    }

    case "REMOVE_OCCURRENCE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("occurrence:")}
          <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
        </div>
      );

    case "CREATE_OCCURRENCE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("from instance:")}
          <select value={cfg.instanceId || ""} onChange={e => setCfg({ instanceId: e.target.value })} style={selectSt}>
            <option value="">Pick instance template...</option>
            {allInstances.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
          {fl("in container:")}
          <select value={cfg.containerId || ""} onChange={e => setCfg({ containerId: e.target.value })} style={selectSt}>
            <option value="">Pick container...</option>
            {allContainers.map(c => <option key={c.id} value={c.id}>{c.label || c.id}</option>)}
          </select>
        </div>
      );

    case "UPDATE_MODULE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("module:")}
          <ExprOrPath value={cfg.moduleId || "$trigger.moduleId"} onChange={v => setCfg({ moduleId: v })} placeholder="$item.id or moduleId" sources={sources} fields={fields} />
          {fl("patch (JSON):")}
          <input value={cfg.patchJson || "{}"} onChange={e => setCfg({ patchJson: e.target.value })} style={{ ...inputSt, width: 200, fontFamily: "monospace" }} placeholder='{"label": "$item.label"}' />
        </div>
      );

    case "UPDATE_STYLE": {
      const style = cfg.style || {};
      const styleKeys = ["background", "color", "border", "borderRadius", "fontSize", "opacity", "padding"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={rowStyle}>
            {fl("module:")}
            <ExprOrPath value={cfg.moduleId || "$trigger.moduleId"} onChange={v => setCfg({ moduleId: v })} placeholder="$item.id or moduleId" sources={sources} fields={fields} />
          </div>
          {styleKeys.map(k => (
            <div key={k} style={rowStyle}>
              {fl(`${k}:`)}
              <ExprInput value={style[k] || ""} onChange={v => setCfg({ style: { ...style, [k]: v || undefined } })} placeholder="value or $var or leave blank" width={150} />
            </div>
          ))}
        </div>
      );
    }

    case "DELETE_MODULE":
      return (
        <div style={rowStyle}>
          {fl("module:")}
          <ExprOrPath value={cfg.moduleId || "$trigger.moduleId"} onChange={v => setCfg({ moduleId: v })} placeholder="$item.id or moduleId" sources={sources} fields={fields} />
        </div>
      );

    case "APPEND_TO_DOC":
      return (
        <div style={rowStyle}>
          {fl("occurrence:")}
          <ExprInput value={cfg.occurrenceId || ""} onChange={v => setCfg({ occurrenceId: v })} placeholder="$item.id or occurrenceId" width={140} />
          {fl("text:")}
          <ExprInput value={cfg.content || ""} onChange={v => setCfg({ content: v })} placeholder="$item.label or text" width={150} />
        </div>
      );

    case "NOTIFY":
      return (
        <ExprInput value={cfg.message || ""} onChange={v => setCfg({ message: v })} placeholder="message text or $var" width={200} />
      );

    case "RUN_OPERATION":
      return (
        <div style={rowStyle}>
          {fl("operation:")}
          <select value={cfg.operationId || ""} onChange={e => setCfg({ operationId: e.target.value })} style={selectSt}>
            <option value="">Pick operation...</option>
            {allOps.map(o => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
          </select>
        </div>
      );

    case "CREATE_OCCURRENCE_WITH_ITERATION":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("module:")}
          <ExprInput value={cfg.moduleId || ""} onChange={v => setCfg({ moduleId: v })} placeholder="moduleId or $var.id" width={160} />
          {fl("folder:")}
          <ExprInput value={cfg.containerId || ""} onChange={v => setCfg({ containerId: v })} placeholder="folderId or $lastCreatedFolderId" width={160} />
          {fl("date:")}
          <ExprInput value={cfg.iterationValue || "$iterationValue"} onChange={v => setCfg({ iterationValue: v })} placeholder="$iterationValue or ISO date" width={160} />
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontStyle: "italic" }}>→ sets $lastCreatedOccurrenceId</span>
        </div>
      );

    case "NAVIGATE_DAY_PAGE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("module:")}
          <ExprInput value={cfg.moduleId || ""} onChange={v => setCfg({ moduleId: v })} placeholder="dayPageModuleId or $var.id" width={160} />
          {fl("view:")}
          <ExprInput value={cfg.viewId || ""} onChange={v => setCfg({ viewId: v })} placeholder="dayPageViewId or $var.id" width={160} />
          {fl("date:")}
          <ExprInput value={cfg.iterationValue || "$iterationValue"} onChange={v => setCfg({ iterationValue: v })} placeholder="$iterationValue or ISO date" width={160} />
        </div>
      );

    case "UPDATE_VIEW":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("view:")}
          <ExprInput value={cfg.viewId || ""} onChange={v => setCfg({ viewId: v })} placeholder="viewId or $var.id" width={160} />
          {fl("activeOccurrenceId:")}
          <ExprInput value={cfg.activeOccurrenceId || ""} onChange={v => setCfg({ activeOccurrenceId: v })} placeholder="$lastCreatedOccurrenceId or occId" width={160} />
        </div>
      );

    case "APPLY_TEMPLATE": {
      const templates = (typeof window !== "undefined" && window.__moduli_state__?.grid?.templates) || [];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("container:")}
          <ExprInput value={cfg.containerId || ""} onChange={v => setCfg({ containerId: v })} placeholder="$lastCreatedOccurrenceId or containerId" width={160} />
          {fl("template:")}
          <select value={cfg.templateId || ""} onChange={e => setCfg({ templateId: e.target.value })} style={selectSt}>
            <option value="">Pick template or enter $var...</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
          </select>
          <ExprInput value={cfg.templateId || ""} onChange={v => setCfg({ templateId: v })} placeholder="$var.id or templateId" width={120} />
        </div>
      );
    }

    case "CREATE_FOLDER":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("name:")}
          <ExprInput value={cfg.name || ""} onChange={v => setCfg({ name: v })} placeholder="Day Pages or $var" width={120} />
          {fl("parent:")}
          <ExprInput value={cfg.parentId || ""} onChange={v => setCfg({ parentId: v })} placeholder="rootFolderId or $var.id" width={160} />
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontStyle: "italic" }}>→ sets $lastCreatedFolderId</span>
        </div>
      );

    case "RESET_RECURRING_TASK": {
      const boolFields = fields.filter(f => f.type === "boolean");
      const dateFields = fields.filter(f => f.type === "date");
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("completion field:")}
          <select value={cfg.completionFieldId || ""} onChange={e => setCfg({ completionFieldId: e.target.value })} style={selectSt}>
            <option value="">Pick boolean field...</option>
            {boolFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {fl("due date field:")}
          <select value={cfg.dueDateFieldId || ""} onChange={e => setCfg({ dueDateFieldId: e.target.value })} style={selectSt}>
            <option value="">Pick date field...</option>
            {dateFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {fl("recur every:")}
          <input value={cfg.recurrenceDays ?? 365} onChange={e => setCfg({ recurrenceDays: Number(e.target.value) })} style={{ ...inputSt, width: 50 }} type="number" min={1} />
          {fl("days")}
        </div>
      );
    }

    case "DISPLAY_LOCAL_FIELDS": {
      const displayFields = cfg.fields || [];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={labelSt}>Rows to show on the node:</span>
          {displayFields.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input
                value={f.label || ""}
                onChange={e => { const next = [...displayFields]; next[i] = { ...next[i], label: e.target.value }; setCfg({ fields: next }); }}
                style={{ ...inputSt, width: 80 }}
                placeholder="label"
              />
              <span style={labelSt}>:</span>
              <ExprInput
                value={f.expr || ""}
                onChange={v => { const next = [...displayFields]; next[i] = { ...next[i], expr: v }; setCfg({ fields: next }); }}
                placeholder="$total or $a + $b"
                width={130}
              />
              <button style={removeBtnSt} onClick={() => setCfg({ fields: displayFields.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button style={addBtnStyle} onClick={() => setCfg({ fields: [...displayFields, { label: "", expr: "" }] })}>+ Row</button>
        </div>
      );
    }

    case "CYCLE_FIELD_VALUE": {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={labelSt}>Source (select field):</span>
            <FieldPicker value={cfg.sourceFieldId} onChange={v => setCfg({ ...cfg, sourceFieldId: v })} fields={allFields.filter(f => f.type === "select")} placeholder="Select field..." />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={labelSt}>Write label to:</span>
            <FieldPicker value={cfg.targetFieldId} onChange={v => setCfg({ ...cfg, targetFieldId: v })} fields={allFields} placeholder="Target field..." />
          </div>
          <span style={{ ...labelSt, opacity: 0.5 }}>Cycles by day-of-year (one option per day)</span>
        </div>
      );
    }

    case "ADD_TO_POOL": {
      const poolContainers = Object.values(modulesById).filter(m => m.kind === "pool");
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("pool:")}
          <select value={cfg.poolContainerId || ""} onChange={e => setCfg({ ...cfg, poolContainerId: e.target.value })} style={selectSt}>
            <option value="">Pick pool container...</option>
            {poolContainers.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
          {fl("label expr:")}
          <ExprInput value={cfg.labelExpr || cfg.label || ""} onChange={v => setCfg({ ...cfg, labelExpr: v, label: undefined })} placeholder="$trigger.label or &quot;My Item&quot;" width={140} />
        </div>
      );
    }

    case "REMOVE_FROM_POOL": {
      const poolContainers = Object.values(modulesById).filter(m => m.kind === "pool");
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("pool:")}
          <select value={cfg.poolContainerId || ""} onChange={e => setCfg({ ...cfg, poolContainerId: e.target.value })} style={selectSt}>
            <option value="">Pick pool container...</option>
            {poolContainers.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
          {fl("module ID expr:")}
          <ExprInput value={cfg.moduleIdExpr || ""} onChange={v => setCfg({ ...cfg, moduleIdExpr: v })} placeholder="$trigger.instanceId" width={160} />
        </div>
      );
    }

    default:
      return null;
  }
}

// ---- Field Picker Helper ----
function FieldPicker({ value, onChange, fields, placeholder = "Pick field..." }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} style={selectSt}>
      <option value="">{placeholder}</option>
      {fields.map(f => <option key={f.id} value={f.id}>{f.name || f.type}</option>)}
    </select>
  );
}

/**
 * useOperationsBuilder - Hook version for more control
 */
export function useOperationsBuilder({
  initialBlocks,
  availableFields = [],
  context = {},
}) {
  const [rootBlock, setRootBlock] = useState(() => {
    if (!initialBlocks) return null;
    if (initialBlocks.id) return initialBlocks;
    return deserializeBlockTree(initialBlocks, { fields: availableFields });
  });

  const fieldsById = useMemo(() => {
    const map = {};
    for (const field of availableFields) {
      map[field.id] = field;
    }
    return map;
  }, [availableFields]);

  const result = useMemo(() => {
    if (!rootBlock) return { value: null, errors: [] };
    return evaluateBlockTree(rootBlock, {
      state: context.state || {},
      fieldsById,
      variables: {},
    });
  }, [rootBlock, context.state, fieldsById]);

  const serialized = useMemo(() => {
    return serializeBlockTree(rootBlock);
  }, [rootBlock]);

  return {
    rootBlock,
    setRootBlock,
    result,
    serialized,
    description: rootBlock ? describeBlock(rootBlock) : "",
  };
}

export { BlockDragProvider };
