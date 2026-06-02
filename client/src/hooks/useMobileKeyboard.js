// hooks/useMobileKeyboard.js
// Mobile virtual-keyboard awareness via the visualViewport API (#23).
//
// Two concerns this addresses:
//
// 1. `useKeyboardOpen()` — boolean signal for whether the on-screen
//    keyboard is currently consuming a meaningful slice of the
//    viewport. Components can use it to hide fixed-bottom UI that
//    would otherwise overlap the typing area.
//
// 2. `installMobileInputAutoScroll()` — one-time global side effect.
//    Listens for `focusin` on input / textarea / contenteditable
//    elements and, after the keyboard animation settles, calls
//    `scrollIntoView({ block: "nearest" })` so the cursor isn't
//    hidden behind the keyboard. Safe to call on desktop — the
//    keyboard detection short-circuits when visualViewport is
//    absent or doesn't change.
//
// The visualViewport API is supported in iOS Safari 13+, Android
// Chrome, Edge, and modern Firefox. When unavailable, both APIs
// no-op cleanly (returning false / installing nothing).

import { useEffect, useState } from "react";

// Heuristic — when the visualViewport is at least this many pixels
// shorter than the layout viewport, treat the keyboard as "open".
// 150px filters out browser UI chrome changes (toolbars showing/
// hiding) while catching keyboards (typically 250–340px tall).
const KEYBOARD_OPEN_THRESHOLD_PX = 150;

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return; // unsupported — keyboard state stays false

    const recompute = () => {
      const layoutH = window.innerHeight;
      const visualH = vv.height;
      setOpen(layoutH - visualH > KEYBOARD_OPEN_THRESHOLD_PX);
    };
    recompute();
    vv.addEventListener("resize", recompute);
    vv.addEventListener("scroll", recompute);
    return () => {
      vv.removeEventListener("resize", recompute);
      vv.removeEventListener("scroll", recompute);
    };
  }, []);

  return open;
}

let _autoScrollInstalled = false;

export function installMobileInputAutoScroll() {
  if (_autoScrollInstalled) return; // idempotent
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!window.visualViewport) return; // unsupported browser — no-op
  _autoScrollInstalled = true;

  const isEditable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "INPUT") {
      const type = (el.type || "").toLowerCase();
      // Non-text inputs (button / submit / radio / checkbox / file)
      // don't open a keyboard. Skip.
      return !["button", "submit", "reset", "radio", "checkbox", "file", "image", "hidden"].includes(type);
    }
    if (tag === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    return false;
  };

  const onFocusIn = (e) => {
    const target = e.target;
    if (!isEditable(target)) return;
    // Defer until the keyboard animation has had a chance to settle.
    // 300ms covers iOS Safari (~250ms) and Android Chrome (~200ms);
    // scrollIntoView with block:"nearest" is a no-op when the
    // element is already visible.
    setTimeout(() => {
      try { target.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {}
    }, 300);
  };
  document.addEventListener("focusin", onFocusIn, { passive: true });
}
