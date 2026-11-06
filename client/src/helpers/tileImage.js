// helpers/tileImage.js — the size of picture a board tile asks for. A tile is ~180px wide and movie rows store TMDB's 500px
// poster (~88 KB; w342 ~42 KB, measured 2026-11-05). The stored address is untouched, so the viewer still opens the full one.
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w(\d+)|original)(\/.+)$/;
const TILE_WIDTH = 342;

export function tileImageSrc(src) {
  if (!src) return src;
  const m = TMDB.exec(src);
  if (!m) return src;
  if (m[3] && Number(m[3]) <= TILE_WIDTH) return src;
  return `${m[1]}w${TILE_WIDTH}${m[4]}`;
}
