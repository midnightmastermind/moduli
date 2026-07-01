import { useState, useEffect } from "react";

export const MOBILE_BREAKPOINT = 600;

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
    const recompute = () => setFlags(compute());
    const mqls = [COARSE, PORTRAIT, NARROW].map((q) => window.matchMedia(q));
    mqls.forEach((mql) => mql.addEventListener("change", recompute));
    window.addEventListener("resize", recompute);
    // Reconcile once after mount in case a query flipped during the first paint.
    recompute();
    return () => {
      mqls.forEach((mql) => mql.removeEventListener("change", recompute));
      window.removeEventListener("resize", recompute);
    };
  }, []);

  return flags;
}
