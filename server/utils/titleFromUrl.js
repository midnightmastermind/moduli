// A name for a link read from its own address, for sites that refuse to tell the server their <title>.
// Reddit answers the server's fetch with 403, so every shared Reddit post was named "reddit.com". A post's
// address carries its title as a slug: /r/<sub>/comments/<id>/<slug>/ -> "<Slug words> — r/<sub>".
// Shared by the client (bookmark labels) and the server (share labels). Null when nothing can be read.
export function titleFromUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/(^|\.)reddit\.com$/i.test(u.hostname)) return null;
  const m = /^\/r\/([^/]+)\/comments\/[a-z0-9]+(?:\/([^/?#]+))?/i.exec(u.pathname);
  if (!m) return null;
  const sub = `r/${m[1]}`;
  if (!m[2]) return sub;
  let slug = m[2];
  try { slug = decodeURIComponent(slug); } catch { /* keep as is */ }
  const words = slug.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return sub;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} — ${sub}`;
}
