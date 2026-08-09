// server/migrations/0062-scope-build-ops-to-their-own-page.mjs
//
// A build op should respond to ITS OWN page's filter — user decision D7,
// 2026-08-09: *"daycol should only show up on the schedule or daypage and
// should be always based on the filter applied on it."*
//
// ── WHAT WAS HAPPENING, MEASURED ON THE LIVE GRID ───────────────────────────
//
// Both build ops carry an unscoped `onFilterChange / filterNav` trigger and
// gate inside the pipeline on `$trigger.sourceOccurrenceId`. That guard let
// through the Schedule page, the Goals/Trackers page AND (for the Day Page op)
// the board. Driving the REAL trigger matcher over the live op data:
//
//   poms grid            ops matched by one navigation
//   toolbar / grid                48
//   Schedule page nav              6   ← incl. Day Page: Build
//   Day Page board nav             4
//   Trackers page nav             44   ← incl. BOTH build ops
//
// ── AND THE FOREIGN RUNS COULD NEVER CHANGE ANYTHING ────────────────────────
//
// Each op's dates come from `$activePeriodDates`, which the executor resolves
// from `operation.targetOccurrenceId` — the op's OWN page (`Schedule: Build
// Schedule` → the Schedule page; `Day Page: Build` → the Day Page board). So a
// navigation sourced from a different page could only ever rebuild that op's
// page for its own UNCHANGED dates: a per-day FIND, an APPLY_TEMPLATE merge and
// two extra passes, to conclude nothing changed.
//
// That is why this is safe rather than a behaviour trade. The one behaviour
// that DID depend on the Goals coupling — 2026-05-15, "a Goals nav seeds the
// Schedule for that day" — belonged to `makeScheduleBuildDayOp`, whose
// `$schedDate` chain prefers `$trigger.date`. That op is not on this grid;
// `Schedule: Build Schedule` never had that behaviour to lose.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
// Surgical, and idempotent by construction: in each op's source guard it drops
// the `$trigger.sourceOccurrenceId IS <foreign page>` rules, and removes the
// `$goalsPage` INIT_VAR left dead by that. It touches NOTHING else — no
// occurrence moves, no field is written, and an op already in the target shape
// is skipped. Re-running reports 0 changes.
//
// The seed builders (`utils/liveSystemBuilders.js`) were changed in the same
// pass, so a reseeded grid and a migrated grid produce the same guard.

export const id = "0062-scope-build-ops-to-their-own-page";
export const describe =
  "Scopes `Schedule: Build Schedule`, `Day Page: Build` and `Schedule: Place "
  + "Dated Work` to their own page's filter: the source guard no longer passes a "
  + "navigation that came from a different page (and Place Dated Work, which had "
  + "no guard at all, gets one). Removes the dead $goalsPage var left behind. "
  + "No occurrence moves and no field is written.";

/**
 * Per op: which `$var.id` rights the source guard is allowed to keep.
 * `IS_EMPTY` (the toolbar / onLoad case) is always kept.
 */
const KEEP_BY_OP = {
  "Schedule: Build Schedule": new Set(["$schedPage.id"]),
  "Day Page: Build": new Set(["$board.id"]),
  // Same page as Build Schedule, and the same reasoning — its dates come from
  // `targetOccurrenceId`. Its guard is NEW (it had none), so on a grid seeded
  // before today there is nothing to drop; the builder is what adds it, and a
  // reseed or this migration's sibling work carries it. Listed so a re-run
  // reports on it rather than passing over it silently.
  "Schedule: Place Dated Work": new Set(["$schedPage.id"]),
};

/**
 * Ops that had NO source guard at all, and where the migration must therefore
 * ADD one rather than tighten. Value = the `$var.id` this op's own page is
 * bound to, plus the rule its precondition can be recognised by.
 *
 * Without this the builder fix would be INERT on an already-seeded grid — the
 * guard would exist only for grids reseeded after today, which is exactly the
 * "shipped and does nothing" class this repo keeps paying for.
 */
const ADD_GUARD_TO = {
  "Schedule: Place Dated Work": { own: "$schedPage.id", anchorLeft: "$schedPageId" },
};

/** Vars that become dead once their guard rule is gone. */
const DROP_VARS = new Set(["$goalsPage"]);

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
 * Tighten one op. Returns a report; mutates `op.pipeline` only when something
 * actually changed, so an unchanged op is never written back.
 */
export function tightenOp(op, keep) {
  const report = { droppedRules: [], droppedVars: [], changed: false };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) return report;

  // Recurses into NESTED rule groups: `Schedule: Place Dated Work` carries its
  // guard as an OR group inside the precondition's AND rather than as its own
  // wrapping `if`, and a top-level-only scan would silently miss it — the class
  // of "the fix was inert" this repo keeps paying for.
  const tightenGroup = (group) => {
    const rules = group?.rules;
    if (!Array.isArray(rules)) return;
    for (const r of rules) if (Array.isArray(r?.rules)) tightenGroup(r);
    if (!rules.some((r) => r?.left === "$trigger.sourceOccurrenceId")) return;
    const next = rules.filter((r) => {
      if (r?.left !== "$trigger.sourceOccurrenceId") return true;
      if (r.comparator === "IS_EMPTY") return true;
      if (keep.has(r.right)) return true;
      report.droppedRules.push(r.right);
      return false;
    });
    if (next.length !== rules.length) { group.rules = next; report.changed = true; }
  };
  walkStepLists(steps, (list) => { for (const st of list) tightenGroup(st?.condition); });

  // Only now that the rules are gone: drop INIT_VARs nothing references any
  // more. Checked against the WHOLE remaining pipeline rather than assumed —
  // the same var could legitimately be read elsewhere in another op's shape.
  if (report.changed) {
    for (const varName of DROP_VARS) {
      const body = JSON.stringify(steps);
      const uses = (body.match(new RegExp(`\\${varName}\\b`, "g")) || []).length;
      // 1 use == the INIT_VAR's own `name`; anything more means it is read.
      if (uses !== 1) continue;
      walkStepLists(steps, (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i]?.config;
          if (c?.type === "INIT_VAR" && c?.name === varName) { list.splice(i, 1); report.droppedVars.push(varName); }
        }
      });
    }
  }
  return report;
}

/**
 * Insert the source guard into an op that has none.
 *
 * Nested INTO the existing precondition group rather than wrapped around it:
 * `evalGroup` handles nested groups, and rewriting a stored pipeline's step
 * NESTING is a far bigger edit than adding one rule to a condition already
 * there. Idempotent — an op already carrying any `$trigger.sourceOccurrenceId`
 * rule is left alone.
 */
export function addGuard(op, { own, anchorLeft }, mkId = () => `g-${Math.random().toString(36).slice(2, 10)}`) {
  const report = { added: false, reason: null };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) { report.reason = "no pipeline"; return report; }
  if (JSON.stringify(steps).includes("$trigger.sourceOccurrenceId")) {
    report.reason = "already guarded"; return report;
  }
  let anchor = null;
  walkStepLists(steps, (list) => {
    for (const st of list) {
      const rules = st?.condition?.rules;
      if (!anchor && Array.isArray(rules) && rules.some((r) => r?.left === anchorLeft)) anchor = st;
    }
  });
  // Fails CLOSED and says why: guessing where a guard belongs in someone
  // else's pipeline is how a migration writes the wrong thing.
  if (!anchor) { report.reason = "no precondition to attach to (" + anchorLeft + ")"; return report; }
  anchor.condition.rules.push({
    id: mkId(), operator: "OR", rules: [
      { id: mkId(), left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY", right: "" },
      { id: mkId(), left: "$trigger.sourceOccurrenceId", comparator: "IS", right: own },
    ],
  });
  report.added = true;
  return report;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId, name: { $in: Object.keys(KEEP_BY_OP) } });

  const missing = Object.keys(KEEP_BY_OP).filter((n) => !ops.some((o) => o.name === n));
  // Named, never silent: a grid without one of these ops is a real difference,
  // not something to skip past.
  for (const n of missing) log(`  · "${n}" is not on this grid — nothing to scope`);

  let changed = 0;
  for (const op of ops) {
    const before = JSON.stringify(op.pipeline);
    const report = tightenOp(op, KEEP_BY_OP[op.name]);
    const spec = ADD_GUARD_TO[op.name];
    const added = spec ? addGuard(op, spec) : { added: false, reason: null };
    if (!report.changed && !added.added) {
      log(`  · "${op.name}" already scoped to its own page — no change`
        + (added.reason && added.reason !== "already guarded" ? ` (${added.reason})` : ""));
      continue;
    }
    changed += 1;
    if (report.changed) {
      log(`  · "${op.name}" drops guard rule(s): ${report.droppedRules.join(", ")}`
        + (report.droppedVars.length ? ` · drops dead var(s): ${report.droppedVars.join(", ")}` : ""));
    }
    if (added.added) log(`  · "${op.name}" ADDS a source guard (toolbar/onLoad + ${spec.own})`);
    if (dryRun) { op.pipeline = JSON.parse(before); continue; }
    op.markModified("pipeline");
    await op.save();
  }
  log(`  ${dryRun ? "[dry run] would change" : "changed"} ${changed} op(s)`);
}
