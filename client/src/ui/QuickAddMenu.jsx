// ui/QuickAddMenu.jsx
// The "+" add-occurrence menu mounted on panel / container / page headers and
// the between-item insert-gaps. ONE unified screen (no drill level):
//   • a search bar that filters the EXISTING modules of this role
//   • a matches dropdown DIRECTLY UNDER the search (only while a query is typed —
//     so the menu isn't cluttered by every existing occurrence at rest)
//   • big module-type tiles that CREATE a new occurrence of that type instantly
//   • template chips (when the host has matching saved templates)
// Module-type icons come from helpers/moduleIcons.js so the tiles read the same
// as the CategoryPathPicker / value picker. Portal-rendered to avoid layout push.

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, ChevronLeft, Check, Search } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import { templatesByKind } from "../helpers/templateHelpers";
import { commitApplyTemplate } from "../helpers/CommitHelpers";
import { getModuleTypeBadge } from "../helpers/moduleIcons";

// Per-kind tile copy. The icon + color come from moduleIcons (getModuleTypeBadge);
// this only supplies the human label + one-line description.
const KIND_TILE = {
  instance:  { label: "Item",      desc: "Trackable item with fields" },
  board:     { label: "Board",     desc: "Containers as columns" },
  doc:       { label: "Document",  desc: "Rich-text editor" },
  canvas:    { label: "Canvas",    desc: "Free-form drawing surface" },
  table:     { label: "Table",     desc: "Spreadsheet grid" },
  folder:    { label: "Folder",    desc: "Card grid of child pages" },
  textblock: { label: "Textblock", desc: "Inline rich-text snippet" },
  artifact:  { label: "Artifact",  desc: "File-backed content" },
};

// Which kinds are placeable in each role's add-menu — used to filter the
// existing-matches list (instances are leaf items + textblocks + artifacts;
// containers carry board/doc/canvas/table; pages add folder).
export const ALLOWED_KINDS_BY_ROLE = {
  instance:  new Set(["board", "textblock", "artifact"]),
  container: new Set(["board", "doc", "canvas", "table"]),
  panel:     new Set(["board"]),
  page:      new Set(["board", "doc", "canvas", "table", "folder"]),
};

// Ordered list of CREATE tiles for a role. Containers/pages/panels map 1:1 to
// their creatable kinds; an instance creates a generic Item (+ a Textblock tile
// when the host wired onAddTextblock). Artifacts aren't blank-creatable (they're
// uploaded), so they never get a create tile — only a search match.
export function tileKindsForRole(targetRole) {
  // A container's "+" (targetRole "instance") can now create the full palette of
  // children: a leaf Item, a Textblock, nested containers (Board/Doc/Table/Canvas),
  // or an Artifact (file upload). The host routes each via createChildInContainer.
  if (targetRole === "instance") return ["instance", "textblock", "board", "doc", "table", "canvas", "artifact"];
  if (targetRole === "container") return ["board", "doc", "canvas", "table"];
  if (targetRole === "page") return ["board", "doc", "canvas", "table", "folder"];
  return ["board"]; // panel
}

export default function QuickAddMenu({ targetRole, onSelect, onCreateNew, createLabel, onAddTextblock, hostOccurrence = null, onOpenChange }) {
  const { modulesById, roleByModuleId, socket, state, occurrencesById, manifestsById, foldersById, fieldsById } = useGridActions();
  const lookups = useMemo(
    () => ({ manifestsById, foldersById, occurrencesById, modulesById }),
    [manifestsById, foldersById, occurrencesById, modulesById]
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // Field-picker sub-step (instance create): `null` = not picking; `[]` = open
  // with no fields chosen yet. Only opens for the instance Item tile when the
  // grid has at least one field.
  const [pickingFields, setPickingFields] = useState(null);
  const [fieldSearch, setFieldSearch] = useState("");
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const fileInputRef = useRef(null);

  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 268);
    setPos({ top: rect.bottom + 2, left: Math.max(0, left) });
  }, []);

  const handleOpen = useCallback((e) => {
    e.stopPropagation();
    if (!open) reposition();
    setOpen(v => !v);
  }, [open, reposition]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setSearch("");
    setPickingFields(null);
    setFieldSearch("");
  }, []);

  // Sorted, search-filtered field list for the picker.
  const fieldList = useMemo(() => {
    if (pickingFields == null) return [];
    const q = fieldSearch.trim().toLowerCase();
    return Object.values(fieldsById || {})
      .filter(f => !f.trashed)
      .filter(f => !q || (f.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [fieldsById, pickingFields, fieldSearch]);

  const toggleFieldPick = useCallback((fieldId) => {
    setPickingFields(prev => {
      if (!Array.isArray(prev)) return [fieldId];
      return prev.includes(fieldId) ? prev.filter(id => id !== fieldId) : [...prev, fieldId];
    });
  }, []);

  const confirmCreate = useCallback(() => {
    const fieldIds = Array.isArray(pickingFields) ? pickingFields : [];
    onCreateNew?.({ fieldIds });
    closeMenu();
  }, [pickingFields, onCreateNew, closeMenu]);

  // Tile click: create a new occurrence of `kind` immediately. Textblock routes
  // to its dedicated path; the instance Item tile opens the field-picker first
  // (when fields exist); container/page tiles pass the kind to onCreateNew.
  const createOfKind = useCallback((kind) => {
    // Artifact: open the OS file picker; the upload fires on file-select (onFilePicked).
    if (kind === "artifact") { fileInputRef.current?.click(); return; }
    if (kind === "textblock") {
      if (onAddTextblock) onAddTextblock();
      else onCreateNew?.({ fieldIds: [], kind: "textblock" });
      closeMenu();
      return;
    }
    if (targetRole === "instance" && (kind === "instance" || kind == null)) {
      const hasFields = Object.values(fieldsById || {}).some(f => !f.trashed);
      if (hasFields) { setPickingFields([]); return; }
      onCreateNew?.({ fieldIds: [], kind: "instance" });
      closeMenu();
      return;
    }
    onCreateNew?.({ fieldIds: [], kind });
    closeMenu();
  }, [targetRole, fieldsById, onCreateNew, onAddTextblock, closeMenu]);

  // Artifact tile → OS file picker → route the File through onCreateNew so the
  // host (createChildInContainer) uploads it into THIS container.
  const onFilePicked = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onCreateNew?.({ fieldIds: [], kind: "artifact", file });
    closeMenu();
  }, [onCreateNew, closeMenu]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) {
        closeMenu();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("mousedown", handle); document.removeEventListener("keydown", handleKeyDown); };
  }, [open, closeMenu]);

  // Keep the menu open on scroll — reposition to follow the anchor button.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  // All role-matching modules (existing-matches pool). Skip kinds that aren't
  // placeable in this role's context.
  const matchingModules = useMemo(() => {
    const allowedKinds = ALLOWED_KINDS_BY_ROLE[targetRole] || null;
    return Object.values(modulesById || {})
      .filter(m => !m.trashed)
      .filter(m => {
        const role = roleByModuleId?.[m.id] || m.role || "instance";
        if (role !== targetRole) return false;
        if (allowedKinds && m.kind && !allowedKinds.has(m.kind)) return false;
        return true;
      });
  }, [modulesById, roleByModuleId, targetRole]);

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matchingModules
      .filter(m => !q || (m.label || m.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""))
      .slice(0, 30);
  }, [matchingModules, search]);

  const tileKinds = useMemo(() => tileKindsForRole(targetRole), [targetRole]);

  const gridId = state?.grid?._id || state?.gridId;
  const allowedKinds = ALLOWED_KINDS_BY_ROLE[targetRole];
  const templateRows = useMemo(() => {
    if (!hostOccurrence || !gridId || !allowedKinds) return [];
    const rows = [];
    for (const k of allowedKinds) {
      for (const tpl of templatesByKind(lookups, gridId, k)) rows.push(tpl);
    }
    return rows;
  }, [lookups, gridId, allowedKinds, hostOccurrence]);

  const picking = pickingFields != null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={`Add ${targetRole}`}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-faint)", padding: "0 3px",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.5, transition: "opacity 0.15s", height: 20, width: 20,
        }}
        className="quick-add-btn"
      >
        <Plus size={12} />
      </button>
      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />

      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left, zIndex: 1100,
            background: "var(--body-bg, #1a1c1e)",
            border: "1px solid var(--border-default)", borderRadius: 6,
            width: 260, maxHeight: 360, overflow: "hidden",
            display: "flex", flexDirection: "column",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)", fontFamily: "var(--font-mono)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {picking ? (
            // ── Field-picker sub-step (instance create) ──────────────────────
            <>
              <button
                onClick={() => { setPickingFields(null); setFieldSearch(""); }}
                style={backBtnStyle}
              >
                <ChevronLeft size={10} /> Back
              </button>
              <div style={{ padding: "8px 10px 4px", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border-subtle)" }}>
                Pick fields to attach to the new {targetRole} ({pickingFields.length} selected)
              </div>
              <div style={{ position: "relative" }}>
                <Search size={10} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
                <input
                  autoFocus value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder="Search fields…"
                  style={{ background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "6px 8px 6px 22px", fontSize: 11, color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)", width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {fieldList.length === 0 && (
                  <div style={emptyStyle}>No fields found</div>
                )}
                {fieldList.map(f => {
                  const selected = pickingFields.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFieldPick(f.id)}
                      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 10px", background: selected ? "rgba(59,130,246,0.12)" : "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--input-bg)"; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "none"; }}
                    >
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${selected ? "rgba(59,130,246,0.8)" : "var(--border-default)"}`, background: selected ? "rgba(59,130,246,0.8)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {selected && <Check size={10} color="white" strokeWidth={3} />}
                      </span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name || "(unnamed)"}</span>
                      {f.type && <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>{f.type}</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid var(--border-subtle)", background: "var(--input-bg)" }}>
                <button onClick={() => { onCreateNew?.({ fieldIds: [] }); closeMenu(); }} style={{ flex: 1, padding: "5px 8px", background: "transparent", border: "1px solid var(--border-default)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>Skip</button>
                <button onClick={confirmCreate} style={{ flex: 1, padding: "5px 8px", background: "rgba(59,130,246,0.8)", border: "1px solid rgba(59,130,246,0.9)", borderRadius: 4, cursor: "pointer", color: "white", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600 }}>Create</button>
              </div>
            </>
          ) : (
            // ── Unified: search + type tiles + existing matches + templates ──
            <>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Search size={11} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
                <input
                  autoFocus value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${targetRole}s…`}
                  style={{ background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "7px 8px 7px 26px", fontSize: 11, color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)", width: "100%", boxSizing: "border-box" }}
                />
              </div>

              {/* Existing matches — dropdown directly under the search, only while searching */}
              {search.trim() && (
                <div style={{ maxHeight: 168, overflowY: "auto", borderBottom: "1px solid var(--border-subtle)", background: "var(--input-bg)" }}>
                  {filteredModules.map(m => {
                    const { Icon, color } = getModuleTypeBadge(m);
                    return (
                      <button
                        key={m.id}
                        onClick={() => { onSelect?.(m); closeMenu(); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px 9px", background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                      >
                        <Icon size={12} color={color} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label || m.name || "Untitled"}</span>
                        {m.kind && m.kind !== "board" && (
                          <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>{m.kind}</span>
                        )}
                      </button>
                    );
                  })}
                  {filteredModules.length === 0 && (
                    <div style={emptyStyle}>No {targetRole}s match “{search.trim()}”</div>
                  )}
                </div>
              )}

              {/* Type tiles — instant create */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px", borderBottom: "1px solid var(--border-subtle)" }}>
                {tileKinds.map(kind => {
                  const tileRole = kind === "instance" ? "instance"
                    : kind === "textblock" ? "textblock"
                    : kind === "artifact" ? "artifact"
                    : "container";
                  const { Icon, color } = getModuleTypeBadge({ role: tileRole, kind: ["instance", "textblock", "artifact"].includes(kind) ? undefined : kind });
                  const meta = KIND_TILE[kind] || { label: kind, desc: "" };
                  return (
                    <button
                      key={kind}
                      onClick={() => createOfKind(kind)}
                      title={meta.desc}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                        width: 72, height: 58, padding: "6px 4px",
                        background: "var(--input-bg)", border: "1px solid var(--border-subtle)", borderRadius: 6,
                        cursor: "pointer", color: "var(--text-primary)", fontFamily: "var(--font-mono)",
                        transition: "border-color 0.12s, background 0.12s, box-shadow 0.12s, transform 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.28)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.background = "var(--input-bg)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
                    >
                      <span style={{ width: 26, height: 26, borderRadius: 6, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={14} color="white" />
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1 }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Templates */}
              {templateRows.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "6px 8px", flexShrink: 0 }}>
                  <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Templates</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {templateRows.map(tpl => (
                      <button
                        key={tpl.id}
                        onClick={() => {
                          commitApplyTemplate(socket, { templateOccurrenceId: tpl.id, targetOccurrenceId: hostOccurrence.id, mode: "append" });
                          closeMenu();
                        }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-mono)" }}
                        title={`Apply template: ${tpl.meta?.templateName}`}
                      >
                        📋 {tpl.meta?.templateName || "(unnamed)"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

const backBtnStyle = { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "left" };
const emptyStyle = { padding: "8px", fontSize: 10, color: "var(--text-faint)", textAlign: "center" };
