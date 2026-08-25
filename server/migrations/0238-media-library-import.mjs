// 0238 — media.md becomes boards: Movies, TV Series, Documentaries, Games, Comics.
//
// User, 2026-08-25: *"use the ~/media.md file to fill in the remaining medias"*,
// then, choosing scope: *"Movies + TV series, Documentaries, Music (local
// artists), Games, and any books and comics that we overlooked"* and *"mark a
// field called owned thats set to true if i own the movie"*.
//
// ── THE SOURCE IS A SIX-DRIVE SURVEY, PARSED BY HEADER SIGNATURE ───────────
//
// `server/scripts/parseMediaMd.mjs` reads media.md into
// `data/media-library.json`. It keys on TABLE HEADER SIGNATURES rather than
// section position, because the document is prose with analysis tables in it —
// a cross-drive overlap comparison whose first column is also called "Film", a
// hash table, per-topic counts. Walking "every table under ## Movies" would
// import the overlap analysis as three more films. Its counts match the
// document's own stated totals exactly: 994 movies, 192 series, 147 music
// artists, 4 games, 1,849 documentary files.
//
// ── THE DEDUPE IS THE WHOLE RISK, AND A NAIVE ONE WOULD HAVE DOUBLED A BOARD
//
// My first overlap probe reported **44** of media.md's books already on the
// grid, i.e. 654 new. That was a FALSE NEGATIVE and importing on it would have
// minted ~442 duplicates onto a board that already holds a clean catalogue.
// media.md's book titles are TRUNCATED to ~34 characters and carry a trailing
// `(NNN)` file count:
//
//     grid  "Watchmen"                        media.md  "Watchmen (217)"
//     grid  "Nature, Man and Woman"           media.md  "Nature, Man and Woman (155)"
//     grid  "Become What You Are: Expanded Edition"
//     media.md  "Become What You Are_ Expanded Editi (152)"     <- a PREFIX
//
// So the match strips the count and accepts a PREFIX when the media.md title is
// at the truncation length. Re-measured: **227 exact + 237 prefix = 464 already
// present, 212 genuinely new.** A count is a claim about the normaliser until
// the two sides have been read side by side.
//
// ── WHAT GETS A BOARD, AND WHAT MERGES INTO ONE THAT EXISTS ───────────────
//
//   movie  series  documentary  game  comic   -> NEW boards (no home today)
//   book                                      -> merges into Books   (0226, 666 rows)
//   musicArtist                               -> merges into Artists (0222, 1,595)
//   musicAlbum                                -> merges into Albums  (0222, 2,757)
//
// Minting a second Books board beside the Calibre one would split one library
// in two. The music halves are the same call: these are the local FLAC rips,
// the same artists Spotify already knows.
//
// ── `artifact`, NOT `instance` — THE MEASURED DECISION, INHERITED ─────────
//
// `0222` learned this the expensive way: 8,428 music rows as `instance` added
// +1,544ms to every grid load, because 42 of 66 enabled ops iterate
// `$allInstances`, which is role-filtered. As `artifact` they leave that slice
// entirely. This adds ~4,000 rows; the reason applies with more force, not less.
//
// ── ONE SHARED MODULE PER KIND ────────────────────────────────────────────
//
// A module per row would mint 4,000 modules whose only difference is a label —
// what `0218` spent a pass collapsing. An occurrence label WINS over its
// module's, so one `Movie` module carries the bindings for every movie.
//
// ── `Owned` IS MEASURED PER KIND, NEVER GUESSED ──────────────────────────
//
// Movies, series and comics carry a Status column, so their Owned comes from
// the document (750/994 movies, 108/192 series, 5/5 comics — the "not owned"
// rows are a want-list media.md keeps deliberately). Documentaries, games,
// music and books have no Status column because they are FILE LISTINGS: the row
// exists because the file is on a disk. `owned: true` there is a reading of the
// source, not an assumption about it.
//
// ── THREE FIELDS MINTED, THREE REUSED ─────────────────────────────────────
//
// Minted: `Owned` (boolean, the user's ask), `Drive`, `Size`.
// Reused:  `File Path`, `Formats` (0226) and `Episodes` — all three already
// exist and already render. **`Files` and `Location` are NOT reused despite the
// names**: both are `occurrence` fields (a media attachment and the Places
// board), so writing a file count or a disk path into them would store a string
// where a row reference belongs — the key's NAME is not evidence about its VALUE.
// Everything else the survey carries (topic folder, byte size, episode counts on
// short-form tables) rides in `meta`, which mints nothing that cannot render.
//
// ── NOTHING IS COPIED OR MOVED ────────────────────────────────────────────
//
// No file is touched. A row carries the drive and the path, so the grid is a
// catalogue of what you have and where; the media stays where it is on disk.

import fs from "node:fs";
import path from "node:path";

export const id = "0238-media-library-import";
export const description = "Movies, TV Series, Documentaries, Games and Comics boards from media.md; books and music merged into the boards that already hold them";
// The scoped pre-migration snapshot: this writes rows, board occurrences, the
// three new fields and the Board Category option list. It never touches
// operations, folders, views or manifests.
export const touches = ["fields", "occurrences", "modules"];

export const DATA_PATH = path.resolve(process.cwd(), "server/migrations/data/media-library.json");

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** kind -> { tag, board label, module label, existing? } */
export const KINDS = Object.freeze({
  movie:       { tag: "movie",       board: "Movies",        row: "Movie" },
  series:      { tag: "series",      board: "TV Series",     row: "TV Series" },
  documentary: { tag: "documentary", board: "Documentaries", row: "Documentary" },
  game:        { tag: "game",        board: "Games",         row: "Game" },
  comic:       { tag: "comic",       board: "Comics",        row: "Comic" },
  book:        { tag: "book",        board: "Books",         row: "Book",   merge: true },
  musicArtist: { tag: "artist",      board: "Artists",       row: "Artist", merge: true },
  musicAlbum:  { tag: "album",       board: "Albums",        row: "Album",  merge: true },
});

/** Board Category options live in one of two places depending on the grid. */
export function readTagOptions(field) {
  const src = field?.meta?.optionsSource;
  if (Array.isArray(src?.values)) return { path: "meta.optionsSource.values", values: src.values };
  if (Array.isArray(field?.meta?.options)) return { path: "meta.options", values: field.meta.options };
  return { path: "meta.optionsSource.values", values: [] };
}

// A TRAILING PARENTHETICAL MEANS TWO DIFFERENT THINGS, and the label and the
// match key need different answers. Measured on both sides:
//
//   media.md albums ending in a (YYYY)   298 of 299     grid albums   0 of 2,757
//   media.md books  ending in a (N)      869 of 1,108   grid books    0 of 666
//   media.md movies ending in a (YYYY)   865 of 994     grid movies   none exist
//
// THE LABEL: user, 2026-08-25 — *"dont put the year in the title in our
// system"*. So the suffix comes off every title, which also matches what the
// Books and Albums boards already look like (0 of 666 and 0 of 2,757 carry one).
//
// THE MATCH KEY: for FILMS AND SERIES the year is IDENTITY — "The Ring (2002)"
// and "The Ring (1927)" are two films, and matching on the bare title would
// merge every remake into its original. For BOOKS and ALBUMS it is the local
// library's folder annotation (a file count, or the year the ripper wrote into
// the directory name), and stripping it is what lets "Ballbreaker (1995)" find
// Spotify's "Ballbreaker" (28 albums) and "Watchmen (217)" find the Calibre one.
//
// THE YEAR IS NOT DISCARDED — it moves to a `Year` field, which is where it can
// be read and sorted on. Taking it out of the title is a presentation decision;
// deleting it from 1,163 rows would be a different one nobody asked for.
const IDENTITY_YEAR = new Set(["movie", "series"]);
/** The kinds whose row module binds `Year`, and therefore the only ones a Year
 *  value may be written to. */
export const BINDS_YEAR = new Set(["movie", "series", "musicAlbum"]);
const TRAILING_PAREN = /\s*\((\d+)\)\s*$/;

/** The label: no annotation, no year, for every kind. */
export const cleanTitle = (s) => String(s || "").replace(TRAILING_PAREN, "").trim();

/** The release year, when the source title carried one. Books are excluded:
 *  their trailing number is usually a file count, and reading 415 as a year
 *  would be the key's-NAME-is-not-its-VALUE trap from the write side. */
export function yearOf(title, kind) {
  if (kind === "book") return null;
  const m = String(title || "").match(TRAILING_PAREN);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1900 && n <= 2099 ? n : null;
}

/** The dedupe key — keeps the year only where it distinguishes two works. */
export const normTitle = (s, kind) =>
  (IDENTITY_YEAR.has(kind) ? String(s || "").trim() : cleanTitle(s))
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The truncation length observed across the corpus. A media.md title AT that
 *  length is a prefix of the real one, so a prefix match is the right test —
 *  below it, an exact match is required or "The Ring" would swallow
 *  "The Ring Two". */
export const TRUNC_AT = 33;

/** Is this survey row already on the grid? PURE, so the rule is testable. */
export function alreadyPresent(title, existingNorms, kind) {
  const n = normTitle(title, kind);
  if (!n) return true;                       // an untitled row is not importable
  if (existingNorms.has(n)) return true;
  // Only the book tables truncate, so only they get the prefix arm.
  if (kind === "book" && cleanTitle(title).length >= TRUNC_AT) {
    for (const g of existingNorms) if (g.startsWith(n)) return true;
  }
  return false;
}

/** Owned: from the Status column where there is one, else from the fact that a
 *  file listing only lists files that are on the disk. */
export function ownedFor(row) {
  if (row.owned === true || row.owned === false) return row.owned;
  return true;
}

/** "13 Secret History — 221 files, 33.6 GB" -> "13 Secret History" */
export const topicOf = (section) => String(section || "").split("—")[0].trim() || null;

export async function up({ models, gridId, dryRun, log }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);

  if (!fs.existsSync(DATA_PATH)) { log(`no ${DATA_PATH} — run server/scripts/parseMediaMd.mjs first`); return { rows: 0 }; }
  const survey = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  log(`survey: ${survey.length} rows across ${new Set(survey.map(r => r.kind)).size} kinds`);

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  if (!tagField) { log("no Board Category field — this grid has no boards"); return { rows: 0 }; }

  const occs = await Occurrence.find({ gridId: gid },
    { id: 1, moduleId: 1, label: 1, parentId: 1, userId: 1, feed: 1, occurrences: 1,
      [`fields.${tagField.id}`]: 1, "meta.feedSourceId": 1, "meta.mediaLibraryKey": 1 }).lean();
  const mods = await Module.find({ gridId: gid }, { id: 1, label: 1, role: 1, kind: 1, meta: 1, userId: 1 }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));
  const tagOf = (o) => { const v = o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const nameOf = (o) => (o.label ?? modById.get(o.moduleId)?.label ?? "").trim();

  // ── the exemplar: mirror a real board rather than restate its shape ──────
  const exContainer = occs.find((o) => tagOf(o).includes("song") && o.feed?.enabled);
  if (!exContainer) { log("no Songs board to copy — refusing to invent a board shape"); return { rows: 0 }; }
  const exPage = occs.find((o) => (o.occurrences || []).includes(exContainer.id));
  if (!exPage) { log("the Songs container is listed by nobody — repair that first"); return { rows: 0 }; }
  const exPageMod = modById.get(exPage.moduleId), exContMod = modById.get(exContainer.moduleId);
  const home = exPage.parentId;   // Boards/Media, where 0224 put Music and Books
  log(`exemplar: page "${exPageMod?.label}" in folder ${home}`);

  // ── what is already on the grid, per tag ─────────────────────────────────
  const existingByTag = new Map();
  for (const o of occs) {
    if (o.meta?.feedSourceId) continue;                 // a feed COPY is re-minted; never dedupe against one
    const n = normTitle(nameOf(o));
    if (!n) continue;
    for (const t of tagOf(o)) {
      if (!existingByTag.has(t)) existingByTag.set(t, new Set());
      existingByTag.get(t).add(n);
    }
  }
  const alreadyImported = occs.filter((o) => o.meta?.mediaLibraryKey).length;

  // ── plan: distinct rows per kind, minus what the grid already holds ──────
  const plan = {};
  let totalNew = 0;
  for (const [kind, spec] of Object.entries(KINDS)) {
    const rows = survey.filter((r) => r.kind === kind);
    const have = existingByTag.get(spec.tag) || new Set();
    const seen = new Set(), keep = [];
    for (const r of rows) {
      const n = normTitle(r.title, kind);
      if (!n || seen.has(n)) continue;                  // media.md lists a work once per drive
      seen.add(n);
      if (alreadyPresent(r.title, have, kind)) continue;
      keep.push(r);
    }
    plan[kind] = keep;
    totalNew += keep.length;
    log(`  ${kind.padEnd(12)} ${String(rows.length).padStart(5)} rows -> ${String(seen.size).padStart(5)} distinct -> ` +
        `${String(seen.size - keep.length).padStart(5)} already on grid -> ${String(keep.length).padStart(5)} NEW` +
        (spec.merge ? "   (merges into the existing board)" : ""));
  }

  const { path: tagPath, values: tagValues } = readTagOptions(tagField);
  const haveTag = new Set(tagValues.map((v) => (v && typeof v === "object" ? v.value : v)));
  const needTags = [...new Set(Object.values(KINDS).map((s) => s.tag))].filter((t) => !haveTag.has(t));

  const boardFor = new Map();
  const needBoards = [];
  for (const [kind, spec] of Object.entries(KINDS)) {
    const c = occs.find((o) => tagOf(o).includes(spec.tag) && o.feed?.enabled);
    if (c) boardFor.set(kind, c.id); else needBoards.push([kind, spec]);
  }

  const wantFields = [["Owned", "boolean"], ["Drive", "text"], ["Size", "text"], ["Year", "number"]];
  const reuse = {};
  for (const n of ["File Path", "Formats", "Episodes"]) {
    const f = await Field.findOne({ gridId: gid, name: n }).lean();
    // `Files` and `Location` are deliberately NOT in this list — see the header.
    if (f && f.type !== "occurrence") reuse[n] = f;
    else if (f) log(`  NOT reusing "${n}" — it is type ${f.type}, which cannot hold this value`);
  }
  const needFields = [];
  for (const [name, type] of wantFields) {
    const f = await Field.findOne({ gridId: gid, name }).lean();
    if (f) reuse[name] = f; else needFields.push([name, type]);
  }

  log(`tags to add    : ${needTags.join(", ") || "(none)"}`);
  log(`boards to mint : ${needBoards.map(([, s]) => s.board).join(", ") || "(none)"}`);
  log(`fields to mint : ${needFields.map((f) => f[0]).join(", ") || "(none)"}`);
  log(`fields reused  : ${Object.keys(reuse).join(", ") || "(none)"}`);
  log(`rows already imported by this migration: ${alreadyImported}`);
  log(`TOTAL NEW ROWS : ${totalNew}   (grid goes ${occs.length} -> ${occs.length + totalNew})`);

  if (dryRun) return { rows: totalNew, boards: needBoards.length, plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])) };
  if (!totalNew && !needBoards.length) { log("nothing to do"); return { rows: 0 }; }

  // ── tags ────────────────────────────────────────────────────────────────
  if (needTags.length) {
    const objectStyle = tagValues.some((v) => v && typeof v === "object");
    await Field.updateOne({ id: tagField.id, gridId: gid }, { $set: { [tagPath]:
      [...tagValues, ...needTags.map((t) => (objectStyle ? { value: t, label: t } : t))] } });
    log(`  added Board Category options: ${needTags.join(", ")}`);
  }

  // ── fields ──────────────────────────────────────────────────────────────
  for (const [name, type] of needFields) {
    const fid = uid();
    await Field.create({ id: fid, userId: exPage.userId, gridId: gid, name, type,
      role: "input", inputEnabled: true, meta: {} });
    reuse[name] = { id: fid, name, type };
    log(`  minted field "${name}" [${type}]`);
  }

  // ── the boards ──────────────────────────────────────────────────────────
  for (const [kind, spec] of needBoards) {
    const pm = uid(), po = uid(), cm = uid(), co = uid();
    await Module.create({ id: pm, userId: exPageMod.userId, gridId: gid, label: spec.board,
      role: exPageMod.role, kind: exPageMod.kind, fieldBindings: [], meta: { ...(exPageMod.meta || {}) } });
    await Module.create({ id: cm, userId: exContMod.userId, gridId: gid, label: spec.board,
      role: exContMod.role, kind: exContMod.kind, fieldBindings: [], meta: { ...(exContMod.meta || {}) } });
    // The CONTAINER carries the tag and the feed and keeps parentId null; the
    // PAGE is what the folder homes and what LISTS it. `0158` inverted this and
    // shipped a board that held its data and could not be opened.
    await Occurrence.create({ id: co, userId: exContainer.userId, gridId: gid, moduleId: cm,
      parentId: null, occurrences: [], fields: { [tagField.id]: { value: [spec.tag], flow: "in" } },
      feed: { enabled: true, conditions: [{ fieldId: tagField.id, comparator: "CONTAINS", value: spec.tag }],
              roles: ["instance"], sort: null, limit: 5000 }, meta: {}, filterOverride: {} });
    await Occurrence.create({ id: po, userId: exPage.userId, gridId: gid, moduleId: pm,
      parentId: home, occurrences: [co], fields: {}, meta: {}, filterOverride: null });
    boardFor.set(kind, co);
    log(`  minted board "${spec.board}" (page ${po} -> container ${co})`);
  }

  // ── one shared ARTIFACT module per kind (see the header) ────────────────
  const bind = (f) => (f ? [{ fieldId: f.id }] : []);
  const rowModule = new Map();
  for (const [kind, spec] of Object.entries(KINDS)) {
    if (!plan[kind].length) continue;
    const found = await Module.findOne({ gridId: gid, label: spec.row, "meta.mediaRow": true }).lean();
    if (found) { rowModule.set(kind, found.id); continue; }
    const mid = uid();
    const bindings = [
      ...bind(reuse["Owned"]), ...bind(reuse["Drive"]), ...bind(reuse["Size"]),
      ...bind(reuse["File Path"]),
      ...(BINDS_YEAR.has(kind) ? bind(reuse["Year"]) : []),
      ...(kind === "series" ? bind(reuse["Episodes"]) : []),
      ...(kind === "book" ? bind(reuse["Formats"]) : []),
      { fieldId: tagField.id },
    ];
    await Module.create({ id: mid, userId: exPage.userId, gridId: gid, label: spec.row,
      role: "artifact", kind: spec.tag, fieldBindings: bindings, meta: { mediaRow: true } });
    rowModule.set(kind, mid);
    log(`  minted row module "${spec.row}" (${bindings.length} bindings)`);
  }

  // ── the rows ────────────────────────────────────────────────────────────
  const CHUNK = 400;
  let inserted = 0;
  for (const [kind, spec] of Object.entries(KINDS)) {
    const rows = plan[kind];
    if (!rows.length) continue;
    const boardId = boardFor.get(kind), moduleId = rowModule.get(kind);
    const docs = rows.map((r) => {
      const f = { [tagField.id]: { value: [spec.tag], flow: "in" } };
      const put = (name, value) => { if (reuse[name] && value !== null && value !== undefined && value !== "") f[reuse[name].id] = { value, flow: "in" }; };
      put("Owned", ownedFor(r));
      put("Drive", r.drive);
      put("Size", r.sizeText);
      put("File Path", r.location);
      // Only where the module BINDS it: 8 documentary titles end in a year, and
      // writing one to a module with no Year binding stores a value that renders
      // nowhere while REPORTING as written — the `0047` half of this repo's most
      // repeated defect, caught by reading the result back rather than the log.
      if (BINDS_YEAR.has(kind)) put("Year", yearOf(r.title, kind));
      if (kind === "series") put("Episodes", r.episodes);
      if (kind === "book") put("Formats", r.formats);
      return {
        id: uid(), userId: exPage.userId, gridId: gid, moduleId,
        parentId: boardId, occurrences: [], label: cleanTitle(r.title), fields: f,
        meta: {
          mediaLibraryKey: `${kind}|${normTitle(r.title, kind)}`,
          mediaDrive: r.drive || null,
          mediaTopic: kind === "documentary" ? topicOf(r.section) : null,
          mediaBytes: r.sizeBytes ?? null,
          mediaFiles: r.files ?? null,
          mediaTracks: r.tracks ?? null,
          mediaAlbums: r.albums ?? null,
          mediaArtist: kind === "musicAlbum" ? (r.author || null) : null,
          mediaAuthor: kind === "book" ? (r.author || null) : null,
        },
        filterOverride: {},
      };
    });
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      await Occurrence.insertMany(slice, { ordered: false });
      // $push $each rather than writing the array whole: a connected client
      // echoes a stale `occurrences[]` back over a whole-array write, which is
      // the 2026-08-13 (2) clobber that cost a session.
      await Occurrence.updateOne({ id: boardId, gridId: gid },
        { $push: { occurrences: { $each: slice.map((d) => d.id) } } });
    }
    inserted += docs.length;
    const owned = docs.filter((d) => d.fields[reuse["Owned"]?.id]?.value === true).length;
    log(`  inserted ${String(docs.length).padStart(5)} ${spec.board.padEnd(14)} (owned ${owned})`);
  }

  log(`done: ${inserted} rows across ${Object.values(plan).filter((v) => v.length).length} kinds`);
  return { rows: inserted, plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])) };
}
