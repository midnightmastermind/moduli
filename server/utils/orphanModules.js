// server/utils/orphanModules.js
//
// A MODULE that no occurrence places.
//
// The inverse of `gridIntegrity`'s `missing-module` rule (an occurrence whose
// module is gone). A module is the TEMPLATE; an occurrence is the PLACEMENT.
// With no placement anywhere, a module renders nowhere and can never be
// reached — it only costs load time, since `full_state` ships every one.
//
// Measured on poms grid 2026-08-11: 385 of 2707. They come from deletions —
// `delete_occurrence` removes the occurrence and its subtree, and the modules
// behind them are simply left. ("Push Day A", "Leg Day", "Couch to 5K", the
// `Due` containers 0070 retired, old dated day columns.)
//
// ── FOUR REFUSALS, AND TWO OF THEM PROVED NOTHING ─────────────────────────
//
// A module id can be named in an OPERATION pipeline (a CREATE's templateId, an
// APPLY_TEMPLATE ref, a FIND on moduleId) or inside a TEXTMAP. Both refusals
// were verified against a CONTROL — the same scan over LIVE module ids finds
// 17 in operations and 967 in textmaps, so a zero for the orphans is a
// measurement rather than a broken probe.
//
// Two more were written and are DELIBERATELY NOT KEPT AS EVIDENCE: field
// configs and `grid.meta` reference **zero** module ids even for live modules,
// so passing them says nothing at all. They stay in the scan because the cost
// is nil and a future config could name one — but they are not why this is
// safe, and recording that is the point. An absent signal is not a measurement
// of zero.
//
// ── AND AN AGE FLOOR, WHICH IS THE ONE THAT MATTERS IN PRACTICE ───────────
//
// `create_module` and `create_occurrence` are separate writes, and the
// occurrence create is QUEUED server-side and bails on disconnect. So a module
// minted seconds ago may be waiting for a placement that is still in flight —
// exactly the asymmetry that produces the module-less occurrences this file
// already sweeps, seen from the other side. Anything younger than the floor is
// reported and LEFT ALONE.

/** A module id can only be reached through one of these. */
export const REFERENCE_SOURCES = ["operation", "textmap", "field", "gridMeta"];

/** Minutes a module must have existed before it can be considered dead. */
export const MIN_AGE_MINUTES = 60;

export function moduleAgeMinutes(mod, now = Date.now()) {
  const raw = mod?.createdAt
    || (mod?._id && typeof mod._id.getTimestamp === "function" ? mod._id.getTimestamp() : null);
  if (!raw) return Infinity;              // unknowable age → not the young case
  return (now - new Date(raw).getTime()) / 60000;
}

/**
 * Which modules are placed by no occurrence, referenced by nothing, and old
 * enough to be sure.
 *
 * PURE — the refusals are the entire risk, so they are testable without a
 * database. `referencedIds` is supplied by the caller (which owns the
 * decompression and the JSON scan).
 *
 * @returns { drop: Module[], keep: [{ mod, why: string[] }] }
 */
export function planOrphanModules({ modules, occurrences, referencedIds = new Set(), now = Date.now(), minAgeMinutes = MIN_AGE_MINUTES }) {
  const placed = new Set();
  for (const o of occurrences || []) if (o?.moduleId) placed.add(o.moduleId);

  const drop = [];
  const keep = [];
  for (const m of modules || []) {
    if (placed.has(m.id)) continue;                    // it renders somewhere
    const why = [];
    // A template root is minted to be CLONED FROM, so having no placement of
    // its own is its normal state, not evidence that it is dead.
    if (m.meta?.templateModule === true) why.push("is a template root");
    if (referencedIds.has(m.id)) why.push("referenced by an operation or textmap");
    const age = moduleAgeMinutes(m, now);
    if (age < minAgeMinutes) why.push(`only ${Math.round(age)}m old — its placement may be in flight`);
    if (why.length) keep.push({ mod: m, why });
    else drop.push(m);
  }
  return { drop, keep };
}

/** Every module id named anywhere inside `docs` (ops, textmaps, …). */
export function collectReferencedModuleIds(docs, candidateIds) {
  const found = new Set();
  if (!candidateIds?.size) return found;
  for (const doc of docs || []) {
    let json;
    try { json = JSON.stringify(doc ?? null); } catch { continue; }
    if (!json) continue;
    for (const id of candidateIds) if (json.includes(id)) found.add(id);
  }
  return found;
}
