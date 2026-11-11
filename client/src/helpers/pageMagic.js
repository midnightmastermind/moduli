// helpers/pageMagic.js — "Magic" on a doc page: its plain textblocks become sections and blocks, in place.
//
// User, 2026-10-24: "a magic button on top of pages so we can use our import on raw textblocks" — chosen: replace in
// place, one undo step brings the plain text back. Each textblock is turned into markdown (helpers/exportMarkdown),
// laid out by the importer WITHOUT writing (`import_plan`, shape "magic" — the same layout a book's Magic view and an
// import make), then created here (helpers/plannedDrop) where the textblock was, and the textblock is deleted — all
// inside ONE action, so a single undo puts the page back. Other blocks (pictures, containers, tables) stay put.
//
// 2026-11-11 (user: "its stuck that way and i cant magic it again"): a page made from a link's Reader view ("+ Page")
// is page -> doc container -> ONE textblock holding the whole article, so a scan of the page's top level found no
// textblock and Magic answered "no plain text blocks". The doc containers placed directly on the page are scanned
// too (one level: a section Magic made holds textblocks of its own, and those must not be re-planned on a second
// click). And the planner wraps its sections in one "Imported" container; that wrapper is dropped — its sections
// go where the textblock was, so Magic adds structure, not a level.

import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { tiptapToMarkdown } from "./exportMarkdown";
import { readerStateFromPlan } from "./readerPlan";
import { planMaterialize } from "./plannedDrop";
import { docEmbedNode } from "./docEmbedAppend";

/** A host's own top-level textblocks that hold text, as { index, occurrenceId, occurrence, markdown }. Pure. */
export function pageTextblocks(hostOcc, { occurrencesById, modulesById }) {
  const content = hostOcc?.textmap?.content || [];
  const out = [];
  content.forEach((node, index) => {
    const id = node?.attrs?.occurrenceId;
    if (!id || !(node.type === "instanceTextblock" || node.type === "moduleEmbed")) return;
    const occ = occurrencesById?.[id];
    const mod = occ && modulesById?.[occ.moduleId];
    if (!occ || mod?.role !== "textblock") return;
    const markdown = occ.textmap ? tiptapToMarkdown(occ.textmap).trim() : "";
    if (markdown) out.push({ index, occurrenceId: id, occurrence: occ, markdown });
  });
  return out;
}

/** Every host Magic works on: the page, then each doc container embedded directly on it. Only hosts holding at
 *  least one plain textblock are returned. Pure. */
export function magicHosts(pageOcc, maps) {
  const hosts = [];
  const own = pageTextblocks(pageOcc, maps);
  if (own.length) hosts.push({ host: pageOcc, items: own });
  for (const node of pageOcc?.textmap?.content || []) {
    const id = node?.type === "moduleEmbed" ? node.attrs?.occurrenceId : null;
    const occ = id && maps.occurrencesById?.[id];
    const mod = occ && maps.modulesById?.[occ.moduleId];
    if (!occ || mod?.role !== "container" || mod?.kind !== "doc") continue;
    const items = pageTextblocks(occ, maps);
    if (items.length) hosts.push({ host: occ, items });
  }
  return hosts;
}

/** The planned tree as rows to create under `hostId`, with the planner's root wrapper dropped when it is a plain doc
 *  container: its embeds are what replaces the textblock, and its children are parented to the host. Pure. */
export function placePlan({ tree, hostId, gridId, userId }) {
  const plan = planMaterialize({ rootId: tree.rootOccurrenceId, state: tree.state, gridId, userId, parentId: hostId });
  if (!plan?.rootId) return null;
  const root = plan.occurrences.find((o) => o.id === plan.rootId);
  const rootModule = plan.modules.find((m) => m.id === plan.rootModuleId);
  const unwrap = rootModule?.role === "container" && rootModule?.kind === "doc" && (root?.textmap?.content || []).length > 0;
  if (!unwrap) {
    return { nodes: [docEmbedNode({ moduleId: plan.rootModuleId, occurrenceId: plan.rootId, role: rootModule?.role })], children: [plan.rootId], modules: plan.modules, occurrences: plan.occurrences };
  }
  const children = root.occurrences || [];
  const kids = new Set(children);
  const occurrences = plan.occurrences.filter((o) => o.id !== root.id).map((o) => (kids.has(o.id) ? { ...o, parentId: hostId } : o));
  const modules = plan.modules.filter((m) => m.id !== rootModule.id || occurrences.some((o) => o.moduleId === m.id));
  return { nodes: root.textmap.content, children, modules, occurrences };
}

function planOne(socket, gridId, markdown) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 30000);
    socket.emit("import_plan", { content: markdown, format: "markdown", gridId, shape: "magic", title: "" }, (res) => {
      if (done) return; done = true; clearTimeout(t); resolve(res?.ok ? res : null);
    });
  });
}

/**
 * Run Magic on `pageOcc`. Resolves to { ok, converted, error? }. `maps` = { occurrencesById, modulesById } read at
 * call time.
 */
export async function runPageMagic({ pageOcc, maps, socket, dispatch, gridId, userId }) {
  if (!pageOcc?.id || !socket || !gridId || !userId) return { ok: false, converted: 0, error: "not ready" };
  const hosts = magicHosts(pageOcc, maps);
  if (!hosts.length) return { ok: false, converted: 0, error: "no plain text blocks on this page" };
  const plans = await Promise.all(hosts.map(({ items }) => Promise.all(items.map((it) => planOne(socket, gridId, it.markdown)))));
  let converted = 0;
  withAction("Magic", () => {
    hosts.forEach(({ host, items }, h) => {
      const replaced = new Map();
      const added = [];
      const removed = new Set();
      items.forEach((it, i) => {
        const tree = readerStateFromPlan(plans[h][i]);
        const placed = tree && placePlan({ tree, hostId: host.id, gridId, userId });
        if (!placed) return;
        for (const m of placed.modules) CommitHelpers.createModule({ dispatch, socket, module: m, emit: true });
        for (const o of placed.occurrences) CommitHelpers.createOccurrence({ dispatch, socket, occurrence: o, emit: true, fireTrigger: false });
        replaced.set(it.index, placed.nodes);
        added.push(...placed.children);
        removed.add(it.occurrenceId);
        converted++;
      });
      if (!removed.size) return;
      const content = (host.textmap?.content || []).flatMap((node, index) => replaced.get(index) || [node]);
      const occurrences = [...(host.occurrences || []).filter((id) => !removed.has(id)), ...added];
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...host, textmap: { ...(host.textmap || { type: "doc" }), content }, occurrences } });
      for (const it of items) {
        if (!removed.has(it.occurrenceId)) continue;
        CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: it.occurrenceId, occurrence: it.occurrence, fromParentId: host.id });
      }
    });
  });
  return converted ? { ok: true, converted } : { ok: false, converted: 0, error: "the importer did not answer" };
}
