// 0236 — the last two search providers get somewhere to put their answers
//
// `0228` made all eleven presets live and `0229`-`0235` authored maps for seven
// of them. Four were left returning a bare name, and 2026-08-24 measured WHY:
// for Song and Purchase Item the answer is that they are genuinely unmappable
// today (`Artist`/`Album` are `occurrence`, which is not in `WRITABLE_TYPES`;
// Open Food Facts' `Quantity` is a package size where ours is the shopping
// total). The other two — Supplement and Podcasts Listened — were unmappable
// only because THE FIELDS DID NOT EXIST. The user's call, 2026-08-25: mint them.
//
// ── FUTURE ADDS ONLY. THIS TOUCHES NO EXISTING ROW. ─────────────────────────
// The standing correction from 2026-08-24 (2): *"you didnt have to run my stuff
// through there. this was just for future adds."* Wiring a provider configures
// what happens NEXT; reaching into rows the user typed is a different act. So
// this mints fields and authors maps, and writes to zero occurrences. The
// existing 7 supplements and 5 podcasts keep exactly what they have.
//
// The values land on a row because `createOptionUnderParent` BINDS what it
// writes (`extraIds`, visible, order 200+) when a pick mints the occurrence —
// so a minted field is not the stamped-but-invisible half of the `0047` defect.
//
// ── WHAT IS REUSED RATHER THAN MINTED ───────────────────────────────────────
// The user: *"map these to the closest we have or make fields."* Exactly one
// existing field is close enough to reuse:
//
//   iTunes `Genre`  ->  `Genres` (text)   the same concept, already on the grid
//
// Everything else was checked and REFUSED, because a near-name is not a near
// meaning: `Formats` is a book's epub/pdf list, not a supplement's "Softgel
// Capsule"; `Company` belongs to People; `Ingredient` is an `occurrence` picker
// over the Ingredients board, so DSLD's comma-joined nutrient STRING could not
// be written into it even if the concepts matched (`occurrence` is not
// writable, so the map would be silently skipped forever).
//
// ── THE ONE THAT WOULD HAVE SHIPPED INERT ───────────────────────────────────
// iTunes' `Rating` is `contentAdvisoryRating` — "Clean" / "Explicit" — NOT a
// star rating, despite the key's name. The grid's `Rating` field is
// `type: "rating"`, and `mapProviderFields` runs a rating through
// `parseLeadingNumber`, so "Explicit" would be refused on every single pick and
// the mapping would look configured while doing nothing. It gets its own TEXT
// field named for what it actually is. Same class as the wger muscle-group
// aliases and the vitamin-D IU/mcg mismatch: the provider's vocabulary is not
// ours, and the key's NAME is not evidence about its VALUE.
//
// `TMDB Rating` is the precedent in the other direction — a 0-10 score was given
// its own number field rather than squeezed into the 1-5 stars.

// Scopes the runner's pre-migration snapshot. This writes to `Field` and to
// NOTHING else — no occurrence is read or touched — so the snapshot has no
// reason to pull 18,177 occurrences through a ~100 KB/s connection (0235's own
// scoping took that run from 5m15s to 3.4s).
export const id = "0236-supplement-and-podcast-field-maps";

export const touches = ["fields"];

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Fields to mint when absent: [name, type]. */
export const NEW_FIELDS = [
  // DSLD (Supplement)
  ["Brand", "text"],
  ["Form", "text"],
  ["Product type", "text"],
  ["Net contents", "text"],
  ["Ingredients", "text"],
  // iTunes (Podcasts Listened). `Genre` is NOT here — it reuses `Genres`.
  ["Publisher", "text"],
  ["Episodes", "number"],
  ["Latest episode", "date"],
  ["Content rating", "text"],
];

/** provider key -> the field NAME it writes into, per target field. */
export const TARGETS = [
  {
    field: "Supplement",
    provider: "dsld",
    keyToField: {
      "Brand": "Brand",
      "Form": "Form",
      "Product type": "Product type",
      "Net contents": "Net contents",
      "Ingredients": "Ingredients",
    },
  },
  {
    field: "Podcasts Listened",
    provider: "itunes",
    keyToField: {
      "Publisher": "Publisher",
      "Genre": "Genres",              // REUSED — the closest we have
      "Episodes": "Episodes",
      "Latest episode": "Latest episode",
      "Rating": "Content rating",     // Clean/Explicit — see the header
      // `Feed` is deliberately unmapped: a podcast's RSS url is plumbing, and
      // nothing on this grid renders or follows one.
    },
  },
];

/** PURE. Which of NEW_FIELDS are missing, given a Set of existing names. */
export function fieldsToMint(have) {
  return NEW_FIELDS.filter(([name]) => !have.has(name));
}

/**
 * PURE. provider key -> field id, given fields resolved by name.
 * Returns `missing` so a caller can refuse rather than author a partial map —
 * a map with a hole in it reports as configured and drops that key silently.
 */
export function buildFieldMap(fieldsByName, keyToField) {
  const map = {}, missing = [];
  for (const [key, name] of Object.entries(keyToField)) {
    const f = fieldsByName.get(name);
    if (!f) { missing.push(name); continue; }
    map[key] = f.id;
  }
  return { map, missing };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  // Resolve every target FIRST and refuse the whole run if one is misconfigured.
  // Half-authoring leaves the grid in a state no re-run reports on.
  const plan = [];
  for (const t of TARGETS) {
    const target = byName.get(t.field);
    if (!target) { log(`no "${t.field}" field on this grid — skipped`); continue; }
    const cfg = target.meta?.optionsSource?.searchProvider;
    if (cfg?.provider !== t.provider) {
      log(`  "${t.field}" carries ${cfg?.provider || "no provider"}, not ${t.provider} — skipped`);
      continue;
    }
    if (Object.keys(cfg.fieldMap || {}).length) {
      log(`  ! "${t.field}" already carries a map — it will be REPLACED`);
    }
    plan.push({ ...t, target });
  }
  if (!plan.length) { log("nothing to author"); return { minted: 0, authored: 0 }; }

  const mint = fieldsToMint(new Set(fields.map((f) => f.name)));
  log(`fields to mint: ${mint.map((f) => f[0]).join(", ") || "(none — all present)"}`);

  if (dryRun) {
    // Report the map it WOULD write, resolving what exists and naming what does
    // not — a plan whose every target reads "(new)" says nothing about a re-run.
    for (const p of plan) {
      const preview = Object.entries(p.keyToField)
        .map(([k, n]) => `${k}->${byName.get(n)?.id || "(new)"}`).join(", ");
      log(`  would author "${p.field}": ${preview}`);
    }
    return { minted: mint.length, authored: plan.length };
  }

  const userId = fields[0]?.userId;
  for (const [name, type] of mint) {
    await Field.create({ id: uid(), userId, gridId: gid, name, type,
      role: "input", inputEnabled: true, meta: {} });
    log(`  minted field "${name}" [${type}]`);
  }

  const fresh = await Field.find({ gridId: gid }).lean();
  const freshByName = new Map(fresh.map((f) => [f.name, f]));
  let authored = 0;
  for (const p of plan) {
    const { map, missing } = buildFieldMap(freshByName, p.keyToField);
    if (missing.length) throw new Error(`0236: fields missing after mint for "${p.field}": ${missing.join(", ")}`);
    await Field.updateOne({ id: p.target.id, gridId: gid },
      { $set: { "meta.optionsSource.searchProvider.fieldMap": map } });
    log(`authored "${p.field}": ${Object.entries(map).map(([k, v]) => `${k}->${v}`).join(", ")}`);
    authored++;
  }
  return { minted: mint.length, authored };
}
