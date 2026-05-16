// ui/QuickAddMenu.jsx
// Dropdown menu for quickly adding existing modules to a panel or container.
// Panel mode: shows containers available to add
// Container mode: shows instances available to add
// Uses portal to prevent layout push on parent containers.

import { useState, useMemo, useContext, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, ChevronLeft, List, FileText, LayoutGrid, Image as ImageIcon, Box, FileQuestion } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import { templatesByKind } from "../helpers/templateHelpers";
import { commitApplyTemplate } from "../helpers/CommitHelpers";

const ROLE_COLORS = {
  panel: "rgba(59,130,246,0.7)",
  page: "rgba(6,182,212,0.7)",
  container: "rgba(34,197,94,0.7)",
  instance: "rgba(168,85,247,0.7)",
};

// Per-role category definitions: each kind shows up as a tile when at least
// one matching module exists. Lets the user pick "Documents" instead of
// scanning a flat list of mixed kinds.
const KIND_TILE = {
  list:     { label: "Lists",       icon: List,         desc: "Drag-sortable items" },
  doc:      { label: "Documents",   icon: FileText,     desc: "Rich-text editor with embedded pills" },
  board:    { label: "Boards",      icon: LayoutGrid,   desc: "Containers as columns (kanban)" },
  artifact: { label: "Artifacts",   icon: ImageIcon,    desc: "File-backed content (md / image / pdf)" },
  textblock:{ label: "Textblocks",  icon: FileQuestion, desc: "Inline rich-text snippets" },
};
const KIND_FALLBACK = { label: "Other", icon: Box, desc: "" };

// Which kinds are actually placeable in each role's add-menu. Containers
// surface a flat list of leaf-placeable instance kinds (instances + textblocks);
// they should not show "Documents" or "Boards" (those are container/page kinds).
// Panels surface container kinds. Pages surface panel kinds.
const ALLOWED_KINDS_BY_ROLE = {
  instance:  new Set(["list", "textblock", "artifact"]),
  container: new Set(["list", "doc", "board", "canvas"]),
  panel:     new Set(["board"]),
  page:      new Set(["board", "doc", "canvas", "folder"]),
};

export default function QuickAddMenu({ targetRole, onSelect, onCreateNew, createLabel, onAddTextblock, hostOccurrence = null }) {
  const { modulesById, roleByModuleId, socket, state, occurrencesById, manifestsById, foldersById } = useContext(GridActionsContext);
  const lookups = useMemo(
    () => ({ manifestsById, foldersById, occurrencesById, modulesById }),
    [manifestsById, foldersById, occurrencesById, modulesById]
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedKind, setPickedKind] = useState(null); // null = showing categories
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  // Position the portal dropdown below the button
  const handleOpen = useCallback((e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Clamp left so menu doesn't overflow viewport right edge
      const left = Math.min(rect.left, window.innerWidth - 248);
      setPos({ top: rect.bottom + 2, left: Math.max(0, left) });
    }
    if (open) setPickedKind(null);
    setOpen(v => !v);
  }, [open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setSearch("");
    setPickedKind(null);
  }, []);

  // Close on outside click or Escape
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

  // Close on scroll (parent may reposition)
  useEffect(() => {
    if (!open) return;
    const handle = () => { closeMenu(); };
    window.addEventListener("scroll", handle, true);
    return () => window.removeEventListener("scroll", handle, true);
  }, [open, closeMenu]);

  // All matching modules for this role (no kind filter yet — used for category buckets).
  // Skip kinds that aren't placeable in this role's context (e.g. doc-kind
  // instances are mini-blocks created by Editor's "Make mini block" — they
  // aren't meant to be re-placed via the container add menu).
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

  // Categories: one per kind that has at least one matching module.
  const categories = useMemo(() => {
    const buckets = new Map();
    for (const m of matchingModules) {
      const kind = m.kind || "list";
      if (!buckets.has(kind)) buckets.set(kind, []);
      buckets.get(kind).push(m);
    }
    return Array.from(buckets.entries()).map(([kind, mods]) => ({
      kind,
      ...((KIND_TILE[kind] || { ...KIND_FALLBACK, label: kind })),
      count: mods.length,
    }));
  }, [matchingModules]);

  const gridId = state?.grid?._id || state?.gridId;
  const allowedKinds = ALLOWED_KINDS_BY_ROLE[targetRole];
  const templateRows = useMemo(() => {
    if (!hostOccurrence || !gridId || !allowedKinds) return [];
    const rows = [];
    for (const k of allowedKinds) {
      for (const tpl of templatesByKind(lookups, gridId, k)) {
        rows.push(tpl);
      }
    }
    return rows;
  }, [lookups, gridId, allowedKinds, hostOccurrence]);

  // Modules filtered by picked kind + search.
  const filteredModules = useMemo(() => {
    return matchingModules
      .filter(m => !pickedKind || (m.kind || "list") === pickedKind)
      .filter(m => {
        if (!search) return true;
        return (m.label || m.name || "").toLowerCase().includes(search.toLowerCase());
      })
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""))
      .slice(0, 20);
  }, [matchingModules, pickedKind, search]);

  const roleColor = ROLE_COLORS[targetRole] || ROLE_COLORS.instance;
  // Skip the category step entirely when only one kind is present — no need
  // to make the user pick from a single-tile menu.
  const showCategories = !pickedKind && categories.length > 1;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={`Add ${targetRole}`}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-faint)",
          padding: "0 3px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.5,
          transition: "opacity 0.15s",
          height: 20,
          width: 20,
        }}
        className="quick-add-btn"
      >
        <Plus size={12} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 1100,
            background: "var(--body-bg, #1a1c1e)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            width: showCategories ? 240 : 220,
            maxHeight: 320,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            fontFamily: "var(--font-mono)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!showCategories && (
            <>
              {pickedKind && categories.length > 1 && (
                <button
                  onClick={() => { setPickedKind(null); setSearch(""); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "left" }}
                >
                  <ChevronLeft size={10} /> Categories
                </button>
              )}
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${pickedKind ? (KIND_TILE[pickedKind]?.label || pickedKind) : targetRole}s…`}
                style={{ background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "6px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)" }}
              />
            </>
          )}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {showCategories && (
              <>
                {categories.map(cat => {
                  const Icon = cat.icon || Box;
                  return (
                    <button
                      key={cat.kind}
                      onClick={() => setPickedKind(cat.kind)}
                      style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--input-bg)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    >
                      <span style={{ width: 24, height: 24, borderRadius: 5, background: roleColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={12} color="white" />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontWeight: 600 }}>{cat.label}</span>
                          <span style={{ fontSize: 9, color: "var(--text-faint)" }}>({cat.count})</span>
                        </span>
                        {cat.desc && <span style={{ display: "block", fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>{cat.desc}</span>}
                      </span>
                    </button>
                  );
                })}
                {onCreateNew && (
                  <button
                    onClick={() => { onCreateNew(); closeMenu(); }}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", borderTop: "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--input-bg)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                  >
                    <span style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(96,165,250,0.7)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Plus size={12} color="white" />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, color: "var(--accent-blue, #60a5fa)" }}>
                        {createLabel || `New ${targetRole}`}
                      </span>
                      <span style={{ display: "block", fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>
                        Create a new {targetRole} from scratch
                      </span>
                    </span>
                  </button>
                )}
                {onAddTextblock && (
                  <button
                    onClick={() => { onAddTextblock(); closeMenu(); }}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--input-bg)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                  >
                    <span style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(96,165,250,0.7)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <FileQuestion size={12} color="white" />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, color: "var(--accent-blue, #60a5fa)" }}>
                        New Textblock
                      </span>
                      <span style={{ display: "block", fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>
                        Inline rich-text snippet
                      </span>
                    </span>
                  </button>
                )}
              </>
            )}
            {!showCategories && (
              <>
                {onCreateNew && (
                  <button
                    onClick={() => { onCreateNew(); closeMenu(); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 8px", background: "none", border: "none", borderBottom: onAddTextblock ? "none" : "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--accent-blue, #60a5fa)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                  >
                    <Plus size={10} /> {createLabel || `New ${targetRole}`}
                  </button>
                )}
                {onAddTextblock && (
                  <button
                    onClick={() => { onAddTextblock(); closeMenu(); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 8px", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", color: "var(--accent-blue, #60a5fa)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                  >
                    <Plus size={10} /> Textblock
                  </button>
                )}
                {filteredModules.length === 0 && (
                  <div style={{ padding: "8px", fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>
                    No {pickedKind ? (KIND_TILE[pickedKind]?.label || pickedKind) : targetRole}s found
                  </div>
                )}
                {filteredModules.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { onSelect(m); closeMenu(); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "4px 8px", background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "left" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--input-bg)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: roleColor, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.label || m.name || "Untitled"}
                    </span>
                    {m.kind && m.kind !== "list" && (
                      <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>{m.kind}</span>
                    )}
                  </button>
                ))}
              </>
            )}
            {templateRows.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "6px 8px" }}>
                <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Templates
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {templateRows.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => {
                        commitApplyTemplate(socket, {
                          templateOccurrenceId: tpl.id,
                          targetOccurrenceId: hostOccurrence.id,
                          mode: "append",
                        });
                        closeMenu();
                      }}
                      style={{
                        fontSize: 11, padding: "3px 8px", borderRadius: 4,
                        border: "1px solid var(--border-default)",
                        background: "transparent", color: "var(--text-primary)", cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                      }}
                      title={`Apply template: ${tpl.meta?.templateName}`}
                    >
                      📋 {tpl.meta?.templateName || "(unnamed)"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
