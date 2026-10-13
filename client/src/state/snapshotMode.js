// While the app is drawing a BOOT SNAPSHOT (helpers/bootSnapshot), the grid on screen is the
// last load's copy, not the server's. It is READ-ONLY: operations / feeds / the scheduler /
// reminder sync stand down, safeEmit drops every write, and presses, keys, drags and pastes are
// held (bindSnapshotInputGuard). Scrolling is left alone. The real full_state switches it off.
let on = false;
const listeners = new Set();

export const isSnapshotMode = () => on;

export function setSnapshotMode(next) {
  next = !!next;
  if (next === on) return;
  on = next;
  for (const fn of listeners) { try { fn(on); } catch { /* a listener must not break the switch */ } }
}

export function subscribeSnapshotMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Held in the CAPTURE phase while the snapshot shows. wheel / touchmove / scroll are not in the
// list, so the copy scrolls (and pointerdown is not prevented, so a touch can still pan).
const HELD = ["mousedown", "mouseup", "click", "dblclick", "contextmenu", "keydown", "keypress",
  "beforeinput", "paste", "drop", "dragstart"];

export function bindSnapshotInputGuard(target = typeof window !== "undefined" ? window : null) {
  if (!target) return () => {};
  const hold = (e) => {
    if (!on) return;
    // Scrolling keys still scroll.
    if (e.type === "keydown" && /^(Arrow(Up|Down)|Page(Up|Down)|Home|End| )$/.test(e.key) && !(e.target?.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  };
  for (const t of HELD) target.addEventListener(t, hold, true);
  return () => { for (const t of HELD) target.removeEventListener(t, hold, true); };
}
