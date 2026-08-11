// server/migrations/0075-backfill-empty-daily-questions.mjs
//
// Found while chasing *"the question shows up on daypage and picked, but cant be
// seen until i hover over it"*: on poms grid today, **two day columns have no
// question at all** — Monday August 10th and Tuesday August 11th.
//
// ── WHY THOSE TWO SPECIFICALLY ──────────────────────────────────────────────
//
// They are exactly the columns that carried DUPLICATE sections. `0066` guards
// the fill with `$dq.id IS_NOT_EMPTY` because a multi-match FIND binds an ARRAY,
// which has no `.id` — so while the duplicates existed the fill was skipped
// every run, by design, to stop it throwing. `0070` removed the duplicates, so
// the guard no longer fires; but `Day Page: Build` only fills a question at
// BUILD time and only when the container is empty, so a column that was skipped
// stays empty forever unless something backfills it.
//
// That is the same shape `0040` handled once already. This is the second pass,
// for the columns that were unreachable at the time.
//
// ── THE TEMPLATE IS EXCLUDED, and that is not an optimisation ───────────────
//
// A question written into the TEMPLATE's own container would be cloned into
// every future day — every day would open with the same question. `0040`
// excludes it the same way. Here it shows up as the one empty container with no
// day column above it.
//
// ── DISTINCT WHERE POSSIBLE ─────────────────────────────────────────────────
//
// Two consecutive days drawing the same question reads like the feature is
// broken. The draw avoids anything already in use on another day while the pool
// is larger than the number of days needing one (117 vs 2 here), and falls back
// to a plain random pick if it ever is not.

export const id = "0075-backfill-empty-daily-questions";
export const describe =
  "Fill the Daily Question on day columns that were skipped while they carried duplicates "
  + "(the 0066 guard) and have been empty ever since.";

const SIGNATURE = "daypage:Daily Question/question";
const POOL_LABEL = "Reflection Questions";

/**
 * Pick one question per empty container, avoiding anything already in use while
 * the pool allows it.
 *
 * Pure, and takes its randomness as an argument so the test can drive it
 * deterministically — a migration whose only untested part is "it picked
 * something" is a migration nobody can check.
 *
 * Exported so the test drives the REAL chooser.
 */
export function assignQuestions(emptyIds, pool, { inUse = [], rand = Math.random } = {}) {
  const taken = new Set(inUse);
  const out = new Map();
  for (const id of emptyIds) {
    const fresh = pool.filter((q) => !taken.has(q));
    const from = fresh.length ? fresh : pool;          // pool exhausted → allow a repeat
    if (!from.length) continue;
    const pick = from[Math.floor(rand() * from.length) % from.length];
    out.set(id, pick);
    taken.add(pick);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;

  const qField = await Field.findOne({ gridId, name: "Daily Question" }).lean();
  if (!qField) { log("  · no \"Daily Question\" field on this grid — nothing to fill"); return; }

  // The pool, by label — that container is the user's, and its id is not
  // knowable ahead of time. Same resolution 0040 uses.
  const poolModule = await Module.findOne({ gridId, label: POOL_LABEL }).lean();
  if (!poolModule) { log(`  · no "${POOL_LABEL}" container — refusing to guess at a pool`); return; }
  const poolOcc = await Occurrence.findOne({ gridId, moduleId: poolModule.id }).lean();
  const poolIds = poolOcc?.occurrences || [];
  if (!poolIds.length) { log("  · the question pool is empty — nothing to draw from"); return; }

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";
  const parentOf = new Map();
  for (const o of occs) for (const c of (o.occurrences || [])) parentOf.set(c, o.id);
  // Which day column is this container under? Also the TEMPLATE test: the
  // template's copy has no day column above it.
  const dayOf = (id) => {
    let cur = id;
    for (let n = 0; cur && n < 10; n += 1) {
      const o = occById.get(cur);
      if (/^\w+day,/.test(String(labelOf(o)))) return labelOf(o);
      cur = parentOf.get(cur) ?? o?.parentId;
    }
    return null;
  };

  const containers = occs.filter((o) => o.identitySignature === SIGNATURE);
  const valueOf = (o) => o.fields?.[qField.id]?.value;
  const empty = containers.filter((o) => {
    const v = valueOf(o);
    return (v == null || v === "") && dayOf(o.id);      // a day column, not the template
  });
  const skippedTemplate = containers.filter((o) => !dayOf(o.id) && (valueOf(o) == null || valueOf(o) === ""));

  log(`  · ${containers.length} question container(s); ${empty.length} empty on a day column`);
  for (const t of skippedTemplate) {
    log(`      (skipping ${t.id.slice(0, 8)} — no day column above it, i.e. the TEMPLATE's own; a `
      + "question there would be cloned into every future day)");
  }
  if (!empty.length) { log("  · nothing to fill"); return; }

  const inUse = containers.map(valueOf).filter((v) => v != null && v !== "");
  const poolLabels = poolIds.map((id) => labelOf(occById.get(id))).filter(Boolean);
  const picks = assignQuestions(empty.map((o) => o.id), poolLabels, { inUse });
  log(`  · pool ${poolLabels.length} question(s), ${inUse.length} already in use elsewhere`);

  for (const o of empty) {
    const pick = picks.get(o.id);
    if (!pick) { log(`      · ${o.id.slice(0, 8)} — no question available, left empty`); continue; }
    log(`      · ${dayOf(o.id)} -> "${String(pick).slice(0, 62)}${String(pick).length > 62 ? "…" : ""}"`);
    if (dryRun) continue;
    // Write only this field's value; a whole-`fields` write would carry a stale
    // copy of every other key back over whatever else changed.
    await Occurrence.updateOne({ gridId, id: o.id }, {
      $set: { [`fields.${qField.id}`]: { value: pick, flow: "in" } },
    });
  }
  log(`  ✓ ${picks.size} question(s) filled`);
}
