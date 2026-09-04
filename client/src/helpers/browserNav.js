// helpers/browserNav.js
// ============================================================
// THE ADDRESS BAR AND HISTORY FOR AN INLINE BROWSER OCCURRENCE.
//
// User, 2026-09-04: *"a browser page occurrence that just acts as a browser
// inline — id like to watch youtube videos and such without having to click on
// a bookmark."*
//
// ── WHAT HISTORY CAN AND CANNOT MEAN HERE, stated up front ─────────────────
//
// The frame is cross-origin, so the parent **cannot read where it has gone**.
// `contentDocument` is null and `contentWindow.location` throws — the same wall
// `BookmarkView`'s header already records for selection and right-click. So:
//
//   - Back/forward track OUR navigations — what was typed or committed here.
//   - Clicking a link INSIDE the page is invisible to us. Back will return to
//     the last address WE set, not to the previous page you clicked through.
//
// That is a real limitation and not a bug to fix later; there is no browser API
// that lifts it. Naming it here is what stops someone building a "proper" back
// button on top and finding out afterwards.
//
// ── EVERYTHING IS PURE ──────────────────────────────────────────────────────
//
// The whole navigation model is a value: `{ entries, index }`. That makes the
// awkward parts — truncating the forward branch, refusing a no-op, normalising
// what someone typed — testable without mounting a frame.

/** Nothing typed, or something that cannot be a page. */
const BLANK = { entries: [], index: -1 };

export function initialNav(url) {
  const norm = normalizeTyped(url);
  return norm ? { entries: [norm], index: 0 } : { ...BLANK };
}

export const currentUrl = (nav) =>
  (nav && nav.index >= 0 && nav.entries[nav.index]) || null;

export const canGoBack = (nav) => !!nav && nav.index > 0;
export const canGoForward = (nav) => !!nav && nav.index < nav.entries.length - 1;

export const goBack = (nav) => (canGoBack(nav) ? { ...nav, index: nav.index - 1 } : nav);
export const goForward = (nav) => (canGoForward(nav) ? { ...nav, index: nav.index + 1 } : nav);

/**
 * Commit a typed address.
 *
 * TRUNCATES THE FORWARD BRANCH, which is what every browser does and what
 * anyone will expect: going back three pages and then somewhere new discards
 * the three you left, rather than leaving them reachable by a Forward button
 * that would jump somewhere unrelated.
 *
 * Re-committing the CURRENT url is a reload, not a history entry — otherwise
 * pressing Enter twice silently fills the history with duplicates and Back
 * appears broken.
 */
export function navigate(nav, typed) {
  const url = normalizeTyped(typed);
  if (!url) return nav;
  const base = nav && Array.isArray(nav.entries) ? nav : BLANK;
  if (currentUrl(base) === url) return base;
  const kept = base.entries.slice(0, base.index + 1);
  return { entries: [...kept, url], index: kept.length };
}

/**
 * What someone typed, as a url — or null if it cannot be one.
 *
 * `moduli.app` is what a person types; `https://moduli.app` is what a frame
 * needs. Bare hosts and paths get https, because an http:// frame is blocked as
 * mixed content on this app's own (https) page anyway, so defaulting to http
 * would produce a blank box for a reason the user cannot see.
 *
 * REFUSES `javascript:`, `data:` and `file:` outright. This value goes into an
 * iframe `src`, so a scheme that can execute in the page's context or read the
 * disk is the one genuinely dangerous input here.
 */
export function normalizeTyped(typed) {
  if (typeof typed !== "string") return null;
  const raw = typed.trim();
  if (!raw) return null;

  // REJECT THE DANGEROUS SCHEMES BY NAME, FIRST. They are the ones that carry
  // no `//`, so the authority test below would not recognise them as schemes at
  // all and would helpfully prepend https:// to `javascript:alert(1)`.
  if (/^(javascript|data|file|blob|vbscript|about):/i.test(raw)) return null;

  // A scheme only counts when it has an AUTHORITY (`scheme://`). Testing for a
  // bare colon instead treats `localhost:3000` as the scheme `localhost:` —
  // caught by the test, and it would have rejected every host:port anyone typed.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;

  let u;
  try { u = new URL(candidate); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  // A hostname with no dot is not a public site — "hello world" would otherwise
  // become https://hello%20world and frame an error page rather than telling
  // the user their address was not one. `localhost` is the deliberate exception.
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.toString();
}

/**
 * Is this occurrence a SCRATCH browser rather than a saved bookmark?
 *
 * User's call, 2026-09-04: one surface, a flag. A scratch browser is somewhere
 * to go and read; a saved one is a bookmark you meant to keep. The flag decides
 * whether typing an address is a navigation or an edit to your library.
 *
 * DEFAULTS TO SAVED. Every bookmark that exists today predates the flag, and
 * treating those as scratch would make the whole library look disposable — the
 * unknown must mean the pre-existing behaviour.
 */
export const isScratch = (occurrence) => occurrence?.meta?.scratch === true;
