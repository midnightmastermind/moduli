// ui/RubberBandSelector.jsx
// Document-level shift+drag rubber-band multi-select.
//
// Interaction model:
//   - Shift+pointerdown on grid background (no drag-handle, no input,
//     no interactive control) → start tracking.
//   - Pointermove past a 4-pixel threshold → commit to rectangle mode
//     (suppresses the eventual shift+click toggle on the original
//     target).
//   - Pointermove while dragging → draws the dashed-rectangle overlay
//     and live-highlights candidate targets.
//   - Pointerup → finalizes selection.
//   - Esc → cancels drag (does NOT clear the existing selection).
//
// Selection rules:
//   - Default (Shift only): every CONTAINER whose bounding box is FULLY
//     inside the rectangle is selected, PLUS every INSTANCE inside one
//     of those containers (regardless of whether the instance row sits
//     inside the rect — the user grouped the container, the contents
//     come along).
//   - Shift+Q held at pointerup (instance-only mode): only INSTANCES
//     whose bounding box is at least 1/3 inside the rectangle are
//     selected. Containers excluded. Q is a momentary modifier — its
//     state at pointerup wins. Live highlight tracks the current Q
//     state during the drag so the user gets immediate feedback when
//     they toggle.
//
// Cross-panel: candidates come from every
// `[data-container-id][data-occ-id]` and `[data-instance-id][data-occurrence-id]`
// element under document, so a rectangle that spans multiple panels
// works as expected. Pages and panels themselves are never selected
// (no data-occ-id for panel shells; page elements use data-page-occ-id
// which we ignore here).
//
// Adds to or replaces the existing multi-select set:
//   - No modifier on top of Shift  → adds to current selection
//   - Shift+Alt held at pointerup  → replaces selection (rare power user)
// Default-add matches the way Shift+click already adds; replace is
// opt-in to avoid surprising the user.

import { useContext, useEffect, useRef, useState } from "react";
import { SelectionContext } from "../state/SelectionContext";

const DRAG_THRESHOLD_PX = 4;

function isInteractiveTarget(el) {
  if (!el) return false;
  if (el.closest?.("[data-dnd-handle]")) return true;
  if (el.closest?.("input, textarea, select, button, a")) return true;
  if (el.isContentEditable) return true;
  if (el.closest?.("[contenteditable='true'], .ProseMirror")) return true;
  return false;
}

// Returns true when the candidate rect is fully inside the selection rect.
function fullyInside(candidate, rect) {
  return (
    candidate.left   >= rect.left  &&
    candidate.right  <= rect.right &&
    candidate.top    >= rect.top   &&
    candidate.bottom <= rect.bottom
  );
}

// Returns the fraction (0-1) of the candidate's area that overlaps the rect.
function overlapFraction(candidate, rect) {
  const w = Math.max(0, Math.min(candidate.right, rect.right) - Math.max(candidate.left, rect.left));
  const h = Math.max(0, Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top));
  const interArea = w * h;
  const candArea = Math.max(1, (candidate.right - candidate.left) * (candidate.bottom - candidate.top));
  return interArea / candArea;
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    left:   Math.min(x1, x2),
    right:  Math.max(x1, x2),
    top:    Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

// Walks the DOM and returns the candidate IDs (containerOccIds +
// instanceOccIds) the rectangle currently covers, honoring qMode.
function computeCandidates(rect, qMode) {
  const out = new Set();
  if (typeof document === "undefined") return out;

  // Containers: only counted in default (non-Q) mode. Full-inside test —
  // partial coverage doesn't count.
  if (!qMode) {
    const containers = document.querySelectorAll("[data-container-id][data-occ-id]");
    for (const el of containers) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (fullyInside(r, rect)) {
        const occId = el.getAttribute("data-occ-id");
        if (occId) out.add(occId);
        // All instances inside this container come along automatically.
        const innerInstances = el.querySelectorAll("[data-instance-id][data-occurrence-id]");
        for (const ie of innerInstances) {
          const ioccId = ie.getAttribute("data-occurrence-id");
          if (ioccId) out.add(ioccId);
        }
      }
    }
    return out;
  }

  // Q mode: instances only, ≥ 1/3 overlap. Containers excluded entirely.
  const instances = document.querySelectorAll("[data-instance-id][data-occurrence-id]");
  for (const el of instances) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (overlapFraction(r, rect) >= 1 / 3) {
      const occId = el.getAttribute("data-occurrence-id");
      if (occId) out.add(occId);
    }
  }
  return out;
}

export default function RubberBandSelector() {
  const selection = useContext(SelectionContext);
  const [drag, setDrag] = useState(null); // { startX, startY, x, y, qMode }
  const dragRef = useRef(null);
  const candidatesRef = useRef(new Set());

  // Live-preview class for highlighted candidates during the drag.
  // Stored ref so we can clear it on pointerup / cancel without
  // re-querying every element.
  const highlightedElsRef = useRef(new Set());

  function clearHighlight() {
    for (const el of highlightedElsRef.current) {
      try { el.removeAttribute("data-rubber-band-preview"); } catch {}
    }
    highlightedElsRef.current = new Set();
  }

  function applyHighlight(idSet) {
    clearHighlight();
    if (idSet.size === 0) return;
    // Match both container and instance shells.
    for (const id of idSet) {
      const el = document.querySelector(`[data-occ-id="${CSS.escape(id)}"], [data-occurrence-id="${CSS.escape(id)}"]`);
      if (el) {
        el.setAttribute("data-rubber-band-preview", "true");
        highlightedElsRef.current.add(el);
      }
    }
  }

  useEffect(() => {
    function onPointerDown(e) {
      if (!e.shiftKey) return;
      if (e.button !== 0) return; // primary only
      if (isInteractiveTarget(e.target)) return;
      // Don't start while the clipboard drop overlay is active —
      // those interactions own the document hover/click.
      if (document.body.getAttribute("data-clipboard-active") === "true") return;

      dragRef.current = {
        startX: e.clientX, startY: e.clientY,
        x: e.clientX, y: e.clientY,
        active: false,                    // becomes true past threshold
        qMode: !!(e.code === "KeyQ" || e.getModifierState?.("KeyQ")),
        replaceMode: !!e.altKey,
      };
    }

    function onPointerMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.active && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!d.active) {
        d.active = true;
        // Cancel native text selection while dragging the rectangle.
        try { window.getSelection?.()?.removeAllRanges?.(); } catch {}
      }
      d.x = e.clientX;
      d.y = e.clientY;
      // Q is read live so the user can toggle mid-drag and watch the
      // highlight shift instantly.
      d.qMode = !!e.getModifierState?.("KeyQ");
      d.replaceMode = !!e.altKey;

      const rect = normalizeRect(d.startX, d.startY, d.x, d.y);
      const cands = computeCandidates(rect, d.qMode);
      candidatesRef.current = cands;
      applyHighlight(cands);
      // Force re-render of the overlay rectangle.
      setDrag({ ...d });
    }

    function onPointerUp() {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      clearHighlight();
      setDrag(null);
      if (!d.active) return; // sub-threshold — defer to shift+click handler
      const cands = candidatesRef.current;
      candidatesRef.current = new Set();
      if (cands.size === 0) return;
      if (d.replaceMode) selection.clear();
      for (const id of cands) selection.add(id);
    }

    function onKeyDown(e) {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        candidatesRef.current = new Set();
        clearHighlight();
        setDrag(null);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      clearHighlight();
    };
  }, [selection]);

  if (!drag || !drag.active) return null;
  const rect = normalizeRect(drag.startX, drag.startY, drag.x, drag.y);
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left:   rect.left,
        top:    rect.top,
        width:  rect.right - rect.left,
        height: rect.bottom - rect.top,
        border: drag.qMode
          ? "1.5px dashed rgba(252,211,77,0.95)"   // amber: Q-mode (instance-only)
          : "1.5px dashed rgba(59,130,246,0.95)",  // blue:  default
        background: drag.qMode
          ? "rgba(252,211,77,0.10)"
          : "rgba(59,130,246,0.08)",
        pointerEvents: "none",
        zIndex: 9999,
        borderRadius: 2,
      }}
    />
  );
}
