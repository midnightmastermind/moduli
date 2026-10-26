// utils/importDedupe.js — an operation's import of the same content into the same place happens once.
//
// "Day Page: Readings" runs from three triggers on a load (onLoad + two onFilterChange) and in every open tab, and
// each run can reach its import before the others' "already imported" marks land. On 2026-10-26 one day page got
// 2× Daily Reflections, 3× The Daily Stoic and 3× The Tao Te Ching, the 3 copies written within 5ms of each other
// (user: "the reflections that get posted on each day page are posting twice"). A pipeline cannot defend against this
// because its input is the state the other runs have not reached yet; the server sees every request.
//
// A request that asks for it (`dedupe`, sent by every operation import) is keyed by user + grid + parent + shape +
// title + content. A second request with that key gets the FIRST one's result: the one still running, or the root it
// left (`meta.importKey` on the root, while it is still under that parent). Drag/paste imports never send `dedupe`, so
// importing the same text twice by hand still makes two.
import crypto from "node:crypto";
import Occurrence from "../models/Occurrence.js";

export function importDedupeKey({ userId, gridId, parentId, shape, title, content }) {
  const h = crypto.createHash("sha1");
  for (const part of [userId, gridId, parentId, shape, title, content]) h.update(String(part ?? "")).update("\u0000");
  return h.digest("hex");
}

const running = new Map();

/** Root the earlier import with this key left under `parentId`, or null. */
export async function findImportedRoot({ gridId, parentId, key }, model = Occurrence) {
  const hit = await model.findOne({ gridId, parentId, "meta.importKey": key }).select("id").lean();
  return hit?.id || null;
}

/**
 * Run `fn` once per key: a request arriving while one runs gets its result; one arriving after it finished gets
 * the root it left (`{ reused: true, rootOccurrenceId }`). `fn` returns the reply payload.
 */
export async function runDeduped(key, { gridId, parentId }, fn, { find = findImportedRoot } = {}) {
  if (running.has(key)) return { ...(await running.get(key)), reused: true };
  const existing = await find({ gridId, parentId, key });
  if (existing) return { ok: true, rootOccurrenceId: existing, reused: true };
  if (running.has(key)) return { ...(await running.get(key)), reused: true };   // started while we looked
  const p = Promise.resolve().then(fn);
  running.set(key, p);
  try { return await p; } finally { running.delete(key); }
}
