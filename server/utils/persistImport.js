// utils/persistImport.js
//
// Persist an import result (the output of `markdownToModuli`) to MongoDB AND the
// in-memory per-user cache, so an imported subtree SURVIVES A RELOAD.
//
// Why this exists: both import entry points (the `import_text` socket handler and
// the `/research/wikipedia/import` + `/import/*` REST routes) used to ONLY
// broadcast `module_created` / `occurrence_created` to connected tabs. That made
// the import render live (the client folds the broadcast into local state) but
// the entities were never written to the DB — so on the next reload `full_state`
// (served from the DB-backed cache) didn't include them, and the page's
// `moduleEmbed` of the import root showed the `!mod` fallback ("just an embed
// block"). Persisting here closes that gap.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { compressTextmap } from "./textmapCompression.js";

export async function persistImportResult({ result, userId, uc = null }) {
  if (!result || !userId) return;
  const modules = Array.isArray(result.modules) ? result.modules : [];
  const occurrences = Array.isArray(result.occurrences) ? result.occurrences : [];

  // ONE bulkWrite per collection — NOT a per-entity awaited findOneAndUpdate. A real
  // article is ~800 modules + ~800 occurrences; the old per-doc loop made 1600+ SEQUENTIAL
  // round-trips, which on a remote DB is minutes (the "Jonah import spins ~190s"). `replaceOne`
  // upsert keeps the exact same semantics (full-doc replace, idempotent by id+userId).
  const modOps = [];
  for (const m of modules) {
    if (!m?.id) continue;
    const next = { ...m, userId };
    if (uc?.modulesById) uc.modulesById[m.id] = next;       // keep the warm cache in sync (raw)
    modOps.push({ replaceOne: { filter: { id: m.id, userId }, replacement: next, upsert: true } });
  }
  if (modOps.length) await Module.bulkWrite(modOps, { ordered: false });

  const occOps = [];
  for (const o of occurrences) {
    if (!o?.id) continue;
    // Cache keeps the RAW textmap (the client needs JSON); the DB stores it COMPRESSED
    // (matches update_occurrence). loadUserIntoCache decompresses on read. We never mutate
    // `o` — the route broadcasts it raw right after this.
    const raw = { ...o, userId };
    if (uc?.occurrencesById) uc.occurrencesById[o.id] = raw;
    const dbDoc = raw.textmap ? { ...raw, textmap: compressTextmap(raw.textmap) } : raw;
    occOps.push({ replaceOne: { filter: { id: o.id, userId }, replacement: dbDoc, upsert: true } });
  }
  if (occOps.length) await Occurrence.bulkWrite(occOps, { ordered: false });
}
