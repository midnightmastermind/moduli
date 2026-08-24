// utils/providers/dsld.js — supplements, from the NIH Dietary Supplement Label
// Database.
//
// User, 2026-08-24, on their Supplements board: *"idk why vitamin d isnt in
// there though."*
//
// ── THE ANSWER IS A CATEGORY MISMATCH, NOT A LOOKUP FAILURE ────────────────
//
// `0219` paired Supplement with **openFDA**, which indexes FDA-regulated DRUG
// labels. Dietary supplements are regulated as food, so they have no drug label
// and are simply not in that database. Measured, five for five:
//
//     "Creatine"  -> "Colotox"                  a homeopathic remedy
//     "Vitamin D" -> "Silicea"                  a homeopathic remedy
//     "Fish Oil"  -> "Benzalkonium Chloride"    antibacterial hand soap
//     "Magnesium" -> "Esomeprazole Magnesium"   an acid reducer
//     "Zinc"      -> "Zinc Oxide"               diaper cream
//
// Those are not noise — they are correctly-indexed DRUGS, answered to a query
// about a supplement. Open Food Facts was checked as the alternative and is
// only half right: Creatine is perfect there, Vitamin D returns fruit juice.
//
// DSLD is the database built for exactly this, and it is free and keyless.
//
// ── TWO DECISIONS, BOTH FROM MEASURING 25 HITS PER QUERY ───────────────────
//
// **1. OFF-MARKET PRODUCTS ARE DROPPED.** DSLD is an archive as much as a
// catalogue, and most of what it returns is discontinued:
//
//     query          hits   on-market   after dedupe
//     creatine         25      14           12
//     vitamin d        25       4            3
//     fish oil         25      15            9
//     magnesium        25       8            6
//
// Offering a supplement nobody sells is worse than offering nothing, because it
// looks exactly like a real answer. **It FAILS OPEN**: if filtering leaves an
// empty list the off-market rows are returned flagged `(discontinued)`, because
// a niche product that only exists in the archive is still the right answer to
// a query about it — silence would not be.
//
// **2. THE SAME PRODUCT IS LISTED TWICE.** `Creatine Alkaline · BPI Sports`
// comes back as both a current label (43261) and an archived one (25731), and
// `fish oil` collapses 15 rows to 9. A dropdown that lists one product twice is
// unusable, so rows are deduped on brand + product name, keeping the first —
// which, after the on-market sort, is the current label.
//
// The page is over-fetched for the same reason openFDA over-fetches: the dedupe
// collapses many rows into few, so asking for `limit` would return `limit / 2`.

import { normalizeResult, registerProvider, statusError, withRetry } from "../searchProviders.js";

const API = "https://api.ods.od.nih.gov/dsld/v9/search-filter";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };

/** One page of hits. */
async function call(term, size) {
  const url = `${API}?q=${encodeURIComponent(term)}&size=${size}`;
  const once = async () => {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw statusError("dsld", res.status);
    const j = await res.json();
    return Array.isArray(j?.hits) ? j.hits : [];
  };
  return withRetry(once, { attempts: 3, delayMs: 400 });
}

/** PURE. On-market first, then deduped on brand + product name.
 *  Falls back to the off-market rows rather than answering nothing. */
export function rankAndDedupe(hits) {
  const rows = (hits || []).filter((h) => h?._source);
  const live = rows.filter((h) => !h._source.offMarket);
  // FAILS OPEN. An archive-only product is still the right answer; the flag on
  // the row is what keeps the user informed rather than the list empty.
  const pool = live.length ? live : rows;
  const seen = new Set(), out = [];
  for (const h of pool) {
    const s = h._source;
    const key = `${String(s.brandName || "").toLowerCase()}|${String(s.fullName || "").toLowerCase()}`;
    if (key === "|") continue;               // no name at all — cannot be chosen
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

const langual = (v) => (v && typeof v === "object" ? v.langualCodeDescription : null) || null;

/** PURE. The flat field bag for one label. */
export function supplementFields(src) {
  const f = {};
  if (src?.brandName) f["Brand"] = src.brandName;
  const form = langual(src?.physicalState);
  if (form) f["Form"] = form;                                   // "Softgel Capsule"
  const type = langual(src?.productType);
  if (type) f["Product type"] = type;                           // "Single Vitamin and Mineral"
  const net = Array.isArray(src?.netContents) ? src.netContents[0]?.display : null;
  if (net) f["Net contents"] = net;                             // "200 Rapid Release Softgel(s)"
  // Only the NUTRIENTS. `allIngredients` also carries fillers — magnesium
  // stearate, silica — and a list led by its excipients describes the pill
  // rather than what you take it for.
  const nutrients = (src?.allIngredients || [])
    .filter((i) => i && (i.category === "vitamin" || i.category === "mineral" || i.category === "botanical"
                         || i.category === "non-nutrient/non-botanical"))
    .map((i) => i.ingredientGroup || i.name).filter(Boolean);
  const uniq = [...new Set(nutrients)];
  if (uniq.length) f["Ingredients"] = uniq.slice(0, 8).join(", ");
  return f;
}

const toResult = (h) => {
  const s = h._source || {};
  const off = !!s.offMarket;
  return normalizeResult({
    provider: "dsld",
    externalId: h._id,
    title: s.fullName || "",
    // The brand is what tells two "Vitamin D" apart, and `(discontinued)` is
    // never silently dropped — a pick has to be an informed one.
    subtitle: [s.brandName, off ? "discontinued" : null].filter(Boolean).join(" · ") || null,
    url: h._id ? `https://dsld.od.nih.gov/label/${h._id}` : null,
    fields: supplementFields(s),
  });
};

export const dsldProvider = {
  id: "dsld", label: "NIH Supplement Labels", needsKey: false,
  async search(q, { limit = 6 } = {}) {
    const term = String(q || "").trim();
    if (!term) return [];
    // Over-fetched: the dedupe collapses many rows into few (fish oil, 15 -> 9).
    const hits = await call(term, Math.min(50, Math.max(25, limit * 5)));
    return rankAndDedupe(hits).slice(0, limit).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    // The search already carries every field this database exposes, so a detail
    // lookup is a second request for something we hold. It re-queries only when
    // called without one — the contract every other provider keeps.
    const hits = await call(String(title || externalId || ""), 25);
    const ranked = rankAndDedupe(hits);
    const hit = externalId ? (ranked.find((h) => String(h._id) === String(externalId)) || ranked[0]) : ranked[0];
    return hit ? toResult(hit) : null;
  },
};
registerProvider(dsldProvider);
