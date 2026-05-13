// modules/ModuleRouter.jsx
// Merges Module.jsx + View.jsx into a single router component.
// Thin entry point: reads occurrence, resolves role/view, routes to the correct inner component.
// All layout/sidebar/routing logic is here; inner components (Panel/Container/Instance/Artifact) are pure renderers.
import { useContext, useState, useCallback } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import ModulePanel from "./ModulePanel.jsx";
import ModulePage from "./ModulePage.jsx";
import Container from "./ModuleContainer.jsx";
import { MemoInstanceInner as Instance } from "./ModuleInstance.jsx";
import ArtifactContent from "./ArtifactContent.jsx";
import ManifestTree from "./ManifestTree.jsx";
import PreviewContent from "./PreviewContent.jsx";

// ─── ModuleRouter ──────────────────────────────────────────────────────────────

export default function ModuleRouter({ occurrence, embedded = false, dispatch, socket, ...props }) {
  const { viewsById, modulesById, occurrencesById, roleByModuleId } = useContext(GridActionsContext);

  if (!occurrence) return null;

  const resolvedView = occurrence?.viewId ? viewsById?.[occurrence.viewId] : null;
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;

  // For artifact panels: the active occurrence is set on the view
  const activeOccurrence = resolvedView?.activeOccurrenceId
    ? occurrencesById?.[resolvedView.activeOccurrenceId]
    : null;

  // Infer role from occurrence hierarchy (canonical), fall back to module.role (legacy)
  const role = module ? (roleByModuleId?.[module.id] || module.role) : null;

  // Preview view — thumbnail card, any role
  if (resolvedView?.viewType === "preview") {
    return (
      <PreviewContent
        occurrence={occurrence}
        view={resolvedView}
        dispatch={dispatch}
        socket={socket}
      />
    );
  }

  // Route to inner component by role (hierarchy-inferred) + view.viewType / module.kind
  // module.kind is the legacy fallback; view.viewType is the forward-looking source
  const isArtifact = module?.kind === "artifact" || resolvedView?.viewType === "display" || resolvedView?.hasTree;

  let Inner = null;
  if (isArtifact && role !== "panel") {
    // Container-level artifact (markdown doc, code, grid, etc.)
    Inner = (
      <ArtifactContent
        occurrence={occurrence}
        viewType={resolvedView?.viewType}
        artifactType={resolvedView?.artifactType}
        embedded={embedded}
        dispatch={dispatch}
        socket={socket}
        view={resolvedView}
        {...props}
      />
    );
  } else if (isArtifact && role === "panel") {
    // Panel occurrence with an artifact view — show active artifact occurrence
    const activeView = activeOccurrence ? viewsById?.[activeOccurrence?.viewId] : null;
    Inner = (
      <ArtifactContent
        occurrence={activeOccurrence}
        viewType={activeView?.viewType ?? "markdown"}
        artifactType={activeView?.artifactType ?? null}
        embedded={embedded}
        dispatch={dispatch}
        socket={socket}
        view={resolvedView}
        {...props}
      />
    );
  } else if (role === "panel") {
    Inner = <ModulePanel occurrence={occurrence} embedded={embedded} dispatch={dispatch} socket={socket} {...props} />;
  } else if (role === "page") {
    Inner = <ModulePage occurrence={occurrence} dispatch={dispatch} socket={socket} {...props} />;
  } else if (role === "container") {
    Inner = <Container occurrence={occurrence} embedded={embedded} dispatch={dispatch} socket={socket} {...props} />;
  } else if (role === "instance") {
    Inner = <Instance occurrence={occurrence} embedded={embedded} {...props} />;
  }

  // If this occurrence has a view with hasTree, render sidebar alongside content
  // Sidebar is collapsed by default and overlays the doc (not push)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const toggleSidebar = useCallback(() => setSidebarCollapsed(v => !v), []);

  if (resolvedView?.hasTree && resolvedView?.manifestId) {
    return (
      <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
        {/* Sidebar overlays the doc */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 20,
          pointerEvents: sidebarCollapsed ? "none" : "auto",
        }}>
          <ManifestTree
            manifestId={resolvedView.manifestId}
            view={resolvedView}
            dispatch={dispatch}
            socket={socket}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
          />
        </div>
        {/* Content fills full width */}
        <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>{Inner}</div>
      </div>
    );
  }

  return Inner;
}
