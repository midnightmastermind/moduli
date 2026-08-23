// extension/clip.js
//
// What a right-click becomes.
//
// PURE, and that is not a style choice: an MV3 extension cannot be loaded in
// this environment (established by trying — headless Chrome refuses to install
// one), so the plumbing around this file is genuinely unverifiable here. The
// DECISIONS are not, and they are where the mistakes live: which shape a
// context produces, what identity it carries, and what happens to a clip of
// something already clipped.
//
// ── THE FOUR CONTEXTS (spec, 2026-08-23) ───────────────────────────────────
//
//   selected text  -> the words
//   the page       -> a bookmark
//   a link         -> a bookmark, WITHOUT visiting it
//   an image       -> an artifact
//
// ── ONE DEVIATION FROM THE SPEC, STATED RATHER THAN QUIETLY MADE ───────────
//
// The spec says a selection becomes a TEXTBLOCK. It cannot, yet:
// `POST /api/v1/ingest` writes `label`, `fields` and `meta` and has no way to
// write a `textmap` — which is where a textblock's words actually live, and
// which is stored COMPRESSED. So a selection lands as a bookmark-shaped row
// whose `Excerpt` field holds the text and whose `URL` is the page it came
// from. Nothing is lost and nothing is invented; turning it into a real
// textblock is an `ingest`-writes-textmap pass, not a line here.

/** Menu ids, which double as the shape names. */
export const CLIP_MENUS = [
  { id: "clip-selection", title: "Clip selection to Moduli", contexts: ["selection"] },
  { id: "clip-link",      title: "Clip link to Moduli",      contexts: ["link"] },
  { id: "clip-image",     title: "Clip image to Moduli",     contexts: ["image"] },
  { id: "clip-page",      title: "Clip this page to Moduli", contexts: ["page"] },
];

/**
 * Which shape a click produced.
 *
 * ORDER MATTERS AND IS THE OPPOSITE OF THE MENU'S. Chrome fires `onClicked`
 * with whichever item was chosen, but `info` can carry SEVERAL of these at once
 * — right-clicking a linked image inside a selection populates `selectionText`,
 * `linkUrl` and `srcUrl` together. Reading `menuItemId` first is what makes the
 * user's actual choice win over a guess from the payload.
 */
export function clipShapeFor(info = {}) {
  const byMenu = String(info.menuItemId || "");
  if (byMenu.startsWith("clip-")) return byMenu.slice("clip-".length);
  if (info.srcUrl) return "image";
  if (info.linkUrl) return "link";
  if (info.selectionText) return "selection";
  return "page";
}

/**
 * True when the click happened inside an IFRAME rather than the page itself.
 *
 * This is the case that matters for Moduli: a bookmark opened in a panel is an
 * embedded frame, and the user asked to *"right click on the stuff inside the
 * iframe … add new occurances via right click"*. Chrome fires `onClicked` there
 * already — but `info.pageUrl` and `tab.title` describe the HOST page, which in
 * that situation is Moduli itself. Clipping without this check records
 * viafluere.com and the title "Moduli", silently, for an article you were
 * looking at.
 */
export function clipInFrame(info = {}) {
  const f = info.frameUrl;
  return typeof f === "string" && !!f && f !== info.pageUrl;
}

/**
 * The page a click is ABOUT — the FRAME's page when there is one.
 *
 * `frameUrl` first, because it is the more specific answer and is only ever
 * present when the click really was inside a frame.
 */
export function clipSourceUrl(info = {}, tab = {}) {
  return info.frameUrl || info.pageUrl || tab.url || null;
}

/** The URL a shape is ABOUT — its identity, and what a click will later open. */
export function clipUrlFor(shape, info = {}, tab = {}) {
  // A link's and an image's own URL is already absolute and already correct
  // inside a frame — the browser resolved it against the frame's own base.
  if (shape === "link") return info.linkUrl || null;
  if (shape === "image") return info.srcUrl || null;
  return clipSourceUrl(info, tab);
}

const trim = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The label a clipped row carries.
 *
 * A SELECTION IS NAMED BY ITS OWN FIRST WORDS, not by the page title: a row
 * reading "Wikipedia" tells you nothing about which sentence you kept, and a
 * board of clips from one article would be a column of identical labels.
 */
export function clipLabelFor(shape, info = {}, tab = {}) {
  // INSIDE A FRAME THE TAB TITLE BELONGS TO THE HOST PAGE, not to what you
  // right-clicked — every clip taken from a bookmark panel would be called
  // "Moduli". A wrong name is worse than a plain one, so the frame's own URL is
  // used instead. (An extension cannot read a cross-origin frame's <title>
  // without injecting a script into every frame on every site, which is a much
  // larger permission for a nicer label.)
  const inFrame = clipInFrame(info);
  const hostTitle = inFrame ? "" : tab.title;
  const fallback = clipSourceUrl(info, tab);

  if (shape === "selection") return trim(info.selectionText, 80) || trim(hostTitle, 80) || "Clipped text";
  if (shape === "link") return trim(info.linkText || info.selectionText || info.linkUrl, 120) || "Clipped link";
  if (shape === "image") return trim(hostTitle, 120) || trim(fallback, 120) || "Clipped image";
  return trim(hostTitle, 200) || trim(fallback, 200) || "Clipped page";
}

/** role/kind per shape — the same shapes the grid already has. */
export function clipModuleShape(shape) {
  if (shape === "image") return { moduleRole: "artifact", moduleKind: "image" };
  // Selection included: see the deviation note at the top. A bookmark-shaped
  // row keeps the source URL clickable, which a bare instance would not.
  return { moduleRole: "artifact", moduleKind: "bookmark" };
}

/**
 * The `/api/v1/ingest` record for one clip.
 *
 * @param fieldIds  { URL, Excerpt, Cover, Tags } -> field id, resolved once by
 *                  the caller from `GET /api/v1/fields`. A missing one is
 *                  SKIPPED rather than guessed: writing to an invented field id
 *                  produces a value nothing renders.
 * @returns null when there is no URL — a clip with no identity cannot be made
 *          idempotent, and re-clipping would pile up duplicates.
 */
export function buildClipRecord({ info = {}, tab = {}, fieldIds = {}, parentId = null } = {}) {
  const shape = clipShapeFor(info);
  const url = clipUrlFor(shape, info, tab);
  if (!url) return null;

  const fields = {};
  const put = (name, value) => { if (fieldIds[name] && value) fields[fieldIds[name]] = { value, flow: "in" }; };
  put("URL", url);
  if (shape === "selection") put("Excerpt", String(info.selectionText || "").trim());
  if (shape === "image") put("Cover", url);

  return {
    // IDENTITY IS THE URL, per shape. Clipping the same page twice updates one
    // row; clipping an image and its page keeps them apart, because the shape
    // is part of the key.
    externalId: `${shape}:${url}`,
    label: clipLabelFor(shape, info, tab),
    ...clipModuleShape(shape),
    moduleLabel: clipLabelFor(shape, info, tab),
    moduleFileRef: url,
    fields,
    ...(parentId ? { parentId } : {}),
    meta: { clipShape: shape, clippedFrom: info.pageUrl || tab.url || null },
  };
}
