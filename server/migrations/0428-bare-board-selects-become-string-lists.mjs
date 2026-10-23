/**
 * 0428 — selects whose board rows hold nothing but a name become plain string lists.
 *
 * User 2026-10-23: "we have a bunch of [boards for selects] that are not necessary, that can be replaced by
 * string literal selects instead of occurrences … its the occurrences that dont have any fields really",
 * the boards deleted afterwards, and "you should be able to add to the string literal list … for the select
 * input" (`meta.allowNewOptions`, the flag Tags already uses).
 *
 * WHICH FIELDS, measured on poms (`server/_convcensus.mjs`): a field converts when its option rows fill no
 * field beyond Board Category / Tags / Date / Last Seen and the stock Poster + Files pictures a migration
 * gave every board row, AND no operation reads it (an op that reads a picked ROW would break on a string).
 * Kept as board queries: Ingredient, Meal, Movement, Mood, Parent Emotion, Location, Event, Creative Work,
 * Savings Goal, Account, To Account (their rows carry data), Beverage, Media, Reading, Project, Schedule
 * Type (an op reads them), and the artifact libraries (Album, Artist, Song(s), Author).
 * `up` re-checks the rule against the live rows and REFUSES a field that no longer meets it.
 *
 *  - type occurrence -> select; options = the board rows' names in board order; allowNewOptions on.
 *  - stored values (occurrence ids) -> those rows' names, everywhere they appear. An id naming nothing drops.
 *  - Savings Goal stops reading `wishlist` (it keeps its own savingsGoal rows); the Wish List board is KEPT
 *    in this pass and named in the log.
 *  - every other converted tag's board (page + container + its rows + their feed copies) is deleted; a
 *    module goes only when nothing else places it. Parent lists are cleaned. A textmap that embeds a doomed
 *    row makes the migration REFUSE (an embed cannot become a string).
 */
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0428-bare-board-selects-become-string-lists";
export const describe = "Selects whose board rows hold only a name become string lists you can add to; their boards are deleted (Wish List kept).";
export const touches = ["fields", "occurrences", "modules"];

export const CONVERT = [
  "Area", "Charity", "Equipment", "Gift Idea", "Gratitude Entry", "Idea", "Leisure Activity", "Medium",
  "Medication", "Plant", "Practice", "Prompt", "Route", "Skill", "Supplement", "Topic", "Verse", "Win",
  "Wish List Item",
];
export const KEEP_BOARD_TAGS = ["wishlist"];
const NOT_DATA = new Set(["Board Category", "Tags", "Date", "Last Seen", "Poster", "Files"]);

const BC_RULE = (bcId) => new RegExp(`fields\\.${bcId}\\.value","comparator":"\\w+","right":"([^"]*)"`, "g");
const filled = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);

/** Pure: a stored occurrence-field value -> its string-select value. */
export function idsToLabels(value, labelOf, multi) {
  const ids = Array.isArray(value) ? value : filled(value) ? [value] : [];
  const out = ids.map((x) => labelOf(x)).filter(Boolean);
  if (multi || Array.isArray(value)) return [...new Set(out)];
  return out[0] ?? null;
}

/** Pure: drop the `wishlist` rule from a find predicate's OR group (Savings Goal). */
export function withoutTag(predicate, bcId, tag) {
  const walk = (g) => ({ ...g, rules: (g.rules || [])
    .filter((r) => !(r.left === `fields.${bcId}.value` && r.right === tag))
    .map((r) => (r.rules ? walk(r) : r)) });
  return walk(predicate);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Occurrence, Module, Operation } = models;
  const [fields, occs, mods, ops] = await Promise.all([
    Field.find({ gridId }).lean(), Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const fByName = (n) => { const h = fields.filter((f) => f.name === n); if (h.length !== 1) throw new Error(`expected one "${n}" field, found ${h.length}`); return h[0]; };
  const fname = Object.fromEntries(fields.map((f) => [f.id, f.name]));
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const role = (o) => mById.get(o.moduleId)?.role;
  const kind = (o) => mById.get(o.moduleId)?.kind;
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || "";
  const bc = fByName("Board Category");
  const opText = ops.map((o) => JSON.stringify([o.pipeline, o.triggerObjects]));

  // ---- plan each field ------------------------------------------------------------
  const plans = [];
  for (const name of CONVERT) {
    const f = fByName(name);
    if (f.type !== "occurrence") { log(`  ${name}: already ${f.type} — skipped`); continue; }
    const tags = [...JSON.stringify(f.meta?.optionsSource || {}).matchAll(BC_RULE(bc.id))].map((x) => x[1]);
    if (!tags.length) throw new Error(`REFUSING: ${name} does not query Board Category`);
    if (opText.some((t) => t.includes(f.id))) throw new Error(`REFUSING: an operation reads ${name}`);
    const pool = occs.filter((o) => !o.meta?.feedSourceId && role(o) === "instance" &&
      [].concat(o.fields?.[bc.id]?.value || []).some((x) => tags.includes(x)));
    const data = pool.flatMap((o) => Object.entries(o.fields || {}).filter(([k, v]) => !NOT_DATA.has(fname[k]) && filled(v?.value)).map(([k]) => `${lbl(o)}.${fname[k]}`));
    if (data.length) throw new Error(`REFUSING: ${name}'s rows carry data (${data.slice(0, 4).join(", ")})`);
    const boards = occs.filter((o) => role(o) === "container" && kind(o) === "board" &&
      (o.feed?.conditions || []).some((c) => c.fieldId === bc.id && tags.includes(c.value)));
    const order = boards.flatMap((b) => b.occurrences || []);
    const sorted = [...pool].sort((a, b) => ((order.indexOf(a.id) + 1) || 1e9) - ((order.indexOf(b.id) + 1) || 1e9));
    const values = [...new Set(sorted.map(lbl).filter(Boolean))];
    const holders = occs.filter((o) => filled(o.fields?.[f.id]?.value));
    plans.push({ f, tags, pool, values, holders });
  }

  // ---- what gets deleted --------------------------------------------------------------
  const keptQueries = fields.filter((f) => !CONVERT.includes(f.name) && f.name !== "Savings Goal");
  const stillQueried = new Set(keptQueries.flatMap((f) => [...JSON.stringify(f.meta?.optionsSource || {}).matchAll(BC_RULE(bc.id))].map((x) => x[1])));
  const doomTags = [...new Set(plans.flatMap((p) => p.tags))].filter((t) => !KEEP_BOARD_TAGS.includes(t) && !stillQueried.has(t));
  const keptTags = [...new Set(plans.flatMap((p) => p.tags))].filter((t) => !doomTags.includes(t));
  const doomBoards = occs.filter((o) => role(o) === "container" && kind(o) === "board" && (o.feed?.conditions || []).length === 1 &&
    o.feed.conditions[0].fieldId === bc.id && doomTags.includes(o.feed.conditions[0].value));
  const boardIds = new Set(doomBoards.map((b) => b.id));
  const doomPages = occs.filter((o) => role(o) === "page" && (o.occurrences || []).length && o.occurrences.every((c) => boardIds.has(c)));
  const doomRows = occs.filter((o) => boardIds.has(o.parentId) || (o.parentId == null && occs.some((p) => boardIds.has(p.id) && (p.occurrences || []).includes(o.id)) && !occs.some((p) => !boardIds.has(p.id) && (p.occurrences || []).includes(o.id))));
  const rowIds = new Set(doomRows.map((o) => o.id));
  const doomCopies = occs.filter((o) => o.meta?.feedSourceId && rowIds.has(o.meta.feedSourceId));
  const doomed = new Set([...doomBoards, ...doomPages, ...doomRows, ...doomCopies].map((o) => o.id));

  // A doomed row embedded in a text cannot become a string — refuse rather than leave a dead embed.
  const embedded = occs.filter((o) => !doomed.has(o.id) && o.textmap && [...doomed].some((d) => JSON.stringify(decompressTextmap(o.textmap)).includes(d)));
  if (embedded.length) throw new Error(`REFUSING: ${embedded.length} text(s) embed a row this would delete (${embedded.slice(0, 3).map(lbl).join(", ")})`);

  log("  field              tags               values  stored");
  for (const p of plans) log(`  ${p.f.name.padEnd(18)} ${p.tags.join(",").padEnd(18)} ${String(p.values.length).padStart(6)}  ${p.holders.length}`);
  log(`  boards to delete: ${doomBoards.map(lbl).join(", ")}`);
  log(`  delete: ${doomPages.length} pages · ${doomBoards.length} board containers · ${doomRows.length} rows · ${doomCopies.length} feed copies`);
  log(`  boards KEPT (still read): ${keptTags.join(", ") || "none"}`);
  if (dryRun) return;

  // ---- convert --------------------------------------------------------------------------
  for (const p of plans) {
    const { optionsSource, randomizable, ...restMeta } = p.f.meta || {};
    const multi = !!restMeta.multiSelect;
    await Field.updateOne({ gridId, id: p.f.id }, { $set: { type: "select", meta: {
      ...restMeta, allowNewOptions: true, optionsSource: { mode: "manual", values: p.values },
    } } });
    for (const o of p.holders) {
      const v = idsToLabels(o.fields[p.f.id].value, (x) => (oById.has(x) ? lbl(oById.get(x)) : null), multi);
      await Occurrence.updateOne({ gridId, id: o.id }, filled(v)
        ? { $set: { [`fields.${p.f.id}.value`]: v } } : { $unset: { [`fields.${p.f.id}`]: "" } });
    }
  }
  const sg = fByName("Savings Goal");
  await Field.updateOne({ gridId, id: sg.id }, { $set: { "meta.optionsSource.predicate": withoutTag(sg.meta.optionsSource.predicate, bc.id, "wishlist") } });

  // ---- delete ------------------------------------------------------------------------------
  const ids = [...doomed];
  await Occurrence.updateMany({ gridId, occurrences: { $in: ids } }, { $pull: { occurrences: { $in: ids } } });
  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  const usedMods = new Set((await Occurrence.find({ gridId }, { moduleId: 1 }).lean()).map((o) => o.moduleId));
  const orphanMods = [...new Set([...doomBoards, ...doomPages, ...doomRows, ...doomCopies].map((o) => o.moduleId))].filter((m) => m && !usedMods.has(m));
  await Module.deleteMany({ gridId, id: { $in: orphanMods } });

  // ---- read back ----------------------------------------------------------------------------
  const left = await Occurrence.countDocuments({ gridId, id: { $in: ids } });
  const stillOcc = await Field.countDocuments({ gridId, id: { $in: plans.map((p) => p.f.id) }, type: "occurrence" });
  const dangling = await Occurrence.countDocuments({ gridId, occurrences: { $in: ids } });
  if (left || stillOcc || dangling) throw new Error(`readback: ${left} left, ${stillOcc} still occurrence-typed, ${dangling} lists still naming them`);
  log(`  applied: ${plans.length} fields converted, ${ids.length} occurrences + ${orphanMods.length} modules deleted. RESTART pm2.`);
}
