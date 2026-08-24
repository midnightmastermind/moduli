// utils/providers/openfoodfacts.js — groceries and ingredients, from Open Food Facts.
//
// User, 2026-08-24: *"movies, book, music, groceries, ingredients"*. This is the
// one that fills real numbers: a picked product brings its per-100g macros, and
// those map straight onto the macro fields the Ingredients board already binds.
//
// ── TWO THINGS ABOUT THIS API, BOTH FOUND BY CALLING IT ────────────────────
//
// 1. **The v2 search endpoint answers with an HTML "Page temporarily
//    unavailable"**, not JSON. The v1 CGI endpoint works. A provider pointed at
//    v2 would throw a JSON parse error that reads like a bug in this file.
// 2. **The request needs a contact in the User-Agent and an explicit
//    `Accept: application/json`.** Without them the same v1 URL also answers
//    HTML — which is exactly how the first probe failed.
//
// Nutriments are PER 100g, and the field names say so, because a number whose
// unit is implied is the class this repo has already paid for once (the vitamin
// D target that was IU while every stored value was mcg).

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://world.openfoodfacts.org/cgi/search.pl";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };
const FIELDS = "code,product_name,brands,quantity,nutriments,image_small_url,categories";

export function foodFields(p) {
  const n = p?.nutriments || {}, f = {};
  const put = (label, v, unit) => {
    if (v === undefined || v === null || v === "") return;
    // Rounded: the API returns full float precision, so energy comes back as
    // "96.1759082217972 kcal". A number carrying twelve meaningless decimals
    // reads as a bug in the reader, and the field it lands in is a macro nobody
    // measures past one decimal anyway.
    const n = Number(v);
    const shown = Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v);
    f[label] = unit ? `${shown} ${unit}` : shown;
  };
  if (p?.brands) f["Brand"] = p.brands;
  if (p?.quantity) f["Quantity"] = p.quantity;
  if (p?.categories) f["Categories"] = String(p.categories).split(",").slice(0, 4).join(", ").trim();
  // The "per 100g" is IN THE NAME. A macro with an implied basis is how a value
  // ends up compared against a target measured a different way.
  put("Calories per 100g", n["energy-kcal_100g"], "kcal");
  put("Protein per 100g", n.proteins_100g, "g");
  put("Carbs per 100g", n.carbohydrates_100g, "g");
  put("Fat per 100g", n.fat_100g, "g");
  put("Fiber per 100g", n.fiber_100g, "g");
  put("Sugars per 100g", n.sugars_100g, "g");
  put("Salt per 100g", n.salt_100g, "g");
  return f;
}

const toResult = (p) => normalizeResult({
  provider: "openfoodfacts", externalId: p.code, title: p.product_name || "",
  subtitle: [p.brands, p.quantity].filter(Boolean).join(" · ") || null,
  thumbnail: p.image_small_url || null,
  url: p.code ? `https://world.openfoodfacts.org/product/${p.code}` : null,
  fields: foodFields(p),
});

async function call(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`openfoodfacts ${res.status}`);
  const text = await res.text();
  // The endpoint answers HTML when it is unhappy; say so rather than letting
  // JSON.parse throw something that reads like a bug in this file.
  if (text.trimStart().startsWith("<")) throw new Error("openfoodfacts returned HTML, not JSON");
  return JSON.parse(text);
}

export const openFoodFactsProvider = {
  id: "openfoodfacts", label: "Open Food Facts (groceries)", needsKey: false,
  async search(q, { limit = 6 } = {}) {
    const j = await call(`${API}?search_terms=${encodeURIComponent(String(q || ""))}`
      + `&search_simple=1&action=process&json=1&page_size=${limit}&fields=${FIELDS}`);
    // A product with no name is a barcode nobody has filled in — it cannot be
    // chosen meaningfully, so it is not offered.
    return (j.products || []).filter((p) => p.product_name).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    if (externalId) {
      const j = await call(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(externalId)}.json?fields=${FIELDS}`);
      return j?.product ? toResult({ ...j.product, code: externalId }) : null;
    }
    return (await this.search(title, { limit: 1 }))[0] || null;
  },
};
registerProvider(openFoodFactsProvider);
