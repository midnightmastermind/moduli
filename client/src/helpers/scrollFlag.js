// Marks an element `data-scrolling` while it scrolls, cleared SETTLE_MS after its last scroll event.
//
// Used by index.css to stop the scrolling-label animations (AutoMarquee) inside an area while it
// scrolls. Measured 2026-10-19, desktop, poms grid, Routines: a wheel scroll ran at a 33ms median frame
// with ~190 frames over 33ms; with those animations off, 17ms and ~75. Each running label is its own
// animated layer, and the layer tree is rebuilt every frame while the page moves under it (Layerize
// 2.0s -> 0.75s). A PAUSED animation keeps its layer and saved half as much, so the labels stop and
// restart from their beginning when the scroll settles.
//
// The flag is set on the scrolling element only, and the CSS that reads it names one class, so setting
// it restyles just those labels (an earlier version made every descendant pointer-events:none and the
// restyle cost more than it saved).

export const SETTLE_MS = 300;

export function installScrollFlag(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return () => {};
  const timers = new Map();
  const root = doc.documentElement;
  const onScroll = (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    // The PAGE is flagged too: a label animating in ANOTHER panel costs the same (the whole page's
    // layer tree is rebuilt each frame), and measured, the labels running during a Routines scroll
    // were all in the Books panel beside it.
    if (el !== root) flag(root);
    flag(el);
  };
  function flag(el) {
    if (!timers.has(el)) el.setAttribute("data-scrolling", "");
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => { timers.delete(el); el.removeAttribute("data-scrolling"); }, SETTLE_MS));
  }
  // Scroll events do not bubble; the capture phase sees every scroller's.
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    for (const [el, t] of timers) { clearTimeout(t); el.removeAttribute("data-scrolling"); }
    timers.clear();
  };
}
