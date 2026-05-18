// helpers/comparators.js
// Shared comparator list used by the grid named-filter editor and the per-column
// table-container filter popover. evalRule (operationActions.js) is the canonical
// evaluator for all of these values.

export const COMPARATOR_OPTIONS = [
  { value: "SAME_DAY",     label: "same day" },
  { value: "SAME_WEEK",    label: "same week" },
  { value: "SAME_MONTH",   label: "same month" },
  { value: "SAME_YEAR",    label: "same year" },
  { value: "IS",           label: "is" },
  { value: "IS_NOT",       label: "is not" },
  { value: "CONTAINS",     label: "contains" },
  { value: "GREATER",      label: ">" },
  { value: "LESS",         label: "<" },
  { value: "IS_EMPTY",     label: "is empty" },
  { value: "IS_NOT_EMPTY", label: "not empty" },
];

// Comparators that take no right-hand value (unary).
export const UNARY_COMPARATORS = new Set(["IS_EMPTY", "IS_NOT_EMPTY"]);
