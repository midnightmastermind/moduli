// ui/ClipboardDropOverlay.jsx
// Document-level hover-anywhere drop mode for the multi-select clipboard.
//
// When the clipboard is non-empty (post Copy / Move / Copy-link from the
// selection right-click menu), the user's regular mouse movement
// activates a drop-target preview anywhere on the grid — hovered
// container/page lights up with a blue outline (mirrors the drag-drop
// affordance). Clicking on a hovered container/page pastes the
// clipboard there via the same `runPasteClipboard` helper the
// right-click "Paste N here" menu uses. Escape OR right-click anywhere
// clears the clipboard and exits the mode.
//
// Skip targets:
//   - Anything inside the active clipboard set (no self-paste)
//   - Input / textarea / contentEditable (so typing isn't hijacked)
//
// State lives in SelectionContext (`clipboard`) — this component just
// observes it and orchestrates the document-level listeners.

import { useContext, useEffect, useRef } from "react";
import { SelectionContext } from "../state/SelectionContext";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import { runPasteClipboard } from "../helpers/pasteClipboard";

// Look at the topmost element under the cursor and walk up to find the
// nearest container/page drop target. Returns the matching DOM element
// or null. data-container-id (ModuleContainer) wins; data-page-occ-id
// (ModulePage) is the fallback for page-level drops.
function findDropTarget(x, y) {
  if (typeof document === "undefined" || !document.elementsFromPoint) return null;
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!el || el.nodeType !== 1) continue;
    const containerEl = el.closest("[data-occ-id][data-container-id]");
    if (containerEl) return containerEl;
    const pageEl = el.closest("[data-page-occ-id]");
    if (pageEl) return pageEl;
  }
  return null;
}

function isEditableTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export default function ClipboardDropOverlay() {
  const selection = useContext(SelectionContext);
  const ctx = useGridActions();
  const lastHoverRef = useRef(null);

  const clip = selection?.clipboard;
  const active = !!(clip && clip.mode && Array.isArray(clip.ids) && clip.ids.length > 0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (active) {
      document.body.setAttribute("data-clipboard-active", "true");
    } else {
      document.body.removeAttribute("data-clipboard-active");
    }
    return () => {
      document.body.removeAttribute("data-clipboard-active");
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const stagedIds = new Set(clip.ids);

    function clearLastHover() {
      if (lastHoverRef.current) {
        lastHoverRef.current.removeAttribute("data-clipboard-hover");
        lastHoverRef.current = null;
      }
    }

    function onMouseMove(e) {
      const el = findDropTarget(e.clientX, e.clientY);
      if (el !== lastHoverRef.current) {
        clearLastHover();
        // Don't highlight a target that's IN the clipboard (would be a
        // self-paste). The dropTarget element carries data-occ-id (container)
        // or data-page-occ-id (page); both are matched against the staged
        // set so self-targets don't light up.
        const occId = el?.getAttribute?.("data-occ-id") || el?.getAttribute?.("data-page-occ-id");
        if (el && occId && !stagedIds.has(occId)) {
          el.setAttribute("data-clipboard-hover", "true");
          lastHoverRef.current = el;
        }
      }
    }

    function onClick(e) {
      // Ignore clicks on input-like elements so the user can still type
      // while the clipboard is set.
      if (isEditableTarget(e.target)) return;

      const el = findDropTarget(e.clientX, e.clientY);
      if (!el) return;
      const occId = el.getAttribute("data-occ-id") || el.getAttribute("data-page-occ-id");
      if (!occId || stagedIds.has(occId)) return;

      const occ = ctx?.occurrencesById?.[occId];
      const mod = occ?.moduleId ? ctx?.modulesById?.[occ.moduleId] : null;
      if (!occ || !mod) return;

      e.preventDefault();
      e.stopPropagation();
      clearLastHover();

      runPasteClipboard({
        mode: clip.mode,
        ids: clip.ids,
        destinationOccurrence: occ,
        destinationModule: mod,
        occurrencesById: ctx?.occurrencesById,
        dispatch: ctx?.dispatch,
        socket: ctx?.socket,
        gridId: ctx?.state?.gridId || ctx?.state?.grid?._id,
        userId: ctx?.state?.userId,
        panelId: null,
      });

      // Clipboard + selection both clear so the visual state matches what
      // the user sees: paste landed, nothing in flight anymore.
      selection.clearClipboard();
      selection.clear();
    }

    function onContextMenu(e) {
      // Right-click anywhere while clipboard is active → clear.
      // Suppresses the native context menu so the action feels decisive.
      // Doesn't interfere with normal right-click usage outside this mode
      // (the listener is only mounted when active=true).
      e.preventDefault();
      e.stopPropagation();
      clearLastHover();
      selection.clearClipboard();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        clearLastHover();
        selection.clearClipboard();
      }
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("keydown", onKeyDown);
      clearLastHover();
    };
  }, [active, clip?.mode, clip?.ids, ctx, selection]);

  return null;
}
