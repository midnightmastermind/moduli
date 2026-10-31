// utils/providers/usda.js — whole foods and their full nutrient panel, from USDA FoodData Central.
//
// User, 2026-10-31: ingredients should pull their nutrition from a search. Open Food Facts is a database of
// PACKAGED products (mostly European): "spinach" answered "Epinards hachés à la crème fraîche", with vitamin A,
// C, iron and magnesium all 0 — values nobody entered, reading as real zeros. FoodData Central's Foundation and
// SR Legacy sets are the generic foods ("Spinach, raw": 105 nutrients), always per 100g.
//
// The key: the user's (Command Center › Imports › Search sources), else USDA_API_KEY, else USDA's public
// DEMO_KEY (works, rate-limited per IP). Free key: https://api.data.gov/signup/
//
// Every value is PER 100g and named so ("Iron per 100g"), in the unit the grid's nutrient fields use
// (mg / mcg / g / kcal), converted from what USDA reports.

import { normalizeResult, registerProvider, statusError, withRetry } from "../searchProviders.js";

const API = "https://api.nal.usda.gov/fdc/v1";
const DATA_TYPES = "Foundation,SR Legacy";

// [label, USDA nutrient numbers (first found wins, unless `sum`), output unit, sum?]
export const NUTRIENTS = [
  ["Calories", ["208", "957", "958"], "kcal"],
  ["Protein", ["203"], "g"],
  ["Carbs", ["205"], "g"],
  ["Fat", ["204"], "g"],
  ["Fiber", ["291"], "g"],
  ["Vitamin A", ["320"], "mcg"],
  ["Vitamin C", ["401"], "mg"],
  ["Vitamin D", ["328"], "mcg"],
  ["Vitamin E", ["323"], "mg"],
  ["Vitamin K", ["430"], "mcg"],
  ["Thiamin", ["404"], "mg"],
  ["Riboflavin", ["405"], "mg"],
  ["Niacin", ["406"], "mg"],
  ["Pantothenic Acid", ["410"], "mg"],
  ["Vitamin B6", ["415"], "mg"],
  ["Biotin", ["416"], "mcg"],
  ["Folate", ["435", "417"], "mcg"],
  ["Vitamin B12", ["418"], "mcg"],
  ["Calcium", ["301"], "mg"],
  ["Iron", ["303"], "mg"],
  ["Magnesium", ["304"], "mg"],
  ["Potassium", ["306"], "mg"],
  ["Sodium", ["307"], "mg"],
  ["Zinc", ["309"], "mg"],
  // ALA (851 in Foundation, 619 "18:3" in SR Legacy) + EPA + DPA + DHA — each entry a list of alternatives
  ["Omega-3", [["851", "619"], ["629"], ["631"], ["621"]], "mg", true],
];

const TO_BASE = { g: 1, mg: 1e-3, ug: 1e-6, "µg": 1e-6, mcg: 1e-6, kcal: 1, kj: 1 / 4.184 };
function convert(value, fromUnit, toUnit) {
  const f = String(fromUnit || "").toLowerCase();
  const t = String(toUnit || "").toLowerCase();
  if (f === t || (t === "kcal" && f === "kcal")) return value;
  if (t === "kcal") return f === "kj" ? value / 4.184 : value;
  if (!(f in TO_BASE) || !(t in TO_BASE)) return value;
  return (value * TO_BASE[f]) / TO_BASE[t];
}

const round = (n) => (Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);

/** USDA nutrient rows (search or abridged detail shape) -> { "<Label> per 100g": "<n> <unit>" }. Pure. */
export function nutrientFields(rows) {
  const byNum = new Map();
  for (const r of rows || []) {
    const num = String(r.nutrientNumber ?? r.number ?? r.nutrient?.number ?? "");
    const value = Number(r.value ?? r.amount);
    const unit = r.unitName ?? r.nutrient?.unitName;
    if (!num || !Number.isFinite(value)) continue;
    if (!byNum.has(num)) byNum.set(num, { value, unit });
  }
  const f = {};
  for (const [label, nums, unit, sum] of NUTRIENTS) {
    let out = null;
    if (sum) {
      const found = nums.map((alts) => alts.map((n) => byNum.get(n)).find(Boolean)).filter(Boolean);
      if (found.length) out = found.reduce((a, x) => a + convert(x.value, x.unit, unit), 0);
    } else {
      const x = nums.map((n) => byNum.get(n)).find(Boolean);
      if (x) out = convert(x.value, x.unit, unit);
    }
    if (out != null) f[`${label} per 100g`] = `${round(out)} ${unit}`;
  }
  return f;
}

async function call(path, params, key) {
  const k = key || process.env.USDA_API_KEY || "DEMO_KEY";
  const once = async () => {
    const res = await fetch(`${API}${path}?api_key=${encodeURIComponent(k)}${params ? `&${params}` : ""}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (res.status === 403) throw new Error("USDA rejected the key");
    if (res.status === 429) throw Object.assign(new Error("USDA rate limit — add your own key in Search sources"), { retryable: false });
    if (!res.ok) throw statusError("usda", res.status);
    return res.json();
  };
  return withRetry(once, { attempts: 2, delayMs: 400 });
}

/** USDA's relevance order puts "Croissants, apple" ahead of "Apples, raw". Rank: the description starts with
 *  the query (or its singular/plural), then a raw food, then the shortest description. Pure, stable. */
export function rankFoods(foods, q) {
  const words = String(q || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const head = words[0] || "";
  const stem = head.replace(/(ies|es|s)$/, "");
  const score = (f) => {
    const d = String(f.description || "").toLowerCase();
    const first = d.split(/[ ,]/)[0];
    let s = 0;
    if (first === head || first.replace(/(ies|es|s)$/, "") === stem) s += 4;
    else if (d.startsWith(stem)) s += 2;
    if (words.every((w) => d.includes(w.replace(/(ies|es|s)$/, "")))) s += 2;
    if (/\braw\b/.test(d)) s += 1;
    return s;
  };
  return foods.map((f, i) => ({ f, i, s: score(f), n: String(f.description || "").length }))
    .sort((a, b) => b.s - a.s || a.n - b.n || a.i - b.i).map((x) => x.f);
}

const toResult = (food) => normalizeResult({
  provider: "usda",
  externalId: food.fdcId,
  title: food.description || "",
  subtitle: [food.dataType, food.foodCategory?.description || food.foodCategory].filter((x) => typeof x === "string" && x).join(" · ") || null,
  thumbnail: null,
  url: food.fdcId ? `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients` : null,
  fields: nutrientFields(food.foodNutrients),
});

export const usdaProvider = {
  id: "usda", label: "USDA FoodData Central (ingredients)", needsKey: true,
  apiKey: { id: "usda", env: "USDA_API_KEY", demo: "DEMO_KEY", label: "USDA FoodData Central API key",
    getUrl: "https://api.data.gov/signup/" },
  async search(q, { limit = 6, key } = {}) {
    const j = await call("/foods/search",
      `query=${encodeURIComponent(String(q || ""))}&dataType=${encodeURIComponent(DATA_TYPES)}&pageSize=25`, key);
    return rankFoods(j.foods || [], q).slice(0, limit).map(toResult);
  },
  async detail({ title, externalId } = {}, { key } = {}) {
    if (externalId) {
      const food = await call(`/food/${encodeURIComponent(externalId)}`, "format=abridged", key);
      return food ? toResult(food) : null;
    }
    return (await this.search(title, { limit: 1, key }))[0] || null;
  },
};
registerProvider(usdaProvider);
