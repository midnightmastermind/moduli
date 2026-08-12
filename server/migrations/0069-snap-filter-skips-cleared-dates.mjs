// server/migrations/0069-snap-filter-skips-cleared-dates.mjs
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// On 2026-08-11 clearing a date started meaning something: *"show nothing
// dated"* (the user's call). Before that a cleared filter behaved like no
// filter, so nothing depended on the state surviving.
//
// `Grid: Snap Filter To Today` moves every date-carrying page forward on the
// first load of a new day, guarded by:
//
//     $pg.filterOverride.<date> IS_NOT_EMPTY
//
// and `isEmptyVal` counts only null / undefined / "" / an empty array. A CLEARED
// date is a period OBJECT whose value is null — non-empty by that rule — so the
// op stamped today onto it the next morning and **silently undid the clear**.
// The user would clear a page, come back tomorrow, and find it dated again with
// nothing to explain why.
//
// ── WHAT THE NEW GUARD SAYS, AND WHY EACH ARM IS THERE ──────────────────────
//
//     IS_NOT_EMPTY  AND  ( value IS_NOT_EMPTY
//                          OR unit IS_EMPTY
//                          OR dates IS_NOT_EMPTY )
//
//   value IS_NOT_EMPTY   a period carrying a real date — move it forward.
//   unit  IS_EMPTY       a BARE "YYYY-MM-DD" string. A string has no `.unit`,
//                        so this arm is true for it and false for every period
//                        object. WITHOUT IT, requiring `.value` would skip a
//                        plain string override entirely — which is what the
//                        Trackers page carries right now.
//   dates IS_NOT_EMPTY   a non-consecutive multi-pick can carry a NULL anchor
//                        while still naming real days. That is a selection, not
//                        a clear.
//
// Everything else — the null-valued single/range shape — is a clear, and is now
// left alone.
//
// ── WHAT THIS DOES NOT CLAIM ────────────────────────────────────────────────
//
// It does NOT fix "a multi-day range survives overnight". That was filed as an
// open recurrence (2026-08-01 (11)) and is **already fixed**: the op writes a
// bare `$today`, which REPLACES the whole object, so a range collapses to a
// single day on the next new-day load. Verified by driving the real `evalRule`
// over the live shapes (`client/src/__tests__/snapFilterGuard.test.js`). A grid
// still showing a range simply has not been opened yet today — poms grid's
// marker reads 2026-08-10 while today is 2026-08-11. *An open item is a claim
// about today's code; re-measure before inheriting it.*
//
// Idempotent: it looks for the OR group before adding it.

export const id = "0069-snap-filter-skips-cleared-dates";
export const describe =
  "Grid: Snap Filter To Today — skip a page whose date was explicitly CLEARED, instead of "
  + "stamping today onto it overnight and undoing the clear.";

const OP_NAME = "Grid: Snap Filter To Today";

const mkId = () => Math.random().toString(36).slice(2, 10);

/**
 * Add the not-a-cleared-date arm to the guard that gates the forward-move.
 *
 * Anchored on the rule whose `left` is a `filterOverride.<field>` path with a
 * bare IS_NOT_EMPTY — the only such rule in this op, and the exact thing being
 * narrowed. Anchoring by position or by "the first rule" would be a guess.
 *
 * Exported so the test drives the REAL function.
 */
export function narrowSnapGuard(op) {
  const report = { patched: 0, alreadyNarrowed: 0, reason: null, path: null };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) { report.reason = "op has no pipeline steps"; return report; }

  const visit = (group) => {
    const rules = group?.rules;
    if (!Array.isArray(rules)) return;
    for (const r of rules) if (Array.isArray(r?.rules)) visit(r);

    const at = rules.findIndex((r) =>
      typeof r?.left === "string"
      && /^\$pg\.filterOverride\.[A-Za-z0-9_-]+$/.test(r.left)
      && r.comparator === "IS_NOT_EMPTY");
    if (at === -1) return;

    const base = rules[at].left;
    report.path = base;
    // Already narrowed? The OR group is recognised by its `.value` arm.
    if (rules.some((r) => Array.isArray(r?.rules)
        && r.rules.some((x) => x?.left === `${base}.value`))) {
      report.alreadyNarrowed += 1;
      return;
    }
    rules.splice(at + 1, 0, {
      id: mkId(), operator: "OR", rules: [
        { id: mkId(), left: `${base}.value`, comparator: "IS_NOT_EMPTY", right: "" },
        { id: mkId(), left: `${base}.unit`,  comparator: "IS_EMPTY",     right: "" },
        { id: mkId(), left: `${base}.dates`, comparator: "IS_NOT_EMPTY", right: "" },
      ],
    });
    report.patched += 1;
  };

  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const st of list) {
      if (!st || typeof st !== "object") continue;
      visit(st.condition);
      walk(st.then); walk(st.else); walk(st.body);
    }
  };
  walk(steps);

  if (!report.patched && !report.alreadyNarrowed) {
    // Fails CLOSED and says why, rather than inventing a place to put the rule.
    report.reason = "no `$pg.filterOverride.<field> IS_NOT_EMPTY` guard found to narrow";
  }
  return report;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME });
  if (!op) { log(`  · "${OP_NAME}" is not on this grid — nothing to narrow`); return; }

  const report = narrowSnapGuard(op);
  if (report.reason) { log(`  · REFUSED: ${report.reason}`); return; }
  if (!report.patched) {
    log(`  · "${OP_NAME}" guard already skips cleared dates — no change`);
    return;
  }

  log(`  · "${OP_NAME}" narrows its guard on \`${report.path}\``);
  log("    now: a real value, OR a bare date string (no unit), OR a multi-pick with dates");
  log("    so a CLEARED date (a period object whose value is null) is left alone overnight");
  if (dryRun) return;
  op.markModified("pipeline");
  await op.save();
}
