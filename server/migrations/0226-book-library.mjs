// 0226 — the book library becomes Books and Authors boards, beside Music.
//
// User, 2026-08-24: *"just take all the books in the windows library and put
// them in a books section in moduli, similar to how we did music"* — and, on
// scope, all 665 works across both drives rather than one folder's worth.
//
// ── THE SOURCE IS A SURVEY, NOT A FOLDER SCAN ─────────────────────────────
//
// `screenshots/book-library.json` is the deduplicated output of the 2026-08-24
// reconciliation: 1,817 files across seven locations resolved to 665 distinct
// works by CONTENT HASH first and normalised title/author second. Importing the
// files directly would have produced 1,817 rows, of which 1,152 are byte-
// identical copies of another row — the same book listed up to fifteen times.
//
// ── `artifact`, NOT `instance` — THE MEASURED DECISION ────────────────────
//
// `0222` learned this the expensive way: 8,428 music rows as `instance` added
// +1,544ms to every grid load, because 42 of 66 enabled ops iterate
// `$allInstances`, which is role-filtered. As `artifact` they drop out of that
// slice entirely. 665 book rows are a fraction of that, and there is no reason
// to re-introduce the cost.
//
// ── ONE SHARED MODULE PER KIND ────────────────────────────────────────────
//
// A module per row would mint 665 modules whose only difference is a label,
// which is exactly what `0218` spent a pass collapsing. An occurrence label
// WINS over its module's in both the resolver and `ModuleInstance`, so one
// `Book` module and one `Author` module carry the bindings for every row.
//
// ── AUTHOR IS A BOARD, MIRRORING ARTIST ───────────────────────────────────
//
// "Similar to how we did music" is Artist -> Song. Here it is Author -> Book,
// so a click on an author gives you their shelf. 296 authors are known; **127
// works have no author anywhere** — not in the catalogue and not recoverable
// from the filename — and those get NO author link rather than a guessed one.
// A plausible author on a book you own is indistinguishable from one you set.
//
// ── WHAT IS NOT IMPORTED, AND WHY ─────────────────────────────────────────
//
// No file is copied, moved or attached. The row carries the PATHS to every
// copy, so the grid is a catalogue of what you have and where — the books stay
// where they are on disk. That is what "report first, nothing moved" bought.

import fs from "node:fs";
import path from "node:path";

export const id = "0226-book-library";
export const description = "Books and Authors boards in Boards/Media, filled from the 665-work library survey";

export const DATA_PATH = path.resolve(process.cwd(), "screenshots/book-library.json");
const BOOK_TAG = "book";
const AUTHOR_TAG = "bookAuthor";      // NOT "author" — `artist` already means a
                                      // music artist and a shared tag would put
                                      // musicians on the Authors board.
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Board Category options live in one of two places depending on the grid. */
export function readTagOptions(field) {
  const src = field?.meta?.optionsSource;
  if (Array.isArray(src?.values)) return { path: "meta.optionsSource.values", values: src.values };
  if (Array.isArray(field?.meta?.options)) return { path: "meta.options", values: field.meta.options };
  return { path: "meta.optionsSource.values", values: [] };
}

/** The authors worth minting a row for, and the works that link to each.
 *  PURE — the "no author means no link" rule is testable without a database. */
export function planAuthors(works) {
  const byAuthor = new Map();
  let unlinked = 0;
  for (const w of works || []) {
    const a = (w.author || "").trim();
    if (!a) { unlinked++; continue; }
    if (!byAuthor.has(a)) byAuthor.set(a, []);
    byAuthor.get(a).push(w.title);
  }
  return { authors: [...byAuthor.keys()].sort(), byAuthor, unlinked };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);

  if (!fs.existsSync(DATA_PATH)) { log(`no ${DATA_PATH} — nothing to import`); return { rows: 0 }; }
  const works = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const { authors, byAuthor, unlinked } = planAuthors(works);
  log(`survey: ${works.length} works · ${authors.length} authors · ${unlinked} with no author (no link, by design)`);

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  if (!tagField) { log("no Board Category field — this grid has no boards"); return { rows: 0 }; }

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));
  const tagOf = (o) => { const v = o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };

  // ── the exemplar: mirror a real board rather than restate its shape ──────
  const exContainer = occs.find((o) => tagOf(o).includes("song") && o.feed?.enabled);
  if (!exContainer) { log("no Songs board to copy — refusing to invent a board shape"); return { rows: 0 }; }
  const exPage = occs.find((o) => (o.occurrences || []).includes(exContainer.id));
  if (!exPage) { log("the Songs container is listed by nobody — repair that first"); return { rows: 0 }; }
  const exPageMod = modById.get(exPage.moduleId), exContMod = modById.get(exContainer.moduleId);
  // Books belong with Music and Bookmarks: `0224` put Media under Boards.
  const home = exPage.parentId;
  log(`exemplar: page "${exPageMod?.label}" in folder ${home}`);

  const haveBook = occs.some((o) => tagOf(o).includes(BOOK_TAG) && o.feed?.enabled);
  const haveAuth = occs.some((o) => tagOf(o).includes(AUTHOR_TAG) && o.feed?.enabled);
  const { path: tagPath, values: tagValues } = readTagOptions(tagField);
  const haveTag = new Set(tagValues.map((v) => (v && typeof v === "object" ? v.value : v)));
  const needTags = [BOOK_TAG, AUTHOR_TAG].filter((t) => !haveTag.has(t));

  const wantFields = [
    ["Author", "occurrence"], ["Formats", "text"], ["ISBN", "text"],
    ["Series", "text"], ["File Path", "text"], ["Copies", "number"],
  ];
  const existingFields = {};
  const needFields = [];
  for (const [name, type] of wantFields) {
    const f = await Field.findOne({ gridId: gid, name }).lean();
    if (f) existingFields[name] = f; else needFields.push([name, type]);
  }

  log(`tags to add   : ${needTags.join(", ") || "(none)"}`);
  log(`boards to mint: ${[!haveBook && "Books", !haveAuth && "Authors"].filter(Boolean).join(", ") || "(none)"}`);
  log(`fields to mint: ${needFields.map((f) => f[0]).join(", ") || "(none)"}`);
  const already = occs.filter((o) => o.meta?.bookWorkKey).length;
  log(`rows: ${works.length} works + ${authors.length} authors · already imported: ${already}`);
  if (dryRun) return { rows: works.length + authors.length, authors: authors.length, existing: already };
  if (already >= works.length) { log("already imported — nothing to do"); return { rows: 0 }; }

  // ── tags ────────────────────────────────────────────────────────────────
  if (needTags.length) {
    const objectStyle = tagValues.some((v) => v && typeof v === "object");
    await Field.updateOne({ id: tagField.id, gridId: gid }, { $set: { [tagPath]:
      [...tagValues, ...needTags.map((t) => (objectStyle ? { value: t, label: t } : t))] } });
  }

  // ── fields ──────────────────────────────────────────────────────────────
  const F = { ...existingFields };
  for (const [name, type] of needFields) {
    const fid = uid();
    const meta = type === "occurrence"
      // scoped to the Authors board the same way Artist is scoped to Artists
      ? { optionsSource: { mode: "find", collection: "$allInstances", conditions: [
            { fieldId: tagField.id, comparator: "CONTAINS", value: AUTHOR_TAG },
            { path: "meta.feedSourceId", comparator: "IS_EMPTY" }] } }
      : {};
    await Field.create({ id: fid, userId: exPage.userId, gridId: gid, name, type,
      role: "input", inputEnabled: true, meta });
    F[name] = { id: fid, name, type };
    log(`  minted field "${name}" [${type}]`);
  }

  // ── the two boards ──────────────────────────────────────────────────────
  const boards = {};
  for (const [tag, label, want] of [[BOOK_TAG, "Books", !haveBook], [AUTHOR_TAG, "Authors", !haveAuth]]) {
    if (!want) {
      const c = occs.find((o) => tagOf(o).includes(tag) && o.feed?.enabled);
      boards[tag] = c.id; continue;
    }
    const pm = uid(), po = uid(), cm = uid(), co = uid();
    await Module.create({ id: pm, userId: exPageMod.userId, gridId: gid, label,
      role: exPageMod.role, kind: exPageMod.kind, fieldBindings: [], meta: { ...(exPageMod.meta || {}) } });
    await Module.create({ id: cm, userId: exContMod.userId, gridId: gid, label,
      role: exContMod.role, kind: exContMod.kind, fieldBindings: [], meta: { ...(exContMod.meta || {}) } });
    // The CONTAINER carries the tag and the feed and keeps parentId null; the
    // PAGE is what the folder homes and what LISTS it. `0158` inverted this and
    // shipped a board that held its data and could not be opened.
    await Occurrence.create({ id: co, userId: exContainer.userId, gridId: gid, moduleId: cm,
      parentId: null, occurrences: [], fields: { [tagField.id]: { value: [tag], flow: "in" } },
      feed: { enabled: true, conditions: [{ fieldId: tagField.id, comparator: "CONTAINS", value: tag }],
              roles: ["instance"], sort: null, limit: 5000 }, meta: {}, filterOverride: {} });
    await Occurrence.create({ id: po, userId: exPage.userId, gridId: gid, moduleId: pm,
      parentId: home, occurrences: [co], fields: {}, meta: {}, filterOverride: null });
    boards[tag] = co;
    log(`  minted board "${label}" (page ${po} -> container ${co})`);
  }

  // ── shared row modules, ARTIFACT role (see the header) ──────────────────
  const bind = (f) => (f ? [{ fieldId: f.id }] : []);
  const shared = async (label, kind, bindings) => {
    const found = await Module.findOne({ gridId: gid, label, "meta.bookRow": true }).lean();
    if (found) return found.id;
    const mid = uid();
    await Module.create({ id: mid, userId: exPage.userId, gridId: gid, label, role: "artifact",
      kind, fieldBindings: bindings, meta: { bookRow: true } });
    return mid;
  };
  const bookMod = await shared("Book", "book", [
    ...bind(F["Author"]), ...bind(F["Formats"]), ...bind(F["ISBN"]),
    ...bind(F["Series"]), ...bind(F["File Path"]), ...bind(F["Copies"]),
    { fieldId: tagField.id }]);
  const authorMod = await shared("Author", "bookAuthor", [{ fieldId: tagField.id }]);

  // ── authors first: a book links to a row that must already exist ───────
  const authorId = new Map();
  const authorDocs = authors.map((name) => {
    const oid = uid();
    authorId.set(name, oid);
    return { id: oid, userId: exPage.userId, gridId: gid, moduleId: authorMod,
      parentId: boards[AUTHOR_TAG], occurrences: [], label: name,
      fields: { [tagField.id]: { value: [AUTHOR_TAG], flow: "in" } },
      meta: { bookAuthorKey: name, bookWorks: byAuthor.get(name).length }, filterOverride: {} };
  });
  const bookDocs = works.map((w) => {
    const f = { [tagField.id]: { value: [BOOK_TAG], flow: "in" } };
    const aid = w.author && authorId.get(w.author);
    if (aid && F["Author"]) f[F["Author"].id] = { value: aid, flow: "in" };
    if (F["Formats"]) f[F["Formats"].id] = { value: (w.formats || []).join(", "), flow: "in" };
    if (F["ISBN"] && w.isbn) f[F["ISBN"].id] = { value: w.isbn, flow: "in" };
    if (F["Series"] && w.series) f[F["Series"].id] = { value: w.series, flow: "in" };
    if (F["File Path"]) f[F["File Path"].id] = { value: w.best_copy, flow: "in" };
    if (F["Copies"]) f[F["Copies"].id] = { value: w.copies, flow: "in" };
    return { id: uid(), userId: exPage.userId, gridId: gid, moduleId: bookMod,
      parentId: boards[BOOK_TAG], occurrences: [], label: w.title, fields: f,
      meta: { bookWorkKey: `${w.author}|${w.title}`, bookPaths: w.paths,
              bookLibraries: w.libraries, bookBytes: w.size_bytes,
              bookMetadataSource: w.metadata_source }, filterOverride: {} };
  });

  const CHUNK = 400;
  for (const [docs, boardId, what] of [[authorDocs, boards[AUTHOR_TAG], "authors"], [bookDocs, boards[BOOK_TAG], "books"]]) {
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      await Occurrence.insertMany(slice, { ordered: false });
      // $push $each rather than writing the array whole: a connected client
      // echoes a stale `occurrences[]` back over a whole-array write, which is
      // the 2026-08-13 (2) clobber that cost a session.
      await Occurrence.updateOne({ id: boardId, gridId: gid },
        { $push: { occurrences: { $each: slice.map((d) => d.id) } } });
    }
    log(`  inserted ${docs.length} ${what}`);
  }
  log(`done: ${bookDocs.length} books · ${authorDocs.length} authors · ${unlinked} books with no author link`);
  return { rows: bookDocs.length + authorDocs.length, books: bookDocs.length, authors: authorDocs.length };
}
