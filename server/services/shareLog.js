// server/services/shareLog.js
//
// The Imports tab's "recent shares" (D16). With no inbox (D2), this log is the
// only way to notice a rule sending things to the wrong place — so EVERY share
// is recorded, the failures included (spec §12).
//
// Capped and atomic: one `$push` with `$slice`, so two shares landing at once
// cannot drop each other's entry, and the list never grows past SHARE_LOG_MAX.
// Metadata only — the shared content itself is never kept (so no "re-run").
import Grid from "../models/Grid.js";

export const SHARE_LOG_MAX = 50;

const clip = (s, n) => (typeof s === "string" && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? null);

/** Pure: the log entry for one share. */
export function shareLogEntry({ share = null, result = null, error = null, at = new Date() }) {
  const rules = (result?.ran || []).map(r => ({
    ruleId: r.ruleId, ruleName: r.ruleName, ok: r.ok !== false,
    error: r.error?.message ? clip(r.error.message, 300) : null,
    created: (r.created || []).map(c => ({ occurrenceId: c.occurrenceId, status: c.status })),
  }));
  const createdCount = rules.reduce((n, r) => n + r.created.length, 0);
  return {
    at: at.toISOString(),
    type: share?.type ?? null,
    source: share?.source ?? null,
    label: clip(share?.label, 200),
    externalId: clip(share?.externalId, 300),
    halted: !!result?.halted,
    rules,
    // "landed" only when something was actually written; a share every rule
    // skipped or failed is exactly what this log exists to surface.
    status: error ? "failed" : createdCount > 0 ? "landed" : "nothing",
    error: error ? clip(String(error), 300) : null,
  };
}

/**
 * Append an entry and tell every open tab. Never throws: a share that landed
 * must not be reported as failed because its log line could not be written.
 */
export async function recordShare({ userId, gridId, entry, io = null, userRoom = null }) {
  try {
    const grid = await Grid.findOneAndUpdate(
      { _id: gridId, userId },
      { $push: { shareLog: { $each: [entry], $slice: -SHARE_LOG_MAX } } },
      { returnDocument: "after", projection: { shareLog: 1 } },
    ).lean();
    if (grid && io && userRoom) {
      io.to(userRoom(userId)).emit("grid_updated", { gridId, grid: { shareLog: grid.shareLog } });
    }
    return grid?.shareLog || null;
  } catch (e) {
    console.warn("[shareLog] could not record a share:", e?.message || e);
    return null;
  }
}
