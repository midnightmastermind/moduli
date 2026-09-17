// utils/linkImport.js
//
// A LINK BECOMES A PAGE OR A BOOKMARK, and there were already two ways to do
// each that disagreed with the viewer.
//
// ── THE PAGE ─────────────────────────────────────────────────────────────────
// Reader/Magic (`page_reader`) read a page through `readerFromHtml`, which lifts
// the infobox picture back in before the strip (2026-09-16 (3)). The two MINT
// paths — the `import_url` socket handler and `/api/v1/import/url` — each kept
// their own copy of the OLDER chain (`extractMainContent` → `wikiHtmlToMarkdown`)
// and never learned about the lead image or about `shape`. So "make a page from
// this link" produced a different page from the one on screen, and Albert Ellis
// came back without his portrait. `readLinkForImport` is that read, once.
//
// ── THE BOOKMARK ─────────────────────────────────────────────────────────────
// `bookmarkRecords` is the SERVER twin of the client's `addBookmarkOccurrence`
// (helpers/CommitHelpers.js). The client cannot import server code, so the
// shape is restated here — and pinned by a test on exactly the keys the
// renderer reads (`role/kind/fileRef/meta.external` on the module,
// `meta.url` on the occurrence), which is where the two could drift.
import { readerFromHtml } from "./readerExtract.js";
import { titleFromHtml } from "./linkPreview.js";
import { hostOf } from "./pageTitle.js";

/**
 * Fetch a link and turn it into the markdown the viewer would show.
 * @returns {{ok:false, reason:string} | {ok:true, markdown:string, title:string, sourceUrl:string, words:number}}
 */
export async function readLinkForImport(url, { title = "", fetchPageHtml }) {
  const fetched = await fetchPageHtml(url);
  if (!fetched?.ok) return { ok: false, reason: fetched?.reason || "could not reach that link" };
  const sourceUrl = fetched.url || url;
  // The page's own <title> heads the imported container, as the viewer heads
  // Reader/Magic with it; an explicit title outranks it.
  const pageTitle = title || titleFromHtml(fetched.html) || hostOf(sourceUrl) || sourceUrl;
  const { markdown, words } = readerFromHtml(fetched.html, pageTitle);
  return { ok: true, markdown, words, title: pageTitle, sourceUrl };
}

/** Is this an address a bookmark can point at? Only web pages. */
export function isBookmarkableUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

/**
 * The module + occurrence a saved bookmark is made of. Pure.
 *
 * `preview` is `fetchLinkPreview`'s answer, or null when the page could not be
 * reached — a bookmark to a dead site is still a bookmark, named for its host.
 * A caller-supplied `label` outranks the page's own title, exactly as on the
 * client: a name somebody typed is a choice.
 */
export function bookmarkRecords({ gridId, userId, url, parentId, label = null, preview = null, newId }) {
  const moduleId = newId();
  const occurrenceId = newId();
  const ok = preview?.ok === true;
  const module = {
    id: moduleId, userId, gridId,
    role: "artifact", kind: "bookmark",
    label: label || (ok && preview.title) || hostOf(url) || "Bookmark",
    fileRef: url,
    meta: { external: true, ...(ok && preview.cover ? { cover: preview.cover } : null) },
  };
  const occurrence = {
    id: occurrenceId, userId, gridId, moduleId,
    parentId: parentId || null,
    fields: {},
    meta: { url },
  };
  return { module, occurrence };
}
