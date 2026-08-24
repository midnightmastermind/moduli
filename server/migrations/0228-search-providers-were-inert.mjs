// 0228 — the eleven preset providers were written where nothing reads.
//
// `0219` paired eleven occurrence dropdowns with a search provider and every
// one of them has been INERT since. Two mismatches, either alone enough:
//
//     0219 WROTE   field.meta.searchProvider = { provider, fieldMap }
//     the reader   field.meta.optionsSource.searchProvider   <- one level down
//     and requires .enabled === true                          <- never set
//
// `searchProviderConfig()` returns null on both counts, so `searchProviderId`
// is null, `useProviderSearch` is passed `enabled: false`, and **no provider
// query has ever left the dropdown.** The editor UI writes the RIGHT path
// (`SelectOptionsSourceEditor` patches `source.searchProvider`), so a field
// configured by hand works and a field configured by the migration does not —
// which is why this looked shipped.
//
// *The inert-token class, from the WRITE side.* Every log line in `0219` read
// correctly, the values are present in Mongo, and a probe that greps for
// "searchProvider" finds them. Only asking the READER whether it can see them
// says otherwise.
//
// ── IT MOVES THE VALUE RATHER THAN RE-DERIVING IT ─────────────────────────
//
// `0219`'s pairing decisions were the user's and are not re-litigated here:
// whatever provider each field carries is what moves. The migration adds the
// `enabled` flag those configs were always missing, and — critically — it
// PRESERVES any `fieldMap` already authored at either path rather than
// resetting it to `{}`, so a mapping made by hand in the editor survives.
//
// ── THE OLD KEY IS UNSET, NOT LEFT BESIDE THE NEW ONE ─────────────────────
//
// Two copies of one config is how they drift. A later editor save writes only
// the new path, and a stale `meta.searchProvider` would sit there looking
// authoritative to the next person who greps for it.

export const id = "0228-search-providers-were-inert";
export const description = "Move the preset search-provider configs to the path the reader uses, and enable them";

/** What a field's provider config should become, from wherever it currently
 *  lives. `null` means "this field has nothing to move". PURE. */
export function planConfig(field) {
  const legacy = field?.meta?.searchProvider || null;
  const current = field?.meta?.optionsSource?.searchProvider || null;
  const provider = current?.provider || legacy?.provider || null;
  if (!provider) return null;
  // An authored mapping WINS over the migration's empty one, at either path.
  const fieldMap = (current?.fieldMap && Object.keys(current.fieldMap).length)
    ? current.fieldMap
    : (legacy?.fieldMap && Object.keys(legacy.fieldMap).length) ? legacy.fieldMap : {};
  const enabled = current?.enabled === false ? false : true;   // an explicit OFF is respected
  const already = !!current?.provider && current?.enabled === enabled
    && JSON.stringify(current?.fieldMap || {}) === JSON.stringify(fieldMap)
    && !legacy;
  return { provider, fieldMap, enabled, already, hadLegacy: !!legacy };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();

  const plan = [];
  for (const f of fields) {
    const c = planConfig(f);
    if (!c || c.already) continue;
    plan.push({ id: f.id, name: f.name, ...c });
  }
  if (!plan.length) { log("no provider configs to move — nothing to do"); return { moved: 0 }; }
  for (const p of plan) {
    log(`  ${dryRun ? "would move" : "moving"} "${p.name}" -> ${p.provider}`
      + ` · enabled ${p.enabled} · fieldMap ${Object.keys(p.fieldMap).length} key(s)`
      + (p.hadLegacy ? " · unsets the legacy key" : ""));
  }
  if (dryRun) return { moved: plan.length };

  for (const p of plan) {
    const $set = {
      "meta.optionsSource.searchProvider.provider": p.provider,
      "meta.optionsSource.searchProvider.enabled": p.enabled,
      "meta.optionsSource.searchProvider.fieldMap": p.fieldMap,
    };
    const update = p.hadLegacy
      ? { $set, $unset: { "meta.searchProvider": "" } }
      : { $set };
    await Field.updateOne({ id: p.id, gridId: gid }, update);
  }
  log(`moved ${plan.length} provider config(s) to the path the dropdown reads`);
  return { moved: plan.length };
}
