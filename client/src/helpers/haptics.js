// helpers/haptics.js
//
// EVERY BUTTON AND EVERY PICKER BUZZES (user, 2026-09-02: "make every button or
// input select be a buzz").
//
// ── ONE LISTENER, NOT A PROP ON EVERY CONTROL ──────────────────────────────
// The obvious shape is a `useHaptics()` hook each control calls. This codebase
// has paid for that shape repeatedly — most recently 2026-08-08 (10), where the
// same handler was wired at three call sites, came out byte-identical at all
// three, and the fix was to move the default into the callee so a FOURTH call
// site could not silently forget it. There are hundreds of buttons here and new
// ones arrive every session, so the only version that stays true is one
// document-level listener that asks what was pressed.
//
// ── WHY `pointerdown`, AND WHY CAPTURE, AND WHY PASSIVE ────────────────────
// `click` on touch arrives after pointerup — a buzz there lands after the
// finger has already left, which reads as lag rather than feedback. CAPTURE so
// a control that calls `stopPropagation` (several menus here do) still buzzes.
// PASSIVE so this can never delay the tap it is decorating.
//
// A pointerdown that never becomes a click still buzzes, and that is correct:
// the buzz acknowledges the PRESS, not the outcome.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
// - DRAG HANDLES are excluded. `dragSystem` already buzzes 15ms when a drag
//   LIFTS and [8,30,8] when it drops; without this exclusion a handle press
//   would buzz here and then again ~150ms later at the lift, which reads as a
//   stutter rather than two events.
// - TEXT ENTRY is excluded. A buzz per tap into a doc, a textblock or a table
//   cell turns writing into a rattle, and those surfaces are most of the grid.
// - A DISABLED control is excluded: buzzing on a button that does nothing tells
//   the user it worked.
//
// The duration is shorter than the drag lift's (10ms vs 15ms) so a control tap
// and a drag starting under your finger stay distinguishable by feel.

const TAP_MS = 10;

/** Controls that ACT when tapped. A Radix Switch is a `button[role="switch"]`. */
const CONTROL_SELECTOR = [
  "button",
  '[role="button"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  "select",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
].join(",");

/** Surfaces whose taps are EDITING, not acting. */
const QUIET_SELECTOR = [
  "[data-dnd-handle]",
  ".module-drag-handle",
  ".radial-handle",
  ".ProseMirror",
  '[contenteditable="true"]',
].join(",");

/**
 * Is haptic feedback on? `window.__haptics = false` mutes for the session;
 * `localStorage["moduli-haptics"] = "off"` mutes across reloads.
 *
 * Reads storage in a try/catch because a private-mode or embedded context can
 * THROW on access, and a thrown read here would kill the listener for every
 * control on the page.
 */
export function hapticsEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__haptics === false) return false;
  try {
    if (window.localStorage?.getItem("moduli-haptics") === "off") return false;
  } catch { /* storage unavailable — fall through to enabled */ }
  return true;
}

/**
 * Fire a buzz. Safe to call anywhere: absent on desktop and on iOS Safari
 * (which implements no Vibration API at all), and it can THROW inside some
 * embedded contexts — a haptic must never take a control down with it.
 */
export function buzz(pattern = TAP_MS) {
  if (!hapticsEnabled()) return false;
  try {
    if (typeof navigator === "undefined" || !navigator.vibrate) return false;
    return navigator.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}

/**
 * True when pressing `el` should buzz. Exported because this predicate is the
 * whole feature — mounting App to test it is not an option, and every judgement
 * about what counts as a control lives here.
 */
export function shouldBuzzFor(el) {
  if (!el || typeof el.closest !== "function") return false;
  const control = el.closest(CONTROL_SELECTOR);
  if (!control) return false;
  // A quiet surface INSIDE a control still wins — a doc body rendered inside a
  // card that happens to be a button is being written in, not pressed.
  if (el.closest(QUIET_SELECTOR)) return false;
  if (control.disabled) return false;
  if (control.getAttribute?.("aria-disabled") === "true") return false;
  return true;
}

let armed = false;

/** Install the single document listener. Idempotent; safe on every mount. */
export function armHaptics() {
  if (armed || typeof document === "undefined") return () => {};
  armed = true;
  const onDown = (e) => {
    // Primary button / finger only: a right-click opens a menu, and the menu's
    // own rows buzz when they are pressed.
    if (e.button != null && e.button !== 0) return;
    if (shouldBuzzFor(e.target)) buzz();
  };
  document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
  return () => {
    document.removeEventListener("pointerdown", onDown, { capture: true });
    armed = false;
  };
}
