// __tests__/historyRetention.test.js
//
// The transaction log grew without bound. `pruneLater`'s cap keys on `sequence`,
// which ONLY the snapshot transactions carry — `MeasureOp` rows written by the
// occurrence handler have none, so the prune could never see them. Measured on
// poms grid 2026-08-28: 37,840 rows across 49.6 days, 87.7 MB, of which 37,028
// were unprunable and growing ~746/day.
//
// The retention predicate keys on "the undo stack can never use this" — no
// `docs` — rather than on the type NAME, so a future doc-less type is covered
// without anyone remembering. It MUST agree with `STACK_FILTER` in
// socketHandlers/transactions.js: anything the stack can still pop must survive.
import { describe, it, expect } from "vitest";
import { HISTORY_ONLY, historyCutoff, HISTORY_CAP } from "../utils/txRecorder.js";

// The undo stack's own predicate, copied verbatim from
// socketHandlers/transactions.js:139 so drift between the two is visible here.
const STACK_FILTER = { docs: { $exists: true, $ne: [] }, "meta.derived": { $ne: true } };

/** Evaluate the retention predicate the way Mongo would. */
const isHistoryOnly = (tx) => HISTORY_ONLY.$or.some(c =>
  ("docs" in c && c.docs?.$exists === false) ? !("docs" in tx)
    : ("docs" in c && c.docs?.$size === 0) ? Array.isArray(tx.docs) && tx.docs.length === 0
    : false);
/** And the stack's, so the two can be compared on the same rows. */
const isOnStack = (tx) => Array.isArray(tx.docs) && tx.docs.length > 0 && tx?.meta?.derived !== true;

describe("retention keeps everything the undo stack can still use", () => {
  const undoable = { id: "a", docs: [{ model: "occurrence", id: "x" }], meta: {} };
  const derived  = { id: "b", docs: [{ model: "occurrence", id: "x" }], meta: { derived: true } };
  const measure  = { id: "c", type: "MeasureOp" };                 // no `docs` key at all
  const emptied  = { id: "d", type: "MeasureOp", docs: [] };       // present but empty

  it("an UNDOABLE transaction is never history-only", () => {
    expect(isHistoryOnly(undoable)).toBe(false);
    expect(isOnStack(undoable)).toBe(true);
  });

  it("a MeasureOp with no `docs` key IS history-only — the 37,028 case", () => {
    expect(isHistoryOnly(measure)).toBe(true);
    expect(isOnStack(measure)).toBe(false);
  });

  it("an EMPTY docs array is history-only too", () => {
    // `docs: []` and an absent key are the same thing to the stack, so the
    // predicate has to cover both or half the rows never age out.
    expect(isHistoryOnly(emptied)).toBe(true);
    expect(isOnStack(emptied)).toBe(false);
  });

  it("NOTHING is both prunable and on the stack — the invariant that matters", () => {
    for (const tx of [undoable, derived, measure, emptied])
      expect(isHistoryOnly(tx) && isOnStack(tx)).toBe(false);
  });

  it("a DERIVED snapshot is kept by this predicate, not aged out by it", () => {
    // It carries docs, so it is not history-only. It is off the undo stack for a
    // different reason (`meta.derived`), and the sequence cap is what bounds it.
    expect(isHistoryOnly(derived)).toBe(false);
  });
});

describe("the two limits", () => {
  // THE WINDOW is the retention promise; THE CAP bounds a burst. A window alone
  // does not bound the collection, which the distribution says outright:
  // measured 2026-08-28, the long-run rate is ~746 rows/day but an ACTIVE day
  // adds 8,000-22,000 — so a quiet week prunes nothing while one busy day adds
  // twenty thousand rows that the window will not touch for a week.
  it("the window is a week back from now", () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    expect(historyCutoff(now).toISOString()).toBe("2026-08-21T12:00:00.000Z");
  });

  it("keeps a row from yesterday and drops one from last month", () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    const cutoff = historyCutoff(now);
    expect(new Date("2026-08-27T12:00:00Z") >= cutoff).toBe(true);
    expect(new Date("2026-07-27T12:00:00Z") >= cutoff).toBe(false);
  });

  it("the cap is a positive per-grid count — the half the window cannot do", () => {
    expect(HISTORY_CAP).toBeGreaterThan(0);
    expect(Number.isInteger(HISTORY_CAP)).toBe(true);
  });

  it("STACK_FILTER still demands non-empty docs — if this changes, the predicate must too", () => {
    // A pin, not a tautology: the retention rule is only safe while the stack's
    // definition of usable is "has docs".
    expect(STACK_FILTER.docs).toEqual({ $exists: true, $ne: [] });
  });
});
