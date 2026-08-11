// server/migrations/0068-one-shared-emotions-wheel.mjs
//
// USER, 2026-08-10: *"graphs dont show up at all, it just says nothing to chart
// yet"* — and, on the fix: **one wheel, multi-parented**.
//
// ── WHAT IS ACTUALLY WRONG, MEASURED ON POMS GRID ───────────────────────────
//
// The Emotions Wheel is a child of the Day Page TEMPLATE, and `Day Page: Build`
// merges that template into every day column. So each column got its own CLONE
// — and a clone does not carry `feed`:
//
//   289583d9  the TEMPLATE's wheel            feed YES
//   b20d9ee9  Thursday, August 6th            feed YES   ← the one that displays
//   88d54140  Monday, August 10th             feed no    ← listed by NOBODY
//   471dc627  Monday, August 10th             feed no
//   e5dca56a  Monday, August 10th             feed no
//   b713f6a2  Tuesday, August 11th            feed no
//
// A graph with no feed has no rows, and a graph with no rows says exactly what
// the user reported. (Aug 10 carrying THREE is the separate merge-duplication
// defect; this migration removes the strays it can prove are empty, and the
// duplication itself is filed on its own.)
//
// ── AND A SECOND DEFECT, WHICH IS THE MORE IMPORTANT ONE ────────────────────
//
// `Mood: Record Selection` is scoped `targetId: 289583d9` — the TEMPLATE's
// wheel. A trigger scoped by occurrence id matches exactly ONE occurrence, and
// per-day clones each carry a different id. So clicking a wheel on any real day
// column matched nothing and **no mood has ever been recorded** — including on
// Aug 6, the one day the wheel displays. Nobody reported this because the
// visible symptom (an empty chart) hid it.
//
// ── WHY ONE SHARED WHEEL FIXES BOTH ─────────────────────────────────────────
//
// The alternative — teach APPLY_TEMPLATE to carry `feed` — makes every day
// materialise the whole emotions board (~130 occurrences AND ~130 modules, per
// day, forever). One occurrence listed by many parents has one feed, one id, and
// therefore one op that matches it. Same shape the Todo container in this very
// op already uses, and the Schedule's shared slots before that.
//
// ── WHAT THIS DOES ──────────────────────────────────────────────────────────
//
//   1. UNLIST the wheel from the template's `occurrences[]`, so merge stops
//      cloning it. The occurrence itself is KEPT — it becomes the shared one.
//   2. PATCH the stored `Day Page: Build` pipeline to ADD_CHILD that id into
//      every column it builds. The builder carries the same change, but a
//      builder edit alone is INERT on a seeded grid — the "shipped and does
//      nothing" class this repo keeps paying for (0062's header records it).
//   3. LIST the shared wheel into the day columns that exist today.
//   4. DELETE the clones — but only the ones provably EMPTY (see below).
//
// ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
//
// A clone is deleted only when it carries **no user state**: no children, no
// `meta.graph.highlight`, and the right signature. Anything else is logged and
// LEFT. `0035` moved a real page because its selector matched things that
// merely looked right; the rule here is that a thing is only debris when it is
// demonstrably empty. Measured before writing: all five clones have
// `highlight: null` and zero children.
//
// Idempotent: a second run finds the template already unlisted, the step already
// present and no clones left, and writes nothing.

export const id = "0068-one-shared-emotions-wheel";
export const describe =
  "One shared Emotions Wheel: unlist it from the Day Page template (so merge stops cloning a "
  + "feed-less copy per day), ADD_CHILD the shared one into every column, and remove the empty clones.";

const OP_NAME = "Day Page: Build";
const ANCHOR_PATH = "$col.meta.appliedFromTemplateId";  // the step we insert after
const WHEEL_SIGNATURE = "daypage:Emotions Wheel";

/**
 * Which occurrence does this op's APPLY_TEMPLATE actually apply?
 *
 * FOLLOWS THE VARIABLE rather than grepping for the first `$allItemsById.<id>`
 * in the pipeline — the first draft did exactly that and resolved the SCHEDULE
 * page, because the op references it earlier. The flow still read plausibly
 * ("template already does not list the graph"), which is the whole danger: a
 * selector that matches the wrong thing confidently. Same class as `0035`.
 *
 * templateRef ("$tplId") → INIT_VAR $tplId = "$tpl.id" → INIT_VAR $tpl =
 * "$allItemsById.<id>". Returns null rather than a guess.
 *
 * Exported so the test drives the REAL resolver.
 */
export function resolveTemplateId(pipeline) {
  const inits = new Map();      // varName -> expr
  let ref = null;               // the templateRef APPLY_TEMPLATE names
  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const st of list) {
      if (!st || typeof st !== "object") continue;
      const cfg = st.config || {};
      if (cfg.type === "INIT_VAR" && cfg.name) inits.set(cfg.name, cfg.expr);
      if (cfg.type === "APPLY_TEMPLATE" && cfg.templateRef && !ref) ref = cfg.templateRef;
      walk(st.then); walk(st.else); walk(st.body);
    }
  };
  walk(pipeline?.steps);
  if (!ref) return null;

  // Walk the chain, bounded — a cycle in someone's pipeline must not hang.
  let cur = ref;
  for (let hop = 0; hop < 8; hop += 1) {
    const expr = inits.get(cur);
    if (!expr) return null;
    const direct = String(expr).match(/^\$allItemsById\.([A-Za-z0-9_-]+)$/);
    if (direct) return direct[1];
    const deref = String(expr).match(/^(\$[A-Za-z0-9_]+)\.[A-Za-z0-9_.]+$/);
    if (!deref) return null;
    cur = deref[1];
  }
  return null;
}

const mkId = () => Math.random().toString(36).slice(2, 10);

/**
 * Does this occurrence carry anything a person would miss?
 *
 * Deliberately conservative and POSITIVE — it answers "is this provably empty",
 * not "does this look like debris". A clone with children or a recorded
 * selection is somebody's data regardless of how it got there.
 *
 * Exported so the test drives the REAL predicate rather than a copy of it.
 */
export function isEmptyClone(occ, { canonicalId, signature = WHEEL_SIGNATURE } = {}) {
  if (!occ || occ.id === canonicalId) return false;
  if (occ.identitySignature !== signature) return false;
  if (Array.isArray(occ.occurrences) && occ.occurrences.length) return false;
  const hl = occ.meta?.graph?.highlight;
  if (Array.isArray(hl) ? hl.length : hl != null) return false;
  return true;
}

/**
 * Insert an ADD_CHILD of `childId` into `$colId`, immediately after the step
 * that stamps the anchor path. Returns { added, alreadyPresent, reason }.
 *
 * Anchored on a step that exists exactly once and only inside the per-day body,
 * so `$colId` is guaranteed bound — inserting by index or by "the first
 * ADD_CHILD" would be a guess about someone else's pipeline.
 */
export function addSharedChildStep(op, childId) {
  const report = { added: 0, alreadyPresent: 0, reason: null };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) { report.reason = "op has no pipeline steps"; return report; }

  const already = JSON.stringify(op.pipeline).includes(`"childId":"${childId}"`);
  if (already) { report.alreadyPresent = 1; return report; }

  const walk = (list) => {
    if (!Array.isArray(list)) return false;
    for (let i = 0; i < list.length; i += 1) {
      const st = list[i];
      if (!st || typeof st !== "object") continue;
      const cfg = st.config || {};
      if (cfg.type === "UPDATE" && cfg.path === ANCHOR_PATH) {
        list.splice(i + 1, 0, {
          id: mkId(), type: "action",
          config: { type: "ADD_CHILD", parentId: "$colId", childId },
        });
        report.added += 1;
        return true;
      }
      if (walk(st.then) || walk(st.else) || walk(st.body)) return true;
    }
    return false;
  };
  if (!walk(steps)) {
    // Fails CLOSED and says why. Guessing at a position in someone else's
    // pipeline is how a migration writes the wrong thing.
    report.reason = `no \`UPDATE ${ANCHOR_PATH}\` step to anchor the insert to`;
  }
  return report;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";
  const isGraph = (o) => modById.get(o?.moduleId)?.kind === "graph";

  // ── resolve the template + its wheel ──────────────────────────────────────
  // The template is whatever the OP points at — resolved from the stored
  // pipeline rather than by label, because the template container and the board
  // page are BOTH called "Day Page" (the 2026-08-03 trap, verbatim).
  const op = await Operation.findOne({ gridId, name: OP_NAME });
  if (!op) { log(`  · "${OP_NAME}" is not on this grid — nothing to do`); return; }

  const tplId = resolveTemplateId(op.pipeline);
  const tpl = tplId ? occById.get(tplId) : null;
  if (!tpl) { log("  · REFUSED: could not resolve the template APPLY_TEMPLATE actually applies"); return; }

  const tplWheels = (tpl.occurrences || []).map((k) => occById.get(k)).filter((o) => o && isGraph(o));
  const canonical = tplWheels[0] || occs.find((o) => isGraph(o) && o.feed?.enabled);
  if (!canonical) { log("  · no graph in the template and none with a feed — nothing to share"); return; }
  if (tplWheels.length > 1) {
    log(`  · REFUSED: the template lists ${tplWheels.length} graphs; this migration assumes one shared graph`);
    return;
  }
  log(`  · template "${labelOf(tpl)}" (${tpl.id.slice(0, 8)}); shared graph "${labelOf(canonical)}" (${canonical.id.slice(0, 8)}) feed=${canonical.feed?.enabled ? "yes" : "NO"}`);
  if (!canonical.feed?.enabled) {
    log("    ⚠ the shared graph itself has no feed — sharing it will not make it render. NOT refusing, but say so.");
  }

  // ── 1. unlist it from the template ────────────────────────────────────────
  if (tplWheels.length) {
    log(`  · UNLIST the graph from the template's occurrences[] (merge stops cloning a feed-less copy per day)`);
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: tpl.id }, { $pull: { occurrences: canonical.id } });
    }
  } else {
    log("  · template already does not list the graph — no change");
  }

  // ── 2. patch the stored pipeline ──────────────────────────────────────────
  const report = addSharedChildStep(op, canonical.id);
  if (report.reason) {
    log(`  · REFUSED to patch "${OP_NAME}": ${report.reason}`);
  } else if (report.alreadyPresent) {
    log(`  · "${OP_NAME}" already lists the shared graph — no change`);
  } else {
    log(`  · "${OP_NAME}" gains \`ADD_CHILD $colId ← ${canonical.id.slice(0, 8)}\` after the template stamp`);
    if (!dryRun) { op.markModified("pipeline"); await op.save(); }
  }

  // ── 3. list the shared graph into the columns that exist today ────────────
  const columns = (occById.get(
    // the board is the op's ADD_CHILD parent for a new column
    (JSON.stringify(op.pipeline).match(/"type":"ADD_CHILD","parentId":"([A-Za-z0-9_-]+)","childId":"\$colId"/) || [])[1] || "",
  )?.occurrences || []).map((k) => occById.get(k)).filter(Boolean);

  let listed = 0;
  for (const col of columns) {
    if ((col.occurrences || []).includes(canonical.id)) continue;
    listed += 1;
    log(`    · "${labelOf(col)}" LISTS the shared graph`);
    if (!dryRun) {
      await Occurrence.updateOne(
        { gridId, id: col.id, occurrences: { $ne: canonical.id } },
        { $push: { occurrences: canonical.id } },
      );
    }
  }
  log(`  · ${columns.length} day column(s); ${listed} newly listing the shared graph`);

  // ── 4. remove the empty clones ────────────────────────────────────────────
  const clones = occs.filter((o) => isGraph(o) && o.id !== canonical.id);
  let removed = 0;
  for (const c of clones) {
    if (!isEmptyClone(c, { canonicalId: canonical.id })) {
      log(`    · KEPT ${c.id.slice(0, 8)} under "${labelOf(occById.get(c.parentId))}" — not provably empty `
        + `(children=${(c.occurrences || []).length}, highlight=${JSON.stringify(c.meta?.graph?.highlight ?? null)}, sig=${c.identitySignature || "none"})`);
      continue;
    }
    removed += 1;
    log(`    · REMOVE empty clone ${c.id.slice(0, 8)} under "${labelOf(occById.get(c.parentId))}"`);
    if (!dryRun) {
      await Occurrence.deleteOne({ gridId, id: c.id });
      // Unlist it from whoever listed it, so no parent is left naming a row
      // that no longer exists (the documented dangling-child-ref class).
      await Occurrence.updateMany({ gridId, occurrences: c.id }, { $pull: { occurrences: c.id } });
      // Its module is a clone too — drop it only when nothing else uses it.
      const otherUsers = occs.filter((o) => o.moduleId === c.moduleId && o.id !== c.id).length;
      if (!otherUsers && c.moduleId !== canonical.moduleId) {
        await Module.deleteOne({ gridId, id: c.moduleId });
      }
    }
  }
  log(`  ✓ ${removed} empty clone(s) removed, ${clones.length - removed} kept`);
}
