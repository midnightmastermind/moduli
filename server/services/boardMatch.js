// services/boardMatch.js
//
// WHICH BOARD A TYPED PAGE BELONGS TO (smarter imports Task 6). A page that says it is a Movie is shaped
// like a row of the board where the grid keeps movies — that board's fields — but it still lands in
// Imports (the user files it). Found by the Board Category value the board's own rows agree on
// (`searchDestinations`' autoFields), never by the board's name, so a renamed board still matches.
// An Article, or a type the grid has no board for, matches nothing: it is a plain page.
import { searchDestinations as defaultSearch } from "./destinationSearch.js";
import Field from "../models/Field.js";
import Module from "../models/Module.js";

export const TYPE_CATEGORIES = {
  Movie: ["movie"],
  Book: ["book"],
  Recipe: ["meal", "recipe"],
  Person: ["person"],
  Product: ["purchase"],
};

const lc = (v) => String(v ?? "").toLowerCase();
const valuesOf = (v) => (Array.isArray(v) ? v : [v]).map(lc);

/** Pure: the destination whose rows agree on one of the type's categories; the fullest wins. */
export function pickBoardForType(type, destinations = []) {
  const cats = TYPE_CATEGORIES[type];
  if (!cats) return null;
  const hits = destinations.filter((d) => {
    const auto = d?.shape?.autoFields || {};
    return Object.values(auto).some((v) => valuesOf(v).some((x) => cats.includes(x)));
  });
  if (!hits.length) return null;
  return hits.sort((a, b) => (b.childCount || 0) - (a.childCount || 0))[0];
}

/**
 * @returns {Promise<null|{ id, label, shape, fields: [{id,name,type}], bindings }>}
 * @param deps { searchDestinations, fieldsFor } — injectable for tests.
 */
export async function matchBoard({ userId, gridId, type }, deps = {}) {
  if (!gridId || !TYPE_CATEGORIES[type]) return null;
  const search = deps.searchDestinations || defaultSearch;
  const dests = await search({ userId, gridId, q: "", limit: 60 });
  const board = pickBoardForType(type, dests);
  if (!board) return null;
  const ids = board.shape?.bindFields || [];
  const fieldsFor = deps.fieldsFor
    || (async (fieldIds) => Field.find({ userId, gridId, id: { $in: fieldIds } }, { id: 1, name: 1, type: 1 }).lean());
  const fields = ids.length ? await fieldsFor(ids) : [];
  // The row module's own bindings (roles, order, hidden flags), so the page renders like the board's rows.
  const moduleFor = deps.moduleFor
    || (async (id) => Module.findOne({ userId, gridId, id }, { fieldBindings: 1 }).lean());
  const rowMod = board.shape?.moduleId ? await moduleFor(board.shape.moduleId) : null;
  const bindings = (rowMod?.fieldBindings || []).filter((b) => b?.fieldId)
    .map(({ fieldId, role, order, hidden }) => ({ fieldId, role: role || "input", order: order ?? 0, ...(hidden ? { hidden: true } : {}) }));
  return { id: board.id, label: board.label, shape: board.shape, fields, bindings };
}

// Which structured value goes in which of the board's fields, by the field's NAME (the same reading
// sharePresetSuggest does for a clip). First match wins; the title rule is last.
const FIELD_RULES = [
  { when: (n, t) => t === "number" && /\byear\b/.test(n), key: "year" },
  { when: (n) => /\bdirector\b/.test(n), key: "director" },
  { when: (n) => /\bauthor|writer\b/.test(n), key: "author" },
  { when: (n) => /\bingredients?\b/.test(n), key: "ingredients" },
  { when: (n) => /\b(url|link|website|source)\b/.test(n), key: "url" },
  { when: (n) => /\b(title|name|label)\b/.test(n), key: "title" },
];

/** Pure: `{ [fieldId]: value }` for the board's fields the page has values for. */
export function structuredFieldValues(boardFields = [], values = {}) {
  const out = {};
  for (const f of boardFields) {
    // A link field (Author -> the Authors board) holds row ids; a name string there would be a broken link.
    if (f.type === "occurrence") continue;
    const rule = FIELD_RULES.find((r) => r.when(lc(f.name), f.type));
    const v = rule ? values[rule.key] : undefined;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[f.id] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}
