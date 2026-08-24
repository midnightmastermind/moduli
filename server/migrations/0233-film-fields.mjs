// 0233 — the Movies board gets fields, now that there is a key to fill them.
//
// User supplied `TMDB_API_KEY` on 2026-08-24, which was the one thing blocking
// the last unmapped provider. Probed live before authoring anything:
//
//     "Inception" -> Director | Writer | Cast | Released | Runtime | Genres
//                    Rating | Tagline
//
// ── THE BOARD IS EMPTY, WHICH MAKES THIS THE EASY CASE ────────────────────
//
// `Movies Watched` scopes to `Board Category IS "movie"` and the grid holds
// **0** such rows. So nothing existing gains an empty pill: every field here
// appears on rows that arrive already carrying a value, because
// `createOptionUnderParent` binds what it writes.
//
// ── FIVE OF THE EIGHT KEYS, AND THE THREE LEFT OUT ARE LEFT OUT LOUDLY ────
//
//   Cast     five names and a comma each — a paragraph in a row pill
//   Writer   usually a repeat of Director, and three names when it is not
//   Tagline  flavour text ("Your mind is the scene of the crime")
//
// None is wrong, all three are clutter on a board row, and every one is a
// single edit away in the field editor now that the mapping UI exists. Naming
// them here beats discovering later that nobody decided.
//
// ── `Released` IS A REAL DATE FIELD, AND THAT NEEDED THE MAPPER TO LEARN IT ─
//
// All thirteen `date` fields on this grid store a plain "YYYY-MM-DD" string and
// TMDB answers in exactly that shape, so the write is honest. The mapper now
// REFUSES anything else — TMDB answers a bare year for an unreleased film, and
// "2010" in a date field is a row no date filter can see.
//
// ── AND THE RATING FIELD SAYS WHOSE IT IS ─────────────────────────────────
//
// `TMDB Rating` rather than `Rating`. The grid already has a `Rating` field of
// type `rating` — a 1-5 star control — and TMDB's is 0-10. Two numbers on
// different scales under one name is the vitamin-D mismatch wearing a new hat.
// Field names need not be unique here (the user retired that rule the same
// day), so this is a clarity choice rather than a forced one.

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0233-film-fields";
export const description = "Film fields on the Movies board, and the TMDB map that fills them";

/** our field name -> [type, unit|null] */
export const NEW_FIELDS = [
  ["Director", "text", null],
  ["Released", "date", null],
  ["Runtime", "number", "min"],
  ["Genres", "text", null],
  ["TMDB Rating", "number", "/10"],
];

/** provider key -> our field name. TMDB's own casing, verified live. */
export const KEY_TO_FIELD = {
  Director: "Director",
  Released: "Released",
  Runtime: "Runtime",
  Genres: "Genres",
  Rating: "TMDB Rating",
};

/** PURE. What a grid that already has `have` (a Set of names) still needs. */
export function fieldsToMint(have) {
  return NEW_FIELDS.filter(([name]) => !have.has(name));
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const target = byName.get("Movies Watched");
  if (!target) { log("no \"Movies Watched\" field on this grid — nothing to do"); return { minted: 0 }; }
  const cfg = target.meta?.optionsSource?.searchProvider;
  if (cfg?.provider !== "tmdb") {
    log(`  "Movies Watched" carries ${cfg?.provider || "no provider"}, not tmdb — skipped`);
    return { minted: 0 };
  }

  const mint = fieldsToMint(new Set(fields.map((f) => f.name)));
  log(`fields to mint: ${mint.map((f) => f[0]).join(", ") || "(none — all present)"}`);
  if (Object.keys(cfg.fieldMap || {}).length) log("  ! already carries a map — it will be REPLACED");
  if (dryRun) {
    log(`  would author: ${Object.entries(KEY_TO_FIELD)
      .map(([k, n]) => `${k}->${byName.get(n)?.id || "(new)"}`).join(", ")}`);
    return { minted: mint.length };
  }

  const userId = fields[0]?.userId;
  for (const [name, type, unit] of mint) {
    await Field.create({ id: uid(), userId, gridId: gid, name, type,
      role: "input", inputEnabled: true, meta: unit ? { unit } : {} });
    log(`  minted field "${name}" [${type}]${unit ? ` unit=${unit}` : ""}`);
  }

  const fresh = new Map((await Field.find({ gridId: gid }).lean()).map((f) => [f.name, f]));
  const map = {};
  for (const [key, name] of Object.entries(KEY_TO_FIELD)) {
    const f = fresh.get(name);
    if (!f) throw new Error(`0233: field missing after mint: ${name}`);
    map[key] = f.id;
  }
  await Field.updateOne({ id: target.id, gridId: gid },
    { $set: { "meta.optionsSource.searchProvider.fieldMap": map } });
  log(`authored "Movies Watched": ${Object.entries(map).map(([k, v]) => `${k}->${v}`).join(", ")}`);
  return { minted: mint.length, mapped: Object.keys(map).length };
}
