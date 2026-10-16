// 0408 — the Notes pages that were cut off at import get the rest of their notes.
//
// User, 2026-10-16: *"the philosopher stone doc still looks off too. the page finishes with only 2 of
// the process steps"* · *"make sure the other docs that got imported arent also broken"*. Answers:
// import the rest of the note, and nest a run of numbered steps under a heading.
//
// WHY THEY WERE CUT: the seed read each note with `parseSectionsWithInstances(file, …, maxSections)`,
// capped at 8 or 12 sections. A section past the cap was never read. Checked against every source in
// docs/: morenotes.md (22 headings, stopped after 7️⃣), philosopherstone.md (stopped after
// "2. Albedo"), aispecs.md (stopped after 🔟), gospelofthomasnotes.md (stopped before "Why This Matters for Thomas 19"). Uses,
// Pragmatic and Bangle Specs are complete. What WAS imported is intact (every line and table found).
//
// THE SHAPE IS 0379'S: a doc container per heading (headingLevel 2, nested 3/4), textblocks inside,
// each table in a textblock of its own, pictures wrapped beside prose. A run of numbered sections
// ("1️⃣ …", "2. …") that follows an unnumbered heading nests under it, so steps never sit as stray
// top-level headers. Where the note gives no heading, one is added (GROUPS).
//
// Pictures: each was looked at; PICTURES gives its caption and where it wraps. A picture not named
// there is left out and logged (one is hotlink-blocked, one is a watermarked decoration, one is a bare
// "image.png" that never existed).
//
// Deletes nothing. Moves the two existing walkthrough steps into "The Meta-Map" and moves the text
// that introduces them there too. Idempotent: each part is skipped once its first section exists.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { markdownToReaderDoc } from "../services/markdownImporter.js";

export const id = "0408-complete-cut-off-notes";
export const describe = "Add the sections the seed's section cap cut off the Philosopher's Stone, AI Specs and Gospel of Thomas (Notes) pages, in 0379's section shape with captioned pictures; nest runs of numbered steps under a heading.";
export const touches = ["occurrences", "modules"];

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs");

// ── pictures, captioned from what each shows ────────────────────────────────
export const PICTURES = {
  "https://64.media.tumblr.com/af6cbc1e50c1c3e8b325db879e59a057/7b54c608242e5f19-33/s1280x1920/4656076a0ec693aee35ba8686b1d8a3313714673.jpg":
    { caption: "A golden figure beneath two suns — Splendor Solis", wrap: "right" },
  "https://www.goldenelixir.com/pics/ms_jinye_350.jpg":
    { caption: "The Golden Elixir — a dragon over the golden pearl (Daoist inner alchemy)", wrap: "left" },
  "https://ih1.redbubble.net/image.4847526883.0922/flat%2C750x%2C075%2Cf-pad%2C750x1000%2Cf8f8f8.jpg":
    { caption: "A figure at rest beneath strings of light (painting)", end: true },
  "https://www.learnreligions.com/thmb/Dln0Rj7LVMtbIFCq2RtM9TE5INY%3D/1500x0/filters%3Ano_upscale%28%29%3Amax_bytes%28150000%29%3Astrip_icc%28%29/3_KING_2-58962fde3df78caebcf781d9.jpg":
    { caption: "King Sol and Queen Luna join hands beneath the dove — Rosarium Philosophorum", wrap: "right" },
  "https://images.theconversation.com/files/424274/original/file-20211001-23-11bus7j.jpg?auto=format&fit=clip&ixlib=rb-4.1.0&q=45&w=1000":
    { caption: "Materia Prima — the tree between Sun and Moon, the first pair beneath it (manuscript)", wrap: "left" },
  "https://cdn.vectorstock.com/i/1000v/35/40/red-gold-yin-and-yang-balance-symbol-graphic-vector-19463540.jpg":
    { caption: "Yin and yang in red and gold", end: true },
};

// Headings added where the note introduces a walkthrough without one: [file, line text starts with, heading].
export const GROUPS = [
  ["morenotes.md", "Absolutely — we can categorize", "The Unions Through the Four Stages"],
  ["morenotes.md", "Ah — perfect.", "Stages, Senses, Trees and Chakras"],
];

const NUMBERED = /^(\*\*)?\s*(\d+[.)]\s|[0-9]️?⃣|🔟)/;

/** PURE. Lines `from`..end of a note, with GROUPS headings added. */
export function tailOf(md, fileName, fromLine, toLine = Infinity) {
  const out = [];
  md.split("\n").forEach((l, i) => {
    const n = i + 1;
    if (n < fromLine || n > toLine) return;
    const g = GROUPS.find(([f, start]) => f === fileName && l.startsWith(start));
    if (g) out.push(`# ${g[2]}`, "");
    out.push(l);
  });
  return out.join("\n");
}

/**
 * PURE. Headings → a tree of sections. The shallowest heading is level 2; a numbered top-level
 * heading that follows an unnumbered one (and everything under it) moves one level down.
 * Returns { lead: markdown before the first heading, sections: [{ label, level, body, children }] }.
 */
export function sectionTree(md) {
  const lines = md.split("\n");
  let inCode = false;
  const heads = [];
  lines.forEach((l, i) => {
    if (l.startsWith("```")) inCode = !inCode;
    const m = !inCode && l.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) heads.push({ i, hashes: m[1].length, label: m[2].replace(/\*\*/g, "").trim() });
  });
  if (!heads.length) return { lead: md, sections: [] };
  // Levels follow nesting, not the hash count ("# A" then "### B" is one level down).
  const open = [];
  let parent = null;
  for (const h of heads) {
    while (open.length && open[open.length - 1].hashes >= h.hashes) open.pop();
    if (open.length) h.level = open[open.length - 1].level + 1;
    else if (NUMBERED.test(h.label) && parent) h.level = parent.level + 1;
    else { h.level = 2; if (!NUMBERED.test(h.label)) parent = h; else parent = null; }
    open.push(h);
  }
  const root = { level: 1, children: [] };
  const stack = [root];
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const node = { label: h.label, level: h.level, body: lines.slice(h.i + 1, end).join("\n"), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return { lead: lines.slice(0, heads[0].i).join("\n"), sections: root.children };
}

const isEmptyBlock = (b) => !b || (b.type === "paragraph" && !(b.content || []).some((c) => (c.text || "").trim() || c.type !== "text"));

/** PURE. Markdown → { textblocks: [{ blocks, table }], images: [src] }. A table is a textblock alone. */
export function chunk(md) {
  const { content } = markdownToReaderDoc(md);
  const images = [], textblocks = [];
  let cur = [];
  const flush = () => { if (cur.some((b) => !isEmptyBlock(b))) textblocks.push({ blocks: cur, table: false }); cur = []; };
  for (const b of content || []) {
    if (b.type === "image") { if (b.attrs?.src) images.push(b.attrs.src.replace(/\\(.)/g, "$1")); continue; }   // markdown escapes ("\&")
    if (b.type === "horizontalRule") continue;
    if (b.type === "table") { flush(); textblocks.push({ blocks: [b], table: true }); continue; }
    cur.push(b);
  }
  flush();
  return { textblocks, images };
}

const textOf = (n) => (n?.text || "") + (n?.content || []).map(textOf).join("");

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const gid = String(gridId);
  const read = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");
  const tm = (t) => { try { return typeof t === "string" ? decompressTextmap(t) : t; } catch { return null; } };
  const modOf = async (occ) => Module.findOne({ gridId: gid, id: occ.moduleId }).lean();
  const imports = await Folder.findOne({ gridId: gid, name: "Imports" }).lean();
  if (!imports) throw new Error("0408: no Imports folder");

  const newMods = [], newOccs = [], ops = [];
  const dropped = [];
  let userId = null;

  /** Plan a section subtree; returns the container occurrence id. */
  const writeSection = (sec, parentId) => {
    const modId = randomUUID(), occId = randomUUID();
    const { textblocks, images } = chunk(sec.body);
    const content = [], listed = [];
    const tbIds = textblocks.map((t) => {
      const tmod = randomUUID(), tocc = randomUUID();
      newMods.push({ id: tmod, userId, gridId: gid, role: "textblock", kind: "doc", label: "", fieldBindings: [], meta: {} });
      newOccs.push({ id: tocc, userId, gridId: gid, moduleId: tmod, parentId: occId, occurrences: [], fields: {}, meta: {}, textmap: compressTextmap({ type: "doc", content: t.blocks }) });
      listed.push(tocc);
      return { id: tocc, table: t.table, floats: [], side: null };
    });
    const ends = [];
    const prose = tbIds.filter((t) => !t.table);
    let p = 0;
    for (const src of images) {
      const plan = PICTURES[src];
      if (!plan) { dropped.push(`${sec.label}: ${src}`); continue; }
      const imod = randomUUID(), iocc = randomUUID();
      newMods.push({ id: imod, userId, gridId: gid, role: "artifact", kind: "image", label: plan.caption, fileRef: src, fieldBindings: [], meta: { source: "doc-image" } });
      newOccs.push({ id: iocc, userId, gridId: gid, moduleId: imod, parentId: imports.id, occurrences: [], fields: {}, meta: { embeddedIn: occId } });
      const host = plan.end ? null : prose[p++];
      if (host) { host.floats.push(iocc); host.side = plan.wrap; } else ends.push(iocc);
    }
    for (const t of tbIds) {
      const embed = { type: "moduleEmbed", attrs: { occurrenceId: t.id } };
      if (!t.floats.length) { content.push(embed); continue; }
      content.push({ type: "wrapGroup", attrs: { side: t.side || "right", anchor: "top", anchorIndex: 0, anchorOffset: null, neighborWidth: null, wrap: true, floatCount: null },
        content: [...t.floats.map((f) => ({ type: "moduleEmbed", attrs: { occurrenceId: f } })), embed] });
    }
    for (const c of sec.children) { const cid = writeSection(c, occId); content.push({ type: "moduleEmbed", attrs: { occurrenceId: cid } }); listed.push(cid); }
    for (const e of ends) content.push({ type: "moduleEmbed", attrs: { occurrenceId: e } });
    content.push({ type: "paragraph" });
    newMods.push({ id: modId, userId, gridId: gid, role: "container", kind: "doc", label: sec.label, fieldBindings: [], meta: { allowChildContainers: true, headingLevel: sec.level } });
    newOccs.push({ id: occId, userId, gridId: gid, moduleId: modId, parentId, occurrences: listed, fields: {}, meta: {}, textmap: compressTextmap({ type: "doc", content }) });
    return occId;
  };

  /** The page's root section container and its children labelled (occ, label). */
  const rootOf = async (pageLabel) => {
    const pm = await Module.findOne({ gridId: gid, role: "page", label: pageLabel }).lean();
    const po = pm && await Occurrence.findOne({ gridId: gid, moduleId: pm.id }).lean();
    if (!po) throw new Error(`0408: page "${pageLabel}" not found`);
    const root = await Occurrence.findOne({ gridId: gid, id: po.occurrences[0] }).lean();
    const kids = await Occurrence.find({ gridId: gid, id: { $in: root.occurrences } }).lean();
    const kmods = new Map((await Module.find({ gridId: gid, id: { $in: kids.map((k) => k.moduleId) } }).lean()).map((m) => [m.id, m]));
    const labelled = root.occurrences.map((id) => { const k = kids.find((x) => x.id === id); return { id, occ: k, label: (k && kmods.get(k.moduleId)?.label) || "" }; });
    userId = root.userId;
    return { root, labelled };
  };

  /** Insert section embeds into a root's textmap after `afterId` (null → before the trailing paragraph). */
  const insertInto = (root, ids, { afterId = null, beforeId = null, removeIds = [] } = {}) => {
    const doc = tm(root.textmap) || { type: "doc", content: [] };
    let content = (doc.content || []).filter((b) => !(b.type === "moduleEmbed" && removeIds.includes(b.attrs?.occurrenceId)));
    const embeds = ids.map((id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } }));
    let at;
    const idx = (x) => content.findIndex((b) => b.type === "moduleEmbed" && b.attrs?.occurrenceId === x);
    if (afterId) at = idx(afterId) + 1;
    else if (beforeId) at = idx(beforeId);
    else { at = content.length; while (at > 0 && isEmptyBlock(content[at - 1])) at--; }
    if (at < 0) throw new Error(`0408: anchor not in ${root.id}'s text`);
    content = [...content.slice(0, at), ...embeds, ...content.slice(at)];
    let list = root.occurrences.filter((x) => !removeIds.includes(x));
    const li = afterId ? list.indexOf(afterId) + 1 : beforeId ? list.indexOf(beforeId) : list.length;
    list = [...list.slice(0, li), ...ids, ...list.slice(li)];
    root.textmap = compressTextmap({ ...doc, content });
    root.occurrences = list;
    ops.push({ id: root.id, $set: { textmap: root.textmap, occurrences: list } });
  };

  const has = (labelled, prefix) => labelled.some((k) => k.label.startsWith(prefix));

  // ── Philosopher's Stone ──
  {
    const { root, labelled } = await rootOf("Philosopher’s Stone");
    // morenotes.md from 8️⃣ on, after 7️⃣
    if (has(labelled, "8️⃣")) log("Philosopher’s Stone: morenotes part already there — skipped");
    else {
      const md = read("morenotes.md");
      const from = md.split("\n").findIndex((l) => l.startsWith("# 8️⃣")) + 1;
      const t = sectionTree(tailOf(md, "morenotes.md", from));
      const ids = t.sections.map((s) => writeSection(s, root.id));
      const seven = labelled.find((k) => k.label.startsWith("7️⃣"));
      if (!seven) throw new Error("0408: no 7️⃣ section on Philosopher’s Stone");
      insertInto(root, ids, { afterId: seven.id });
      log(`Philosopher’s Stone: + ${ids.length} morenotes section(s) after 7️⃣`);
    }
    // the Meta-Map: the text that opens it, steps 1–2 moved in, 3, 4 and The Meta-Pattern added
    if (has(labelled, "The Meta-Map")) log("Philosopher’s Stone: Meta-Map already there — skipped");
    else {
      const nig = labelled.find((k) => k.label.startsWith("1. Nigredo — The Breakdown"));
      const alb = labelled.find((k) => k.label.startsWith("2. Albedo — The Clarifying"));
      const pat = labelled.find((k) => k.label.startsWith("Your Pattern Right Now"));
      if (!nig || !alb || !pat) throw new Error("0408: Meta-Map anchors not found");
      // the textblock under "Your Pattern Right Now" that turns into the meta-map at "Ohhh okay."
      const patTbs = await Occurrence.find({ gridId: gid, id: { $in: pat.occ.occurrences } }).lean();
      let lead = null;
      for (const tb of patTbs) {
        const d = tm(tb.textmap); const i = (d?.content || []).findIndex((b) => textOf(b).trim().startsWith("Ohhh okay."));
        if (i > 0) { lead = { tb, keep: d.content.slice(0, i), move: d.content.slice(i) }; break; }
      }
      if (!lead) throw new Error("0408: the meta-map's opening text was not found");
      const md = read("philosopherstone.md");
      const L = md.split("\n");
      const from = L.findIndex((l) => l.startsWith("# 3. Citrinitas")) + 1;
      const to = L.findIndex((l) => l.startsWith("# Where You Sit In This Map"));
      const steps = sectionTree(tailOf(md, "philosopherstone.md", from, to)).sections;
      const mmMod = randomUUID(), mmOcc = randomUUID();
      const leadMod = randomUUID(), leadOcc = randomUUID();
      newMods.push({ id: leadMod, userId, gridId: gid, role: "textblock", kind: "doc", label: "", fieldBindings: [], meta: {} });
      newOccs.push({ id: leadOcc, userId, gridId: gid, moduleId: leadMod, parentId: mmOcc, occurrences: [], fields: {}, meta: {}, textmap: compressTextmap({ type: "doc", content: lead.move }) });
      const stepIds = steps.map((s) => writeSection({ ...s, level: 3 }, mmOcc));
      const listed = [leadOcc, nig.id, alb.id, ...stepIds];
      newMods.push({ id: mmMod, userId, gridId: gid, role: "container", kind: "doc", label: "The Meta-Map", fieldBindings: [], meta: { allowChildContainers: true, headingLevel: 2 } });
      newOccs.push({ id: mmOcc, userId, gridId: gid, moduleId: mmMod, parentId: root.id, occurrences: listed, fields: {}, meta: {},
        textmap: compressTextmap({ type: "doc", content: [...listed.map((id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } })), { type: "paragraph" }] }) });
      ops.push({ id: lead.tb.id, $set: { textmap: compressTextmap({ type: "doc", content: lead.keep }) } });
      for (const k of [nig, alb]) { ops.push({ id: k.id, $set: { parentId: mmOcc } }); ops.push({ module: k.occ.moduleId, $set: { "meta.headingLevel": 3 } }); }
      insertInto(root, [mmOcc], { afterId: pat.id, removeIds: [nig.id, alb.id] });
      log(`Philosopher’s Stone: The Meta-Map — opening text moved, steps 1–2 moved in, + ${stepIds.length} section(s)`);
    }
    // the rest of philosopherstone.md, at the end
    if (has(labelled, "Where You Sit In This Map")) log("Philosopher’s Stone: the rest already there — skipped");
    else {
      const md = read("philosopherstone.md");
      const from = md.split("\n").findIndex((l) => l.startsWith("# Where You Sit In This Map")) + 1;
      const ids = sectionTree(tailOf(md, "philosopherstone.md", from)).sections.map((s) => writeSection(s, root.id));
      insertInto(root, ids);
      log(`Philosopher’s Stone: + ${ids.length} section(s) at the end`);
    }
  }

  // ── AI Specs ──
  {
    const { root, labelled } = await rootOf("AI Specs");
    if (has(labelled, "11️⃣")) log("AI Specs: already there — skipped");
    else {
      const md = read("aispecs.md");
      const from = md.split("\n").findIndex((l) => l.startsWith("# 11️⃣")) + 1;
      const ids = sectionTree(tailOf(md, "aispecs.md", from)).sections.map((s) => writeSection(s, root.id));
      insertInto(root, ids);
      log(`AI Specs: + ${ids.length} section(s) at the end`);
    }
  }

  // ── Gospel of Thomas (Notes) ──
  {
    const { root, labelled } = await rootOf("Gospel of Thomas (Notes)");
    if (has(labelled, "Why This Matters")) log("Gospel of Thomas (Notes): already there — skipped");
    else {
      const md = read("gospelofthomasnotes.md");
      const from = md.split("\n").findIndex((l) => l.startsWith("## Why This Matters")) + 1;
      const ids = sectionTree(tailOf(md, "gospelofthomasnotes.md", from)).sections.map((s) => writeSection(s, root.id));
      insertInto(root, ids);
      log(`Gospel of Thomas (Notes): + ${ids.length} section(s) at the end`);
    }
  }

  const n = (role) => newMods.filter((m) => m.role === role).length;
  log(`new: ${n("container")} section(s), ${n("textblock")} textblock(s), ${n("artifact")} picture(s); ${ops.length} existing write(s)`);
  for (const d of dropped) log(`  picture left out: ${d.slice(0, 140)}`);
  if (dryRun) return;
  await Module.insertMany(newMods);
  await Occurrence.insertMany(newOccs);
  for (const o of ops) {
    if (o.module) await Module.updateOne({ gridId: gid, id: o.module }, { $set: o.$set });
    else await Occurrence.updateOne({ gridId: gid, id: o.id }, { $set: o.$set });
  }
  log("written. Restart the server (pm2) — the warm cache still holds the old pages.");
}
