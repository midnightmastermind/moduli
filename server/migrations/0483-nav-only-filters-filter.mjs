/**
 * 0483 — a filter Jonah built filters again.
 *
 * The assistant's add_filter wrote `{ condition: { OR: [$field.value CONTAINS $nav, $field.value IS_EMPTY] },
 * hides: false, style: "select", options }`. `getLocalFilterConditions` skips a condition whose `hides` is not true,
 * so that filter was a nav widget only: picking a value filtered nothing (user 2026-11-02, Quick Links). The Filter
 * menu's own shape has NO condition, which the client turns into "field IS the picked value(s)". This rewrites an
 * entry of exactly the assistant's shape into that one; any other filter is untouched.
 * DATE fields are left alone: poms' Trackers and Schedule pages carry this shape on Date ON PURPOSE — a date nav that
 * feeds the day to the operations while the grid's "Daily" filter does the hiding.
 */
export const id = "0483-nav-only-filters-filter";
export const describe = "Rewrites the assistant's nav-only filter entries ($nav condition, hides:false) into the Filter menu's plain shape.";
export const touches = ["occurrences"];

/** Pure: is this the assistant's nav-only shape? */
export function isNavOnlyAssistantFilter(f) {
  const rules = f?.condition?.rules;
  return !!f && f.hides === false && Array.isArray(rules) && rules.length === 2
    && rules[0]?.left === "$field.value" && rules[0]?.right === "$nav"
    && rules[1]?.left === "$field.value" && rules[1]?.comparator === "IS_EMPTY";
}

/** Pure: the occurrence's filters rewritten, or null when none matched. `fieldType(id)` → the field's type. */
export function planFilters(filters, fieldType = () => null) {
  let changed = false;
  const next = (filters || []).map((f) => {
    if (!isNavOnlyAssistantFilter(f) || fieldType(f.fieldId) === "date") return f;
    changed = true;
    const { hides, condition, style, options, ...rest } = f;
    return { ...rest, condition: null };
  });
  return changed ? next : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Field } = models;
  const types = Object.fromEntries((await Field.find({ gridId }, { id: 1, type: 1 }).lean()).map((f) => [f.id, f.type]));
  const fieldType = (id) => types[id] || null;
  const occs = await Occurrence.find({ gridId, "filters.0": { $exists: true } }, { id: 1, filters: 1 }).lean();
  let n = 0;
  for (const o of occs) {
    const next = planFilters(o.filters, fieldType);
    if (!next) continue;
    n++;
    log(`  ${o.id}: ${o.filters.filter((f) => isNavOnlyAssistantFilter(f) && fieldType(f.fieldId) !== "date").map((f) => f.id).join(", ")}`);
    if (dryRun) continue;
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: { filters: next, updatedAt: new Date() } });
    const after = await Occurrence.findOne({ gridId, id: o.id }, { filters: 1 }).lean();
    if ((after?.filters || []).some((f) => isNavOnlyAssistantFilter(f) && fieldType(f.fieldId) !== "date")) throw new Error(`readback: ${o.id} still has a nav-only filter`);
  }
  log(n ? `  ${n} occurrence(s)${dryRun ? " would be" : ""} rewritten${dryRun ? "" : " and read back — RESTART pm2"}.` : "  nothing to do");
}
