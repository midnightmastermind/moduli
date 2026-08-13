// server/migrations/0091-columns-embed-the-wheel.mjs
//
// User, 2026-08-12: "the emotion wheel is no longer on the day page for today"
// (and today, they confirmed, is the 12th).
//
// LISTED BUT NOT EMBEDDED — the class this repo has repaired from four
// directions already, arriving from a fifth. A day column is `kind:"doc"`, so it
// renders its TEXTMAP, not `occurrences[]`. Measured across every column that
// lists the wheel:
//
//   2026-08-06  listed  embedded NO
//   2026-08-10  listed  embedded NO
//   2026-08-11  listed  embedded YES
//   2026-08-12  listed  embedded NO   <- the user's "today"
//   2026-08-13  listed  embedded YES
//
// So the wheel is a child of all five and invisible on three.
//
// WHY, AND WHY A ONE-TIME REPAIR IS ENOUGH. `Day Page: Build` rebuilds a column's
// textmap by looping `$col.occurrences` and pushing a moduleEmbed for every child
// that is not a textblock and not the Todo — the wheel qualifies. It also
// ADD_CHILDs the wheel. The three broken columns had their textmap written
// BEFORE the wheel was ever in their child list, and have not been rebuilt since;
// the two good ones were built after. The wheel is in `occurrences[]` on all five
// now, so the next rebuild would embed it anyway — this just stops the user
// waiting for one.
//
// APPEND-ONLY. The embed goes at the END of the existing content and nothing is
// reordered or removed. 0033 learned that the hard way from the other side:
// scrubbing a "dangling" embed removed the only thing rendering a surviving
// sibling. Adding is the safe direction; rewriting is not.
//
// TEXTMAP IS STORED COMPRESSED, and a raw read gives a base64 string. 2026-07-30
// records a damage check that silently became a no-op for exactly this reason —
// so it is decompressed, edited, and recompressed through the app's own helpers.
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0091-columns-embed-the-wheel";
export const describe =
  "Day columns that LIST the emotions wheel but do not embed it get the embed, so it renders again.";

/** Every occurrence id a textmap embeds, at any depth. */
export function embeddedIds(textmap) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "moduleEmbed" || n.type === "instanceTextblock") {
      const id = n.attrs?.occurrenceId || n.attrs?.instanceId;
      if (id) out.push(id);
    }
    if (n.content) walk(n.content);
  };
  walk(textmap);
  return out;
}

/**
 * PURE — append one moduleEmbed unless it is already there.
 * Returns null when nothing needs doing, so a caller cannot write a no-op.
 */
export function appendEmbed(textmap, occurrenceId) {
  const doc = textmap && typeof textmap === "object" ? textmap : { type: "doc", content: [] };
  if (embeddedIds(doc).includes(occurrenceId)) return null;
  const content = Array.isArray(doc.content) ? doc.content : [];
  return { ...doc, type: doc.type || "doc",
    content: [...content, { type: "moduleEmbed", attrs: { occurrenceId } }] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  if (graphs.length !== 1 || !dateField) {
    log(`REFUSING: graphs=${graphs.length} date=${!!dateField} — nothing written.`);
    return;
  }
  const graph = graphs[0];
  const listing = occs.filter((o) => (o.occurrences || []).includes(graph.id));

  const plan = [];
  for (const col of listing) {
    let tm = col.textmap;
    try { if (typeof tm === "string") tm = decompressTextmap(tm); } catch { tm = null; }
    const next = appendEmbed(tm, graph.id);
    const day = String(col.fields?.[dateField.id]?.value || "—").slice(0, 10);
    if (!next) { log(`  ${day}  already embeds it — skipped`); continue; }
    plan.push({ col, next, day, before: embeddedIds(tm).length });
  }
  log(`columns listing the wheel: ${listing.length} · needing the embed: ${plan.length}`);
  for (const p of plan) log(`  ${p.day}  ${p.before} embed(s) -> ${p.before + 1} (appended at the end)`);

  if (dryRun) {
    log(`WOULD append a moduleEmbed for the wheel to ${plan.length} column textmap(s).`);
    return;
  }
  for (const p of plan) {
    await Occurrence.updateOne({ gridId, id: p.col.id },
      { $set: { textmap: compressTextmap(p.next) } });
  }
  log(`${plan.length} column(s) now render the wheel again.`);
}
