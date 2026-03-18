// helpers/calculationConstants.js
// ============================================================
// Pure data constants for the calculation system.
// Exported from CalculationHelpers.js for backward compatibility.
// Import from here or from CalculationHelpers — both work.
// ============================================================

/**
 * Available aggregation functions
 */
export const AGGREGATIONS = {
  sum: {
    label: "Sum",
    symbol: "Σ",
    description: "Add all values together",
    types: ["number"],
    fn: (values) => values.reduce((a, b) => a + b, 0),
  },
  count: {
    label: "Count",
    symbol: "#",
    description: "Count number of occurrences",
    types: ["number", "text", "boolean", "date"],
    fn: (values) => values.length,
  },
  countTrue: {
    label: "Count True",
    symbol: "#✓",
    description: "Count occurrences where value is true/truthy",
    types: ["boolean", "number"],
    fn: (values) => values.filter(Boolean).length,
  },
  avg: {
    label: "Average",
    symbol: "μ",
    description: "Calculate mean average",
    types: ["number"],
    fn: (values) => values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
  },
  min: {
    label: "Minimum",
    symbol: "↓",
    description: "Find smallest value",
    types: ["number", "date"],
    fn: (values) => values.length > 0 ? Math.min(...values) : 0,
  },
  max: {
    label: "Maximum",
    symbol: "↑",
    description: "Find largest value",
    types: ["number", "date"],
    fn: (values) => values.length > 0 ? Math.max(...values) : 0,
  },
  last: {
    label: "Latest",
    symbol: "→",
    description: "Get most recent value",
    types: ["number", "text", "boolean", "date"],
    fn: (values) => values.length > 0 ? values[values.length - 1] : null,
  },
  first: {
    label: "First",
    symbol: "←",
    description: "Get earliest value",
    types: ["number", "text", "boolean", "date"],
    fn: (values) => values.length > 0 ? values[0] : null,
  },
  range: {
    label: "Range",
    symbol: "⟷",
    description: "Difference between max and min",
    types: ["number"],
    fn: (values) => values.length > 0 ? Math.max(...values) - Math.min(...values) : 0,
  },
  median: {
    label: "Median",
    symbol: "M",
    description: "Middle value when sorted",
    types: ["number"],
    fn: (values) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    },
  },
  mode: {
    label: "Mode",
    symbol: "Mo",
    description: "Most frequent value",
    types: ["number", "text"],
    fn: (values) => {
      if (values.length === 0) return null;
      const counts = {};
      values.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      return Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a, [null, 0])[0];
    },
  },
  stdDev: {
    label: "Std Dev",
    symbol: "σ",
    description: "Standard deviation",
    types: ["number"],
    fn: (values) => {
      if (values.length === 0) return 0;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
      return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
    },
  },
  product: {
    label: "Product",
    symbol: "∏",
    description: "Multiply all values",
    types: ["number"],
    fn: (values) => values.length > 0 ? values.reduce((a, b) => a * b, 1) : 0,
  },
  concat: {
    label: "Concatenate",
    symbol: "++",
    description: "Join text values",
    types: ["text"],
    fn: (values, options = {}) => values.join(options.separator || ", "),
  },
  join: {
    label: "Join (newline)",
    symbol: "\\n",
    description: "Join text values with newline (or custom separator)",
    types: ["text"],
    fn: (values, options = {}) => values.filter(v => v != null && v !== "").join(options.separator ?? "\n"),
  },
  unique: {
    label: "Unique Count",
    symbol: "#!",
    description: "Count distinct values",
    types: ["number", "text"],
    fn: (values) => new Set(values).size,
  },
  random: {
    label: "Random",
    symbol: "?",
    description: "Pick a random value from the list",
    types: ["number", "text", "boolean", "date"],
    fn: (values) => values.length > 0 ? values[Math.floor(Math.random() * values.length)] : null,
  },
};

/**
 * Comparison operators for targets and conditions
 */
export const COMPARISONS = {
  ">=": { label: "≥ (at least)", fn: (a, b) => a >= b },
  "<=": { label: "≤ (at most)", fn: (a, b) => a <= b },
  "==": { label: "= (exactly)", fn: (a, b) => a === b },
  "!=": { label: "≠ (not equal)", fn: (a, b) => a !== b },
  ">": { label: "> (more than)", fn: (a, b) => a > b },
  "<": { label: "< (less than)", fn: (a, b) => a < b },
};

/**
 * Flow options for input fields
 * Determines how the value affects aggregations
 */
export const INPUT_FLOWS = {
  in: { label: "In (+)", description: "Value counts as positive" },
  out: { label: "Out (−)", description: "Value counts as negative" },
  replace: { label: "Replace", description: "Value replaces (not summed)" },
};

/**
 * Flow filters for derived fields
 * Determines which input flows are counted in aggregations
 */
export const DERIVED_FLOWS = {
  any: { label: "Any", description: "Count both in and out values" },
  in: { label: "In only", description: "Only count positive (in) values" },
  out: { label: "Out only", description: "Only count negative (out) values" },
};

/**
 * Persistence modes for occurrences
 * Determines how an occurrence behaves across iterations (days/weeks/months)
 */
export const PERSISTENCE_MODES = {
  persistent: {
    label: "Always Show",
    description: "Shows on all iterations (templates, recurring habits)",
    icon: "♾️",
  },
  specific: {
    label: "This Day Only",
    description: "Only shows on the specific iteration/date it was created",
    icon: "📅",
  },
  untilDone: {
    label: "Until Completed",
    description: "Shows on all iterations until marked complete, then stays on completion date",
    icon: "✓",
  },
};

/**
 * Scope types for occurrence filtering
 */
export const SCOPES = {
  grid: { label: "Grid (all)", description: "All occurrences in the grid" },
  panel: { label: "Panel", description: "Occurrences in the same panel" },
  container: { label: "Container", description: "Occurrences in the same container" },
  instance: { label: "Instance", description: "All occurrences of this instance" },
};

/**
 * Time-based filter presets for occurrence filtering
 */
export const TIME_FILTERS = {
  all: { label: "All time", fn: () => true },
  today: {
    label: "Today",
    fn: (occ) => {
      const today = new Date().setHours(0, 0, 0, 0);
      const occDate = new Date(occ.createdAt || occ.meta?.createdAt).setHours(0, 0, 0, 0);
      return occDate === today;
    },
  },
  thisWeek: {
    label: "This week",
    fn: (occ) => {
      const now = new Date();
      const weekStart = new Date(now.setDate(now.getDate() - now.getDay())).setHours(0, 0, 0, 0);
      const occDate = new Date(occ.createdAt || occ.meta?.createdAt).getTime();
      return occDate >= weekStart;
    },
  },
  thisMonth: {
    label: "This month",
    fn: (occ) => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const occDate = new Date(occ.createdAt || occ.meta?.createdAt).getTime();
      return occDate >= monthStart;
    },
  },
  last7Days: {
    label: "Last 7 days",
    fn: (occ) => {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const occDate = new Date(occ.createdAt || occ.meta?.createdAt).getTime();
      return occDate >= sevenDaysAgo;
    },
  },
  last30Days: {
    label: "Last 30 days",
    fn: (occ) => {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const occDate = new Date(occ.createdAt || occ.meta?.createdAt).getTime();
      return occDate >= thirtyDaysAgo;
    },
  },
};

/**
 * Time filter multipliers relative to daily
 * Used to scale targets when viewing in different time periods
 */
export const TIME_FILTER_MULTIPLIERS = {
  daily: 1,
  weekly: 7,
  monthly: 30, // approximate
  yearly: 365, // approximate
};
