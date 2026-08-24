// 0219 — turn the search feeds on for the dropdowns they obviously belong to.
//
// User, 2026-08-24, choosing between pre-setting the pairings and leaving every
// one to be flipped by hand: *"Pre-set the obvious ones."*
//
// A provider is a DATA choice on a field (`meta.searchProvider`), the same way
// `optionsSource` and `addNew` already are — so this migration writes data and
// adds no mechanism. The field editor's toggle writes the identical key, which
// is what makes every pairing here reversible in the UI rather than by a second
// migration.
//
// ── THE FIELD MAP IS DELIBERATELY LEFT EMPTY ───────────────────────────────
//
// `meta.searchProvider.fieldMap` says which of OUR fields each provider key
// lands in — "Directed by" -> Director, "Published" -> Year. It is authored per
// field and it is NOT guessed here. An unmapped key is dropped, so with no map
// a pick still MINTS the row with its real name and identity and simply writes
// no extra values. Guessing the map is the failure this repo keeps paying for
// (`0035`, `0052`, `0054`): a plausible value nobody entered is indistinguishable
// from one they did.
//
// ── PAIRINGS ARE BY NAME **AND TYPE**, AND THAT IS NOT PEDANTRY ────────────
//
// This grid carries duplicate field names — `0053` had to discriminate by type
// because there are two fields called "Due", and `0077` renamed five display
// twins for the same reason. Every pairing below additionally requires
// `type === "occurrence"`, because a search feed only means anything on a
// dropdown that resolves to rows; stamping it on a text field would render a
// control that mints nothing.
//
// ── MOVIES ARE PAIRED TO TMDB BEFORE THE KEY EXISTS, ON PURPOSE ────────────
//
// The user chose TMDB over Wikipedia for films and is obtaining a key. Pairing
// it now means the feed starts working the moment `TMDB_API_KEY` is set, with
// no second migration to remember. Until then the route answers a distinct
// `provider_unconfigured` 503 naming the missing variable — added in the same
// commit, because without it the field would surface a generic 502 that reads
// as "the movie database is down".

export const id = "0219-preset-search-providers";
export const description = "Pair the obvious dropdowns with their search provider (field maps left empty)";

/**
 * name -> provider. Exported so a test drives the SAME table that ships.
 * Every target must be an `occurrence` field; see the header.
 */
export const PAIRINGS = {
  "Movement":          "wger",
  "Books Read":        "openlibrary",
  "Reading":           "openlibrary",
  "Song":              "musicbrainz",
  "Ingredient":        "openfoodfacts",
  "Purchase Item":     "openfoodfacts",
  "Podcasts Listened": "itunes",
  "Movies Watched":    "tmdb",
  "Location":          "places",
  "Medication":        "openfda",
  "Supplement":        "openfda",
};

/**
 * What this run would do. PURE over the field list, so the plan can be checked
 * against a named expectation before anything is written — the `0035` rule.
 */
export function planPairings(fields, pairings = PAIRINGS) {
  const plan = [], skipped = [];
  for (const [name, provider] of Object.entries(pairings)) {
    const matches = (fields || []).filter((f) => f.name === name);
    if (!matches.length) { skipped.push({ name, why: "no such field" }); continue; }
    for (const f of matches) {
      if (f.type !== "occurrence") { skipped.push({ name, why: `is a ${f.type} field, not a dropdown` }); continue; }
      const already = f.meta?.searchProvider?.provider;
      // NEVER overwrite a pairing that is already there — it is the user's, and
      // this migration is re-runnable as new fields appear.
      if (already) { skipped.push({ name, why: `already paired with ${already}` }); continue; }
      plan.push({ fieldId: f.id, name, provider });
    }
  }
  return { plan, skipped };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const fields = await Field.find({ gridId: String(gridId) }).lean();
  const { plan, skipped } = planPairings(fields);

  log(`${fields.length} fields on the grid`);
  for (const s of skipped) log(`  skip  ${s.name} — ${s.why}`);
  for (const p of plan)    log(`  pair  ${p.name} -> ${p.provider}`);
  log(`${plan.length} to pair, ${skipped.length} skipped`);
  if (dryRun || !plan.length) return { paired: plan.length, skipped: skipped.length };

  for (const p of plan) {
    // Written key by key rather than as a whole `meta`, because these fields
    // carry `optionsSource` and `addNew` and replacing meta wholesale would
    // delete the dropdown's own configuration.
    await Field.updateOne({ id: p.fieldId, gridId: String(gridId) }, {
      $set: {
        "meta.searchProvider.provider": p.provider,
        // Explicitly empty, so the shape the editor reads is present and the
        // "no mapping yet" state is a fact rather than an absent key.
        "meta.searchProvider.fieldMap": {},
      },
    });
  }
  return { paired: plan.length, skipped: skipped.length };
}
