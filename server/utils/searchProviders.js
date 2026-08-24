// server/utils/searchProviders.js
//
// "Loop in search providers, and we have prefilled fields that come with those
// new occurrences" (user, 2026-08-23).
//
// A provider turns a typed query into candidate records that can BECOME an
// occurrence. The registry exists so a provider is a DATA choice on a field
// (`meta.searchProvider`) rather than a branch in the UI — the same way
// `optionsSource` and `addNew` already work.
//
// ── EVERY PROVIDER LIVES HERE, ON THE SERVER, AND THAT IS NOT INCIDENTAL ────
//
//   - API keys must never ship in a bundle. Wikipedia needs none, but TMDB and
//     USDA do, and the boundary has to exist before the first keyed provider.
//   - Several providers forbid browser CORS outright.
//   - Rate limits belong in ONE place. `0054` had to learn this twice: Photon
//     and Nominatim were given a SHARED queue and every lookup paid a 2.2s wait
//     for no reason. A limit is per provider.
//
// ── THE RESULT SHAPE IS NORMALISED, AND `externalId` IS THE LOAD-BEARING PART ─
//
// The dropdown MERGES provider results with the user's own occurrences (user:
// *"we still have our search for our own occurances merged in there"*), so a
// result already on the grid must not be offered a second time. That match is on
// the provider's own identity — a Wikipedia pageid, a TMDB id, an ISBN — stored
// on the occurrence when it was imported.
//
// **NEVER ON THE TITLE.** "Inception" the film and "Inception" the soundtrack are
// different rows, and `0035` is what a title match costs: it moved a real project
// page because a marker "looked like" a template.

/** What every provider returns, whatever it searched. */
export function normalizeResult({ provider, externalId, title, subtitle = null, thumbnail = null, url = null, fields = {} }) {
  return {
    provider,
    externalId: externalId == null ? null : String(externalId),
    title: title || "",
    subtitle: subtitle || null,
    thumbnail: thumbnail || null,
    url: url || null,
    fields,                       // filled by `detail()`; empty from `search()`
  };
}

/**
 * Drop results the grid already holds.
 * PURE — the merge rule, so it can be driven without a network or a database.
 *
 * @param results   normalised provider results
 * @param existing  Set of `${provider}:${externalId}` already on the grid
 */
export function dropAlreadyOnGrid(results, existing) {
  const seen = new Set();
  const out = [];
  for (const r of results || []) {
    if (!r) continue;
    const key = r.externalId ? `${r.provider}:${r.externalId}` : null;
    // A result with NO identity is kept — it can still be imported, it just
    // cannot be deduped. Dropping it would silently hide a real answer.
    if (key) {
      if (existing?.has?.(key)) continue;
      if (seen.has(key)) continue;      // the provider itself returned it twice
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

/** `${provider}:${externalId}` for an occurrence that was imported. */
export function gridKeyOf(occ) {
  const p = occ?.meta?.searchProvider;
  const e = occ?.meta?.searchExternalId;
  return p && e ? `${p}:${e}` : null;
}

/** Every provider key an occurrence list already holds. */
export function existingKeys(occurrences) {
  const s = new Set();
  for (const o of occurrences || []) { const k = gridKeyOf(o); if (k) s.add(k); }
  return s;
}

// ── THE REGISTRY ───────────────────────────────────────────────────────────
//
// `search` is the list; `detail` is what a PICK turns into fields. They are
// separate because searching is cheap and per-keystroke while detail is one
// request for one chosen thing — collapsing them would fetch a full record for
// every candidate nobody picked.
export const PROVIDERS = {};

export function registerProvider(p) {
  if (!p?.id || typeof p.search !== "function") throw new Error("a provider needs an id and a search()");
  PROVIDERS[p.id] = p;
  return p;
}

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

/** Which providers are usable right now — a keyed one with no key is NOT offered. */
export function availableProviders(env = process.env) {
  return Object.values(PROVIDERS)
    .filter((p) => !p.requiresEnv || env[p.requiresEnv])
    .map((p) => ({ id: p.id, label: p.label, needsKey: !!p.requiresEnv }));
}
