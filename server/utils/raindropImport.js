// utils/raindropImport.js
//
// A Raindrop CSV export -> what goes on the grid.
//
// PURE. Every decision the user made lives here, testable without a database,
// because the alternative is discovering a rule was wrong after 1,467 rows have
// been written.
//
// The export's own shape, measured before any of this was designed:
//
//     1,847 bookmarks · 51 folders · 670 domains · 2017 -> 2026
//     1,163 (63%) in "Unsorted"
//       324 on google.com — 281 SEARCHES and 43 real bookmarks
//       104 duplicate rows across 77 distinct URLs
//        28 tags, 19 of them auto-generated DATES covering 906 bookmarks
//        10 folders auto-named "Jul 24 at 11:34", covering 76

/**
 * RFC4180 CSV -> rows of objects, keyed by the header line.
 *
 * Hand-written rather than adding a dependency, because the shape is small and
 * fixed — but written as a STATE MACHINE rather than a split on commas, because
 * this export needs every case that naive splitting gets wrong: excerpts contain
 * commas, some contain NEWLINES, and a quoted field escapes a quote by doubling
 * it. A `line.split(",")` would silently shear those rows into nonsense and the
 * import would look like it worked.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }  // "" is one quote
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) endRow();
  const header = rows.shift() || [];
  return rows
    .filter((r) => r.length > 1 || (r[0] || "").trim())      // skip a trailing blank line
    .map((r) => Object.fromEntries(header.map((h, n) => [h, r[n] ?? ""])));
}

/** `2/28/2026`, `21/08/2025`, `April 29 2023` — Raindrop's bulk-tagging residue. */
const DATE_TAG = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})$/;
/** `Bookmarks Bar / Jul 24 at 11:34` — a folder Raindrop named after a moment. */
const AUTO_FOLDER = /\b[A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d{2}/;

/**
 * A tag worth keeping. Structural, not a list of the nine that happen to exist
 * today: a rule survives the next export, a list silently drops whatever is new.
 */
export function isMeaningfulTag(tag) {
  const t = String(tag || "").trim();
  return !!t && !DATE_TAG.test(t);
}

/** A folder worth keeping as a tag. */
export function isMeaningfulFolder(folder) {
  const f = String(folder || "").trim();
  return !!f && !AUTO_FOLDER.test(f);
}

/**
 * The search TERM behind a search-engine URL, or null.
 *
 * The 43 google.com rows with no `q=` are NOT searches — accounts.google.com,
 * remotedesktop.google.com — and dropping them by domain would have binned four
 * dozen real bookmarks. That is the whole reason this asks for the parameter
 * rather than matching the host.
 */
export function searchTermOf(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return null; }
  if (!/(^|\.)google\./i.test(u.hostname)) return null;
  const q = (u.searchParams.get("q") || u.searchParams.get("query") || "").trim();
  return q || null;
}

/** The tag list a row contributes: its meaningful tags plus its folder. */
export function tagsFor(row) {
  const out = [];
  for (const t of String(row?.tags || "").split(",")) {
    const v = t.trim();
    if (v && isMeaningfulTag(v)) out.push(v);
  }
  const folder = String(row?.folder || "").trim();
  if (folder && isMeaningfulFolder(folder)) out.push(folder);
  return [...new Set(out)];
}

/**
 * Split the export into what to create.
 *
 * @returns {{ bookmarks, lookupTerms, dropped: { searches, duplicates } }}
 *
 * ORDER: rows are sorted by `created` before de-duplication so the EARLIEST of a
 * repeated URL is the one kept — the first time you saved something is the one
 * with the context you saved it in.
 */
export function planRaindropImport(rows) {
  const searches = [];
  const rest = [];
  for (const r of rows || []) {
    const term = searchTermOf(r?.url);
    if (term) searches.push({ row: r, term });
    else if (r?.url) rest.push(r);
  }

  const terms = new Map();                       // lowercased -> first spelling seen
  for (const { term } of searches) {
    const k = term.toLowerCase();
    if (!terms.has(k)) terms.set(k, term);
  }

  const seen = new Set();
  const bookmarks = [];
  let duplicates = 0;
  for (const r of [...rest].sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")))) {
    if (seen.has(r.url)) { duplicates++; continue; }
    seen.add(r.url);
    bookmarks.push({
      url: r.url,
      title: String(r.title || "").trim() || r.url,
      excerpt: String(r.excerpt || "").trim(),
      cover: String(r.cover || "").trim(),
      created: String(r.created || "").slice(0, 10) || null,
      tags: tagsFor(r),
      externalId: String(r.id || "").trim() || null,
    });
  }
  return {
    bookmarks,
    lookupTerms: [...terms.values()],
    dropped: { searches: searches.length, duplicates },
  };
}
