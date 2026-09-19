import { useState, useEffect } from "react";

// Raised from 600 (user, 2026-09-19: "the threshold to switch to mobile view needs
// to be higher"). The toolbar measurably crowds below ~700px. index.css carries the
// SAME number in its RESPONSIVE block; __tests__/mobileBreakpointSync pins the two.
export const MOBILE_BREAKPOINT = 768;

const COARSE = "(pointer: coarse)";
const PORTRAIT = "(orientation: portrait)";
const NARROW = `(max-width: ${MOBILE_BREAKPOINT}px)`;

function compute() {
  if (typeof window === "undefined") return { isTouch: false, isMobileLayout: false };
  const isTouch = window.matchMedia(COARSE).matches;
  const isPortrait = window.matchMedia(PORTRAIT).matches;
  const width = window.innerWidth;
  const isMobileLayout = (isTouch && (isPortrait || width < 980)) || width <= MOBILE_BREAKPOINT;
  return { isTouch, isMobileLayout };
}

export function useMobileDetect() {
  const [flags, setFlags] = useState(compute);

  useEffect(() => {
    // DEBOUNCED (trailing 200ms): a tablet rotation fires a burst of resize /
    // media-query events while the viewport animates, and every isMobileLayout
    // flip swaps the whole layout tree (GridMosaic ↔ mobile stack = a full
    // remount of every panel/editor). Recomputing per event could thrash that
    // remount several times per rotation — the "huge lag" switching landscape
    // ↔ portrait. One recompute after the burst settles does it once.
    let timer = null;
    const recompute = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setFlags((prev) => {
          const next = compute();
          return prev.isTouch === next.isTouch && prev.isMobileLayout === next.isMobileLayout
            ? prev
            : next;
        });
      }, 200);
    };
    const mqls = [COARSE, PORTRAIT, NARROW].map((q) => window.matchMedia(q));
    mqls.forEach((mql) => mql.addEventListener("change", recompute));
    window.addEventListener("resize", recompute);
    // Reconcile once after mount in case a query flipped during the first paint.
    recompute();
    return () => {
      if (timer) clearTimeout(timer);
      mqls.forEach((mql) => mql.removeEventListener("change", recompute));
      window.removeEventListener("resize", recompute);
    };
  }, []);

  return flags;
}
