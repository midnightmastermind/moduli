// server/services/destinationSearch.js
//
// "Where does this go?" — the searchable list behind the placement window.
//
// WHY THIS EXISTS RATHER THAN `GET /occurrences`: that endpoint has no label
// search and runs `Occurrence.find(filter)` before paginating, which on poms
// grid means loading 22,000 rows to answer a type-ahead.
//
// The query direction is what makes it fast: a label lives on the MODULE, and
// there are far fewer modules than occurrences, so match those first and then
// fetch only the occurrences that point at them.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const DEST_ROLES = ["container", "page"];
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CRUMB_DEPTH = 4;

export async function searchDestinations({ userId, gridId, q = "", limit = 50 }) {
  const query = { userId, gridId, role: { $in: DEST_ROLES } };
  if (q) query.label = { $regex: escapeRx(q), $options: "i" };
  // AN EMPTY QUERY HAS NO RELEVANCE SIGNAL, so alphabetical order is arbitrary —
  // and on the real grid it is actively wrong. Measured on poms: `q: ""` returned
  // `"We Say We're Exactly the Same"` and then 59 empty schedule slots all named
  // "10:00pm", while Movies (994 rows), Bookmarks and People sat far past the
  // limit. Nothing downstream could recover: `sharePresetSuggest` sorts
  // biggest-first but only WITHIN what it was handed, so the suggested presets
  // came back EMPTY on the one grid they were built for.
  //
  // So with no query the order is how much is already filed there — which is
  // also the right answer for the window's own opening list ("where do I put
  // things?"), not just for the suggestions.
  const mods = await Module.find(query)
    .sort({ label: 1 })
    .limit(q ? limit * 2 : 0)   // 0 = unlimited: every destination competes on size
    .lean();
  if (!mods.length) return [];

  const byId = new Map(mods.map((m) => [m.id, m]));
  let hits;
  if (q) {
    const occs = await Occurrence.find({ userId, gridId, moduleId: { $in: [...byId.keys()] } })
      .limit(limit * 4).lean();
    hits = occs.slice(0, limit);
  } else {
    // Mongo cannot sort by array length in a find(), and pulling every
    // destination occurrence into Node to sort it would reintroduce the cost
    // this module exists to avoid. `userId`/`gridId` are plain Strings on the
    // schema (checked — an aggregate does NOT cast, so a mismatched BSON type
    // here would silently match nothing).
    hits = await Occurrence.aggregate([
      { $match: { userId, gridId, moduleId: { $in: [...byId.keys()] } } },
      { $addFields: { __n: { $size: { $ifNull: ["$occurrences", []] } } } },
      { $sort: { __n: -1 } },
      { $limit: limit },
    ]);
  }

  // CRUMBS, WITHOUT LOADING THE GRID. Walk up one LEVEL at a time with an
  // `$in` over just the parents actually reached — at most CRUMB_DEPTH small
  // queries. Fetching every occurrence to resolve ancestor labels would
  // reintroduce exactly the cost this endpoint exists to avoid.
  const occById = new Map();
  let frontier = [...new Set(hits.map((o) => o.parentId).filter(Boolean))];
  for (let depth = 0; depth < CRUMB_DEPTH && frontier.length; depth++) {
    const rows = await Occurrence.find({ userId, gridId, id: { $in: frontier } })
      .limit(frontier.length).lean();
    for (const r of rows) occById.set(r.id, r);
    frontier = [...new Set(rows.map((r) => r.parentId).filter((id) => id && !occById.has(id)))];
  }

  // One more module lookup for the ancestors, which the label search did not
  // match and therefore did not fetch.
  const ancestorModIds = [...new Set([...occById.values()].map((o) => o.moduleId).filter((id) => id && !byId.has(id)))];
  if (ancestorModIds.length) {
    const more = await Module.find({ userId, gridId, id: { $in: ancestorModIds } }).lean();
    for (const m of more) byId.set(m.id, m);
  }
  const labelOf = (occ) => (occ ? byId.get(occ.moduleId)?.label || null : null);

  // SHAPE — what a row placed in this destination already looks like. The UI
  // task needs this to build "Add it as a movie" without calling GET /modules
  // (no by-id filter there; on the real grid that is 5,917 modules fetched to
  // read one). We already have each hit's first child in hand from the
  // `occs` fetch above (its `occurrences[0]`), so two more BATCHED,
  // `$in`-scoped queries answer this for every hit at once.
  // Up to SAMPLE children per hit, so the shape can also say which VALUES the
  // rows agree on (every movie carries Board Category: movie) — the "(auto)"
  // pre-fill of spec §4. Still one `$in` query for every hit at once.
  const sampleIdsOf = (o) => spreadSample(o.occurrences || [], SAMPLE);
  const firstChildIds = [...new Set(hits.flatMap(sampleIdsOf))];
  const childOccById = new Map();
  if (firstChildIds.length) {
    const childOccs = await Occurrence.find({ userId, gridId, id: { $in: firstChildIds } }).lean();
    for (const c of childOccs) childOccById.set(c.id, c);
  }
  const childModIds = [...new Set([...childOccById.values()].map((c) => c.moduleId).filter(Boolean))];
  const childModById = new Map();
  if (childModIds.length) {
    const childMods = await Module.find({ userId, gridId, id: { $in: childModIds } }).lean();
    for (const m of childMods) childModById.set(m.id, m);
  }
  const shapeOf = (o) => {
    const firstChildId = o.occurrences?.[0];
    if (!firstChildId) return null;
    const childOcc = childOccById.get(firstChildId);
    const m = childOcc ? childModById.get(childOcc.moduleId) : null;
    if (!m) return null;
    const bindFields = (m.fieldBindings || [])
      .filter((b) => b?.fieldId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((b) => b.fieldId);
    return {
      moduleId: m.id,
      role: m.role || "instance",
      kind: m.kind || null,
      bindFields,
      autoFields: commonValues(sampleIdsOf(o).map((id) => childOccById.get(id)).filter(Boolean), bindFields),
    };
  };

  const out = [];
  for (const o of hits) {
    const m = byId.get(o.moduleId);
    if (!m) continue;
    const crumbs = [];
    let cur = occById.get(o.parentId);
    for (let i = 0; i < CRUMB_DEPTH && cur; i++) {
      const l = labelOf(cur);
      if (l) crumbs.unshift(l);
      cur = occById.get(cur.parentId);
    }
    out.push({
      id: o.id, label: m.label || "(untitled)", crumb: crumbs.join(" › "),
      role: m.role, kind: m.kind || null, childCount: (o.occurrences || []).length,
      shape: shapeOf(o),
    });
  }
  return out;
}

// Rows sampled per destination to decide which values are "the board's".
// SPREAD across the whole list, never its head: an import writes rows from
// one source next to each other, so the first few agree by accident. Measured
// on poms' Movies (994 rows): the first 3 all said Drive "Odin", which 401 of
// 994 carry — and a head sample auto-filled it into every clip.
export const SAMPLE = 25;

/** Up to `n` ids evenly spaced from first to last, first always included. */
export function spreadSample(ids, n = SAMPLE) {
  if (ids.length <= n) return ids.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(ids[Math.round((i * (ids.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/**
 * The values every sampled row agrees on, per bound field. AT LEAST TWO rows
 * must agree: with one row, its title and year would read as "the shape", and
 * a single movie's Year would be pre-filled into the next one.
 */
export function commonValues(rows, fieldIds) {
  const out = {};
  if (rows.length < 2) return out;
  for (const fid of fieldIds) {
    const vals = rows.map((r) => r.fields?.[fid]?.value);
    if (vals.some(isEmpty)) continue;
    const first = JSON.stringify(vals[0]);
    if (vals.every((v) => JSON.stringify(v) === first)) out[fid] = vals[0];
  }
  return out;
}
