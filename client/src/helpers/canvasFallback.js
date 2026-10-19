// helpers/canvasFallback.js
//
// Where a canvas card with no saved x/y sits. A canvas is a 4000px world whose view opens at
// its CENTER, so a corner default puts the card off screen — and every position-less card at
// the SAME corner stacks them on top of each other. They form tidy columns near the center
// instead (8 per column, 260px apart, 110px row step), by child order. The first drag saves a
// real meta.x/y and takes over.
//
// One rule for both canvases: the page canvas had it; the container canvas (which the
// artifact viewer's canvas arrangement uses) still put every card at (20,20), so switching
// the viewer to canvas showed an empty view (UI sweep 2026-10-19).
export const CANVAS_FALLBACK_ORIGIN = { x: 1760, y: 1850 };

export function canvasFallbackPosition(childIndex) {
  const i = Math.max(0, Number(childIndex) || 0);
  return {
    x: CANVAS_FALLBACK_ORIGIN.x + Math.floor(i / 8) * 260,
    y: CANVAS_FALLBACK_ORIGIN.y + (i % 8) * 110,
  };
}
