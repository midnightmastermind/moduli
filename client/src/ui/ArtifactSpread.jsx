// ui/ArtifactSpread.jsx
// ============================================================
// The overlay an occurrence's artifacts spread out onto — the "opening a
// folder in Iron Man" surface. Click an occurrence's main artifact (its face)
// and everything it has fans out large: images, video, pdf, audio, each still
// the real interactive occurrence rather than a picture of one.
//
// WHAT THIS FILE IS: the SHELL only — the backdrop, the chrome, the open
// animation, Escape, the board⇄canvas switch, and the shift-to-leave ghosting.
//
// WHAT IT DELIBERATELY DOES NOT DO: arrange anything. The tiles are laid out by
// the app's EXISTING board and canvas renderers, mounted as this shell's
// children by `ArtifactSpreadHost` (user, 2026-08-06: "we can just reuse board
// or canvas on an overlaid surface"). There is no second reorder, no second
// drag, no second free-positioning implementation in here — those are three
// things the app already does well, and re-implementing them is exactly the
// mistake this codebase has recorded itself making before.
//
// Those renderers persist to a real page that EXISTS ONLY IN THIS OVERLAY
// (`meta.spreadFor`) — never pinned to a panel, never in a manifest tree. That
// is what lets board and canvas write order and x/y normally while the spread
// still has nothing to clean up when it closes.
//
// SHIFT is the one gesture this shell owns, because it is about the overlay
// rather than the layout: holding it means the next drag is leaving, so the
// surface ghosts itself out of the way and closes once the drop lands.
// ============================================================
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, LayoutGrid, Move } from "lucide-react";
import { isDrawerLayout } from "./MenuSurface";

export default function ArtifactSpread({
  open,
  title = "",
  mode = "board",           // "board" (grid) | "canvas" (free)
  originRect = null,
  count = 0,
  onClose,
  onAdd,
  onModeChange,
  children,                 // the board / canvas renderer, mounted by the host
}) {
  const mobile = isDrawerLayout();
  // Shift ARMS the ordinary app drag: the overlay gets out of the way so the
  // drop lands on the grid behind it.
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (e) => { if (e.key === "Shift") setShiftHeld(false); };
    // A drag can carry focus out of the window entirely; without this the
    // overlay would stay ghosted after Shift was released somewhere else.
    const onBlur = () => setShiftHeld(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, onClose]);

  useEffect(() => { if (!open) setShiftHeld(false); }, [open]);

  // A drag that STARTS while shifted is leaving the overlay. Closing on drop
  // (rather than on drag end) would fight the drag system's own cleanup, so the
  // shell simply stops intercepting and closes when the gesture ends.
  const onDragStartCapture = useCallback((e) => {
    if (!shiftHeld) return;
    // Let the drop land on the grid, then get out of the way entirely.
    const end = () => { document.removeEventListener("dragend", end, true); onClose?.(); };
    document.addEventListener("dragend", end, true);
  }, [shiftHeld, onClose]);

  if (!open) return null;

  // The open animation starts from the thumbnail you clicked. Passed as CSS
  // custom properties so the keyframe itself lives in the stylesheet — the
  // origin is the only part that varies per open.
  const originVars = originRect && !mobile
    ? {
        "--spread-origin-x": `${Math.round(originRect.left + originRect.width / 2)}px`,
        "--spread-origin-y": `${Math.round(originRect.top + originRect.height / 2)}px`,
      }
    : {};

  const nextMode = mode === "canvas" ? "board" : "canvas";

  return createPortal(
    <>
      <div className="artifact-spread-backdrop" onClick={() => onClose?.()} />
      <div
        className={[
          "artifact-spread",
          mobile ? "artifact-spread--mobile" : "",
          `artifact-spread--${mode}`,
          // Ghosted, not unmounted — unmounting mid-drag would destroy the
          // element the drag system is carrying.
          shiftHeld ? "artifact-spread--armed" : "",
        ].filter(Boolean).join(" ")}
        style={originVars}
        role="dialog"
        aria-label={title ? `Files — ${title}` : "Files"}
        onDragStartCapture={onDragStartCapture}
      >
        <div className="artifact-spread-header">
          <span className="artifact-spread-title">{title}</span>
          <span className="artifact-spread-count">{count === 1 ? "1 file" : `${count} files`}</span>
          <span className="artifact-spread-hint">
            {shiftHeld
              ? "Drop onto the grid"
              : (mode === "canvas" ? "Drag to move · Shift-drag out" : "Drag to reorder · Shift-drag out")}
          </span>
          {!mobile && (
            <button
              type="button"
              className="artifact-spread-mode"
              onClick={() => onModeChange?.(nextMode)}
              title={mode === "canvas" ? "Lay out as a board" : "Arrange freely on a canvas"}
              aria-label={mode === "canvas" ? "Board arrangement" : "Canvas arrangement"}
            >
              {mode === "canvas"
                ? <LayoutGrid style={{ width: 13, height: 13 }} />
                : <Move style={{ width: 13, height: 13 }} />}
            </button>
          )}
          <button
            type="button"
            className="artifact-spread-add"
            onClick={() => onAdd?.()}
            title="Add a file"
            aria-label="Add a file"
          >
            <Plus style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className="artifact-spread-close"
            onClick={() => onClose?.()}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* The board or canvas renderer, whole and unmodified. */}
        <div className="artifact-spread-body">{children}</div>
      </div>
    </>,
    document.body
  );
}
