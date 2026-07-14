// helpers/labelTokens.js
// Live field interpolation for occurrence LABELS: a label containing
// "[Field Name]" renders the occurrence's CURRENT value for that field in
// place of the token (2026-07-14 user directive: "let me add in the field to
// the label text in brackets or something so it just grabs that value").
//
// The RAW label (with tokens) is what's stored and what inline editing shows —
// interpolation happens at DISPLAY time only, so the tokens survive renames
// and keep tracking the value.
//
// Token → field resolution is by field NAME (case-insensitive, trimmed).
// Duplicate field names exist in the seed (e.g. input "Protein" vs display
// "Protein"), so a field the occurrence actually CARRIES a value for wins
// over a mere name match. Unknown names render literally (no silent eating
// of bracketed prose like "[sic]").
//
// This is the lightweight sibling of the editor↔field binding system
// (modules/BoundHeader.jsx / BoundBody.jsx, meta.headerLink/bodyLink) — that
// one WRITES BACK and syncs linked siblings; tokens are read-only display.

const TOKEN_RE = /\[([^[\]]+)\]/g;

export function hasLabelTokens(label) {
  return typeof label === "string" && label.includes("[") && label.includes("]");
}

function formatValue(raw) {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
    ? raw.value : raw;
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function resolveLabelTokens(label, occurrence, fieldsById) {
  if (!hasLabelTokens(label) || !occurrence || !fieldsById) return label;
  return label.replace(TOKEN_RE, (whole, name) => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return whole;
    let fallback = null;
    for (const f of Object.values(fieldsById)) {
      if ((f?.name || "").trim().toLowerCase() !== wanted) continue;
      if (occurrence.fields && f.id in occurrence.fields) {
        return formatValue(occurrence.fields[f.id]); // carried value wins
      }
      if (!fallback) fallback = f;
    }
    if (!fallback) return whole; // not a field — leave the brackets alone
    return formatValue(occurrence.fields?.[fallback.id]);
  });
}
