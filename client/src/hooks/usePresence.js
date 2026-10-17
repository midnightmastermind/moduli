// hooks/usePresence.js
//
// Keeps something MOUNTED for `ms` after it is closed, so it can play a closing
// animation instead of vanishing (user 2026-10-17: "all the drawers and the
// manifest tree and the control center … should slide out, not just appear").
//
// Entry needs nothing from here: the element animates in with a CSS keyframe the
// moment it mounts. This only covers the other half — the frames between "closed"
// and "gone". With reduced motion asked for, it unmounts at once.
import { useEffect, useState } from "react";

export function prefersReducedMotion() {
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; }
}

export function usePresence(open, ms = 200) {
  const [prevOpen, setPrevOpen] = useState(!!open);
  const [lingering, setLingering] = useState(false);
  // Decided DURING render, not in an effect: an effect would let one frame
  // render with the thing unmounted between "closed" and "lingering", which
  // remounts its contents and flashes.
  if (prevOpen !== !!open) {
    setPrevOpen(!!open);
    setLingering(!open && ms > 0 && !prefersReducedMotion());
  }
  useEffect(() => {
    if (!lingering) return undefined;
    const t = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(t);
  }, [lingering, ms]);
  // A thing that was never open is never mounted — it does not linger on first render.
  return { mounted: !!open || lingering, closing: !open && lingering };
}
