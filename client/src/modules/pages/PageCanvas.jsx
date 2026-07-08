// modules/pages/PageCanvas.jsx
// Canvas page — renders the page's child instances/containers as
// absolutely-positioned <ModuleInstance>/<Container> elements (the same
// components used in board/doc), with a thin wrapper for meta.x/y. No
// canvas-specific card component — modules are unified across views.
import React, { useMemo, useCallback, useContext } from "react";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import { CanvasDrawSection } from "../CanvasContent.jsx";
import ModuleInstance from "../ModuleInstance.jsx";
import Container from "../ModuleContainer.jsx";
import TextblockCard from "../TextblockCard.jsx";
import ArtifactCard from "../ArtifactCard.jsx";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { useDroppable, DropAccepts } from "../../helpers/dragSystem";

// Absolute-positioning shell — pure layout, no drag wiring of its own.
// The inner ModuleInstance/Container handles its own drag via useDragDrop.
function CanvasSlot({ x, y, children }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x ?? 20,
        top: y ?? 20,
        minWidth: 160,
        maxWidth: 300,
      }}
    >
      {children}
    </div>
  );
}

export default function PageCanvas({ pageModule, occurrence, panelId, dispatch, socket }) {
  const { occurrencesById, modulesById, state: ctxState } = useGridActions();

  const { ref: canvasDropRef } = useDroppable({
    type: "canvas-page",
    id: `canvas-page:${occurrence?.id}`,
    context: {
      panelId,
      pageId: pageModule?.id,
      pageOccurrenceId: occurrence?.id,
    },
    accepts: DropAccepts.PAGE_CONTENT,
    disabled: !pageModule || !occurrence,
  });

  const itemsWithOccurrences = useMemo(() => {
    const ids = occurrence?.occurrences || [];
    return ids
      .map((occId) => {
        const occ = occurrencesById?.[occId];
        if (!occ) return null;
        const mod = modulesById?.[occ.moduleId];
        if (!mod) return null;
        return { module: mod, occurrence: occ };
      })
      .filter(Boolean);
  }, [occurrence, occurrencesById, modulesById]);

  const renderCard = useCallback(
    ({ module: mod, occurrence: occ, containerId, panelId: pid }) => {
      // Leaf-role routing mirrors ModuleContainer's child loop: textblocks
      // and artifacts render via their own card components inside an empty
      // ModuleInstance shell (renderBody). Without this, textblock-role
      // modules dropped on a canvas show up as an empty instance row
      // because ModuleInstance's default rendering has no field bindings
      // to lay out.
      let renderBody = null;
      if (mod.role === "textblock") {
        renderBody = () => <TextblockCard occurrence={occ} module={mod} />;
      } else if (mod.role === "artifact") {
        renderBody = () => <ArtifactCard module={mod} label={mod.label} />;
      }
      // Position-less cards (e.g. feed-minted copies — occurrence.feed
      // materializes children without meta.x/y) stack in a tidy column by
      // child order instead of piling at the CanvasSlot (20,20) default.
      // Anchored near the world CENTER (the initial viewport) — the 4000px
      // canvas world scrolls, so corner coordinates render off-screen (the
      // old Canvas: Build op stamped ~1760/1850 for the same reason).
      // First drag persists a real meta.x/y and takes over.
      const childIdx = Math.max(0, (occurrence?.occurrences || []).indexOf(occ.id));
      const fallbackX = 1760;
      const fallbackY = 1850 + childIdx * 80;
      return (
        <CanvasSlot key={occ.id} x={occ?.meta?.x ?? fallbackX} y={occ?.meta?.y ?? fallbackY}>
          {mod.role === "container" ? (
            <Container
              module={mod}
              occurrenceOverride={occ}
              panelId={pid}
              // Only docs render with the teal "embedded card" treatment on
              // canvas. List/board/canvas-kind containers keep their normal
              // panel-style chrome so a list container dropped on a canvas
              // doesn't look like a doc.
              embedded={mod.kind === "doc"}
              dispatch={dispatch}
              socket={socket}
            />
          ) : (
            <ModuleInstance
              module={mod}
              occurrence={occ}
              containerId={containerId}
              containerOccurrence={occurrence}
              panelId={pid}
              dispatch={dispatch}
              socket={socket}
              renderBody={renderBody}
              floatHandle={!!renderBody}
            />
          )}
        </CanvasSlot>
      );
    },
    [dispatch, socket, occurrence]
  );

  const handleDoubleClick = useCallback(
    (e) => {
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);
      const userId = pageModule?.userId || ctxState?.userId;
      const gridId = pageModule?.gridId || ctxState?.grid?._id;
      if (!userId || !gridId || !occurrence?.id) return;
      const moduleId = crypto.randomUUID();
      const occId = crypto.randomUUID();
      CommitHelpers.createModule({
        dispatch,
        socket,
        module: { id: moduleId, userId, gridId, role: "instance", kind: "board", label: "New card", fieldBindings: [] },
        emit: true,
      });
      CommitHelpers.createOccurrence({
        dispatch,
        socket,
        occurrence: { id: occId, userId, gridId, moduleId, parentId: occurrence.id, meta: { x, y }, fields: {} },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch,
        socket,
        occurrence: { id: occurrence.id, occurrences: [...(occurrence.occurrences || []), occId] },
        emit: true,
      });
    },
    [pageModule, occurrence, ctxState, dispatch, socket]
  );

  return (
    <CanvasDrawSection
      containerOccurrence={occurrence}
      itemsWithOccurrences={itemsWithOccurrences}
      renderCard={renderCard}
      dispatch={dispatch}
      socket={socket}
      module={pageModule}
      listDropRef={canvasDropRef}
      ctxState={ctxState}
      containerId={pageModule?.id}
      panelId={panelId}
      onDoubleClickBackground={handleDoubleClick}
      showToolbar
    />
  );
}
