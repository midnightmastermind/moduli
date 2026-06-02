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

    // Which occurrence's effective filter drives the built-in date vars
    // ($activeDate / $activePeriod / $activePeriodDates) for this op. When set,
    // the executor resolves the active period from THIS occurrence's filter
    // chain (page filterOverride → grid) instead of the grid filter alone — so
    // a period-based op (e.g. Schedule: Build Schedule) reacts to an on-page
    // filter switch, not just a toolbar/grid switch. Unset → grid-level (legacy
    // behavior for every other op).
    targetOccurrenceId: { type: String, default: null },

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

    // Time-based schedule (separate from triggerObjects). When set, this op
    // runs on a cadence instead of in response to events. Sub-hour cadences
    // are restricted to display-only effects (no socket writes) — enforced
    // at op-save time client-side. `lastFiredAt` is the authoritative cross-
    // device coordinator: any client that fires the op writes this back and
    // other clients skip until cadence elapses again.
    // Shape:
    //   { kind: "interval", every: N, unit: "second"|"minute"|"hour"|"day",
    //     suppressNotifications?, lastFiredAt? }
    //   { kind: "atTimes", times: ["09:00", "12:00"], lastFiredAt? }
    schedule: { type: mongoose.Schema.Types.Mixed, default: null },

    // Whether this operation is active
    enabled: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
    // Category folder — references a Folder with folderType "category"
    folderId: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Optional shared secret for /api/webhooks/:operationId HMAC
    // verification. When set, incoming webhook requests must carry
    // X-Moduli-Signature: sha256=<hex(hmacSha256(secret, rawBody))>.
    // Unset → endpoint accepts any request (back-compat / public hooks).
    webhookSecret: { type: String, default: null },
  },
  { timestamps: true }
);

OperationSchema.index({ gridId: 1, targetFieldId: 1 });
OperationSchema.index({ gridId: 1, sortOrder: 1 });

const Operation = mongoose.model("Operation", OperationSchema);
export default Operation;
