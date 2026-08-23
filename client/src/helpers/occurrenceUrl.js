// helpers/occurrenceUrl.js
//
// The URL an occurrence points at, from any of the three places one can live.
//
// This is what makes the iframe view GENERIC. The view is offered because a row
// HAS a url — never because something learned what a "bookmark" is, which is the
// rule `noDomainKnowledge.test.js` fails the build over.
//
//   1. a link chip's `meta.link`      — delegated to `resolveExternalLink`,
//      which already owns the occurrence-over-module precedence. Re-deriving it
//      here would be a second opinion that drifts from what TextblockCard renders.
//   2. a FIELD value                  — a bookmark's URL, a Place's Website, a
//      Person's LinkedIn
//   3. a remote `fileRef`             — an artifact stored by URL
import { resolveExternalLink } from "./linkToPage";

const HTTP = /^https?:\/\//i;

/** A field NAME that says "this holds a link", lowercased. Order is preference. */
const URLISH = ["url", "link", "website", "web site", "address", "href", "source"];

const firstHttp = (v) => {
  for (const x of Array.isArray(v) ? v : [v]) {
    if (typeof x === "string" && HTTP.test(x.trim())) return x.trim();
  }
  return null;
};

/**
 * @returns {{ url: string, from: "link"|"field"|"fileRef", fieldId?: string } | null}
 * `from` is reported because the caller sometimes needs to know: a link chip's
 * URL is the whole occurrence, while a field's URL is one attribute of a row
 * that has others worth showing.
 */
export function occurrenceUrl(occurrence, { module = null, fieldsById = {} } = {}) {
  const link = resolveExternalLink(occurrence, module);
  if (link) return { url: link, from: "link" };

  const fields = occurrence?.fields || {};
  // A NAMED field wins over an unnamed one carrying a url, so a Person with both
  // a Website and a stray url in a notes field opens the Website. Without the
  // preference the answer depends on key order, which is not a decision.
  const named = [];
  const other = [];
  for (const [fid, cell] of Object.entries(fields)) {
    const hit = firstHttp(cell?.value);
    if (!hit) continue;
    const name = String(fieldsById?.[fid]?.name || "").toLowerCase().trim();
    const rank = URLISH.indexOf(name);
    (rank >= 0 ? named : other).push({ url: hit, from: "field", fieldId: fid, rank });
  }
  if (named.length) return named.sort((a, b) => a.rank - b.rank)[0];
  if (other.length) return other[0];

  const ref = module?.fileRef;
  if (typeof ref === "string" && HTTP.test(ref.trim())) return { url: ref.trim(), from: "fileRef" };
  return null;
}

/** Does the iframe view apply here? */
export function hasViewableUrl(occurrence, ctx) {
  return !!occurrenceUrl(occurrence, ctx);
}
