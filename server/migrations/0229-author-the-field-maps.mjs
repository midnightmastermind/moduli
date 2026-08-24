// 0229 — the three field maps that are verified against a live response.
//
// `0228` made the eleven providers visible to the dropdown. Every one still
// carries `fieldMap: {}`, so a picked result mints a row with a TITLE and
// nothing else — which is the half of the feature the user asked for ("we have
// prefilled fields that come with those new occurances").
//
// ── ONLY WHAT WAS PROBED AGAINST THE REAL API ─────────────────────────────
//
// Each key below was read off a live response, not from documentation:
//
//     openlibrary "Dune"       -> Author | First published | Pages | Publisher | Subjects
//     wger detail "bench press"-> Category | Muscles | Secondary muscles | Equipment | Description
//
// ── AND `Category` IS THE WGER KEY, NOT `Muscles` ─────────────────────────
//
// The obvious mapping is `Muscles` -> `Muscle Group`, and it is wrong.
// Measured: `Muscles` answers "Quads", "Lats", "Obliquus externus abdominis,
// Abs" — anatomy, which `Muscle Group`'s options are not. `Category` answers
// Chest/Legs/Back/Arms/Shoulders/Cardio, and **six of its eight values land on
// an option by name.** The other two get an AUTHORED alias (`Abs` -> core,
// `Calves` -> legs); anything else is refused by the select guard rather than
// written, because a value absent from a select renders blank and is written
// away as null on the next edit.
//
// ── WHAT IS DELIBERATELY NOT MAPPED, AND WHY ──────────────────────────────
//
//     Location   `Address` is type `address`, which the mapper cannot write
//     Song       `Artist` is an `occurrence`, same
//     Ingredient Open Food Facts is answering 503 — no key list to map from
//     Movies     TMDB_API_KEY is not set, so it cannot be probed at all
//     Podcasts · Medication · Supplement · Purchase Item
//                their rows bind ONLY Board Category, Poster and Files, so
//                there is nothing on those boards to receive a value
//
// Mapping any of those would be authoring against a guess. They stay empty and
// the reasons are here rather than in a comment nobody finds.

export const id = "0229-author-the-field-maps";
export const description = "Author the openlibrary and wger field maps that were verified against a live response";

/** field name -> { provider, map: {providerKey: OUR field name}, aliases }.
 *  Names rather than ids so the plan is readable and resolved per grid. */
export const AUTHORED = [
  { field: "Reading",    provider: "openlibrary", map: { Pages: "Pages" } },
  { field: "Books Read", provider: "openlibrary", map: { Pages: "Pages" } },
  { field: "Movement",   provider: "wger",        map: { Category: "Muscle Group" },
    aliases: { Category: { Abs: "core", Calves: "legs" } } },
];

/** Resolve one authored entry against a grid's fields. PURE.
 *  Returns `{ fieldMap, aliases, missing }` — `missing` names a target field
 *  this grid does not have, so a partial grid is reported rather than half-written. */
export function resolveMap(entry, fieldsByName) {
  const fieldMap = {}; const missing = [];
  for (const [providerKey, ourName] of Object.entries(entry.map || {})) {
    const f = fieldsByName.get(ourName);
    if (!f) { missing.push(ourName); continue; }
    fieldMap[providerKey] = f.id;
  }
  return { fieldMap, aliases: entry.aliases || {}, missing };
}

/**
 * Author a set of entries against one grid. Exported because `0230` authors the
 * Location map the same way — the loop below is the RULE (refuse a mismatched
 * provider, never overwrite an existing map, report a missing target), and a
 * second copy of it is how the two would drift.
 *
 * The behaviour is byte-identical to what `0229` executed; only the seam moved.
 */
export async function authorFieldMaps({ entries, models, gridId, dryRun, log }) {
  const AUTHORED = entries;
  const { Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const plan = [];
  for (const entry of AUTHORED) {
    const target = byName.get(entry.field);
    if (!target) { log(`  no "${entry.field}" field on this grid — skipped`); continue; }
    const cfg = target.meta?.optionsSource?.searchProvider;
    if (cfg?.provider !== entry.provider) {
      // Not the provider this map was written for. Authoring it anyway would
      // point openlibrary's keys at whatever else is configured.
      log(`  "${entry.field}" carries ${cfg?.provider || "no provider"}, not ${entry.provider} — skipped`);
      continue;
    }
    if (Object.keys(cfg.fieldMap || {}).length) { log(`  "${entry.field}" already has a mapping — left alone`); continue; }
    const { fieldMap, aliases, missing } = resolveMap(entry, byName);
    if (missing.length) log(`  ! "${entry.field}" targets missing on this grid: ${missing.join(", ")}`);
    if (!Object.keys(fieldMap).length) { log(`  "${entry.field}" resolved to no targets — skipped`); continue; }
    plan.push({ id: target.id, name: entry.field, fieldMap, aliases });
  }

  if (!plan.length) { log("nothing to author"); return { authored: 0 }; }
  for (const p of plan) {
    log(`  ${dryRun ? "would author" : "authoring"} "${p.name}": `
      + Object.entries(p.fieldMap).map(([k, v]) => `${k}->${v}`).join(", ")
      + (Object.keys(p.aliases).length ? ` · aliases ${JSON.stringify(p.aliases)}` : ""));
  }
  if (dryRun) return { authored: plan.length };

  for (const p of plan) {
    const $set = { "meta.optionsSource.searchProvider.fieldMap": p.fieldMap };
    if (Object.keys(p.aliases).length) $set["meta.optionsSource.searchProvider.valueAliases"] = p.aliases;
    await Field.updateOne({ id: p.id, gridId: gid }, { $set });
  }
  log(`authored ${plan.length} field map(s)`);
  return { authored: plan.length };
}

export async function up(ctx) {
  return authorFieldMaps({ entries: AUTHORED, ...ctx });
}
