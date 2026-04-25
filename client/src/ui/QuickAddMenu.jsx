// ui/QuickAddMenu.jsx
// Dropdown menu for quickly adding existing modules to a panel or container.
// Panel mode: shows containers available to add
// Container mode: shows instances available to add
// Uses portal to prevent layout push on parent containers.

import { useState, useMemo, useContext, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";

const ROLE_COLORS = {
  panel: "rgba(59,130,246,0.7)",
  page: "rgba(6,182,212,0.7)",
  container: "rgba(34,197,94,0.7)",
  instance: "rgba(168,85,247,0.7)",
};

export default function QuickAddMenu({ targetRole, onSelect, onCreateNew, createLabel, onAddTextblock }) {
  const { modulesById, roleByModuleId } = useContext(GridActionsContext);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  // Position the portal dropdown below the button
  const handleOpen = useCallback((e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Clamp left so menu doesn't overflow viewport right edge
      const left = Math.min(rect.left, window.innerWidth - 208);
      setPos({ top: rect.bottom + 2, left: Math.max(0, left) });
    }
    setOpen(v => !v);
  }, [open]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("mousedown", handle); document.removeEventListener("keydown", handleKeyDown); };
  }, [open]);

  // Close on scroll (parent may reposition)
  useEffect(() => {
    if (!open) return;
    const handle = () => { setOpen(false); setSearch(""); };
    window.addEventListener("scroll", handle, true);
    return () => window.removeEventListener("scroll", handle, true);
  }, [open]);

  // Filter modules by target role
  const modules = useMemo(() => {
    const all = Object.values(modulesById || {});
    return all
      .filter(m => !m.trashed)
      .filter(m => {
        const role = roleByModuleId?.[m.id] || m.role || "instance";
        return role === targetRole;
      })
      .filter(m => {
        if (!search) return true;
        return (m.label || m.name || "").toLowerCase().includes(search.toLowerCase());
      })
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""))
      .slice(0, 20);
  }, [modulesById, roleByModuleId, targetRole, search]);

  const roleColor = ROLE_COLORS[targetRole] || ROLE_COLORS.instance;

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
            width: 200,
            maxHeight: 260,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            fontFamily: "var(--font-mono)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${targetRole}s…`}
            style={{
              background: "var(--input-bg)",
              border: "none",
              borderBottom: "1px solid var(--border-subtle)",
              padding: "6px 8px",
              fontSize: 11,
              color: "var(--text-primary)",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
          <div style={{ flex: 1, overflowY: "auto" }}>
            {onCreateNew && (
              <button
                onClick={() => { onCreateNew(); setOpen(false); setSearch(""); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 8px",
                  background: "none",
                  border: "none",
                  borderBottom: onAddTextblock ? "none" : "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  color: "var(--accent-blue, #60a5fa)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <Plus size={10} /> {createLabel || `New ${targetRole}`}
              </button>
            )}
            {onAddTextblock && (
              <button
                onClick={() => { onAddTextblock(); setOpen(false); setSearch(""); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 8px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  color: "var(--accent-blue, #60a5fa)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <Plus size={10} /> Textblock
              </button>
            )}
            {modules.length === 0 && (
              <div style={{ padding: "8px", fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>
                No {targetRole}s found
              </div>
            )}
            {modules.map(m => (
              <button
                key={m.id}
                onClick={() => {
                  onSelect(m);
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "4px 8px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--input-bg)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: roleColor, flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.label || m.name || "Untitled"}
                </span>
                {m.kind && m.kind !== "list" && (
                  <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>{m.kind}</span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
