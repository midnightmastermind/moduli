// 0237 — media renders as TILES, and gets tags of its own
//
// User, 2026-08-25: *"set my media to be tiles like trackers and do it with
// instance layout column"* and *"for media, fill your own tags in if we arent
// getting them from the source list … media tag field if needed"*.
//
// ── THE TILE HALF IS SCOPED BY A MEASUREMENT, NOT BY THE WORD "MEDIA" ───────
// A tile is a picture with a caption. A tile with no picture is just a taller
// row, so the boards that get one are the boards that HAVE artwork. Measured on
// poms grid before choosing:
//
//   Readings      9 rows    7 with artwork      -> tiles
//   Courses       4 rows    4 with artwork      -> tiles
//   Media         6 rows    5 with artwork      -> tiles
//   song       5490 rows    5 with artwork      -> NO
//   album      2757 rows    0                   -> NO
//   artist     1595 rows    0                   -> NO
//   book (Calibre) 666      0                   -> NO
//
// The Spotify and Calibre imports carry no cover art at all, so tiling them
// would produce ten thousand empty boxes — strictly worse than the rows they
// have now. That is reported to the user rather than done.
//
// **THE LIBRARY BOARD IS DELIBERATELY NOT TILED EITHER**, and this is the one
// that looks like an omission: it holds the 8 movies and 5 podcasts, all with
// artwork — but it holds them alongside **117 reflection questions**, which are
// pure text. One board, one layout, so tiling it would turn every question into
// an empty tile. Movies and podcasts want boards of their own before they can be
// tiles; that is a new surface rather than a layout change, so it is the user's
// call.
//
// ── THE TAGS GET THEIR OWN FIELD ───────────────────────────────────────────
// `Tags` is MIXED — 45 live values, nine of them wellness dimensions and the
// rest board categories that drive real pickers (2026-08-20 (5)) — so putting
// "sci-fi" and "stoicism" in it would swell every one of those dropdowns. The
// user offered the alternative in the same breath ("media tag field if needed"),
// and there is precedent: the Codex import minted `Codex Tags` for exactly this
// reason on 2026-08-23.
//
// **THE VALUES ARE AUTHORED, AND THAT IS ALLOWED HERE FOR A SPECIFIC REASON.**
// A genre is a stable, public property OF THE WORK — the same class `0123` used
// to justify writing a food's vitamin content while REFUSING to write its price
// ("one can be looked up; the other would have been invented"). These are 39
// well-known titles. A price, a phone number or a rating would still be off
// limits.
//
// It never overwrites: a row that already carries media tags keeps them, so a
// re-run fills only gaps and the user's own edits survive.

export const id = "0237-media-tiles-and-tags";

// Fields AND occurrences — the tags are values on rows, so the snapshot cannot
// be fields-only the way 0236's could.
export const touches = ["fields", "occurrences"];

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** The Library select field. Its VALUE is what says "this row is a movie". */
export const LIBRARY_FIELD_ID = "a_ktgSH-Vgh9";

/** Boards that get the tile treatment, by occurrence id, with why. */
export const TILE_BOARDS = [
  ["XRciyA0aST-3", "Readings"],
  ["3d0eYOW2Nm_W", "Courses"],
];

/** The tile shape. `wrap` is what the tracker tiles use — the user's reference. */
export const TILE_LAYOUT = Object.freeze({
  mode: "wrap",
  childContentDirection: "column",
});

/**
 * Authored genre tags, keyed by the row's own label. Only titles that are on
 * the grid today; anything unmatched is REPORTED rather than silently skipped,
 * so a renamed row shows up instead of quietly losing its tags.
 */
export const MEDIA_TAGS = Object.freeze({
  // movies
  "Arrival": ["sci-fi", "drama"],
  "Blade Runner 2049": ["sci-fi", "neo-noir"],
  "Dune": ["sci-fi", "adventure"],
  "Inception": ["sci-fi", "thriller"],
  "Interstellar": ["sci-fi", "drama"],
  "Tenet": ["sci-fi", "thriller"],
  "The Matrix": ["sci-fi", "action"],
  "The Prestige": ["mystery", "drama"],
  // podcasts
  "Conversations with Tyler": ["interview", "economics"],
  "Hardcore History": ["history"],
  "Huberman Lab": ["science", "health"],
  "Lex Fridman Podcast": ["interview", "science"],
  "The Tim Ferriss Show": ["interview", "productivity"],
  // books
  "Atomic Habits": ["self-help", "productivity"],
  "Book of Psalms": ["religion", "poetry"],
  "Deep Work": ["productivity", "self-help"],
  "Man's Search for Meaning": ["memoir", "philosophy"],
  "Meditations": ["philosophy", "stoicism"],
  "Sapiens": ["history", "science"],
  "Tao Te Ching": ["philosophy", "spirituality"],
  "The 4-Hour Workweek": ["business", "productivity"],
  "Thinking, Fast and Slow": ["psychology", "science"],
  // courses
  "Algorithms (Coursera)": ["computer science"],
  "Introduction to Philosophy": ["philosophy"],
  "Machine Learning Specialization": ["machine learning", "computer science"],
  "System Design Primer": ["computer science", "engineering"],
});

/** PURE. Every distinct tag, sorted — the field's option list. */
export function allTagOptions() {
  return [...new Set(Object.values(MEDIA_TAGS).flat())].sort();
}

/** PURE. Merge a stored layout with the tile shape, without dropping other keys. */
export function mergeTileLayout(existing) {
  return { ...(existing || {}), ...TILE_LAYOUT };
}

/**
 * PURE. Which rows should be written, given the media rows and the tag field id.
 * A row is skipped when it already carries a value — never overwrite the user.
 */
export function planTagWrites(rows, tagFieldId) {
  const writes = [], skipped = [], unmatched = [];
  for (const r of rows) {
    const tags = MEDIA_TAGS[r.label];
    if (!tags) { unmatched.push(r.label); continue; }
    const cur = r.fields?.[tagFieldId]?.value;
    if (Array.isArray(cur) ? cur.length : cur) { skipped.push(r.label); continue; }
    writes.push({ id: r.id, label: r.label, tags });
  }
  return { writes, skipped, unmatched: [...new Set(unmatched)] };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field, Module, Occurrence } = models;
  const gid = String(gridId);

  // ── 1. the tag field ──────────────────────────────────────────────────────
  const fields = await Field.find({ gridId: gid }).lean();
  let tagField = fields.find((f) => f.name === "Media Tags");
  const options = allTagOptions();
  log(`media tag options (${options.length}): ${options.join(", ")}`);

  // ── 2. the rows ───────────────────────────────────────────────────────────
  // Scoped by the LIBRARY VALUE, never by label alone: "Dune" could legitimately
  // label something else on this grid, and a global label match is the `0035`
  // selector class that once moved a real project page.
  const MEDIA_KINDS = ["movie", "podcast", "book", "course", "tv show"];
  const rows = await Occurrence.find({
    gridId: gid,
    [`fields.${LIBRARY_FIELD_ID}.value`]: { $in: MEDIA_KINDS },
  }).lean();
  const mods = await Module.find({ gridId: gid, id: { $in: [...new Set(rows.map((r) => r.moduleId))] } }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const withLabels = rows.map((r) => ({ ...r, label: modById[r.moduleId]?.label })).filter((r) => r.label);

  const plan = planTagWrites(withLabels, tagField?.id || "__none__");
  log(`media rows: ${withLabels.length} — to tag ${plan.writes.length}, already tagged ${plan.skipped.length}`);
  if (plan.unmatched.length) log(`  ! no authored tags for: ${plan.unmatched.join(", ")}`);

  // ── 3. the tile boards ────────────────────────────────────────────────────
  const boardIds = TILE_BOARDS.map(([occId]) => occId);
  const boards = await Occurrence.find({ gridId: gid, id: { $in: boardIds } }).lean();
  const found = new Set(boards.map((b) => b.id));
  for (const [occId, name] of TILE_BOARDS) {
    if (!found.has(occId)) log(`  ! board "${name}" (${occId}) not on this grid — skipped`);
  }

  if (dryRun) {
    log(`  would ${tagField ? "REUSE" : "mint"} the "Media Tags" field`);
    for (const b of boards) {
      const cur = b.meta?.layoutCascadeOverride || null;
      log(`  would tile "${TILE_BOARDS.find(([i]) => i === b.id)[1]}": mode=${cur?.mode ?? "-"}->wrap, dir=${cur?.childContentDirection ?? "-"}->column`);
    }
    for (const w of plan.writes.slice(0, 8)) log(`  would tag ${w.label} -> ${w.tags.join(", ")}`);
    if (plan.writes.length > 8) log(`  …and ${plan.writes.length - 8} more`);
    return { tagged: plan.writes.length, tiled: boards.length };
  }

  // mint the field if absent
  if (!tagField) {
    const userId = fields[0]?.userId;
    const fid = uid();
    await Field.create({
      id: fid, userId, gridId: gid, name: "Media Tags", type: "select",
      role: "input", inputEnabled: true,
      meta: { multiSelect: true, allowNewOptions: true, options },
    });
    tagField = { id: fid, name: "Media Tags" };
    log(`  minted field "Media Tags" [select, multi] with ${options.length} options`);
  } else {
    // Union the options so a re-run after new titles does not drop old ones.
    const cur = tagField.meta?.options || [];
    const merged = [...new Set([...cur, ...options])].sort();
    await Field.updateOne({ id: tagField.id, gridId: gid }, { $set: { "meta.options": merged } });
    log(`  reused "Media Tags", options now ${merged.length}`);
  }

  // re-plan against the REAL field id (the first pass used a sentinel when the
  // field did not exist yet, so every row read as untagged)
  const finalPlan = planTagWrites(withLabels, tagField.id);

  // bind the field on every module that owns a media row, or the value is
  // stored and renders nowhere — the `0047` stamped-but-invisible half.
  let bound = 0;
  for (const m of mods) {
    if ((m.fieldBindings || []).some((b) => b.fieldId === tagField.id)) continue;
    const order = (m.fieldBindings || []).length + 200;
    await Module.updateOne({ id: m.id, gridId: gid },
      { $push: { fieldBindings: { fieldId: tagField.id, role: "input", order } } });
    bound++;
  }
  log(`  bound "Media Tags" on ${bound} module(s)`);

  for (const w of finalPlan.writes) {
    await Occurrence.updateOne({ id: w.id, gridId: gid },
      { $set: { [`fields.${tagField.id}`]: { value: w.tags, flow: "in" } } });
  }
  log(`  tagged ${finalPlan.writes.length} row(s)`);

  for (const b of boards) {
    const next = mergeTileLayout(b.meta?.layoutCascadeOverride);
    await Occurrence.updateOne({ id: b.id, gridId: gid },
      { $set: { "meta.layoutCascadeOverride": next } });
    log(`  tiled "${TILE_BOARDS.find(([i]) => i === b.id)[1]}" -> mode=wrap, childContentDirection=column`);
  }

  return { tagged: finalPlan.writes.length, tiled: boards.length, bound };
}
