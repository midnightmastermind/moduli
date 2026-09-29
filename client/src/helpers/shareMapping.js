// client/src/helpers/shareMapping.js
//
// WHAT A CLIPPED THING BECOMES, one field at a time.
//
// Two tables and one resolver, all pure. The window shows the RESOLVED VALUE
// of every row in an editable box, because a mapping that quietly resolves to
// empty is this screen's whole failure mode — the user's own example is IMDb's
// page title, "A Guide to Recognizing Your Saints (2006) IMDb", which is
// nobody's idea of a movie title.
//
// Resolution is CLIENT-ONLY on purpose. The window sends the server the values
// it displayed, so what you saw is what gets written; a second resolver on the
// server could disagree with the box in front of you.

const str = (v) => (v == null ? "" : String(v));

/** Where a value can come from. `read` must never throw and never return undefined. */
export const SHARE_SOURCES = [
  { value: "none",        label: "—",                read: () => "" },
  { value: "title",       label: "page title",       read: (c) => str(c?.title) },
  { value: "url",         label: "page URL",         read: (c) => str(c?.url) },
  { value: "linkUrl",     label: "link URL",         read: (c) => str(c?.linkUrl || c?.url) },
  { value: "selection",   label: "selected text",    read: (c) => str(c?.selection || c?.text) },
  { value: "imageUrl",    label: "image source",     read: (c) => str(c?.imageUrl) },
  { value: "siteName",    label: "site name",        read: (c) => str(c?.siteName) },
  { value: "description", label: "description",      read: (c) => str(c?.description) },
  { value: "today",       label: "today's date",     read: () => new Date().toLocaleDateString("en-CA") },
  { value: "literal",     label: "a literal",        read: (_c, m) => str(m?.value) },
];

// A SITE SUFFIX: a WHITESPACE-DELIMITED separator plus a short trailing
// segment, or a bare trailing " IMDb". The separator must have space around
// it — a bare hyphen belongs to the title ("X-Men", "Spider-Man"), and an
// earlier version of this regex turned "Ant-Man and the Wasp" into "Ant".
const SUFFIX = /\s+[|–—-]\s+[^|–—]{1,40}$|\s+IMDb$/;

/** What can be done to a value. A small fixed set — anything else, edit the box. */
export const SHARE_TRANSFORMS = [
  { value: "none",        label: "—",                  apply: (s) => s },
  { value: "trim",        label: "trim",               apply: (s) => s.trim() },
  { value: "stripSuffix", label: "strip site suffix",  apply: (s) => s.replace(SUFFIX, "").trim() },
  // EMPTY, NOT THE INPUT, when there is no match: passing the input through
  // would write a film's title into its Year field.
  { value: "year",        label: "extract year",       apply: (s) => (s.match(/\b(1[89]\d{2}|20\d{2})\b/) || [""])[0] },
  { value: "number",      label: "extract number",     apply: (s) => (s.match(/-?\d+(?:\.\d+)?/) || [""])[0] },
  { value: "parens",      label: "text in parentheses", apply: (s) => (s.match(/\(([^)]*)\)/) || ["", ""])[1] },
  { value: "lower",       label: "lowercase",          apply: (s) => s.toLowerCase() },
];

const sourceBy = new Map(SHARE_SOURCES.map((s) => [s.value, s]));
const transformBy = new Map(SHARE_TRANSFORMS.map((t) => [t.value, t]));

/**
 * @param {object} clip   the staged clip
 * @param {{source:string, transform?:string, value?:string, override?:string}} mapping
 * @returns {string} what will be written — never undefined
 */
export function resolveMapping(clip, mapping = {}) {
  // THE EDITED BOX WINS, and an empty edit means empty. `!= null` rather than
  // truthiness: clearing the box is a deliberate "write nothing".
  if (mapping.override != null) return str(mapping.override);
  const src = sourceBy.get(mapping.source);
  if (!src) return "";
  const raw = str(src.read(clip, mapping));
  const tf = transformBy.get(mapping.transform || "none");
  return tf ? str(tf.apply(raw)) : raw;
}

/** The whole table. Empty results are DROPPED — an empty value is not a value. */
export function resolveMappings(clip, mappings = {}) {
  const out = {};
  for (const [fieldId, mapping] of Object.entries(mappings)) {
    const v = resolveMapping(clip, mapping);
    if (v !== "") out[fieldId] = v;
  }
  return out;
}
