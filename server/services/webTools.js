// services/webTools.js — Jonah's web lookups (user, 2026-11-16: "is it a normal chatbot … look up information" →
// "do 1 and 2": a web search the model can call). Search is the SearXNG instance on the droplet (127.0.0.1:8888,
// /etc/searxng, systemd `searxng`); a page is read through the same guarded fetch + main-content extractor the
// reader uses, so a link from a search result cannot reach the server's own network.
import { fetchPageHtml } from "../utils/safeFetchUrl.js";
import { readerFromHtml } from "../utils/readerExtract.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://127.0.0.1:8888";
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** SearXNG's JSON → what the model reads: title, url, snippet; one per address, at most `limit`. Pure. */
export function shapeResults(json, limit = 6) {
  const seen = new Set(); const out = [];
  for (const r of json?.results || []) {
    const url = String(r?.url || "");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: clean(r.title).slice(0, 120), url, snippet: clean(r.content).slice(0, 300) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function webSearch(query, { limit = 6, fetchImpl = globalThis.fetch, base = SEARXNG_URL, timeoutMs = 12000 } = {}) {
  const q = clean(query);
  if (!q) return { ok: false, error: "an empty search" };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=0`, { signal: ctl.signal });
    if (!res.ok) return { ok: false, error: `the search answered ${res.status}` };
    const results = shapeResults(await res.json(), limit);
    return { ok: true, query: q, results, ...(results.length ? {} : { note: "no results" }) };
  } catch (e) {
    return { ok: false, error: ctl.signal.aborted ? "the search timed out" : `the search is not reachable (${e.message})` };
  } finally { clearTimeout(t); }
}

/** Markdown → plain reading text: pictures dropped, links reduced to their words, capped. Pure. */
export function readingText(markdown, cap = 4000) {
  const text = String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
  return text.length > cap ? { text: text.slice(0, cap).replace(/\s+\S*$/, "") + " …", cut: true } : { text, cut: false };
}

export async function readPage(url, { fetchPage = fetchPageHtml, cap = 4000 } = {}) {
  const fetched = await fetchPage(String(url || ""), { timeoutMs: 15000 });
  if (!fetched?.ok) return { ok: false, url, error: fetched?.reason || "could not read the page" };
  const { markdown } = readerFromHtml(fetched.html || "");
  const { text, cut } = readingText(markdown, cap);
  if (!text) return { ok: false, url, error: "the page has no readable text" };
  return { ok: true, url, text, ...(cut ? { note: `the first ${cap} characters` } : {}) };
}
