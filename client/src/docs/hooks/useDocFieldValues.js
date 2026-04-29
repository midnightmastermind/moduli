// docs/hooks/useDocFieldValues.js
// ============================================================
// Hook for calculating live field values in documents
// Extracts field IDs from Tiptap content and computes values
// ============================================================

import { useMemo, useContext } from "react";
import { GridActionsContext } from "../../GridActionsContext";
import { GridLiveContext } from "../../GridLiveContext";
import * as CalculationHelpers from "../../helpers/CalculationHelpers";

/**
 * Extract all field pill IDs from Tiptap JSON content
 */
function extractFieldIds(content) {
  const fieldIds = new Set();

  function traverse(node) {
    if (!node) return;

    // Check if this is a field pill
    if (node.type === "fieldPill" && node.attrs?.fieldId) {
      fieldIds.add(node.attrs.fieldId);
    }

    // Recursively traverse children
    if (Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(content);
  return Array.from(fieldIds);
}

/**
 * useDocFieldValues - Calculate live values for field pills in a document
 *
 * @param {Object} docContent - Tiptap JSON document content
 * @returns {Object} Map of fieldId -> { value, displayValue, error }
 */
export function useDocFieldValues(docContent) {
  const context = useContext(GridActionsContext) || {};
  const {
    fieldsById = {},
    occurrencesById = {},
    state = {},
  } = context;
  const { computedValues = {} } = useContext(GridLiveContext) || {};

  // Extract all field IDs from the document
  const fieldIds = useMemo(() => {
    return extractFieldIds(docContent);
  }, [docContent]);

  // Calculate values for each field
  const values = useMemo(() => {
    const result = {};

    for (const fieldId of fieldIds) {
      const field = fieldsById[fieldId];
      if (!field) {
        result[fieldId] = { value: null, displayValue: "—", error: "Field not found" };
        continue;
      }

      try {
        // Display fields read the operation-computed value (operations write to
        // computedValues via UPDATE $display.<fieldId>[.<occId>]).
        if (field.displayEnabled) {
          const cv = computedValues[fieldId];
          result[fieldId] = {
            value: cv ?? null,
            displayValue: formatValue(cv ?? null, field),
            error: null,
          };
        } else {
          // Input field — aggregate values from all occurrences
          const occurrences = Object.values(occurrencesById);
          const vals = CalculationHelpers.extractFieldValues(occurrences, fieldId);
          const isNumeric = field.type === "number" || field.type === "duration";
          // Sum numeric fields; take the most-recent value for others
          const aggregatedValue = isNumeric
            ? CalculationHelpers.applyAggregation(vals, "sum")
            : (vals[vals.length - 1] ?? null);

          result[fieldId] = {
            value: aggregatedValue,
            displayValue: formatValue(aggregatedValue, field),
            error: null,
          };
        }
      } catch (err) {
        result[fieldId] = {
          value: null,
          displayValue: "Error",
          error: err.message,
        };
      }
    }

    return result;
  }, [fieldIds, fieldsById, occurrencesById, computedValues, state]);

  return values;
}

/**
 * Format a value for display based on field type
 */
function formatValue(value, field) {
  if (value === null || value === undefined) return "—";

  const type = field?.type || "text";

  switch (type) {
    case "number":
      if (typeof value === "number") {
        return value.toLocaleString();
      }
      return String(value);

    case "boolean":
      return value ? "✓" : "✗";

    case "rating":
      if (typeof value === "number") {
        return "★".repeat(Math.round(value)) + "☆".repeat(5 - Math.round(value));
      }
      return String(value);

    case "duration":
      if (typeof value === "number") {
        const hours = Math.floor(value / 60);
        const mins = value % 60;
        if (hours > 0) {
          return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
      }
      return String(value);

    case "select":
      if (Array.isArray(value)) {
        return value.join(", ");
      }
      return String(value);

    case "date":
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }
      if (typeof value === "string") {
        return new Date(value).toLocaleDateString();
      }
      return String(value);

    default:
      return String(value);
  }
}

/**
 * Hook for getting a single field's live value
 */
export function useFieldValue(fieldId) {
  const context = useContext(GridActionsContext) || {};
  const {
    fieldsById = {},
    occurrencesById = {},
    state = {},
  } = context;
  const { computedValues = {} } = useContext(GridLiveContext) || {};

  return useMemo(() => {
    const field = fieldsById[fieldId];
    if (!field) {
      return { value: null, displayValue: "—", error: "Field not found" };
    }

    try {
      // Display fields read the operation-computed value.
      if (field.displayEnabled) {
        const cv = computedValues[fieldId];
        return {
          value: cv ?? null,
          displayValue: formatValue(cv ?? null, field),
          error: null,
        };
      } else {
        // Input field — aggregate values from all occurrences
        const occurrences = Object.values(occurrencesById);
        const vals = CalculationHelpers.extractFieldValues(occurrences, fieldId);
        const isNumeric = field.type === "number" || field.type === "duration";
        const aggregatedValue = isNumeric
          ? CalculationHelpers.applyAggregation(vals, "sum")
          : (vals[vals.length - 1] ?? null);

        return {
          value: aggregatedValue,
          displayValue: formatValue(aggregatedValue, field),
          error: null,
        };
      }
    } catch (err) {
      return {
        value: null,
        displayValue: "Error",
        error: err.message,
      };
    }
  }, [fieldId, fieldsById, occurrencesById, computedValues, state]);
}

export default useDocFieldValues;
