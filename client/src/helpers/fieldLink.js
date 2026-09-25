// helpers/fieldLink.js
// A text field can point somewhere: `field.meta.linkTemplate` is a URL with a
// `{value}` slot, e.g. "https://www.instagram.com/{value}". The field keeps its
// plain value (the handle) and the UI shows a link beside it. Nothing here knows
// about any particular site — the template is data on the field.

/** The link a field value points at, or null when the field has no template or no value. */
export function fieldLinkHref(field, value) {
  const tpl = field?.meta?.linkTemplate;
  if (typeof tpl !== "string" || !tpl.includes("{value}")) return null;
  const v = String(value ?? "").trim().replace(/^@+/, "");
  if (!v || v === "—") return null;
  return tpl.replace("{value}", encodeURIComponent(v));
}
