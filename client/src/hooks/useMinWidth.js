import { useState, useEffect } from "react";

// Is the viewport at least `px` wide?
//
// A BOOLEAN, not a width. Returning `window.innerWidth` would re-render every
// consumer on every resize event — and the one consumer here sits inside
// ModulePanel, which is mounted once per panel. This flips only when the
// threshold is actually crossed, so a drag-resize costs at most two renders.
//
// Mirrors `useMobileDetect`'s shape deliberately (matchMedia + a change
// listener, seeded synchronously so the first paint is already correct rather
// than flashing the wrong branch). It does NOT share that hook: the questions
// are different — `isMobileLayout` asks "is this a phone-shaped session", this
// asks "is there room for a fixed-width thing" — and the 2026-08-26 tablet
// sidebar bug came from exactly that conflation.
export function useMinWidth(px) {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
