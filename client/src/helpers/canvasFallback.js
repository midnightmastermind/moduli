// helpers/canvasFallback.js
//
// How wide a canvas card is, and where a card with no saved x/y sits.
//
// A canvas is a 4000px world whose view opens at its CENTER, so a corner default puts a card
// off screen — and every position-less card at the SAME corner stacks them on top of each
// other (the container canvas did this, so the artifact viewer's canvas arrangement looked
// empty — UI sweep 2026-10-19). Position-less cards sit SIDE BY SIDE near the center, 4 per
// row, by child order: a column with a short row step buried a tall card (a book cover) under
// the next one. The first drag saves a real meta.x/y and takes over.
//
// A book / PDF reader is 520px wide on a canvas (user, 2026-10-19 — at 300 its header could
// not fit "Magic file"); every other card is at most 300.
export const CANVAS_FALLBACK_ORIGIN = { x: 1760, y: 1850 };
export const CANVAS_CARD_MAX = 300;
export const CANVAS_READER_WIDTH = 520;
const GAP = 20;
const ROW_STEP = 380;      // a row of ordinary cards
const READER_ROW_STEP = 560; // a row holding a reader (480px page + its header)
const PER_ROW = 4;

/** True for a card that renders a book / PDF reader. */
export function isReaderCard(module) {
  return module?.role === "artifact" && (module.kind === "ebook" || module.kind === "pdf");
}

/** The width a card takes on a canvas: a reader's fixed width, else null (sized by content, max 300). */
export function canvasCardWidth(module) {
  return isReaderCard(module) ? CANVAS_READER_WIDTH : null;
}

/**
 * Position for the child at `childIndex`. `widths` (optional) lists every child's width in
 * order — null/undefined counts as an ordinary card — so a wide reader pushes its row along
 * and makes its row taller instead of overlapping the next card.
 */
export function canvasFallbackPosition(childIndex, widths = null) {
  const i = Math.max(0, Number(childIndex) || 0);
  const w = (j) => (widths && widths[j]) || CANVAS_CARD_MAX;
  const row = Math.floor(i / PER_ROW);
  let x = CANVAS_FALLBACK_ORIGIN.x;
  for (let j = row * PER_ROW; j < i; j++) x += w(j) + GAP;
  let y = CANVAS_FALLBACK_ORIGIN.y;
  for (let r = 0; r < row; r++) {
    let tall = false;
    for (let j = r * PER_ROW; j < (r + 1) * PER_ROW; j++) if (w(j) > CANVAS_CARD_MAX) tall = true;
    y += tall ? READER_ROW_STEP : ROW_STEP;
  }
  return { x, y };
}
