// client/src/helpers/transactionScope.js
//
// Reading transactions for the notification stack, which is the change history
// since 2026-09-25 (the per-module history panel was removed: its per-row Undo
// restored a whole `before` snapshot out of order, erasing later edits).
//
//   describeSnapshotTransaction  a readable line for a gesture's undo record
//   touchesScope / openPageScopes  the dropdown's "this page" filter
//
// What a transaction names is an OCCURRENCE (or a module, for a module write) —
// measured 2026-09-22, no record carries a panel or container id.

import { cachedParentMap } from "./dragHitTesting";

/**
 * A human line for a SnapshotOp — the shape every write takes now, and the one
 * `TransactionHistory.getDescription` had no branch for, so every row read
 * "Unknown operation" (200 of 242 transactions on the rebuild grid).
 *
 * There is nothing to guess: the transaction carries the label the gesture
 * opened with (`withAction("Created item", …)`) and the docs it wrote. The
 * label alone is the fallback, then a plain count, and only with neither does
 * it admit it does not know — inventing a description would be worse.
 */
export function describeSnapshotTransaction(tx, { occurrencesById = {}, modulesById = {} } = {}) {
  const label = String(tx?.description || "").trim();
  const docs = Array.isArray(tx?.docs) ? tx.docs : [];

  const names = [];
  for (const d of docs) {
    if (!d?.id) continue;
    const occ = occurrencesById[d.id];
    const mod = modulesById[d.id] || (occ?.moduleId ? modulesById[occ.moduleId] : null);
    const name = occ?.label || mod?.label;
    if (name) names.push(name);
  }

  if (label && names.length) {
    // The overflow counts DOCS, not resolvable names: a transaction that wrote
    // three rows and can only name two must not read as if it wrote two.
    const shown = names.slice(0, 2);
    const extra = docs.length - shown.length;
    const list = shown.join(", ");
    return extra > 0 ? `${label} — ${list} +${extra}` : `${label} — ${list}`;
  }
  if (label) return label;
  if (docs.length) return `${docs.length} change${docs.length === 1 ? "" : "s"}`;
  return "Unknown operation";
}

// ── SCOPED NOTIFICATION HISTORY (2026-09-25) ─────────────────────────────────
// The notification dropdown IS the change history now, and the user wanted it
// scoped ("scoped history please"): All, or the page a panel is showing. A
// gesture pill carries the ids of every row it touched; it belongs to a page
// when any of them sits under that page.


/** Does any touched row live on (or under) `scopeOccId`? */
export function touchesScope(touchedIds, scopeOccId, occurrencesById = {}) {
  if (!scopeOccId) return true;
  if (!Array.isArray(touchedIds) || touchedIds.length === 0) return false;
  const pbc = cachedParentMap(occurrencesById);
  for (const start of touchedIds) {
    let cur = start;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === scopeOccId) return true;
      seen.add(cur);
      cur = pbc[cur] ?? occurrencesById[cur]?.parentId ?? null;
    }
  }
  return false;
}

/** The pages panels are showing right now, as scope choices. */
export function openPageScopes({ views = [], occurrencesById = {}, modulesById = {} } = {}) {
  const out = [];
  const seen = new Set();
  for (const v of views) {
    const id = v?.activeOccurrenceId;
    if (!id || seen.has(id) || !occurrencesById[id]) continue;
    seen.add(id);
    const occ = occurrencesById[id];
    out.push({ id, label: occ.label || modulesById[occ.moduleId]?.label || "Page" });
  }
  return out;
}
