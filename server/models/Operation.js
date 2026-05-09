// models/Operation.js
import mongoose from "mongoose";

const OperationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true, unique: true },
    userId: { type: String, required: true, index: true },
    gridId: { type: String, required: true, index: true },

    name: { type: String, default: "Untitled Operation" },
    description: { type: String, default: "" },

    // Snap!-style block tree (recursive block structure)
    blockTree: { type: mongoose.Schema.Types.Mixed, default: null },

    // Which field this operation calculates
    targetFieldId: { type: String, default: null },

    // When to evaluate — event type (generalized)
    triggerType: { type: String, default: "manual" },
    // Array of trigger objects: [{ eventType, subjectType, subjectRole, targetId }]
    triggerObjects: { type: mongoose.Schema.Types.Mixed, default: null },
    // Legacy multi-trigger support
    triggerTypes: { type: [String], default: null },
    triggerConfig: { type: mongoose.Schema.Types.Mixed, default: null },

    // 4-stage pipeline (Trigger → Source → Conditions → Actions)
    // Stored alongside blockTree; new operations use pipeline, legacy use blockTree.
    pipeline: { type: mongoose.Schema.Types.Mixed, default: null },


    // Optional interval (ms) for onInterval trigger
    intervalMs: { type: Number, default: null },

    // Whether this operation is active
    enabled: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
    // Category folder — references a Folder with folderType "category"
    folderId: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

OperationSchema.index({ gridId: 1, targetFieldId: 1 });
OperationSchema.index({ gridId: 1, sortOrder: 1 });

const Operation = mongoose.model("Operation", OperationSchema);
export default Operation;
