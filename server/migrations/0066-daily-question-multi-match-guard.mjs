// server/migrations/0066-daily-question-multi-match-guard.mjs
//
// USER, 2026-08-10: "it says $dq has no id to update."
//
// ── THE CAUSE, MEASURED ON THE LIVE GRID ────────────────────────────────────
//
// `Day Page: Build` finds a day's Daily Question container by
// `_ancestors HAS_ANCESTOR $colId` + identitySignature, then fills it with a
// random question. A FIND that matches MORE THAN ONE binds an ARRAY.
//
// The guard is `$dqId IS_NOT_EMPTY` — and an ARRAY OF IDS IS NOT EMPTY, so the
// guard passes. The `UPDATE $dq.fields.<q>.value` that follows needs a record
// with `.id`, which an array has not, and throws exactly that message.
//
// Counted on poms grid (server/scripts/_dqcount.mjs), 14 occurrences carry the
// signature and two columns carry TWO each:
//
//   Thursday, July 30th, 2026    2    a8f81063 + 1771b73c   (same parentId)
//   Saturday, August 1st, 2026   2    22b4def1 + 6ac54ca2   (same parentId)
//   every other column           1
//
// Those duplicates are the 2026-07-31 (3) duplicate-wrapper class (merge cloning
// a node whose identitySignature was absent). 0022/0023 signed the sections and
// their children; these two columns escaped it.
//
// ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
//
// It adds ONE rule — `$dq.id IS_NOT_EMPTY` — to that guard, so a multi-match
// SKIPS the fill instead of throwing. An array has no `.id`. Fails closed, which
// is the posture the rest of that op already takes.
//
// It does NOT delete the duplicates. That is a separate, careful pass: the
// 0022/0023 rule is that the keeper is whichever copy HOLDS WRITING and anything
// containing text is never removed — a duplicate wrapper is a nuisance, a deleted
// journal answer is not. Stopping the error first means that cleanup can be done
// carefully rather than under pressure.
//
// ── WHY A MIGRATION AT ALL ──────────────────────────────────────────────────
//
// The builder (`makeDayPageBuildOp`) carries the same fix, but the STORED
// pipeline is what actually runs on a seeded grid — a builder edit alone would be
// INERT here, the "shipped and does nothing" class this repo keeps paying for
// (0062's own header records it). Both halves, or neither.
//
// Idempotent by construction: it looks for the rule before adding it, so a
// re-run reports "already guarded" and writes nothing.

export const id = "0066-daily-question-multi-match-guard";
export const describe =
  'Day Page: Build — add `$dq.id IS_NOT_EMPTY` so a multi-match FIND (which binds an ARRAY) '
  + 'skips the daily-question fill instead of throwing "$dq has no id to update".';

const OP_NAME = "Day Page: Build";
const ANCHOR_LEFT = "$dqId";       // the rule that identifies the right guard
const NEW_LEFT = "$dq.id";         // the rule we add beside it

const mkId = () => Math.random().toString(36).slice(2, 10);

/** Walk every step list in a pipeline, in place. `fn(steps)` may mutate. */
function walkStepLists(steps, fn) {
  if (!Array.isArray(steps)) return;
  fn(steps);
  for (const st of steps) {
    if (!st || typeof st !== "object") continue;
    walkStepLists(st.then, fn);
    walkStepLists(st.else, fn);
    walkStepLists(st.body, fn);
  }
}

/**
 * Add the multi-match guard to every condition group that gates on `$dqId`.
 * Pure-ish: mutates `op.pipeline` only when it actually changes something, so an
 * op already in the target shape is never written back.
 *
 * Exported so the test drives the REAL function rather than a copy of its logic.
 */
export function addMultiMatchGuard(op) {
  const report = { added: 0, alreadyGuarded: 0, changed: false, reason: null };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) { report.reason = "op has no pipeline steps"; return report; }

  // Recurses into NESTED groups — a guard may sit inside an OR within the
  // condition's AND, and a top-level-only scan would silently miss it (the
  // inert-fix class 0062 records).
  const visit = (group) => {
    const rules = group?.rules;
    if (!Array.isArray(rules)) return;
    for (const r of rules) if (Array.isArray(r?.rules)) visit(r);
    const anchorAt = rules.findIndex((r) => r?.left === ANCHOR_LEFT && r?.comparator === "IS_NOT_EMPTY");
    if (anchorAt === -1) return;
    if (rules.some((r) => r?.left === NEW_LEFT)) { report.alreadyGuarded += 1; return; }
    // Insert directly AFTER the anchor: the $dqId rule still guards the
    // matched-nothing case (a FIND with no match may leave $dq unbound), and
    // this one adds the matched-many case. Order keeps that reading obvious.
    rules.splice(anchorAt + 1, 0, { id: mkId(), left: NEW_LEFT, comparator: "IS_NOT_EMPTY", right: "" });
    report.added += 1;
    report.changed = true;
  };
  walkStepLists(steps, (list) => { for (const st of list) visit(st?.condition); });

  if (!report.changed && !report.alreadyGuarded) {
    // Fails CLOSED and says why. Guessing where a guard belongs in someone
    // else's pipeline is how a migration writes the wrong thing.
    report.reason = `no "${ANCHOR_LEFT} IS_NOT_EMPTY" guard found to attach to`;
  }
  return report;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME });
  if (!op) {
    // Named, never silent — a grid without this op is a real difference.
    log(`  · "${OP_NAME}" is not on this grid — nothing to guard`);
    return;
  }

  const before = JSON.stringify(op.pipeline);
  const report = addMultiMatchGuard(op);

  if (report.reason) { log(`  · REFUSED: ${report.reason}`); return; }
  if (!report.changed) {
    log(`  · "${OP_NAME}" already carries the multi-match guard (${report.alreadyGuarded} site) — no change`);
    return;
  }

  log(`  · "${OP_NAME}" ADDS \`${NEW_LEFT} IS_NOT_EMPTY\` to ${report.added} guard site(s)`);
  log("    (a multi-match FIND binds an ARRAY; an array has no .id, so the fill is skipped instead of throwing)");
  if (dryRun) { op.pipeline = JSON.parse(before); return; }
  op.markModified("pipeline");
  await op.save();
}
