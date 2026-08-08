// helpers/fieldAffix.js
//
// A field's prefix/postfix, CHOSEN PER ROW instead of fixed per field.
//
// User, 2026-08-08: "can we have fields have selected labels. so for amount we
// can select the label on the fly. like a dropdown for pfefix and postfix so i
// can do $ for money or like kg ml g any for amount of ingrediants."
//
// ── WHAT THIS DOES NOT TOUCH: THE VALUE ─────────────────────────────────────
//
// `2 kg` and `2 g` are both `value: 2`. The affix is PRESENTATION — it never
// changes the number, never participates in a comparison, and never reaches an
// aggregation. That is the whole safety property, and it is why this can sit on
// a field that trackers read.
//
// **It is also why a unit picker must not go on `Amount`.** Measured on poms
// grid: 27 modules bind Amount and 8 operations sum it (Spent, Checking
// Balance, Cash Balance, Total Subscriptions, Monthly Bills, Purchase
// History…). Presentation-only means "300 g" would still add 300 to the
// spending total — the label would lie about a number that is very much real.
// Currency options on Amount are fine ($/€/£ do not change what the number
// counts); grams belong on their own field.
//
// ── THE SHAPE, AND WHY IT REUSES AN EXISTING SLOT ───────────────────────────
//
//   field.meta.prefixOptions  : string[]   what this field OFFERS
//   field.meta.postfixOptions : string[]
//   occurrence.fields[fid].prefix / .postfix   what THIS row picked
//
// The per-row half is not a new idea: `hideName` / `hidePrefix` / `hidePostfix`
// already ride on the field-value object and are unpacked in FieldRenderer. An
// affix pick is the same kind of per-placement display state, so it lives in
// the same place rather than inventing a parallel store.
//
// Absent options = today's behaviour byte-for-byte: the fixed `meta.prefix`
// still shows and no picker renders.

/** The options a field offers for one affix. Always an array of strings. */
export function affixOptions(field, which) {
  const key = which === "prefix" ? "prefixOptions" : "postfixOptions";
  const raw = field?.meta?.[key];
  if (!Array.isArray(raw)) return [];
  // Coerce and drop blanks, but KEEP order — the author's order is the menu
  // order, and sorting it would silently reorder someone's list.
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Does this field let a row choose its own affix? */
export function hasAffixChoice(field, which) {
  return affixOptions(field, which).length > 0;
}

/**
 * The affix actually shown for one row.
 *
 * PRECEDENCE: the row's pick -> the field's fixed default -> nothing.
 *
 * A pick of `""` is MEANINGFUL and is preserved — it is how a row says "no unit
 * here" on a field whose default is `$`. Only `null`/`undefined` fall through
 * to the default, which is why this tests for the key's presence rather than
 * truthiness.
 */
export function resolveAffix(field, stored, which) {
  const picked = stored && typeof stored === "object" ? stored[which] : undefined;
  if (typeof picked === "string") return picked;
  const fallback = field?.meta?.[which];
  return typeof fallback === "string" ? fallback : "";
}

/**
 * The menu for one affix: the offered options, plus the field's own default and
 * the row's current pick if either is missing from the list.
 *
 * Including them matters — a field whose default is `$` but whose options are
 * ["kg","g"] would otherwise offer no way back to `$`, and a row already
 * carrying an option the author has since removed would show a value it cannot
 * reselect. `""` is always offered as "none".
 */
export function affixMenu(field, stored, which) {
  const opts = affixOptions(field, which);
  if (!opts.length) return [];
  const out = [...opts];
  const fallback = field?.meta?.[which];
  if (typeof fallback === "string" && fallback && !out.includes(fallback)) out.unshift(fallback);
  const picked = stored && typeof stored === "object" ? stored[which] : undefined;
  if (typeof picked === "string" && picked && !out.includes(picked)) out.push(picked);
  return ["", ...out];
}

/**
 * The next stored field-value object after picking an affix.
 *
 * **Spreads the existing object**, which is the bug this file exists not to
 * repeat: `handleFlowChange` rebuilt the value as `{ value, flow }` and
 * silently dropped `hideName` / `hidePrefix` / `hidePostfix`. Any writer of one
 * per-row key has to preserve the others.
 *
 * Passing `null` CLEARS the pick, so the field default applies again — distinct
 * from picking `""`, which pins "no affix" on this row.
 */
export function withAffix(stored, which, next) {
  const base = stored && typeof stored === "object" ? { ...stored } : { value: stored ?? null };
  if (next === null || next === undefined) delete base[which];
  else base[which] = String(next);
  return base;
}
