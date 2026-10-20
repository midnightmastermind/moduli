// ui/FieldAddMenu.jsx
// ============================================================
// The menu behind an occurrence's hover "+": choose a field to show on this
// row, or create a new one — user 2026-10-20: *"a field creation menu there
// exactly like the command center one. choose a fields or create a new one"*.
//
// So it is built from the Command Center's own parts: the fields are listed in
// the Fields tab's CATEGORY groups (helpers/fieldCategories, the same grouping
// the tab draws as columns), each group has its own "+ Field", and creating one
// drills into the tab's own `FieldDetail` editor with a back button — the
// Fields tab's drill-down, in a popover.
//
// What a pick writes is a BINDING on the row's MODULE (the same write
// Settings › Fields makes), so every placement of that module shows it. A field
// already bound but hidden is SHOWN (`appendFieldBinding`). Creating a field
// binds it in the same undo step.
//
// Lazy-loaded by ModuleInstance: `FieldDetail` lives in the Command Center's
// chunk and nothing on a row needs it until the "+" is pressed.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, ChevronLeft, Search, Eye } from "lucide-react";
import MenuSurface, { isDrawerLayout } from "./MenuSurface";
import { FieldDetail } from "./commandCenter/FieldsTab";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { withAction } from "../helpers/actionScope";
import { uid } from "../uid";
import { clickedInsidePortalLayer } from "../helpers/outsideClick";
import {
  fieldCategoryFolders, groupFieldsByCategory, uniqueFieldName, appendFieldBinding,
} from "../helpers/fieldCategories";

const LIST_W = 300;
const EDIT_W = 440;
const MAX_H = 460;

/** Desktop placement: under the anchor, flipped above when it would run off the bottom. */
export function fieldMenuPosition(rect, width, vw, vh) {
  if (!rect) return null;
  const left = Math.max(8, Math.min(rect.right - width, vw - width - 8));
  const below = rect.bottom + 4;
  const top = below + MAX_H > vh ? Math.max(8, rect.top - 4 - MAX_H) : below;
  return { top, left };
}

export default function FieldAddMenu({ module, anchorRect, onClose }) {
  const { state, fieldsById, foldersById, operationsById, dispatch, socket } = useGridActions();
  const gridId = state?.gridId;
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const surfaceRef = useRef(null);

  const bindings = useMemo(
    () => (Array.isArray(module?.fieldBindings) ? module.fieldBindings : []),
    [module]
  );
  const bindingOf = useMemo(() => {
    const m = new Map();
    for (const b of bindings) if (b?.fieldId) m.set(b.fieldId, b);
    return m;
  }, [bindings]);

  const gridFields = useMemo(
    () => (state?.fields || []).filter((f) => f && f.gridId === gridId && !f.trashed),
    [state?.fields, gridId]
  );
  const categoryFolders = useMemo(
    () => fieldCategoryFolders({ foldersById, fieldsById, operationsById, gridId }),
    [foldersById, fieldsById, operationsById, gridId]
  );
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? gridFields.filter((f) => (f.name || "").toLowerCase().includes(q)) : gridFields;
    const byFolder = groupFieldsByCategory(shown, categoryFolders);
    const out = [{ key: "uncategorized", label: "Uncategorized", folderId: null, fields: byFolder.uncategorized }];
    for (const folder of categoryFolders) {
      out.push({ key: folder.id, label: folder.name || "Category", folderId: folder.id, fields: byFolder[folder.id] || [] });
    }
    // While searching, an empty group is noise; at rest it still offers its "+ Field".
    return q ? out.filter((g) => g.fields.length > 0) : out;
  }, [gridFields, categoryFolders, query]);

  const writeBindings = useCallback((next) => {
    CommitHelpers.updateModule({ dispatch, socket, module: { id: module.id, fieldBindings: next }, emit: true });
  }, [dispatch, socket, module?.id]);

  const pick = useCallback((fieldId) => {
    const next = appendFieldBinding(bindings, fieldId);
    if (!next) return;
    withAction("Added field", () => writeBindings(next));
    onClose?.();
  }, [bindings, writeBindings, onClose]);

  const create = useCallback((folderId, name) => {
    if (!module?.id || !gridId) return;
    const field = {
      id: uid(), gridId,
      name: (name || "").trim() || uniqueFieldName(fieldsById),
      type: "number", inputEnabled: true, displayEnabled: false, folderId, meta: {},
    };
    withAction("Added field", () => {
      CommitHelpers.createField({ dispatch, socket, field });
      const next = appendFieldBinding(bindings, field.id);
      if (next) writeBindings(next);
    });
    setEditingId(field.id);
  }, [module?.id, gridId, fieldsById, dispatch, socket, bindings, writeBindings]);

  // Close on a click outside (a portalled picker inside FieldDetail is not outside),
  // Escape steps back from the editor first.
  useEffect(() => {
    const onDown = (e) => {
      if (clickedInsidePortalLayer(e.target)) return;
      if (surfaceRef.current && !surfaceRef.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (editingId) setEditingId(null); else onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [editingId, onClose]);

  const editing = editingId ? fieldsById?.[editingId] : null;
  const width = editing ? EDIT_W : LIST_W;
  const position = typeof window !== "undefined"
    ? fieldMenuPosition(anchorRect, width, window.innerWidth, window.innerHeight)
    : null;
  const exactMatch = gridFields.some((f) => (f.name || "").trim().toLowerCase() === query.trim().toLowerCase());

  return (
    <MenuSurface
      surfaceRef={surfaceRef}
      position={position}
      zIndex={1320}
      onClose={onClose}
      className="field-add-menu"
      style={{
        width, maxHeight: MAX_H, overflowY: "auto",
        background: "var(--surface-card)", border: "1px solid var(--border-default)",
        borderRadius: 8, boxShadow: "0 8px 28px var(--menu-shadow-color, rgba(0,0,0,0.5))",
        color: "var(--text-primary)", fontSize: 13,
      }}
    >
      <div role="dialog" aria-label={editing ? `Edit field ${editing.name}` : "Add a field"}>
        {editing ? (
          <>
            <div style={headerSt}>
              <button type="button" style={backBtnSt} onClick={() => setEditingId(null)} aria-label="Back to fields">
                <ChevronLeft style={{ width: 12, height: 12 }} /> Fields
              </button>
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{editing.name}</span>
            </div>
            <div style={{ padding: "8px 10px" }}>
              <FieldDetail
                field={editing}
                categoryFolders={categoryFolders}
                onSave={(updated) => { CommitHelpers.updateField({ dispatch, socket, field: updated }); setEditingId(null); }}
                onDelete={() => { CommitHelpers.deleteField({ dispatch, socket, fieldId: editing.id }); setEditingId(null); }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={headerSt}>
              <span style={{ fontWeight: 600 }}>Add a field</span>
            </div>
            <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 6 }}>
              <Search style={{ width: 13, height: 13, color: "var(--text-faint)", flex: "0 0 auto" }} />
              <input
                // Not on a phone: focusing raises the keyboard over half the drawer before you have looked.
                autoFocus={!isDrawerLayout()}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fields…"
                aria-label="Search fields"
                style={searchSt}
              />
            </div>
            {query.trim() && !exactMatch && (
              <button type="button" style={createRowSt} onClick={() => create(null, query)}>
                <Plus style={{ width: 12, height: 12 }} /> Create "{query.trim()}"
              </button>
            )}
            {groups.map((g) => (
              <div key={g.key} style={{ padding: "4px 0" }}>
                <div style={groupHeadSt}>
                  <span>{g.label}</span>
                  <button
                    type="button"
                    style={groupAddSt}
                    onClick={() => create(g.folderId)}
                    aria-label={`New field in ${g.label}`}
                    title={`New field in ${g.label}`}
                  >
                    <Plus style={{ width: 10, height: 10 }} /> Field
                  </button>
                </div>
                {g.fields.map((f) => {
                  const b = bindingOf.get(f.id);
                  const showing = b && !b.hidden;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      data-field-id={f.id}
                      disabled={showing}
                      onClick={() => pick(f.id)}
                      style={{ ...fieldRowSt, opacity: showing ? 0.45 : 1, cursor: showing ? "default" : "pointer" }}
                      title={showing ? "Already on this row" : b ? "Bound but hidden — show it" : `Add ${f.name}`}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name || "(unnamed)"}</span>
                      {b && b.hidden && <Eye style={{ width: 11, height: 11, color: "var(--text-faint)" }} />}
                      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{showing ? "on" : f.type}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div style={{ padding: "8px 12px", color: "var(--text-faint)", fontSize: 12 }}>No fields match.</div>
            )}
          </>
        )}
      </div>
    </MenuSurface>
  );
}

const headerSt = {
  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
  borderBottom: "1px solid var(--border-subtle)", position: "sticky", top: 0,
  background: "var(--surface-card)", zIndex: 1,
};
const backBtnSt = {
  display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 5,
  fontSize: 12, background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-muted)", cursor: "pointer",
};
const searchSt = {
  flex: 1, minWidth: 0, fontSize: 13, padding: "4px 6px", borderRadius: 5,
  background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-primary)",
};
const groupHeadSt = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "2px 12px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4,
};
const groupAddSt = {
  display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 6px", borderRadius: 4,
  fontSize: 11, background: "none", border: "1px dashed var(--border-default)",
  color: "var(--text-faint)", cursor: "pointer", textTransform: "none", letterSpacing: 0,
};
const fieldRowSt = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  padding: "5px 12px 5px 20px", background: "none", border: "none", color: "var(--text-primary)", fontSize: 13,
};
const createRowSt = {
  ...fieldRowSt, padding: "6px 12px", color: "var(--accent-blue-text, var(--text-primary))", cursor: "pointer",
};
