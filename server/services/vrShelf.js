// What the VR office's bookshelf reads (client/public/vr). Pure: both
// functions take a user cache ({ modulesById, occurrencesById, foldersById })
// and return plain data, so they are tested without a database.
//
// shelfBooks: the grid's pages, newest first, as books (title, kind, cover).
// shelfBoard: one board's rows as books — a shelf is a query, and the query is
//   a board (Books, Albums, Movies…).
// A book is opened by the app (`/?open=<id>`), in its own page / file viewer —
// the headset cannot draw those viewers inside the 3D scene.

const BOOK_KINDS = new Set(["doc", "board", "canvas", "table"]);
const MAX_BOOKS = 60;
const FILE_KINDS = new Set(["pdf", "ebook"]);
const MAX_ROWS = 6000;

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

// A row's "files" field holds { value: [artifact occurrence ids], main }.
function filesOfRow(uc, occ) {
  const mod = moduleOf(uc, occ);
  const out = [];
  for (const b of mod?.fieldBindings || []) {
    if (b.role !== "files") continue;
    const cell = occ.fields?.[b.fieldId];
    const ids = Array.isArray(cell?.value) ? cell.value : [];
    if (cell?.main && ids.includes(cell.main)) out.push(cell.main);
    out.push(...ids);
  }
  return out;
}

// A shelf is a QUERY, and the query is a board: the shelf holds whatever rows
// the board holds (a feed board's rows are its feed). `board` is a container
// occurrence id, or a label — then the container of that label with the most
// rows. Each book opens the row's readable file (pdf / ebook) when it has one,
// else the row itself (its page).
export function findBoard(uc, board) {
  const occs = uc.occurrencesById || {};
  if (occs[board] && moduleOf(uc, occs[board])?.role === "container") return occs[board];
  const want = String(board || "").trim().toLowerCase();
  let best = null;
  for (const o of Object.values(occs)) {
    if (moduleOf(uc, o)?.role !== "container" || titleOf(uc, o).toLowerCase() !== want || underTemplates(uc, o)) continue;
    if (!best || (o.occurrences || []).length > (best.occurrences || []).length) best = o;
  }
  return best;
}

// A folder of that name (when no board has it): the pages filed in it and its
// subfolders, e.g. Documents › Notes.
// Several folders can share a name; the one whose tree holds the most pages wins.
function folderTree(uc, rootId) {
  const inTree = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(uc.foldersById || {})) if (f.parentId && inTree.has(f.parentId) && !inTree.has(f.id)) { inTree.add(f.id); grew = true; }
  }
  return inTree;
}
function pagesInFolder(uc, inTree) {
  const books = [];
  for (const occ of Object.values(uc.occurrencesById || {})) {
    const mod = moduleOf(uc, occ);
    if (!mod || mod.role !== "page" || !BOOK_KINDS.has(mod.kind) || !inTree.has(occ.parentId) || occ.hidden) continue;
    const title = titleOf(uc, occ);
    if (title) books.push({ id: occ.id, rowId: occ.id, title, opens: "row", cover: coverOf(uc, occ) });
  }
  return books;
}
function shelfFolder(uc, name, limit) {
  const want = String(name || "").trim().toLowerCase();
  let best = null;
  for (const f of Object.values(uc.foldersById || {})) {
    if ((f.name || "").trim().toLowerCase() !== want) continue;
    const books = pagesInFolder(uc, folderTree(uc, f.id));
    if (!best || books.length > best.books.length) best = { folder: f, books };
  }
  if (!best) return null;
  best.books.sort((a, b) => a.title.localeCompare(b.title));
  return { title: best.folder.name, folder: best.folder.id, books: best.books.slice(0, limit), total: best.books.length };
}

// The query names a board or a folder. When both exist under that name (a day
// page has a "Notes" section; Documents has a Notes folder) the one holding
// more wins.
export function shelfBoard(uc, board, { limit = MAX_ROWS } = {}) {
  const fromBoard = shelfFromBoard(uc, board, limit);
  const fromFolder = shelfFolder(uc, board, limit);
  if (fromBoard && fromFolder) return fromFolder.total > fromBoard.total ? fromFolder : fromBoard;
  return fromBoard || fromFolder;
}

function shelfFromBoard(uc, board, limit) {
  const container = findBoard(uc, board);
  if (!container) return null;
  const isBookFile = (id) => {
    const o = uc.occurrencesById?.[id];
    const m = moduleOf(uc, o);
    return !!(o && m?.role === "artifact" && FILE_KINDS.has(m.kind) && !m.trashed);
  };
  const rows = [];
  const seen = new Set();
  for (const id of container.occurrences || []) {
    const occ = uc.occurrencesById?.[id];
    const mod = moduleOf(uc, occ);
    if (!occ || !mod || mod.role === "container" || mod.role === "page" || occ.hidden) continue;
    const key = occ.meta?.feedSourceId || occ.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = titleOf(uc, occ) || mod.meta?.originalName || "";
    if (!title) continue;
    // A feed copy opens the occurrence it was copied from, not the copy.
    const source = (occ.meta?.feedSourceId && uc.occurrencesById?.[occ.meta.feedSourceId]) || occ;
    const fileId = mod.role === "artifact" ? null : filesOfRow(uc, source).find(isBookFile);
    rows.push({ id: fileId || source.id, rowId: source.id, title, opens: fileId ? "file" : (mod.role === "artifact" ? "file" : "row"), cover: coverOf(uc, occ) });
  }
  return { title: titleOf(uc, container), board: container.id, books: rows.slice(0, limit), total: rows.length };
}
