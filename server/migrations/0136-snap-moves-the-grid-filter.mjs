/**
 * 0136 — `Grid: Snap Filter To Today` also moves the GRID's own filter.
 *
 * USER, 2026-08-18: "the grid filter is still stuck on the 9th, that should be
 * today."  Measured on poms grid the same morning:
 *
 *     grid.activeFilterValues   { <date>: "2026-08-09" }   <- 9 days stale
 *     Schedule page override    { <date>: "2026-08-18" }   <- today
 *     Last Opened Date marker                 2026-08-18   <- the op DID run
 *
 * So the op was firing and doing half its job. Reading its stored pipeline says
 * why in one look: the else branch loops `$allPages` and writes each page's own
 * `filterOverride`, then stamps the marker. NOTHING writes the grid.
 *
 * WHY THAT IS NOT COSMETIC: `grid.activeFilterValues` is the FLOOR of the filter
 * cascade. A page carrying its own override is unaffected, but everything that
 * does not carry one — every panel, container and occurrence relying on the
 * grid — was still being filtered against a day nine days gone.
 *
 * THE VERB IS `SET_FILTER` BECAUSE IT WRITES BOTH HALVES: `filterNavState` (the
 * nav widget) and `grid.activeFilterValues` (what `isOccurrenceVisible` reads).
 * Writing only the widget moves the date on screen without filtering anything —
 * the exact half-wiring fixed on 2026-07-26. Its own no-op guard is what keeps
 * an onLoad op from firing on its own write.
 *
 * SURGICAL AND IDEMPOTENT. It inserts one step at the FRONT of the else branch
 * and touches nothing else — no rule is rewritten, no step reordered. A pipeline
 * that already carries a SET_FILTER for this field is left exactly as it is, so
 * a re-run (and a grid seeded after the builder fix) is a no-op.
 *
 * FAILS CLOSED. If the op, the else branch or the date field cannot be found it
 * reports and changes nothing, rather than guessing where the step belongs — a
 * pipeline edited into the wrong branch looks applied and silently does the
 * wrong thing.
 */
export const id = "0136-snap-moves-the-grid-filter";
export const describe =
  "Grid: Snap Filter To Today also advances grid.activeFilterValues, not just each page's own override.";

const OP_NAME = "Grid: Snap Filter To Today";

/** The date field this grid filters by — read from the op's OWN steps rather
 *  than looked up by name, because this grid carries more than one field called
 *  "Date" and the op already names the id it uses. */
function dateFieldIdFromPipeline(op) {
  const seen = new Set();
  const walk = (steps) => {
    for (const s of steps || []) {
      const path = s?.config?.path;
      const m = typeof path === "string" && path.match(/^\$pg\.filterOverride\.([A-Za-z0-9_-]+)$/);
      if (m) seen.add(m[1]);
      walk(s.then); walk(s.else); walk(s.body); walk(s.steps);
    }
  };
  walk(op?.pipeline?.steps);
  return seen.size === 1 ? [...seen][0] : null;
}

/** The `else` array of the marker check — the branch that runs on a new day. */
function findElseBranch(op) {
  for (const s of op?.pipeline?.steps || []) {
    if (s?.type === "if" && Array.isArray(s.else) && s.else.length) return s.else;
  }
  return null;
}

const hasSetFilter = (steps, fieldId) =>
  (steps || []).some(s => s?.config?.type === "SET_FILTER" && s?.config?.fieldId === fieldId);

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  no "${OP_NAME}" on this grid — nothing to do`); return; }

  const fieldId = dateFieldIdFromPipeline(op);
  if (!fieldId) {
    log(`  REFUSING: could not read a single date field id out of the pipeline — not guessing`);
    return;
  }
  const branch = findElseBranch(op);
  if (!branch) {
    log(`  REFUSING: no else branch on the marker check — the pipeline is not the shape this patches`);
    return;
  }
  if (hasSetFilter(branch, fieldId)) {
    log(`  already writes SET_FILTER for ${fieldId} — no change`);
    return;
  }

  const step = {
    id: `setfilter-${fieldId}`,
    type: "action",
    config: { type: "SET_FILTER", fieldId, value: "$today" },
  };
  // FRONT of the branch: move the floor before the pages that sit on it.
  const nextSteps = JSON.parse(JSON.stringify(op.pipeline.steps));
  const nextBranch = findElseBranch({ pipeline: { steps: nextSteps } });
  nextBranch.unshift(step);

  log(`  date field ${fieldId} · inserting SET_FILTER at the front of the new-day branch (${branch.length} -> ${nextBranch.length} steps)`);
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  await Operation.updateOne({ _id: op._id }, { $set: { "pipeline.steps": nextSteps } });

  // Read it BACK. The log says what was attempted; only a re-read says what is true.
  const after = await Operation.findOne({ _id: op._id }).lean();
  const ok = hasSetFilter(findElseBranch(after) || [], fieldId);
  log(`  verify: SET_FILTER present after write -> ${ok ? "YES" : "NO"}`);
  if (!ok) throw new Error("SET_FILTER did not persist");
}
