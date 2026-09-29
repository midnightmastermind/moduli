// helpers/coverQuery.js — the image-search query for a row's cover.
//
// Pure and dependency-free so the share placement window can use it without
// pulling in CommitHelpers (coverPick.js re-exports it for the app).

// The search hint a kind implies, keyed by the artifact kind the row carries.
const KIND_HINT = {
  movie: "movie poster",
  book: "book cover",
  show: "tv show poster",
  "tv show": "tv show poster",
  tv: "tv show poster",
  podcast: "podcast cover",
  album: "album cover",
  music: "album cover",
  game: "game cover",
};

export function coverSearchQuery({ label, kind }) {
  const title = String(label || "").trim();
  const hint = KIND_HINT[String(kind || "").toLowerCase()] || "";
  return [title, hint].filter(Boolean).join(" ");
}
