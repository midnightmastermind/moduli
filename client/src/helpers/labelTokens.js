// helpers/labelTokens.js
// Live field tokens in occurrence LABELS (2026-07-14 user directive, extended
// same day with the name-showing form + colon write-back):
//
//   [Water]  → the bare value:            "16"
//   {Water}  → field name + value + unit: "Water 16oz"
//
// EDITING materializes the current value into the token with a colon —
// the inline editor shows `Drink {Water:16oz}`; the user can type a new
// value in place ("14") and on commit the FIELD is written (value syncs)
// while the label re-stores WITHOUT the value (`Drink {Water}`), so the
// stored label never goes stale.
//
// Token → field resolution is by field NAME (case-insensitive, trimmed).
// Duplicate field names exist in the seed, so a field the occurrence
// actually CARRIES wins over a mere name match. Unknown names render
// literally (no silent eating of bracketed prose like "[sic]" or template
// tokens like "{ProjectName}").
//
// This is the lightweight sibling of the editor↔field binding system
// (modules/BoundHeader.jsx / BoundBody.jsx, meta.headerLink/bodyLink) — that
// one binds a whole header/body slot with linked-sibling sync; tokens live
// inline in label text.

// One token: opening bracket, field name, optional ":value" part, closing
// bracket. Pair-checked in code ([ must close with ], { with }).
const TOKEN_RE = /([[{])([^[\]{}:]+)(?::([^[\]{}]*))?([\]}])/g;

export function hasLabelTokens(label) {
  return typeof label === "string" &&
    ((label.includes("[") && label.includes("]")) ||
     (label.includes("{") && label.includes("}")));
}

function pairMatches(open, close) {
  return (open === "[" && close === "]") || (open === "{" && close === "}");
}

// Resolve a token name to a field: a field whose value the occurrence
// CARRIES wins over a mere duplicate-name match.
function findField(name, occurrence, fieldsById) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  let fallback = null;
  for (const f of Object.values(fieldsById)) {
    if ((f?.name || "").trim().toLowerCase() !== wanted) continue;
    if (occurrence.fields && f.id in occurrence.fields) return f;
    if (!fallback) fallback = f;
  }
  return fallback;
}

function unwrap(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
    ? raw.value : raw;
}

function unitOf(field) {
  return String(field?.meta?.postfix ?? field?.unit ?? "").trim();
}

// Bare display value (no name, no unit) — the [Name] form.
function formatValue(raw) {
  const v = unwrap(raw);
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

// value+unit, e.g. "16oz" — used by the {Name} form and edit materialization.
function formatValueWithUnit(field, raw) {
  const bare = formatValue(raw);
  if (bare === "—") return bare;
  const unit = unitOf(field);
  return unit ? `${bare}${unit}` : bare;
}

// ── Display ──────────────────────────────────────────────────────────────────
export function resolveLabelTokens(label, occurrence, fieldsById) {
  if (!hasLabelTokens(label) || !occurrence || !fieldsById) return label;
  return label.replace(TOKEN_RE, (whole, open, name, _staleVal, close) => {
    if (!pairMatches(open, close)) return whole;
    const field = findField(name, occurrence, fieldsById);
    if (!field) return whole; // not a field — leave the brackets alone
    const raw = occurrence.fields?.[field.id];
    if (open === "{") {
      // Name-showing form: "Water 16oz".
      return `${field.name} ${formatValueWithUnit(field, raw)}`;
    }
    return formatValue(raw); // bare-value form
  });
}

// ── Edit materialization ─────────────────────────────────────────────────────
// What the inline label editor SHOWS: each token gains ":<current value>" so
// the value is editable in place. {Water} → {Water:16oz}; [Water] → [Water:16].
export function materializeLabelTokens(label, occurrence, fieldsById) {
  if (!hasLabelTokens(label) || !occurrence || !fieldsById) return label;
  return label.replace(TOKEN_RE, (whole, open, name, _staleVal, close) => {
    if (!pairMatches(open, close)) return whole;
    const field = findField(name, occurrence, fieldsById);
    if (!field) return whole;
    const raw = occurrence.fields?.[field.id];
    const v = unwrap(raw);
    const shown = (v === null || v === undefined) ? ""
      : open === "{" ? formatValueWithUnit(field, raw).replace(/^—$/, "")
      : formatValue(raw).replace(/^—$/, "");
    return `${open}${name.trim()}:${shown}${close}`;
  });
}

// Parse an edited token value back to a typed field value.
function parseEditedValue(field, text) {
  const t = String(text ?? "").trim();
  if (t === "" || t === "—") return null;
  if (field?.type === "number" || field?.type === "duration" || field?.type === "rating") {
    // "14oz" / "14 lbs" → 14 (unit text tolerated, as typed in the token).
    const m = t.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  if (field?.type === "boolean") return /^(yes|true|y|1|✓)$/i.test(t);
  return t;
}

// ── Commit ───────────────────────────────────────────────────────────────────
// Take the EDITED label (with ":value" parts), return the clean label to
// store (values stripped back out) + the field writes to apply (changed
// values only). Tokens the user deleted entirely just disappear — that's a
// plain label edit.
export function commitLabelTokens(editedLabel, occurrence, fieldsById) {
  if (!hasLabelTokens(editedLabel) || !occurrence || !fieldsById) {
    return { label: editedLabel, writes: [] };
  }
  const writes = [];
  const label = editedLabel.replace(TOKEN_RE, (whole, open, name, val, close) => {
    if (!pairMatches(open, close)) return whole;
    const field = findField(name, occurrence, fieldsById);
    if (!field) return whole;
    if (val !== undefined) {
      const nextVal = parseEditedValue(field, val);
      const currentVal = unwrap(occurrence.fields?.[field.id]) ?? null;
      if (nextVal !== currentVal) writes.push({ fieldId: field.id, value: nextVal });
    }
    return `${open}${name.trim()}${close}`; // store token WITHOUT the value
  });
  return { label, writes };
}
