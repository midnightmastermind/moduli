// 0344 — un-picking an emotion removes its Check In AND its embed, at once.
//
// User, 2026-09-19: *"i expect those checkins to be removed too right away if i
// click off the emotions"* — *"which it does get removed but it leaves an embed
// artifact (it shouldnt)"*.
//
// The un-pick DELETEs the Check In, and the server's delete-scrub strips its
// embed from the day column's textmap — but that scrub reaches the column's
// live editor as a server ECHO, and the click on the wheel (a node view INSIDE
// that editor) is exactly what makes the editor skip echoes: focused and
// just-clicked. So the row was gone and its empty embed box stayed.
//
// The op now rewrites the column's textmap itself, without the embed, right
// after the DELETE — the same move `0343` makes for a pick. An op's textmap
// write is marked (`editorSyncSignal.markOperationWrite`), which is what lets
// it land under those guards. Top-level nodes only: a Check In is embedded at
// the column's top level, by `0343` and by `Day Page: Build` alike.
//
// Guarded on the column having a body, for the same reason as `0343`: never
// write a document built from nothing over one that has content.

export const id = "0344-an-unpicked-check-in-leaves-no-embed";
export const describe =
  "Mood: Record Selection removes the un-picked Check In's embed from the day column's textmap in "
  + "the same run as the delete, so no empty embed is left behind. Pipeline only.";
export const touches = ["operations"];

const MOOD_OP = "Mood: Record Selection";
const MARK = "unembedStaleCheckIn";

const isAction = (s, t) => s?.type === "action" && (s.actionType || s.config?.type) === t;

export function unembedSteps() {
  return [{
    id: MARK, type: "if",
    condition: { operator: "AND", rules: [
      { id: `${MARK}-body`, left: "$col.textmap.content", comparator: "IS_NOT_EMPTY", right: null },
    ] },
    then: [
      { id: `${MARK}-init`, type: "action", actionType: "INIT_VAR",
        config: { type: "INIT_VAR", name: "$colBody", expr: "json:[]" } },
      { id: `${MARK}-loop`, type: "loop", overExpr: "$col.textmap.content", as: "$node", body: [{
        id: `${MARK}-keep`, type: "if",
        condition: { operator: "AND", rules: [
          { id: `${MARK}-other`, left: "$node.attrs.occurrenceId", comparator: "IS_NOT", right: "$staleCheckIn.id" },
        ] },
        then: [{ id: `${MARK}-push`, type: "action", actionType: "PUSH_TO_ARRAY",
          config: { type: "PUSH_TO_ARRAY", name: "$colBody", value: "$node" } }],
        else: [],
      }] },
      { id: `${MARK}-write`, type: "action", actionType: "UPDATE",
        config: { type: "UPDATE", path: "$col.textmap", value: { type: "doc", content: "$colBody" } } },
    ],
    else: [],
  }];
}

/** PURE — insert after the DELETE of `$staleCheckIn.id`. Throws unless exactly one. Idempotent. */
export function unembedStaleCheckIn(pipeline) {
  if (JSON.stringify(pipeline || {}).includes(`"${MARK}"`)) return { pipeline, changed: 0 };
  let anchors = 0;
  const isAnchor = (s) => isAction(s, "DELETE") && s.config?.itemIdExpr === "$staleCheckIn.id";
  const walk = (steps) => (steps || []).flatMap((s) => {
    if (isAnchor(s)) { anchors++; return [s, ...unembedSteps()]; }
    if (s?.type === "if") return [{ ...s, then: walk(s.then), else: walk(s.else) }];
    if (s?.type === "loop") return [{ ...s, body: walk(s.body) }];
    return [s];
  });
  const steps = walk(pipeline?.steps || []);
  if (anchors !== 1) throw new Error(`0344: expected exactly 1 DELETE of $staleCheckIn.id, found ${anchors}`);
  return { pipeline: { ...pipeline, steps }, changed: 1 };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation } = models;
  const gid = String(gridId);
  const op = await Operation.findOne({ gridId: gid, name: MOOD_OP }).lean();
  if (!op) { log(`  REFUSING: no "${MOOD_OP}" — nothing written.`); return { changed: 0 }; }
  const plan = unembedStaleCheckIn(op.pipeline);
  log(`  ${MOOD_OP}: ${plan.changed ? "removes the un-picked Check In's embed" : "already removes it"}`);
  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (!plan.changed) return { changed: 0 };
  await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: plan.pipeline } });
  const after = await Operation.findOne({ gridId: gid, id: op.id }).lean();
  if (unembedStaleCheckIn(after.pipeline).changed) throw new Error("0344: the op did not take the edit");
  log("  un-picking an emotion now leaves no embed behind.");
  return { changed: 1 };
}
