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
} from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { TemplatePill } from "./ComponentsTab";

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

  // Track which instance IDs appear in the tree (to compute unsorted)
  const placedInstanceIds = useMemo(() => {
    const ids = new Set();
    const gridOccIds = state?.grid?.occurrences || [];
    for (const panelOccId of gridOccIds) {
      const panelOcc = occurrencesById?.[panelOccId];
      if (!panelOcc) continue;
      const panel = getEntity(panelOcc.targetId);
      if (!panel) continue;
      for (const contOccId of (panel.occurrences || [])) {
        const contOcc = occurrencesById?.[contOccId];
        if (!contOcc) continue;
        const cont = getEntity(contOcc.targetId);
        if (!cont) continue;
        for (const instOccId of (cont.occurrences || [])) {
          const instOcc = occurrencesById?.[instOccId];
          if (instOcc?.targetId) ids.add(instOcc.targetId);
        }
      }
    }
    return ids;
  }, [state?.grid?.occurrences, occurrencesById, getEntity]);

  // Build tree from grid occurrences
  const tree = useMemo(() => {
    const gridOccIds = state?.grid?.occurrences || [];
    const sq = search.toLowerCase();

    return gridOccIds.map(panelOccId => {
      const panelOcc = occurrencesById?.[panelOccId];
      if (!panelOcc) return null;
      const panel = getEntity(panelOcc.targetId);
      if (!panel) return null;

      const containers = (panel.occurrences || []).map(contOccId => {
        const contOcc = occurrencesById?.[contOccId];
        if (!contOcc) return null;
        const cont = getEntity(contOcc.targetId);
        if (!cont) return null;

        const instances = (cont.occurrences || []).map(instOccId => {
          const instOcc = occurrencesById?.[instOccId];
          if (!instOcc) return null;
          const inst = getEntity(instOcc.targetId);
          if (!inst) return null;
          return { id: instOccId, label: inst.label || inst.name || instOcc.targetId?.slice(-6), entity: inst, occ: instOcc };
        }).filter(Boolean);

        const contLabel = cont.label || cont.name || contOcc.targetId?.slice(-6);
        if (sq && !contLabel?.toLowerCase().includes(sq) && !instances.some(i => i.label?.toLowerCase().includes(sq))) return null;

        return { id: contOccId, label: contLabel, entity: cont, occ: contOcc, instances };
      }).filter(Boolean);

      const panelLabel = panel.label || panel.name || panelOcc.targetId?.slice(-6);
      if (sq && !panelLabel?.toLowerCase().includes(sq) && !containers.some(c => c)) return null;

      return { id: panelOccId, label: panelLabel, entity: panel, occ: panelOcc, containers };
    }).filter(Boolean);
  }, [state?.grid?.occurrences, occurrencesById, getEntity, search]);

  const treeNodeStyle = (depth) => ({
    display: "flex", alignItems: "center", gap: 4,
    padding: `2px 0 2px ${8 + depth * 14}px`,
    borderRadius: 3, cursor: "default",
    fontSize: 10, fontFamily: "monospace",
    color: "var(--text-primary)",
    userSelect: "none",
  });

  const iconColor = { panel: "#60a5fa", container: "#34d399", instance: "#a78bfa" };

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
        return (
          <div key={panelNode.id}>
            {/* Panel row — draggable when collapsed, tree header when open */}
            <DraggableEntityRow
              entity={panelNode.entity}
              role="panel"
              icon={LayoutPanelLeft}
              iconColor={iconColor.panel}
              label={panelNode.label}
              rightLabel={`${panelNode.containers.length}c`}
              onExpand={() => toggle(panelNode.id)}
              isOpen={panelOpen}
              search={search}
              depth={0}
            />

            {/* Containers — only shown when panel is open */}
            {panelOpen && panelNode.containers.map(contNode => {
              const contOpen = !collapsed[contNode.id];
              return (
                <div key={contNode.id}>
                  {/* Container row — draggable when collapsed, tree header when open */}
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

                  {/* Instances — draggable to containers */}
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

      {/* Unsorted — instances not on the grid */}
      {(() => {
        const sq = search.toLowerCase();
        const unsorted = Object.values(instancesById || {}).filter(inst => {
          const id = inst.id || inst._id?.toString();
          return !placedInstanceIds.has(id);
        }).filter(inst => {
          if (!sq) return true;
          const lbl = inst.label || inst.name || "";
          return lbl.toLowerCase().includes(sq);
        });
        if (unsorted.length === 0) return null;
        const unsortedOpen = !collapsed["__unsorted__"];
        return (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, marginTop: 2 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0 4px 0", cursor: "default", userSelect: "none" }}
              onClick={() => toggle("__unsorted__")}
            >
              {unsortedOpen
                ? <ChevronDown style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
                : <ChevronRight style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
              }
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>
                Unsorted ({unsorted.length})
              </span>
            </div>
            {unsortedOpen && unsorted.map(inst => {
              const id = inst.id || inst._id?.toString();
              const lbl = inst.label || inst.name || id?.slice(-6);
              return (
                <DraggableInstanceRow
                  key={id}
                  entity={inst}
                  depth={0}
                  label={lbl}
                  treeNodeStyle={treeNodeStyle}
                  iconColor={iconColor}
                  search={search}
                />
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
