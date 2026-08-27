/**
 * 0265 — the same book imported three times under three spellings of its title.
 *
 * User, 2026-08-26: *"and there are so many duplicates in books"*.
 *
 * ── THE COUNT DEPENDS ENTIRELY ON THE NORMALISER ────────────────────────
 * ```
 * book source rows                                       878
 * redundant by EXACT title                                18   <- my first answer, wrong
 * redundant by true-PREFIX after normalising              149
 * ```
 * Three importers wrote the same shelf: Calibre (filename-derived, so `:` and
 * `'` become `_`), media.md (**truncates at ~31 characters**, 2026-08-25 (2)),
 * and the full-title pass. So one book is `The Meaning of Happiness: The Quest
 * For Freedom Of The Spirit` / `The Meaning of Happiness: The Q` / the same
 * again in different case. *A duplicate count is a claim about the NORMALISER.*
 *
 * ── PREFIX, NOT "SHARES 30 CHARACTERS" — THIS IS THE SAFETY ─────────────
 * A truncated title is an exact PREFIX of its twin. Two different VOLUMES are
 * not:
 * ```
 * "Jesus Christ in the Name of the Gun 01 (2009)"
 * "Jesus Christ in the Name of the Gun v02"
 * ```
 * Neither is a prefix of the other, so they are never grouped. A 30-character
 * shared-prefix rule WOULD have merged them and destroyed a distinct book. The
 * match must also land on a WORD BOUNDARY, so "The Life of Greece" never
 * absorbs "The Life of Greeceland".
 *
 * ── THE AUTHOR SEGMENT, on the user's explicit call ─────────────────────
 * Calibre writes the author at either end — `Ryan Holiday - The Obstacle Is
 * the Way`, `Our Oriental Heritage_ Being a - Will Durant` — which breaks the
 * prefix test on rows that are plainly the same book. Each row therefore gets
 * a SET of candidate keys: the whole title, and the title with a leading or
 * trailing ` - ` segment removed. Two rows match when any key of one is a true
 * prefix of any key of the other. `MIN_KEY_LEN` stops a short fragment
 * matching half the shelf.
 *
 * ── THE SURVIVOR IS THE RICHEST ROW, NOT THE LONGEST TITLE ──────────────
 * The first version ranked by title length and kept the Calibre filename
 * spelling (5 fields) over the clean one (7) on most groups — backwards, and
 * only reading the dry run caught it. Rank is: most non-empty fields, then most
 * user-entered data, then longest title, then id so a re-run is deterministic.
 *
 * ── IT REFUSES A GROUP RATHER THAN LOSING WHAT YOU TYPED ────────────────
 * If a doomed row carries a user field (rating, read, notes, owned…) that the
 * survivor does not, the whole group is REPORTED AND KEPT. A library is exactly
 * where deleting something the user recorded is worse than leaving a row too
 * many — the rule `0115` applied to the grocery list, and `0038`/`0109` before
 * it.
 */

export const id = "0265-dedupe-book-rows";
export const describe =
  "Groups book rows whose normalised titles are true prefixes of one another (Calibre / media.md / full-title imports of the same shelf) and drops all but the richest row. Never groups two rows unless one title is a genuine prefix of the other, and refuses any group where a doomed row holds user-entered data the survivor lacks.";
export const touches = ["occurrences", "fields"];

export const MIN_KEY_LEN = 14;
// media.md cuts titles at a FIXED width, and it cuts MID-WORD — every truncated
// row on this grid normalises to exactly 30 characters ("the meaning of
// happiness the q", "cloud hidden whereabouts unkno", "become what you are
// expanded e"). That collides with the word-boundary guard below, which exists
// to stop "The Life of Greece" absorbing "The Life of Greeceland": one rule
// needs the cut to land on a space and the other guarantees it does not.
//
// So a mid-word prefix is accepted ONLY at the truncation width. Anywhere else
// the boundary is still required. The window is deliberately narrow.
export const TRUNC_MIN = 28;
export const TRUNC_MAX = 32;
export const USER_FIELD_WORDS = ["rating", "read", "completed", "notes", "status", "owned", "progress", "started", "finished", "review"];

export function normaliseTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, "")      // media.md's "(152)" count suffix
    .replace(/[^a-z0-9 ]+/g, " ")        // `_` `:` `'` `-` all become space
    .replace(/\s+/g, " ")
    .trim();
}

/** The whole title, plus it with a leading or trailing " - " segment removed. */
export function titleKeys(raw) {
  const keys = new Set();
  const add = (s) => { const n = normaliseTitle(s); if (n.length >= MIN_KEY_LEN) keys.add(n); };
  add(raw);
  const parts = String(raw || "").split(" - ");
  if (parts.length > 1) {
    add(parts.slice(1).join(" - "));      // "Ryan Holiday - Title" -> "Title"
    add(parts.slice(0, -1).join(" - "));  // "Title - Will Durant" -> "Title"
  }
  return [...keys];
}

const isPrefix = (long, short) => {
  if (long === short) return true;
  if (!long.startsWith(short)) return false;
  // A real word boundary is always fine.
  if (long[short.length] === " ") return true;
  // Otherwise this is only a match if `short` is a media.md truncation.
  return short.length >= TRUNC_MIN && short.length <= TRUNC_MAX;
};

export function keysMatch(aKeys, bKeys) {
  for (const a of aKeys) for (const b of bKeys) {
    if (a.length >= b.length ? isPrefix(a, b) : isPrefix(b, a)) return true;
  }
  return false;
}

/**
 * Pure. `rows` are `{ id, title, fieldCount, userFields:Set<string> }`.
 * Returns { groups:[{keep,drop}], refusals:[] }.
 */
export function planBookDedupe({ rows }) {
  const enriched = rows
    .map((r) => ({ ...r, keys: titleKeys(r.title), norm: normaliseTitle(r.title) }))
    .filter((r) => r.keys.length);

  // Richest first, so the head of every group is already the survivor.
  enriched.sort((a, b) =>
    b.fieldCount - a.fieldCount ||
    b.userFields.size - a.userFields.size ||
    b.norm.length - a.norm.length ||
    String(a.id).localeCompare(String(b.id)));

  const groups = [];
  const groupsRaw = [];
  const refusals = [];
  const taken = new Set();
  for (const head of enriched) {
    if (taken.has(head.id)) continue;
    const members = [head];
    for (const other of enriched) {
      if (other.id === head.id || taken.has(other.id)) continue;
      if (keysMatch(head.keys, other.keys)) members.push(other);
    }
    members.forEach((m) => taken.add(m.id));
    if (members.length < 2) continue;

    const [keep, ...drop] = members;
    groupsRaw.push({ keep, drop });
  }

  // AMBIGUITY. A 30-character truncation can be a prefix of TWO different
  // books ("Jesus Christ in the Name of th" fits both the Gun and the Sun
  // volume). The grouping loop is greedy — it hands the cut to whichever
  // survivor is richest and the loser never forms a group at all — so the
  // conflict is invisible from the groups alone. It has to be asked of EVERY
  // row outside this group, not of the other survivors. A guess here deletes a
  // real book.
  for (const g of groupsRaw) {
    const { keep, drop } = g;
    const mine = new Set([keep.id, ...drop.map((d) => d.id)]);
    const ambiguous = drop.filter((d) =>
      enriched.some((r) => !mine.has(r.id) && keysMatch(r.keys, d.keys)));
    if (ambiguous.length) {
      refusals.push({ keep, drop, lost: [], ambiguous });
      continue;
    }
    // Anything the user typed on a doomed row that the survivor does not have.
    const lost = [];
    for (const d of drop) for (const f of d.userFields) if (!keep.userFields.has(f)) lost.push({ row: d, field: f });
    if (lost.length) {
      refusals.push({ keep, drop, lost });
      continue;
    }
    groups.push({ keep, drop });
  }
  return { groups, refusals };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const bc = fields.find((f) => f.name === "Board Category");
  if (!bc) { log("no Board Category field — refusing."); return; }
  const userFieldIds = new Set(
    fields.filter((f) => USER_FIELD_WORDS.some((w) => (f.name || "").toLowerCase().includes(w))).map((f) => f.id));

  const isBook = (o) => {
    const v = o.fields?.[bc.id]?.value;
    return (Array.isArray(v) ? v : [v]).some((x) => typeof x === "string" && x.toLowerCase() === "book");
  };
  const filled = (v) => v?.value != null && v.value !== "" && v.value !== false && !(Array.isArray(v.value) && !v.value.length);

  const rows = occs.filter((o) => isBook(o) && !o.meta?.feedSourceId).map((o) => ({
    id: o.id,
    title: o.label ?? modById.get(o.moduleId)?.label ?? "",
    fieldCount: Object.values(o.fields || {}).filter(filled).length,
    userFields: new Set(Object.entries(o.fields || {}).filter(([k, v]) => userFieldIds.has(k) && filled(v)).map(([k]) => k)),
  }));

  const { groups, refusals } = planBookDedupe({ rows });
  const doomed = groups.reduce((a, g) => a + g.drop.length, 0);
  log(`book rows: ${rows.length}`);
  const ambigRefusals = refusals.filter((r) => r.ambiguous?.length);
  const dataRefusals = refusals.filter((r) => r.lost?.length);
  log(`groups: ${groups.length}  ·  rows to remove: ${doomed}`);
  log(`REFUSED — ambiguous (a cut title fits more than one book): ${ambigRefusals.length}`);
  log(`REFUSED — would lose user-entered data: ${dataRefusals.length}`);
  for (const r of ambigRefusals)
    log(`  AMBIGUOUS "${r.keep.title.slice(0, 46)}" — ${r.ambiguous.map((a) => `"${a.title.slice(0, 34)}"`).join(", ")} also fits another book`);
  for (const r of dataRefusals)
    log(`  USER DATA "${r.keep.title.slice(0, 46)}" — ${r.lost.length} value(s) only on a doomed row`);
  for (const g of groups) {
    log(`  keep "${g.keep.title.slice(0, 56)}" (${g.keep.fieldCount} fields)`);
    for (const d of g.drop) log(`    drop "${d.title.slice(0, 56)}" (${d.fieldCount} fields)  ${d.id}`);
  }
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  const ids = groups.flatMap((g) => g.drop.map((d) => d.id));

  // UNLIST BEFORE DELETING. A row is reachable two ways — its own `parentId`
  // and its parent's `occurrences[]` — and deleting the document leaves the
  // array pointing at nothing. That is the `dangling-child-ref` class this repo
  // has swept five times (2026-07-29 … 2026-08-04), and the first version of
  // this migration produced 257 of them in one run. `$pull $in` is atomic, per
  // the 2026-08-04 finding that a read-modify-write of the whole array races
  // any concurrent write to the same parent.
  const unlist = await Occurrence.updateMany(
    { gridId, occurrences: { $in: ids } },
    { $pull: { occurrences: { $in: ids } } }
  );
  log(`unlisted from ${unlist.modifiedCount} parent(s) before deleting.`);

  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  log(`removed ${ids.length} duplicate book row(s).`);
}
