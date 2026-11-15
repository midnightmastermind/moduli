// 0501 — a Glossary doc page in the root folder: links to the main pages and folders, and quick links to the user's
// sites by category, each category with an "Open in browser" button and one above them all; plus a Glossary button in
// every panel's header that shows this page there (user, 2026-11-15: "make a root doc page, thats gonna be a glossary of
// links ... the links should be all minitextblocks ... a button above those quick links to open all in browser (custom
// button operation) ... a seperate button on the top for just opening that groups links" · "have a button for home
// (root) and a custom button for opening that page in the panels header (thats operation opens the root glossary").
//
// Shape (the importer's): page (doc) -> section containers (doc) -> one textblock each -> link chips (textblock/inline
// with meta.link), every level LISTED by its parent and EMBEDDED in its parent's textmap. A page link is
// meta.link = { kind: "occurrence", occId } (the chip opens it in its own panel, helpers/inAppLink); a site is
// { kind: "url", url }. The button field "Open in Browser" is bound on Quick Links and on each category; ONE operation
// listens to it and opens every url chip under the container it was pressed on (FIND _ancestors HAS_ANCESTOR, then
// OPEN_URLS). "Panel: Open Glossary" (UPDATE_VIEW $trigger.panelViewId) is listed in grid.meta.panelButtons.
import { randomUUID } from "node:crypto";
import { compressTextmap } from "../utils/textmapCompression.js";

export const id = "0501-root-glossary";
export const describe = "Glossary page in the root folder: page/folder links + quick links by category with Open-in-browser buttons; a Glossary button in every panel header. Deletes nothing.";
export const touches = ["modules", "occurrences", "fields", "operations", "folders", "grids"];

export const PAGE_LINKS = ["Schedule", "Day Page", "Routines", "Tasks", "Trackers"];
export const FOLDER_LINKS = ["Interfaces", "Boards", "Projects", "Documents", "Files", "Imports", "Templates", "Jonah"];
export const CATEGORIES = [
  { name: "Mail", links: [["Gmail", "https://mail.google.com"], ["Proton Mail", "https://mail.proton.me"]] },
  { name: "Google", links: [["Drive", "https://drive.google.com"], ["YouTube", "https://www.youtube.com"]] },
  { name: "Social", links: [["Facebook", "https://www.facebook.com"], ["Instagram", "https://www.instagram.com"], ["FetLife", "https://fetlife.com"]] },
  { name: "CPS", links: [] }, // the Zoom links, read off the CPS Class rows' notes (planGlossary's `cpsLinks`)
  { name: "Media", links: [["Jellyfin", "https://media.viafluere.com"], ["Radarr", "https://movie.viafluere.com"], ["Sonarr", "https://tv.viafluere.com"],
    ["Lidarr", "https://music.viafluere.com"], ["qBittorrent", "https://torrent.viafluere.com"], ["SABnzbd", "https://nzb.viafluere.com"], ["Eweka", "https://www.eweka.nl"]] },
  { name: "Web & dev", links: [["GitHub", "https://github.com"], ["DigitalOcean", "https://cloud.digitalocean.com"], ["MongoDB Atlas", "https://cloud.mongodb.com"],
    ["Cloudflare", "https://dash.cloudflare.com"], ["Dynadot", "https://www.dynadot.com/account"]] },
];
const BUTTON_FIELD = "Open in Browser";

let n = 0;
const sid = () => `gl${Date.now().toString(36)}${(n++).toString(36)}`;
const para = (content) => ({ type: "paragraph", content });

/**
 * Every record the page needs. Pure. `targets` = { pages: [{label, occId}], folders: [{label, occId}] } (the in-app
 * links, in order); `cpsLinks` = [[label, url]]; `ids` mints ids (injectable for tests).
 * @returns {{ modules, occurrences, pageOccId, sectionOccIds, buttonFieldId, ops, panelButton }}
 */
export function planGlossary({ userId, gridId, rootFolderId, targets, cpsLinks = [], buttonFieldId, mint = randomUUID }) {
  const modules = [], occurrences = [];
  const base = { userId, gridId };

  const chip = (parentTbId, label, link) => {
    const mid = mint(), oid = mint();
    modules.push({ ...base, id: mid, role: "textblock", kind: "inline", label, fieldBindings: [], meta: { link } });
    occurrences.push({ ...base, id: oid, moduleId: mid, parentId: parentTbId, occurrences: [], fields: {}, meta: { link },
      textmap: { type: "doc", content: [para([{ type: "text", text: label }])] } });
    return { type: "instanceTextblockInline", attrs: { occurrenceId: oid, instanceId: mid } };
  };
  // One textblock: an optional bold lead ("Pages: "), then chips separated by " · ".
  const linkBlock = (parentId, items, lead = null) => {
    const mid = mint(), oid = mint();
    const nodes = lead ? [{ type: "text", text: `${lead}: `, marks: [{ type: "bold" }] }] : [];
    const listed = [];
    for (const [i, it] of items.entries()) {
      if (i) nodes.push({ type: "text", text: " · " });
      const c = chip(oid, it.label, it.link);
      listed.push(c.attrs.occurrenceId);
      nodes.push(c);
    }
    modules.push({ ...base, id: mid, role: "textblock", kind: "doc", label: "", fieldBindings: [] });
    occurrences.push({ ...base, id: oid, moduleId: mid, parentId, occurrences: listed, fields: {},
      textmap: { type: "doc", content: [nodes.length ? para(nodes) : { type: "paragraph" }] } });
    return { occId: oid, node: { type: "instanceTextblock", attrs: { instanceId: mid, occurrenceId: oid } } };
  };
  const section = (parentId, label, { button = false, headingLevel = 2 } = {}) => {
    const mid = mint(), oid = mint();
    modules.push({ ...base, id: mid, role: "container", kind: "doc", label, meta: { headingLevel },
      fieldBindings: button ? [{ fieldId: buttonFieldId, role: "input", order: 0 }] : [] });
    const occ = { ...base, id: oid, moduleId: mid, parentId, occurrences: [], fields: {}, textmap: { type: "doc", content: [] } };
    occurrences.push(occ);
    return occ;
  };
  const embed = (host, childOccId, node) => {
    host.occurrences.push(childOccId);
    host.textmap.content.push(node || { type: "moduleEmbed", attrs: { occurrenceId: childOccId } });
  };

  // The page.
  const pageMid = mint(), pageOid = mint();
  modules.push({ ...base, id: pageMid, role: "page", kind: "doc", label: "Glossary", fieldBindings: [] });
  const page = { ...base, id: pageOid, moduleId: pageMid, parentId: rootFolderId, occurrences: [], fields: {}, textmap: { type: "doc", content: [] } };
  occurrences.push(page);

  // Places: the pages, then the folders.
  const places = section(pageOid, "Places");
  for (const [label, list] of [["Pages", targets.pages], ["Folders", targets.folders]]) {
    if (!list.length) continue;
    const tb = linkBlock(places.id, list.map((t) => ({ label: t.label, link: { kind: "occurrence", occId: t.occId } })), label);
    embed(places, tb.occId, tb.node);
  }
  embed(page, places.id);

  // Quick links: the Open-all button on this container, then a section per category with its own button.
  const quick = section(pageOid, "Quick Links", { button: true });
  const sectionOccIds = [quick.id];
  for (const cat of CATEGORIES) {
    const links = cat.name === "CPS" ? cpsLinks : cat.links;
    if (!links.length) continue;
    const s = section(quick.id, cat.name, { button: true, headingLevel: 3 });
    const tb = linkBlock(s.id, links.map(([label, url]) => ({ label, link: { kind: "url", url } })));
    embed(s, tb.occId, tb.node);
    embed(quick, s.id);
    sectionOccIds.push(s.id);
  }
  embed(page, quick.id);

  const act = (config) => ({ id: sid(), type: "action", config });
  const ops = [
    {
      name: "Glossary: Open Links",
      description: "An Open in Browser button: every web link under the container it was pressed on opens in a new tab.",
      steps: [
        act({ type: "FIND", over: "$allOccurrences", multiple: true, itemVar: "$links", predicate: { operator: "AND", rules: [
          { id: sid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$trigger.occurrenceId" },
          { id: sid(), left: "meta.link.kind", comparator: "IS", right: "url" },
        ] } }),
        act({ type: "OPEN_URLS", urls: "$links" }),
      ],
      trigger: { eventType: "onButton", subjectType: "field", targetId: buttonFieldId, priority: 5 },
    },
    {
      name: "Panel: Open Glossary",
      description: "The Glossary button in a panel's header: that panel shows the Glossary page.",
      steps: [act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: pageOid })],
      trigger: { eventType: "onButton", subjectType: "panel", priority: 5 },
    },
  ];
  return { modules, occurrences, pageOccId: pageOid, sectionOccIds, buttonFieldId, ops,
    panelButton: { id: "glossary", label: "Glossary", icon: "BookOpen" } };
}

const val = (c) => (c && typeof c === "object" && "value" in c ? c.value : c);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Folder, Grid, Manifest } = models;
  const gid = String(gridId);
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const manifest = await Manifest.findOne({ gridId: gid, rootFolderId: { $ne: null } }).lean();
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) { log("  REFUSED: no root folder"); return; }

  const existing = await Module.findOne({ gridId: gid, role: "page", kind: "doc", label: "Glossary" }).lean();
  if (existing && await Occurrence.exists({ gridId: gid, moduleId: existing.id, parentId: rootFolderId })) { log("  already there"); return; }

  // In-app targets, by name: each page's board placement, each root folder's folder-page card.
  const pages = [];
  for (const label of PAGE_LINKS) {
    const mods = await Module.find({ gridId: gid, role: "page", kind: "board", label }).select("id").lean();
    const occ = await Occurrence.findOne({ gridId: gid, moduleId: { $in: mods.map((m) => m.id) } }).sort({ createdAt: 1 }).select("id").lean();
    if (!occ) { log(`  REFUSED: no "${label}" page`); return; }
    pages.push({ label, occId: occ.id });
  }
  const rootChildren = await Folder.find({ gridId: gid, parentId: rootFolderId }).select("id name").lean();
  const folders = [];
  for (const label of FOLDER_LINKS) {
    const f = rootChildren.find((x) => x.name === label);
    if (!f) { log(`  skipped folder "${label}" (not under root)`); continue; }
    const cards = await Occurrence.find({ gridId: gid, parentId: f.id }).select("id moduleId").lean();
    const fpMods = new Set((await Module.find({ gridId: gid, id: { $in: cards.map((c) => c.moduleId) }, role: "page", kind: "folder" }).select("id").lean()).map((m) => m.id));
    const card = cards.find((c) => fpMods.has(c.moduleId));
    if (!card) { log(`  skipped folder "${label}" (no folder page)`); continue; }
    folders.push({ label, occId: card.id });
  }

  // The CPS Zoom links: the url chips under the CPS Class rows' notes, one per address.
  const classMods = await Module.find({ gridId: gid, label: "CPS Class" }).select("id").lean();
  const classRows = new Set((await Occurrence.find({ gridId: gid, moduleId: { $in: classMods.map((m) => m.id) } }).select("id").lean()).map((o) => o.id));
  const noteTbs = new Set((await Occurrence.find({ gridId: gid, parentId: { $in: [...classRows] } }).select("id").lean()).map((o) => o.id));
  const zoomChips = await Occurrence.find({ gridId: gid, parentId: { $in: [...noteTbs] }, "meta.link.kind": "url" }).select("moduleId meta.link").lean();
  const chipMods = new Map((await Module.find({ gridId: gid, id: { $in: zoomChips.map((c) => c.moduleId) } }).select("id label").lean()).map((m) => [m.id, m.label]));
  const cpsLinks = [];
  for (const c of zoomChips) {
    const url = c.meta.link.url;
    if (cpsLinks.some(([, u]) => u === url)) continue;
    cpsLinks.push([chipMods.get(c.moduleId) || `Zoom ${cpsLinks.length + 1}`, url]);
  }

  const btn = await Field.findOne({ gridId: gid, type: "button", name: BUTTON_FIELD }).lean();
  const buttonFieldId = btn?.id || randomUUID();
  const plan = planGlossary({ userId, gridId: gid, rootFolderId, targets: { pages, folders }, cpsLinks, buttonFieldId });
  log(`  page "Glossary" in the root folder · ${pages.length} page links · ${folders.length} folder links · ${cpsLinks.length} CPS links (${cpsLinks.map(([l]) => l).join(", ")})`);
  log(`  ${plan.sectionOccIds.length - 1} categories · ${plan.modules.length} modules · ${plan.occurrences.length} occurrences · field "${BUTTON_FIELD}" ${btn ? "reused" : "created"} · 2 operations · panel button "Glossary"`);
  if (dryRun) return;

  const now = new Date();
  if (!btn) await Field.create({ id: buttonFieldId, userId, gridId: gid, name: BUTTON_FIELD, type: "button", meta: { buttonLabel: "Open in browser" } });
  await Module.insertMany(plan.modules.map((m) => ({ ...m, createdAt: now, updatedAt: now })));
  await Occurrence.insertMany(plan.occurrences.map((o) => ({ ...o, textmap: o.textmap ? compressTextmap(o.textmap) : o.textmap, createdAt: now, updatedAt: now })));
  const opIds = [];
  for (const op of plan.ops) {
    const oid = randomUUID(); opIds.push(oid);
    await Operation.create({ id: oid, userId, gridId: gid, name: op.name, description: op.description, pipeline: { sources: [], steps: op.steps },
      triggerObjects: [op.trigger], triggerTypes: ["onButton"], triggerType: "onButton", enabled: true });
  }
  const panelButtons = (grid.meta?.panelButtons || []).filter((b) => b.id !== "glossary").concat([{ ...plan.panelButton, operationId: opIds[1] }]);
  await Grid.updateOne({ _id: gridId }, { $set: { "meta.panelButtons": panelButtons } });
  log("  applied. RESTART pm2.");
}
