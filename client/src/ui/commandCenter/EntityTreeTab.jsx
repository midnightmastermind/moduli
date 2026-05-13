// ui/commandCenter/EntityTreeTab.jsx
// EntityTreeTab + DraggableInstanceRow + DraggableEntityRow

import React, { useState, useMemo, useContext, useEffect, useRef, useCallback } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Box,
  Layers,
  LayoutPanelLeft,
  FileText,
  Trash2,
  RotateCcw,
} from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { TemplatePill } from "./ComponentsTab";
import GlobalTree from "../../modules/GlobalTree.jsx";

const inputStyle = {
  height: 28,
  fontSize: 11,
  fontFamily: "monospace",
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 5,
  color: "var(--text-primary)",
  padding: "0 8px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ============================================================
// Draggable instance row for entity tree — drag to any container to create occurrence
export function DraggableInstanceRow({ entity, depth, label, treeNodeStyle, iconColor, search, ancestry, inferredRole }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        role: inferredRole || entity.role || "instance",
        id: entity.id,
        data: entity,
        sourceType: "command-center",
      }),
    });
  }, [entity, inferredRole]);

  const isMatch = search && label?.toLowerCase().includes(search.toLowerCase());
  const fieldCount = entity.fieldBindings?.filter(b => !b.hidden).length || 0;
  return (
    <div
      ref={ref}
      style={{
        cursor: "grab",
        marginLeft: depth * 10,
        marginBottom: 3,
        borderRadius: 6,
        border: `1px solid ${isMatch ? "rgba(196,181,253,0.4)" : "var(--border-default)"}`,
        background: isMatch ? "rgba(196,181,253,0.06)" : "var(--input-bg)",
        padding: "5px 8px",
        display: "flex", alignItems: "center", gap: 5,
        userSelect: "none",
      }}
    >
      <GripVertical style={{ width: 10, height: 10, opacity: 0.35, flexShrink: 0 }} />
      <Box style={{ width: 10, height: 10, color: isMatch ? "var(--accent-purple-text)" : iconColor?.instance || "var(--text-muted)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: isMatch ? "var(--accent-purple-text)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {ancestry && (
          <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ancestry}
          </span>
        )}
      </div>
      {fieldCount > 0 && (
        <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0, background: "var(--input-bg)", borderRadius: 3, padding: "1px 4px" }}>
          {fieldCount}f
        </span>
      )}
    </div>
  );
}

// Draggable entity row — shows as tree header when open, draggable pill when collapsed
export function DraggableEntityRow({ entity, role, icon: Icon, iconColor, label, rightLabel, onExpand, isOpen, search, depth = 0 }) {
  const ref = useRef(null);

  // Only register as draggable when collapsed
  useEffect(() => {
    if (isOpen) return;
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        role,
        id: entity.id,
        data: entity,
        sourceType: "command-center",
      }),
    });
  }, [entity, role, isOpen]);

  const isMatch = search && label?.toLowerCase().includes(search.toLowerCase());

  if (isOpen) {
    // Expanded: tree header style
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `2px 0 2px ${8 + depth * 14}px`,
          cursor: "default", fontSize: 10, fontFamily: "monospace",
          color: iconColor, fontWeight: 600, userSelect: "none",
        }}
        onClick={onExpand}
      >
        <ChevronDown style={{ width: 10, height: 10, flexShrink: 0 }} />
        <Icon style={{ width: 11, height: 11, flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>
          {rightLabel}
        </span>
      </div>
    );
  }

  // Collapsed: draggable pill (same visual as DraggableInstanceRow)
  return (
    <div
      ref={ref}
      style={{
        cursor: "grab",
        marginLeft: depth * 10,
        marginBottom: 3,
        borderRadius: 6,
        border: `1px solid ${isMatch ? "rgba(196,181,253,0.4)" : "var(--border-default)"}`,
        background: isMatch ? "rgba(196,181,253,0.06)" : "var(--input-bg)",
        padding: "5px 8px",
        display: "flex", alignItems: "center", gap: 5,
        userSelect: "none",
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onExpand(); }}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", opacity: 0.35, flexShrink: 0 }}
        title="Expand"
      >
        <ChevronRight style={{ width: 8, height: 8 }} />
      </button>
      <GripVertical style={{ width: 10, height: 10, opacity: 0.35, flexShrink: 0 }} />
      <Icon style={{ width: 10, height: 10, color: isMatch ? "var(--accent-purple-text)" : iconColor, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 11, fontFamily: "monospace", color: isMatch ? "var(--accent-purple-text)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>
        {rightLabel}
      </span>
    </div>
  );
}

// ============================================================
// Universal manifest tree: Grid → Panels → Containers → Instances (+ draggable)
// ============================================================
export function EntityTreeTab() {
  const ctx = useContext(GridActionsContext) || {};
  const { state, socket, dispatch, occurrencesById, modulesById, panelsById, containersById, instancesById } = ctx;
  const gridId = state?.gridId;
  const grid = state?.grid;
  const templates = useMemo(() => grid?.templates || [], [grid?.templates]);
  const [collapsed, setCollapsed] = useState({});
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const toggle = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

  // Resolve an entity from either the new Module model or legacy models
  const getEntity = useCallback((targetId) => {
    return modulesById?.[targetId] || panelsById?.[targetId] || containersById?.[targetId] || instancesById?.[targetId] || null;
  }, [modulesById, panelsById, containersById, instancesById]);

  // Template helpers (from ComponentsTab)
  const commitTemplates = useCallback((updated) => {
    const gid = grid?._id?.toString() || grid?.id || gridId;
    CommitHelpers.updateGrid({ dispatch, socket, gridId: gid, grid: { ...grid, templates: updated }, emit: true });
  }, [grid, gridId, dispatch, socket]);
  const handleDeleteTemplate = useCallback((templateId) => {
    commitTemplates(templates.filter(t => t.id !== templateId));
  }, [templates, commitTemplates]);
  const handleRenameTemplate = useCallback((template) => {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed || trimmed === template.name) return;
    commitTemplates(templates.map(t => t.id === template.id ? { ...t, name: trimmed } : t));
  }, [templates, editName, commitTemplates]);

  // Track which module IDs appear on the grid (to compute uncategorized)
  const placedModuleIds = useMemo(() => {
    const ids = new Set();
    const gridOccIds = state?.grid?.occurrences || [];
    const collectChildren = (occIds) => {
      for (const occId of (occIds || [])) {
        const occ = occurrencesById?.[occId];
        if (!occ) continue;
        if (occ.moduleId) ids.add(occ.moduleId);
        collectChildren(occ.occurrences);
      }
    };
    collectChildren(gridOccIds);
    return ids;
  }, [state?.grid?.occurrences, occurrencesById]);

  // Build container+instances subtree from a container occurrence
  const buildContainer = useCallback((contOccId, sq) => {
    const contOcc = occurrencesById?.[contOccId];
    if (!contOcc) return null;
    const cont = getEntity(contOcc.moduleId);
    if (!cont) return null;

    const instances = (contOcc.occurrences || []).map(instOccId => {
      const instOcc = occurrencesById?.[instOccId];
      if (!instOcc) return null;
      const inst = getEntity(instOcc.moduleId);
      if (!inst) return null;
      return { id: instOccId, label: inst.label || inst.name || instOcc.moduleId?.slice(-6), entity: inst, occ: instOcc };
    }).filter(Boolean);

    const contLabel = cont.label || cont.name || contOcc.moduleId?.slice(-6);
    if (sq && !contLabel?.toLowerCase().includes(sq) && !instances.some(i => i.label?.toLowerCase().includes(sq))) return null;

    return { id: contOccId, label: contLabel, entity: cont, occ: contOcc, instances };
  }, [occurrencesById, getEntity]);

  // Build tree from grid occurrences
  const tree = useMemo(() => {
    const gridOccIds = state?.grid?.occurrences || [];
    const sq = search.toLowerCase();

    return gridOccIds.map(panelOccId => {
      const panelOcc = occurrencesById?.[panelOccId];
      if (!panelOcc) return null;
      const panel = getEntity(panelOcc.moduleId);
      if (!panel) return null;

      // Detect if panel children are pages or containers
      const childOccIds = panelOcc.occurrences || [];
      const firstChildOcc = childOccIds.length > 0 ? occurrencesById?.[childOccIds[0]] : null;
      const firstChildEntity = firstChildOcc ? getEntity(firstChildOcc.moduleId) : null;
      const hasPages = firstChildEntity?.role === "page";

      let pages = null;
      let containers = null;

      if (hasPages) {
        // Panel → Pages → Containers → Instances
        pages = childOccIds.map(pageOccId => {
          const pageOcc = occurrencesById?.[pageOccId];
          if (!pageOcc) return null;
          const page = getEntity(pageOcc.moduleId);
          if (!page) return null;

          const pageContainers = (pageOcc.occurrences || []).map(cid => buildContainer(cid, sq)).filter(Boolean);
          const pageLabel = page.label || page.name || pageOcc.moduleId?.slice(-6);
          if (sq && !pageLabel?.toLowerCase().includes(sq) && !pageContainers.some(c => c)) return null;

          return { id: pageOccId, label: pageLabel, entity: page, occ: pageOcc, containers: pageContainers };
        }).filter(Boolean);
      } else {
        // Legacy: Panel → Containers → Instances
        containers = childOccIds.map(cid => buildContainer(cid, sq)).filter(Boolean);
      }

      const panelLabel = panel.label || panel.name || panelOcc.moduleId?.slice(-6);
      const hasContent = hasPages ? pages.length > 0 : containers.length > 0;
      if (sq && !panelLabel?.toLowerCase().includes(sq) && !hasContent) return null;

      return { id: panelOccId, label: panelLabel, entity: panel, occ: panelOcc, hasPages, pages, containers };
    }).filter(Boolean);
  }, [state?.grid?.occurrences, occurrencesById, getEntity, search, buildContainer]);

  const treeNodeStyle = (depth) => ({
    display: "flex", alignItems: "center", gap: 4,
    padding: `2px 0 2px ${8 + depth * 14}px`,
    borderRadius: 3, cursor: "default",
    fontSize: 10, fontFamily: "monospace",
    color: "var(--text-primary)",
    userSelect: "none",
  });

  const iconColor = { panel: "#60a5fa", page: "#06b6d4", container: "#34d399", instance: "#a78bfa" };

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, height: "100%", overflowY: "auto" }}>
      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search panels, containers, instances..."
        style={{ ...inputStyle, marginBottom: 4 }}
      />

      {/* Grid label */}
      <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-faint)", marginBottom: 2 }}>
        Grid: <span style={{ color: "var(--text-muted)" }}>{state?.grid?.gridName || state?.grid?.name || state?.gridId?.slice(-8) || "—"}</span>
      </div>

      {/* Tree */}
      {tree.length === 0 && (
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", fontStyle: "italic" }}>
          {search ? "No matches" : "No panels on this grid yet"}
        </div>
      )}

      {tree.map(panelNode => {
        const panelOpen = !collapsed[panelNode.id];
        const childCount = panelNode.hasPages
          ? (panelNode.pages?.length || 0) + "p"
          : (panelNode.containers?.length || 0) + "c";
        return (
          <div key={panelNode.id}>
            {/* Panel row — draggable when collapsed, tree header when open */}
            <DraggableEntityRow
              entity={panelNode.entity}
              role="panel"
              icon={LayoutPanelLeft}
              iconColor={iconColor.panel}
              label={panelNode.label}
              rightLabel={childCount}
              onExpand={() => toggle(panelNode.id)}
              isOpen={panelOpen}
              search={search}
              depth={0}
            />

            {/* Panel with pages: Panel → Pages → Containers → Instances */}
            {panelOpen && panelNode.hasPages && panelNode.pages?.map(pageNode => {
              const pageOpen = !collapsed[pageNode.id];
              return (
                <div key={pageNode.id}>
                  <DraggableEntityRow
                    entity={pageNode.entity}
                    role="page"
                    icon={FileText}
                    iconColor={iconColor.page}
                    label={pageNode.label}
                    rightLabel={`${pageNode.containers.length}c`}
                    onExpand={() => toggle(pageNode.id)}
                    isOpen={pageOpen}
                    search={search}
                    depth={1}
                  />

                  {pageOpen && pageNode.containers.map(contNode => {
                    const contOpen = !collapsed[contNode.id];
                    return (
                      <div key={contNode.id}>
                        <DraggableEntityRow
                          entity={contNode.entity}
                          role="container"
                          icon={Layers}
                          iconColor={iconColor.container}
                          label={contNode.label}
                          rightLabel={`${contNode.instances.length}i`}
                          onExpand={() => toggle(contNode.id)}
                          isOpen={contOpen}
                          search={search}
                          depth={2}
                        />
                        {contOpen && contNode.instances.map(instNode => (
                          <DraggableInstanceRow
                            key={instNode.id}
                            entity={instNode.entity}
                            depth={3}
                            label={instNode.label}
                            treeNodeStyle={treeNodeStyle}
                            iconColor={iconColor}
                            search={search}
                            ancestry={`${panelNode.label} › ${pageNode.label} › ${contNode.label}`}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Legacy panels without pages: Panel → Containers → Instances */}
            {panelOpen && !panelNode.hasPages && panelNode.containers?.map(contNode => {
              const contOpen = !collapsed[contNode.id];
              return (
                <div key={contNode.id}>
                  <DraggableEntityRow
                    entity={contNode.entity}
                    role="container"
                    icon={Layers}
                    iconColor={iconColor.container}
                    label={contNode.label}
                    rightLabel={`${contNode.instances.length}i`}
                    onExpand={() => toggle(contNode.id)}
                    isOpen={contOpen}
                    search={search}
                    depth={1}
                  />
                  {contOpen && contNode.instances.map(instNode => (
                    <DraggableInstanceRow
                      key={instNode.id}
                      entity={instNode.entity}
                      depth={2}
                      label={instNode.label}
                      treeNodeStyle={treeNodeStyle}
                      iconColor={iconColor}
                      search={search}
                      ancestry={`${panelNode.label} › ${contNode.label}`}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Uncategorized — modules not on the grid */}
      {(() => {
        const sq = search.toLowerCase();
        const uncategorized = Object.values(modulesById || {}).filter(m => {
          if (!m.id || m.trashed) return false;
          if (placedModuleIds.has(m.id)) return false;
          if (sq) {
            const lbl = (m.label || m.name || "").toLowerCase();
            if (!lbl.includes(sq)) return false;
          }
          return true;
        });
        if (uncategorized.length === 0) return null;
        const isOpen = !collapsed["__uncategorized__"];
        return (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, marginTop: 2 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0 4px 0", cursor: "pointer", userSelect: "none" }}
              onClick={() => toggle("__uncategorized__")}
            >
              {isOpen
                ? <ChevronDown style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
                : <ChevronRight style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
              }
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>
                Uncategorized ({uncategorized.length})
              </span>
            </div>
            {isOpen && uncategorized.map(m => {
              const id = m.id || m._id?.toString();
              const lbl = m.label || m.name || id?.slice(-6);
              const role = m.role || "instance";
              const trashBtn = (
                <button
                  onClick={(e) => { e.stopPropagation(); CommitHelpers.trashModule({ dispatch, socket, moduleId: id }); }}
                  title="Move to Recycle Bin"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "var(--text-faint)", flexShrink: 0, opacity: 0.5 }}
                >
                  <Trash2 style={{ width: 10, height: 10 }} />
                </button>
              );
              const entityRoleMap = {
                panel: { icon: LayoutPanelLeft, color: iconColor.panel },
                page: { icon: FileText, color: iconColor.page },
                container: { icon: Layers, color: iconColor.container },
              };
              if (entityRoleMap[role]) {
                const { icon, color } = entityRoleMap[role];
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <DraggableEntityRow entity={m} role={role} icon={icon}
                        iconColor={color} label={lbl} rightLabel="" isOpen={false}
                        onExpand={() => {}} search={search} depth={0} />
                    </div>
                    {trashBtn}
                  </div>
                );
              }
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <DraggableInstanceRow entity={m} depth={0} label={lbl}
                      treeNodeStyle={treeNodeStyle} iconColor={iconColor} search={search} />
                  </div>
                  {trashBtn}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Recycle Bin — trashed modules */}
      {(() => {
        const trashed = Object.values(modulesById || {}).filter(m => m.trashed);
        if (trashed.length === 0) return null;
        const isOpen = !collapsed["__trash__"];
        return (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, marginTop: 2 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0 4px 0", cursor: "pointer", userSelect: "none" }}
              onClick={() => toggle("__trash__")}
            >
              {isOpen
                ? <ChevronDown style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
                : <ChevronRight style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
              }
              <Trash2 style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>
                Recycle Bin ({trashed.length})
              </span>
            </div>
            {isOpen && trashed.map(m => {
              const id = m.id || m._id?.toString();
              const lbl = m.label || m.name || id?.slice(-6);
              const role = m.role || "instance";
              const roleIcon = role === "panel" ? LayoutPanelLeft : role === "container" ? Layers : Box;
              const roleColor = role === "panel" ? iconColor.panel : role === "container" ? iconColor.container : iconColor.instance;
              return (
                <div key={id} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 8px", marginBottom: 3, borderRadius: 6,
                  border: "1px solid var(--border-default)", background: "var(--input-bg)",
                  fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)",
                }}>
                  {React.createElement(roleIcon, { style: { width: 10, height: 10, color: roleColor, flexShrink: 0, opacity: 0.5 } })}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lbl}</span>
                  <button
                    onClick={() => CommitHelpers.restoreModule({ dispatch, socket, moduleId: id })}
                    title="Restore"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "var(--accent-blue-text)" }}
                  >
                    <RotateCcw style={{ width: 11, height: 11 }} />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Permanently delete "${lbl}"? This cannot be undone.`)) {
                        CommitHelpers.deleteModule({ dispatch, socket, moduleId: id, emit: true });
                      }
                    }}
                    title="Delete permanently"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "var(--danger-text, rgb(252,165,165))" }}
                  >
                    <Trash2 style={{ width: 11, height: 11 }} />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Templates section — from ComponentsTab */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: 4 }}>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", marginBottom: 5 }}>
          Templates — drag onto container to fill
        </div>
        {templates.length === 0 && (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", fontStyle: "italic" }}>
            No templates yet — right-click a container → Save as Template
          </div>
        )}
        {templates.map((template) => (
          <TemplatePill
            key={template.id}
            template={template}
            isEditing={editingId === template.id}
            editName={editName}
            onEditNameChange={setEditName}
            onStartEdit={(name) => { setEditingId(template.id); setEditName(name); }}
            onConfirmRename={() => handleRenameTemplate(template)}
            onCancelEdit={() => setEditingId(null)}
            onDelete={() => handleDeleteTemplate(template.id)}
          />
        ))}
      </div>
    </div>
  );
}
