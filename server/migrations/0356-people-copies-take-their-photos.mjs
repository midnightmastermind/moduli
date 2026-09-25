// server/migrations/0356-people-copies-take-their-photos.mjs
//
// The other half of `0355` — the same shape `0135` records for ingredients.
// `0355` wrote each imported person's photo straight into Mongo on the SOURCE
// row. A board that renders feedSync COPIES (meta.feedSourceId), or a
// copy-linked sibling (same linkedGroupId), holds a snapshot of the fields
// taken when it was minted, and a direct database write never reaches it (the
// linked-group fan-out only runs on a socket update_occurrence). So the board
// kept saying "Drop media here" (user, 2026-09-25).
//
// Scope: copies of rows 0352 imported (`meta.source: "social-import"`). For
// each, the source's media-role and files-role values are copied over, plus any
// text value 0355 repaired from mojibake (a copy value containing the "Ã"/"ç"
// artefacts that differs from its source). A source with nothing never blanks a
// copy, and a copy already matching is skipped. Restart pm2 after --apply.

export const id = "0356-people-copies-take-their-photos";
export const describe = "Copies each imported person's photo (and repaired name) onto the feed copies / linked copies of that person that boards render.";
export const touches = ["occurrences"];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const MOJIBAKE = /[ÃÂâ][\u0080-ÿ]|ç[\u0080-ÿ]/;

/**
 * PURE. `occurrences` = every occurrence on the grid; `modulesById` a Map.
 * Returns [{ copyId, sourceId, set, why[] }].
 */
export function planCopySync({ occurrences, modulesById }) {
  const byId = new Map(occurrences.map(o => [o.id, o]));
  const sources = occurrences.filter(o => o?.meta?.source === "social-import");
  const byGroup = new Map();
  for (const o of occurrences) {
    if (!o?.linkedGroupId) continue;
    if (!byGroup.has(o.linkedGroupId)) byGroup.set(o.linkedGroupId, []);
    byGroup.get(o.linkedGroupId).push(o);
  }
  const copiesOf = new Map(sources.map(s => [s.id, new Set()]));
  for (const o of occurrences) {
    const sid = o?.meta?.feedSourceId;
    if (sid && copiesOf.has(sid) && o.id !== sid) copiesOf.get(sid).add(o.id);
  }
  for (const s of sources) {
    for (const o of byGroup.get(s.linkedGroupId) || []) if (o.id !== s.id && !o.meta?.source) copiesOf.get(s.id).add(o.id);
  }

  const plan = [];
  for (const s of sources) {
    const mod = modulesById.get(s.moduleId);
    const roleFields = (mod?.fieldBindings || []).filter(b => b?.role === "media" || b?.role === "files").map(b => b.fieldId);
    for (const cid of copiesOf.get(s.id)) {
      const c = byId.get(cid);
      if (!c) continue;
      const set = {}; const why = [];
      for (const f of roleFields) {
        const from = s.fields?.[f];
        if (empty(from?.value) || same(from.value, c.fields?.[f]?.value)) continue;
        set[`fields.${f}`] = { ...from };
        why.push("photo");
      }
      for (const [f, cell] of Object.entries(c.fields || {})) {
        const cur = cell?.value, want = s.fields?.[f]?.value;
        if (typeof cur === "string" && MOJIBAKE.test(cur) && typeof want === "string" && want !== cur && !MOJIBAKE.test(want)) {
          set[`fields.${f}.value`] = want;
          why.push("name");
        }
      }
      if (Object.keys(set).length) plan.push({ copyId: c.id, sourceId: s.id, set, why: [...new Set(why)] });
    }
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean()]);
  const sources = occs.filter(o => o.meta?.source === "social-import");
  const feedCopies = occs.filter(o => o.meta?.feedSourceId && sources.some(s => s.id === o.meta.feedSourceId)).length;
  const plan = planCopySync({ occurrences: occs, modulesById: new Map(mods.map(m => [m.id, m])) });
  log(`${sources.length} imported people · ${feedCopies} feed copies of them on boards · ${plan.length} copies to update (${plan.filter(p => p.why.includes("photo")).length} photos, ${plan.filter(p => p.why.includes("name")).length} names)`);
  if (!plan.length) { log("every copy already matches its source — the missing photos are not a copy problem"); return; }
  if (dryRun) { log("DRY RUN — nothing written"); return; }
  for (const p of plan) await Occurrence.updateOne({ gridId, id: p.copyId }, { $set: p.set });
  log(`updated ${plan.length} copies. Restart the server (pm2) so the warm cache serves it.`);
}
