// 0478 — "Zucchini Peppers Onions" becomes three ingredients (user, 2026-10-31: "split up zucchini peppers and
// onions"). Checked first: nothing picks the combined row (no meal, no Eat row); only the Ingredients board lists it.
// Each new row gets its own module shaped like the old one (same bindings), sits where the old row sat, and is
// filled from USDA by 0470's planRow (per-100g values + the plain nutrients at the default 100g). Zucchini keeps the
// old row's three pictures (all sautéed zucchini). Then the combined row and its module are deleted.
// Needs the user's USDA key, so it runs on the server (the key decrypts only with prod's SECRETS_KEY).
import { randomUUID } from "node:crypto";
import { planRow } from "./0470-backfill-ingredients-from-usda.mjs";
export const id = "0478-split-zucchini-peppers-onions";
export const describe = "Split the combined Zucchini Peppers Onions ingredient into three USDA-filled ingredients.";
export const touches = ["occurrences", "modules"];

const OLD = "d840feec-0b25-47d8-b100-eb1b26e07c43";
const BOARD = "0JBLJFaWRmAc";
const BOARD_CATEGORY = "uew6sn6WWXin";
const PARTS = [
  { label: "Zucchini", fdc: 169291, keepPictures: true },
  { label: "Bell Peppers", fdc: 170108 },
  { label: "Onions", fdc: 170000 },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Grid } = models;
  const old = await Occurrence.findOne({ gridId, id: OLD }).lean();
  if (!old) { log("  already split — nothing to do"); return; }
  const oldMod = await Module.findOne({ gridId, id: old.moduleId }).lean();
  const board = await Occurrence.findOne({ gridId, id: BOARD }).lean();
  const otherPlacements = await Occurrence.countDocuments({ gridId, moduleId: old.moduleId, id: { $ne: OLD } });
  const ing = await Field.findOne({ gridId, name: "Ingredient", type: "occurrence" }).lean();
  const fieldMap = ing?.meta?.optionsSource?.searchProvider?.fieldMap;
  const grams = await Field.findOne({ gridId, name: "Grams" }).lean();
  const filesField = await Field.findOne({ gridId, name: "Files" }).lean();
  const posterField = await Field.findOne({ gridId, name: "Poster" }).lean();
  const scale = await Operation.findOne({ gridId, name: "Ingredients: Scale to Grams" }).lean();
  if (!fieldMap || !grams || !scale) throw new Error("run 0469 first");
  const baseOfPer = {};
  for (const s of scale.pipeline.steps) if (s.type === "if") {
    const per = s.condition?.rules?.[0]?.left?.match(/^\$item\.fields\.([^.]+)\.value$/)?.[1];
    const base = (s.then || []).find((t) => t.config?.type === "UPDATE")?.config?.path?.match(/^\$item\.fields\.([^.]+)\.value$/)?.[1];
    if (per && base) baseOfPer[per] = base;
  }
  const { default: GridModel } = await import("../models/Grid.js");
  const owner = String((await GridModel.findById(gridId).select("userId").lean())?.userId || "");
  const { userSearchKeys } = await import("../services/searchKeys.js");
  const key = (await userSearchKeys(owner)).usda || process.env.USDA_API_KEY;
  const { usdaProvider } = await import("../utils/providers/usda.js");

  const rows = [];
  for (const p of PARTS) {
    const hit = await usdaProvider.detail({ externalId: p.fdc }, { key });
    if (!hit) throw new Error(`no USDA food ${p.fdc}`);
    const fields = { [BOARD_CATEGORY]: { value: ["ingredient"], flow: "in" } };
    for (const [fid, v] of Object.entries(planRow({}, hit.fields, { fieldMap, baseOfPer, gramsId: grams.id }))) fields[fid] = { value: v, flow: "in" };
    if (p.keepPictures) {
      if (filesField && old.fields?.[filesField.id]) fields[filesField.id] = old.fields[filesField.id];
      if (posterField && old.fields?.[posterField.id]) fields[posterField.id] = old.fields[posterField.id];
    }
    rows.push({ p, hit, fields, modId: randomUUID(), occId: randomUUID() });
    log(`  ${p.label.padEnd(13)} <- ${hit.title} (fdc ${p.fdc}) · ${Object.keys(fields).length} fields${p.keepPictures ? " · keeps the 3 pictures" : ""}`);
  }
  log(`  removes the combined row${otherPlacements ? "" : " and its module"} (other placements of its module: ${otherPlacements})`);
  if (dryRun) return;

  const now = new Date();
  const { _id: _m, ...modShape } = oldMod;
  await Module.insertMany(rows.map((r) => ({ ...modShape, id: r.modId, label: r.p.label, createdAt: now, updatedAt: now })));
  const { _id: _o, ...occShape } = old;
  await Occurrence.insertMany(rows.map((r) => ({ ...occShape, id: r.occId, moduleId: r.modId, label: null, fields: r.fields,
    meta: { ...(old.meta || {}), usdaFdcId: r.p.fdc }, createdAt: now, updatedAt: now })));
  if (rows[0].p.keepPictures) {
    // The pictures' artifacts were parented to... keep them where they are; only the referencing row changes.
  }
  const list = (board.occurrences || []).flatMap((x) => (x === OLD ? rows.map((r) => r.occId) : [x]));
  if (!list.includes(rows[0].occId)) list.push(...rows.map((r) => r.occId));
  await Occurrence.updateOne({ gridId, id: BOARD }, { $set: { occurrences: list, updatedAt: now } });
  await Occurrence.deleteOne({ gridId, id: OLD });
  if (!otherPlacements) await Module.deleteOne({ gridId, id: old.moduleId });
  log("  applied. RESTART pm2.");
}
