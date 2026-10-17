// ui/SlideDrawer.jsx
//
// A box that SLIDES open and shut instead of appearing (user 2026-10-17). It is
// the box itself — pass the className/style the element already had — so the DOM
// keeps its shape and every selector that addresses it still matches.
//
//   axis "y"        grows downward from 0 to its own height (a drawer under a row)
//   axis "x"        grows from 0 to its own width (a sidebar that pushes content)
//
// The size is MEASURED on open and on close, so the animation runs to the real
// height rather than to a guessed cap. The opening class comes off when its
// animation ends: it carries `overflow: hidden`, which must not stay on an open
// drawer (it would clip the handles and menus that sit at its edges).
import React, { useLayoutEffect, useRef, useState } from "react";
import { usePresence } from "../hooks/usePresence";

export const SLIDE_MS = 200;

export default function SlideDrawer({ open, axis = "y", ms = SLIDE_MS, className = "", style, children, ...rest }) {
  const { mounted, closing } = usePresence(open, ms);
  const ref = useRef(null);
  const [entering, setEntering] = useState(true);

  useLayoutEffect(() => { if (open) setEntering(true); }, [open]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Width needs no measuring: a width keyframe with no `to` runs to the box's own width.
    if (axis === "y") el.style.setProperty("--slide-h", `${closing ? el.offsetHeight : el.scrollHeight}px`);
  }, [mounted, closing, axis]);

  if (!mounted) return null;
  const phase = closing ? "out" : entering ? "in" : null;
  const cls = [className, phase ? `slide-${axis}-${phase}` : ""].filter(Boolean).join(" ");
  return (
    <div
      ref={ref}
      className={cls}
      style={{ ...style, "--slide-ms": `${ms}ms` }}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && !closing) setEntering(false); }}
      {...rest}
    >
      {children}
    </div>
  );
}
