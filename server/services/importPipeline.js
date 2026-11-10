// services/importPipeline.js
//
// ONE IMPORT PIPELINE (spec 2026-11-09 smarter imports, §A). Every source becomes markdown + a small
// metadata object, and markdownToModuli turns that into occurrences:
//
//     source ──► extract ──► { markdown, meta } ──► markdownToModuli ──► page
//
//   link   readLinkForImport (the viewer's own read); a *.wikipedia.org/wiki/* link reads through the
//          Wikipedia extraction (readerFromHtml = wikiHtmlToMarkdown + the infobox lead image)
//   html   the same read, on html already in hand
//   image  server OCR (services/serverOcr) → utils/ocrLayout magic markdown, the picture embedded first
//   text   as is
//
// `meta = { title, images: [{ url, occurrenceId? }], fields: {}, type: null|string, source: { kind, url? } }`.
// Later stages (structured data, board match, Ollama clean-up) fill `fields` / `type`.
//
// THE WRITER is markdownToModuli and nothing else (no Occurrence.create here; persistImportResult only
// mirrors its rows into the warm cache, the same pass import_text runs after it). `runImport` writes with
// `paragraphBlocks` (one textblock per real paragraph) and `boldSections`; the existing import_text /
// import_url handlers keep their own reader/magic shapes (services/importShape.js) and call
// `extractImport` only for the markdown (ruling R1).
//
// THE WARM CACHE: markdownToModuli writes Mongo; a caller that can reach the user's cache passes
// `deps.uc` (persistImportResult mirrors the rows into it) and `deps.broadcast(event, payload)` (the
// tabs). Without them a write still lands in Mongo and shows on the next cold load.

import { markdownToModuli } from "./markdownImporter.js";
import { ocrImage as defaultOcrImage } from "./serverOcr.js";
import { ocrToMarkdown } from "../utils/ocrLayout.js";
import { readLinkForImport } from "../utils/linkImport.js";
import { imagesFromHtml } from "../utils/pageImages.js";
import { bestTitleFrom } from "../utils/pageTitle.js";
import { persistImportResult } from "../utils/persistImport.js";
import { linkRootIntoParent } from "../utils/linkRootIntoParent.js";
import { decompressTextmap } from "../utils/textmapCompression.js";
import { readStructuredData } from "../utils/structuredData.js";
import { matchBoard as defaultMatchBoard, structuredFieldValues } from "./boardMatch.js";

/** Fewer words than this and an import is EMPTY: nothing is written (an OCR of a photo with no text). */
export const MIN_IMPORT_WORDS = 3;

const emptyMeta = (source) => ({
  title: "", images: [], fields: {}, type: null,
  source: { kind: source.kind, ...(source.url ? { url: source.url } : {}) },
});

/** Words of real text in markdown: image lines and link targets dropped, a word must hold a letter or digit. */
export function importWordCount(markdown) {
  const prose = String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** `https://en.wikipedia.org/wiki/Albert_Ellis#x` → "Albert Ellis"; null for any other address. */
export function wikipediaTitleOf(url) {
  try {
    const u = new URL(String(url));
    if (!/(^|\.)wikipedia\.org$/i.test(u.hostname)) return null;
    const m = /^\/wiki\/(.+)$/.exec(u.pathname);
    if (!m) return null;
    return decodeURIComponent(m[1]).replace(/_/g, " ").trim() || null;
  } catch { return null; }
}

/**
 * The name a page import takes: og:title, else <title> without the site's brand (pageTitle.bestTitleFrom),
 * then one trailing " | Section" / " — Site" segment and a trailing "(Site Name)" are dropped when what
 * remains is still a title. Pure.
 */
export function importTitleFromHtml(html, url) {
  let t = bestTitleFrom(html, url);
  const seg = /^(.{8,}?)\s+[|–—]\s+[^|–—]{1,40}$/.exec(t);
  if (seg) t = seg[1].trim();
  const paren = /^(.{8,}?)\s*\([^()]{3,60}\)$/.exec(t);
  if (paren) t = paren[1].trim();
  return t;
}

/** Where an uploaded file is served: the part of its path from "/uploads/" on, else null. */
export function uploadUrlFor(filePath) {
  const s = String(filePath || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/uploads/");
  return i >= 0 ? s.slice(i) : null;
}

/**
 * OCR markdown → the page's markdown: the first heading becomes the page's H1 (so it heads the root),
 * the picture is embedded right under it, the rest follows. The title is that heading's text, else the
 * opening words of the text.
 */
export function imagePageMarkdown(ocrMarkdown, imageUrl, fallbackTitle = "") {
  const lines = String(ocrMarkdown || "").split("\n");
  const hi = lines.findIndex((l) => /^#{1,6}\s+\S/.test(l));
  let title = "";
  if (hi >= 0) {
    title = lines[hi].replace(/^#{1,6}\s+/, "").trim();
    lines.splice(hi, 1);
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!title) title = fallbackTitle || firstWords(body);
  const parts = [];
  if (title) parts.push(`# ${title}`);
  if (imageUrl) parts.push(`![](${imageUrl})`);
  if (body) parts.push(body);
  return { markdown: parts.join("\n\n"), title };
}

function firstWords(text, max = 8) {
  const w = String(text || "").replace(/[#>*_`]/g, "").split(/\s+/).filter(Boolean).slice(0, max).join(" ");
  return w.length > 60 ? `${w.slice(0, 57)}…` : w;
}

/**
 * A web page → markdown + meta, through readLinkForImport (the viewer's own read). `fetchPageHtml` is
 * wrapped so the html it fetched is kept for the title and the picture list (one fetch for all three).
 *   viewer: false (the pipeline) — a Wikipedia article reads through the Wikipedia extraction headed by
 *     its article name; any other page's markdown is its own content, the title rides in meta.
 *   viewer: true  (import_url / POST /import/url) — exactly readLinkForImport's markdown and <title>,
 *     so those paths build the tree they always built.
 */
async function extractPage({ url, title, fetchPageHtml, source, viewer }) {
  let fetched = null;
  const keep = async (u) => { const r = await fetchPageHtml(u); if (r?.ok) fetched = r; return r; };
  const wikiTitle = viewer ? null : wikipediaTitleOf(url);
  const read = await readLinkForImport(url, {
    title: title || wikiTitle || "", fetchPageHtml: keep, headWithTitle: viewer || !!wikiTitle,
  });
  if (!read.ok) {
    const err = new Error(read.reason || "could not reach that link");
    err.code = "fetch_failed";
    throw err;
  }
  const meta = emptyMeta(source);
  const pageUrl = read.sourceUrl || fetched?.url || url;
  if (pageUrl) meta.source.url = pageUrl;
  if (wikiTitle) meta.type = "wikipedia";
  // What the page says it is (JSON-LD, then Open Graph): its type, its own title, its values (Task 6).
  const sd = fetched && !viewer ? readStructuredData(fetched.html, pageUrl) : null;
  if (sd?.type && !wikiTitle) meta.type = sd.type;
  meta.title = title || wikiTitle || (sd?.type && sd.title) || (fetched && !viewer ? importTitleFromHtml(fetched.html, pageUrl) : "") || read.title || "";
  meta.images = fetched ? imagesFromHtml(fetched.html, pageUrl).map((im) => ({ url: im.url })) : [];
  if (sd?.image && /^https?:/i.test(sd.image) && !meta.images.some((im) => im.url === sd.image)) meta.images.unshift({ url: sd.image });
  if (sd) {
    meta.fields = { ...sd.fields, ...(sd.author ? { author: sd.author } : {}), ...(sd.date ? { date: sd.date } : {}),
      ...(meta.title ? { title: meta.title } : {}), ...(pageUrl ? { url: pageUrl } : {}) };
  }
  return { markdown: read.markdown, meta, pageTitle: read.title || "", sourceUrl: pageUrl };
}

/**
 * Extract stage: any source → { markdown, meta } (a page also carries `pageTitle` — its raw <title> — and
 * `sourceUrl`). A link that cannot be read throws its reason with `err.code = "fetch_failed"`.
 * @param deps { fetchPageHtml, ocrImage } — injectable for tests.
 * @param opts { viewer } — see extractPage.
 */
export async function extractImport(source, deps = {}, { viewer = false } = {}) {
  if (!source || !source.kind) throw new Error("extractImport: source.kind required");
  const ocrImage = deps.ocrImage || defaultOcrImage;

  if (source.kind === "text") {
    const meta = emptyMeta(source);
    meta.title = source.title || "";
    return { markdown: String(source.text || ""), meta };
  }

  if (source.kind === "image") {
    const page = source.ocrPage || await ocrImage(source.filePath);
    const ocrMd = ocrToMarkdown(page, { mode: "magic" });
    const imageUrl = source.url || uploadUrlFor(source.filePath) || (source.imageOccurrenceId ? `occurrence:${source.imageOccurrenceId}` : null);
    const meta = emptyMeta(source);
    // An image whose OCR found no words is no page: hand back the bare OCR text so the caller sees it empty.
    if (importWordCount(ocrMd) < MIN_IMPORT_WORDS) {
      meta.title = source.title || "";
      return { markdown: ocrMd, meta };
    }
    const { markdown, title } = imagePageMarkdown(ocrMd, imageUrl, source.title || "");
    meta.title = title;
    if (imageUrl) meta.images = [{ url: imageUrl, ...(source.imageOccurrenceId ? { occurrenceId: source.imageOccurrenceId } : {}) }];
    return { markdown, meta };
  }

  if (source.kind === "html") {
    const html = String(source.html || "");
    return extractPage({ url: source.url || "", title: source.title || "", source, viewer,
      fetchPageHtml: async () => ({ ok: true, html, url: source.url || "" }) });
  }

  if (source.kind === "link") {
    const fetchPageHtml = source.html != null
      ? async () => ({ ok: true, html: String(source.html), url: source.url })
      : deps.fetchPageHtml || (await import("../utils/safeFetchUrl.js")).fetchPageHtml;
    return extractPage({ url: source.url, title: source.title || "", source, viewer, fetchPageHtml });
  }

  throw new Error(`extractImport: unknown source kind "${source.kind}"`);
}

const IMAGE_LINE = /^\s*!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)\s*$/;

/**
 * What the share window let the user change (Task 5), applied to the extracted page. Pure.
 *   title   the page's name
 *   body    replaces the page's FIRST paragraph (not a heading, picture, quote or list); appended if none
 *   images  the pictures to keep: an image line whose address is not in the list is dropped
 */
export function applyImportOverrides(markdown, meta, { title, body, images } = {}) {
  let md = String(markdown || "");
  const next = { ...meta, images: [...(meta?.images || [])] };
  if (typeof title === "string" && title.trim()) next.title = title.trim();
  if (Array.isArray(images)) {
    const keep = new Set(images);
    md = md.split("\n").filter((l) => { const m = IMAGE_LINE.exec(l); return !m || keep.has(m[1]); }).join("\n");
    next.images = next.images.filter((im) => keep.has(im.url));
  }
  if (typeof body === "string" && body.trim()) {
    const blocks = md.split(/\n\s*\n/);
    const i = blocks.findIndex((b) => { const t = b.trim(); return t && !/^(#|>|!\[|[-*+]\s|\d+\.\s|\|)/.test(t); });
    if (i >= 0) blocks[i] = body.trim(); else blocks.push(body.trim());
    md = blocks.join("\n\n");
  }
  return { markdown: md, meta: next };
}

/**
 * The whole import. dryRun plans and writes nothing (the share window's preview, the eval runner).
 * @returns {{ markdown, meta, plan?, rootOccurrenceId?, empty: boolean }}
 */
export async function runImport({ source, gridId, userId, parentId = null, parentFolderId = null, dryRun = false, externalId = null, overrides = null }, deps = {}) {
  const extracted = await extractImport(source, deps);
  const { markdown, meta } = overrides ? applyImportOverrides(extracted.markdown, extracted.meta, overrides) : extracted;
  if (importWordCount(markdown) < MIN_IMPORT_WORDS) return { markdown, meta, empty: true };

  // A typed page takes the row shape of the board where the grid keeps that type (it still lands in Imports).
  if (meta.type && gridId && !deps.noBoard) {
    const board = await (deps.matchBoard || defaultMatchBoard)({ userId, gridId, type: meta.type });
    if (board) {
      meta.board = { id: board.id, label: board.label };
      const read = structuredFieldValues(board.fields, meta.fields);
      meta.boardValues = { ...(board.shape?.autoFields || {}), ...read };
      // Only what was READ off the page is shown; the board's own values keep the board's hidden flags.
      meta.boardShown = Object.keys(read);
      meta.boardBindings = board.bindings || [];
    }
  }

  const existingImages = {};
  for (const im of meta.images) if (im.occurrenceId) existingImages[im.url] = im.occurrenceId;
  const sourceUrl = source.kind === "link" || source.kind === "html" ? (meta.source.url || source.url || null) : null;

  const plan = await markdownToModuli({
    gridId: gridId || null, userId, markdown, dryRun,
    parentId, parentFolderId,
    title: meta.title || null, sourceUrl,
    sourceLabel: sourceUrl ? `${meta.title || "Source"} ↗` : null,
    boldSections: true, paragraphBlocks: true, existingImages,
    ...(meta.board ? { rootFields: { bindings: meta.boardBindings, values: meta.boardValues, show: meta.boardShown } } : {}),
    // `importExternalId`: the share this page came from, so a re-share finds the page instead of minting another.
    rootMeta: { importSource: meta.source, importedAt: new Date().toISOString(), ...(externalId ? { importExternalId: externalId } : {}) },
  });
  if (dryRun) return { markdown, meta, plan, empty: false };

  // markdownToModuli has written Mongo (and pushed the root into its parent). Mirror the rows into the
  // warm cache as the import handlers do (persistImportResult), sync the parent, announce to the tabs.
  await persistImportResult({ result: plan, userId, uc: deps.uc || null });
  // A caller with no cache handle (a background job) mirrors through `deps.mirror(model, doc)` instead.
  if (deps.mirror) {
    for (const m of plan.modules) deps.mirror("module", { ...m, userId });
    for (const o of plan.occurrences) deps.mirror("occurrence", { ...o, userId });
  }
  if (parentId) {
    const linked = await linkRootIntoParent({ parentId, childId: plan.rootOccurrenceId, userId });
    if (linked) {
      const parentObj = typeof linked.toObject === "function" ? linked.toObject() : linked;
      if (deps.uc?.occurrencesById?.[parentObj.id]) {
        deps.uc.occurrencesById[parentObj.id] = { ...deps.uc.occurrencesById[parentObj.id], occurrences: parentObj.occurrences };
      }
      if (parentObj.textmap) parentObj.textmap = decompressTextmap(parentObj.textmap);
      deps.mirror?.("occurrence", parentObj);
      deps.broadcast?.("occurrence_updated", { occurrence: parentObj });
    }
  }
  for (const m of plan.modules) deps.broadcast?.("module_created", { module: m });
  for (const o of plan.occurrences) deps.broadcast?.("occurrence_created", { occurrence: o });
  return { markdown, meta, plan, rootOccurrenceId: plan.rootOccurrenceId, empty: false };
}
