// 0470 — fill the nutrients your existing ingredients are missing, from USDA (user, 2026-10-31: "Only empty
// values"). Each ingredient row's NAME is searched in FoodData Central (Foundation + SR Legacy) and the first hit
// is used, unless `USDA_MATCH_PATH` (a JSON file { "<label>": fdcId | null }) names a different food or says skip.
// Only EMPTY fields are written: a per-100g value that is empty takes USDA's; a plain nutrient that is empty
// takes per-100g × Grams ÷ 100 (Grams empty = 100). Nothing you typed is overwritten. Dry run lists every match.
import fs from "node:fs";
export const id = "0470-backfill-ingredients-from-usda";
export const describe = "Fill missing nutrients on existing ingredients from USDA (empty values only).";
export const touches = ["occurrences"];

const BOARD_CATEGORY = "uew6sn6WWXin";
const vOf = (c) => (c && typeof c === "object" && "value" in c ? c.value : c);
const empty = (c) => { const v = vOf(c); return v == null || v === "" || (Array.isArray(v) && !v.length); };
const tagsOf = (o) => { const v = vOf(o.fields?.[BOARD_CATEGORY]); return Array.isArray(v) ? v : v ? [v] : []; };

/** Pure: the field writes for one row. `perByKey` = { "<Label> per 100g": value }; maps from 0469. */
export function planRow(fields, perByKey, { fieldMap, baseOfPer, gramsId }) {
  const out = {};
  const g = Number(vOf(fields?.[gramsId])) || 100;
  for (const [key, perId] of Object.entries(fieldMap)) {
    const raw = perByKey[key];
    const n = raw == null ? null : Number(String(raw).match(/-?\d+(\.\d+)?/)?.[0]);
    const per = empty(fields?.[perId]) ? (Number.isFinite(n) ? n : null) : Number(vOf(fields[perId]));
    if (empty(fields?.[perId]) && per != null) out[perId] = per;
    const base = baseOfPer[perId];
    if (base && empty(fields?.[base]) && per != null && Number.isFinite(per)) out[base] = Math.round(per * g) / 100;
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Occurrence, Operation } = models;
  const { usdaProvider } = await import("../utils/providers/usda.js");
  const ing = await Field.findOne({ gridId, name: "Ingredient", type: "occurrence" }).lean();
  const fieldMap = ing?.meta?.optionsSource?.searchProvider?.fieldMap;
  if (!fieldMap || ing.meta.optionsSource.searchProvider.provider !== "usda") throw new Error("run 0469 first");
  const grams = await Field.findOne({ gridId, name: "Grams" }).lean();
  const scale = await Operation.findOne({ gridId, name: "Ingredients: Scale to Grams" }).lean();
  const baseOfPer = {};
  const walk = (steps) => { for (const s of steps || []) {
    if (s.type === "if") {
      const per = s.condition?.rules?.[0]?.left?.match(/^\$item\.fields\.([^.]+)\.value$/)?.[1];
      const up = (s.then || []).find((t) => t.config?.type === "UPDATE");
      const base = up?.config?.path?.match(/^\$item\.fields\.([^.]+)\.value$/)?.[1];
      if (per && base) baseOfPer[per] = base;
    }
  } };
  walk(scale?.pipeline?.steps);
  // The user's own key (Search sources) when they have set one — the demo key allows ~30 lookups an hour.
  const { default: Grid } = await import("../models/Grid.js");
  const owner = String((await Grid.findById(gridId).select("userId").lean())?.userId || "");
  const { userSearchKeys } = await import("../services/searchKeys.js");
  const key = (await userSearchKeys(owner)).usda || process.env.USDA_API_KEY || undefined;
  const overrides = process.env.USDA_MATCH_PATH ? JSON.parse(fs.readFileSync(process.env.USDA_MATCH_PATH, "utf8")) : {};

  const occs = await Occurrence.find({ gridId, [`fields.${BOARD_CATEGORY}`]: { $exists: true }, "meta.feedSourceId": { $exists: false } }).lean();
  // A row whose name is the board's own ("Ingredients") is not an ingredient.
  const rows = occs.filter((o) => tagsOf(o).includes("ingredient") && !/^ingredients?$/i.test(o.label || ""));
  const { default: Module } = await import("../models/Module.js");
  const mods = new Map((await Module.find({ gridId, id: { $in: rows.map((r) => r.moduleId) } }).select("id label").lean()).map((m) => [m.id, m]));
  let writes = 0;
  for (const o of rows) {
    const label = o.label || mods.get(o.moduleId)?.label || "";
    if (label in overrides && overrides[label] == null) { log(`  ${label.padEnd(26)} SKIPPED (override)`); continue; }
    let hit = null;
    try {
      hit = overrides[label] ? await usdaProvider.detail({ externalId: overrides[label] }, { key }) : (await usdaProvider.search(label, { limit: 1, key }))[0];
    } catch (e) { log(`  ${label.padEnd(26)} USDA error: ${e.message}`); continue; }
    if (!hit) { log(`  ${label.padEnd(26)} no USDA match`); continue; }
    const plan = planRow(o.fields || {}, hit.fields, { fieldMap, baseOfPer, gramsId: grams.id });
    const n = Object.keys(plan).length;
    writes += n;
    log(`  ${label.padEnd(26)} -> ${hit.title} (fdc ${hit.externalId}) · ${n} empty fields filled`);
    if (!dryRun && n) {
      const set = {};
      for (const [fid, v] of Object.entries(plan)) set[`fields.${fid}`] = { value: v, flow: "in" };
      await Occurrence.updateOne({ gridId, id: o.id }, { $set: { ...set, updatedAt: new Date() } });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  log(`  ${rows.length} ingredients · ${writes} field values${dryRun ? " would be" : ""} written.${dryRun ? "" : " RESTART pm2."}`);
}
