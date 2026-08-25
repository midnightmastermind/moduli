/**
 * 0241 — the documentaries come back off the grid.
 *
 * User, 2026-08-25, after reporting *"the entire app crashes trying to load the
 * schedule on my samsung tablet"* and being shown the payload measurement:
 * **"Drop just the documentaries"** — 1,822 rows, 51% of what `0238` added and
 * the least useful of the set (they are FILES with filename titles, not titled
 * works).
 *
 * ── WHAT THIS BUYS, STATED HONESTLY ──────────────────────────────────────
 *
 * Measured on the grid as shipped to every device:
 * ```
 * occurrences the client receives      21,768   20.4 MB
 *   library artifacts                  16,647   16.4 MB   render only when a board is opened
 *     of which 0238 added               3,579    3.8 MB
 *       of which documentaries          1,822    1.9 MB   <- this migration
 *   everything else                     5,121    4.0 MB   what the Schedule actually needs
 * ```
 * So this removes **~1.9 MB of ~20.4 MB**. It halves `0238`'s contribution and
 * it is NOT expected to be sufficient on its own: 12.6 MB of Spotify, Calibre
 * and bookmark artifacts predate this session and are shipped for the same no
 * reason. **The durable fix is not sending library artifacts in `full_state`
 * until a board is opened** — ~80% off the payload — which is the "lighter
 * full_state" 2026-08-24 already named as the outstanding remedy.
 *
 * ── IT REMOVES THE WHOLE CATEGORY, NOT JUST THE ROWS ─────────────────────
 *
 * Deleting 1,822 rows and leaving the board, the row module and the
 * `Documentaries Owned` tracker field behind would leave a board that renders
 * nothing and a tile that reads 0 forever — the inert-surface class this repo
 * keeps paying for. So the board (page + container), the shared row module, the
 * tracker field, its binding on the tile and its counter in the op all go too.
 *
 * **The `documentary` Board Category OPTION is deliberately KEPT.** Removing an
 * option from a live select is a different kind of risk for no gain, and `0238`
 * re-adds it anyway — so if the user asks for documentaries back, a forced
 * re-run of `0238` restores them and this file is the record of why they left.
 *
 * ── IT KEYS ON THE MARKER, NOT ON THE TAG ────────────────────────────────
 *
 * Rows are selected by `meta.mediaLibraryKey` beginning `documentary|`, which
 * only `0238` writes. A tag-based delete would also match anything the user
 * later tagged `documentary` by hand.
 */
import { COUNTS, varFor } from "./0239-media-owned-tracker.mjs";

export const id = "0241-drop-the-documentaries";
export const describe =
  "Removes the 1,822 imported documentary rows and the surfaces that existed only for them — the board, the row module, and the tracker field, binding and counter.";
export const touches = ["occurrences", "modules", "fields", "operations"];

export const KEY_PREFIX = "documentary|";

/** Does this `meta.mediaLibraryKey` name a documentary? PURE — a plain string
 *  test, never a pattern, because the prefix's own separator is `|`. */
export function isDocumentary(key) {
  return typeof key === "string" && key.startsWith(KEY_PREFIX);
}
export const TAG = "documentary";
export const FIELD_NAME = "Documentaries Owned";

/** Drop the documentary counter from the tracker op. PURE, so it is testable.
 *  Returns the number of steps removed. */
export function stripCounterSteps(pipeline, { varName, fieldId }) {
  let removed = 0;
  const prune = (steps) => {
    if (!Array.isArray(steps)) return steps;
    const out = [];
    for (const s of steps) {
      const c = s?.config || {};
      const isInit = c.type === "INIT_VAR" && c.name === varName;
      const isUpdate = c.type === "UPDATE" && typeof c.path === "string" && fieldId && c.path.includes(fieldId);
      // the per-tag IF whose only body is this counter's INCREMENT
      const isCounterIf = s?.type === "if" && Array.isArray(s.then) && s.then.length === 1
        && s.then[0]?.config?.type === "INCREMENT_VAR" && s.then[0]?.config?.name === varName;
      if (isInit || isUpdate || isCounterIf) { removed++; continue; }
      if (s?.then) s.then = prune(s.then);
      if (s?.else) s.else = prune(s.else);
      if (s?.body) s.body = prune(s.body);
      out.push(s);
    }
    return out;
  };
  pipeline.steps = prune(pipeline.steps);
  return removed;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const gid = String(gridId);

  // NO $regex. `KEY_PREFIX` ends in "|", which is regex ALTERNATION — so
  // `{ $regex: "^documentary|" }` reads as "starts with documentary OR matches
  // the empty string" and matches EVERY row carrying the marker. The first run
  // of this migration deleted all 3,579 imported rows instead of the 1,822
  // documentaries, and the log said "3579" in plain sight. A marker whose own
  // separator is a regex metacharacter must never be interpolated into a
  // pattern; the match is a plain string test, which cannot be escaped wrongly.
  const marked = await Occurrence.find(
    { gridId: gid, "meta.mediaLibraryKey": { $exists: true } },
    { id: 1, parentId: 1, moduleId: 1, "meta.mediaLibraryKey": 1 }).lean();
  const rows = marked.filter((r) => isDocumentary(r.meta?.mediaLibraryKey));
  log(`rows carrying 0238's marker: ${marked.length} · of those, documentaries: ${rows.length}`);
  if (rows.length && rows.length === marked.length && marked.length > 2000) {
    log("REFUSING: the selector matched EVERY marked row — that is the regex bug, not a real result");
    return;
  }
  if (!rows.length) { log("nothing to remove — already dropped"); }

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  const occs = await Occurrence.find({ gridId: gid },
    { id: 1, moduleId: 1, feed: 1, occurrences: 1, parentId: 1, [`fields.${tagField?.id}`]: 1 }).lean();
  const tagOf = (o) => { const v = o.fields?.[tagField?.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const container = occs.find((o) => tagOf(o).includes(TAG) && o.feed?.enabled);
  const page = container ? occs.find((o) => (o.occurrences || []).includes(container.id)) : null;
  const rowMod = await Module.findOne({ gridId: gid, label: "Documentary", "meta.mediaRow": true }).lean();
  const field = await Field.findOne({ gridId: gid, name: FIELD_NAME }).lean();
  const tile = await Module.findOne({ gridId: gid, "meta.mediaOwnedTile": true }).lean();
  const op = await Operation.findOne({ gridId: gid, name: "Trackers: Media Owned" }).lean();

  log(`board container : ${container?.id ?? "(none)"}`);
  log(`board page      : ${page?.id ?? "(none)"}`);
  log(`row module      : ${rowMod?.id ?? "(none)"}`);
  log(`tracker field   : ${field?.id ?? "(none)"}  bound on tile: ${tile ? (tile.fieldBindings || []).some((b) => b.fieldId === field?.id) : "n/a"}`);
  log(`tracker op      : ${op ? op.name : "(none)"}`);
  if (dryRun) return { rows: rows.length };

  if (rows.length) {
    const ids = rows.map((r) => r.id);
    // Unlist BEFORE deleting, so a parent never lists an id that no longer
    // exists — the dangling-child-ref class this repo has swept five times.
    // `$pullAll`, never a whole-array write: a connected client echoing a stale
    // `occurrences[]` back over one is the 2026-08-13 (2) clobber.
    const parents = [...new Set(rows.map((r) => r.parentId).filter(Boolean))];
    for (const p of parents) {
      await Occurrence.updateOne({ id: p, gridId: gid }, { $pullAll: { occurrences: ids } });
    }
    for (let i = 0; i < ids.length; i += 500) {
      await Occurrence.deleteMany({ gridId: gid, id: { $in: ids.slice(i, i + 500) } });
    }
    log(`  removed ${ids.length} rows from ${parents.length} parent(s)`);
  }

  if (container) {
    if (page) {
      await Occurrence.updateOne({ id: page.id, gridId: gid }, { $pull: { occurrences: container.id } });
      await Occurrence.deleteOne({ id: page.id, gridId: gid });
      if (page.moduleId) await Module.deleteOne({ id: page.moduleId, gridId: gid });
    }
    await Occurrence.deleteOne({ id: container.id, gridId: gid });
    if (container.moduleId) await Module.deleteOne({ id: container.moduleId, gridId: gid });
    log("  removed the Documentaries board (page + container + their modules)");
  }
  if (rowMod) { await Module.deleteOne({ id: rowMod.id, gridId: gid }); log("  removed the shared Documentary row module"); }

  // ── the tracker surfaces that existed only for this category ────────────
  if (tile && field) {
    await Module.updateOne({ id: tile.id, gridId: gid }, { $pull: { fieldBindings: { fieldId: field.id } } });
    log("  unbound the field from the Media Owned tile");
  }
  if (op && field) {
    const pipeline = JSON.parse(JSON.stringify(op.pipeline));
    const entry = COUNTS.find(([, t]) => t === TAG);
    const removed = stripCounterSteps(pipeline, { varName: varFor(entry[0]), fieldId: field.id });
    await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
    log(`  removed ${removed} step(s) from "${op.name}"`);
  }
  if (field) { await Field.deleteOne({ id: field.id, gridId: gid }); log(`  removed the "${FIELD_NAME}" field`); }

  log("  done — RESTART pm2 and reload.");
  return { rows: rows.length };
}
