// helpers/providerFieldMap.js
//
// "The provider said `Directed by: Christopher Nolan`. Which of MY fields is
// that?"
//
// User, 2026-08-23: *"underneath being a mapping selection from the fields
// those searches give, to our own fields. these should be built out as optional
// things to loop in."*
//
// A provider's `detail()` returns a flat bag of STRINGS keyed by whatever that
// source calls them — Wikipedia hands back an infobox, so a film gives
// "Directed by" / "Starring" / "Release date" and a book gives "Authors" /
// "Published". Those names are the source's vocabulary, not ours, and they
// differ per article even within one provider. So the mapping cannot be
// derived; it is authored per field, and everything here is PURE so the rule
// can be driven without a network.
//
// ── EVERY MAPPING IS OPTIONAL, AND AN UNMAPPED KEY IS DROPPED ──────────────
//
// A provider key with no mapping writes nothing. That is the whole posture: the
// import mints the row and fills the handful of fields you asked for, rather
// than inventing fields to hold everything it happened to receive.
//
// ── A VALUE IS ONLY WRITTEN WHEN IT FITS THE FIELD ─────────────────────────
//
// Providers return strings. A `number` field handed "148 minutes" must not
// store that string — every tracker summing it would then read NaN, silently.
// So a numeric target parses, and REFUSES rather than coercing when the string
// carries no leading number. The refusals are RETURNED, not swallowed, because
// a mapping that silently does nothing is the inert-token class this repo keeps
// paying for.

/** Fields whose value we can honestly write from a provider's string. */
const WRITABLE_TYPES = new Set(["text", "number", "duration", "select", "rating"]);

/** A select field's allowed values, in either of the two shapes the grid uses.
 *  `null` means "this select declares no fixed list", where anything goes. */
export function selectOptionValues(field) {
  const raw = field?.meta?.optionsSource?.values ?? field?.meta?.options;
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.map((v) => (v && typeof v === "object" ? v.value : v)).filter((v) => v != null);
}

/** Match a provider string against a select's options, case-insensitively and
 *  against the LABEL as well as the value — a source says "Chest", the option
 *  is `{value:"chest", label:"Chest"}`, and those are the same answer. */
export function matchSelectOption(field, raw) {
  const opts = field?.meta?.optionsSource?.values ?? field?.meta?.options;
  if (!Array.isArray(opts) || !opts.length) return { ok: true, value: raw };
  const want = String(raw).trim().toLowerCase();
  for (const o of opts) {
    const value = o && typeof o === "object" ? o.value : o;
    const label = o && typeof o === "object" ? o.label : o;
    if (String(value).toLowerCase() === want || String(label ?? "").toLowerCase() === want) {
      return { ok: true, value };
    }
  }
  return { ok: false, value: null };
}

/** "148 minutes" -> 148 · "$12.5m" -> 12.5 · "unknown" -> null */
export function parseLeadingNumber(s) {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Turn one provider result's `fields` into occurrence field values.
 *
 * @param providerFields  { [providerKey]: string } from `detail()`
 * @param fieldMap        { [providerKey]: ourFieldId } — the authored mapping
 * @param fieldsById      { [fieldId]: field } so a value can be checked against its type
 * @returns { values, wrote, skipped } — `values` is `{ [fieldId]: {value, flow:"in"} }`
 */
export function mapProviderFields(providerFields, fieldMap, fieldsById = {}, valueAliases = {}) {
  const values = {}, wrote = [], skipped = [];
  for (const [providerKey, fieldId] of Object.entries(fieldMap || {})) {
    if (!fieldId) continue;                      // mapped to nothing — the "off" state
    const raw = providerFields?.[providerKey];
    if (raw == null || raw === "") { skipped.push({ providerKey, why: "provider returned nothing" }); continue; }

    const f = fieldsById[fieldId];
    const type = f?.type || "text";
    if (!WRITABLE_TYPES.has(type)) { skipped.push({ providerKey, why: `cannot write a ${type} field` }); continue; }

    let value = String(raw).trim();
    // AN AUTHORED ALIAS, NOT AN INFERENCE. wger's exercise categories are its
    // own vocabulary: six of its eight land on `Muscle Group`'s options by
    // name, and `Abs`/`Calves` do not. A translation someone WROTE is data the
    // same way the field map is; guessing at a near-match would be the thing
    // the select guard below exists to prevent.
    const alias = valueAliases?.[providerKey];
    if (alias && typeof alias === "object") {
      const hit = Object.entries(alias).find(([k]) => k.toLowerCase() === value.toLowerCase());
      if (hit) value = hit[1];
    }
    if (type === "select") {
      // A SELECT WITH A FIXED LIST IS NOT A TEXT FIELD. wger answers
      // "Pectoralis major" and `Muscle Group`'s options are chest/back/legs —
      // writing the string stores a value absent from the list, which renders
      // BLANK and is written away as null the next time anything else in the
      // row is edited (CLAUDE.md 2026-08-23 (7)). Refused, with the reason, so
      // an unmappable vocabulary shows up instead of quietly emptying a field.
      const m = matchSelectOption(f, value);
      if (!m.ok) { skipped.push({ providerKey, why: `"${value}" is not an option on ${f?.name || "this select"}` }); continue; }
      value = m.value;
    }
    if (type === "number" || type === "duration" || type === "rating") {
      const n = parseLeadingNumber(value);
      // REFUSED rather than coerced: `Number("148 minutes")` is NaN, and a NaN
      // in a field every tracker sums is a silent wrong total.
      if (n === null) { skipped.push({ providerKey, why: `"${value}" is not a number` }); continue; }
      value = n;
    }
    values[fieldId] = { value, flow: "in" };
    wrote.push({ providerKey, fieldId, value });
  }
  return { values, wrote, skipped };
}

/**
 * The provider keys worth offering in the mapping UI, from a sample lookup.
 * Sorted by how often they appear across the sampled results, so the keys a
 * source reliably returns sit at the top instead of a one-off from one article.
 */
export function providerKeysFromSamples(samples) {
  const count = new Map();
  for (const s of samples || []) {
    for (const k of Object.keys(s?.fields || {})) count.set(k, (count.get(k) || 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, seen]) => ({ key, seen }));
}

/** Read the authored config off a field, in the one place it lives. */
export function searchProviderConfig(field) {
  const cfg = field?.meta?.optionsSource?.searchProvider;
  if (!cfg?.enabled || !cfg?.provider) return null;
  return { provider: cfg.provider, fieldMap: cfg.fieldMap || {}, valueAliases: cfg.valueAliases || {} };
}
