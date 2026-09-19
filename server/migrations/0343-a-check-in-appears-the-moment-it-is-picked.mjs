// 0343 — a check-in appears under the wheel the moment you pick it.
//
// User, 2026-09-19: *"i clicked on a few emotions for today and no checkins
// show up. i reload the page and the checkins show up."*
//
// A day column is a DOC container: it draws its TEXTMAP, not its
// `occurrences[]`. `Mood: Record Selection` COPY_LINKs the Check In with
// `parent: "$col.id"`, which LISTS it — and nothing embeds it. The embed only
// arrived when `Day Page: Build` rebuilt the textmap from the list on the next
// load, which is exactly "reload and they show up".
//
// It used to be immediate by accident: until `0342` the op ALSO filed the
// check-in under Tasks Completed, a BOARD, which draws its list. Removing that
// listing (at the user's ask) exposed that the column itself never learned.
//
// So right after the COPY_LINK the op appends a `moduleEmbed` of the new check-in
// to the column's textmap — the same node `Day Page: Build` would write for it,
// in the same place (after the column's other children), so the next rebuild
// produces the identical document instead of reordering it.
//
// GUARDED ON THE COLUMN ALREADY HAVING A BODY. An empty or missing textmap
// would otherwise be replaced by a document holding ONLY the check-in — the
// wheel, the journal and the rest gone until the next rebuild. Nothing is
// written then; the rebuild still embeds it.
//
// Un-picking needs nothing new: the DELETE of the check-in already runs the
// server's delete-scrub, which removes an embed of a deleted id from every
// textmap.

export const id = "0343-a-check-in-appears-the-moment-it-is-picked";
export const describe =
  "Mood: Record Selection embeds the Check In it creates into the day column's textmap, so it shows "
  + "immediately instead of after the next reload. Pipeline only.";
export const touches = ["operations"];

const MOOD_OP = "Mood: Record Selection";
const MARK = "embedNewCheckIn";

const isAction = (s, t) => s?.type === "action" && (s.actionType || s.config?.type) === t;

/** The steps inserted after the COPY_LINK. */
export function embedSteps() {
  return [{
    id: MARK, type: "if",
    condition: { operator: "AND", rules: [
      { id: `${MARK}-body`, left: "$col.textmap.content", comparator: "IS_NOT_EMPTY", right: null },
      { id: `${MARK}-new`, left: "$newCheckIn", comparator: "IS_NOT_EMPTY", right: null },
    ] },
    then: [
      { id: `${MARK}-init`, type: "action", actionType: "INIT_VAR",
        config: { type: "INIT_VAR", name: "$colBody", expr: "$col.textmap.content" } },
      { id: `${MARK}-push`, type: "action", actionType: "PUSH_TO_ARRAY",
        config: { type: "PUSH_TO_ARRAY", name: "$colBody",
          value: { type: "moduleEmbed", attrs: { occurrenceId: "$newCheckIn" } } } },
      { id: `${MARK}-write`, type: "action", actionType: "UPDATE",
        config: { type: "UPDATE", path: "$col.textmap", value: { type: "doc", content: "$colBody" } } },
    ],
    else: [],
  }];
}

/**
 * PURE — insert the embed steps right after the COPY_LINK that creates the
 * Check In under the column. Anchored on SHAPE (parent `$col.id`, binding
 * `$newCheckIn`); throws unless exactly one matches. Idempotent.
 */
export function embedNewCheckIn(pipeline) {
  if (JSON.stringify(pipeline || {}).includes(`"${MARK}"`)) return { pipeline, changed: 0 };
  let anchors = 0;
  const isAnchor = (s) => isAction(s, "COPY_LINK")
    && s.config?.parent === "$col.id" && s.config?.itemIdVar === "$newCheckIn";
  const walk = (steps) => (steps || []).flatMap((s) => {
    if (isAnchor(s)) { anchors++; return [s, ...embedSteps()]; }
    if (s?.type === "if") return [{ ...s, then: walk(s.then), else: walk(s.else) }];
    if (s?.type === "loop") return [{ ...s, body: walk(s.body) }];
    return [s];
  });
  const steps = walk(pipeline?.steps || []);
  if (anchors !== 1) throw new Error(`0343: expected exactly 1 COPY_LINK into $col.id binding $newCheckIn, found ${anchors}`);
  return { pipeline: { ...pipeline, steps }, changed: 1 };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation } = models;
  const gid = String(gridId);
  const op = await Operation.findOne({ gridId: gid, name: MOOD_OP }).lean();
  if (!op) { log(`  REFUSING: no "${MOOD_OP}" — nothing written.`); return { changed: 0 }; }

  const plan = embedNewCheckIn(op.pipeline);
  log(`  ${MOOD_OP}: ${plan.changed ? "embeds the new Check In into the column" : "already embeds it"}`);
  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (!plan.changed) return { changed: 0 };

  await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: plan.pipeline } });
  const after = await Operation.findOne({ gridId: gid, id: op.id }).lean();
  if (embedNewCheckIn(after.pipeline).changed) throw new Error("0343: the op did not take the edit");
  log("  a picked emotion's Check In now shows under the wheel immediately.");
  return { changed: 1 };
}
