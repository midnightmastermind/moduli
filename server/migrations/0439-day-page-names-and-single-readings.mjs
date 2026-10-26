// 0439 — day page columns are named like the Schedule's, and each day shows each reading once.
//
// 1. "Day Page - <date>" (user, 2026-10-26: "call it Day Page {date}, mirroring the schedule" — the Schedule's columns
//    read "Schedule - Monday, October 26th, 2026"). Day Page: Build Day's root label, and every existing column
//    (signature daypage:col:<date>) whose name is the bare date.
// 2. Readings (user: "the reflections that get posted on each day page are posting twice"). Several runs of
//    Day Page: Readings imported the same passage at once (fixed at the source: utils/importDedupe). In each
//    Reflections section, one copy of each book is kept — one the section shows, else the earliest — and the others go
//    with everything under them. A kept reading the section's text does not show (two imports finishing together
//    each wrote the text without the other's embed — fixed by serializing that write) is embedded at the end.
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { planDocEmbed, textmapEmbeds } from "../utils/embedRootInDocParent.js";

export const id = "0439-day-page-names-and-single-readings";
export const describe = "Names day page columns 'Day Page - <date>' (op + existing columns); keeps one copy of each reading per day page Reflections section (deleting the duplicates and their subtrees) and embeds kept readings the section did not show.";
export const touches = ["operations", "occurrences", "modules"];

const PREFIX = "Day Page - ";

/** Which children of one Reflections section to keep and which to delete. Pure. */
export function planReadings(children, { titleOf, shown }) {
  const groups = new Map();
  for (const c of children) {
    const t = titleOf(c);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(c);
  }
  const keep = [], drop = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (shown(b) - shown(a)) || (new Date(a.createdAt) - new Date(b.createdAt)));
    keep.push(sorted[0]);
    drop.push(...sorted.slice(1));
  }
  return { keep, drop };
}

/** A textmap with the given occurrence embeds removed (top level and nested). Pure. */
export function withoutEmbeds(doc, ids) {
  const walk = (n) => {
    if (!n || typeof n !== "object") return n;
    if (!Array.isArray(n.content)) return n;
    return { ...n, content: n.content.filter((c) => !ids.has(c?.attrs?.occurrenceId)).map(walk) };
  };
  return walk(doc);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const now = new Date();

  // 1. Names.
  const op = await Operation.findOne({ gridId, name: "Day Page: Build Day" }).lean();
  if (!op) throw new Error("no Day Page: Build Day");
  const pj = JSON.stringify(op.pipeline);
  const opChanges = (pj.match(/"rootLabel":"\$\{dateLong:\$day\}"/g) || []).length;
  const cols = await Occurrence.find({ gridId, identitySignature: /^daypage:col:/ }).select("id label").lean();
  const rename = cols.filter((c) => c.label && !c.label.startsWith(PREFIX));
  log(`  names: Build Day root label (${opChanges} step) · ${rename.length} of ${cols.length} columns renamed`);

  // 2. Readings.
  const sections = await Occurrence.find({ gridId, identitySignature: "daypage:reflections" }).lean();
  const plans = [];
  for (const s of sections) {
    const kids = await Occurrence.find({ gridId, id: { $in: s.occurrences || [] } }).lean();
    const mods = new Map((await Module.find({ gridId, id: { $in: kids.map((k) => k.moduleId) } }).lean()).map((m) => [m.id, m]));
    const tm = s.textmap ? decompressTextmap(s.textmap) : null;
    const { keep, drop } = planReadings(kids, { titleOf: (k) => k.label || mods.get(k.moduleId)?.label || k.id, shown: (k) => (tm && textmapEmbeds(tm, k.id) ? 1 : 0) });
    const unshown = keep.filter((k) => !(tm && textmapEmbeds(tm, k.id)));
    if (drop.length || unshown.length) plans.push({ s, tm, drop, unshown, mod: await Module.findOne({ gridId, id: s.moduleId }).lean() });
  }
  log(`  readings: ${plans.reduce((n, p) => n + p.drop.length, 0)} duplicate(s) deleted, ${plans.reduce((n, p) => n + p.unshown.length, 0)} kept reading(s) embedded, in ${plans.length} section(s)`);
  if (dryRun) return;

  if (opChanges) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: JSON.parse(pj.replace(/"rootLabel":"\$\{dateLong:\$day\}"/g, `"rootLabel":"${PREFIX}\${dateLong:$day}"`)), updatedAt: now } });
  for (const c of rename) await Occurrence.updateOne({ gridId, id: c.id }, { $set: { label: PREFIX + c.label, updatedAt: now } });

  for (const { s, tm, drop, unshown, mod } of plans) {
    // Everything under each duplicate: listed or parented, and what its text embeds.
    const gone = new Set();
    const stack = drop.map((d) => d.id);
    while (stack.length) {
      const id = stack.pop(); if (gone.has(id)) continue; gone.add(id);
      const o = await Occurrence.findOne({ gridId, id }).select("id occurrences textmap").lean();
      for (const c of o?.occurrences || []) stack.push(c);
      for (const c of await Occurrence.find({ gridId, parentId: id }).select("id").lean()) stack.push(c.id);
      if (o?.textmap) for (const m of JSON.stringify(decompressTextmap(o.textmap)).matchAll(/"occurrenceId":"([^"]+)"/g)) stack.push(m[1]);
    }
    const goneOccs = await Occurrence.find({ gridId, id: { $in: [...gone] } }).select("moduleId").lean();
    let next = withoutEmbeds(tm || { type: "doc", content: [] }, gone);
    for (const k of unshown) next = planDocEmbed({ parentModule: mod, textmap: next, childId: k.id }) || next;
    await Occurrence.updateOne({ gridId, id: s.id }, { $set: { occurrences: (s.occurrences || []).filter((x) => !gone.has(x)), textmap: compressTextmap(next), updatedAt: now } });
    await Occurrence.deleteMany({ gridId, id: { $in: [...gone] } });
    for (const mid of new Set(goneOccs.map((o) => o.moduleId).filter(Boolean))) {
      if (!(await Occurrence.exists({ gridId, moduleId: mid }))) await Module.deleteOne({ gridId, id: mid });
    }
  }
  log("  applied. RESTART pm2.");
}
