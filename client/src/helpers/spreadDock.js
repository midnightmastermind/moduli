// helpers/spreadDock.js
// ============================================================
// DOCKING THE ARTIFACT VIEWER INTO THE PANEL IT WAS OPENED FROM.
//
// The viewer (`ArtifactSpread`) and the single-file fullscreen
// (`ArtifactCard`'s expanded portal) are both `position: fixed` boxes
// portalled to `document.body`. Docking therefore means OVERRIDING THEIR RECT,
// not re-parenting them into the panel's DOM.
//
// That choice is deliberate. Rendering inside the panel would put the surface
// underneath three things that already exist there: the panel's own
// `overflow` (it would be clipped), its stacking context (it would sit under
// siblings it must cover), and its scroller (it would scroll away from the
// file you are watching). A fixed box positioned AT the panel's rect has none
// of those problems and reuses the overlay machinery unchanged.
//
// WHICH PANEL — derived, never passed.
// `openArtifactSpread` is called from four places today (a field's media pill,
// a field's file row, an artifact card, an instance row). Asking each to say
// which panel it is in is the "the fifth caller forgets" trap this codebase
// has paid for repeatedly. Instead the opener hands over the ELEMENT that was
// clicked and the panel is walked up from it in ONE place — so a fifth call
// site gets docking for free and cannot get it wrong.
//
// THE RECT IS LIVE, not a snapshot. A panel can be resized by its handle, moved
// by a mosaic re-layout, or swapped under a mobile cell change while the viewer
// is open. A rect captured at open time would leave the viewer floating over
// nothing. `observePanelRect` reports every change.
//
// THE PREFERENCE IS PER-DEVICE (localStorage), not grid data. Which way you
// like to watch is a fact about the screen you are sitting at — a laptop and a
// tablet want different answers — and persisting it on the grid would cost a
// write and a sync per toggle.
// ============================================================

const PREF_KEY = "moduli-spread-dock";

/** The panel MODULE id containing `el`, or null if it is not inside one. */
export function panelIdForElement(el) {
  if (!el || typeof el.closest !== "function") return null;
  const panel = el.closest("[data-panel-id]");
  return panel ? panel.getAttribute("data-panel-id") : null;
}

/** The panel's live element, looked up fresh — a panel may remount. */
export function panelElement(panelId) {
  if (!panelId || typeof document === "undefined") return null;
  const safe = (typeof CSS !== "undefined" && CSS.escape)
    ? CSS.escape(String(panelId)) : String(panelId);
  return document.querySelector(`[data-panel-id="${safe}"]`);
}

/**
 * `{ top, left, width, height }` for a panel, or null when it is gone.
 *
 * A ZERO-AREA rect reads as null on purpose: a panel translated off screen by
 * the mobile cell slider still has a box, and docking a video into a 0×0 hole
 * is indistinguishable from the viewer having vanished. Null makes the caller
 * fall back to fullscreen, which is at least usable.
 */
export function panelRect(panelId) {
  const el = panelElement(panelId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 1 && r.height > 1)) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * Watch a panel's rect and call `onRect(rect|null)` whenever it changes.
 * Returns an unsubscribe.
 *
 * THREE SOURCES, because they catch different movements and no one of them
 * catches all three:
 *   - ResizeObserver  — the panel resized (drag handle, mosaic split).
 *   - window resize   — the viewport changed, moving every panel.
 *   - scroll (capture) — an ancestor scrolled, so the panel MOVED without
 *     resizing. A ResizeObserver is silent for that, and it is the ordinary
 *     case on a page that scrolls behind a docked viewer.
 * Emissions are deduped on the rect itself, so a scroll that does not move the
 * panel costs one comparison and no render.
 */
export function observePanelRect(panelId, onRect) {
  if (!panelId || typeof window === "undefined") { onRect?.(null); return () => {}; }
  let last;
  let raf = 0;
  const emit = () => {
    raf = 0;
    const next = panelRect(panelId);
    if (sameRect(next, last)) return;
    last = next;
    onRect?.(next);
  };
  // Coalesced to a frame: a resize drag fires all three sources at once, and
  // the viewer only needs the settled answer.
  const schedule = () => { if (!raf) raf = requestAnimationFrame(emit); };

  emit();
  const el = panelElement(panelId);
  const ro = (typeof ResizeObserver !== "undefined" && el) ? new ResizeObserver(schedule) : null;
  if (ro && el) ro.observe(el);
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", schedule, true);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    window.removeEventListener("resize", schedule);
    document.removeEventListener("scroll", schedule, true);
  };
}

/** Remembered across sessions and across every viewer — see the header. */
export function readDockPreference() {
  try { return window.localStorage.getItem(PREF_KEY) === "1"; }
  catch { return false; }
}

export function writeDockPreference(docked) {
  try { window.localStorage.setItem(PREF_KEY, docked ? "1" : "0"); }
  catch { /* private mode / storage disabled — the session still works */ }
}

/**
 * The inline custom properties a docked surface positions itself with, or
 * `null` when it should stay full screen.
 *
 * Exported and pure because this is the whole decision: docking is ON, a panel
 * was resolved, and that panel currently has a usable box. Any one missing and
 * the surface is full screen — which is exactly today's behaviour, so the
 * failure mode of every unknown is the behaviour that already worked.
 */
export function dockVars({ docked, rect }) {
  if (!docked || !rect) return null;
  return {
    "--dock-top": `${Math.round(rect.top)}px`,
    "--dock-left": `${Math.round(rect.left)}px`,
    "--dock-width": `${Math.round(rect.width)}px`,
    "--dock-height": `${Math.round(rect.height)}px`,
  };
}

// ── THE DOCK RECT, SHARED WITH WHATEVER THE VIEWER OPENS ────────────────────
//
// Clicking a file inside a docked viewer expands it, and that expansion must
// stay inside the same panel (user, 2026-09-04: *"when i click on an individual
// file on there, it opens it up full screen inside the panel"*). The expanded
// file is `ArtifactCard`'s own portal — a SIBLING of the viewer in the DOM,
// portalled to `document.body` exactly as the viewer is.
//
// A DOM marker cannot join them: both are body children, so neither is inside
// the other. A module singleton would be a second source of truth for
// something React already tracks. But a portal PRESERVES the React tree — the
// card is rendered from inside the viewer's subtree even though its DOM lands
// elsewhere — so ordinary context reaches it, and it unmounts with the viewer
// by construction.
//
// `null` means "not docked", which is every caller outside a docked viewer.
import { createContext, useContext } from "react";

export const DockRectContext = createContext(null);
export const useDockRect = () => useContext(DockRectContext);
