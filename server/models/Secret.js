// models/Secret.js
//
// Per-user secret store for use in CALL_API headers / bodies. Values
// referenced in pipelines as `$secrets.STRIPE_KEY` and resolved
// server-side at execution time (browser never sees the value).
//
// Encryption: AES-256-GCM with a master key from process.env.SECRETS_KEY.
// The master key must be 32 raw bytes (base64-encode 32 random bytes
// and stash in .env). If SECRETS_KEY is missing, the create endpoint
// refuses to accept secrets (fail-closed).
//
// Per docs/api-plan.md §2.3.

import mongoose from "mongoose";
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function getMasterKey() {
  const raw = process.env.SECRETS_KEY;
  if (!raw) return null;
  let buf;
  try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  if (buf.length !== KEY_LEN) return null;
  return buf;
}

export function isSecretsKeyConfigured() {
  return getMasterKey() != null;
}

export function encryptValue(plaintext) {
  const key = getMasterKey();
  if (!key) throw new Error("SECRETS_KEY not configured");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ct.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

export function decryptCipherShape({ iv, ciphertext, authTag }) {
  const key = getMasterKey();
  if (!key) throw new Error("SECRETS_KEY not configured");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

const SecretSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    key: { type: String, required: true },                 // user-supplied identifier (e.g. "STRIPE_KEY")
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SecretSchema.index({ userId: 1, key: 1 }, { unique: true });

SecretSchema.statics.decryptValue = function (doc) {
  return decryptCipherShape({ iv: doc.iv, ciphertext: doc.ciphertext, authTag: doc.authTag });
};

export default mongoose.model("Secret", SecretSchema);
