// ui/commandCenter/ComponentsTab.jsx
// ComponentsTab + ModulePill + TemplatePill

import React, { useState, useMemo, useContext, useEffect, useRef, useCallback } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GripVertical, BookMarked, Pencil, Trash2 } from "lucide-react";

import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";

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

const ROLE_COLORS = {
  panel: "rgba(59,130,246,0.7)",
  page: "rgba(6,182,212,0.7)",
  container: "rgba(34,197,94,0.7)",
  instance: "rgba(168,85,247,0.7)",
};
const ROLE_LABELS = { panel: "panel", page: "page", container: "container", instance: "instance" };

export function ModulePill({ module, inferredRole }) {
  const ref = useRef(null);
  const label = module.label || module.name || "Untitled";
  const role = inferredRole || module.role || "instance";
  const kind = module.kind || "board";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        role,
        id: module.id,
        data: module,
        sourceType: "command-center",
      }),
    });
  }, [module, role]);

  return (
    <div
      ref={ref}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "5px 8px", borderRadius: 6,
        background: "var(--input-bg)",
        border: "1px solid var(--border-subtle)",
        cursor: "grab", userSelect: "none",
      }}
    >
      <GripVertical style={{ width: 10, height: 10, color: "var(--text-faint)", flexShrink: 0 }} />
      <span style={{
        fontSize: 9, fontFamily: "monospace", padding: "1px 5px",
        borderRadius: 3, background: ROLE_COLORS[role] || "var(--border-default)",
        color: "white", flexShrink: 0,
      }}>
        {ROLE_LABELS[role] || role}
      </span>
      <span style={{
        flex: 1, fontSize: 11, fontFamily: "monospace",
        color: "var(--text-primary)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", flexShrink: 0 }}>
        {kind}
      </span>
    </div>
  );
}

export function TemplatePill({ template, isEditing, editName, onEditNameChange, onStartEdit, onConfirmRename, onCancelEdit, onDelete }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "template",
        id: template.id,
        data: template,
        sourceType: "command-center",
      }),
    });
  }, [template]);

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 10px",
        borderRadius: 7,
        background: "var(--input-bg)",
        border: "1px solid var(--border-subtle)",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <GripVertical style={{ width: 11, height: 11, color: "var(--text-faint)", flexShrink: 0 }} />
      <BookMarked style={{ width: 11, height: 11, color: "rgb(251,191,36)", flexShrink: 0 }} />

      {isEditing ? (
        <input
          autoFocus
          value={editName}
          onChange={(e) => onEditNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirmRename();
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={onConfirmRename}
          style={{ ...inputStyle, flex: 1, height: 22, fontSize: 11 }}
        />
      ) : (
        <span style={{
          flex: 1, fontSize: 11, fontFamily: "monospace",
          color: "var(--text-primary)", minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {template.name || "Untitled"}
        </span>
      )}

      <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace", flexShrink: 0 }}>
        {template.items?.length || 0} items
      </span>

      {!isEditing && (
        <button
          onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
          title="Rename"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0, display: "inline-flex" }}
        >
          <Pencil style={{ width: 10, height: 10 }} />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete template"
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 0, display: "inline-flex", opacity: 0.6 }}
      >
        <Trash2 style={{ width: 10, height: 10 }} />
      </button>
    </div>
  );
}

// F5 — extend search beyond labels. Walks an occurrence's TipTap doc and
// flattens every text node into a single string for substring matching.
function extractTextmapText(textmap) {
  if (!textmap || typeof textmap !== "object") return "";
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(textmap);
  return parts.join(" ").toLowerCase();
}

// Flatten a single occurrence's field-values map into one searchable string.
function extractFieldsText(occ) {
  const fields = occ?.fields;
  if (!fields || typeof fields !== "object") return "";
  const parts = [];
  for (const v of Object.values(fields)) {
    const raw = v?.value;
    if (raw == null) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") parts.push(String(raw));
    else if (Array.isArray(raw)) parts.push(raw.filter(x => x != null).join(" "));
    else if (typeof raw === "object") parts.push(JSON.stringify(raw));
  }
  return parts.join(" ").toLowerCase();
}

export function ComponentsTab() {
  const ctx = useGridActions();
  const { state, socket, dispatch, modulesById, roleByModuleId, occurrencesById } = ctx;
  const gridId = state?.gridId;
  const grid = state?.grid;
  const templates = useMemo(() => grid?.templates || [], [grid?.templates]);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  // F5 — scope toggle. "all" (default) searches label + fields + content.
  // Individual scopes restrict to one surface.
  const [searchScope, setSearchScope] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const allModules = useMemo(() => Object.values(modulesById || {}), [modulesById]);

  // Index moduleId → [occurrences] once per occurrence-store change so the
  // search filter doesn't re-scan every occurrence on every keystroke.
  const occurrencesByModuleId = useMemo(() => {
    const map = {};
    const all = Object.values(occurrencesById || {});
    for (const occ of all) {
      const mid = occ?.moduleId || occ?.targetId;
      if (!mid) continue;
      (map[mid] = map[mid] || []).push(occ);
    }
    return map;
  }, [occurrencesById]);

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModules.filter(m => {
      const role = roleByModuleId?.[m.id] || m.role || "instance";
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (!q) return true;
      const label = (m.label || m.name || "").toLowerCase();
      const wantLabel = searchScope === "all" || searchScope === "label";
      const wantFields = searchScope === "all" || searchScope === "fields";
      const wantContent = searchScope === "all" || searchScope === "content";
      if (wantLabel && label.includes(q)) return true;
      if (wantFields || wantContent) {
        const occs = occurrencesByModuleId[m.id] || [];
        for (const occ of occs) {
          if (wantFields && extractFieldsText(occ).includes(q)) return true;
          if (wantContent && extractTextmapText(occ.textmap).includes(q)) return true;
        }
      }
      return false;
    }).sort((a, b) => {
      const roleOrder = { panel: 0, page: 1, container: 2, instance: 3 };
      const ra = roleByModuleId?.[a.id] || a.role || "instance";
      const rb = roleByModuleId?.[b.id] || b.role || "instance";
      const ro = (roleOrder[ra] ?? 3) - (roleOrder[rb] ?? 3);
      if (ro !== 0) return ro;
      const lc = (a.label || "").localeCompare(b.label || "");
      if (lc !== 0) return lc;
      return (a.id || "").localeCompare(b.id || "");
    });
  }, [allModules, search, searchScope, roleFilter, roleByModuleId, occurrencesByModuleId]);

  const commitTemplates = useCallback((updated) => {
    const gid = grid?._id?.toString() || grid?.id || gridId;
    CommitHelpers.updateGrid({ dispatch, socket, gridId: gid, grid: { ...grid, templates: updated }, emit: true });
  }, [grid, gridId, dispatch, socket]);

  const handleDelete = useCallback((templateId) => {
    commitTemplates(templates.filter(t => t.id !== templateId));
  }, [templates, commitTemplates]);

  const handleRename = useCallback((template) => {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed || trimmed === template.name) return;
    commitTemplates(templates.map(t => t.id === template.id ? { ...t, name: trimmed } : t));
  }, [templates, editName, commitTemplates]);

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Search + role filter */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search labels, fields, and content…"
          style={{ ...inputStyle, flex: 1, height: 26 }}
        />
        {["all", "panel", "page", "container", "instance"].map(r => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            style={{
              fontSize: 9, fontFamily: "monospace", padding: "2px 6px",
              borderRadius: 4, border: "1px solid var(--border-default)",
              background: roleFilter === r ? "var(--border-default)" : "transparent",
              color: roleFilter === r ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {r}
          </button>
        ))}
      </div>
      {/* F5 — search-scope toggle. Default "all" searches across label,
          field values, and textmap content. Individual scopes restrict. */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>
        <span>Search in:</span>
        {[
          { key: "all", label: "everything" },
          { key: "label", label: "labels" },
          { key: "fields", label: "field values" },
          { key: "content", label: "content" },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setSearchScope(s.key)}
            style={{
              fontSize: 9, fontFamily: "monospace", padding: "2px 6px",
              borderRadius: 4, border: "1px solid var(--border-default)",
              background: searchScope === s.key ? "var(--border-default)" : "transparent",
              color: searchScope === s.key ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Module list */}
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {filteredModules.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace", padding: "8px 0" }}>
            No modules found
          </div>
        )}
        {filteredModules.map(m => <ModulePill key={m.id} module={m} inferredRole={roleByModuleId?.[m.id]} />)}
      </div>

      {/* Templates section */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: 2 }}>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", marginBottom: 5 }}>
          Templates — drag onto a container to fill
        </div>
        {templates.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace" }}>
            No templates yet. Right-click a container → Save as Template.
          </div>
        )}
        {templates.map((template) => (
          <TemplatePill
            key={template.id}
            template={template}
            isEditing={editingId === template.id}
            editName={editName}
            onEditNameChange={setEditName}
            onStartEdit={() => { setEditingId(template.id); setEditName(template.name || ""); }}
            onConfirmRename={() => handleRename(template)}
            onCancelEdit={() => setEditingId(null)}
            onDelete={() => handleDelete(template.id)}
          />
        ))}
      </div>
    </div>
  );
}
