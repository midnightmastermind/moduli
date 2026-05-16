import mongoose from "mongoose";

const GridSchema = new mongoose.Schema({
  name: { type: String },
  rows: { type: Number, default: 2 },
  cols: { type: Number, default: 3 },
  colSizes: { type: [Number], default: [] },
  rowSizes: { type: [Number], default: [] },
  userId: { type: String, required: true, index: true },

  // Phase 1: Occurrences (array of occurrence IDs)
  occurrences: { type: [String], default: [] },  // Panel occurrences in this grid

  // Named filter presets — user-created, field-condition-based
  // Each filter defines conditions (field + comparator + value).
  // If a condition targets a date-type field, the toolbar shows date nav.
  // timeScale drives the date nav increment step for that filter.
  namedFilters: {
    type: [{
      id: { type: String, required: true },
      name: { type: String, default: "" },
      conditions: { type: mongoose.Schema.Types.Mixed, default: [] },
      // Root is a ConditionGroup: { operator: "AND"|"OR", rules: [...] }
      timeScale: { type: String, enum: ["daily", "weekly", "monthly", "yearly", null], default: null },
      // primaryDateFieldId: which date field the nav arrows + filterOverride write to.
      primaryDateFieldId: { type: String, default: null },
      // timeUnit: step size for date nav. "day"|"week"|"month"|"year"
      timeUnit: { type: String, default: "day" },
      // When true, downstream panels/containers cannot override this filter.
      lock: { type: Boolean, default: false },
    }],
    default: []
  },

  // Currently selected named filter
  activeFilterId: { type: String, default: null },

  // Live filter state — updated by toolbar date nav or filter dropdowns
  // { [fieldId]: value | value[] }
  activeFilterValues: { type: mongoose.Schema.Types.Mixed, default: {} },

  // IDs of namedFilters currently surfaced as nav widgets in the toolbar.
  // Written by ToolbarFilterDropdown's eye-toggles. Order preserved.
  toolbarNavFilters: { type: [String], default: [] },

  // Global field registry
  fieldIds: { type: [String], default: [] },

  // Templates: saved snapshots of container contents that can be re-applied
  // Each template stores which instances go in which container with field defaults
  // User manifest ID (one per user, created on first grid setup)
  manifestId: { type: String, default: null },

  templates: {
    type: [{
      id: { type: String, required: true },
      name: { type: String, default: "Untitled Template" },
      // Array of { containerId, instanceId, fieldDefaults: {} }
      items: { type: mongoose.Schema.Types.Mixed, default: [] },
      createdAt: { type: Date, default: Date.now },
    }],
    default: []
  },

}, { timestamps: true });

export default mongoose.model("Grid", GridSchema);
