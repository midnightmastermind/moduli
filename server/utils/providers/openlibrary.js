// utils/providers/openlibrary.js — books, from Open Library.
//
// User, 2026-08-24: *"remember all the ones i said movies, book, music,
// groceries, ingredients, etc."* Books are the cleanest of them: Open Library
// is keyless, returns the author and year in the SEARCH response, and its work
// key is a stable id.
//
// EVERYTHING USEFUL COMES BACK IN ONE REQUEST, so `detail` re-uses the search
// rather than making a second round trip — `fields=` lets the caller name what
// it wants, and asking for less is also what keeps the response small.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://openlibrary.org/search.json";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };
const FIELDS = "key,title,author_name,first_publish_year,number_of_pages_median,subject,publisher,cover_i";

async function query(q, limit) {
  const url = `${API}?q=${encodeURIComponent(q)}&limit=${limit}&fields=${FIELDS}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  return (await res.json()).docs || [];
}

/** A doc -> the fields worth offering. Exported so the shape is testable dry. */
export function bookFields(doc) {
  const f = {};
  if (doc?.author_name?.length) f["Author"] = doc.author_name.slice(0, 3).join(", ");
  if (doc?.first_publish_year) f["First published"] = String(doc.first_publish_year);
  if (doc?.number_of_pages_median) f["Pages"] = String(doc.number_of_pages_median);
  if (doc?.publisher?.length) f["Publisher"] = doc.publisher[0];
  // Open Library's subject list runs to hundreds of entries on a popular book;
  // the first few are the general ones and the tail is cataloguing minutiae.
  if (doc?.subject?.length) f["Subjects"] = doc.subject.slice(0, 5).join(", ");
  return f;
}

const toResult = (d) => normalizeResult({
  provider: "openlibrary",
  externalId: (d.key || "").replace("/works/", ""),
  title: d.title || "",
  subtitle: [d.author_name?.[0], d.first_publish_year].filter(Boolean).join(" · ") || null,
  thumbnail: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
  url: d.key ? `https://openlibrary.org${d.key}` : null,
  fields: bookFields(d),
});

export const openLibraryProvider = {
  id: "openlibrary", label: "Open Library (books)", needsKey: false,
  async search(q, { limit = 6 } = {}) { return (await query(String(q || ""), limit)).map(toResult); },
  async detail({ title, externalId } = {}) {
    // The work key is the precise lookup; a title is the fallback when a caller
    // only has one. Either way the search response already carries the fields.
    const docs = await query(externalId ? `key:/works/${externalId}` : String(title || ""), 1);
    return docs[0] ? toResult(docs[0]) : null;
  },
};
registerProvider(openLibraryProvider);
