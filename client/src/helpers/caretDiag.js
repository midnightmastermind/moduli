// [caret] diagnostics — user repro 2026-07-12: "clicking the middle of a mini
// textblock puts the writing cursor at the START". Round 2 of this bug (round 1
// was the inline chips' user-drag:element suppression, f2e89136), so instead of
// guessing the layer we log every stage of the click→caret pipeline:
//   pointerdown  — where the click landed (element, coords), what the browser
//                  WOULD place there (caretFromPoint), and whether any ancestor
//                  is a drag source (draggable=true / computed user-drag:element
//                  — Chromium suppresses caret placement inside those).
//   settled      — where the selection ACTUALLY ended up (~100ms later).
//   interference — setContent / focus('end') / setTextSelection firing inside
//                  the click window.
// OPT-IN since 2026-07-13 (the Firefox draggable-ancestor fix shipped and was
// verified headless in both engines): run `window.__caretDiag = true` in the
// console to re-enable if a caret ever lands at the start again.
const on = () => typeof window !== "undefined" && window.__caretDiag === true;

// Stamped by logCaretPointerDown; interference sites log only inside this window.
let _lastClickAt = 0;
export const msSinceCaretClick = () => Date.now() - _lastClickAt;
export const inCaretClickWindow = (ms = 2000) => msSinceCaretClick() < ms;

const short = (s, n = 26) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "…" : t;
};

const elDesc = (el) =>
  el instanceof Element
    ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 3).join(".") : ""}`
    : String(el);

// What the browser itself resolves at the point — the "native" caret target.
export function caretFromPoint(x, y) {
  try {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { offset: p.offset, text: short(p.offsetNode?.textContent) } : null;
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { offset: r.startOffset, text: short(r.startContainer?.textContent) } : null;
    }
  } catch (_) {}
  return null;
}

// Ancestors that make this subtree a native DRAG SOURCE (the round-1 root
// cause): draggable=true or computed -webkit-user-drag: element.
export function dragSourceChain(el) {
  const out = [];
  let cur = el instanceof Element ? el : null;
  while (cur && cur !== document.body) {
    const dragAttr = cur.getAttribute?.("draggable");
    let ud = "";
    try { ud = getComputedStyle(cur).webkitUserDrag || ""; } catch (_) {}
    if (dragAttr === "true" || ud === "element") {
      out.push(`${elDesc(cur)}[draggable=${dragAttr ?? "-"},user-drag=${ud || "-"}]`);
    }
    cur = cur.parentElement;
  }
  return out;
}

function selectionDesc() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return { none: true };
  return {
    offset: sel.anchorOffset,
    collapsed: sel.isCollapsed,
    text: short(sel.anchorNode?.textContent),
    node: elDesc(sel.anchorNode?.parentElement || sel.anchorNode),
    active: elDesc(document.activeElement),
  };
}

// One line at pointer/mouse-down + one "settled" line ~100ms later.
export function logCaretPointerDown(tag, e, extra = {}) {
  if (!on()) return;
  _lastClickAt = Date.now();
  const x = e.clientX, y = e.clientY;
  console.log("[caret] DOWN", tag, {
    target: elDesc(e.target),
    x: Math.round(x), y: Math.round(y),
    pointerType: e.pointerType || (e.touches ? "touch" : "mouse"),
    button: e.button,
    caretAtPoint: caretFromPoint(x, y),
    dragSources: dragSourceChain(e.target),
    ...extra,
  });
  setTimeout(() => {
    if (!on()) return;
    console.log("[caret] SETTLED(100ms)", tag, selectionDesc());
  }, 100);
  setTimeout(() => {
    if (!on()) return;
    console.log("[caret] SETTLED(400ms)", tag, selectionDesc());
  }, 400);
}

// Interference sites (setContent / focus('end') / rAF setTextSelection) call
// this — logged only inside the click window so server echoes at rest stay quiet.
export function logCaretInterference(tag, info = {}) {
  if (!on() || !inCaretClickWindow()) return;
  console.log("[caret] INTERFERE", tag, { msAfterClick: msSinceCaretClick(), ...info });
}
