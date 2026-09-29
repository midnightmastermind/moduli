// helpers/kindTiles.js — the human label + one-line description for each kind a
// tile can create. The icon + color come from moduleIcons (getModuleTypeBadge).
//
// A plain module so any surface can name a kind the SAME way the + menu does:
// the share placement window's "make it a…" list reads it too, and two
// vocabularies for one kind is how they drift.
export const KIND_TILE = {
  instance:  { label: "Item",      desc: "Trackable item with fields" },
  board:     { label: "Board",     desc: "Containers as columns" },
  doc:       { label: "Document",  desc: "Rich-text editor" },
  canvas:    { label: "Canvas",    desc: "Free-form drawing surface" },
  table:     { label: "Table",     desc: "Spreadsheet grid" },
  folder:    { label: "Folder",    desc: "Card grid of child pages" },
  textblock: { label: "Textblock", desc: "Inline rich-text snippet" },
  artifact:  { label: "Artifact",  desc: "File-backed content" },
  image:     { label: "Image",     desc: "Search the web / upload / URL" },
  // User, 2026-09-04: *"a browser page occurrence that just acts as a browser
  // inline … without having to click on a bookmark."* It mints a BOOKMARK
  // artifact carrying `meta.scratch`, so reader / archive / framing / embeds all
  // come from the one implementation rather than a second surface.
  browser:   { label: "Browser",   desc: "An address bar — browse or watch inline" },
  // User, 2026-08-24: *"a wikipedia page button on the quick add menu so i can
  // search for wikipedia articles to turn into pages on the fly"*. It reuses
  // the SAME importer "convert this link to a page" uses, so a searched article
  // and a dropped link cannot produce two different pages.
  wikipedia: { label: "Wikipedia",  desc: "Search Wikipedia and import the article as a page" },
  // PAGE tiles (2026-07-29, per user). Distinct from the bare kinds above,
  // which create nested CONTAINERS: these mint a real page — filed in the
  // manifest tree — and place a preview of it where you clicked +.
  "page-board":  { label: "Board page",  desc: "New board page, previewed here" },
  "page-doc":    { label: "Doc page",    desc: "New document page, previewed here" },
  "page-table":  { label: "Table page",  desc: "New table page, previewed here" },
  "page-canvas": { label: "Canvas page", desc: "New canvas page, previewed here" },
  "page-folder": { label: "Folder page", desc: "New folder page, previewed here" },
};
