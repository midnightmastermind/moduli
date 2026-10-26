// helpers/headsetScroll.js — in the headset a thumbstick scroll moved a page far too slowly (user, 2026-10-25:
// "scrolling down a page is way too slow"). It reaches the page as wheel events; each one scrolls the nearest
// scrollable box under it SCROLL_GAIN times as far.

// 3 was still "tremendously slow with the joysticks" (user, 2026-10-25).
export const SCROLL_GAIN = 6;

/** The nearest box at or above `el` that can scroll in the wheel's direction. Pure apart from computed styles. */
export function scrollableFor(el, dy, win = window) {
  for (let cur = el; cur && cur !== win.document.documentElement; cur = cur.parentElement) {
    const oy = win.getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight + 1) {
      const atTop = cur.scrollTop <= 0, atEnd = cur.scrollTop + cur.clientHeight >= cur.scrollHeight - 1;
      if ((dy < 0 && !atTop) || (dy > 0 && !atEnd)) return cur;
    }
  }
  return win.document.scrollingElement || null;
}

/** Install once in a headset window. Returns the cleanup. */
export function installHeadsetScroll(win = window) {
  let logged = false;
  const onWheel = (e) => {
    if (e.ctrlKey || !e.deltaY) return;
    // Lines / pages to pixels, as the browser would.
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * win.innerHeight : e.deltaY;
    const box = scrollableFor(e.target instanceof win.Element ? e.target : null, px, win);
    if (!box) return;
    e.preventDefault();
    box.scrollTop += px * SCROLL_GAIN;
    if (!logged) { logged = true; console.log("[headsetScroll] wheel", { deltaY: e.deltaY, mode: e.deltaMode }); }
  };
  win.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => win.removeEventListener("wheel", onWheel, { capture: true });
}
