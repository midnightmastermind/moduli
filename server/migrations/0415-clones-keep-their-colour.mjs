// 0415 — a template clone keeps its source's colour.
//
// User 2026-10-17: a scheduled item (Sleep in the 5am slot) showed its slot's red
// instead of its own colour, in every skin. The day's copy runs on a CLONE module
// (`meta.clonedFromModuleId`), and the client's APPLY_TEMPLATE minted clones without the
// source's style keys — so the clone was `styleMode: inherit` with no colour and the row
// was see-through. Fixed for new clones in `operationActions.styleKeysOf`; this gives the
// clones that already exist their source's style.
//
// Only a clone with NO style of its own is touched (not "own", no ownStyle colour) — a
// clone someone has styled keeps it. Clones whose source has no style are left alone.
export const id = "0415-clones-keep-their-colour";
export const describe = "Template clones that lost their source's style get it back (styleMode/ownStyle/child styles). Modules only.";
export const touches = ["modules"];

const KEYS = ["styleMode", "ownStyle", "childInstanceStyle", "childContainerStyle"];
const hasOwnLook = (m) => m?.styleMode === "own" || !!m?.ownStyle?.bg || !!m?.ownStyle?.textColor;

/** Pure: the `$set` for one clone, or null. */
export function healCloneStyle(clone, source) {
  if (!clone || !source || hasOwnLook(clone) || !hasOwnLook(source)) return null;
  const set = {};
  for (const k of KEYS) if (source[k] != null) set[k] = source[k];
  return Object.keys(set).length ? set : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;
  const mods = await Module.find({ gridId }).lean();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const plan = [];
  for (const m of mods) {
    const src = byId.get(m.meta?.clonedFromModuleId);
    const set = healCloneStyle(m, src);
    if (set) plan.push({ id: m.id, label: m.label, set });
  }
  log(`${plan.length} clone(s) to give their source's style.`);
  for (const p of plan.slice(0, 15)) log(`  ${p.label} <- ${p.set.ownStyle?.bg || p.set.styleMode}`);
  if (dryRun || !plan.length) return;
  for (const p of plan) await Module.updateOne({ gridId, id: p.id }, { $set: p.set });
  const left = (await Module.find({ gridId, id: { $in: plan.map((p) => p.id) } }).lean()).filter((m) => !hasOwnLook(m));
  if (left.length) throw new Error(`readback: ${left.length} clone(s) still unstyled`);
  log("applied and read back.");
}
