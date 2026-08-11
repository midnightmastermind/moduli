// server/migrations/0081-resolved-journals-need-one-path.mjs
//
// 0080 listed the two homeless journals under the Schedule page and reported
// them resolved. Reading the result back through the REAL parent map says
// otherwise — Aug 10 still recorded nothing:
//
//   journal 3688118a   listed by 2: Schedule(llpF10Bd), 9:00pm(94b66b25)
//   buildParentMap picks: 9:00pm      walk: 9:00pm < (?)(dc750a99)
//   reaches Schedule: FALSE
//
// LISTING A CHILD IS NOT THE SAME AS GIVING IT A PATH. `buildParentMap` keys
// child -> ONE parent (`map[childId] = occ.id`, last writer wins), so a child
// with two parents gets an ARBITRARY one — and here the arbitrary winner is the
// detached 9:00pm slot whose own chain dead-ends. This is the exact ambiguity
// that broke the emotions wheel in the first place (0079), reached from the
// other side: adding a second parent does not make the first one stop competing.
//
// So a "resolved" occurrence needs ONE path, not an extra one. For every
// occurrence the Schedule page lists, this removes the links from parents that
// cannot themselves reach the Schedule, and repoints `parentId` at the Schedule
// when it currently names an unreachable parent.
//
// ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
//
// It never unlinks a REACHABLE parent. A journal genuinely sitting in a live
// slot keeps that slot — multi-parenting is a real pattern on this grid (the
// Schedule's shared slots, the emotions wheel itself), and collapsing it would
// be destroying structure to tidy a lookup. Only a parent that is itself
// unreachable is removed, and an unreachable parent renders nowhere, so the
// link it holds is doing no work for anyone.
//
// It also touches ONLY occurrences the Schedule page directly lists — i.e. the
// ones 0080 resolved. It is not a general orphan sweep.
export const id = "0081-resolved-journals-need-one-path";
export const describe =
  "Give each journal 0080 resolved a single, deterministic path to the Schedule by dropping " +
  "links from parents that are themselves unreachable.";

/**
 * PURE — can `startId` reach `targetId` by walking parents? `parentOf` returns
 * the candidate parents of an id (a child may have several).
 *
 * Checks EVERY parent, not just the first: the question is whether a path
 * exists at all, while `buildParentMap` picks one arbitrarily. Those are
 * different questions, and conflating them is what made 0080 look done.
 */
export function canReach(startId, targetId, parentsOf, maxDepth = 24) {
  const seen = new Set();
  const stack = [[startId, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop();
    if (id === targetId) return true;
    if (depth >= maxDepth || seen.has(id)) continue;
    seen.add(id);
    for (const p of parentsOf(id)) stack.push([p, depth + 1]);
  }
  return false;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  if (!schedulePage) { log(`REFUSING: no Schedule page.`); return; }

  // Every parent of an id: the occurrences[] listers PLUS its own parentId.
  const listersOf = new Map();
  for (const o of occs) for (const k of o.occurrences || []) {
    if (!listersOf.has(k)) listersOf.set(k, []);
    listersOf.get(k).push(o.id);
  }
  const parentsOf = (id) => {
    const out = new Set(listersOf.get(id) || []);
    const pid = occById.get(id)?.parentId;
    if (pid) out.add(pid);
    return [...out];
  };
  // A parent competing with the Schedule page must be judged WITHOUT counting
  // the child's own Schedule link, or every parent looks reachable through it.
  const parentsExcludingChild = (childId) => (id) => parentsOf(id).filter((p) => p !== childId);

  const resolved = (schedulePage.occurrences || [])
    .map((id) => occById.get(id))
    .filter(Boolean);
  log(`Schedule page directly lists ${resolved.length} occurrence(s)`);

  const plan = [];
  for (const occ of resolved) {
    const competing = parentsOf(occ.id).filter((p) => p !== schedulePage.id);
    const dead = competing.filter((p) => !canReach(p, schedulePage.id, parentsExcludingChild(occ.id)));
    const parentIdDead = occ.parentId && occ.parentId !== schedulePage.id
      && !canReach(occ.parentId, schedulePage.id, parentsExcludingChild(occ.id));
    if (!dead.length && !parentIdDead) continue;
    plan.push({ occ, dead, parentIdDead });
    log(`  ${occ.id.slice(0, 8)} ${String(nameOf(occ)).padEnd(12)} ` +
      `unreachable parents: ${dead.map((p) => `${nameOf(occById.get(p))}(${p.slice(0, 8)})`).join(", ") || "none"}` +
      `${parentIdDead ? `  parentId ${occ.parentId.slice(0, 8)} -> Schedule` : ""}`);
  }

  if (!plan.length) { log(`nothing to repair — every listed occurrence already has a path.`); return; }
  if (dryRun) { log(`\nWOULD repair ${plan.length} occurrence(s).`); return; }

  for (const { occ, dead, parentIdDead } of plan) {
    for (const p of dead) {
      await Occurrence.updateOne({ gridId, id: p }, { $pull: { occurrences: occ.id } });
    }
    if (parentIdDead) {
      await Occurrence.updateOne({ gridId, id: occ.id }, { $set: { parentId: schedulePage.id } });
    }
    log(`repaired ${occ.id.slice(0, 8)} (${nameOf(occ)}) — ${dead.length} dead link(s) dropped` +
      `${parentIdDead ? ", parentId repointed" : ""}`);
  }
}
