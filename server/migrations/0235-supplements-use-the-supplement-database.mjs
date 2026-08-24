// 0235 — the Supplement dropdown stops asking a DRUG database about vitamins.
//
// User, 2026-08-24: *"idk why vitamin d isnt in there though."*
//
// **IT IS A CATEGORY MISMATCH, NOT A LOOKUP FAILURE.** `0219` paired Supplement
// with openFDA, which indexes FDA-regulated DRUG labels. Dietary supplements
// are regulated as food and have no drug label, so they are simply not in it.
// What DID come back was correctly-indexed drugs answered to a supplement
// query — "Vitamin D" -> *Silicea*, "Fish Oil" -> *Benzalkonium Chloride*.
//
// Open Food Facts was measured as the alternative and is only half right:
// Creatine is perfect there, Vitamin D returns fruit juice and protein bars.
// The NIH Dietary Supplement Label Database is the one built for this, and the
// same five queries now answer:
//
//     vitamin d   Vitamin D · Endo-met · Calcium Citrate Plus Vitamin D · CVS
//     creatine    Creatine Alkaline · BPI Sports · Optimal Creatine · Seeking Health
//     fish oil    Omega-3 Fish Oil · Spring Valley · Fish Oil · Nature's Bounty
//     magnesium   Magnesium · Nutra Sport · Quad-Magnesium · VitaMonk
//     zinc        Zinc Picolinate · DaVinci · Double Zinc Plus · HPD
//
// ── MEDICATION IS DELIBERATELY UNTOUCHED ──────────────────────────────────
//
// openFDA is the RIGHT database for medications and answers all four of the
// user's correctly. Only the board it was wrong for moves.
//
// ── AND THE FIELD MAP IS LEFT EMPTY, ON THE USER'S OWN FRAMING ────────────
//
// *"this was just for future adds"* — the point is that searching Supplement
// finds a supplement. The board's rows bind only Board Category, Poster and
// Files, so there is nothing to receive a value; DSLD's `detail()` returns
// Brand / Form / Product type / Net contents / Ingredients whenever fields
// exist to hold them.

/** Only `fields` documents are written, so the pre-migration snapshot does not
 *  need to read every occurrence on the grid. The runner scopes it only when
 *  EVERY pending migration declares this. */
export const touches = ["fields"];

export const id = "0235-supplements-use-the-supplement-database";
export const description = "Repoint the Supplement dropdown from openFDA (drug labels) to the NIH supplement database";

export const FROM = "openfda";
export const TO = "dsld";
export const FIELD = "Supplement";

/** PURE. What to do with a field's stored provider config. */
export function planRepoint(cfg) {
  if (!cfg || !cfg.provider) return { act: false, why: "no provider configured" };
  if (cfg.provider === TO) return { act: false, why: `already ${TO}` };
  if (cfg.provider !== FROM) return { act: false, why: `carries ${cfg.provider}, not ${FROM}` };
  // A map authored against openFDA's KEY NAMES cannot describe DSLD's, so
  // carrying it across would leave a map that silently writes nothing.
  return { act: true, clearMap: Object.keys(cfg.fieldMap || {}).length > 0 };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const gid = String(gridId);
  const field = await Field.findOne({ gridId: gid, name: FIELD }).lean();
  if (!field) { log(`no "${FIELD}" field on this grid — nothing to do`); return { repointed: 0 }; }

  const cfg = field.meta?.optionsSource?.searchProvider;
  const plan = planRepoint(cfg);
  if (!plan.act) { log(`  "${FIELD}" ${plan.why} — skipped`); return { repointed: 0 }; }

  log(`  ${dryRun ? "would repoint" : "repointing"} "${FIELD}": ${FROM} -> ${TO}`
    + (plan.clearMap ? " (and clearing a map authored against openFDA's keys)" : ""));
  if (dryRun) return { repointed: 1 };

  const $set = { "meta.optionsSource.searchProvider.provider": TO };
  if (plan.clearMap) $set["meta.optionsSource.searchProvider.fieldMap"] = {};
  await Field.updateOne({ id: field.id, gridId: gid }, { $set });
  log(`repointed "${FIELD}" to ${TO}`);
  return { repointed: 1 };
}
