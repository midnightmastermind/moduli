// models/Connection.js — a place a user's files can be stored (plan
// 2026-09-24-connections-storage-gdrive §2.4). The SERVER's own disk is not a
// record: it is always present, cannot be removed, and has the fixed id
// "server" (services/connections.SERVER_CONNECTION).
//
// Credentials are encrypted ON THIS RECORD with Secret.js's AES-256-GCM helpers
// — deliberately NOT stored in the Secret collection, whose values an
// operation can read as `$secrets.KEY` and send anywhere with CALL_API.
// Nothing outside services/storage ever decrypts `credentials`, and it is
// never serialised to a client (see services/connections.publicConnection).
import mongoose from "mongoose";

const CipherSchema = new mongoose.Schema(
  { iv: String, ciphertext: String, authTag: String },
  { _id: false },
);

const ConnectionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["gdrive"], required: true },
    name: { type: String, default: "" },
    // Type-specific, NOT secret: e.g. gdrive { folderId, accountEmail }.
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    credentials: { type: CipherSchema, default: null },
    status: { type: String, enum: ["ok", "needs_reconnect", "error"], default: "ok" },
    statusMessage: { type: String, default: null },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("Connection", ConnectionSchema);
