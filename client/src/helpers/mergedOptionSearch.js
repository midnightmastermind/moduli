// helpers/mergedOptionSearch.js
//
// A dropdown that searches YOUR GRID and an outside provider AT ONCE.
//
// User, 2026-08-23: *"i want to make sure we are looping the search options in.
// we still have our search for our own occurances merged in there."*
//
//   ┌─────────────────────────────────────────┐
//   │ ON YOUR GRID                            │  local, synchronous, always shown
//   │   Inception          Movies board       │
//   ├─────────────────────────────────────────┤
//   │ FROM WIKIPEDIA            ⟳             │  appended when it arrives
//   │   Inception — 2010 film by C. Nolan     │
//   └─────────────────────────────────────────┘
//
// ── THREE RULES, EACH A WAY THIS GOES WRONG ────────────────────────────────
//
// 1. **The local list never waits on a network call.** It is computed here,
//    synchronously, from options the dropdown already had. A provider that is
//    slow, rate-limited or down degrades to exactly today's behaviour.
// 2. **A provider result already on the grid is not offered twice** — matched on
//    the provider's own identity, never on a title. "Inception" the film and
//    "Inception (soundtrack)" are different pageids, and `0035` is what a title
//    match costs.
// 3. **The sections stay separate**, because picking one SELECTS and picking the
//    other IMPORTS — it mints an occurrence and fills its fields. One
//    undifferentiated list would make the second look like the first and quietly
//    grow the board.

/** Case-insensitive substring, tolerant of missing labels. */
function matches(text, q) {
  return String(text || "").toLowerCase().includes(q);
}

/**
 * The local half: the dropdown's own options, filtered by the query.
 * An EMPTY query returns everything — the dropdown still lists what it always
 * listed before anyone typed.
 */
export function filterLocalOptions(options, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return options || [];
  return (options || []).filter((o) => matches(o?.label, q) || matches(o?.value, q));
}

/** `${provider}:${externalId}` for an option that was imported from a provider. */
export function optionProviderKey(option) {
  const p = option?.meta?.searchProvider ?? option?.searchProvider;
  const e = option?.meta?.searchExternalId ?? option?.searchExternalId;
  return p && e ? `${p}:${e}` : null;
}

/** Every provider key the dropdown's own options already carry. */
export function localProviderKeys(options) {
  const s = new Set();
  for (const o of options || []) { const k = optionProviderKey(o); if (k) s.add(k); }
  return s;
}

/**
 * The two sections the dropdown renders.
 *
 * `remote` is whatever the provider returned (already normalised server-side);
 * it is filtered here as well as there, because the server only knows the keys
 * the client TOLD it about and this list is the ground truth.
 */
export function splitSections({ options = [], query = "", remote = [], remoteState = "idle" } = {}) {
  const local = filterLocalOptions(options, query);
  const have = localProviderKeys(options);
  const seen = new Set();
  const external = [];
  for (const r of remote || []) {
    if (!r) continue;
    const key = r.externalId ? `${r.provider}:${r.externalId}` : null;
    if (key) {
      if (have.has(key)) continue;     // already on the grid — rule 2
      if (seen.has(key)) continue;
      seen.add(key);
    }
    external.push(r);
  }
  return {
    local,
    external,
    // What the section header shows. `searching` is why the remote list can be
    // empty without meaning "no results" — a distinction the user has to see,
    // or a slow provider looks like a wrong answer.
    remoteState: query.trim() ? remoteState : "idle",
    hasAnything: local.length > 0 || external.length > 0,
  };
}
