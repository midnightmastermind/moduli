// What the VR office's bookshelf reads (client/public/vr). Pure: both
// functions take a user cache ({ modulesById, occurrencesById, foldersById })
// and return plain data, so they are tested without a database.
//
// shelfBooks: the grid's pages, newest first, as books (title, kind, cover).
// pageReadable: one page flattened into blocks a headset can lay out as text:
//   { title, blocks: [{ type: "heading" | "text" | "item", text, level? }] }
// It walks what the page SHOWS — its own textmap, the sections it embeds and
// the rows those sections list — and stops at MAX_BLOCKS, saying so.

const BOOK_KINDS = new Set(["doc", "board", "canvas", "table"]);
const MAX_BOOKS = 60;
const MAX_BLOCKS = 600;
const MAX_DEPTH = 6;

const moduleOf = (uc, occ) => uc.modulesById?.[occ?.moduleId || occ?.targetId] || null;
const titleOf = (uc, occ) => (occ?.label || moduleOf(uc, occ)?.label || "").trim();

function underTemplates(uc, occ) {
  let id = occ?.parentId, n = 0;
  while (id && n++ < 20) {
    const f = uc.foldersById?.[id];
    if (f) {
      if (/^templates$/i.test(f.name || "") && f.meta?.protected) return true;
      id = f.parentId;
      continue;
    }
    const p = uc.occurrencesById?.[id];
    if (!p) return false;
    id = p.parentId;
  }
  return false;
}

function coverOf(uc, occ) {
  const c = occ?.meta?.cover || moduleOf(uc, occ)?.meta?.cover;
  if (typeof c === "string" && /^(https?:\/\/|\/uploads\/)/.test(c)) return c;
  if (c && typeof c === "object" && typeof c.url === "string") return c.url;
  return null;
}

export function shelfBooks(uc, { limit = MAX_BOOKS } = {}) {
  const books = [];
  for (const occ of Object.values(uc.occurrencesById || {})) {
    const mod = moduleOf(uc, occ);
    if (!mod || mod.role !== "page" || !BOOK_KINDS.has(mod.kind)) continue;
    if (mod.trashed || occ.hidden) continue;
    const title = titleOf(uc, occ);
    if (!title || underTemplates(uc, occ)) continue;
    books.push({
      id: occ.id,
      title,
      kind: mod.kind,
      cover: coverOf(uc, occ),
      updatedAt: occ.updatedAt || mod.updatedAt || null,
    });
  }
  books.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return { books: books.slice(0, limit), total: books.length };
}

// Inline text of a TipTap node: text runs plus the labels of inline chips.
function inlineText(uc, node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (/^instance(Pill|TextblockInline)$/.test(node.type || "")) {
    const o = uc.occurrencesById?.[node.attrs?.occurrenceId || node.attrs?.instanceId];
    if (o?.textmap) return blockText(uc, o.textmap);
    return titleOf(uc, o) || node.attrs?.instanceLabel || "";
  }
  if (node.type === "fieldPill") return node.attrs?.label || "";
  return (node.content || []).map((c) => inlineText(uc, c)).join("");
}
function blockText(uc, doc) {
  return (doc?.content || []).map((n) => inlineText(uc, n)).join(" ").replace(/\s+/g, " ").trim();
}

export function pageReadable(uc, occId) {
  const page = uc.occurrencesById?.[occId];
  if (!page) return null;
  const blocks = [];
  const seen = new Set();
  let truncated = false;
  const push = (b) => {
    if (blocks.length >= MAX_BLOCKS) { truncated = true; return false; }
    if (b.text && b.text.trim()) blocks.push({ ...b, text: b.text.trim() });
    return true;
  };

  function walkDoc(doc, depth) {
    for (const node of doc?.content || []) {
      if (truncated) return;
      walkNode(node, depth);
    }
  }
  function walkNode(node, depth) {
    switch (node.type) {
      case "heading": push({ type: "heading", level: Math.min(3, node.attrs?.level || 2), text: inlineText(uc, node) }); break;
      case "paragraph": push({ type: "text", text: inlineText(uc, node) }); break;
      case "bulletList": case "orderedList":
        for (const li of node.content || []) push({ type: "item", text: (li.content || []).map((c) => inlineText(uc, c)).join(" ") });
        break;
      case "blockquote": push({ type: "text", text: "“" + blockText(uc, node) + "”" }); break;
      case "codeBlock": push({ type: "text", text: inlineText(uc, node) }); break;
      case "table":
        for (const row of node.content || []) push({ type: "item", text: (row.content || []).map((c) => blockText(uc, c)).join(" | ") });
        break;
      case "moduleEmbed": case "instanceTextblock":
        walkOcc(uc.occurrencesById?.[node.attrs?.occurrenceId], depth + 1);
        break;
      case "wrapGroup":
        walkDoc(node, depth);
        break;
      default:
        if (node.content) walkDoc(node, depth);
    }
  }
  function walkOcc(occ, depth) {
    if (!occ || seen.has(occ.id) || depth > MAX_DEPTH || truncated) return;
    seen.add(occ.id);
    const mod = moduleOf(uc, occ);
    const role = mod?.role;
    if (role === "container" || role === "page") {
      if (depth > 0) push({ type: "heading", level: Math.min(3, 1 + depth), text: titleOf(uc, occ) });
      if (occ.textmap?.content?.length && (mod?.kind === "doc" || role === "page")) walkDoc(occ.textmap, depth);
      for (const cid of occ.occurrences || []) walkOcc(uc.occurrencesById?.[cid], depth + 1);
    } else if (role === "textblock" || (occ.textmap?.content?.length && role !== "artifact")) {
      walkDoc(occ.textmap, depth);
    } else if (role === "artifact") {
      push({ type: "item", text: "[" + (mod?.kind || "file") + "] " + (titleOf(uc, occ) || mod?.meta?.originalName || "") });
    } else {
      push({ type: "item", text: titleOf(uc, occ) });
    }
  }

  walkOcc(page, 0);
  return { id: occId, title: titleOf(uc, page), blocks, truncated };
}
