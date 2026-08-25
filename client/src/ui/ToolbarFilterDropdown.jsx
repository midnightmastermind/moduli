// client/src/ui/ToolbarFilterDropdown.jsx
// Small popover on the Toolbar for per-filter "show nav here" toggles.
// Persists toggle state to grid.toolbarNavFilters: [filterId, ...].

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import HeaderChevron from "./HeaderChevron.jsx";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";

function Switch({ checked, onChange, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      style={{
        width: 26, height: 14, padding: 0,
        border: "1px solid var(--border-default, #374151)",
        borderRadius: 999,
        background: checked ? "var(--accent-blue, #14b8a6)" : "transparent",
        position: "relative", cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 1, left: checked ? 13 : 1,
        width: 10, height: 10, borderRadius: "50%",
        background: checked ? "var(--on-accent)" : "var(--text-muted)",
        transition: "left 0.12s",
      }} />
    </button>
  );
}

export default function ToolbarFilterDropdown() {
  const ctx = useGridActions();
  const { socket, dispatch, state, fieldsById, onSelectFilter } = ctx;
  const grid = state?.grid;
  const filters = grid?.namedFilters || [];
  const toolbarNavFilters = grid?.toolbarNavFilters || [];

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const openMenu = (e) => {
    setAnchor(e.currentTarget.getBoundingClientRect());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const setToolbarNav = (filterId, on) => {
    const next = on
      ? Array.from(new Set([...toolbarNavFilters, filterId]))
      : toolbarNavFilters.filter(id => id !== filterId);
    CommitHelpers.updateGrid({
      dispatch, socket,
      gridId: grid?._id,
      grid: { toolbarNavFilters: next },
      emit: true,
    });
  };

  const setActive = (filterId) => {
    onSelectFilter?.(filterId);
  };

  return (
    <>
      {/* Same trigger the container / page / panel headers use — the toolbar
          funnel now reads identically to the one on every page. It carries no
          occurrence (the toolbar's scope is the GRID), so it renders the
          neutral state rather than a per-occurrence active/deactivated tint. */}
      <span ref={btnRef} style={{ display: "inline-flex", alignItems: "center" }}>
        <HeaderChevron onClick={openMenu} isOpen={open} />
      </span>

      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="dialog"
          style={{
            position: "fixed", top: anchor.bottom + 4, left: anchor.left,
            zIndex: 1100, minWidth: 280, maxWidth: 340,
            background: "var(--panel-bg, #1f2937)",
            // `--panel-fg` WAS NEVER DEFINED — not in index.css, not in the skin
            // registry, nowhere. So this always fell through to its hardcoded
            // fallback, a near-white grey: correct on a dark theme by accident,
            // and invisible on the three light skins. Measured on prod with the
            // menu open under Stardew, every inheriting row painted that near-white
            // on a cream surface. `--text-primary` is defined by every theme and
            // resolves to 12.31:1 there.
            color: "var(--text-primary)",
            border: "1px solid var(--panel-border, #374151)",
            borderRadius: 8, padding: 12,
            boxShadow: "var(--menu-shadow-2)",
            fontFamily: "var(--font-mono)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
            Filters
          </div>
          {filters.length === 0 && (
            <div style={{ fontSize: 11, opacity: 0.5 }}>No grid filters defined.</div>
          )}
          {filters.map(f => {
            const isActive = f.id === grid?.activeFilterId;
            const inToolbar = toolbarNavFilters.includes(f.id);
            const navCondition = (f.conditions || []).find(c => c?.isNav && c.fieldId);
            const fid = navCondition?.fieldId || f.primaryDateFieldId;
            const fname = fid ? (fieldsById?.[fid]?.name || fieldsById?.[fid]?.label) : null;
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderTop: "1px solid var(--panel-border, #374151)" }}>
                <button
                  type="button"
                  onClick={() => setActive(f.id)}
                  title={isActive ? "Active" : "Activate filter"}
                  style={{
                    width: 10, height: 10, borderRadius: "50%",
                    border: "1px solid var(--border-default, #374151)",
                    background: isActive ? "var(--accent-blue, #14b8a6)" : "transparent",
                    cursor: "pointer", padding: 0, flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 11, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong>{fname || f.name || "(unnamed)"}</strong>
                </span>
                <span style={{ fontSize: 9, opacity: 0.55 }}>nav here</span>
                <Switch checked={inToolbar} onChange={(v) => setToolbarNav(f.id, v)} title="Show nav widget in toolbar" />
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
