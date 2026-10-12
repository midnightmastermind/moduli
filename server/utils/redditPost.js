// server/utils/redditPost.js
//
// THE TEXT OF A SHARED REDDIT POST.
//
// The Reddit app (phone) and a Windows share send only a URL and a title, so a
// textblock filed from them had no body (user, 2026-10-12: "sharing reddit links
// doesnt allow the body to be transfered over"). The post has to be read after
// the fact, and Reddit refuses unauthenticated reads from a server — measured
// from the droplet: 403 for the page, for `.json`, for old.reddit, and for the
// app's `/s/` share links, with any user agent. So it is read through Reddit's
// official API with an APP token (client_credentials grant), which needs a
// "script" app's id and secret in server/.env:
//
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET   (and optionally REDDIT_USER_AGENT)
//
// Without them `readPost` says `not_configured` and fetches nothing.

const POST_ID = /^[a-z0-9]{2,12}$/i;

/** What a URL names: `{kind:"post", id}`, `{kind:"share", sub, code}`, or null. */
export function redditPostRef(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\.|^old\.|^new\.|^m\.|^np\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "redd.it") return parts[0] && POST_ID.test(parts[0]) ? { kind: "post", id: parts[0] } : null;
  if (host !== "reddit.com") return null;
  const c = parts.indexOf("comments");
  if (c >= 0 && parts[c + 1] && POST_ID.test(parts[c + 1])) return { kind: "post", id: parts[c + 1] };
  // The app's share link: /r/<sub>/s/<code> — a redirect to the post.
  if (parts[0] === "r" && parts[2] === "s" && parts[1] && parts[3]) return { kind: "share", sub: parts[1], code: parts[3] };
  return null;
}

export function createRedditReader({
  clientId = process.env.REDDIT_CLIENT_ID,
  clientSecret = process.env.REDDIT_CLIENT_SECRET,
  userAgent = process.env.REDDIT_USER_AGENT || "web:moduli-share:1.0 (by viafluere.com)",
  fetch: doFetch = globalThis.fetch,
} = {}) {
  const configured = !!(clientId && clientSecret);
  let token = null, tokenUntil = 0;

  async function appToken() {
    if (token && Date.now() < tokenUntil) return token;
    const r = await doFetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": userAgent,
      },
      body: "grant_type=client_credentials",
    });
    const b = r?.ok ? await r.json().catch(() => null) : null;
    if (!b?.access_token) return null;
    token = b.access_token;
    // A minute's margin so a request never goes out on a token about to lapse.
    tokenUntil = Date.now() + Math.max(0, (Number(b.expires_in) || 3600) - 60) * 1000;
    return token;
  }

  const api = (path, tok, extra = {}) => doFetch(`https://oauth.reddit.com${path}`, {
    ...extra, headers: { authorization: `Bearer ${tok}`, "user-agent": userAgent },
  });

  async function resolveShare(ref, tok) {
    // The share link answers with a redirect to the real post; read it, never follow it.
    const r = await api(`/r/${encodeURIComponent(ref.sub)}/s/${encodeURIComponent(ref.code)}`, tok, { redirect: "manual" });
    const loc = r?.headers?.get?.("location");
    const target = loc ? redditPostRef(new URL(loc, "https://www.reddit.com").href) : null;
    return target?.kind === "post" ? target.id : null;
  }

  async function readPost(url) {
    const ref = redditPostRef(url);
    if (!ref) return { ok: false, reason: "not_reddit" };
    if (!configured) return { ok: false, reason: "not_configured" };
    try {
      const tok = await appToken();
      if (!tok) return { ok: false, reason: "auth_failed" };
      const id = ref.kind === "post" ? ref.id : await resolveShare(ref, tok);
      if (!id) return { ok: false, reason: "unresolved" };
      const r = await api(`/comments/${encodeURIComponent(id)}?limit=1&raw_json=1`, tok);
      if (!r?.ok) return { ok: false, reason: `http_${r?.status ?? "error"}` };
      const body = await r.json().catch(() => null);
      const post = body?.[0]?.data?.children?.[0]?.data;
      if (!post) return { ok: false, reason: "no_post" };
      return {
        ok: true,
        title: String(post.title || ""),
        text: String(post.selftext || "").trim(),
        subreddit: post.subreddit || null,
        author: post.author || null,
        url: post.permalink ? `https://www.reddit.com${post.permalink}` : null,
      };
    } catch (e) {
      return { ok: false, reason: "error", message: e.message };
    }
  }

  return { configured, readPost };
}

let shared = null;
/** The process-wide reader (one token cache). */
export function redditReader() {
  if (!shared) shared = createRedditReader();
  return shared;
}
