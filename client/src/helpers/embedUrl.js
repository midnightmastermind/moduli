// helpers/embedUrl.js
// ============================================================
// TURNING A URL YOU PASTED INTO ONE A FRAME CAN ACTUALLY SHOW.
//
// Most of the web refuses to be framed, and `BookmarkView` already reports that
// honestly — its own comment records the measurements: `github DENY`,
// `youtube/reddit/google SAMEORIGIN`, `wikipedia allows`. So pasting a normal
// YouTube link produced a "blocked" panel: truthful, and useless.
//
// But a site that refuses to frame its PAGE often publishes a second URL that
// exists precisely to be framed. Measured against the live endpoints rather
// than assumed:
//
//     youtube.com/watch?v=X    X-Frame-Options: SAMEORIGIN   blocked
//     youtube.com/embed/X      (no header, HTTP 200)         frames
//
// So this is a rewrite, not a workaround: the same video, at the address its
// owner publishes for the purpose.
//
// ── WHY ONLY FOUR SITES ────────────────────────────────────────────────────
//
// Every candidate was checked against its real endpoint, and three were CUT for
// failing the check:
//
//     codepen.io/…/embed/…     HTTP 403 + SAMEORIGIN   does not frame
//     platform.twitter.com     needs their widget JS; a bare URL is not usable
//     google.com/maps/embed    HTTP 404 + SAMEORIGIN without an API key
//
// Shipping those would have put three dead entries behind a feature that looked
// finished. Four rules that demonstrably work beat seven that mostly do.
//
// ── IT IS A TABLE, NOT A CHAIN OF IFs ──────────────────────────────────────
//
// `occurrenceUrl`'s header sets the rule this follows: a thing is treated as a
// link because it HAS a url, "never because something learned what a 'bookmark'
// is". This is unavoidably knowledge ABOUT specific sites — there is no way to
// derive "/watch?v= becomes /embed/" — so it is confined to one auditable table
// rather than scattered through the renderer.
//
// Returns `null` for anything it does not know, and the caller keeps whatever
// behaviour it had. An unknown site is never made worse by this existing.
// ============================================================

/**
 * Each rule pairs a host test with a rewrite. The rewrite returns a URL string,
 * or null when the HOST matched but this particular URL is not embeddable — a
 * YouTube channel page, say, where the site is right and the shape is not.
 */
const RULES = [
  {
    id: "youtube",
    hosts: /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i,
    rewrite(u) {
      let id = null;
      if (/(^|\.)youtu\.be$/i.test(u.hostname)) id = u.pathname.slice(1).split("/")[0];
      else if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        // /embed/X is already right; /shorts/X, /live/X and /v/X are the same video.
        const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
        if (m) id = m[2];
      }
      if (!id || !/^[\w-]{6,}$/.test(id)) return null;
      const out = new URL(`https://www.youtube.com/embed/${id}`);
      // The timestamp is the one param worth carrying: linking to 4:12 and
      // starting at 0 is a silently wrong answer. YouTube spells it `t` on a
      // watch URL and `start` on an embed.
      const t = u.searchParams.get("t") || u.searchParams.get("start");
      if (t) {
        const secs = /^\d+$/.test(t) ? Number(t) : parseClockish(t);
        if (secs > 0) out.searchParams.set("start", String(secs));
      }
      const list = u.searchParams.get("list");
      if (list) out.searchParams.set("list", list);
      return out.toString();
    },
  },
  {
    id: "vimeo",
    hosts: /(^|\.)vimeo\.com$/i,
    rewrite(u) {
      if (/(^|\.)player\.vimeo\.com$/i.test(u.hostname)) return u.toString();
      const m = /^\/(\d+)/.exec(u.pathname);
      return m ? `https://player.vimeo.com/video/${m[1]}` : null;
    },
  },
  {
    id: "spotify",
    hosts: /(^|\.)spotify\.com$/i,
    rewrite(u) {
      if (u.pathname.startsWith("/embed/")) return u.toString();
      const m = /^\/(track|album|playlist|episode|show|artist)\/([^/?#]+)/.exec(u.pathname);
      return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
    },
  },
  {
    id: "soundcloud",
    hosts: /(^|\.)soundcloud\.com$/i,
    rewrite(u) {
      if (/(^|\.)w\.soundcloud\.com$/i.test(u.hostname)) return u.toString();
      // SoundCloud's player takes the ORIGINAL url as a parameter rather than an
      // id, so nothing needs extracting — but a bare profile page has nothing to
      // play, and only a track or a set does.
      if (!/^\/[^/]+\/(sets\/)?[^/?#]+/.test(u.pathname)) return null;
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.toString())}`;
    },
  },
];

/** "1h2m10s" / "2m10s" / "90" -> seconds. 0 when it makes no sense. */
function parseClockish(t) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(String(t).trim());
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

/**
 * The embeddable form of `url`, or `null` when nothing here knows it.
 *
 * Null is the important half of the contract: the caller keeps its existing
 * behaviour — reader, archive, or an honest "this site refuses to be framed" —
 * so a site this table has never heard of is never made worse.
 */
export function embedUrlFor(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  // Anything that is not http(s) is not a page. And an http:// URL is left
  // alone rather than silently upgraded — that would be a guess about someone
  // else's server, and the mixed-content block is the honest signal.
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  for (const rule of RULES) {
    if (!rule.hosts.test(u.hostname)) continue;
    try { return rule.rewrite(u) || null; } catch { return null; }
  }
  return null;
}

/** Which rule claimed a url — so the UI can say WHY it managed to embed it. */
export function embedProviderFor(url) {
  if (typeof url !== "string") return null;
  let u; try { u = new URL(url.trim()); } catch { return null; }
  const rule = RULES.find((r) => r.hosts.test(u.hostname));
  if (!rule) return null;
  try { return rule.rewrite(u) ? rule.id : null; } catch { return null; }
}

export const EMBED_PROVIDERS = RULES.map((r) => r.id);
