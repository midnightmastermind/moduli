// utils/searchRouteHandlers.js
//
// ONE implementation of the three search-provider endpoints, mounted twice.
//
// They are reached from two places with different auth: `/api/v1/search/*` is
// the external REST surface (Bearer token + rate limit, so an agent can use it)
// and `/api/search/*` is app-internal — the same class as `/api/images/search`,
// which is a keyless proxy to a public API that the app's OWN dropdown calls
// from the browser.
//
// **THE APP-INTERNAL MOUNT IS NOT AN OVERSIGHT, IT IS THE REASON THE FEATURE
// WORKS AT ALL.** The browser carries no API token — it authenticates over the
// socket with a JWT — so the field editor and the dropdown hitting the token-
// guarded `/api/v1` route got a 401 every time. The hook sent no Authorization
// header and could never have worked against the real server; it was found by
// reading the caller against the route rather than by any test, because every
// test injects its own fetch.
//
// Handlers live HERE, not copied into both mount points, because two
// hand-written twins drift — this repo has paid for that with `makeAlarmOp`
// (the 6:30 AM literal had already diverged) and the client/server alarm
// builders. A shared core is the fix it settled on both times.

/** Load the registry with every built-in provider registered. */
async function registry() {
  const mod = await import("./searchProviders.js");
  // Every built-in provider, each registering itself on import.
  await import("./providers/wikipedia.js");
  await import("./providers/wger.js");
  await import("./providers/openlibrary.js");
  await import("./providers/musicbrainz.js");
  await import("./providers/openfoodfacts.js");
  return mod;
}

const fail = (res, code, error, message) => res.status(code).json({ ok: false, error, message });

/** GET …/search/providers — what this deployment can actually search. */
export async function handleProvidersList(req, res) {
  try {
    const { availableProviders } = await registry();
    // A KEYED provider with no key is not listed at all — the failure belongs at
    // configuration, not at the user's keystroke.
    res.json({ ok: true, providers: availableProviders() });
  } catch (e) { fail(res, 500, "internal_error", e.message); }
}

/** GET …/search/:provider?q=&limit=&have= */
export async function handleProviderSearch(req, res) {
  try {
    const { getProvider, dropAlreadyOnGrid } = await registry();
    const p = getProvider(req.params.provider);
    if (!p) return fail(res, 404, "not_found", `No search provider "${req.params.provider}"`);

    const q = String(req.query.q || "").trim();
    // An empty query returns an empty list rather than searching for "" — every
    // provider treats that differently and none of them usefully.
    if (!q) return res.json({ ok: true, query: "", results: [] });

    const results = await p.search(q, { limit: Math.min(20, Number(req.query.limit) || 6) });
    // THE MERGE RULE. The caller passes the keys its grid already holds, so a
    // result already on the board is not offered a second time — matched on the
    // provider's own identity, never on a title.
    const already = new Set(String(req.query.have || "").split(",").filter(Boolean));
    res.json({ ok: true, query: q, results: dropAlreadyOnGrid(results, already) });
  } catch (e) { fail(res, 502, "provider_error", e.message); }
}

/** GET …/search/:provider/detail?title=&externalId= */
export async function handleProviderDetail(req, res) {
  try {
    const { getProvider } = await registry();
    const p = getProvider(req.params.provider);
    if (!p) return fail(res, 404, "not_found", `No search provider "${req.params.provider}"`);
    if (typeof p.detail !== "function") return fail(res, 400, "unsupported", "That provider has no detail step");
    const out = await p.detail({ title: req.query.title, externalId: req.query.externalId });
    if (!out) return fail(res, 404, "not_found", "Nothing to import for that result");
    res.json({ ok: true, result: out });
  } catch (e) { fail(res, 502, "provider_error", e.message); }
}
