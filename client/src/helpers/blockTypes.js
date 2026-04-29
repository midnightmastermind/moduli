// blocks/blockTypes.js
// ============================================================
// Block type definitions for the visual block programming editor
// Inspired by Snap!/Scratch visual programming languages
// ============================================================

import { AGGREGATIONS, COMPARISONS } from "./CalculationHelpers";

/**
 * Block types - what kind of block it is
 */
export const BlockType = {
  // Value blocks (reporter shape - oval)
  FIELD: "field",           // Field pill reference
  LITERAL: "literal",       // Constant value (number, text, boolean)
  VARIABLE: "variable",     // Get variable value

  // Operation blocks (reporter shape)
  OPERATOR: "operator",     // Math: +, -, *, /, %
  COMPARISON: "comparison", // Logic: >, <, ==, >=, <=, !=
  LOGICAL: "logical",       // Boolean: AND, OR, NOT
  AGGREGATION: "aggregation", // sum, count, avg, min, max, etc.
  FUNCTION: "function",     // Built-in: round, abs, floor, ceil, etc.

  // Control blocks (statement/C-block shape)
  CONDITION: "condition",   // IF/THEN/ELSE
  LOOP: "loop",             // FOREACH, REPEAT
  SET_VARIABLE: "set_var",  // Set variable value

  // Trigger blocks (hat shape)
  ON_DROP: "on_drop",       // When something is dropped
  ON_CHANGE: "on_change",   // When a field value changes
  ON_LOAD: "on_load",       // When grid/app loads
  ON_ITERATION: "on_iteration", // When iteration changes (time/category)
  ON_MANUAL: "on_manual",   // Manual trigger (run button)
  ON_WEBHOOK: "on_webhook", // When an external HTTP webhook fires

  // Data blocks (reporter shape)
  TRIGGER_DATA: "trigger_data", // Reads a property from the triggering transaction

  // Action blocks (statement shape)
  ACTION: "action",         // Performs an action (SEND_TO_DISPLAY, UPDATE_FIELD, HTTP_REQUEST, etc.)
};

/**
 * Block shapes - visual appearance and snap behavior
 */
export const BlockShape = {
  REPORTER: "reporter",    // Oval pill - returns a value, snaps into slots
  STATEMENT: "statement",  // Rectangle - executes action, stacks vertically
  C_BLOCK: "c_block",      // C-shape - contains statement blocks inside
  HAT: "hat",              // Top cap - trigger/event starter (no blocks above)
  CAP: "cap",              // Bottom cap - final statement (no blocks below)
};

/**
 * Get shape for a block type
 */
export function getBlockShape(blockType) {
  switch (blockType) {
    case BlockType.FIELD:
    case BlockType.LITERAL:
    case BlockType.VARIABLE:
    case BlockType.OPERATOR:
    case BlockType.COMPARISON:
    case BlockType.LOGICAL:
    case BlockType.AGGREGATION:
    case BlockType.FUNCTION:
      return BlockShape.REPORTER;

    case BlockType.SET_VARIABLE:
      return BlockShape.STATEMENT;

    case BlockType.CONDITION:
    case BlockType.LOOP:
      return BlockShape.C_BLOCK;

    case BlockType.ON_DROP:
    case BlockType.ON_CHANGE:
    case BlockType.ON_LOAD:
    case BlockType.ON_ITERATION:
    case BlockType.ON_MANUAL:
    case BlockType.ON_WEBHOOK:
      return BlockShape.HAT;

    case BlockType.TRIGGER_DATA:
      return BlockShape.REPORTER;

    case BlockType.ACTION:
      return BlockShape.STATEMENT;

    default:
      return BlockShape.REPORTER;
  }
}

/**
 * Block colors by type (Tailwind classes)
 */
export const BLOCK_COLORS = {
  [BlockType.FIELD]: "bg-blue-500",
  [BlockType.LITERAL]: "bg-gray-500",
  [BlockType.VARIABLE]: "bg-red-400",
  [BlockType.OPERATOR]: "bg-green-500",
  [BlockType.COMPARISON]: "bg-cyan-500",
  [BlockType.LOGICAL]: "bg-cyan-600",
  [BlockType.AGGREGATION]: "bg-purple-500",
  [BlockType.FUNCTION]: "bg-teal-500",
  [BlockType.CONDITION]: "bg-orange-500",
  [BlockType.LOOP]: "bg-yellow-500",
  [BlockType.SET_VARIABLE]: "bg-red-500",
  [BlockType.ON_DROP]: "bg-amber-600",
  [BlockType.ON_CHANGE]: "bg-amber-600",
  [BlockType.ON_LOAD]: "bg-amber-700",
  [BlockType.ON_ITERATION]: "bg-amber-700",
  [BlockType.ON_MANUAL]: "bg-amber-500",
  [BlockType.ON_WEBHOOK]: "bg-violet-600",
  [BlockType.TRIGGER_DATA]: "bg-rose-400",
  [BlockType.ACTION]: "bg-emerald-600",
};

/**
 * Create a new block with default structure
 */
export function createBlock(type, data = {}, options = {}) {
  const shape = options.shape || getBlockShape(type);
  const id = options.id || `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const block = {
    id,
    type,
    shape,
    label: options.label || getDefaultLabel(type, data),
    color: BLOCK_COLORS[type] || "bg-gray-500",
    slots: getDefaultSlots(type, data),
    innerSlots: shape === BlockShape.C_BLOCK ? [{ id: `inner-${id}`, connected: [] }] : undefined,
    data,
  };

  return block;
}

/**
 * Get default label for block type
 */
function getDefaultLabel(type, data) {
  switch (type) {
    case BlockType.FIELD:
      return data.fieldName || "Field";
    case BlockType.LITERAL:
      return String(data.value ?? "?");
    case BlockType.VARIABLE:
      return data.varName || "var";
    case BlockType.OPERATOR:
      return data.op || "+";
    case BlockType.COMPARISON:
      return COMPARISONS[data.op]?.label || data.op || "=";
    case BlockType.LOGICAL:
      return data.op?.toUpperCase() || "AND";
    case BlockType.AGGREGATION:
      return AGGREGATIONS[data.aggregation]?.label || data.aggregation || "sum";
    case BlockType.FUNCTION:
      return data.fn || "round";
    case BlockType.CONDITION:
      return "if";
    case BlockType.LOOP:
      if (data.loopType === "repeat") return "repeat";
      if (data.loopType === "while") return "while";
      return "for each";
    case BlockType.SET_VARIABLE:
      return "set";
    case BlockType.ON_DROP:
      return "when dropped";
    case BlockType.ON_CHANGE:
      return "when changed";
    case BlockType.ON_LOAD:
      return "when loaded";
    case BlockType.ON_ITERATION:
      return "when iteration changes";
    case BlockType.ON_MANUAL:
      return "when run manually";
    case BlockType.ON_WEBHOOK:
      return "when webhook fires";
    case BlockType.TRIGGER_DATA:
      return `trigger.${data.property || "value"}`;
    case BlockType.ACTION: {
      const at = data.actionType || "action";
      if (at === "SEND_TO_DISPLAY") return "send to display";
      if (at === "UPDATE_OCCURRENCE_FIELD") return "update field";
      if (at === "MOVE_OCCURRENCE") return "move occurrence";
      return at;
    }
    default:
      return type;
  }
}

/**
 * Get default slots for a block type
 */
function getDefaultSlots(type, data) {
  switch (type) {
    case BlockType.FIELD:
    case BlockType.LITERAL:
    case BlockType.VARIABLE:
      // Value blocks have no slots
      return [];

    case BlockType.OPERATOR:
      // Binary operator: left [op] right
      return [
        { id: "left", label: "", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
        { id: "right", label: "", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
      ];

    case BlockType.COMPARISON:
      // Comparison: left [op] right
      return [
        { id: "left", label: "", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
        { id: "right", label: "", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
      ];

    case BlockType.LOGICAL:
      if (data.op === "not") {
        // Unary NOT
        return [
          { id: "value", label: "", accepts: [BlockType.COMPARISON, BlockType.LOGICAL], connected: null },
        ];
      }
      // Binary AND/OR
      return [
        { id: "left", label: "", accepts: [BlockType.COMPARISON, BlockType.LOGICAL], connected: null },
        { id: "right", label: "", accepts: [BlockType.COMPARISON, BlockType.LOGICAL], connected: null },
      ];

    case BlockType.AGGREGATION:
      // Aggregation: agg(field)
      return [
        { id: "source", label: "of", accepts: [BlockType.FIELD], connected: null },
      ];

    case BlockType.FUNCTION:
      // Function: fn(value)
      return [
        { id: "value", label: "", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
      ];

    case BlockType.CONDITION:
      // If: if (condition) then ...
      return [
        { id: "condition", label: "if", accepts: [BlockType.COMPARISON, BlockType.LOGICAL], connected: null },
      ];

    case BlockType.LOOP:
      if (data.loopType === "repeat") {
        return [
          { id: "count", label: "times", accepts: [BlockType.LITERAL, BlockType.FIELD, BlockType.OPERATOR], connected: null },
        ];
      }
      if (data.loopType === "while") {
        return [
          { id: "condition", label: "while", accepts: [BlockType.COMPARISON, BlockType.LOGICAL, BlockType.FIELD, BlockType.LITERAL], connected: null },
        ];
      }
      // For each
      return [
        { id: "collection", label: "in", accepts: [BlockType.FIELD], connected: null },
      ];

    case BlockType.SET_VARIABLE:
      return [
        { id: "varName", label: "set", accepts: [BlockType.VARIABLE], connected: null },
        { id: "value", label: "to", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION], connected: null },
      ];

    case BlockType.ON_DROP:
    case BlockType.ON_CHANGE:
    case BlockType.ON_LOAD:
    case BlockType.ON_ITERATION:
    case BlockType.ON_MANUAL:
      return [];

    case BlockType.TRIGGER_DATA:
      // No slots — property is in data.property
      return [];

    case BlockType.ON_WEBHOOK:
      // No slots — trigger data comes from webhook payload (read via TRIGGER_DATA blocks)
      return [];

    case BlockType.ACTION: {
      const at = data.actionType || "SEND_TO_DISPLAY";
      if (at === "SEND_TO_DISPLAY") {
        return [
          { id: "value", label: "value", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.VARIABLE, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION, BlockType.TRIGGER_DATA], connected: null },
          { id: "target", label: "target", accepts: [BlockType.LITERAL, BlockType.VARIABLE], connected: null },
        ];
      }
      if (at === "UPDATE_OCCURRENCE_FIELD") {
        return [
          { id: "value", label: "value", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.VARIABLE, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.FUNCTION, BlockType.TRIGGER_DATA], connected: null },
        ];
      }
      if (at === "HTTP_REQUEST") {
        return [
          { id: "url", label: "url", accepts: [BlockType.LITERAL, BlockType.TRIGGER_DATA, BlockType.VARIABLE], connected: null },
          { id: "body", label: "body", accepts: [BlockType.FIELD, BlockType.LITERAL, BlockType.VARIABLE, BlockType.OPERATOR, BlockType.AGGREGATION, BlockType.TRIGGER_DATA], connected: null },
        ];
      }
      return [];
    }

    default:
      return [];
  }
}

/**
 * Block palette - categories of blocks for the sidebar
 */
export const BLOCK_PALETTE = {
  fields: {
    id: "fields",
    label: "Fields",
    color: "blue",
    description: "Field values from your data",
    blocks: [], // Populated dynamically from available fields
  },
  values: {
    id: "values",
    label: "Values",
    color: "gray",
    description: "Constant values and variables",
    blocks: [
      createBlock(BlockType.LITERAL, { value: 0, valueType: "number" }, { label: "0" }),
      createBlock(BlockType.LITERAL, { value: "", valueType: "text" }, { label: "\"\"" }),
      createBlock(BlockType.LITERAL, { value: true, valueType: "boolean" }, { label: "true" }),
      createBlock(BlockType.VARIABLE, { varName: "result" }, { label: "result" }),
    ],
  },
  math: {
    id: "math",
    label: "Math",
    color: "green",
    description: "Mathematical operations",
    blocks: [
      createBlock(BlockType.OPERATOR, { op: "+" }, { label: "+" }),
      createBlock(BlockType.OPERATOR, { op: "-" }, { label: "−" }),
      createBlock(BlockType.OPERATOR, { op: "*" }, { label: "×" }),
      createBlock(BlockType.OPERATOR, { op: "/" }, { label: "÷" }),
      createBlock(BlockType.OPERATOR, { op: "%" }, { label: "mod" }),
    ],
  },
  aggregations: {
    id: "aggregations",
    label: "Aggregations",
    color: "purple",
    description: "Aggregate field values",
    blocks: Object.entries(AGGREGATIONS).map(([key, agg]) =>
      createBlock(BlockType.AGGREGATION, { aggregation: key }, { label: `${agg.symbol} ${agg.label}` })
    ),
  },
  logic: {
    id: "logic",
    label: "Logic",
    color: "cyan",
    description: "Comparisons and boolean logic",
    blocks: [
      createBlock(BlockType.COMPARISON, { op: ">" }, { label: ">" }),
      createBlock(BlockType.COMPARISON, { op: "<" }, { label: "<" }),
      createBlock(BlockType.COMPARISON, { op: "==" }, { label: "=" }),
      createBlock(BlockType.COMPARISON, { op: "!=" }, { label: "≠" }),
      createBlock(BlockType.COMPARISON, { op: ">=" }, { label: "≥" }),
      createBlock(BlockType.COMPARISON, { op: "<=" }, { label: "≤" }),
      createBlock(BlockType.LOGICAL, { op: "and" }, { label: "AND" }),
      createBlock(BlockType.LOGICAL, { op: "or" }, { label: "OR" }),
      createBlock(BlockType.LOGICAL, { op: "not" }, { label: "NOT" }),
    ],
  },
  functions: {
    id: "functions",
    label: "Functions",
    color: "teal",
    description: "Built-in functions",
    blocks: [
      createBlock(BlockType.FUNCTION, { fn: "round" }, { label: "round" }),
      createBlock(BlockType.FUNCTION, { fn: "floor" }, { label: "floor" }),
      createBlock(BlockType.FUNCTION, { fn: "ceil" }, { label: "ceil" }),
      createBlock(BlockType.FUNCTION, { fn: "abs" }, { label: "abs" }),
      createBlock(BlockType.FUNCTION, { fn: "sqrt" }, { label: "√" }),
      createBlock(BlockType.FUNCTION, { fn: "min" }, { label: "min" }),
      createBlock(BlockType.FUNCTION, { fn: "max" }, { label: "max" }),
    ],
  },
  control: {
    id: "control",
    label: "Control",
    color: "orange",
    description: "Conditionals and loops",
    blocks: [
      createBlock(BlockType.CONDITION, {}, { label: "if / then" }),
      createBlock(BlockType.LOOP, { loopType: "foreach" }, { label: "for each" }),
      createBlock(BlockType.LOOP, { loopType: "repeat" }, { label: "repeat" }),
      createBlock(BlockType.LOOP, { loopType: "while" }, { label: "while" }),
      createBlock(BlockType.SET_VARIABLE, {}, { label: "set var" }),
    ],
  },
  triggers: {
    id: "triggers",
    label: "Triggers",
    color: "amber",
    description: "Event triggers for automation",
    blocks: [
      createBlock(BlockType.ON_CHANGE, {}, { label: "when changed" }),
      createBlock(BlockType.ON_DROP, {}, { label: "when dropped" }),
      createBlock(BlockType.ON_ITERATION, {}, { label: "when iteration changes" }),
      createBlock(BlockType.ON_LOAD, {}, { label: "when loaded" }),
      createBlock(BlockType.ON_MANUAL, {}, { label: "when run manually" }),
      createBlock(BlockType.ON_WEBHOOK, {}, { label: "when webhook fires" }),
    ],
  },
  actions: {
    id: "actions",
    label: "Actions",
    color: "emerald",
    description: "Actions that produce side-effects",
    blocks: [
      createBlock(BlockType.ACTION, { actionType: "SEND_TO_DISPLAY" }, { label: "send to display" }),
      createBlock(BlockType.ACTION, { actionType: "UPDATE_OCCURRENCE_FIELD" }, { label: "update field" }),
      createBlock(BlockType.ACTION, { actionType: "HTTP_REQUEST", method: "POST" }, { label: "http request" }),
      createBlock(BlockType.TRIGGER_DATA, { property: "value" }, { label: "trigger.value" }),
      createBlock(BlockType.TRIGGER_DATA, { property: "previousValue" }, { label: "trigger.previousValue" }),
      createBlock(BlockType.TRIGGER_DATA, { property: "fieldId" }, { label: "trigger.fieldId" }),
      createBlock(BlockType.TRIGGER_DATA, { property: "instanceId" }, { label: "trigger.instanceId" }),
    ],
  },
};

/**
 * Get palette categories as an array
 */
export function getPaletteCategories() {
  return Object.values(BLOCK_PALETTE);
}

/**
 * Create field blocks from an array of field definitions.
 * inputEnabled fields are aggregation sources; displayEnabled are computed outputs.
 */
export function createFieldBlocks(fields = [], options = {}) {
  const { includeInput = true, includeDisplay = true, filterByType = null } = options;

  return fields
    .filter(f => {
      if (filterByType && f.type !== filterByType) return false;
      const isInput = f.inputEnabled !== false;
      const isDisplay = f.displayEnabled === true;
      if (isInput && includeInput) return true;
      if (isDisplay && includeDisplay) return true;
      return false;
    })
    .map(field => {
      const isDisplay = field.displayEnabled === true;
      const label = field.name || field.type;
      const displayLabel = isDisplay ? `📊 ${label}` : label;

      return createBlock(BlockType.FIELD, {
        fieldId: field.id,
        fieldName: field.name,
        fieldType: field.type,
        inputEnabled: field.inputEnabled !== false,
        displayEnabled: field.displayEnabled === true,
      }, {
        label: displayLabel,
        color: isDisplay ? "bg-indigo-500" : BLOCK_COLORS[BlockType.FIELD],
      });
    });
}

/**
 * Create a single field block from a field definition.
 */
export function createFieldBlock(field) {
  if (!field) return null;
  const isDisplay = field.displayEnabled === true;
  const label = field.name || field.type;
  const displayLabel = isDisplay ? `📊 ${label}` : label;

  return createBlock(BlockType.FIELD, {
    fieldId: field.id,
    fieldName: field.name,
    fieldType: field.type,
    inputEnabled: field.inputEnabled !== false,
    displayEnabled: field.displayEnabled === true,
  }, {
    label: displayLabel,
    color: isDisplay ? "bg-indigo-500" : BLOCK_COLORS[BlockType.FIELD],
  });
}

/**
 * Clone a block (deep copy with new IDs)
 */
export function cloneBlock(block) {
  const newId = `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const cloned = {
    ...block,
    id: newId,
    slots: block.slots?.map(slot => ({
      ...slot,
      id: `${slot.id}-${newId}`,
      connected: slot.connected ? cloneBlock(slot.connected) : null,
    })),
    innerSlots: block.innerSlots?.map(inner => ({
      ...inner,
      id: `${inner.id}-${newId}`,
      connected: inner.connected?.map(b => cloneBlock(b)) || [],
    })),
  };

  return cloned;
}

/**
 * Check if a block can accept another block in a slot
 */
export function canAcceptBlock(slot, draggedBlock) {
  if (!slot || !draggedBlock) return false;
  return slot.accepts.includes(draggedBlock.type);
}

export default {
  BlockType,
  BlockShape,
  BLOCK_COLORS,
  BLOCK_PALETTE,
  getBlockShape,
  createBlock,
  getPaletteCategories,
  createFieldBlocks,
  createFieldBlock,
  cloneBlock,
  canAcceptBlock,
};
