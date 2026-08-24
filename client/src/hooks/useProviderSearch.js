// hooks/useProviderSearch.js
//
// The REMOTE half of a merged dropdown. The local half is computed
// synchronously by `mergedOptionSearch` and never waits on this — a provider
// that is slow, rate-limited or down must degrade to exactly today's behaviour.
//
// ── THREE THINGS THAT GO WRONG WITHOUT CARE ────────────────────────────────
//
// 1. **A request per keystroke.** Debounced, so typing "inception" is one search
//    and not nine. Providers rate-limit and several ask you not to hammer them.
// 2. **A late reply for a query you have moved on from.** Every request carries
//    a sequence number and a late one is discarded — the same stale-response
//    trap `BookmarkView`'s reader fetch guards, and the one that makes a
//    dropdown briefly show results for a word you already deleted.
// 3. **Reading "no results" from a request that never finished.** The state is
//    explicit (`idle | searching | done | error`) so an empty list during a
//    search is never rendered as "nothing found".
import { useEffect, useRef, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 260;

/**
 * @param provider   provider id, or null to stay dormant
 * @param query      the text typed into the dropdown
 * @param haveKeys   `${provider}:${externalId}` keys the grid already holds
 * @param fetchImpl  injectable for tests
 */
export function useProviderSearch({ provider, query, haveKeys = [], enabled = true, fetchImpl } = {}) {
  const [results, setResults] = useState([]);
  const [state, setState] = useState("idle");
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const haveKey = Array.isArray(haveKeys) ? haveKeys.join(",") : String(haveKeys || "");

  useEffect(() => {
    const q = String(query || "").trim();
    if (!enabled || !provider || !q) {
      // Dormant, not empty-with-an-answer. Clearing here is what stops results
      // for an old query lingering under a cleared box.
      setResults([]); setState("idle");
      return;
    }
    const seq = ++seqRef.current;
    setState("searching");
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const doFetch = fetchImpl || ((url, opts) => fetch(url, opts));
        const url = `/api/v1/search/${encodeURIComponent(provider)}`
          + `?q=${encodeURIComponent(q)}&have=${encodeURIComponent(haveKey)}`;
        const res = await doFetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (seqRef.current !== seq) return;              // a newer query is in flight
        if (!res?.ok) { setState("error"); setResults([]); return; }
        const j = await res.json();
        if (seqRef.current !== seq) return;
        setResults(Array.isArray(j?.results) ? j.results : []);
        setState("done");
      } catch (e) {
        if (e?.name === "AbortError") return;            // we cancelled it ourselves
        if (seqRef.current !== seq) return;
        setState("error"); setResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [provider, query, haveKey, enabled, fetchImpl]);

  useEffect(() => () => abortRef.current?.abort(), []);
  return { results, state };
}
