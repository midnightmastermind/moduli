// blocks/blockEvaluator.js
// ============================================================
// Evaluates block trees to produce calculated values
// This is the runtime engine for the visual block programming system
// ============================================================

import { BlockType } from "./blockTypes";
import { AGGREGATIONS, applyAggregation, extractFieldValues } from "./CalculationHelpers";

/**
 * Evaluate a block tree and return the calculated value
 *
 * @param {Object} block - The root block to evaluate
 * @param {Object} context - Evaluation context
 * @param {Object} context.state - App state with occurrences, fields, etc.
 * @param {Object} context.fieldsById - Map of field ID to field definition
 * @param {Object} context.variables - Map of variable names to values
 * @returns {any} The calculated value
 */
export function evaluateBlock(block, context = {}) {
  if (!block) return null;

  const { state = {}, fieldsById = {}, variables = {} } = context;

  switch (block.type) {
    // ============================================================
    // VALUE BLOCKS
    // ============================================================
    case BlockType.FIELD: {
      const { fieldId } = block.data;
      if (!fieldId) return null;

      // Get the field value from occurrences
      const occurrences = state.occurrences || [];
      const values = extractFieldValues(occurrences, fieldId, { flowFilter: "any" });

      // For now, return the last value (or sum for numbers)
      if (values.length === 0) return null;

      const field = fieldsById[fieldId];
      if (field?.type === "number") {
        // Return sum for numbers
        return values.reduce((a, b) => a + b, 0);
      }
      // Return last value for other types
      return values[values.length - 1];
    }

    case BlockType.LITERAL: {
      return block.data.value;
    }

    case BlockType.VARIABLE: {
      const { varName } = block.data;
      return variables[varName] ?? null;
    }

    // ============================================================
    // MATH OPERATORS
    // ============================================================
    case BlockType.OPERATOR: {
      const left = evaluateSlot(block, "left", context);
      const right = evaluateSlot(block, "right", context);

      if (left === null || right === null) return null;

      const leftNum = Number(left);
      const rightNum = Number(right);

      switch (block.data.op) {
        case "+": return leftNum + rightNum;
        case "-": return leftNum - rightNum;
        case "*": return leftNum * rightNum;
        case "/": return rightNum !== 0 ? leftNum / rightNum : null;
        case "%": return rightNum !== 0 ? leftNum % rightNum : null;
        default: return null;
      }
    }

    // ============================================================
    // COMPARISON OPERATORS
    // ============================================================
    case BlockType.COMPARISON: {
      const left = evaluateSlot(block, "left", context);
      const right = evaluateSlot(block, "right", context);

      if (left === null || right === null) return null;

      switch (block.data.op) {
        case ">": return left > right;
        case "<": return left < right;
        case ">=": return left >= right;
        case "<=": return left <= right;
        case "==": return left === right;
        case "!=": return left !== right;
        default: return false;
      }
    }

    // ============================================================
    // LOGICAL OPERATORS
    // ============================================================
    case BlockType.LOGICAL: {
      switch (block.data.op) {
        case "and": {
          const left = evaluateSlot(block, "left", context);
          const right = evaluateSlot(block, "right", context);
          return Boolean(left) && Boolean(right);
        }
        case "or": {
          const left = evaluateSlot(block, "left", context);
          const right = evaluateSlot(block, "right", context);
          return Boolean(left) || Boolean(right);
        }
        case "not": {
          const value = evaluateSlot(block, "value", context);
          return !Boolean(value);
        }
        default:
          return false;
      }
    }

    // ============================================================
    // AGGREGATION
    // ============================================================
    case BlockType.AGGREGATION: {
      const { aggregation } = block.data;
      if (!aggregation || !AGGREGATIONS[aggregation]) return null;

      // Get the source field from the slot
      const sourceSlot = block.slots?.find(s => s.id === "source");
      const sourceBlock = sourceSlot?.connected;

      if (!sourceBlock || sourceBlock.type !== BlockType.FIELD) {
        return null;
      }

      const { fieldId } = sourceBlock.data;
      if (!fieldId) return null;

      // Extract values from occurrences
      const occurrences = state.occurrences || [];
      const values = extractFieldValues(occurrences, fieldId, { flowFilter: "any" });

      // Apply aggregation
      return applyAggregation(values, aggregation);
    }

    // ============================================================
    // FUNCTIONS
    // ============================================================
    case BlockType.FUNCTION: {
      const value = evaluateSlot(block, "value", context);
      if (value === null) return null;

      const num = Number(value);

      switch (block.data.fn) {
        case "round": return Math.round(num);
        case "floor": return Math.floor(num);
        case "ceil": return Math.ceil(num);
        case "abs": return Math.abs(num);
        case "sqrt": return num >= 0 ? Math.sqrt(num) : null;
        case "min": {
          // For min/max functions, we might need multiple values
          // For now, just return the value
          return num;
        }
        case "max": {
          return num;
        }
        default:
          return value;
      }
    }

    // ============================================================
    // CONTROL FLOW
    // ============================================================
    case BlockType.CONDITION: {
      const condition = evaluateSlot(block, "condition", context);

      if (Boolean(condition)) {
        // Execute inner blocks (then branch)
        return evaluateInnerBlocks(block, 0, context);
      } else {
        // Execute else branch if exists
        return evaluateInnerBlocks(block, 1, context);
      }
    }

    case BlockType.LOOP: {
      if (block.data.loopType === "repeat") {
        const count = evaluateSlot(block, "count", context);
        const times = Number(count) || 0;
        let result = null;

        for (let i = 0; i < times; i++) {
          result = evaluateInnerBlocks(block, 0, {
            ...context,
            variables: { ...context.variables, index: i },
          });
        }

        return result;
      } else {
        // For each - would need collection support
        return null;
      }
    }

    case BlockType.SET_VARIABLE: {
      const varNameBlock = block.slots?.find(s => s.id === "varName")?.connected;
      const value = evaluateSlot(block, "value", context);

      if (varNameBlock?.type === BlockType.VARIABLE) {
        const varName = varNameBlock.data.varName;
        // Note: In a real implementation, we'd need to propagate this change
        // For now, just return the set value
        return { varName, value };
      }
      return null;
    }

    // ============================================================
    // TRIGGERS (don't evaluate to values)
    // ============================================================
    case BlockType.ON_DROP:
    case BlockType.ON_CHANGE:
      return null;

    default:
      console.warn(`Unknown block type: ${block.type}`);
      return null;
  }
}

/**
 * Helper: Evaluate a specific slot of a block
 */
function evaluateSlot(block, slotId, context) {
  const slot = block.slots?.find(s => s.id === slotId);
  if (!slot?.connected) return null;
  return evaluateBlock(slot.connected, context);
}

/**
 * Helper: Evaluate inner blocks (for C-blocks)
 */
function evaluateInnerBlocks(block, innerSlotIndex, context) {
  const innerSlot = block.innerSlots?.[innerSlotIndex];
  if (!innerSlot?.connected?.length) return null;

  let result = null;
  for (const innerBlock of innerSlot.connected) {
    result = evaluateBlock(innerBlock, context);
  }
  return result;
}

/**
 * Evaluate a complete block tree
 * Returns the final value and any side effects (variable assignments, etc.)
 *
 * @param {Object} rootBlock - The root block to evaluate
 * @param {Object} context - Evaluation context
 * @returns {Object} { value, variables, errors }
 */
export function evaluateBlockTree(rootBlock, context = {}) {
  const result = {
    value: null,
    variables: { ...context.variables },
    errors: [],
  };

  try {
    result.value = evaluateBlock(rootBlock, {
      ...context,
      variables: result.variables,
    });
  } catch (err) {
    result.errors.push({
      message: err.message,
      blockId: rootBlock?.id,
    });
  }

  return result;
}

/**
 * Validate a block tree for errors before evaluation
 *
 * @param {Object} rootBlock - The root block to validate
 * @returns {Array} Array of validation errors
 */
export function validateBlockTree(rootBlock) {
  const errors = [];

  function validateBlock(block, path = []) {
    if (!block) return;

    // Check required slots are filled
    for (const slot of block.slots || []) {
      if (slot.required && !slot.connected) {
        errors.push({
          type: "missing_slot",
          message: `Missing required value for "${slot.label || slot.id}"`,
          path: [...path, block.id],
          slotId: slot.id,
        });
      }

      // Recursively validate connected blocks
      if (slot.connected) {
        validateBlock(slot.connected, [...path, block.id]);
      }
    }

    // Validate inner blocks
    for (const innerSlot of block.innerSlots || []) {
      for (const innerBlock of innerSlot.connected || []) {
        validateBlock(innerBlock, [...path, block.id, innerSlot.id]);
      }
    }
  }

  validateBlock(rootBlock);
  return errors;
}

/**
 * Get a human-readable description of what a block tree does
 *
 * @param {Object} block - The block to describe
 * @returns {string} Human-readable description
 */
export function describeBlock(block) {
  if (!block) return "empty";

  switch (block.type) {
    case BlockType.FIELD:
      return block.data.fieldName || "field";

    case BlockType.LITERAL:
      return String(block.data.value);

    case BlockType.VARIABLE:
      return block.data.varName || "var";

    case BlockType.OPERATOR: {
      const left = describeSlot(block, "left");
      const right = describeSlot(block, "right");
      return `(${left} ${block.data.op} ${right})`;
    }

    case BlockType.COMPARISON: {
      const left = describeSlot(block, "left");
      const right = describeSlot(block, "right");
      return `(${left} ${block.data.op} ${right})`;
    }

    case BlockType.LOGICAL: {
      if (block.data.op === "not") {
        return `NOT ${describeSlot(block, "value")}`;
      }
      const left = describeSlot(block, "left");
      const right = describeSlot(block, "right");
      return `(${left} ${block.data.op.toUpperCase()} ${right})`;
    }

    case BlockType.AGGREGATION: {
      const source = describeSlot(block, "source");
      const agg = AGGREGATIONS[block.data.aggregation];
      return `${agg?.symbol || block.data.aggregation}(${source})`;
    }

    case BlockType.FUNCTION: {
      const value = describeSlot(block, "value");
      return `${block.data.fn}(${value})`;
    }

    case BlockType.CONDITION:
      return `if ${describeSlot(block, "condition")} then ...`;

    default:
      return block.label || block.type;
  }
}

function describeSlot(block, slotId) {
  const slot = block.slots?.find(s => s.id === slotId);
  if (!slot?.connected) return "?";
  return describeBlock(slot.connected);
}

/**
 * Serialize a block tree to a minimal JSON format for storage
 */
export function serializeBlockTree(block) {
  if (!block) return null;

  return {
    type: block.type,
    data: block.data,
    slots: block.slots?.map(slot => ({
      id: slot.id,
      connected: serializeBlockTree(slot.connected),
    })).filter(s => s.connected),
    innerSlots: block.innerSlots?.map(inner => ({
      id: inner.id,
      connected: inner.connected?.map(b => serializeBlockTree(b)).filter(Boolean),
    })).filter(i => i.connected?.length > 0),
  };
}

/**
 * Deserialize a block tree from storage format
 */
export function deserializeBlockTree(data, context = {}) {
  if (!data) return null;

  const { createBlock } = require("./blockTypes");

  const block = createBlock(data.type, data.data);

  // Restore slot connections
  for (const slotData of data.slots || []) {
    const slot = block.slots?.find(s => s.id === slotData.id);
    if (slot && slotData.connected) {
      slot.connected = deserializeBlockTree(slotData.connected, context);
    }
  }

  // Restore inner blocks
  for (const innerData of data.innerSlots || []) {
    const innerSlot = block.innerSlots?.find(i => i.id === innerData.id);
    if (innerSlot && innerData.connected) {
      innerSlot.connected = innerData.connected.map(b => deserializeBlockTree(b, context));
    }
  }

  return block;
}

export default {
  evaluateBlock,
  evaluateBlockTree,
  validateBlockTree,
  describeBlock,
  serializeBlockTree,
  deserializeBlockTree,
};
