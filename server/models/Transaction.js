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

    // The field that changed
    fieldId: { type: String, required: true },

    // Value info
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    previousValue: { type: mongoose.Schema.Types.Mixed },

    // Flow type for numeric values
    flow: { type: String, enum: ["in", "out", "replace"], default: "in" },
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

// Snapshot of ONE document either side of a change. This is what undo/redo
// actually runs on (2026-08-01) — `operations` above stays for the audit
// trail + `get_field_history`, but it can't drive undo:
//   * an inverse has to be written per mutation type, and any type without one
//     silently no-ops (exactly how undo broke — the move inverse wrote
//     `containerId`/`panelId`, which are not fields on Occurrence at all);
//   * there is no sane inverse for a textmap edit.
// A before/after snapshot is one code path for every entity type, and textmaps
// come along for free.
//
// `before: null` = the document was CREATED (undo deletes it).
// `after: null`  = the document was DELETED (undo re-creates it from `before`).
// Both sides store the doc AS PERSISTED, so `textmap` stays gzip-compressed —
// a snapshot costs about what the document costs.
const DocSnapshotSchema = new mongoose.Schema(
  {
    // Key into MODEL_MAP (server.js): grid|module|field|occurrence|manifest|view|folder|operation
    model: { type: String, required: true },
    id: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  // `minimize: false` is LOAD-BEARING, and it does NOT inherit from the parent
  // schema's setting. Mongoose's default (`minimize: true`) STRIPS empty objects
  // when saving — so a snapshot of an occurrence with `fields: {}` persisted
  // without a `fields` key at all, and undo's `$set: before` then had nothing to
  // clear the field with: the value the user just added SURVIVED the undo.
  // Caught only by an end-to-end run against a real database; every unit test
  // passed because none of them round-tripped through Mongo.
  { _id: false, minimize: false }
);

// Main Transaction schema
const TransactionSchema = new mongoose.Schema(
  {
    // Unique identifier (UUID generated by client)
    id: { type: String, required: true, index: true, unique: true },

    // Transaction event class — clients fire matching ops based on this.
    // Without this declared, Mongoose strict-mode silently drops the field on
    // save and `transaction.type` is `undefined` on the broadcast echo, which
    // matches `onLoad` triggers (`undefined == null`) — onLoad ops then loop
    // every tracker write back into another transaction_created echo.
    type: { type: String, index: true },

    userId: { type: String, required: true, index: true },

    // Grid this transaction belongs to
    gridId: { type: String, required: true, index: true },

    // When the transaction was created
    timestamp: { type: Date, default: Date.now, index: true },

    // Array of operations in this transaction
    // Multiple operations can be batched into a single transaction
    operations: { type: [OperationSchema], default: [] },

    // Before/after snapshots — the undo/redo payload. See DocSnapshotSchema.
    docs: { type: [DocSnapshotSchema], default: [] },

    // Groups ONE user action with every write its operation cascade produced,
    // so a drop that fans out into ~40 tracker writes is a single Ctrl+Z.
    // Minted client-side (helpers/actionScope.js) and carried on every socket
    // write; null for writes with no user action behind them.
    actionId: { type: String, default: null, index: true },

    // Transaction state for undo/redo chain (like git)
    // applied    = action was performed
    // undone     = action was reversed (its `before` snapshots are live)
    // redone     = action was re-applied after being undone
    // superseded = it was undone, then the user did something NEW, so the redo
    //              branch it belonged to is dead. Without this state, undo →
    //              fresh edit → Ctrl+Y replayed a stale `after` snapshot over
    //              the newer work. Kept (not deleted) so history still shows it;
    //              neither nextUndoable nor nextRedoable resolves this state.
    state: {
      type: String,
      enum: ["applied", "undone", "redone", "superseded"],
      default: "applied",
    },

    // Undo/redo metadata for history display
    undoneAt: { type: Date },
    undoneBy: { type: String },
    redoneAt: { type: Date },
    redoneBy: { type: String },
    supersededAt: { type: Date },

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
// The undo/redo stack query: newest undoable / most-recently-undone for a grid.
// Ordered by `sequence`, NOT timestamp — two writes can share a millisecond,
// and the stack has to be totally ordered or undo can skip or repeat a step.
TransactionSchema.index({ userId: 1, gridId: 1, state: 1, sequence: -1 });

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
