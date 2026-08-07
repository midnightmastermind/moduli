// helpers/csvToTable.js
//
// Task 5 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// the `.csv` → table container shape. PURE: no React, no DOM, no writes.
//
// ── WHY THIS CONVERTS TO MARKDOWN RATHER THAN BUILDING A TABLE ──────────────
//
// The importer ALREADY mints a real `kind:"table"` container from a markdown
// pipe table (`buildTable`, server/services/markdownImporter.js — shipped
// 2026-05-21 with the column/cell shape the renderer reads). So the cheapest
// correct route from a dropped CSV to a table is:
//
//     csv text → rows → markdown pipe table → import_text(format:"markdown")
//
// No server change, no second table builder, and every downstream behaviour
// (cell docs, column defs, the root container the table nests in) is the one
// that is already tested and in production. Writing a client-side table minter
// would be a second implementation of a shape that has to stay in sync — the
// exact trade this plan exists to avoid.
//
// ── THE ONE HARD CONSTRAINT, AND IT IS NOT OBVIOUS ──────────────────────────
//
// `parseBlocks` only recognises a table when the SEPARATOR line has at least
// two column groups (`/…-{3,}:?(\s*\|\s*:?-{3,}:?)+…/` — the `+` requires a
// repetition). **A single-column CSV therefore cannot be a table**, and if we
// emitted one anyway it would silently import as prose. `csvToMarkdownTable`
// returns null in that case so the caller can fail out loud instead.

const DELIMITER_CANDIDATES = [",", "\t", ";", "|"];
const SNIFF_SAMPLE_CHARS = 8000;

/** Minimum columns a pipe table can have — see the header note. */
export const MIN_TABLE_COLUMNS = 2;

/**
 * RFC 4180-shaped parse: quoted fields, embedded delimiters, embedded
 * newlines, and `""` as an escaped quote.
 *
 * A quote only OPENS a field when it is the first character of that field.
 * Anywhere else it is a literal — which is what keeps a stray `6" pipe` from
 * swallowing the rest of the file.
 *
 * @returns {string[][]} rows, blank lines dropped
 */
export function parseDelimited(text, delimiter = ",") {
  // Excel writes a UTF-8 BOM; left in, it becomes part of the first header.
  const s = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const endField = () => { row.push(cur); cur = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch !== '"') { cur += ch; continue; }
      if (s[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = false;
      continue;
    }
    if (ch === '"' && cur === "") { inQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === "\r") { if (s[i + 1] === "\n") i++; endRow(); continue; }
    if (ch === "\n") { endRow(); continue; }
    cur += ch;
  }
  // A file ending in a newline leaves nothing pending; anything else is a final
  // row (including an unterminated quote, which we keep rather than discard).
  if (cur !== "" || row.length) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Pick the delimiter by PARSING with each candidate and asking which one
 * produces a consistent rectangle — counting raw characters mis-reads any file
 * whose prose contains commas.
 */
export function sniffDelimiter(text, filename = "") {
  if (/\.tsv$/i.test(String(filename || ""))) return "\t";
  const sample = String(text ?? "").slice(0, SNIFF_SAMPLE_CHARS);

  let best = ",";
  let bestScore = -1;
  for (const d of DELIMITER_CANDIDATES) {
    const rows = parseDelimited(sample, d);
    if (!rows.length) continue;
    const cols = rows[0].length;
    if (cols < MIN_TABLE_COLUMNS) continue;
    const consistent = rows.filter((r) => r.length === cols).length / rows.length;
    // Consistency dominates; column count only breaks ties, so a delimiter that
    // happens to split one line into many pieces can't beat one that splits
    // every line into the same few.
    const score = consistent * 100 + cols;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * A cell has to survive being written into ONE line of a pipe table.
 *
 * `splitTableRow` unescapes `\|` and nothing else, so a backslash is left
 * alone (escaping it would show up doubled in the imported cell). Newlines are
 * flattened because a row IS a line — there is no continuation syntax.
 */
export function escapeTableCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * rows → a markdown pipe table, or **null** when it cannot legally be one.
 *
 * Ragged rows are padded to the widest row rather than dropped: a trailing
 * empty column is recoverable, a silently discarded row is not.
 */
export function rowsToMarkdownTable(rows) {
  const clean = (rows || []).filter((r) => Array.isArray(r) && r.length);
  if (!clean.length) return null;

  const width = clean.reduce((w, r) => Math.max(w, r.length), 0);
  if (width < MIN_TABLE_COLUMNS) return null;

  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  // An empty header would leave the column unlabelled AND (because
  // `buildTable` uses headers[0] as the table's label) can leave the table
  // unnamed — so blanks get a positional name.
  const headers = pad(clean[0]).map((h, i) => escapeTableCell(h) || `Column ${i + 1}`);
  const body = clean.slice(1).map(pad);

  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...body.map((r) => line(r.map(escapeTableCell))),
  ].join("\n");
}

/**
 * The whole conversion: delimited text → markdown pipe table.
 *
 * @returns {{ ok: true, markdown: string, rows: number, columns: number, delimiter: string }}
 *        | {{ ok: false, reason: "empty" | "too-few-columns", columns?: number }}
 */
export function csvToMarkdownTable(text, filename = "") {
  const delimiter = sniffDelimiter(text, filename);
  const rows = parseDelimited(text, delimiter);
  if (!rows.length) return { ok: false, reason: "empty" };

  const markdown = rowsToMarkdownTable(rows);
  if (!markdown) {
    return {
      ok: false,
      reason: "too-few-columns",
      columns: rows.reduce((w, r) => Math.max(w, r.length), 0),
    };
  }
  return {
    ok: true,
    markdown,
    delimiter,
    columns: rows.reduce((w, r) => Math.max(w, r.length), 0),
    rows: Math.max(0, rows.length - 1),
  };
}
