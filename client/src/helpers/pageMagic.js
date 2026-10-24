// helpers/pageMagic.js — "Magic" on a doc page: its plain textblocks become sections and blocks, in place.
//
// User, 2026-10-24: "a magic button on top of pages so we can use our import on raw textblocks" — chosen: replace in
// place, one undo step brings the plain text back. Each textblock the page draws is turned into markdown
// (helpers/exportMarkdown), laid out by the importer WITHOUT writing (`import_plan`, shape "magic" — the same layout
// a book's Magic view and an import make), then created here (helpers/plannedDrop) where the textblock was, and the
// textblock is deleted — all inside ONE action, so a single undo puts the page back. Other blocks (pictures,
// containers, tables) are left exactly where they are.
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { tiptapToMarkdown } from "./exportMarkdown";
import { readerStateFromPlan } from "./readerPlan";
import { materializePlanned } from "./plannedDrop";
import { docEmbedNode } from "./docEmbedAppend";

/** The page's top-level textblocks, as { index, occurrenceId, occurrence, markdown }. Pure. */
export function pageTextblocks(pageOcc, { occurrencesById, modulesById }) {
  const content = pageOcc?.textmap?.content || [];
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
  const items = pageTextblocks(pageOcc, maps);
  if (!items.length) return { ok: false, converted: 0, error: "no plain text blocks on this page" };
  const plans = await Promise.all(items.map((it) => planOne(socket, gridId, it.markdown)));
  let converted = 0;
  withAction("Magic", () => {
    const content = [...(pageOcc.textmap?.content || [])];
    const added = [];
    const removed = new Set();
    items.forEach((it, i) => {
      const tree = readerStateFromPlan(plans[i]);
      if (!tree) return;
      const made = materializePlanned({ rootId: tree.rootOccurrenceId, state: tree.state, gridId, userId, parentId: pageOcc.id, dispatch, socket });
      if (!made?.rootId) return;
      const rootModule = made.modules.find((m) => m.id === made.rootModuleId);
      content[it.index] = docEmbedNode({ moduleId: made.rootModuleId, occurrenceId: made.rootId, role: rootModule?.role });
      added.push(made.rootId);
      removed.add(it.occurrenceId);
      converted++;
    });
    if (!converted) return;
    const occurrences = [...(pageOcc.occurrences || []).filter((id) => !removed.has(id)), ...added];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...pageOcc, textmap: { ...(pageOcc.textmap || { type: "doc" }), content }, occurrences } });
    for (const it of items) {
      if (!removed.has(it.occurrenceId)) continue;
      CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: it.occurrenceId, occurrence: it.occurrence, fromParentId: pageOcc.id });
    }
  });
  return converted ? { ok: true, converted } : { ok: false, converted: 0, error: "the importer did not answer" };
}
