// A Daily Coffee tracker, mirroring Daily Water.
//
// User, 2026-09-05: *"can you add Daily Coffee in as well"*.
//
// `Water` already does exactly this shape and is the thing to copy: it sums
// `Liquid Amount` over completed Drink rows whose BEVERAGE pick is the Water
// option, into `Daily Water` on the Water tile under Today's Physical. That
// per-pick narrowing is `makeTrackerOp`'s documented `matchRules` seam - "a
// tracker can narrow to a specific pick without the builder knowing anything
// about what the field means" - and Water is the example the seam was written
// for.
//
// So Coffee is not new machinery. It is the same tile, the same field shape,
// and the same op with ONE rule's right-hand side swapped.
//
// ── NOTHING IS NAMED THAT CAN BE DERIVED ───────────────────────────────────
//
// The Water OPTION and the Water TILE share the label "Water", which is
// exactly the ambiguity `0035` was burned by. So the option is not looked up
// by label: it is read OFF the Water op's own Beverage rule - whatever that
// rule points at IS the water option, by definition - and the Coffee option is
// the beverage-tagged occurrence labelled Coffee. The Category field, the
// Tracker Date binding, the folder and the postfix all come from Water's own
// field and module rather than being restated.
//
// ── WHAT IS DELIBERATELY NOT COPIED ────────────────────────────────────────
//
// `Daily Water` carries `displayConfig.targetValue: 101`. Coffee gets NO
// target: how much coffee is a goal is the user's call, and a number invented
// here would render as a progress bar against a figure nobody chose. The field
// is created ready to take one.
//
// Idempotent at every step - an existing field, module, occurrence or op is
// reused rather than duplicated.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0295-daily-coffee";
export const description = "A Daily Coffee tracker mirroring Daily Water, narrowed to the Coffee beverage pick.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const uid = (p) => p + Math.random().toString(36).slice(2, 12);

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name, extra = {}) => {
    const hits = fields.filter((f) => f.name === name && Object.entries(extra).every(([k, v]) => f[k] === v));
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const dailyWater = one("Daily Water");
  const beverage = one("Beverage");
  const tagsF = one("Tags");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  const waterOp = await Operation.findOne({ gridId: gid, name: "Water" }).lean();
  if (!waterOp) throw new Error("no Water operation to mirror - refusing");

  // The water OPTION, read off the op rather than by label (the tile shares it).
  const bevRule = JSON.stringify(waterOp.pipeline).match(
    new RegExp(`"left":"\\$item\\.fields\\.${beverage.id}\\.value","comparator":"[^"]+","right":"([^"]+)"`));
  if (!bevRule) throw new Error("the Water op carries no Beverage rule - refusing to guess which pick it counts");
  const waterOption = bevRule[1];
  const hasTag = (o, t) => { const v = o.fields?.[tagsF.id]?.value; return Array.isArray(v) ? v.includes(t) : v === t; };
  const coffeeOptions = occs.filter((o) => labelOf(o) === "Coffee" && hasTag(o, "beverage"));
  if (coffeeOptions.length !== 1) throw new Error(`beverage option "Coffee": ${coffeeOptions.length} matches - refusing`);
  const coffeeOption = coffeeOptions[0];
  log(`  water pick ${waterOption.slice(0, 8)} -> coffee pick ${coffeeOption.id.slice(0, 8)}`);

  const waterTiles = occs.filter((o) => JSON.stringify(waterOp.pipeline).includes(`$allItemsById.${o.id}`));
  if (waterTiles.length !== 1) throw new Error(`the Water op names ${waterTiles.length} tiles - refusing`);
  const waterTile = waterTiles[0];
  const waterMod = modById[waterTile.moduleId];
  const parent = occs.find((o) => (o.occurrences || []).includes(waterTile.id));
  if (!parent) throw new Error("the Water tile is listed by nobody - refusing");
  log(`  mirroring tile "${labelOf(waterTile)}" under "${labelOf(parent)}"`);

  // ---- the field ----------------------------------------------------------
  let coffeeField = fields.find((f) => f.name === "Daily Coffee");
  if (coffeeField) log("  field Daily Coffee already exists");
  else {
    coffeeField = {
      id: uid("f"), gridId: gid, userId: dailyWater.userId, name: "Daily Coffee",
      type: dailyWater.type, displayEnabled: true, inputEnabled: false,
      folderId: dailyWater.folderId, meta: { ...(dailyWater.meta || {}) },
      // No targetValue: how much coffee is a goal is the user's call.
      displayConfig: {},
    };
    log(`  + field Daily Coffee (${coffeeField.type}${coffeeField.meta?.postfix ? ", postfix" + coffeeField.meta.postfix : ""})`);
    if (apply) await Field.create(coffeeField);
  }

  // ---- the tile (module + occurrence) -------------------------------------
  let coffeeTile = occs.find((o) => labelOf(o) === "Coffee" && (o.occurrences || parent.occurrences || []).length >= 0 && parent.occurrences.includes(o.id));
  if (coffeeTile) log("  Coffee tile already exists");
  else {
    const bindings = (waterMod.fieldBindings || []).map((b) =>
      b.fieldId === dailyWater.id ? { ...b, fieldId: coffeeField.id } : { ...b });
    const mod = { id: uid("m"), gridId: gid, userId: waterMod.userId, label: "Coffee",
      role: waterMod.role, ...(waterMod.kind ? { kind: waterMod.kind } : {}),
      fieldBindings: bindings, meta: { ...(waterMod.meta || {}) } };
    const occ = { id: uid("o"), gridId: gid, userId: waterTile.userId, moduleId: mod.id,
      parentId: waterTile.parentId ?? null, fields: {}, occurrences: [], meta: {} };
    log(`  + tile "Coffee" binding ${bindings.map((b) => b.fieldId === coffeeField.id ? "Daily Coffee" : (fields.find((f) => f.id === b.fieldId) || {}).name).join(", ")}`);
    if (apply) {
      await Module.create(mod);
      await Occurrence.create(occ);
      // listed right after Water, so it reads as its sibling
      const next = [...parent.occurrences];
      next.splice(next.indexOf(waterTile.id) + 1, 0, occ.id);
      await Occurrence.updateOne({ id: parent.id, gridId: gid }, { $set: { occurrences: next } });
    }
    coffeeTile = occ;
  }

  // ---- the operation ------------------------------------------------------
  const existing = await Operation.findOne({ gridId: gid, name: "Coffee" }).lean();
  if (existing) { log("  Coffee operation already exists"); }
  else {
    let s = JSON.stringify(waterOp.pipeline);
    s = s.split(waterOption).join(coffeeOption.id);       // the pick
    s = s.split(waterTile.id).join(coffeeTile.id);        // the goal tile
    s = s.split(dailyWater.id).join(coffeeField.id);      // the field written
    log("  + operation Coffee (Water, narrowed to the Coffee pick)");
    if (apply) await Operation.create({
      ...waterOp, _id: undefined, id: uid("op"), name: "Coffee",
      description: 'Water, narrowed to Drink rows whose Beverage pick is Coffee.',
      pipeline: JSON.parse(s),
    });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
