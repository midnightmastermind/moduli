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
import ActionPicker from "../ui/ActionPicker";
import { arrayMove } from "../helpers/LayoutHelpers";
import DrilldownPicker from "../ui/DrilldownPicker";
import JsonStructureEditor from "../ui/JsonStructureEditor";
import { COLLECTION_PICKER_CONFIG, buildRecordKeyPickerConfig, TEMPLATE_PICKER_CONFIG } from "../ui/categoryRegistry";
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

// Walks the steps tree and returns every var name declared by INIT_VAR/SET_VAR/
// ADD_TO_VAR/etc. and every loop iteration var (`as`). Names always start with
// `$`. The resulting array is consumed by buildPathConfig to keep path pickers
// from rendering half-resolved chip chains for valid local refs.
function collectLocalVars(steps) {
  const found = new Set();
  function visit(stepArr) {
    if (!Array.isArray(stepArr)) return;
    for (const step of stepArr) {
      if (!step) continue;
      if (step.type === "action" && step.config) {
        const name = step.config.name || step.config.itemIdVar || step.config.itemVar;
        if (typeof name === "string" && name.startsWith("$")) found.add(name);
        // Some actions (FIND multi, RUN_OPERATION) declare both itemIdVar and itemVar
        if (step.config.itemIdVar && typeof step.config.itemIdVar === "string" && step.config.itemIdVar.startsWith("$")) found.add(step.config.itemIdVar);
        if (step.config.itemVar && typeof step.config.itemVar === "string" && step.config.itemVar.startsWith("$")) found.add(step.config.itemVar);
      }
      if (step.type === "loop") {
        // Loop iteration variable surfaces as a $var inside the loop body so
        // IF conditions / nested actions can pick it through the path picker
        // (e.g. `$preset.label` or `$item.fields.X.value`).
        if (step.as && typeof step.as === "string" && step.as.startsWith("$")) {
          found.add(step.as);
        }
        visit(step.body);
      }
      if (step.type === "if") {
        visit(step.then);
        visit(step.else);
      }
    }
  }
  visit(steps);
  return Array.from(found);
}

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
  // ---- Unified verbs (the new core CRUD set; everything below is sugar) ----
  { value: "FIND", label: "Find", hint: "Locate an item by predicate. Sets itemIdVar / itemVar." },
  { value: "CREATE", label: "Create", hint: "Mint a template-instance pair. name, role, kind, parent, fields, date, itemVar." },
  { value: "UPDATE", label: "Update", hint: "Write a value at a path. path: $item.fields.X.value, value: expr." },
  { value: "DELETE", label: "Delete", hint: "Remove an item by id. itemIdExpr: $item.id." },
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
  { value: "COPY_OCCURRENCE", label: "Copy occurrence", hint: "Deep-clone an occurrence subtree under a target. cfg: sourceOccurrenceVar, targetOccurrenceVar, includeChildren, resultVar" },
  { value: "CREATE_FOLDER", label: "Create folder", hint: "Find/create folder by name. Sets $lastCreatedFolderId" },
  { value: "RESET_RECURRING_TASK", label: "Reset recurring task", hint: "Reset completion + advance dueDate by recurrenceDays" },
  { value: "DISPLAY_LOCAL_FIELDS", label: "Display on node", hint: "Show computed values on the operation node card. cfg: fields: [{label, expr}]" },
  { value: "CYCLE_FIELD_VALUE", label: "Cycle field options", hint: "Rotate through a select field's options by day-of-year. cfg: sourceFieldId, targetFieldId" },
  { value: "ADD_TO_POOL", label: "Add to pool", hint: "Create instance in pool container. cfg: poolId, label / labelExpr" },
  { value: "REMOVE_FROM_POOL", label: "Remove from pool", hint: "Delete pool occurrence by module ID. cfg: poolId, moduleIdExpr (default: $trigger.instanceId)" },
];

const AGGREGATION_TYPES = [
  "sum", "count", "countTrue", "avg", "min", "max", "last", "first", "median", "mode", "unique", "concat", "range", "stdDev", "product",
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
export function PipelineEditor({ pipeline, onChange, fields = [], modulesById = {}, occurrencesById = {}, fieldsById, operationsById = {} }) {
  const local = pipeline || { sources: [], steps: [] };

  // Sources are no longer surfaced in the editor — they're a duplicate of
  // inline INIT_VAR steps. Existing pipelines with sources still execute (the
  // executor reads them) and we preserve them on save by passing through
  // `local.sources`, but new ops never declare any. To bind a trigger prop,
  // use an INIT_VAR step with `expr: "$trigger.fieldId"` instead.
  const sources = local.sources || [];
  const steps = local.steps || [];

  const allFields = fields;
  const mergedFieldsById = useMemo(
    () => fieldsById || Object.fromEntries(fields.map(f => [f.id, f])),
    [fieldsById, fields],
  );

  const varOptions = sources.map(s => `$${s.variableName}`);

  // Walk every step to collect local vars declared in this pipeline. Without
  // this, path pickers downstream don't recognize names introduced by
  // INIT_VAR / loop.as etc., and silently render half-resolved (e.g.
  // "$schedDate" stays as raw text instead of a chip chain). The collection
  // is order-insensitive — pipeline-time validity is the executor's job; the
  // editor just needs to know the names so chips render.
  const localVars = useMemo(() => collectLocalVars(steps), [steps]);

  const sharedProps = { fields, varOptions, localVars, modulesById, occurrencesById, fieldsById: mergedFieldsById, operationsById, sources };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* STEPS — main code flow. The header doubles as the only top-level
          chrome now that Sources is gone. */}
      <div style={pipelineStageStyle}>
        <div style={{ ...pipelineHeaderStyle, cursor: "default" }}>
          <span>⚡ Steps</span>
          <span style={{ fontSize: 9, opacity: 0.4 }}>top-down • use $trigger.* directly • declare vars with INIT_VAR</span>
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

        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

        const edge = extractClosestEdge(self.data);
        if (edge !== "top" && edge !== "bottom") return;

        let insertAt = edge === "top" ? toIdx : toIdx + 1;
        if (fromIdx < toIdx) insertAt--;
        insertAt = Math.max(0, Math.min(insertAt, steps.length - 1));

        if (insertAt === fromIdx) return;
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
function StepsList({ steps, onChange, fields, varOptions, localVars = [], modulesById, occurrencesById, fieldsById, operationsById, sources = [], depth = 0 }) {
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

  const shared = { fields, varOptions, localVars, modulesById, occurrencesById, fieldsById, operationsById, sources };

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
    "Literals: 5   true   \"text\"   literal:42",
    "Arrays: json:[1,2,3]   json:[{\"a\":1}]",
    "Variables: $myVar   $item.label   $item.calories",
    "Built-ins: $today   $now   $activeDate   $activeDateLabel   $activeDayOfWeek   $grid",
    "Need a collection or trigger prop? Add a Source row to bind it as $var.",
    "Occurrence field: occ:$item.id.fieldId.value",
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

// ---- ExprOrPath — switches between path picker, free text, and array literal ----
// Use for fields that commonly take $trigger.* / $item.* expressions. Defaults to
// path mode when value starts with $ (and isn't a literal: prefix), text otherwise.
// "array" mode stores the literal as a JSON-serialized string prefixed with "json:";
// resolveExpr already passes any non-$/non-literal: string through as-is, so we keep
// the value shape backwards-compatible by writing JSON for arrays.
function ExprOrPath({ value, onChange, placeholder, width = 160, sources = [], fields = [], fieldsById, modulesById, occurrencesById, inLoop = true, localVars = [] }) {
  const v = String(value ?? "").trim();
  const isJsonValue = v.startsWith("json:");
  const isArrayValue = v.startsWith("json:[");
  const isNullValue = value === null || v === "literal:null";
  // Default any `json:` payload (object OR array) to the structured
  // editor — friendlier than raw JSON. The "array" mode is still
  // available via the dropdown for power users who want to type JSON
  // by hand.
  const initialMode = isNullValue
    ? "null"
    : isJsonValue
    ? "structured"
    : (!v || (v.startsWith("$") && !v.startsWith("literal:"))) ? "path" : "text";
  const [mode, setMode] = useState(initialMode);

  const pickerCtx = useMemo(
    () => ({ sources, fields, fieldsById, modulesById, occurrencesById, localVars }),
    [sources, fields, fieldsById, modulesById, occurrencesById, localVars],
  );

  const switchMode = (next) => {
    setMode(next);
    // Only clear the value when the user explicitly changes mode AND the existing value
    // would be invalid for the new mode (path expects $-prefixed, array expects json:[).
    if (next === "path" && v && !v.startsWith("$")) onChange("");
    else if (next === "array" && !v.startsWith("json:[")) onChange("json:[]");
    else if (next === "structured" && !v.startsWith("json:")) onChange("json:{}");
    else if (next === "text" && (v.startsWith("json:") || isNullValue)) onChange("");
    else if (next === "null") onChange(null);
  };

  const arrayValue = isArrayValue ? v.slice(5) : "[]";

  // Parse the `json:` payload for the structured editor. Failed parses
  // fall back to null so the editor still renders rather than crashing
  // on a partially-typed value (the editor lets the user fix it).
  const structuredValue = useMemo(() => {
    if (!isJsonValue) return null;
    try { return JSON.parse(v.slice(5)); } catch { return null; }
  }, [v, isJsonValue]);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 3, flexWrap: "wrap" }}>
      <select
        value={mode}
        onChange={e => switchMode(e.target.value)}
        title="How this value is entered"
        style={{ fontSize: 9, padding: "1px 4px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer", height: 22 }}
      >
        <option value="path">path</option>
        <option value="text">text</option>
        <option value="structured">structured</option>
        <option value="array">array</option>
        <option value="null">null</option>
      </select>
      {mode === "path" && (
        <DrilldownPicker
          value={typeof value === "string" ? value : ""}
          ctx={pickerCtx}
          onChange={onChange}
        />
      )}
      {mode === "text" && (
        <ExprInput value={value} onChange={onChange} placeholder={placeholder} width={width} />
      )}
      {mode === "array" && (
        <textarea
          value={arrayValue}
          onChange={e => {
            // Validate JSON; only persist if it parses as an array.
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) onChange("json:" + e.target.value);
              else onChange("json:" + e.target.value); // keep raw text so the user can keep typing
            } catch {
              onChange("json:" + e.target.value);
            }
          }}
          placeholder='[1, 2, 3]   or   [{"a": 1}]'
          style={{ fontSize: 10, padding: "3px 5px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "monospace", width: Math.max(width, 220), minHeight: 60 }}
        />
      )}
      {mode === "structured" && (
        <div style={{ width: Math.max(width, 280), flex: "1 1 auto", minWidth: 240 }}>
          <JsonStructureEditor
            value={structuredValue}
            onChange={(next) => onChange("json:" + JSON.stringify(next))}
          />
        </div>
      )}
      {mode === "null" && (
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", padding: "3px 5px", border: "1px dashed var(--border-subtle)", borderRadius: 3 }}>
          null
        </span>
      )}
    </div>
  );
}

// ---- LoopStep ----
// loop [overExpr] { body steps }
// The iteration variable (`step.as`, default $item) is INTERNAL — record-key
// paths inside the body are expressed against the per-record shape determined
// by `overExpr`, so $item never needs to surface in the editor. We still keep
// `step.as` on the model for the executor.
function LoopStep({ step, onUpdate, onRemove, fields, varOptions, localVars = [], modulesById, occurrencesById, fieldsById, operationsById, sources = [], dragHandleRef }) {
  const shared = { fields, varOptions, localVars, modulesById, occurrencesById, fieldsById, operationsById, sources };
  const pickerCtx = useMemo(
    () => ({ sources, fields, fieldsById, modulesById, occurrencesById, localVars }),
    [sources, fields, fieldsById, modulesById, occurrencesById, localVars],
  );

  return (
    <div style={{ ...ifStepSt, borderLeftColor: "rgba(167,139,250,0.4)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace", minWidth: 28 }}>for each in</span>
        <DrilldownPicker
          value={step.overExpr || ""}
          ctx={pickerCtx}
          config={COLLECTION_PICKER_CONFIG}
          onChange={v => onUpdate({ overExpr: v, as: step.as || "$item" })}
        />
        <span style={{ fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace" }}>as $</span>
        <input
          value={(step.as || "$item").replace(/^\$/, "")}
          onChange={e => onUpdate({ as: `$${e.target.value.replace(/\W/g, "")}` })}
          placeholder="item"
          title="Loop iteration variable name. Body steps reference this as $myName."
          style={{ fontSize: 10, padding: "1px 4px", width: 80, fontFamily: "monospace", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--input-bg)", color: "var(--text-primary)" }}
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
function ActionStep({ step, onUpdate, onRemove, fields, varOptions, localVars = [], modulesById, occurrencesById, fieldsById, operationsById, sources = [], dragHandleRef }) {
  const cfg = step.config || {};
  const actionType = cfg.type || "SHOW_VALUE";
  const setCfg = patch => onUpdate({ config: { ...cfg, ...patch } });

  return (
    <div style={actionStepSt}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 9, color: "rgba(99,202,183,0.6)", fontFamily: "monospace", minWidth: 38 }}>do</span>
        <ActionPicker
          value={actionType}
          onChange={(next) => onUpdate({ config: { ...cfg, type: next } })}
        />
        <div ref={dragHandleRef} style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <GripVertical style={{ width: 10, height: 10, opacity: 0.25, cursor: "grab", flexShrink: 0 }} />
          <button style={removeBtnSt} onClick={onRemove}>✕</button>
        </div>
      </div>
      <div style={{ paddingLeft: 44 }}>
        <ActionConfig actionType={actionType} cfg={cfg} setCfg={setCfg} fields={fields} varOptions={varOptions} localVars={localVars} modulesById={modulesById} occurrencesById={occurrencesById} fieldsById={fieldsById} operationsById={operationsById} sources={sources} />
      </div>
    </div>
  );
}

// ---- If Step ----
function IfStep({ step, onUpdate, onRemove, fields, varOptions, localVars = [], modulesById, occurrencesById, fieldsById, operationsById, sources = [], dragHandleRef }) {
  const condition = step.condition || { operator: "AND", rules: [] };
  const [showElse, setShowElse] = useState((step.else || []).length > 0);

  const updateCond = patch => onUpdate({ condition: { ...condition, ...patch } });
  const addRule = () => updateCond({ rules: [...condition.rules, { id: uid(), left: "$trigger.value", comparator: "IS", right: "" }] });
  const updateRule = (rid, patch) => updateCond({ rules: condition.rules.map(r => r.id === rid ? { ...r, ...patch } : r) });
  const removeRule = rid => updateCond({ rules: condition.rules.filter(r => r.id !== rid) });

  const shared = { fields, varOptions, localVars, modulesById, occurrencesById, fieldsById, operationsById, sources };
  const opLabel = (condition.operator === "OR" ? "ANY" : "ALL");
  return (
    <div key={step.id} style={ifStepSt}>
      {/* IF header row — live readout of the top-level group's operator */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "rgba(251,191,36,0.8)", fontFamily: "monospace", minWidth: 16 }}>if</span>
        <span style={{ ...labelSt, fontStyle: "italic" }}>{opLabel} of:</span>
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
          fieldsById={fieldsById}
          modulesById={modulesById}
          occurrencesById={occurrencesById}
          localVars={localVars}
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

// ---- Action Config (field config rendered below action type) ----
function ActionConfig({ actionType, cfg, setCfg, fields, varOptions, localVars = [], modulesById, occurrencesById, fieldsById, operationsById, sources = [] }) {
  const allContainers = useMemo(() => Object.values(modulesById).filter(m => m.role === "container"), [modulesById]);
  const allInstances = useMemo(() => Object.values(modulesById).filter(m => m.role === "instance"), [modulesById]);
  const allOps = useMemo(() => Object.values(operationsById), [operationsById]);

  const fl = text => <span style={labelSt}>{text}</span>;
  // Centralized props for the path-aware expression input.
  const exprProps = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };

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
          <ExprOrPath
            value={cfg.expr ?? (Array.isArray(cfg.arrayOf) ? `json:${JSON.stringify(cfg.arrayOf)}` : String(cfg.value ?? ""))}
            onChange={v => setCfg({ expr: v, value: undefined, arrayOf: undefined })}
            placeholder="5   or   $item.label   or   false   (use array mode for lists)"
            width={150}
            {...exprProps}
          />
        </div>
      );

    case "SET_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("=")}
          <ExprOrPath value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.calories   or   5" width={150} {...exprProps} />
        </div>
      );

    case "ADD_TO_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("+=")}
          <ExprOrPath value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.value   or   5" width={150} {...exprProps} />
        </div>
      );

    case "SUBTRACT_FROM_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("-=")}
          <ExprOrPath value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item.value   or   3" width={150} {...exprProps} />
        </div>
      );

    case "MULTIPLY_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("*=")}
          <ExprOrPath value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$factor   or   2" width={150} {...exprProps} />
        </div>
      );

    case "DIV_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("/=")}
          <ExprOrPath value={cfg.by || ""} onChange={v => setCfg({ by: v })} placeholder="$count   or   100" width={150} {...exprProps} />
        </div>
      );

    case "INCREMENT_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("+=")}
          <ExprOrPath value={cfg.by || "1"} onChange={v => setCfg({ by: v })} placeholder="1" width={80} {...exprProps} />
        </div>
      );

    case "DECREMENT_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("-=")}
          <ExprOrPath value={cfg.by || "1"} onChange={v => setCfg({ by: v })} placeholder="1" width={80} {...exprProps} />
        </div>
      );

    case "PUSH_TO_VAR":
      return (
        <div style={rowStyle}>
          {fl("$")} {varNameInput("name")} {fl("[].push")}
          <ExprOrPath value={cfg.expr || ""} onChange={v => setCfg({ expr: v })} placeholder="$item   or   value" width={150} {...exprProps} />
        </div>
      );

    // ---- Unified verbs (FIND/CREATE/UPDATE/DELETE) ----
    case "FIND": {
      const predicate = cfg.predicate || { operator: "AND", rules: [] };
      const over = cfg.over || "$allOccurrences";
      const collectionPickerCtx = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };
      // The predicate's left-side picker walks the per-record shape determined
      // by `cfg.over` — picked values are bare record keys (no $-prefix). The
      // executor evaluates each rule against the current record during
      // iteration, so authors never type or pick `$item.X` in the editor.
      const leftConfig = useMemo(() => buildRecordKeyPickerConfig(over), [over]);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={rowStyle}>
            {fl("Look in")}
            <DrilldownPicker
              value={over}
              ctx={collectionPickerCtx}
              config={COLLECTION_PICKER_CONFIG}
              onChange={v => setCfg({ over: v || "$allOccurrences" })}
            />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>where</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{predicate.operator === "OR" ? "ANY rule passes" : "ALL rules pass"}</span>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <ConditionGroup
              group={predicate}
              onChange={next => setCfg({ predicate: next })}
              sources={sources}
              fields={fields}
              fieldsById={fieldsById}
              modulesById={modulesById}
              occurrencesById={occurrencesById}
              localVars={localVars}
              leftConfig={leftConfig}
            />
          </div>
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 4, marginTop: 2, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic" }}>
              Save the result so later steps can use it:
            </div>
            <div style={rowStyle}>
              {fl("Save id as $")} {varNameInput("itemIdVar", "myId")}
              <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(just the matched item's id)</span>
            </div>
            <div style={rowStyle}>
              {fl("Save full item as $")} {varNameInput("itemVar", "myItem")}
              <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(whole record — fields, label, meta, etc.)</span>
            </div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
              <input type="checkbox" checked={!!cfg.multiple} onChange={e => setCfg({ multiple: e.target.checked })} />
              Force array result
              <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(default: auto — bare item when 1 match, array when many)</span>
            </label>
          </div>
        </div>
      );
    }

    case "CREATE": {
      // Per task #30 — CREATE carries a `multiple` switch. When on, the
      // single-name + fields UI is replaced by a rows-array editor (each
      // row inherits the base role/kind/parent, overrides name/fields).
      const multiple = !!cfg.multiple;
      const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
            <input type="checkbox" checked={multiple} onChange={e => setCfg({ multiple: e.target.checked })} />
            <span>Create multiple</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(bulk-create rows of the same kind)</span>
          </label>
          {!multiple ? (
            <>
              <div style={rowStyle}>
                {fl("name")}
                <ExprOrPath value={cfg.name || ""} onChange={v => setCfg({ name: v })} placeholder='"Due"   or   $slot.label' width={160} {...exprProps} />
                {fl("role")}
                <select value={cfg.role || "container"} onChange={e => setCfg({ role: e.target.value })} style={selectSt}>
                  {["panel", "page", "container", "instance", "artifact", "textblock"].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {fl("kind")}
                <select value={cfg.kind || "list"} onChange={e => setCfg({ kind: e.target.value })} style={selectSt}>
                  {["list", "doc", "board", "canvas", "folder", "display", "pool"].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div style={rowStyle}>
                {fl("parent")}
                <ExprOrPath value={cfg.parent || ""} onChange={v => setCfg({ parent: v })} placeholder="$schedPageId" width={160} {...exprProps} />
              </div>
              <FieldsMapEditor cfg={cfg} setCfg={setCfg} fields={fields} exprProps={exprProps} />
              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 4, marginTop: 2, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic" }}>
                  Save the new item so later steps can use it (optional):
                </div>
                <div style={rowStyle}>
                  {fl("Save id as $")} {varNameInput("itemIdVar", "newId")}
                  <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(just the new item's id)</span>
                </div>
                <div style={rowStyle}>
                  {fl("Save full item as $")} {varNameInput("itemVar", "newItem")}
                  <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(whole record)</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={rowStyle}>
                {fl("role")}
                <select value={cfg.role || "instance"} onChange={e => setCfg({ role: e.target.value })} style={selectSt}>
                  {["panel", "page", "container", "instance", "artifact", "textblock"].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {fl("kind")}
                <select value={cfg.kind || "list"} onChange={e => setCfg({ kind: e.target.value })} style={selectSt}>
                  {["list", "doc", "board", "canvas", "folder", "display", "pool"].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                {fl("parent")}
                <ExprOrPath value={cfg.parent || ""} onChange={v => setCfg({ parent: v })} placeholder="$schedPageId" width={160} {...exprProps} />
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic", marginTop: 2 }}>
                Rows (one occurrence per row — same kind/role across all):
              </div>
              {rows.map((row, idx) => (
                <div key={idx} style={{ ...rowStyle, gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "var(--text-faint)", minWidth: 18 }}>#{idx + 1}</span>
                  <ExprOrPath
                    value={row.name ?? ""}
                    onChange={v => {
                      const next = [...rows];
                      next[idx] = { ...next[idx], name: v };
                      setCfg({ rows: next });
                    }}
                    placeholder="row name or $expr"
                    width={200}
                    {...exprProps}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = rows.filter((_, i) => i !== idx);
                      setCfg({ rows: next });
                    }}
                    style={removeBtnSt}
                    title="Remove row"
                  >✕</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCfg({ rows: [...rows, { name: "" }] })}
                style={addBtnStyle}
              >+ Row</button>
              <div style={rowStyle}>
                {fl("Save ids as $")} {varNameInput("resultVar", "createdIds")}
                <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(array of new occurrence ids)</span>
              </div>
            </>
          )}
        </div>
      );
    }

    case "UPDATE": {
      // Object-shaped value carries fromTemplate/tokens — render as JSON for now.
      const valueIsObject = cfg.value !== null && typeof cfg.value === "object" && !Array.isArray(cfg.value);
      const updatePickerCtx = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };
      // Color-shaped paths: trigger an inline native color picker so the
      // user can pick a hex/rgba without typing it. Detects ownStyle.bg /
      // ownStyle.color / ownStyle.textColor / .border (last segment of path
      // ends in a known color key).
      const COLOR_KEYS = new Set(["bg", "color", "textColor", "border", "borderColor"]);
      const pathSegs = typeof cfg.path === "string" ? cfg.path.split(".") : [];
      const isColorPath = pathSegs.length >= 2 && COLOR_KEYS.has(pathSegs[pathSegs.length - 1]);
      const colorVal = typeof cfg.value === "string" && /^#[0-9a-fA-F]{6}$/.test(cfg.value) ? cfg.value : "#222428";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={rowStyle}>
            {fl("path")}
            <DrilldownPicker
              value={cfg.path || ""}
              ctx={updatePickerCtx}
              onChange={v => setCfg({ path: v })}
            />
          </div>
          <div style={rowStyle}>
            {fl("value")}
            {valueIsObject ? (
              <textarea
                value={JSON.stringify(cfg.value, null, 2)}
                onChange={e => {
                  try { setCfg({ value: JSON.parse(e.target.value) }); } catch { /* ignore until valid */ }
                }}
                style={{ ...inputSt, width: 320, fontFamily: "monospace", height: 60 }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ExprOrPath value={cfg.value ?? ""} onChange={v => setCfg({ value: v })} placeholder='"$expr"   or   literal:42   or   null' width={isColorPath ? 200 : 240} {...exprProps} />
                {isColorPath && (
                  <input
                    type="color"
                    value={colorVal}
                    onChange={(e) => setCfg({ value: e.target.value })}
                    title="Pick color — writes #rrggbb. Paste rgba(...) into the value box for alpha."
                    style={{ width: 28, height: 22, padding: 0, border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
                  />
                )}
              </div>
            )}
          </div>

        </div>
      );
    }

    case "DELETE":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
            <input type="checkbox" checked={!!cfg.multiple} onChange={e => setCfg({ multiple: e.target.checked })} />
            <span>Delete multiple</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(consumes an ids[] array)</span>
          </label>
          <div style={rowStyle}>
            {cfg.multiple ? (
              <>
                {fl("ids[]")}
                <ExprOrPath value={cfg.idsExpr || ""} onChange={v => setCfg({ idsExpr: v })} placeholder="$matchedIds" width={240} {...exprProps} />
              </>
            ) : (
              <>
                {fl("delete item")}
                <ExprOrPath value={cfg.itemIdExpr || ""} onChange={v => setCfg({ itemIdExpr: v })} placeholder="$item.id" width={200} {...exprProps} />
              </>
            )}
          </div>
        </div>
      );

    // ---- Display ----
    case "SHOW_VALUE":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("field:")} <FieldPicker value={cfg.targetFieldId} onChange={v => setCfg({ targetFieldId: v })} fields={fields} />
          {fl("value:")} <ExprOrPath value={cfg.sourceExpr || ""} onChange={v => setCfg({ sourceExpr: v })} placeholder="$total   or   $item.value" {...exprProps} />
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

    case "SET_FIELD_VALUE": {
      // Display either valueExpr (expression) or value (literal). Editing this input
      // sets valueExpr and clears value so we don't strand a stale literal next to
      // a new expression. If the user types a bare literal (no $, not "literal:"),
      // we still keep it in valueExpr — the resolveExpr handler treats unprefixed
      // strings as plain values.
      const displayed = cfg.valueExpr !== undefined
        ? cfg.valueExpr
        : (cfg.value !== undefined ? (typeof cfg.value === "string" ? cfg.value : JSON.stringify(cfg.value)) : "");
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("occurrence:")}
          <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
          {fl("field:")} <FieldPicker value={cfg.fieldId} onChange={v => setCfg({ fieldId: v })} fields={fields} />
          {fl("=")}
          <ExprOrPath value={displayed} onChange={v => setCfg({ valueExpr: v, value: undefined })} placeholder="$item.value or 5 or true" width={120} sources={sources} fields={fields} />
          <select value={cfg.flow || "replace"} onChange={e => setCfg({ flow: e.target.value })} style={selectSt}>
            {["replace", "in", "out"].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      );
    }

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
      const multiple = !!cfg.multiple;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
            <input type="checkbox" checked={multiple} onChange={e => setCfg({ multiple: e.target.checked })} />
            <span>Move multiple</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(consumes ids[])</span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {multiple ? (
              <>
                {fl("ids[]:")}
                <ExprOrPath value={cfg.idsExpr || ""} onChange={v => setCfg({ idsExpr: v })} placeholder="$matchedIds" sources={sources} fields={fields} />
              </>
            ) : (
              <>
                {fl("occurrence:")}
                <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
              </>
            )}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
            <input type="checkbox" checked={!!cfg.multiple} onChange={e => setCfg({ multiple: e.target.checked })} />
            <span>Remove multiple</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>(consumes ids[])</span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {cfg.multiple ? (
              <>
                {fl("ids[]:")}
                <ExprOrPath value={cfg.idsExpr || ""} onChange={v => setCfg({ idsExpr: v })} placeholder="$matchedIds" sources={sources} fields={fields} />
              </>
            ) : (
              <>
                {fl("occurrence:")}
                <ExprOrPath value={cfg.occurrenceIdExpr || "$trigger.occurrenceId"} onChange={v => setCfg({ occurrenceIdExpr: v })} placeholder="$trigger.occurrenceId or $item.id" sources={sources} fields={fields} />
              </>
            )}
          </div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={rowStyle}>
            {fl("module:")}
            <ExprOrPath value={cfg.moduleId || "$trigger.moduleId"} onChange={v => setCfg({ moduleId: v })} placeholder="$item.id or moduleId" sources={sources} fields={fields} />
          </div>
          <div style={rowStyle}>
            {fl("patch (JSON):")}
            <input value={cfg.patchJson || "{}"} onChange={e => setCfg({ patchJson: e.target.value })} style={{ ...inputSt, width: 200, fontFamily: "monospace" }} placeholder='{"label": "$item.label"}' />
          </div>
          <AttachFieldsPicker cfg={cfg} setCfg={setCfg} fields={fields} />
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
          <select value={cfg.operationName || ""} onChange={e => setCfg({ operationName: e.target.value })} style={selectSt}>
            <option value="">Pick operation...</option>
            {allOps.map(o => <option key={o.id} value={o.name}>{o.name || o.id}</option>)}
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
      const mode = cfg.mode || "append";
      // Templates are identified by occurrence.meta.templateName (set by
      // clone_subtree_as_template + apply_template handlers + the migration
      // script). TEMPLATE_PICKER_CONFIG (categoryRegistry.js) surfaces them
      // through the same DrilldownPicker the rest of the editor uses, so
      // authors get the familiar two-pane drill instead of a bare ExprInput
      // and hand-copied IDs.
      const templatePickerCtx = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("template:")}
            <DrilldownPicker
              value={cfg.templateRef || ""}
              onChange={v => setCfg({ templateRef: v })}
              config={TEMPLATE_PICKER_CONFIG}
              ctx={templatePickerCtx}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("target:")}
            <ExprInput
              value={cfg.targetOccurrenceVar || ""}
              onChange={v => setCfg({ targetOccurrenceVar: v })}
              placeholder="$schedPageId or target occurrence id"
              width={220}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("mode:")}
            <select value={mode} onChange={e => setCfg({ mode: e.target.value })} style={selectSt}>
              <option value="append">Append (always clone fresh)</option>
              <option value="replace">Replace target&apos;s children</option>
              <option value="merge">Merge (match by identitySignature, add what&apos;s missing)</option>
            </select>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={!!cfg.unwrapRoot}
                onChange={e => setCfg({ unwrapRoot: e.target.checked })}
              />
              Unwrap root (clone template&apos;s children directly into target)
            </label>
          </div>
          {mode === "merge" && (
            <div style={{ fontSize: 10, color: "var(--text-faint)", paddingLeft: 12, lineHeight: 1.5 }}>
              Merge matches each template node against the target&apos;s children by their <code>identitySignature</code>.
              Template nodes with a signature get matched + skipped (recursing into their template children).
              Nodes without a signature always clone fresh.
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("save new occs as:")}
            <ExprInput
              value={cfg.resultVar || ""}
              onChange={v => setCfg({ resultVar: v })}
              placeholder="$newOccs (array of full occurrence stubs — usable in LOOP)"
              width={220}
            />
          </div>
        </div>
      );
    }

    case "COPY_OCCURRENCE": {
      // Deep-clones an occurrence subtree under a target parent. Uses the
      // same record picker as the rest of the editor — sourceOccurrenceVar
      // and targetOccurrenceVar accept any $var that resolves to an
      // occurrence id (so authors pair this with a FIND that bound the
      // source, plus a Source or FIND for the target).
      const copyPickerCtx = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };
      const includeChildren = cfg.includeChildren !== false;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("source:")}
            <DrilldownPicker
              value={cfg.sourceOccurrenceVar || ""}
              onChange={v => setCfg({ sourceOccurrenceVar: v })}
              ctx={copyPickerCtx}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("target:")}
            <DrilldownPicker
              value={cfg.targetOccurrenceVar || ""}
              onChange={v => setCfg({ targetOccurrenceVar: v })}
              ctx={copyPickerCtx}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={includeChildren}
                onChange={e => setCfg({ includeChildren: e.target.checked })}
              />
              Include children (deep copy)
            </label>
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {includeChildren ? "Clones the full subtree" : "Clones just the source node"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("save new occs as:")}
            <ExprInput
              value={cfg.resultVar || ""}
              onChange={v => setCfg({ resultVar: v })}
              placeholder="$newOccs (array of clone stubs)"
              width={220}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {fl("save root id as:")}
            <ExprInput
              value={cfg.resultIdVar || ""}
              onChange={v => setCfg({ resultIdVar: v })}
              placeholder="$newRootId (id of the cloned root occurrence)"
              width={220}
            />
          </div>
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
      // Read legacy `poolContainerId` if present so older ops still display
      // their selected pool. Always write to the unified `poolId` key going
      // forward — the executor reads `cfg.poolId`.
      const selectedPoolId = cfg.poolId ?? cfg.poolContainerId ?? "";
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("pool:")}
          <select value={selectedPoolId} onChange={e => setCfg({ ...cfg, poolId: e.target.value, poolContainerId: undefined })} style={selectSt}>
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
      const selectedPoolId = cfg.poolId ?? cfg.poolContainerId ?? "";
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          {fl("pool:")}
          <select value={selectedPoolId} onChange={e => setCfg({ ...cfg, poolId: e.target.value, poolContainerId: undefined })} style={selectSt}>
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

// Shared DrilldownPicker config that surfaces the grid's fields as
// one-click leaves, optionally hiding a set of already-bound ids.
function buildAttachFieldPickerConfig({ fields, excludeIds, placeholder = "Attach a field" }) {
  return {
    placeholder,
    categories: [{
      id: "fields",
      label: "Attach fields",
      description: "Picked fields are bound to the module. Toggle the eye to hide them on the rendered instance.",
      icon: undefined,
      color: "rgba(168,85,247,0.7)",
      resolveItems: () => (fields || [])
        .filter(f => !excludeIds.has(f.id))
        .map(f => ({
          value: f.id,
          title: f.name || "(unnamed field)",
          sub: f.type || "field",
          description: f.meta?.description || `${f.type || "field"} field`,
          hasChildren: false,
        })),
    }],
  };
}

// Render a per-binding hidden toggle. Reads/writes cfg.fieldHidden
// ({ [fieldId]: true }), which operationActions.js layers on top of the
// auto-attach when minting fieldBindings.
function FieldVisibilityToggle({ cfg, setCfg, fieldId }) {
  const hiddenMap = cfg.fieldHidden || {};
  const isHidden = !!hiddenMap[fieldId];
  const toggle = () => {
    const next = { ...hiddenMap };
    if (isHidden) delete next[fieldId];
    else next[fieldId] = true;
    setCfg({ fieldHidden: Object.keys(next).length ? next : undefined });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      title={isHidden ? "Hidden on instance — click to show" : "Visible on instance — click to hide"}
      style={{ border: "none", background: "none", color: isHidden ? "var(--text-faint)" : "var(--text-muted)", cursor: "pointer", padding: 2, fontSize: 11 }}
    >
      {isHidden ? "🚫" : "👁"}
    </button>
  );
}

// Attach-only picker (no value column). Writes to cfg.attachFields as an
// array of fieldIds. Pairs with FieldVisibilityToggle so authors can hide a
// purely-bound field even when it's set elsewhere.
function AttachFieldsPicker({ cfg, setCfg, fields }) {
  const list = Array.isArray(cfg.attachFields) ? cfg.attachFields.filter(Boolean) : [];
  const fieldsById = useMemo(() => Object.fromEntries((fields || []).map(f => [f.id, f])), [fields]);
  const handlePick = (picked) => {
    if (!picked) return;
    const fid = picked.split(".").pop();
    if (!fid || list.includes(fid)) return;
    setCfg({ attachFields: [...list, fid] });
  };
  const removeId = (fid) => {
    const next = list.filter(x => x !== fid);
    setCfg({ attachFields: next.length ? next : undefined });
  };
  const config = buildAttachFieldPickerConfig({ fields, excludeIds: new Set(list) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>attach fields:</div>
      <DrilldownPicker
        value=""
        onChange={handlePick}
        ctx={{ fields, sources: [], localVars: [] }}
        config={config}
      />
      {list.map(fid => {
        const f = fieldsById[fid];
        return (
          <div key={fid} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-primary)" }}>{f?.name || fid}</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>{f?.type || ""}</span>
            <FieldVisibilityToggle cfg={cfg} setCfg={setCfg} fieldId={fid} />
            <button style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2 }} onClick={() => removeId(fid)} title="remove">✕</button>
          </div>
        );
      })}
    </div>
  );
}

// Renders cfg.fields as a list of (fieldId → expression) rows, used by the
// CREATE config UI. cfg.fields is shaped `{ [fieldId]: expr }` — an object,
// not an array — because that's what operationActions expects.
//
// Any field listed here is also auto-attached to the target module's
// fieldBindings at runtime (operationActions.js), so this section is both
// "attach fields" and "assign values" in one — picking a field adds the row
// and the user fills in the value inline. The eye toggle controls per-binding
// hidden state via cfg.fieldHidden.
function FieldsMapEditor({ cfg, setCfg, fields, exprProps }) {
  const entries = Object.entries(cfg.fields || {});
  const setEntry = (oldFid, newFid, expr) => {
    const next = {};
    let replaced = false;
    for (const [fid, val] of Object.entries(cfg.fields || {})) {
      if (fid === oldFid) {
        if (newFid) next[newFid] = expr;
        replaced = true;
      } else {
        next[fid] = val;
      }
    }
    if (!replaced && newFid) next[newFid] = expr;
    setCfg({ fields: Object.keys(next).length ? next : undefined });
  };
  const boundIds = new Set(entries.map(([fid]) => fid).filter(Boolean));
  const attachPickerConfig = buildAttachFieldPickerConfig({ fields, excludeIds: boundIds });
  const handlePickField = (picked) => {
    if (!picked) return;
    const fid = picked.split(".").pop();
    if (!fid || boundIds.has(fid)) return;
    setCfg({ fields: { ...(cfg.fields || {}), [fid]: "" } });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>attach fields &amp; assign values:</div>
      <DrilldownPicker
        value=""
        onChange={handlePickField}
        ctx={{ fields, sources: [], localVars: [] }}
        config={attachPickerConfig}
      />
      {entries.map(([fid, expr], i) => (
        <div key={`${fid}_${i}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <FieldPicker value={fid} onChange={v => setEntry(fid, v, expr)} fields={fields} placeholder="(field)" />
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>=</span>
          <ExprOrPath
            value={typeof expr === "string" ? expr : (expr == null ? "" : String(expr))}
            onChange={v => setEntry(fid, fid, v)}
            placeholder="$preset.water   or   literal:Due"
            width={180}
            {...exprProps}
          />
          {fid && <FieldVisibilityToggle cfg={cfg} setCfg={setCfg} fieldId={fid} />}
          <button style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2 }} onClick={() => setEntry(fid, "", "")} title="remove">✕</button>
        </div>
      ))}
    </div>
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
