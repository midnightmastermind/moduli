// helpers/formItems.js — the pure half of "Ask with a form" (ASK_FORM).
//
// A form item is { key, label, fieldId?, type?, options?, required?, default?, help? }. An item with a fieldId uses
// that grid field's own input; one without is a free question of `type`. The answers come back keyed by item key,
// and the executor turns them into { values, fields } — `fields` keyed by field id, so a Create step can take
// `$form.fields.<id>` straight into its field map.

/** A key for `label` that is not in `taken`: a lowercase slug, "_2", "_3"… when it collides. */
export function itemKey(label, taken = []) {
  const base = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function isEmptyAnswer(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Item type, whether free (`type`) or from its grid field. */
export function itemType(item) {
  return item?.field?.type || item?.type || "text";
}

/** Keys of the required items with no answer. A yes/no box always has one — unticked is "no". */
export function missingRequired(items = [], values = {}) {
  return items
    .filter((it) => it?.required && itemType(it) !== "boolean" && isEmptyAnswer(values?.[it.key]))
    .map((it) => it.key);
}

/** { values: {key: v}, fields: {fieldId: v} } — every item appears in values, unanswered ones as null.
 *  An `optional` item (the form shows an Include box beside it) that the user left out is MISSING from `answers`;
 *  it stays out of `fields`, so a Create taking `fieldsFrom: $form.fields` neither binds nor sets it. */
export function answersToResult(items = [], answers = {}) {
  const values = {};
  const fields = {};
  for (const it of items) {
    if (!it?.key) continue;
    const included = !it.optional || Object.prototype.hasOwnProperty.call(answers || {}, it.key);
    const v = answers?.[it.key];
    values[it.key] = v === undefined || !included ? null : v;
    if (it.fieldId && included) fields[it.fieldId] = values[it.key];
  }
  return { values, fields };
}

/** Whether an answer has something in it — typing into an optional input ticks its Include box. */
export function hasAnswer(v) {
  return !isEmptyAnswer(v) && v !== false;
}
