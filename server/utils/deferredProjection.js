// WHAT A DEFERRED ROW HAS TO CARRY BEFORE ANYONE LOOKS AT IT.
//
// ── THE COST, MEASURED ON THE DEVICE ───────────────────────────────────────
//
// With the effect loop fixed, the load's largest item is the catalogue, and the
// load line splits it:
//
//     contentReady=2422ms   rest=7571ms-8718ms   restWrite=0ms
//     ops:start=10197ms     sweep=3129ms  effects=2130ms  opsDone=15456ms
//
// `restWrite=0ms` — the single store dispatch and its render fan-out cost
// nothing. **Nothing happens between content being ready at 2.4s and the first
// chunk at 7.6s except socket.io receiving, inflating and JSON.parsing the
// frame**, because the mark fires when our handler runs, after all of that.
// That window holds a 2,354ms task and a 1,047ms one. It is the bytes.
//
// ── AND NOT ALL BYTES ARE EQUAL, which the previous attempt proved ─────────
//
// Dropping keys that are null on every row took 3.6 MB off and moved the
// measurement by NOTHING (`ops:start` 9,667 -> 10,197ms against a 4-10s noise
// band). `"ownStyle":null` x15,708 is trivially compressible and trivially
// parsed — cheap bytes. What is expensive is high-entropy content: URLs,
// titles, artist names, ISBNs. That is `fields` (3.36 MB) and `meta` (3.45 MB),
// and it is what this removes.
//
// ── THE KEEP-SET IS DERIVED FROM THE GRID, NEVER WRITTEN DOWN ──────────────
//
// A list like `["Board Category", "Owned", "Tags", "Episodes"]` would be four
// renames from wrong AND would teach the wire what a media board is. The user's
// constraint was explicit — "as long as nothing is hardcoded toward media" —
// and this repo has `noDomainKnowledge.test.js` because domain concepts have
// leaked into generic layers twice.
//
// So the rule is: KEEP WHAT THE GRID'S OWN DECLARATIONS REFERENCE. Operation
// pipelines, every field's `optionsSource` predicate, and the grid's filters.
// On the live grid that derives to exactly four field ids — but it derives
// them, so a tracker that starts reading `Artist` keeps Artist automatically.
//
// ── OVER-MATCHING IS SAFE; UNDER-MATCHING IS A SILENT WRONG ANSWER ─────────
//
// Referencing is decided by substring over the serialized declarations. A
// crude match that keeps a field nothing reads costs a few bytes. A clever one
// that misses a reader makes an operation quietly compute against an absent
// value — the inert-token class this codebase keeps paying for. Blunt on
// purpose.
//
// ── WHAT MAKES IT SAFE TO SHIP IS THE EQUIVALENCE TEST, NOT THIS COMMENT ───
//
// `deferredProjectionEquivalence.test.js` runs the live grid's own pipelines
// over full rows and over projected rows and requires byte-identical effects,
// and requires every find-mode dropdown to resolve an identical option list.
// The rest of a row arrives when something actually renders it.

/** Keys that identify and place a row. Never projected away. */
const STRUCTURAL = Object.freeze([
  "id", "_id", "moduleId", "parentId", "occurrences", "role", "kind", "label",
  "sortOrder", "userId", "gridId", "linkedGroupId", "identitySignature",
  "hidden", "locked", "viewId", "placement", "createdAt", "updatedAt",
]);

/**
 * Every field id and meta key the grid's own declarations mention.
 *
 * @param {Object} decls  { operations, fields, grid } — serialized and searched
 * @returns {(name: string) => boolean} referenced?
 */
export function makeReferenceTest({ operations = [], fields = [], grid = null } = {}) {
  let blob = "";
  try {
    // A FIELD'S OWN `id` IS NOT A REFERENCE TO IT, and serializing fields whole
    // made every field match itself — the derivation answered "everything is
    // referenced" and the projection removed nothing. Its own identity is
    // stripped; the rest of the record stays, because `optionsSource`,
    // `displayConfig`, `chipDisplay` and affix config all name OTHER field ids
    // that a resolver reads before anything renders.
    //
    // MODULES ARE DELIBERATELY NOT IN HERE. `fieldBindings` names a field
    // because a module RENDERS a pill for it — the render path, which hydrates.
    // Including them would mark nearly every field referenced and the
    // projection would remove nothing again, for a different reason.
    const fieldDecls = (fields || []).map((f) => {
      if (!f || typeof f !== "object") return f;
      const { id: _own, ...rest } = f;
      return rest;
    });
    blob = JSON.stringify(operations) + JSON.stringify(fieldDecls) + JSON.stringify(grid ?? null);
  } catch {
    // A grid we cannot serialize must not silently project everything away.
    return () => true;
  }
  const cache = new Map();
  return (name) => {
    if (!name) return false;
    if (!cache.has(name)) cache.set(name, blob.includes(name));
    return cache.get(name);
  };
}

/**
 * A deferred row reduced to what something can read before it is rendered.
 * `fields` and `meta` keep only referenced entries; everything else is kept.
 */
export function projectDeferredRow(row, isReferenced) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const k in row) {
    if (k === "fields" || k === "meta") continue;
    out[k] = row[k];
  }
  const pick = (src) => {
    if (!src || typeof src !== "object") return undefined;
    let kept;
    for (const k in src) {
      if (!isReferenced(k)) continue;
      (kept ||= {})[k] = src[k];
    }
    return kept;
  };
  // An EMPTY object, not an absent one, when nothing survives: readers do
  // `occ.fields?.[id]` but the shape being present keeps them honest, and
  // `omitNullKeys` deliberately preserves `{}` for the same reason.
  if ("fields" in row) out.fields = pick(row.fields) || {};
  if ("meta" in row) out.meta = pick(row.meta) || {};
  // The marker the client hydrates on. One key, ~14 bytes a row, against the
  // alternative of the client having to remember which ids arrived deferred
  // across reconnects and grid switches.
  out._partial = true;
  return out;
}

export function projectDeferredRows(rows, isReferenced) {
  return Array.isArray(rows) ? rows.map((r) => projectDeferredRow(r, isReferenced)) : rows;
}

export { STRUCTURAL as PROJECTION_STRUCTURAL_KEYS };
