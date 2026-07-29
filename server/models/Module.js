// models/Module.js
// ============================================================
// Unified Module model — replaces Panel, Container, and Instance.
// All layout hierarchy nodes are Modules differentiated by `role`.
// Placement (row/col/width/height for panels) is stored in Occurrence.
// ============================================================
import mongoose from "mongoose";

const ModuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true, unique: true },
    userId: { type: String, required: true, index: true },
    gridId: { type: String, index: true },

    // ─── Role — THE source of truth for what a module is ─────────────────────
    // "panel" | "page" | "container" | "instance" | "textblock" | "artifact".
    // Every renderer reads this directly. Always set in practice (verified
    // 2026-07-29: 0 of 2779 modules across all grids lack one).
    //
    // The header here used to say "deprecated — inferred from occurrence
    // hierarchy on client". That was backwards, and the inference it pointed at
    // (`computeRoleByModuleId`) was DELETED 2026-07-29: measured against the
    // live grid it disagreed with the stored role on 57 modules, because it had
    // no notion of a container nested inside a container and so labelled every
    // Schedule slot container an "instance". Three Command Center tabs read it
    // and were the only places showing those slots with the wrong role.
    role: { type: String, default: null },

    // ─── Kind — the SUB-TYPE within a role ───────────────────────────────────
    // Meaningful for:
    //   container → "board" | "doc" | "canvas" | "table" | "pool"
    //                 (there is no "list" kind — it is BOARD everywhere, per the
    //                  standing rename; "list" only survives in legacy rows)
    //   page      → "board" | "doc" | "canvas" | "table" | "folder" | "display"
    //   artifact  → "image" | "video" | "audio" | "pdf" | "code" | "markdown" | "quote"
    // INERT for instance/textblock leaves — 539 instance modules carry
    // kind:"board" in the live grid and nothing reads it. Harmless noise; not
    // worth a migration, but don't add meaning to it either.
    //
    // View.viewType is a SEPARATE axis (how a panel renders its content) and is
    // not a replacement for this despite what the old comment claimed.
    kind: { type: String, default: null },

    // ─── Label / name ────────────────────────────────────────
    label: { type: String, default: "", trim: true },

    // ─── File reference (artifact modules) ───────────────────
    // Display name / original filename (e.g. "morenotes.md").
    // The actual textmap is stored in occurrence.textmap and synced to uploads/md/{occurrenceId}.md.
    fileRef: { type: String, default: null },

    // ─── Iteration settings ──────────────────────────────────
    iteration: {
      mode: { type: String, enum: ["inherit", "own"], default: "inherit" },
      timeFilter: {
        type: String,
        enum: ["daily", "weekly", "monthly", "yearly", "all"],
        default: "daily",
      },
    },

    // ─── Drag mode ───────────────────────────────────────────
    defaultDragMode: {
      type: String,
      enum: ["move", "copy", "copylink"],
      default: "move",
    },

    // ─── Field bindings (instances) ──────────────────────────
    fieldBindings: [
      {
        fieldId: { type: String, required: true },
        order: { type: Number },
        hidden: { type: Boolean },
        // "media" marks the binding whose value is the occurrence's
        // cover/photo URL (picker chips, RepresentationView thumbs, the
        // People Table photo column, the image-picker write target).
        // "input"/"display" are used by the FieldsTab attach flow.
        // NOTE: this key was AUTHORED by the seed since 2026-05 but the
        // schema didn't declare it, so Mongoose strict mode silently
        // STRIPPED it on save — no media thumbnail ever rendered.
        // (Found in the 2026-07-07 image-picker work.)
        role: { type: String },
        // Per-binding display config ({ showLabel, showUnit, ... }) read
        // by Field.jsx — same silent-strip bug as `role`.
        display: { type: mongoose.Schema.Types.Mixed },
      },
    ],

    // ─── Operation widgets (instances) ───────────────────────
    operationBindings: [
      {
        operationId: { type: String, required: true },
        widgetType: {
          type: String,
          enum: ["trigger", "display", "input"],
          default: "trigger",
        },
        displayName: { type: String },
      },
    ],

    // ─── Layout ──────────────────────────────────────────────
    // For panels: visual arrangement of children
    // For containers: orientation (horizontal/vertical)
    layout: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ─── Style ───────────────────────────────────────────────
    styleMode: { type: String, enum: ["inherit", "own"], default: "inherit" },
    ownStyle: { type: mongoose.Schema.Types.Mixed, default: null },

    // Cascading defaults for children
    defaultInstanceStyle: { type: mongoose.Schema.Types.Mixed, default: null },

    // ─── Sibling links ───────────────────────────────────────
    // Linked peer modules (Q↔A pairs, linked containers, etc.)
    siblingLinks: { type: [String], default: [] },

    // ─── Templates (containers) ──────────────────────────────
    defaultTemplateId: { type: String, default: null },

    // ─── Behavior toggles (5.2) ──────────────────────────────
    // behaviorMode: "inherit" uses parent defaults; "own" uses this entity's settings
    behaviorMode: { type: String, enum: ["inherit", "own"], default: "inherit" },
    behavior: {
      sortable:  { type: Boolean, default: true },   // children can be reordered
      draggable: { type: Boolean, default: true },   // this entity can be dragged
      droppable: { type: Boolean, default: true },   // accepts drops from outside
    },

    // ─── Attached fields ─────────────────────────────────────
    // Fields whose content IS the structural part of this module.
    // The field holds the value; the module declares where it renders.
    // header: array of fieldIds — all share the same value when the header is edited.
    // body:   array of fieldIds — all share the same value when the body is edited.
    // Display reads from the first fieldId. Writes go to all fieldIds in the array.
    attachedFields: {
      header: { type: [String], default: [] },
      body:   { type: [String], default: [] },
    },

    // ─── Split partner (panels) ──────────────────────────────
    splitPartnerId: { type: String, default: null },

    // ─── Filter options (smart/filtered containers) ──────────
    filter: { type: mongoose.Schema.Types.Mixed },

    // ─── Custom CSS (CS6a) ───────────────────────────────────
    // Scoped CSS injected as <style>.mod-{id} { ... }</style> in Module.jsx
    customCss: { type: String, default: "" },

    // ─── Trash (soft delete) ────────────────────────────────
    trashed: { type: Boolean, default: false, index: true },

    // ─── Meta ────────────────────────────────────────────────
    // Mixed by intent — meta keys vary by role/kind. The canonical
    // contracts (the only places meta has a documented schema) are:
    //
    // Artifact modules (role:"artifact"):
    //   @typedef {Object} ArtifactMeta
    //   @property {string}        mimeType       MIME type from upload (e.g. "image/png").
    //   @property {string}        originalName   Original filename as uploaded.
    //   @property {number}        uploadSize     Bytes on disk.
    //   @property {"pending"|"ready"|"error"} uploadStatus  Lifecycle flag.
    //                                            Client placeholders mint "pending";
    //                                            server upload handler flips to "ready";
    //                                            client error handler flips to "error".
    //   @property {string|null}   folderId       Parent folder id for the artifact panel
    //                                            tree view. null = unfiled.
    //   @property {Object} [exif]                Optional EXIF block (image artifacts only,
    //                                            populated by future EXIF extraction work).
    //   @property {number} [width]               Image/video pixel width (future).
    //   @property {number} [height]              Image/video pixel height (future).
    //
    // Template-side modules carry meta.templateModule:true (see
    // utils/cloneSubtree.js). Schedule-slot modules carry
    // meta.scheduleSlot:true + meta.slotLabel (see scripts/createTestGrid.js).
    // Anything outside the contracts above is free-form.
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

// Compound (userId, gridId) — `Module.find({ userId, gridId })` is the
// hot path on full_state. Without this, Mongo picks the userId index and
// in-memory-filters gridId; Atlas Serverless ran the query in 4.9s for
// 618 docs against single-field indexes only.
ModuleSchema.index({ userId: 1, gridId: 1 });

ModuleSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret._id = ret._id?.toString?.() ?? ret._id;
    return ret;
  },
});

export default mongoose.model("Module", ModuleSchema);
