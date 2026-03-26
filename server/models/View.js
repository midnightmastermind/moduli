// models/View.js
// ============================================================
// VIEW: Rendering configuration for an occurrence.
// Separate model — referenced by Occurrence via occurrence.viewId.
// Module has NO viewId. View always lives on the occurrence.
// ============================================================

import mongoose from "mongoose";

const ViewSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true, unique: true },

    userId: { type: String, required: true, index: true },

    gridId: { type: String, required: true },
    // View type — determines which renderer to use
    // "list"     = list/board of children (default panel/container view)
    // "artifact" = file content viewer (image/pdf/audio/video — see artifactType below)
    // "markdown" = TipTap rich text editor (occurrence.textmap → Editor.jsx)
    // "code"     = syntax-highlighted code block (fetches raw file via /uploads/)
    // "canvas"   = freeform canvas (future)
    // "doc"      = TipTap doc container (replaces module.kind === "doc")
    // "pool"     = draggable pill library container (replaces module.kind === "pool")
    // "board"    = kanban board columns (replaces module.kind === "board")
    // "log"      = append-only log
    // "smart"    = smart/filtered list
    viewType: {
      type: String,
      enum: ["list", "artifact", "markdown", "canvas", "code", "doc", "pool", "board", "log", "smart", "preview"],
      default: "list",
    },

    // Artifact sub-type — only used when viewType === "artifact"
    // "image" | "pdf" | "audio" | "video"
    artifactType: {
      type: String,
      enum: ["image", "pdf", "audio", "video"],
      default: null,
    },

    // Tree sidebar — show manifest folder tree alongside content
    // Controlled by View, not by the module or occurrence directly
    hasTree: { type: Boolean, default: false },

    // Reference to Manifest (folder tree) — used when hasTree: true
    manifestId: { type: String, default: null },

    // Currently selected artifact occurrence (for artifact panels with tree)
    // Clicking a tree node sets this — drives what content is shown
    activeOccurrenceId: { type: String, default: null },
    scrollAnchor: { type: String, default: null },

    // Default landing page — if set, TreePanelContent resets to this on mount
    defaultOccurrenceId: { type: String, default: null },

    // Layout overrides (e.g. sidebar width, split ratios)
    layout: { type: mongoose.Schema.Types.Mixed, default: {} },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

ViewSchema.index({ gridId: 1 });

ViewSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret._id = ret._id?.toString?.() ?? ret._id;
    return ret;
  },
});

export default mongoose.model("View", ViewSchema);
