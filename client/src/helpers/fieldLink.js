// helpers/fieldLink.js
// A text field can point somewhere: `field.meta.linkTemplate` is a URL with a
// `{value}` slot, e.g. "https://www.instagram.com/{value}". The field keeps its
// plain value (the handle) and the UI shows a link beside it. Nothing here knows
// about any particular site — the template is data on the field.

/** The link a field value points at, or null when the field has no template or no value. */
export function fieldLinkHref(field, value) {
  const tpl = field?.meta?.linkTemplate;
  if (typeof tpl !== "string" || !tpl.includes("{value}")) return null;
  const raw = String(value ?? "").trim();
  // A template of just "{value}" means the value IS the address (a Website field).
  // Only web addresses pass through — never javascript: or any other scheme.
  if (tpl.trim() === "{value}") {
    if (!raw || raw === "—") return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    return `https://${raw}`;
  }
  const v = raw.replace(/^@+/, "");
  if (!v || v === "—") return null;
  return tpl.replace("{value}", encodeURIComponent(v));
}
