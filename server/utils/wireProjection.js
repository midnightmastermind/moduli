// DON'T SEND WHAT NOBODY READS, AND DON'T SEND A CONSTANT 25,525 TIMES.
//
// The sibling of `omitNullKeys.js`, and deliberately a SEPARATE decision. That
// rule is a fact about the VALUE ("it is absent"), names no key, and is safe
// forever. This one is a fact about the CLIENT ("nothing reads it"), so it can
// only be a named list — and a named list is exactly the class this codebase
// keeps getting burned by. `wireProjection.test.js` is therefore the other half
// of this file: it GREPS the client for a reader of every omitted key and fails
// when one appears, so the list cannot silently go stale.
//
// ── MEASURED ON poms GRID, per key, 2026-09-28 ────────────────────────────
//
//     DEFERRED artifact occurrences  17,160 rows   17.95MB
//       userId + gridId    1.24MB   7%   the SAME two strings, 17,160 times
//       timestamp          0.67MB   4%   0 client readers
//       _id                0.57MB   3%   duplicates `id`
//
// Across the whole payload that is ~4.2MB of 33.5MB the device inflates and
// JSON.parses on its main thread. It matters because the catalogue is already
// dispatched as ONE store write (`bcd57ee4`), so what is left of each chunk's
// 1-4s freeze is arriving and parsing — which is bytes and nothing else.
//
// ── WHAT IS NOT ON THIS LIST, AND WHY ─────────────────────────────────────
//
// `updatedAt` looks identical to `timestamp` and is 0.67MB, and it STAYS. A
// first grep for `occurrence.updatedAt` reported zero readers; the real ones
// address it differently and one of them is load-bearing:
//
//     CommitHelpers.js:332   localPrev?.updatedAt   -> expectedUpdatedAt, the
//                                                      stale-write conflict guard
//     PageFolder.jsx:553     occ?.updatedAt || mod?.updatedAt
//     ModuleContainer:1683   occ?.updatedAt || occ?.createdAt
//
// `createdAt` stays for the same reason (9 readers). *A grep shaped like the
// name you expected is a claim about your expectation.*

/** Keys stripped from every row on the wire. Nothing in the client reads them.
 *  `_id` duplicates `id`, which is non-empty on 17,160/17,160 occurrences and
 *  4,906/4,906 modules — the `o.id || o._id?.toString?.()` fallbacks in
 *  bindSocketToStore are kept, they simply never fire. */
export const WIRE_OMIT_KEYS = Object.freeze(["_id", "timestamp"]);

/** Keys that are IDENTICAL on every row of a message, so they travel once on
 *  the envelope and are put back on arrival. These ARE read — 23 sites for
 *  gridId, 11 for userId, including the cross-grid guards — so they are
 *  RESTORED rather than dropped, and every reader sees the shape it always saw. */
export const WIRE_HOIST_KEYS = Object.freeze(["gridId", "userId"]);

/**
 * Strip the dead keys and lift the constants off a batch of rows.
 * @returns {{ rows: object[], hoisted: object }} — `hoisted` goes on the
 *   envelope; a key is hoisted ONLY when every row agrees on it, so a mixed
 *   batch keeps it per row and cannot lose a value.
 */
export function projectRowsForWire(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return { rows: rows || [], hoisted: {} };

  const hoisted = {};
  for (const key of WIRE_HOIST_KEYS) {
    const first = rows[0]?.[key];
    if (first == null) continue;
    if (rows.every((r) => r?.[key] === first)) hoisted[key] = first;
  }

  const out = rows.map((r) => {
    if (!r || typeof r !== "object") return r;
    const copy = {};
    for (const k of Object.keys(r)) {
      if (WIRE_OMIT_KEYS.includes(k)) continue;
      if (k in hoisted) continue;
      copy[k] = r[k];
    }
    return copy;
  });
  return { rows: out, hoisted };
}

/**
 * The inverse, run on the client the moment a payload arrives. Putting the
 * hoisted constants back before ANYTHING else touches the payload is what lets
 * every downstream reader stay unchanged.
 */
export function rehydrateWireRows(rows = [], hoisted = {}) {
  const keys = Object.keys(hoisted || {});
  if (!Array.isArray(rows) || keys.length === 0) return rows || [];
  return rows.map((r) => (r && typeof r === "object" ? { ...hoisted, ...r } : r));
}
