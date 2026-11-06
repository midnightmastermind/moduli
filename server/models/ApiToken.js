// models/ApiToken.js
//
// Per-user API token. The raw secret is shown to the caller exactly once
// at creation time (via the CLI / future UI) and never persisted. Auth
// middleware looks up the token by the indexed `tokenId` prefix, then
// bcrypt-compares the rest against `hash`. Scopes gate which routes the
// token can hit.
//
// Token wire format: "moduli_<tokenId>_<secret>" — single string the caller
// passes in the Authorization header. tokenId is enough to look up the
// bcrypt record without scanning every token in the DB.

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const ApiTokenSchema = new mongoose.Schema(
  {
    // 12-char URL-safe id, surfaced in the UI as the "Token ID"
    tokenId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, default: "" },          // user-supplied label
    hash: { type: String, required: true },       // bcrypt of the raw secret half
    scopes: { type: [String], default: ["read"] },
    lastUsedAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Mint a new raw token. Returns { rawToken, tokenDoc } — caller must save
// tokenDoc to DB and surface rawToken to the user exactly once.
ApiTokenSchema.statics.mint = async function ({ userId, name = "", scopes = ["read"] }) {
  const tokenId = crypto.randomBytes(9).toString("base64url"); // 12 chars
  const secret = crypto.randomBytes(24).toString("base64url"); // 32 chars
  const rawToken = `moduli_${tokenId}_${secret}`;
  const hash = await bcrypt.hash(secret, 10);
  const tokenDoc = new this({ tokenId, userId, name, hash, scopes });
  await tokenDoc.save();
  return { rawToken, tokenDoc };
};

// Ensure a token doc exists matching a KNOWN raw token (idempotent by tokenId).
// Lets a stable token live in .env and survive reseeds — the seed re-asserts
// the DB row without changing the raw value the user already pasted.
ApiTokenSchema.statics.upsertFromRaw = async function ({ rawToken, userId, name = "", scopes = ["read"] }) {
  const parts = this.parse(rawToken);
  if (!parts) throw new Error("invalid token format (expected moduli_<id>_<secret>)");
  const hash = await bcrypt.hash(parts.secret, 10);
  return this.findOneAndUpdate(
    { tokenId: parts.tokenId },
    { $set: { tokenId: parts.tokenId, userId, name, hash, scopes, revoked: false } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
};

// Parse "moduli_<tokenId>_<secret>" → { tokenId, secret } or null.
// mint() writes a 12-character base64url id, and base64url includes "_", so the
// id is read by its LENGTH when the token has that shape. Splitting on the first
// "_" cut ~1 id in 6 short and that token could never authenticate (2026-11-06).
// Any other shape (a hand-written id in .env) still splits on the first "_".
const MINTED_ID_LEN = 12;
function splitAt(rest, sep) {
  const tokenId = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  return tokenId && secret ? { tokenId, secret } : null;
}
ApiTokenSchema.statics.parse = function (rawToken) {
  if (typeof rawToken !== "string" || !rawToken.startsWith("moduli_")) return null;
  const rest = rawToken.slice("moduli_".length);
  if (rest[MINTED_ID_LEN] === "_" && rest.length > MINTED_ID_LEN + 1) return splitAt(rest, MINTED_ID_LEN);
  const sep = rest.indexOf("_");
  if (sep < 1) return null;
  return splitAt(rest, sep);
};
// Every split authenticate may try: the parsed one, and the first-"_" one, so a token
// that read correctly under the old rule (a short hand-written id) still does.
function candidateSplits(rawToken, parse) {
  const out = [];
  const main = parse(rawToken);
  if (main) out.push(main);
  if (typeof rawToken === "string" && rawToken.startsWith("moduli_")) {
    const rest = rawToken.slice("moduli_".length);
    const sep = rest.indexOf("_");
    const old = sep > 0 ? splitAt(rest, sep) : null;
    if (old && !out.some((c) => c.tokenId === old.tokenId)) out.push(old);
  }
  return out;
}

// Look up + verify a raw token. Returns the live token doc on success,
// null on any failure (unknown tokenId / wrong secret / revoked).
// Updates lastUsedAt no more than once per 60s to avoid write-amplifying
// every request.
ApiTokenSchema.statics.authenticate = async function (rawToken) {
  const cands = candidateSplits(rawToken, (r) => this.parse(r));
  if (!cands.length) return null;
  const doc = await this.findOne({ tokenId: { $in: cands.map((c) => c.tokenId) }, revoked: false });
  if (!doc) return null;
  const parts = cands.find((c) => c.tokenId === doc.tokenId);
  const ok = await bcrypt.compare(parts.secret, doc.hash);
  if (!ok) return null;
  const now = Date.now();
  if (!doc.lastUsedAt || now - doc.lastUsedAt.getTime() > 60_000) {
    doc.lastUsedAt = new Date(now);
    doc.save().catch(() => {}); // fire-and-forget
  }
  return doc;
};

export default mongoose.model("ApiToken", ApiTokenSchema);
