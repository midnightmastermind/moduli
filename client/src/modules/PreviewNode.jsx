// modules/PreviewNode.jsx
// Preview card component for folder page views.
// Shows a module occurrence as a card with iframe content preview.
// Click triggers drilldown animation.
//
// Uses ?previewOcc=<occId> iframe that loads PagePreviewApp — a lightweight
// app that connects via socket with previewOcc param to get only the
// occurrence subtree needed.

import React, { useRef, useEffect, useContext, useState } from "react";
import { File } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GridActionsContext } from "../GridActionsContext.js";
import { getModuleTypeIcon, getModuleTypeColor } from "../helpers/moduleIcons";

// Iframe preview — loads /?previewOcc=<occId> which renders PagePreviewApp
function IframePreview({ occurrenceId, landscape = false }) {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0.15);
  const iframeW = landscape ? 560 : 600;
  const iframeH = landscape ? 380 : 800;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) setScale(width / iframeW);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [iframeW]);

  if (!occurrenceId) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <iframe
        src={`/?previewOcc=${occurrenceId}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: iframeW,
          height: iframeH,
          border: "none",
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          pointerEvents: "none",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
        title="Preview"
        onLoad={() => setLoaded(true)}
        tabIndex={-1}
      />
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-faint)", fontSize: 10,
        }}>
          …
        </div>
      )}
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
  const shouldLoadIframe = loadPreview && hasBeenVisible;

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
      style={extraStyle}
    >
      <div className="preview-node-preview" style={isLandscape ? { aspectRatio: "4 / 3" } : undefined}>
        {shouldLoadIframe
          ? <IframePreview occurrenceId={occurrence?.id} landscape={isLandscape} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <File size={20} style={{ color: "var(--text-faint)", opacity: 0.3 }} />
            </div>
        }
      </div>
      <div className="preview-node-title">
        <Icon size={10} style={{ color, flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
    </div>
  );
}
