// helpers/frameSrc.js
//
// The address a browser frame actually loads.
//
// User, 2026-09-15: *"we also got the reader and magic view of this site but
// going to web just infinite loads"* — with the console reading
// `Blocked loading mixed active content "http://journal.sjdm.org/…"`.
//
// The grid is served over https, and a browser REFUSES an `http://` page inside
// an https page (mixed active content). That refusal is silent in the worst way:
// the frame never fires `load`, so the loading circle over it spins forever and
// the page looks like it is still trying. Reader and Magic worked because they
// read the page SERVER-side, where no such rule exists.
//
// So an `http://` address is asked for over `https://` instead. Nearly every site
// answers both (that one redirects `https://journal.sjdm.org` onward to its new
// host), and a site that genuinely has no https still ends the wait: the browser
// loads its own error document into the frame, which fires `load`, which clears
// the spinner — an honest failure instead of an endless one.
//
// Only when the page is itself https. On an http page (local dev) mixed content
// is not a thing, and upgrading would break a site that only speaks http.

export function frameSrcFor(url, { embedSrc = null, pageProtocol = null } = {}) {
  if (embedSrc) return embedSrc;
  if (!url || pageProtocol !== "https:") return url;
  return /^http:\/\//i.test(url) ? url.replace(/^http:\/\//i, "https://") : url;
}
