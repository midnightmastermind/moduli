/**
 * 0270 — the book titles carry their own import history.
 *
 * User, 2026-08-27: *"im looking for title duplications mostly but if a book is
 * labeled wrong, we need that too"*, and *"there are random # characters in
 * some of the book titles"*.
 *
 * Measured before writing any rule — 48 of 621 rows carry at least one:
 * ```
 * publisher suffix    17   "Our Revolution: A Future to Believe In-Thomas Dunne Books"
 * underscore for ' :  15   "Caliban_s War"   "The 5 Love Languages_ The Secret"
 * trailing hash blob  16   "7 Habits of Highly Effective People_VSB5ASBCMOFD…"
 * HTML entity          5   "[Guruslodge.com]1. Assassin: #039 s Creed Renaissance"
 * site prefix          5   (the same 5)
 * edition marker       2   "(1st Ed) Hanselman, Stephen Holiday"
 * ```
 * `#039` is `&#039;` — an apostrophe whose `&` and `;` were stripped somewhere
 * in the import, leaving the digits in the title.
 *
 * ── THE AUTHOR IS STRIPPED ONLY WHEN IT IS A KNOWN AUTHOR ───────────────
 * Calibre writes `Rob Bell - Love Wins: …`. Splitting on " - " and keeping the
 * longer side is a guess; a title may legitimately contain a dash. So the
 * segment is removed ONLY when it matches a name from the grid's own Author
 * pool (the 297 rows the Author dropdown offers). That turns a heuristic into
 * a lookup, and a book by an author the grid does not know keeps its title
 * untouched.
 *
 * ── IT NEVER INVENTS, AND IT NEVER EMPTIES ──────────────────────────────
 * Every rule only REMOVES import debris or restores a character that was
 * mangled. Nothing is guessed at: two rows are not titles at all
 * (`20220209104606372`, `temp1744025251402229693`) and are REPORTED rather than
 * renamed, because the real title is not recoverable from the row. A rule that
 * would leave a title shorter than 3 characters is refused and the original
 * kept — a blank row is worse than an ugly one.
 *
 * ── ORDER MATTERS, AND IT IS THE REASON THIS RUNS BEFORE THE DEDUPE ─────
 * `0265` matches on normalised titles. "The Daily Show (The Book)" and
 * "Chris Smith, Jon Stewart - The Daily Show-Grand Central Publishing" are the
 * same book and did NOT merge, because the second carries an author and a
 * publisher. Cleaning first is what lets the dedupe see them.
 */

export const id = "0270-clean-book-titles";
export const describe =
  "Removes import debris from book titles — site prefixes, leading index numbers, publisher suffixes, trailing hash blobs, edition markers — decodes the mangled &#039; entities, restores underscores that stand for an apostrophe or a colon, and drops a leading/trailing author segment when it matches a known author. Never invents a title and never empties one.";
export const touches = ["occurrences", "modules"];

// AN EXPLICIT LIST, and deliberately not a pattern.
//
// The tempting rule is "strip a trailing `-Capitalised Words`". Measured against
// the actual trailing segments on this shelf, that rule eats real titles:
//   "Six Pillars of Self-Esteem"      -> -Esteem
//   "Object-Oriented JavaScript"      -> -Oriented JavaScript
//   "Tao Te Ching - Lao Tzu"          -> -Tzu
// So the list is enumerated from what is genuinely present, derived by counting
// repeated trailing segments across the shelf and reading the singletons rather
// than guessing at a regex. A publisher this list does not know simply stays in
// the title, which is the safe direction to be wrong in.
const PUBLISHERS = [
  "Orbit", "Grand Central Publishing", "Thomas Dunne Books", "Souvenir Press",
  "Shambhala Publications", "HarperOne", "HarperCollins", "Harper Perennial",
  "Penguin Books", "Penguin", "Vintage", "Simon & Schuster", "Random House",
  "Little, Brown and Company", "Crown", "Portfolio Hardcover", "Portfolio",
  "Riverhead Books", "New World Library", "North Atlantic Books", "Pantheon",
  "Bantam", "Zondervan", "Candlewick Press", "Candlewick", "Broadway Books",
  "City Lights Publishers", "Tor Books", "Knopf Doubleday Publishing Group",
  "Berkley", "Michael Joseph", "Puddledancer Press", "Realface Press",
  "Berrett-Koehler Publishers", "Berrett", "Free Press", "Avery",
];

/** Pure. Returns the cleaned title, or the original when nothing applies. */
export function cleanBookTitle(raw, knownAuthors = new Set()) {
  let t = String(raw || "");
  const before = t;

  // 1. `[Guruslodge.com]` / `(www.site.net)` harvested from a download page.
  t = t.replace(/^\s*[[(](?:www\.)?[A-Za-z0-9-]+\.(?:com|net|org|info|co\.uk)[\])]\s*/i, "");
  // 2. a leading list index: "1. Assassin…"
  t = t.replace(/^\s*\d{1,2}\s*[.)]\s+/, "");
  // 3. a leading edition marker: "(1st Ed) "
  t = t.replace(/^\s*\(\d(?:st|nd|rd|th)\s*Ed\.?\)\s*/i, "");
  // 4. HTML entities, including the mangled form that lost its & and ;.
  t = t.replace(/&#0?39;|&apos;|(?<=\w):?\s*#0?39\s*(?=[a-z]\b)/gi, "'")
       .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " ");
  // 5. a trailing hash blob a downloader appended: "_VSB5ASBCMOFDOZ5TTY2…"
  t = t.replace(/_[A-Z0-9]{12,}\s*$/, "");
  // 6. a publisher glued on with a hyphen.
  for (const pub of PUBLISHERS) {
    const esc = pub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*-\\s*${esc}\\s*$`, "i"), "");
    t = t.replace(new RegExp(`-${esc}\\s*$`, "i"), "");
  }
  // 7. underscores standing in for a character Calibre could not put in a
  //    filename. Only the two shapes that are unambiguous.
  t = t.replace(/_(?=(?:s|t|re|ve|ll|d|m)\b)/g, "'");   // Caliban_s -> Caliban's
  t = t.replace(/_(\s)/g, ":$1");                        // Languages_ The -> Languages: The
  t = t.replace(/:\s*(?=-\s)/g, " ");                    // "Tao: - Alan" -> "Tao - Alan"
  // 8. a KNOWN author at either end.
  if (knownAuthors.size) {
    const parts = t.split(" - ");
    if (parts.length > 1) {
      const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
      const head = parts[0], tail = parts[parts.length - 1];
      if (knownAuthors.has(norm(head))) t = parts.slice(1).join(" - ");
      else if (knownAuthors.has(norm(tail))) t = parts.slice(0, -1).join(" - ");
    }
  }
  t = t.replace(/\s{2,}/g, " ").replace(/\s*[-–—:,]\s*$/, "").trim();

  // Never empty a title, and never make one unrecognisable.
  if (t.length < 3) return before;
  return t;
}

/** Rows whose "title" is not a title at all — reported, never renamed. */
export function looksUnrecoverable(t) {
  const s = String(t || "").trim();
  return /^\d{8,}$/.test(s) || /^temp\d{6,}$/i.test(s);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean()]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const bc = fields.find((f) => f.name === "Board Category");
  if (!bc) { log("no Board Category field — refusing."); return; }
  const tagged = (o, want) => {
    const v = o.fields?.[bc.id]?.value;
    return (Array.isArray(v) ? v : [v]).some((x) => typeof x === "string" && x.toLowerCase() === want);
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const knownAuthors = new Set(occs.filter((o) => tagged(o, "bookauthor"))
    .map((o) => norm(o.label ?? modById.get(o.moduleId)?.label)).filter(Boolean));
  log(`known authors: ${knownAuthors.size}`);

  const books = occs.filter((o) => tagged(o, "book") && !o.meta?.feedSourceId);
  const changes = [], unrecoverable = [];
  for (const o of books) {
    const cur = o.label ?? modById.get(o.moduleId)?.label ?? "";
    if (looksUnrecoverable(cur)) { unrecoverable.push({ id: o.id, cur }); continue; }
    const next = cleanBookTitle(cur, knownAuthors);
    if (next !== cur) changes.push({ id: o.id, moduleId: o.moduleId, onOccurrence: o.label != null, cur, next });
  }
  log(`book rows: ${books.length}  ·  titles to clean: ${changes.length}  ·  not titles at all: ${unrecoverable.length}`);
  for (const u of unrecoverable) log(`  UNRECOVERABLE ${u.id} "${u.cur}" — left alone, the real title is not in the row`);
  for (const c of changes) log(`  "${c.cur.slice(0, 62)}"\n    -> "${c.next.slice(0, 62)}"`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  for (const c of changes) {
    if (c.onOccurrence) await Occurrence.updateOne({ gridId, id: c.id }, { $set: { label: c.next } });
    else await Module.updateOne({ gridId, id: c.moduleId }, { $set: { label: c.next } });
  }
  log(`cleaned ${changes.length} title(s).`);
}
