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
      // [{ fieldId, comparator, value }] — same format as operation IF rules
      timeScale: { type: String, enum: ["daily", "weekly", "monthly", "yearly", null], default: null },
    }],
    default: []
  },

  // Currently selected named filter
  activeFilterId: { type: String, default: null },

  // Live filter state — updated by toolbar date nav or filter dropdowns
  // { [fieldId]: value | value[] }
  activeFilterValues: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Global field registry
  fieldIds: { type: [String], default: [] },

  // Templates: saved snapshots of container contents that can be re-applied
  // Each template stores which instances go in which container with field defaults
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
