// models/Transaction.js
// ============================================================
// TRANSACTIONS & OCCURRENCES: The Event-Driven Core of Moduli
// ============================================================
//
// Transactions capture the WHO, WHAT, WHERE, WHEN, and WHY of every change.
// They are the source of truth for:
// - Field aggregations and calculations
// - History and undo/redo
// - Tracking flow of values (in/out)
// - Audit trails
//
// Example transaction "sentence":
// "InstanceX (with fields {A: 10, B: 'done'}) in OccurrenceY
//  was moved FROM ContainerA in PanelP TO ContainerB in PanelQ
//  at iteration {time: 2024-01-15} by UserZ"
//
// Queries can answer:
// - "Sum of field X in Panel A this week"
// - "How many times did items move from Container A to B?"
// - "What's the history of this occurrence's field values?"
// ============================================================

import mongoose from "mongoose";

// Operation sub-schema for occurrence list changes (move/copy/add/remove)
// Captures full FROM and TO context for any occurrence movement
const OccurrenceListOpSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["add", "remove", "move", "copy", "reorder", "create", "delete"],
      required: true,
    },

    // The occurrence being acted upon
    occurrenceId: { type: String, required: true },

    // The instance this occurrence represents
    instanceId: { type: String },

    // Iteration context (when this happened in time/version space)
    iteration: {
      key: { type: String },
      value: { type: mongoose.Schema.Types.Mixed },
    },

    // FROM context (where it came from) - for moves/copies/removes
    from: {
      containerId: { type: String },
      panelId: { type: String },
      gridId: { type: String },
      index: { type: Number },
      // Field values at time of move (snapshot for calculations)
      fields: { type: mongoose.Schema.Types.Mixed },
    },

    // TO context (where it went) - for adds/moves/copies
    to: {
      containerId: { type: String },
      panelId: { type: String },
      gridId: { type: String },
      index: { type: Number },
    },

    // Full occurrence snapshot (for creates and for undo)
    occurrenceSnapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// Operation sub-schema for field measurements
// Captures full context: WHO (instance) did WHAT (field change) WHERE (container, panel) WHEN (iteration)
const MeasureOpSchema = new mongoose.Schema(
  {
    // The occurrence that changed
    occurrenceId: { type: String, required: true },

    // Context: where is this occurrence?
    instanceId: { type: String },     // What instance type
    containerId: { type: String },    // Which container
    panelId: { type: String },        // Which panel

    // Iteration context (when in time/version)
    iteration: {
      key: { type: String },          // "time", "version", etc.
      value: { type: mongoose.Schema.Types.Mixed }, // The specific iteration value
    },

    // The field that changed
    fieldId: { type: String, required: true },

    // Value info
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    previousValue: { type: mongoose.Schema.Types.Mixed },

    // Flow type for numeric values
    flow: { type: String, enum: ["in", "out", "replace"], default: "in" },

    // Optional: action that triggered this (for move operations)
    trigger: {
      type: { type: String, enum: ["manual", "drop", "automation", "calculation"] },
      // For drops: where it came from
      fromContainerId: { type: String },
      fromPanelId: { type: String },
      // For automations: which trigger fired
      triggerId: { type: String },
    },
  },
  { _id: false }
);

// Operation sub-schema for entity CRUD
const EntityOpSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["create", "update", "delete"],
      required: true,
    },
    entityType: {
      type: String,
      enum: ["grid", "panel", "container", "instance", "field", "occurrence"],
      required: true,
    },
    entityId: { type: String, required: true },
    // For create/update - the new state
    data: { type: mongoose.Schema.Types.Mixed },
    // For update/delete - the previous state (for undo)
    previousData: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// Operation sub-schema for document edits (Phase 4)
const DocEditOpSchema = new mongoose.Schema(
  {
    occurrenceId: { type: String, required: true },
    fieldId: { type: String, required: true },
    // Editor-specific changes (ProseMirror steps, etc.)
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // For undo - the previous document state
    previousContent: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// Main operation schema - discriminated union
const OperationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["occurrence_list", "measure", "entity", "doc_edit"],
      required: true,
    },
    // One of these will be populated based on type
    occurrenceList: OccurrenceListOpSchema,
    measure: MeasureOpSchema,
    entity: EntityOpSchema,
    docEdit: DocEditOpSchema,
  },
  { _id: false }
);

// Main Transaction schema
const TransactionSchema = new mongoose.Schema(
  {
    // Unique identifier (UUID generated by client)
    id: { type: String, required: true, index: true, unique: true },

    userId: { type: String, required: true, index: true },

    // Grid this transaction belongs to
    gridId: { type: String, required: true, index: true },

    // Iteration context when transaction was created
    iteration: {
      key: { type: String, default: "time" },
      value: { type: mongoose.Schema.Types.Mixed },
    },

    // When the transaction was created
    timestamp: { type: Date, default: Date.now, index: true },

    // Array of operations in this transaction
    // Multiple operations can be batched into a single transaction
    operations: { type: [OperationSchema], default: [] },

    // Transaction state for undo/redo chain (like git)
    // applied = action was performed
    // undone = action was reversed (soft delete for creates, restore for deletes, move back for moves)
    // redone = action was re-applied after being undone
    state: {
      type: String,
      enum: ["applied", "undone", "redone"],
      default: "applied",
    },

    // Undo/redo metadata for history display
    undoneAt: { type: Date },
    undoneBy: { type: String },
    redoneAt: { type: Date },
    redoneBy: { type: String },

    // Position in the undo chain (for ordering)
    // Higher = more recent. Used to find "last undoable" transaction
    sequence: { type: Number, index: true },

    // Optional description for history UI
    description: { type: String },

    // Optional metadata
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Compound indexes for common queries
TransactionSchema.index({ gridId: 1, timestamp: -1 });
TransactionSchema.index({ userId: 1, timestamp: -1 });
TransactionSchema.index({ gridId: 1, state: 1, timestamp: -1 });

// Hide Mongo internals in API responses
TransactionSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret._id = ret._id?.toString?.() ?? ret._id;
    return ret;
  },
});

export default mongoose.model("Transaction", TransactionSchema);
