// helpers/autoscrollMath.js
//
// Pure math for the drag-over edge autoscroll (DragProvider's continuous rAF
// loop). Extracted so the zone/ramp/grace behavior is unit-testable and tuned
// in one place.
//
// Feel contract (user 2026-07-24 — "slow and finicky", esp. mobile):
// - the edge zone scales with the container (quarter-height, clamped) instead
//   of a fixed 80px band,
// - speed RAMPS from a slow crawl at zone entry to a fast sweep pressed into
//   the edge (a finger past the rect keeps max pressure),
// - a grace band keeps the last scrollable alive when the finger overshoots
//   slightly outside its rect — the old dead-stop at the container edge.

export const AUTOSCROLL_MIN_SPEED = 6; // px/frame at zone entry
export const AUTOSCROLL_MAX_SPEED = 32; // px/frame pressed into the edge
export const AUTOSCROLL_GRACE_PX = 70; // rect overshoot that keeps scrolling

// Edge zone thickness for a container: a quarter of its height, clamped so
// short containers keep a grabbable middle and tall ones don't need
// pixel-hunting at the very edge.
export function autoscrollZone(rectHeight) {
  return Math.min(150, Math.max(56, rectHeight * 0.25));
}

// dir: -1 up / 1 down / 0 outside both zones.
// intensity: 0 at zone entry → 1 at the rect edge and beyond.
export function computeAutoscroll(rect, clientY) {
  const zone = autoscrollZone(rect.height);
  if (clientY < rect.top + zone) {
    const depth = (rect.top + zone - clientY) / zone;
    return { dir: -1, intensity: Math.min(1, Math.max(0, depth)) };
  }
  if (clientY > rect.bottom - zone) {
    const depth = (clientY - (rect.bottom - zone)) / zone;
    return { dir: 1, intensity: Math.min(1, Math.max(0, depth)) };
  }
  return { dir: 0, intensity: 0 };
}

export function autoscrollSpeed(intensity) {
  const t = Math.min(1, Math.max(0, intensity));
  return AUTOSCROLL_MIN_SPEED + (AUTOSCROLL_MAX_SPEED - AUTOSCROLL_MIN_SPEED) * t;
}

// Is the pointer inside the rect grown by `grace` px on every side?
export function pointerNearRect(rect, x, y, grace = AUTOSCROLL_GRACE_PX) {
  return (
    x >= rect.left - grace &&
    x <= rect.right + grace &&
    y >= rect.top - grace &&
    y <= rect.bottom + grace
  );
}

// The element's real scroll ceiling. An element may declare a cap via
// data-scroll-max-top (the mobile grid viewport clamps its native scroll to
// the active multicell panel's row range) — respect it so the autoscroll
// doesn't fight the clamp at the panel edge.
export function maxScrollTopFor(el) {
  const cap = el?.dataset?.scrollMaxTop;
  const natural = el.scrollHeight - el.clientHeight;
  if (cap != null && cap !== "" && !Number.isNaN(+cap)) return Math.min(+cap, natural);
  return natural;
}

// Can el actually move further in dir? Used to hand the autoscroll to the
// next scrollable behind an inner list that's already at its end.
export function canScrollFurther(el, dir) {
  if (!el || !dir) return false;
  if (dir < 0) return el.scrollTop > 0;
  return el.scrollTop < maxScrollTopFor(el) - 1;
}
