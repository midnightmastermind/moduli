// ui/commandCenter/FieldsTab.jsx
// FieldsTab + FieldPill + FieldDetail

import React, { useState, useMemo, useContext, useEffect, useRef } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Plus, FolderPlus, ChevronLeft, GripVertical, Trash2 } from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import { uid } from "../../uid";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import SelectOptionsSourceEditor from "./SelectOptionsSourceEditor";

// Shared style helpers
const labelStyle = {
  fontSize: 10,
  color: "var(--text-muted)",
  fontFamily: "monospace",
  display: "block",
  marginBottom: 3,
};

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
// FIELD PILL (draggable — drag to instance to add field binding)
// ============================================================
export function FieldPill({ field, selected, onClick, compact = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "field",
        id: field.id,
        data: field,
        sourceType: "command-center",
      }),
    });
  }, [field]);

  const isInput = field.inputEnabled !== false;
  const isOccurrence = field.type === "occurrence";
  const base = isOccurrence ? "6,182,212" : isInput ? "59,130,246" : "168,85,247"; // cyan / blue / purple
  const textColor = isOccurrence ? "rgb(103,232,249)" : isInput ? "rgb(147,197,253)" : "rgb(216,180,254)";
  const dotColor = isOccurrence ? "rgb(34,211,238)" : isInput ? "rgb(96,165,250)" : "rgb(192,132,252)";

  if (compact) {
    // Compact list-item style for category columns
    return (
      <div
        ref={ref}
        onClick={onClick}
        title={`${field.name} (${field.type}) — drag to add to an instance or drop on column to recategorize`}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 7px", borderRadius: 4, cursor: "grab",
          background: selected ? `rgba(${base}, 0.22)` : "var(--input-bg)",
          border: `1px solid ${selected ? `rgba(${base}, 0.5)` : "var(--border-subtle)"}`,
          fontSize: 11, fontFamily: "monospace", userSelect: "none",
          transition: "all 0.1s",
        }}
      >
        <GripVertical style={{ width: 8, height: 8, opacity: 0.3, flexShrink: 0 }} />
        <span style={{ color: textColor, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.name || field.type}
        </span>
        <span style={{ opacity: 0.3, fontSize: 9 }}>{field.type}</span>
      </div>
    );
  }

  return (
    <button
      ref={ref}
      onClick={onClick}
      title={`${field.name} (${field.type}) — drag to add to an instance`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px 3px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: "monospace",
        cursor: "grab",
        transition: "all 0.15s",
        userSelect: "none",
        background: selected
          ? `rgba(${base}, 0.35)`
          : `rgba(${base}, 0.12)`,
        border: `1px solid rgba(${base}, ${selected ? 0.7 : 0.28})`,
        color: textColor,
        outline: "none",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <span>{field.name || field.type}</span>
      <span style={{ opacity: 0.42, fontSize: 10 }}>{field.type}</span>
    </button>
  );
}

// ============================================================
// FIELD DETAIL (native inputs for dark-panel aesthetic)
// ============================================================
export function FieldDetail({ field, onSave, onDelete, categoryFolders = [] }) {
  const { modulesById, roleByModuleId } = useContext(GridActionsContext);
  const [local, setLocal] = useState(field);
  useMemo(() => setLocal(field), [field.id]);

  const setMeta = (key, val) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), [key]: val } }));

  // Find all instances that bind this field
  const usedInModules = useMemo(
    () => Object.values(modulesById || {}).filter(
      m => (roleByModuleId?.[m.id] || m.role || "instance") === "instance" && (m.fieldBindings || []).some(b => b.fieldId === field.id)
    ),
    [modulesById, field.id]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Row 1: Name + Type */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 120px" }}>
          <span style={labelStyle}>Name</span>
          <input
            value={local.name || ""}
            onChange={(e) => setLocal((p) => ({ ...p, name: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <span style={labelStyle}>Type</span>
          <select
            value={local.type}
            onChange={(e) => setLocal((p) => ({ ...p, type: e.target.value }))}
            style={{ ...inputStyle, width: "auto", minWidth: 90 }}
          >
            {["number", "text", "boolean", "select", "date", "rating", "duration", "occurrence"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {(local.type === "number" || local.type === "duration") && (
          <div style={{ flex: "0 0 70px" }}>
            <span style={labelStyle}>Unit</span>
            <input
              value={local.unit || ""}
              onChange={(e) => setLocal(p => ({ ...p, unit: e.target.value }))}
              style={{ ...inputStyle, width: 70 }}
              placeholder="e.g. kg"
            />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Enabled</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", paddingTop: 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={local.inputEnabled !== false}
                onChange={(e) => setLocal((p) => ({ ...p, inputEnabled: e.target.checked }))}
              />
              Input
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={local.displayEnabled === true}
                onChange={(e) => setLocal((p) => ({ ...p, displayEnabled: e.target.checked }))}
              />
              Display
            </label>
          </div>
        </div>
      </div>

      {/* Display config — target value + period for displayEnabled fields. Operations
          publish a value via UPDATE $display.<fieldId>.<itemId>; the target lives on
          the field's displayConfig and is the basis for the progress bar. */}
      {local.displayEnabled === true && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Target</span>
            <input
              type="number"
              value={local.displayConfig?.targetValue ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "" ? null : Number(raw);
                setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), targetValue: Number.isNaN(v) ? null : v } }));
              }}
              placeholder="e.g. 64"
              style={{ ...inputStyle, width: 90 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Period</span>
            <select
              value={local.displayConfig?.targetPeriod || "daily"}
              onChange={(e) => setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), targetPeriod: e.target.value } }))}
              style={{ ...inputStyle, width: "auto", minWidth: 100 }}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Arrows</span>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer", paddingTop: 2 }}>
              <input
                type="checkbox"
                checked={local.displayConfig?.showArrows === true}
                onChange={(e) => setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), showArrows: e.target.checked } }))}
              />
              show
            </label>
          </div>
        </div>
      )}

      {/* Category */}
      {categoryFolders.length > 0 && (
        <div>
          <span style={labelStyle}>Category</span>
          <select
            value={local.folderId || ""}
            onChange={(e) => setLocal((p) => ({ ...p, folderId: e.target.value || null }))}
            style={{ ...inputStyle, width: "auto", minWidth: 120 }}
          >
            <option value="">Uncategorized</option>
            {categoryFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Options source editor — select and occurrence fields */}
      {["select", "occurrence"].includes(local.type) && (
        <div>
          <span style={labelStyle}>Options source</span>
          <SelectOptionsSourceEditor
            source={local.meta?.optionsSource || { mode: "manual", values: [] }}
            onChange={(next) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), optionsSource: next } }))}
          />
        </div>
      )}

      {/* Used In — reverse lookup of all instances binding this field */}
      <div>
        <span style={labelStyle}>
          Used in {usedInModules.length > 0 ? `(${usedInModules.length})` : "— not bound to any instance"}
        </span>
        {usedInModules.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {usedInModules.map(m => (
              <span
                key={m.id}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  padding: "2px 8px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
                  background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)",
                  color: "rgb(216,180,254)",
                }}
                title={`Role: ${roleByModuleId?.[m.id] || m.role || "instance"} — id: ${m.id}`}
              >
                {m.label || m.id}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onSave(local)}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
            color: "var(--accent-blue-text)", cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
            color: "var(--danger-text)", cursor: "pointer",
          }}
        >
          <Trash2 style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================
// FIELDS TAB — pills in a wrapping flex row
// ============================================================
export function FieldsTab() {
  const ctx = useContext(GridActionsContext);
  const { state, fieldsById, foldersById, socket, dispatch } = ctx;
  const gridId = state?.gridId;

  const gridFields = useMemo(
    () => (state?.fields || []).filter((f) => f.gridId === gridId),
    [state?.fields, gridId]
  );

  // Folders with folderType "category" for this grid
  const categoryFolders = useMemo(
    () => Object.values(foldersById || {})
      .filter((f) => f.gridId === gridId && f.folderType === "category")
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [foldersById, gridId]
  );

  // Group fields by folderId
  const fieldsByFolder = useMemo(() => {
    const groups = { uncategorized: [] };
    for (const f of categoryFolders) groups[f.id] = [];
    for (const field of gridFields) {
      const key = field.folderId && groups[field.folderId] !== undefined ? field.folderId : "uncategorized";
      groups[key].push(field);
    }
    return groups;
  }, [gridFields, categoryFolders]);

  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const selectedField = selectedFieldId ? fieldsById?.[selectedFieldId] : null;
  const [dragFieldId, setDragFieldId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  // Track Pragmatic DnD field drags so column HTML5 onDrop can read the dragged field
  useEffect(() => {
    return monitorForElements({
      onDragStart({ source }) {
        if (source.data?.type === "field") setDragFieldId(source.data.id);
      },
      onDrop() { setDragFieldId(null); setOverColumn(null); },
    });
  }, []);

  const handleCreate = (folderId = null) => {
    const newField = { id: uid(), gridId, name: "New Field", type: "number", inputEnabled: true, displayEnabled: false, folderId, meta: {} };
    CommitHelpers.createField({ dispatch, socket, field: newField });
    setSelectedFieldId(newField.id);
  };

  const handleCreateCategory = () => {
    const folder = { id: uid(), gridId, name: "New Category", folderType: "category", sortOrder: categoryFolders.length, isExpanded: true };
    CommitHelpers.createFolder({ dispatch, socket, folder });
  };

  const handleDropOnFolder = (folderId) => {
    if (!dragFieldId) return;
    const field = fieldsById?.[dragFieldId];
    if (field) CommitHelpers.updateField({ dispatch, socket, field: { ...field, folderId: folderId || null } });
    setDragFieldId(null);
    setOverColumn(null);
  };

  const toggleSelect = (fieldId) =>
    setSelectedFieldId((prev) => (prev === fieldId ? null : fieldId));

  const colBase = {
    minWidth: 140,
    flex: "0 0 auto",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    transition: "background 0.15s, border-color 0.15s",
  };

  const colStyle = (isOver) => ({
    ...colBase,
    border: `1px solid ${isOver ? "var(--accent-blue-border)" : "var(--border-subtle)"}`,
    background: isOver ? "var(--accent-blue-bg)" : "var(--input-bg)",
  });

  const addBtnStyle = {
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 7px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
    background: "none", border: "1px dashed var(--border-default)",
    color: "var(--text-faint)", cursor: "pointer", alignSelf: "flex-start",
  };

  const renderCategoryColumn = (colKey, label, fields, folderObj) => (
    <div
      key={colKey}
      style={colStyle(overColumn === colKey)}
      onDragOver={(e) => { e.preventDefault(); setOverColumn(colKey); }}
      onDragLeave={() => setOverColumn(null)}
      onDrop={(e) => { e.preventDefault(); handleDropOnFolder(colKey === "uncategorized" ? null : colKey); }}
    >
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        {folderObj ? (
          <input
            defaultValue={label}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== label) CommitHelpers.updateFolder({ dispatch, socket, folder: { ...folderObj, name: newName } });
            }}
            style={{ background: "none", border: "none", outline: "none", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", width: "100%", cursor: "text" }}
          />
        ) : (
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>{label}</span>
        )}
      </div>

      {/* Field chips — scrollable list, draggable to instance OR between columns */}
      <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {fields.map((field) => (
          <FieldPill
            key={field.id}
            field={field}
            compact
            selected={selectedFieldId === field.id}
            onClick={() => toggleSelect(field.id)}
          />
        ))}
        {fields.length === 0 && (
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", fontStyle: "italic" }}>
            drag fields here
          </span>
        )}
      </div>

      {/* + Field button */}
      <button style={addBtnStyle} onClick={() => handleCreate(colKey === "uncategorized" ? null : colKey)}>
        <Plus style={{ width: 8, height: 8 }} /> Field
      </button>
    </div>
  );

  // Drill-down: if a field is selected, show editor full-pane with back button
  if (selectedField) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Back bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)", position: "sticky", top: 0, zIndex: 2 }}>
          <button
            onClick={() => setSelectedFieldId(null)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <ChevronLeft style={{ width: 11, height: 11 }} /> Fields
          </button>
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>{selectedField.name}</span>
        </div>
        {/* Editor content */}
        <div style={{ padding: "10px 14px" }}>
          <FieldDetail
            field={selectedField}
            categoryFolders={categoryFolders}
            onSave={(updated) => CommitHelpers.updateField({ dispatch, socket, field: updated })}
            onDelete={() => {
              CommitHelpers.deleteField({ dispatch, socket, fieldId: selectedFieldId });
              setSelectedFieldId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={handleCreateCategory}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px dashed var(--border-default)", color: "var(--text-muted)", cursor: "pointer" }}
        >
          <FolderPlus style={{ width: 10, height: 10 }} /> Category
        </button>
      </div>

      {/* Category columns */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
        {renderCategoryColumn("uncategorized", "Uncategorized", fieldsByFolder.uncategorized, null)}
        {categoryFolders.map((folder) =>
          renderCategoryColumn(folder.id, folder.name, fieldsByFolder[folder.id] || [], folder)
        )}
      </div>
    </div>
  );
}
