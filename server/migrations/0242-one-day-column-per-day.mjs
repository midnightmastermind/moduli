/**
 * 0242 — the Day Page board grew THREE columns for one day, and `Day Page: Build`
 * throws on every load because of it.
 *
 * User, 2026-08-25, pasting their console:
 *
 *     [operationExecutor] error in operation "Day Page: Build":
 *       Error: $col is not a record (no .id) — UPDATE needs a FOUND occurrence
 *
 * ── THE THROW IS A SYMPTOM AND THE DATA IS THE DEFECT ────────────────────
 *
 * Step `halYDuDf1LzS` is `UPDATE $col.meta.appliedFromTemplateId`, and `$col`
 * comes from the op's own existence check:
 *
 *     FIND over $allOccurrences
 *          parentId IS 8gpoqzx32h7                    (the Day Page board)
 *          fields.Eh7oi4HKdbHB.value SAME_DAY $day
 *       -> itemIdVar $colId  itemVar $col
 *
 * A multi-match FIND binds an ARRAY and `UPDATE` refuses it. That refusal is the
 * executor being RIGHT — 2026-08-11 (4) and `0240` are the same class — so the
 * fix is the duplicates, not the guard.
 *
 * Measured on poms grid:
 * ```
 * 2026-07-28 .. 2026-08-23   x1 each   22 dates, all clean
 * 2026-08-24                 x3        created 11:30:22 / 11:30:58 / 11:31:01
 * 2026-08-25                 x3        created 14:34:09 / 14:34:53 / 14:35:11
 * ```
 * Both bursts land inside ~60 seconds, on the two days this repo was being
 * deployed and pm2-restarted — the 2026-08-20 truncated-burst shape. **The cause
 * of the DUPLICATION is NOT established, and this migration does not pretend
 * otherwise.** What it does is repair the damage and make the next occurrence
 * loud instead of silent: `gridIntegrity` gains `duplicate-day-column`, the same
 * answer-to-not-knowing that `dated-copy-link-source` was on 2026-08-19 (5).
 *
 * Note the population is self-limiting, which is why it stopped at three: once
 * two exist the FIND binds an array, `IF $colId IS_EMPTY` is false, and the mint
 * branch never runs again. So this is a repair of a bounded mess, not a race
 * that keeps growing.
 *
 * ── NOTHING HOLDING WRITING IS TOUCHED, AND THAT WAS MEASURED FIRST ──────
 *
 * Every candidate's subtree is weighed for TEXT through `decompressTextmap`
 * before anything is removed — raw reads store textmaps COMPRESSED, so a naive
 * scan reports "no text" for everything and would happily delete a journal
 * entry (`0032`'s rule). Measured at full depth across all six:
 * ```
 * 2026-08-24  05ce0697 nodes=9 TEXTCHARS=0 | 3aa482c4 nodes=8 0 | 2febc33d nodes=8 0
 * 2026-08-25  d55696cd nodes=8 TEXTCHARS=0 | 2dcc42f8 nodes=9 0 | 18e8f0db nodes=8 0
 * ```
 * All empty. The check is re-run AT APPLY TIME and the migration REFUSES the
 * whole group if any loser holds a single character — `0038`'s guard, which
 * scored field VALUES, fired on the app's own date stamp and refused forever;
 * this one counts text only.
 *
 * ── WHICH ONE SURVIVES IS STRUCTURAL, NOT POSITIONAL ─────────────────────
 *
 * With no writing to prefer, the keeper is: **listed by the board** (the board
 * renders `occurrences[]`, so an unlisted column is invisible and cannot be the
 * one the user sees), then **the most children** (the furthest through the build
 * pipeline), then **earliest created**. On this grid that is `3aa482c4` for
 * 08-24 and `2dcc42f8` for 08-25 — the latter being the only one that reached
 * the `ADD_CHILD` of Todo.
 *
 * ── A SHARED CHILD IS UNLISTED, NEVER DELETED ────────────────────────────
 *
 * The Emotions Wheel is ONE occurrence multi-parented into every day column
 * (`0068`), and Todo is the Schedule's own container multi-parented in. Deleting
 * a loser's subtree wholesale would destroy both. So a child is deleted only when
 * nothing OUTSIDE the doomed subtree lists or parents it.
 *
 * **`0080` got exactly this wrong and a count would not have caught it**: a
 * duplicate is of course listed by the parent whose duplicates are being removed,
 * so every copy read as "shared" and the run proposed unlinking the very things
 * it was meant to delete. The reachability test therefore EXCLUDES the doomed
 * subtree from the set of possible other parents.
 *
 * Everything removed is dumped RAW (textmap still compressed — a restore has to
 * be byte-for-byte what was taken) to `backups/orphans/` first.
 */
import fs from "fs";
import path from "path";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0242-one-day-column-per-day";
export const describe =
  "Removes duplicate Day Page day columns (3 each on 2026-08-24 and 2026-08-25), keeping the listed, most-complete one. Refuses any group whose losers hold text. Shared children are unlisted, never deleted.";
export const touches = ["occurrences"];

export const BOARD_ID = "8gpoqzx32h7";
export const DATE_FIELD_ID = "Eh7oi4HKdbHB";

/** Text held by one occurrence, read THROUGH the compression. */
export function textCharsOf(occ) {
  const tm = decompressTextmap(occ?.textmap);
  if (!tm) return 0;
  let n = 0;
  (function walk(node) {
    if (!node) return;
    if (typeof node.text === "string") n += node.text.length;
    for (const c of node.content || []) walk(c);
  })(tm);
  return n;
}

/**
 * Every occurrence in a column's subtree, by BOTH structural paths.
 * Cycle-guarded — a day column's children are multi-parented by design.
 */
export function subtreeOf(rootId, byId, childrenByParentId) {
  const seen = new Set();
  const out = [];
  const q = [rootId];
  while (q.length) {
    const id = q.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const occ = byId.get(id);
    if (!occ) continue;
    out.push(occ);
    for (const c of occ.occurrences || []) if (!seen.has(c)) q.push(c);
    for (const c of childrenByParentId.get(id) || []) if (!seen.has(c)) q.push(c);
  }
  return out;
}

/**
 * Which column survives. Listed beats unlisted (the board renders
 * `occurrences[]`); then most children; then earliest.
 */
export function pickKeeper(columns, listedIds) {
  return [...columns].sort((a, b) => {
    const la = listedIds.has(a.id) ? 0 : 1;
    const lb = listedIds.has(b.id) ? 0 : 1;
    if (la !== lb) return la - lb;
    const ca = (a.occurrences || []).length;
    const cb = (b.occurrences || []).length;
    if (ca !== cb) return cb - ca;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  })[0];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const occs = await Occurrence.find({ gridId }).lean();
  const byId = new Map(occs.map((o) => [o.id, o]));
  const childrenByParentId = new Map();
  for (const o of occs) {
    if (!o.parentId) continue;
    const l = childrenByParentId.get(o.parentId);
    if (l) l.push(o.id);
    else childrenByParentId.set(o.parentId, [o.id]);
  }

  const board = byId.get(BOARD_ID);
  if (!board) {
    log(`Day Page board ${BOARD_ID} not on this grid — nothing to do.`);
    return;
  }
  const listedIds = new Set(board.occurrences || []);

  // Group the board's day columns by their date value.
  const byDate = new Map();
  for (const o of occs) {
    if (o.parentId !== BOARD_ID) continue;
    const raw = o.fields?.[DATE_FIELD_ID]?.value;
    const key = typeof raw === "string" ? raw.slice(0, 10) : null;
    if (!key) continue;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(o);
  }

  const dupDates = [...byDate.entries()].filter(([, l]) => l.length > 1).sort();
  if (dupDates.length === 0) {
    log("0 duplicate day columns — nothing to do.");
    return;
  }
  log(`${dupDates.length} date(s) with more than one day column.`);

  const toDelete = [];   // occurrence docs to remove outright
  const toUnlist = [];   // { parentId, childId } — shared, unlink only
  const boardDrop = [];  // column ids to remove from the board's occurrences[]

  for (const [date, columns] of dupDates) {
    const keeper = pickKeeper(columns, listedIds);
    const losers = columns.filter((c) => c.id !== keeper.id);
    log(`  ${date}: ${columns.length} columns — keeping ${keeper.id.slice(0, 8)} (listed=${listedIds.has(keeper.id)}, children=${(keeper.occurrences || []).length})`);

    // The doomed set is every node under every loser. A child shared with the
    // keeper (or with anything else) must survive.
    const doomedIds = new Set();
    const loserSubtrees = new Map();
    for (const l of losers) {
      const st = subtreeOf(l.id, byId, childrenByParentId);
      loserSubtrees.set(l.id, st);
      for (const o of st) doomedIds.add(o.id);
    }

    // THE WRITING GUARD. Text only — never field values (`0038`).
    let chars = 0;
    for (const st of loserSubtrees.values()) for (const o of st) chars += textCharsOf(o);
    if (chars > 0) {
      log(`     REFUSED: the losers hold ${chars} character(s) of writing — left alone, reported.`);
      continue;
    }

    for (const l of losers) {
      boardDrop.push(l.id);
      for (const o of loserSubtrees.get(l.id)) {
        // Reachable from OUTSIDE the doomed set? Then it is shared — unlink it
        // from its doomed parents and leave the occurrence alive.
        const otherParents = occs.filter(
          (p) => !doomedIds.has(p.id) && p.id !== l.id &&
            ((p.occurrences || []).includes(o.id) || o.parentId === p.id)
        );
        const sharedOutside = otherParents.some((p) => p.id !== BOARD_ID);
        if (o.id !== l.id && sharedOutside) {
          for (const st of loserSubtrees.values()) {
            for (const p of st) {
              if ((p.occurrences || []).includes(o.id)) toUnlist.push({ parentId: p.id, childId: o.id });
            }
          }
          log(`     ${o.id.slice(0, 8)} is shared (${otherParents.length} other parent(s)) — UNLISTED, not deleted`);
        } else {
          toDelete.push(o);
        }
      }
    }
  }

  log(`\nplan: delete ${toDelete.length} occurrence(s), unlist ${toUnlist.length} shared ref(s), drop ${boardDrop.length} column(s) from the board's list`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  if (toDelete.length === 0 && boardDrop.length === 0) return;

  // Dump RAW (textmap still compressed) before removing anything.
  const dir = path.resolve(process.cwd(), "backups/orphans");
  fs.mkdirSync(dir, { recursive: true });
  const dump = path.join(dir, `0242-day-columns-${Date.now()}.json`);
  fs.writeFileSync(dump, JSON.stringify(toDelete, null, 2));
  log(`dumped ${toDelete.length} raw occurrence(s) to ${dump}`);

  for (const { parentId, childId } of toUnlist) {
    await Occurrence.updateOne({ gridId, id: parentId }, { $pull: { occurrences: childId } });
  }
  if (boardDrop.length) {
    await Occurrence.updateOne({ gridId, id: BOARD_ID }, { $pull: { occurrences: { $in: boardDrop } } });
  }
  await Occurrence.deleteMany({ gridId, id: { $in: toDelete.map((o) => o.id) } });
  log(`removed ${toDelete.length} occurrence(s).`);
}
