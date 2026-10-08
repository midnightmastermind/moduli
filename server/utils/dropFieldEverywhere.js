// A deleted field's bindings and stored values go with it (2026-10-07).
//
// `delete_field` removed only the Field record, so every module kept a binding
// to an id that no longer resolves and every row kept its value under that id —
// deleting the rebuild's `Logged On` would have left 171 rows pointing at
// nothing. This is the one place that clears both, in Mongo and in the warm
// cache; clients clear their own copy in the DELETE_FIELD reducer.
export async function dropFieldEverywhere({ uc, userId, fieldId, Module, Occurrence }) {
  if (!fieldId) return { modules: 0, occurrences: 0 };
  const m = await Module.updateMany({ userId, "fieldBindings.fieldId": fieldId }, { $pull: { fieldBindings: { fieldId } } });
  const o = await Occurrence.updateMany({ userId, [`fields.${fieldId}`]: { $exists: true } }, { $unset: { [`fields.${fieldId}`]: "" } });
  for (const mod of Object.values(uc?.modulesById || {})) {
    if (Array.isArray(mod?.fieldBindings) && mod.fieldBindings.some((b) => b?.fieldId === fieldId)) {
      mod.fieldBindings = mod.fieldBindings.filter((b) => b?.fieldId !== fieldId);
    }
  }
  for (const occ of Object.values(uc?.occurrencesById || {})) {
    if (occ?.fields && Object.prototype.hasOwnProperty.call(occ.fields, fieldId)) {
      const { [fieldId]: _gone, ...rest } = occ.fields;
      occ.fields = rest;
    }
  }
  return { modules: m?.modifiedCount ?? 0, occurrences: o?.modifiedCount ?? 0 };
}
