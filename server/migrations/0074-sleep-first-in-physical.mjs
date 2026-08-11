// server/migrations/0074-sleep-first-in-physical.mjs
//
// USER, 2026-08-11: *"can you move sleep to the beginning of todays physical."*
//
// A container renders its children in `occurrences[]` order, so "move to the
// beginning" is a reorder of that array — nothing is created, deleted or
// re-parented. Sleep sits last of six today.
//
// ── THE LABEL "SLEEP" IS NOT UNIQUE, WHICH IS THE ONLY RISK HERE ────────────
//
// Two occurrences carry it: the Routines action under `Rest`, and the tracker
// tile under `Today's Physical`. Resolving by label across the grid would be a
// coin flip — the trap 2026-08-03 records verbatim ("discriminate by role/id,
// never by a label that legitimately repeats"), and `0035` moved a real user
// page that way.
//
// So the match is scoped to the CONTAINER'S OWN CHILDREN: whichever of that
// container's listed children is called Sleep. That cannot reach the Routines
// one, because it is not one of them. If the scoped match is ambiguous or
// missing, this refuses and says so rather than guessing.
//
// Idempotent: already first → no write.

export const id = "0074-sleep-first-in-physical";
export const describe =
  "Move the Sleep tracker tile to the front of Today's Physical (a pure occurrences[] reorder).";

const CONTAINER_MATCH = /physical/i;   // the container's label carries a date prefix
const CHILD_LABEL = "Sleep";
const TRACKERS_PAGE = "Trackers";

/**
 * Move `childId` to the front of `order`, leaving everything else in sequence.
 * Returns the same array (by value) when it is already first, so the caller can
 * skip the write rather than churn `updatedAt`.
 *
 * Exported so the test drives the REAL reorder.
 */
export function moveToFront(order, childId) {
  const list = Array.isArray(order) ? order : [];
  if (!list.includes(childId)) return list;
  return [childId, ...list.filter((id) => id !== childId)];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";

  const page = occs.find((o) => modById.get(o.moduleId)?.role === "page" && labelOf(o) === TRACKERS_PAGE);
  if (!page) { log(`  · no "${TRACKERS_PAGE}" page on this grid — nothing to do`); return; }

  // The container, among the page's OWN children — its label carries a
  // date prefix ("Today's Physical") that an op rewrites, so match loosely on
  // the stable part but require it to be a direct child and a container.
  const candidates = (page.occurrences || [])
    .map((id) => occById.get(id))
    .filter((o) => o && modById.get(o.moduleId)?.role === "container" && CONTAINER_MATCH.test(labelOf(o)));
  if (candidates.length !== 1) {
    log(`  · REFUSED: expected exactly one container matching ${CONTAINER_MATCH} directly under `
      + `"${TRACKERS_PAGE}", found ${candidates.length}${candidates.length ? ` (${candidates.map(labelOf).join(", ")})` : ""}`);
    return;
  }
  const container = candidates[0];

  // Scoped to this container's own children — never a grid-wide label match.
  const matches = (container.occurrences || [])
    .map((id) => occById.get(id))
    .filter((o) => o && labelOf(o) === CHILD_LABEL);
  if (matches.length !== 1) {
    log(`  · REFUSED: expected exactly one child called "${CHILD_LABEL}" in "${labelOf(container)}", `
      + `found ${matches.length}`);
    return;
  }
  const child = matches[0];

  const before = container.occurrences || [];
  const after = moveToFront(before, child.id);
  if (before[0] === child.id) {
    log(`  · "${CHILD_LABEL}" is already first in "${labelOf(container)}" — no change`);
    return;
  }

  const names = (ids) => ids.map((id) => labelOf(occById.get(id))).join(", ");
  log(`  · "${labelOf(container)}" reorder — "${CHILD_LABEL}" ${before.indexOf(child.id)} → 0`);
  log(`      before: ${names(before)}`);
  log(`      after:  ${names(after)}`);
  if (dryRun) return;
  await Occurrence.updateOne({ gridId, id: container.id }, { $set: { occurrences: after } });
}
