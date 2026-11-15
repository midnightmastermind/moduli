// helpers/openUrls.js — the OPEN_URLS operation step: open links in the browser (glossary page, 2026-11-15).
//
// `urlsFrom` is pure and lives here so the executor (which also runs in the sweep worker) can import it; `openUrls`
// touches the window and is only called by the effect applier on the page.
//
// A browser lets one click open ONE tab unless the site may open pop-ups, so the rest come back null: they are
// counted as blocked, and the caller tells the user how to allow them.

const isWebUrl = (u) => typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim());

/** Every http(s) address in `value` — link chips (`meta.link.url`), records with a `url`, or plain strings —
 *  once each, in order. Pure. */
export function urlsFrom(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const out = [];
  for (const v of list) {
    const u = typeof v === "string" ? v : v?.meta?.link?.url || v?.url || null;
    if (isWebUrl(u) && !out.includes(u.trim())) out.push(u.trim());
  }
  return out;
}

/** Open each address in a new tab. @returns {{ opened: number, blocked: number }} */
export function openUrls(urls, win = typeof window !== "undefined" ? window : null) {
  let opened = 0, blocked = 0;
  for (const u of urls || []) {
    const tab = win?.open?.(u, "_blank");
    if (!tab) { blocked++; continue; }
    try { tab.opener = null; } catch { /* cross-origin already */ }
    opened++;
  }
  return { opened, blocked };
}
