// server/services/shareStage.js
//
// Create, read and consume a staged share. EVERY key check lives here — one
// place to read when asking "what can this URL parameter actually do".
//
// What the key authorizes: reading ONE staged payload and committing it. Not
// reading a grid, not listing occurrences, not writing anything else. It dies
// on the commit or at ten minutes, whichever comes first.
import crypto from "node:crypto";
import ShareStage from "../models/ShareStage.js";

export const STAGE_TTL_MS = 10 * 60 * 1000;

const newId = () => crypto.randomUUID();
const newKey = () => crypto.randomBytes(32).toString("hex");

// Constant-time, and length-safe: timingSafeEqual throws on a length mismatch.
function keyMatches(stored, given) {
  const a = Buffer.from(String(stored || ""), "utf8");
  const b = Buffer.from(String(given || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

const live = (row) => !!row && !row.consumedAt && row.expiresAt?.getTime() > Date.now();

export async function createStage({ userId, payload }) {
  const stageId = newId();
  const key = newKey();
  await ShareStage.create({
    id: stageId, userId, key, payload,
    createdAt: new Date(), expiresAt: new Date(Date.now() + STAGE_TTL_MS),
  });
  return { stageId, key };
}

/** The payload, or null. Does NOT consume — the window reads before deciding. */
export async function readStage(stageId, key, { withUser = false } = {}) {
  const row = await ShareStage.findOne({ id: stageId }).lean();
  if (!live(row) || !keyMatches(row.key, key)) return null;
  return withUser ? { payload: row.payload, userId: row.userId } : row.payload;
}

/** The payload, once. The commit is what spends the key. */
export async function consumeStage(stageId, key, { withUser = false } = {}) {
  const row = await ShareStage.findOne({ id: stageId }).lean();
  if (!live(row) || !keyMatches(row.key, key)) return null;
  await ShareStage.updateOne({ id: stageId }, { $set: { consumedAt: new Date() } });
  return withUser ? { payload: row.payload, userId: row.userId } : row.payload;
}
