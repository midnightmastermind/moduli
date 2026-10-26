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

// Each thumbstick tick used to jump the whole distance at once, so a held stick read as jagged steps (user,
// 2026-10-26: "scroll seems glitchy and jagged with the joysticks"). A tick now adds to where the box is headed and the
// box eases there over the next frames; ticks arriving meanwhile extend the same glide.
export const GLIDE = 0.25;   // share of the remaining distance covered each frame
const glides = new WeakMap();

/** The next scrollTop on the way from `at` to `target` (pure). */
export function glideStep(at, target, share = GLIDE) {
  const left = target - at;
  if (Math.abs(left) < 1) return target;
  const step = left * share;
  return at + (Math.abs(step) < 1 ? Math.sign(left) : step);
}

function glide(box, dy, win = window) {
  let g = glides.get(box);
  const max = box.scrollHeight - box.clientHeight;
  if (!g) { g = { target: box.scrollTop, raf: 0 }; glides.set(box, g); }
  // A reversed stick starts from where the box is now, not from the end of the old glide.
  if (Math.sign(dy) !== Math.sign(g.target - box.scrollTop) && g.raf) g.target = box.scrollTop;
  g.target = Math.max(0, Math.min(max, g.target + dy));
  if (g.raf) return;
  const frame = () => {
    const next = glideStep(box.scrollTop, g.target);
    const before = box.scrollTop;
    box.scrollTop = next;
    // Done, or the box stopped moving (its end, or something else took the scroll): let go.
    if (next === g.target || box.scrollTop === before) { g.raf = 0; g.target = box.scrollTop; return; }
    g.raf = win.requestAnimationFrame(frame);
  };
  g.raf = win.requestAnimationFrame(frame);
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
    glide(box, px * SCROLL_GAIN);
    if (!logged) { logged = true; console.log("[headsetScroll] wheel", { deltaY: e.deltaY, mode: e.deltaMode }); }
  };
  win.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => win.removeEventListener("wheel", onWheel, { capture: true });
}
