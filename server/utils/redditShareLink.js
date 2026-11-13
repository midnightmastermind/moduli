// A Reddit SHARE link (`reddit.com/r/<sub>/s/<code>` or `reddit.com/s/<code>`, what the
// Reddit app hands out) hides which post it points to — and only a POST link can be
// framed (client helpers/embedUrl rewrites it to embed.reddit.com). Reddit answers a
// share link with a 301 whose Location is the post, so asking once tells us the post.
//
// Measured 2026-11-13: from the droplet a browser User-Agent gets 403, a link-preview
// one (`facebookexternalhit`) gets the 301 with the post in Location. The redirect is
// read, never followed — the post page itself is 403 from the droplet.

const SHARE_PATH = /^\/(?:r\/[^/]+\/)?s\/[A-Za-z0-9]+\/?$/;
const POST_PATH = /^\/(r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/?#]+)?(?:\/[a-z0-9]+)?)/i;
const UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

function parse(url) {
  try { const u = new URL(String(url).trim()); return /(^|\.)reddit\.com$/i.test(u.hostname) ? u : null; } catch { return null; }
}

export function isRedditShareLink(url) {
  const u = parse(url);
  return !!u && SHARE_PATH.test(u.pathname);
}

/** A Reddit post address without tracking: https://www.reddit.com/r/<sub>/comments/<id>/<slug>/ */
export function canonicalRedditPost(url) {
  const u = parse(url);
  const m = u && POST_PATH.exec(u.pathname);
  return m ? `https://www.reddit.com/${m[1].replace(/\/$/, "")}/` : null;
}

/**
 * The post a share link points to, or the url unchanged (not a share link, Reddit
 * did not answer, or the answer was not a post). Never throws.
 */
export async function expandRedditShareLink(url, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  if (!isRedditShareLink(url)) return url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(String(url).trim(), {
      method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": UA },
    });
    const loc = res?.headers?.get?.("location");
    if (!loc) return url;
    return canonicalRedditPost(new URL(loc, url).toString()) || url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}
