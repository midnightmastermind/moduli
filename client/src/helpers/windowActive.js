// Is anyone looking at this window? True while the document is visible AND focused. A looping animation (the
// toolbar notification pill's scrolling text) only needs to move then: measured idle on poms grid, that one
// infinite marquee was ~60 style recalcs a second and ~9% of a core in a browser without GPU compositing, and
// a tab nobody is looking at gains nothing from it. Paused, not removed: the layout is identical either way.
import { useSyncExternalStore } from "react";

function snapshot() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && (typeof document.hasFocus !== "function" || document.hasFocus());
}

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", cb);
  window.addEventListener("blur", cb);
  document.addEventListener("visibilitychange", cb);
  return () => {
    window.removeEventListener("focus", cb);
    window.removeEventListener("blur", cb);
    document.removeEventListener("visibilitychange", cb);
  };
}

export function isWindowActive() { return snapshot(); }
export function useWindowActive() { return useSyncExternalStore(subscribe, snapshot, () => true); }
