// models/Manifest.js
// ============================================================
// MANIFEST: Root tree structure for file/note organization
// Each grid can have one or more manifests (files, day-pages, templates)
// The manifest owns a folder hierarchy via rootFolderId
// ============================================================

import mongoose from "mongoose";

const ManifestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true, unique: true },

    userId: { type: String, required: true, index: true },

    // gridId is optional — manifests are user-scoped (accessible from any grid)
    gridId: { type: String, index: true },

    name: { type: String, default: "Files" },

    // The root folder for this manifest (null = auto-create on first use)
    rootFolderId: { type: String, default: null },

    // Manifest purpose
    manifestType: {
      type: String,
      enum: ["files", "day-pages", "templates"],
      default: "files",
    },

    icon: { type: String, default: "folder-tree" },

    sortOrder: { type: Number, default: 0 },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

ManifestSchema.index({ userId: 1, manifestType: 1 });
ManifestSchema.index({ userId: 1, sortOrder: 1 });

ManifestSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret._id = ret._id?.toString?.() ?? ret._id;
    return ret;
  },
});

export default mongoose.model("Manifest", ManifestSchema);
