// 0379 — the Notes pages become sections of doc containers, the way an imported
// article is built; the pictures in them wrap beside the text they belong to and
// get captions that say what they show.
//
// User, 2026-10-01: *"with philosopher stone and the other pages in this folder,
// change alot of the textblocks to doc containers going downward like the eminem
// article. right now its nesting images inside textblocks … i want it more
// organized. so doc containers for the steps of the process with a textblock and
// image wrap underneath"* · *"use your best judgement on what images should wrap
// around the right text"* · *"look at them, and decide a better caption than the
// headers"* · and, on the Wewelsburg sunwheel that `BlackSun.svg` turned out to
// be: *"remove it and find the alchemical sol niger one"*.
//
// THE SHAPE IS THE IMPORTED ARTICLE'S (Eminem): the page embeds ONE root doc
// container named after the page; a textblock that opens with an H2 becomes a
// doc container named by that heading, an H3 one nests inside the H2 before it,
// and the heading text leaves the textblock (the container's header shows it).
// A textblock that is only a heading — or only the page's own title — goes.
// A textblock holding pictures is also split at its inner headings ("External
// (Lab)" / "Internal (Psyche)"), so each part is its own container a picture
// can wrap.
//
// WHICH PICTURE WRAPS WHICH TEXT is a reading, written down per picture in
// PLACEMENT (keyed by module id). Every picture was looked at before it was
// placed. A picture the plan does not name is appended where it was found,
// so nothing can be lost by the plan being incomplete.
//
// Deletes: the heading-only and title-only textblocks (their text is now a
// container label) and the sunwheel's artifact module. Everything else moves.
// Idempotent: a page whose textmap already opens with a container is skipped.

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0379-notes-pages-into-sections";
export const describe = "Restructure the Documents/Notes pages into doc-container sections (like an imported article), wrap each picture beside its text, caption every picture from what it shows, and replace the Wewelsburg sunwheel with the Splendor Solis sol niger.";
export const touches = ["occurrences", "modules"];

// ── The pictures, captioned from what each one shows ────────────────────────
export const CAPTIONS = {
  qng4app9n4: "The Book: On the Taboo Against Knowing Who You Are — Alan Watts",
  "5t5j9x6n9h": "The four elemental triangles: air, fire, earth, water",
  fmh3l1qpng: "Leibniz's wheel of the four elements and their qualities",
  "0rn1o3ki6z": "Lavoisier's table of alchemical element symbols",
  "7yth4x5jlt": "The elements on the axes of warm–cold and moist–dry",
  "9kktvg1922": "King and queen joined by the dove — the alchemical wedding (Rosarium Philosophorum)",
  "79pr698yoi": "Daoist seated meditation, the first stage of inner alchemy",
  "7ws51lgp76": "Alchemical sign for purification",
  "75gkmlv6iv": "Alchemical sign for purification by water",
  azxlhzzn5s: "Putrefactio — death standing on the blackened sun (Mylius, Philosophia Reformata)",
  "9klxhnlr1j": "A figure at the mouth of a swirling vortex of light (painting)",
  "4t8p1oidse": "Yin and yang (link no longer resolves)",
  xvs67gfr10: "Yin and yang in fire and water",
  abz6etzvbr: "Rubedo — the red king and white queen united before the phoenix",
  "4sdaz71amo": "Materia Prima — the mineral, animal and vegetable kingdoms",
  gq5e0ksijd: "Lunar and solar figures sharing the grail (painting)",
  cot99khbaa: "In Sole — the serpents of sun and moon (Adam McLean)",
  "1vzz96trxr": "Figure 1 of an Ambix article on alchemy (2024)",
  vx083tqt7g: "Star polygons and polygrams, heptagram to dodecagram",
  zmm8m9kmw5: "A page of Isaac Newton's alchemical manuscripts",
  j0xto1agf7: "The alchemist's laboratory ringed by scripture (Khunrath)",
  ple7r4h8ov: "Stills and flasks in a 16th-century German distilling book",
  z2mjbwv53r: "Dat Rosa Mel Apibus — the rose gives honey to the bees",
  hobavj9b8e: "The White Rose of York",
  adu6g0k368: "Putrefactio, Rosa Alba, Rosa Rubea — the flask turning black, white and red",
  "53e9ux6409": "The Eighth Key of Basil Valentine — death and regrowth",
  m7a10j6ezo: "Black Sun (book cover)",
};

// The sunwheel ("BlackSun.svg" on Wikimedia is the Wewelsburg Schwarze Sonne,
// not the alchemical sun) is replaced IN PLACE: the same placement, a new module.
export const SUNWHEEL_MODULE = "a8bfscccvz";
export const SOL_NIGER = {
  label: "Sol niger — the black sun setting over the marsh (Splendor Solis)",
  fileRef: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/A_black_sun_with_a_face_descends_behind_the_horizon_of_a_mar_Wellcome_V0025641.jpg/960px-A_black_sun_with_a_face_descends_behind_the_horizon_of_a_mar_Wellcome_V0025641.jpg",
};

// ── Where each picture goes. `path` matches container labels by prefix, from
// the page's root container down. `split`/`part`: split the host textblock at
// that block and wrap that half. `top`: no text to wrap — first in the section.
// `end`: left plain at the end of its section (unviewable, so not featured).
const STAGES = "The Magnum Opus";
export const PLACEMENT = {
  // Philosopher's Stone
  "9kktvg1922": { path: ["Introduction"], side: "right" },
  cot99khbaa: { path: ["1️⃣ Male"], side: "right" },
  xvs67gfr10: { path: ["5️⃣ Active"], side: "right" },
  adu6g0k368: { path: [STAGES], top: true },
  "53e9ux6409": { path: [STAGES, "1. Nigredo", "External"], side: "right" },
  [SUNWHEEL_MODULE]: { path: [STAGES, "1. Nigredo", "Internal"], side: "left" },
  m7a10j6ezo: { path: ["Psychological Framing"], side: "right" },
  ple7r4h8ov: { path: [STAGES, "2. Albedo", "External"], side: "right" },
  hobavj9b8e: { path: [STAGES, "2. Albedo", "Internal"], side: "left" },
  z2mjbwv53r: { path: ["Your Pattern Right Now"], side: "right" },
  j0xto1agf7: { path: [STAGES, "3. Citrinitas", "External"], side: "right" },
  vx083tqt7g: { path: [STAGES, "3. Citrinitas", "Internal"], side: "left" },
  "1vzz96trxr": { path: [STAGES, "3. Citrinitas"], end: true },
  zmm8m9kmw5: { path: ["The Real Bridge"], side: "right" },
  abz6etzvbr: { path: [STAGES, "4. Rubedo", "External"], side: "right" },
  gq5e0ksijd: { path: [STAGES, "4. Rubedo", "Internal"], side: "left" },
  "4sdaz71amo": { path: ["Even Deeper"], side: "right" },
  azxlhzzn5s: { path: ["1. Nigredo — The Breakdown"], split: 2, part: 0, side: "right" },
  "9klxhnlr1j": { path: ["1. Nigredo — The Breakdown"], split: 2, part: 1, side: "left" },
  "4t8p1oidse": { path: ["1. Nigredo — The Breakdown"], end: true },
  "79pr698yoi": { path: ["2. Albedo — The Clarifying"], split: 2, part: 0, side: "right" },
  "75gkmlv6iv": { path: ["2. Albedo — The Clarifying"], split: 2, part: 1, side: "left", nw: 160 },
  "7ws51lgp76": { path: ["2. Albedo — The Clarifying"], split: 2, part: 1, side: "left", nw: 160 },
  // Gospel of Thomas (Notes)
  "5t5j9x6n9h": { path: ["The Classical Element"], split: 2, part: 0, side: "right" },
  "7yth4x5jlt": { path: ["The Classical Element"], split: 2, part: 1, side: "left" },
  fmh3l1qpng: { path: ["2. The Five Elements"], split: 2, part: 0, side: "right" },
  "0rn1o3ki6z": { path: ["2. The Five Elements"], split: 2, part: 1, side: "left", nw: 180 },
};

// ── pure helpers ─────────────────────────────────────────────────────────────
export const textOf = (n) => !n ? "" : n.type === "text" ? (n.text || "") : (n.content || []).map(textOf).join("");
const HAS_SUBSTANCE = new Set(["table", "horizontalRule", "image", "moduleEmbed", "wrapGroup", "instanceTextblock", "codeBlock"]);
export function isEmptyBlock(b) {
  if (!b) return true;
  if (HAS_SUBSTANCE.has(b.type)) return false;
  if (JSON.stringify(b).includes('"moduleEmbed"')) return false;
  return textOf(b).trim() === "";
}
const isHeading = (b) => b?.type === "heading";
const headingLevel = (b) => Number(b?.attrs?.level) || 1;

/**
 * PURE. Turn a page's ordered textblocks into a section tree.
 *
 *   pageLabel   the page's name (its H1-only textblock is dropped as redundant)
 *   textblocks  [{ occId, blocks }] in page order
 *   isImage     (occId) => boolean — an embed of a picture inside a textblock
 *
 * Returns { root, dropped:[occId], edited:Map(occId → blocks), created:[{key,
 * blocks}] } where root = { label, level, children:[…] } and a child is
 * { kind:"tb", occId } | { kind:"tbNew", key } | { kind:"ct", label, level, children }
 * | { kind:"img", occId }. Pictures found in a textblock become "img" children of
 * the container that textblock lands in, at that point.
 */
export function buildTree({ pageLabel, textblocks, isImage }) {
  const root = { kind: "ct", label: pageLabel, level: 1, children: [] };
  const dropped = [];
  const edited = new Map();
  const created = [];
  let h2 = null, h3 = null;
  let n = 0;
  const current = () => h3 || h2 || root;
  for (const { occId, blocks: raw } of textblocks) {
    let blocks = Array.isArray(raw) ? raw : [];
    const first = blocks[0];
    let target = current();
    if (isHeading(first)) {
      const title = textOf(first).trim();
      const level = headingLevel(first);
      blocks = blocks.slice(1);
      if (level === 1 && title === pageLabel) {
        // the page's own title: the root container's label says it now
        target = root;
      } else if (level <= 2) {
        h2 = { kind: "ct", label: title, level: 2, children: [] }; h3 = null;
        root.children.push(h2); target = h2;
      } else {
        h3 = { kind: "ct", label: title, level: 3, children: [] };
        (h2 || root).children.push(h3); target = h3;
      }
    }
    // Pictures inside this textblock come out of its text.
    const imgs = [];
    const rest = [];
    for (const b of blocks) {
      if (b?.type === "moduleEmbed" && isImage(b.attrs?.occurrenceId)) imgs.push(b.attrs.occurrenceId);
      else rest.push(b);
    }
    for (const id of imgs) target.children.push({ kind: "img", occId: id });
    // A textblock that held pictures is split at its inner headings.
    const parts = [{ label: null, blocks: [] }];
    for (const b of rest) {
      if (imgs.length && isHeading(b)) parts.push({ label: textOf(b).trim(), level: headingLevel(b), blocks: [] });
      else parts[parts.length - 1].blocks.push(b);
    }
    const lead = parts[0].blocks;
    if (lead.some((b) => !isEmptyBlock(b))) {
      target.children.push({ kind: "tb", occId });
      if (lead.length !== (raw || []).length) edited.set(occId, lead);
    } else {
      dropped.push(occId);
    }
    for (const p of parts.slice(1)) {
      const sub = { kind: "ct", label: p.label, level: Math.max(3, Math.min(4, (target.level || 2) + 1)), children: [] };
      target.children.push(sub);
      if (p.blocks.some((b) => !isEmptyBlock(b))) {
        const key = `new${++n}`;
        created.push({ key, blocks: p.blocks });
        sub.children.push({ kind: "tbNew", key });
      }
    }
  }
  return { root, dropped, edited, created };
}

/** PURE. The container at `path` (label prefixes, from the root), or null. */
export function findPath(root, path) {
  let cur = root;
  for (const prefix of path) {
    cur = (cur.children || []).find((c) => c.kind === "ct" && c.label.startsWith(prefix));
    if (!cur) return null;
  }
  return cur;
}

const uid = () => Math.random().toString(36).slice(2, 12);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);

  // ── captions + the sunwheel, first: they hold regardless of the layout ──
  for (const [mid, label] of Object.entries(CAPTIONS)) {
    if (!dryRun) await Module.updateOne({ gridId: gid, id: mid }, { $set: { label } });
  }
  const sunwheelOccs = await Occurrence.find({ gridId: gid, moduleId: SUNWHEEL_MODULE }, { id: 1, userId: 1 }).lean();
  let solNigerId = null;
  if (sunwheelOccs.length) {
    solNigerId = uid();
    if (!dryRun) {
      await Module.create({ id: solNigerId, userId: sunwheelOccs[0].userId, gridId: gid, role: "artifact", kind: "image",
        label: SOL_NIGER.label, fileRef: SOL_NIGER.fileRef, fieldBindings: [], meta: { source: "doc-image" } });
      await Occurrence.updateMany({ gridId: gid, moduleId: SUNWHEEL_MODULE }, { $set: { moduleId: solNigerId } });
      await Module.deleteOne({ gridId: gid, id: SUNWHEEL_MODULE });
    }
    log(`sunwheel → sol niger on ${sunwheelOccs.length} placement(s)`);
  }

  // ── the Notes folder: the one holding Philosopher's Stone ──
  const psMod = await Module.findOne({ gridId: gid, role: "page", label: "Philosopher’s Stone" }, { id: 1 }).lean();
  const psOcc = psMod && await Occurrence.findOne({ gridId: gid, moduleId: psMod.id }, { parentId: 1 }).lean();
  if (!psOcc) throw new Error("Philosopher’s Stone page not found");
  const pageMods = new Map((await Module.find({ gridId: gid, role: "page", kind: "doc" }, { id: 1, label: 1 }).lean()).map((m) => [m.id, m]));
  const pages = (await Occurrence.find({ gridId: gid, parentId: psOcc.parentId }).lean()).filter((o) => pageMods.has(o.moduleId));

  for (const page of pages) {
    const pageLabel = page.label || pageMods.get(page.moduleId).label;
    let ptm; try { ptm = decompressTextmap(page.textmap); } catch { continue; }
    const nodes = ptm?.content || [];
    if (nodes[0]?.type === "moduleEmbed") { log(`${pageLabel}: already sections — skipped`); continue; }
    const tbNodes = nodes.filter((n) => n.type === "instanceTextblock" && n.attrs?.occurrenceId);
    const tbOccs = new Map((await Occurrence.find({ gridId: gid, id: { $in: tbNodes.map((n) => n.attrs.occurrenceId) } }).lean()).map((o) => [o.id, o]));
    const textblocks = tbNodes.map((n) => {
      const o = tbOccs.get(n.attrs.occurrenceId);
      let tm = null; try { tm = o?.textmap ? decompressTextmap(o.textmap) : null; } catch { /* unreadable */ }
      return { occId: n.attrs.occurrenceId, blocks: tm?.content || [] };
    }).filter((t) => tbOccs.has(t.occId));
    const embedIds = textblocks.flatMap((t) => t.blocks.filter((b) => b.type === "moduleEmbed").map((b) => b.attrs?.occurrenceId)).filter(Boolean);
    const imgOccs = new Map((await Occurrence.find({ gridId: gid, id: { $in: embedIds }, "meta.embeddedIn": { $exists: true } }, { id: 1, moduleId: 1, meta: 1 }).lean()).map((o) => [o.id, o]));
    const { root, dropped, edited, created } = buildTree({ pageLabel, textblocks, isImage: (id) => imgOccs.has(id) });

    // ── place the pictures ──
    const byModule = (occId) => { const m = imgOccs.get(occId)?.moduleId; return m === solNigerId ? SUNWHEEL_MODULE : m; };
    const wraps = new Map();          // textblock key → { side, nw, floats:[occId] }
    const splits = new Map();         // textblock key → { at, secondKey }
    const newBlocks = new Map(created.map((c) => [c.key, c.blocks]));
    const blocksOf = (key) => newBlocks.get(key) ?? edited.get(key) ?? textblocks.find((t) => t.occId === key)?.blocks ?? [];
    const keyOf = (c) => (c.kind === "tb" ? c.occId : c.key);
    const placed = [];
    const walkImgs = (ct) => { for (const c of [...ct.children]) { if (c.kind === "img") placed.push({ ct, c }); if (c.kind === "ct") walkImgs(c); } };
    walkImgs(root);
    let wrapped = 0, plain = 0;
    for (const { ct, c } of placed) {
      const plan = PLACEMENT[byModule(c.occId)];
      if (!plan) { plain++; continue; }                      // unplanned: stays where it was found
      const dest = findPath(root, plan.path);
      if (!dest) { plain++; log(`  ! ${pageLabel}: no section for ${plan.path.join(" › ")} — left in place`); continue; }
      ct.children.splice(ct.children.indexOf(c), 1);
      if (plan.top) { dest.children.unshift(c); plain++; continue; }
      if (plan.end) { dest.children.push(c); plain++; continue; }
      const tbIdx = dest.children.findIndex((x) => x.kind === "tb" || x.kind === "tbNew");
      if (tbIdx < 0) { dest.children.unshift(c); plain++; continue; }
      let hostKey = keyOf(dest.children[tbIdx]);
      if (plan.split != null) {
        let s = splits.get(hostKey);
        if (!s) {
          const all = blocksOf(hostKey);
          if (all.length > plan.split) {
            const secondKey = `new${created.length + splits.size + 1}x`;
            newBlocks.set(secondKey, all.slice(plan.split));
            if (newBlocks.has(hostKey)) newBlocks.set(hostKey, all.slice(0, plan.split)); else edited.set(hostKey, all.slice(0, plan.split));
            dest.children.splice(tbIdx + 1, 0, { kind: "tbNew", key: secondKey });
            s = { secondKey }; splits.set(hostKey, s);
          }
        }
        if (s && plan.part === 1) hostKey = s.secondKey;
      }
      const w = wraps.get(hostKey) || { side: plan.side || "right", nw: plan.nw || null, floats: [] };
      w.floats.push(c.occId); wraps.set(hostKey, w); wrapped++;
    }
    // drop the img children that became floats (they render inside the wrap)
    const floatIds = new Set([...wraps.values()].flatMap((w) => w.floats));

    // ── ids for everything new ──
    const userId = page.userId;
    const newMods = [], newOccs = [];
    const occIdOfKey = new Map();
    for (const key of newBlocks.keys()) {
      const modId = randomUUID(), occId = randomUUID();
      occIdOfKey.set(key, occId);
      newMods.push({ id: modId, userId, gridId: gid, role: "textblock", kind: "doc", label: "", fieldBindings: [], meta: {} });
      newOccs.push({ id: occId, userId, gridId: gid, moduleId: modId, parentId: null, occurrences: [], fields: {}, meta: {}, textmap: compressTextmap({ type: "doc", content: newBlocks.get(key) }) });
    }
    const tbUpdates = [];               // { id, parentId, blocks? }
    const imgUpdates = [];              // { id, embeddedIn }
    const writeCt = (ct, parentId) => {
      const modId = randomUUID(), occId = randomUUID();
      const content = [], listed = [];
      for (const c of ct.children) {
        if (c.kind === "img") {
          if (floatIds.has(c.occId)) continue;
          content.push({ type: "moduleEmbed", attrs: { occurrenceId: c.occId } });
          imgUpdates.push({ id: c.occId, embeddedIn: occId });
          continue;
        }
        if (c.kind === "ct") { const childId = writeCt(c, occId); content.push({ type: "moduleEmbed", attrs: { occurrenceId: childId } }); listed.push(childId); continue; }
        const key = keyOf(c);
        const tbOcc = c.kind === "tb" ? c.occId : occIdOfKey.get(key);
        listed.push(tbOcc);
        if (c.kind === "tb") tbUpdates.push({ id: tbOcc, parentId: occId, blocks: edited.get(key) });
        else newOccs.find((o) => o.id === tbOcc).parentId = occId;
        const w = wraps.get(key);
        const embed = { type: "moduleEmbed", attrs: { occurrenceId: tbOcc } };
        if (!w) { content.push(embed); continue; }
        for (const f of w.floats) imgUpdates.push({ id: f, embeddedIn: occId });
        content.push({ type: "wrapGroup", attrs: { side: w.side, anchor: "top", anchorIndex: 0, anchorOffset: null, neighborWidth: w.nw, wrap: true, floatCount: null },
          content: [...w.floats.map((f) => ({ type: "moduleEmbed", attrs: { occurrenceId: f } })), embed] });
      }
      content.push({ type: "paragraph" });
      newMods.push({ id: modId, userId, gridId: gid, role: "container", kind: "doc", label: ct.label, fieldBindings: [], meta: { allowChildContainers: true, headingLevel: ct.level } });
      newOccs.push({ id: occId, userId, gridId: gid, moduleId: modId, parentId, occurrences: listed, fields: {}, meta: {}, textmap: compressTextmap({ type: "doc", content }) });
      return occId;
    };
    const rootId = writeCt(root, page.id);

    const sections = newOccs.length - newBlocks.size;
    log(`${pageLabel}: ${textblocks.length} textblock(s) → ${sections} container(s), ${dropped.length} heading-only dropped, ${newBlocks.size} new textblock(s), ${wrapped} picture(s) wrapped, ${plain} plain`);
    if (dryRun) continue;

    await Module.insertMany(newMods);
    await Occurrence.insertMany(newOccs);
    for (const u of tbUpdates) {
      const $set = { parentId: u.parentId };
      if (u.blocks) $set.textmap = compressTextmap({ type: "doc", content: u.blocks });
      await Occurrence.updateOne({ gridId: gid, id: u.id }, { $set });
    }
    for (const u of imgUpdates) await Occurrence.updateOne({ gridId: gid, id: u.id }, { $set: { "meta.embeddedIn": u.embeddedIn } });
    for (const occId of dropped) {
      const o = tbOccs.get(occId);
      await Occurrence.deleteOne({ gridId: gid, id: occId });
      if (o?.moduleId && !(await Occurrence.exists({ gridId: gid, moduleId: o.moduleId }))) await Module.deleteOne({ gridId: gid, id: o.moduleId });
    }
    await Occurrence.updateOne({ gridId: gid, id: page.id }, { $set: {
      occurrences: [rootId],
      textmap: compressTextmap({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: rootId } }, { type: "paragraph" }] }),
    } });
  }
}
