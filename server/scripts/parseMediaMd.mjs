// scripts/parseMediaMd.mjs — media.md -> a flat JSON the migration can import.
//
// Usage:
//   node server/scripts/parseMediaMd.mjs [--in ~/media.md] [--out server/migrations/data/media-library.json]
//
// ── WHY THIS KEYS ON HEADER SIGNATURES, NOT ON SECTION POSITION ─────────────
// media.md is prose with tables in it, and several of those tables are ANALYSIS
// rather than data: a cross-drive overlap comparison whose first column is also
// called "Film", a hash-comparison table whose columns are unlabelled, per-topic
// summary counts. Walking "every table under ## Movies" would import the overlap
// analysis as three more films. So a table is only read when its HEADER ROW
// matches a shape declared below, and anything else is skipped and COUNTED — a
// parser that silently ignores what it does not understand cannot be checked.
//
// The document's own totals are the check: 994 movie rows, 192 series rows,
// 147 music artists, 4 games, 1,849 documentary files.

import fs from "fs";
import path from "path";
import os from "os";

/** Header signature -> what a row of that table IS. Order matters only in that
 *  each signature must be unambiguous; they are compared as exact cell lists. */
export const SHAPES = [
  { cols: ["Film", "Status", "Files", "Size", "Location"], kind: "movie" },
  // The want-list variant: an empty folder has no Files or Size to report.
  { cols: ["Film", "Status", "Location"], kind: "movie" },
  { cols: ["Show", "Status", "Episodes", "Size", "Location"], kind: "series" },
  { cols: ["Show", "Status", "Size", "Location"], kind: "series" },
  { cols: ["Show", "Status", "Location"], kind: "series" },
  { cols: ["Artist", "Albums", "Size"], kind: "musicArtist" },
  { cols: ["Artist", "Album", "Tracks", "Size"], kind: "musicAlbum" },
  { cols: ["Author", "Title", "Formats", "Size"], kind: "book" },
  // Loose top-level files: singular "Format", and no author folder to read.
  { cols: ["Title", "Format", "Size"], kind: "book" },
  { cols: ["Sub-collection", "Status", "Files", "Size"], kind: "comic" },
  { cols: ["#", "Title", "Size"], kind: "documentary" },
  { cols: ["Title", "Size", "Location"], kind: "game" },
];

/** Tables that LOOK like data and are not. Named so the skip is deliberate. */
export const IGNORED = [
  ["Film", "Drives", "Reclaimable"],          // cross-drive overlap analysis
  ["Show", "Drives", "Reclaimable"],
  ["Topic folder", "Files", "Size", "Location"], // per-topic counts, not titles
  ["Drive", "Type", "Media expected", "Scanned"],
  ["Kind", "Count", "Where"],
  ["Waste", "Where", "Size", "Verified how"],
  ["Drive", "Folder", "Contents"],
  ["", ""],                                    // unlabelled stat tables
];

const sameCols = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);
const splitRow = (ln) => ln.split("|").slice(1, -1).map((c) => c.trim());
const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** "**owned — complete**" / "owned" / "not owned" -> boolean. */
export function parseOwned(status) {
  if (status == null) return null;
  const s = String(status).replace(/\*/g, "").toLowerCase();
  if (s.includes("not owned")) return false;
  if (s.includes("owned")) return true;
  return null;
}

/** "45.0 GB" / "~5.0 GB" / "877 MB" -> bytes (approx), or null. */
export function parseSize(s) {
  if (!s) return null;
  const m = String(s).replace(/[~*]/g, "").trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!m) return null;
  const mult = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 }[m[2].toLowerCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

/** "`movies/Dune (2021)`" -> "movies/Dune (2021)". */
const unTick = (s) => String(s || "").replace(/^`|`$/g, "").trim();
/** "### Odin — 400 movie folders…" -> "Odin". */
export const driveOf = (h3) => String(h3 || "").split("—")[0].replace(/^#+\s*/, "").trim();

export function parseMediaMd(md) {
  const lines = md.split("\n");
  const out = [];
  const skipped = [];
  let h3 = null, summary = null;
  // THREE states, not two. `null` = "no table open, the next row is a header";
  // a shape = "read these rows"; IGNORE = "a table I deliberately skip, and its
  // rows are not headers". Collapsing the last two into `null` made every DATA
  // row of an ignored table get re-tested as a header and reported as unparsed —
  // 26 topic-summary rows reading as 26 mystery tables.
  const IGNORE = Symbol("ignored-table");
  let shape = null, cols = null;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m3 = ln.match(/^###+\s+(.+)$/);
    if (m3) { h3 = m3[1].trim(); shape = null; continue; }
    const ms = ln.match(/^<summary>(.*)<\/summary>/);
    if (ms) { summary = ms[1].replace(/<[^>]+>/g, "").trim(); shape = null; continue; }
    if (!ln.startsWith("|")) { shape = null; continue; }

    const cells = splitRow(ln);
    if (isSep(cells)) continue;                       // the |---| row

    // A header row: decide whether this table is data, and of what.
    if (!shape) {
      const hit = SHAPES.find((s) => sameCols(s.cols, cells));
      if (hit) { shape = hit; cols = cells; continue; }
      if (IGNORED.some((c) => sameCols(c, cells))) { shape = IGNORE; continue; }
      // Not a header we know — record it once so an unparsed table is visible.
      // Keyed by signature: an unmatched table would otherwise report once per
      // ROW, turning three stray tables into a thousand-line "skipped" list.
      const sig = cells.join(" | ");
      if (!skipped.some((x) => x.sig === sig)) skipped.push({ sig, h3, cells: cells.slice(0, 6) });
      // IGNORE, not null — for the same reason a declared non-data table gets
      // it. Left as null, the rows BELOW an unknown header are each re-tested
      // as headers and reported too, so `skipped` counts ROWS while claiming to
      // count TABLES: three stray tables read as a thousand mystery shapes.
      shape = IGNORE;
      continue;
    }

    if (shape === IGNORE) continue;                   // a declared non-data table

    // A data row of the current table.
    const g = (name) => { const idx = cols.indexOf(name); return idx === -1 ? null : cells[idx]; };
    // On the per-ALBUM table the row's identity is the album, and the Artist
    // column is its parent — so read Album first there and keep Artist as the link.
    const title = (g("Film") ?? g("Show") ?? g("Album") ?? g("Title") ?? g("Artist") ?? g("Sub-collection") ?? "").trim();
    if (!title || title === "…") continue;
    out.push({
      kind: shape.kind,
      title: title.replace(/\*\*/g, "").trim(),
      author: g("Author") || (g("Album") ? g("Artist") : null) || null,
      drive: driveOf(h3),
      owned: parseOwned(g("Status")),
      files: g("Files") ? Number(String(g("Files")).replace(/[^\d]/g, "")) || null : null,
      episodes: g("Episodes") ? Number(String(g("Episodes")).replace(/[^\d]/g, "")) || null : null,
      tracks: g("Tracks") ? Number(String(g("Tracks")).replace(/[^\d]/g, "")) || null : null,
      albums: g("Albums") ? Number(String(g("Albums")).replace(/[^\d]/g, "")) || null : null,
      formats: g("Formats") ?? g("Format") ?? null,
      sizeText: g("Size") ? String(g("Size")).replace(/[~*]/g, "").trim() : null,
      sizeBytes: parseSize(g("Size")),
      location: g("Location") ? unTick(g("Location")) : null,
      section: summary || null,
    });
  }
  return { rows: out, skipped };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
  const inPath = (arg("--in", path.join(os.homedir(), "media.md")) || "").replace(/^~/, os.homedir());
  const outPath = arg("--out", path.resolve("server/migrations/data/media-library.json"));
  const { rows, skipped } = parseMediaMd(fs.readFileSync(inPath, "utf8"));

  const byKind = {};
  for (const r of rows) (byKind[r.kind] ??= []).push(r);
  console.log(`parsed ${rows.length} rows from ${inPath}`);
  for (const [k, v] of Object.entries(byKind).sort()) {
    const owned = v.filter((r) => r.owned === true).length;
    const known = v.filter((r) => r.owned !== null).length;
    console.log(`  ${k.padEnd(13)} ${String(v.length).padStart(5)}` +
      (known ? `  owned ${owned}/${known}` : ""));
  }
  if (skipped.length) {
    console.log(`\nskipped ${skipped.length} table(s) whose header is not a declared shape:`);
    for (const s of skipped) console.log(`  [${(s.cells || []).join(" | ")}]  under "${s.h3 || "?"}"`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 0));
  console.log(`\nwrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}
