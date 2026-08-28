// modules/PreviewNode.jsx
// Preview card component for folder page views.
// Shows a module occurrence as a card with INLINE content preview.
// Click triggers drilldown animation.
//
// 2026-05-25 — Replaced the iframe (`<iframe src="/?previewOcc=X">`) with
// an inline mount of <PagePreviewBody>. Old design: each card spawned a
// separate browser context loading the full React bundle (every chunk:
// react / tiptap / pdf / highlight / lucide / dnd / …). 11 visible
// folder-page cards × full-bundle parse + full-app-context = the page
// load froze, the AbortSignal MaxListeners warning fired (one signal per
// iframe), and any state change after that pegged the browser. Now the
// same subtree-filtering optimization happens inside the parent's React
// tree — zero bundle reload, zero iframe, zero extra socket. PagePreviewBody
// reads parent state through a prop and replaces all the byId lookup
// contexts with subtree-only versions, so Page renders cheaply even with
// 11 cards on screen. The legacy `/?previewOcc=X` iframe entry point in
// main.jsx still works for any outstanding iframe consumers.

import React, { useRef, useEffect, useState, useCallback } from "react";
import { File, Image as ImageIcon, X, Trash2 } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useGridActions } from "../GridActionsContext.js";
import { getModuleTypeIcon, getModuleTypeColor } from "../helpers/moduleIcons";
import { getEffectiveViewMode } from "../helpers/viewMode";
import { resolveFileRef } from "../helpers/fileRef";
import ViewModeSwitcher from "../ui/ViewModeSwitcher";
import AutoMarquee from "../ui/AutoMarquee.jsx";
import RepresentationView from "../ui/RepresentationView";
import ContextMenu from "../ui/ContextMenu";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { PagePreviewBody } from "../PagePreviewApp.jsx";
import { requestPreviewSlot } from "../helpers/previewAdmission.js";

// Inline preview — mounts PagePreviewBody directly in the parent React tree.
// Scaled to fit the card via CSS transform; pointer-events:none keeps it
// non-interactive so the parent card's click/drag/right-click stay live.
function InlinePreview({ occurrenceId, landscape = false }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0.15);
  const iframeW = landscape ? 560 : 600;
  const iframeH = landscape ? 380 : 800;

  // Re-measure the card to compute scale (same width-driven scaling the
  // iframe path used).
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) setScale(width / iframeW);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [iframeW]);

  // PagePreviewBody expects a parentState prop. App.jsx writes the live
  // store snapshot to `window.__moduli_state__` on every parent render.
  // DON'T read it synchronously per render: a fresh ref every render meant
  // every occurrence write anywhere rebuilt PagePreviewBody's entire lookup
  // map set → every component inside every preview card re-rendered INSIDE
  // the write's own commit (measured: 401 of 535 frame-1 field renders on a
  // drop were preview-card fields). Instead hold the snapshot in state and
  // refresh on a 500ms poll — same coalescing the old iframe path had, and
  // the setState no-ops (same ref → React bails) when nothing changed.
  // Previews are non-interactive thumbnails; sub-second staleness is
  // invisible. Falling back to null lets the body render an empty
  // placeholder before the parent has hydrated state.
  const [parentState, setParentState] = useState(() =>
    typeof window !== "undefined" ? window.__moduli_state__ : null
  );
  useEffect(() => {
    const id = setInterval(() => {
      const next = (typeof window !== "undefined" && window.__moduli_state__) || null;
      setParentState(prev => (prev === next ? prev : next));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // DIAG (window.__NO_PREVIEWS): render nothing — lets the drop probe split
  // "preview subtree renders" from "main tree renders".
  if (typeof window !== "undefined" && window.__NO_PREVIEWS === true) {
    return <div style={{ width: "100%", height: "100%" }} />;
  }
  if (!occurrenceId) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: iframeW,
          height: iframeH,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          pointerEvents: "none",
          // Block any internal scroll inside the preview from bubbling out
          // and stealing the parent's scroll. The preview is non-interactive.
          overflow: "hidden",
        }}
      >
        <PagePreviewBody parentState={parentState} occurrenceId={occurrenceId} />
      </div>
    </div>
  );
}

export default function PreviewNode({
  occurrence,
  module,
  onDrillDown,
  isAnimating = false,
  loadPreview = true,
  loadIndex = 0,
  style: extraStyle,
  className = "",
}) {
  const ref = useRef(null);
  const Icon = getModuleTypeIcon(module);
  const color = getModuleTypeColor(module);
  const label = module?.label || "Untitled";
  const kind = module?.kind;
  const role = module?.role;

  // Folder-page card context — Actual mode is intentionally NOT offered
  // here per the user spec (Folder pages exist to give a grid-of-cards
  // drilldown; rendering full Actual would defeat the purpose). The
  // ViewModeSwitcher's folderPage contextTag filters Actual out.
  const ctxActions = useGridActions() || {};
  const dispatch = ctxActions.dispatch;
  const socket = ctxActions.socket;
  const viewMode = getEffectiveViewMode(occurrence, "folderPage");
  const handleViewModeChange = useCallback((nextMode) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: occurrence.id,
        meta: { ...(occurrence.meta || {}), viewMode: nextMode },
      },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, dispatch, socket]);

  // Lazy-load the iframe only when the card is in (or near) the viewport.
  // Without this, every PreviewNode on a folder page (potentially 20+ cards)
  // mounts an iframe immediately and the parent app freezes for several
  // seconds while all of them poll the parent state + render full Page
  // components in parallel. IntersectionObserver with a 200px rootMargin
  // primes cards just before they scroll into view; cards above the fold
  // load on first paint thanks to the initial observation tick. Once a
  // card has been seen, `hasBeenVisible` stays true so unmount-on-scroll
  // doesn't tear down the iframe.
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || hasBeenVisible) return;
    if (typeof IntersectionObserver === "undefined") { setHasBeenVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { setHasBeenVisible(true); io.disconnect(); break; }
      }
    }, { rootMargin: "200px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [hasBeenVisible]);

  // ── AND THEN WAIT FOR A TURN ───────────────────────────────────────────────
  // Visibility alone is not enough, and that is the whole reason this second
  // gate exists. The observer above fires for EVERY card above the fold in the
  // same tick, so without a queue they all flip `hasBeenVisible` in one React
  // commit and all mount a full `PagePreviewBody` inside one synchronous task —
  // the browser cannot paint or dispatch a click until it ends, which is the
  // freeze the user reported ("i should be able to click on any of them before
  // waiting"). The card's own chrome and click target are already on screen by
  // this point; only the preview BODY waits.
  const [hasSlot, setHasSlot] = useState(false);
  useEffect(() => {
    if (!hasBeenVisible || hasSlot) return;
    // `loadIndex` orders the queue (reading order), it does not time it —
    // see helpers/previewAdmission.js. Cancelling on unmount matters: a card
    // scrolled away must give up its turn or it delays one that is visible.
    return requestPreviewSlot(loadIndex, () => setHasSlot(true));
  }, [hasBeenVisible, hasSlot, loadIndex]);

  // Drag setup
  useEffect(() => {
    if (!ref.current || !module) return;
    return draggable({
      element: ref.current,
      getInitialData: () => ({
        type: "module",
        sourceType: "folder-node",
        role: role || "container",
        id: module.id,
        data: module,
        occurrenceId: occurrence?.id,
      }),
    });
  }, [module, occurrence?.id, role]);

  const canDrillDown = role === "page" || kind === "folder";
  const isLandscape = kind === "folder";
  const shouldLoadIframe = loadPreview && hasBeenVisible && hasSlot;

  // F2 — per-card cover override. When `occurrence.meta.cover` is set
  // (URL or fileRef string), render it INSTEAD of the iframe preview.
  // The image still drills in on click. Right-click menu sets / clears.
  const coverRaw = occurrence?.meta?.cover;
  const coverSrc = typeof coverRaw === "string" && coverRaw.trim()
    ? resolveFileRef(coverRaw.trim())
    : null;

  const [ctxMenu, setCtxMenu] = useState(null);
  const handleSetCover = useCallback(() => {
    if (!occurrence?.id) return;
    const next = window.prompt(
      "Cover image URL (or relative upload path; leave empty to clear):",
      coverRaw || ""
    );
    if (next == null) return; // user cancelled
    const trimmed = next.trim();
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: occurrence.id,
        meta: { ...(occurrence.meta || {}), cover: trimmed || null },
      },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, coverRaw, dispatch, socket]);

  const handleClearCover = useCallback(() => {
    if (!occurrence?.id) return;
    const nextMeta = { ...(occurrence.meta || {}) };
    delete nextMeta.cover;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, meta: nextMeta },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, dispatch, socket]);

  // DELETE FROM THE CARD ITSELF.
  //
  // A folder page is a grid of cards and had no way to remove one — a row that
  // could not be opened could not be deleted either, so a bad mint (see
  // ManifestTree's "+", which used to produce an unopenable
  // `role:"container" kind:"artifact"`) was stuck there for good. User
  // 2026-08-28: *"we should have a right click on the folder page preview tiles
  // to delete."*
  //
  // Routed through `CommitHelpers.deleteOccurrence`, which is the ONE delete
  // path: it cascades the subtree, unlinks the id from its parent's
  // `occurrences[]` (skipping that is the dangling-child-ref class this repo
  // has swept five times) and sweeps a module left with no placement.
  //
  // CONFIRMED FIRST, and it names what it is deleting: this is the user's own
  // document, the card gives no undo affordance of its own, and the count of
  // children is the part they cannot see from the tile.
  const handleDelete = useCallback(() => {
    if (!occurrence?.id) return;
    const kids = occurrence.occurrences?.length || 0;
    const what = module?.label || occurrence.label || "this item";
    const msg = kids
      ? `Delete "${what}" and its ${kids} item${kids === 1 ? "" : "s"}?`
      : `Delete "${what}"?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence });
  }, [occurrence, module?.label, dispatch, socket]);

  const handleContextMenu = useCallback((e) => {
    if (!occurrence?.id) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: coverSrc ? "Change cover image…" : "Set cover image…", icon: ImageIcon, onClick: handleSetCover },
        coverSrc ? { label: "Clear cover", icon: X, onClick: handleClearCover, danger: true } : null,
        { separator: true },
        { label: "Delete", icon: Trash2, onClick: handleDelete, danger: true },
      ].filter(Boolean),
    });
  }, [occurrence?.id, coverSrc, handleSetCover, handleClearCover, handleDelete]);

  // Representation mode renders a single chip (no iframe, no preview
  // body) — the user can still drill in by clicking it.
  if (viewMode === "representation") {
    return (
      <div
        ref={ref}
        className={`preview-node-card preview-node-card-representation ${className}`}
        data-preview-node-id={occurrence?.id}
        data-occurrence-id={occurrence?.id}
        style={{
          display: "flex", flexDirection: "column", gap: 4,
          padding: 6, ...extraStyle,
        }}
      >
        <RepresentationView
          occurrence={occurrence}
          size="lg"
          onJump={canDrillDown ? () => onDrillDown?.(occurrence?.id, ref.current) : null}
        />
        <ViewModeSwitcher
          occurrence={occurrence}
          contextTag="folderPage"
          onChange={handleViewModeChange}
          size="sm"
          className="preview-node-mode-switcher"
        />
      </div>
    );
  }

  // Preview mode — the existing iframe path with the switcher overlaid
  // in a corner so authors can flip to representation without leaving
  // the folder page.
  return (
    <div
      ref={ref}
      className={`preview-node-card${isLandscape ? " preview-node-landscape" : ""} ${className}`}
      data-preview-node-id={occurrence?.id}
      data-occurrence-id={occurrence?.id}
      onClick={(e) => {
        if (isAnimating || !canDrillDown) return;
        onDrillDown?.(occurrence?.id, ref.current);
      }}
      onContextMenu={handleContextMenu}
      style={{ position: "relative", ...extraStyle }}
    >
      <div className="preview-node-preview" style={isLandscape ? { aspectRatio: "4 / 3" } : undefined}>
        {coverSrc
          ? <img
              src={coverSrc}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          : shouldLoadIframe
          ? <InlinePreview occurrenceId={occurrence?.id} landscape={isLandscape} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
            </div>
        }
      </div>
      <div className="preview-node-title">
        <Icon size={10} style={{ color, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <AutoMarquee>{label}</AutoMarquee>
        </span>
        <ViewModeSwitcher
          occurrence={occurrence}
          contextTag="folderPage"
          onChange={handleViewModeChange}
          size="sm"
          className="preview-node-mode-switcher"
        />
      </div>
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );
}
