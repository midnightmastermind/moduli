// modules/pages/PageFolder.jsx
// Folder page — Explorer-style grid of PreviewNode cards with drilldown animation.
// Header mimics Windows 7 date picker: clicking scope label drills out,
// prev/next arrows navigate peer pages at the same depth.

import React, { useRef, useMemo, useState, useCallback, useContext, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PreviewNode from "../PreviewNode.jsx";
import useDrilldown, { getCardAnimStyle } from "../../hooks/useDrilldown.js";
import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";

export default function PageFolder({
  childOccs,
  siblingOccs,
  dropRef,
  isOver,
  isMobile,
  modulesById,
  panelView,
  folderPageOccId,
  dispatch,
  socket,
  autoNavigateTo,
  onAutoNavigateComplete,
}) {
  const folderRef = useRef(null);
  const { occurrencesById } = useContext(GridActionsContext);

  const handleNavigate = useCallback((occId) => {
    if (panelView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...panelView, activeOccurrenceId: occId }, emit: true });
    }
  }, [panelView, dispatch, socket]);

  const { animState, drilldownStack, startDrillDown, startDrillOut, navigatePeer, resetStack, canDrillOut } = useDrilldown({
    onNavigate: handleNavigate,
    containerRef: folderRef,
  });

  // Wrap startDrillDown to prime the folder into the stack when entering from a clean state.
  const handleDrillDown = useCallback((occId, cardEl) => {
    if (drilldownStack.length === 0 && folderPageOccId) {
      resetStack([folderPageOccId]);
    }
    startDrillDown(occId, cardEl);
  }, [drilldownStack.length, folderPageOccId, resetStack, startDrillDown]);

  // Auto-drilldown when navigating from tree (folder-first flow)
  useEffect(() => {
    if (!autoNavigateTo) return;
    resetStack(folderPageOccId ? [folderPageOccId] : []);
    const timer = setTimeout(() => {
      const cardEl = folderRef.current?.querySelector(`[data-occurrence-id="${autoNavigateTo}"]`);
      startDrillDown(autoNavigateTo, cardEl || null);
      onAutoNavigateComplete?.();
    }, 10);
    return () => clearTimeout(timer);
  }, [autoNavigateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Peer navigation
  const currentDrilledId = canDrillOut ? drilldownStack[drilldownStack.length - 1] : null;
  const currentSiblingIndex = useMemo(() => {
    if (!currentDrilledId || !siblingOccs?.length) return -1;
    return siblingOccs.findIndex(o => o.id === currentDrilledId);
  }, [currentDrilledId, siblingOccs]);

  const handlePeerNav = useCallback((delta) => {
    if (!siblingOccs?.length || currentSiblingIndex < 0) return;
    const nextIndex = currentSiblingIndex + delta;
    if (nextIndex < 0 || nextIndex >= siblingOccs.length) return;
    navigatePeer(siblingOccs[nextIndex].id);
  }, [siblingOccs, currentSiblingIndex, navigatePeer]);

  // Keyboard: Escape = drill out, Left/Right = peer nav
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
      if (e.key === "Escape" && canDrillOut) { e.preventDefault(); startDrillOut(); }
      if (e.key === "ArrowLeft" && canDrillOut) { e.preventDefault(); handlePeerNav(-1); }
      if (e.key === "ArrowRight" && canDrillOut) { e.preventDefault(); handlePeerNav(1); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Scope header (Windows 7 breadcrumb + peer nav)
  const scopeLabels = useMemo(() => {
    return drilldownStack.map(occId => {
      const occ = occurrencesById[occId];
      const mod = occ ? modulesById[occ.moduleId] : null;
      return { occId, label: mod?.label || "…" };
    });
  }, [drilldownStack, occurrencesById, modulesById]);

  const scopeHeader = canDrillOut ? (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0, padding: "4px 8px 4px 18px",
      borderBottom: "1px solid var(--border-default)",
      background: "var(--surface-base)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, flex: 1, overflow: "hidden" }}>
        {scopeLabels.map((crumb, i) => {
          const isLast = i === scopeLabels.length - 1;
          return (
            <React.Fragment key={crumb.occId}>
              {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 9, flexShrink: 0 }}>›</span>}
              <span
                style={{
                  fontSize: 10, fontFamily: "var(--font-mono)",
                  color: isLast ? "var(--text-primary)" : "var(--accent-blue, #38bdf8)",
                  cursor: isLast ? "default" : "pointer",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: isLast ? "none" : "underline",
                  textDecorationColor: "rgba(56,189,248,0.4)",
                }}
                onClick={() => {
                  if (isLast) return;
                  const stepsOut = scopeLabels.length - 1 - i;
                  for (let s = 0; s < stepsOut; s++) startDrillOut();
                }}
                title={isLast ? undefined : `Back to ${crumb.label}`}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {siblingOccs?.length > 1 && currentSiblingIndex >= 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, marginLeft: 8 }}>
          <button
            onClick={() => handlePeerNav(-1)}
            disabled={currentSiblingIndex <= 0}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex <= 0 ? "default" : "pointer",
              color: currentSiblingIndex <= 0 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", userSelect: "none" }}>
            {currentSiblingIndex + 1}/{siblingOccs.length}
          </span>
          <button
            onClick={() => handlePeerNav(1)}
            disabled={currentSiblingIndex >= siblingOccs.length - 1}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex >= siblingOccs.length - 1 ? "default" : "pointer",
              color: currentSiblingIndex >= siblingOccs.length - 1 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={(node) => {
        folderRef.current = node;
        if (dropRef) dropRef.current = node;
      }}
      style={{
        flex: 1, minHeight: 0,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        outline: isOver ? "2px solid rgba(50,150,255,0.5)" : "none",
        outlineOffset: -2,
        position: "relative",
      }}
    >
      {scopeHeader}
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        padding: isMobile ? "8px 8px 80px 8px" : "0px 0px 80px 0px",
      }}>
        <div className="preview-node-grid">
          {childOccs.map((occ, i) => {
            const mod = modulesById[occ.moduleId];
            return (
              <PreviewNode
                key={occ.id}
                occurrence={occ}
                module={mod}
                onDrillDown={handleDrillDown}
                isAnimating={!!animState}
                loadPreview={autoNavigateTo ? occ.id === autoNavigateTo : true}
                loadIndex={i}
                style={getCardAnimStyle(occ.id, animState)}
              />
            );
          })}
          {childOccs.length === 0 && (
            <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ gridColumn: "1 / -1" }}>
              Drop items here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
