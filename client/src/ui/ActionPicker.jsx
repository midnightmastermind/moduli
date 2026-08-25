// ui/ActionPicker.jsx
//
// Drilldown picker for operation pipeline action types. Reuses the visual
// language of DrilldownPicker (category tiles, breadcrumb, "Pick this"
// chevron) but walks a pure tree (`ACTION_TREE` from actionTree.js) rather
// than the DrilldownPicker's category+shape model — actions are a fixed
// tree, not a runtime-resolved shape descent.
//
// Spec: docket task #31 — "drilldown action picker (>2 levels). Merge
// 'value manipulation' as a category."

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { ACTION_TREE, findActionPath, findActionLeaf } from "./actionTree";

function Tile({ node, onBodyClick, onPickThis }) {
  const Icon = node.icon || null;
  const accent = node.color || "var(--text-muted)";
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  return (
    <div
      onClick={() => onBodyClick(node)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 8px", borderRadius: 5,
        background: "var(--input-bg)",
        border: "1px solid var(--border-subtle)",
        cursor: "pointer",
        minHeight: 38,
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = "var(--input-bg)"; }}
      onMouseOut={(e) => { e.currentTarget.style.background = "var(--input-bg)"; }}
    >
      {Icon ? (
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: accent, color: "var(--text-primary)", flexShrink: 0,
        }}>
          <Icon size={13} />
        </div>
      ) : (
        <div style={{ width: 22, height: 22, borderRadius: 4, background: accent, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)" }}>
            {node.title}
          </span>
          {node.sub ? (
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>
              {node.sub}
            </span>
          ) : null}
        </div>
        {node.description ? (
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1, lineHeight: 1.35 }}>
            {node.description}
          </div>
        ) : null}
      </div>
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPickThis(node); }}
          data-testid={`drill-${node.value}`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 4,
            background: "transparent", border: "1px solid var(--border-subtle)",
            color: "var(--text-faint)", cursor: "pointer", padding: 0,
          }}
          aria-label="Drill into category"
          title="Drill into category"
        >
          <ChevronRight size={12} />
        </button>
      ) : null}
    </div>
  );
}

export default function ActionPicker({ value, onChange, placeholder = "Pick action", tree = ACTION_TREE }) {
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState([]); // values of categories drilled into
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const dropRef = useRef(null);

  const openMenu = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const top = Math.min(r.bottom + 4, window.innerHeight - 440);
    const left = Math.min(r.left, window.innerWidth - 360);
    setPos({ top, left });
    setChain([]);
    setOpen(true);
  }, []);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Walk the chain to find the current level's nodes.
  const levelNodes = useMemo(() => {
    let cur = tree;
    for (const seg of chain) {
      const node = cur.find(n => n.value === seg);
      if (!node?.children) return [];
      cur = node.children;
    }
    return cur;
  }, [chain, tree]);

  // Breadcrumb labels for the chain.
  const breadcrumb = useMemo(() => {
    const out = [];
    let cur = tree;
    for (const seg of chain) {
      const node = cur.find(n => n.value === seg);
      if (!node) break;
      out.push(node.title);
      cur = node.children || [];
    }
    return out;
  }, [chain, tree]);

  const handleBodyClick = useCallback((node) => {
    if (node.children) {
      setChain(prev => [...prev, node.value]);
    } else {
      onChange?.(node.value);
      setOpen(false);
    }
  }, [onChange]);

  const handlePickThis = useCallback((node) => {
    // Pick-this on a category drills into it (a category itself is never a
    // legal action value).
    if (node.children) {
      setChain(prev => [...prev, node.value]);
    } else {
      onChange?.(node.value);
      setOpen(false);
    }
  }, [onChange]);

  const goBack = useCallback(() => setChain(prev => prev.slice(0, -1)), []);

  // Closed-state label rendering.
  const path = useMemo(() => findActionPath(value), [value]);
  const leaf = useMemo(() => findActionLeaf(value), [value]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "3px 6px", borderRadius: 4,
          background: "var(--input-bg)",
          border: "1px solid var(--input-border)",
          color: leaf ? "var(--text-primary)" : "var(--text-faint)",
          fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
          minWidth: 120,
        }}
      >
        {path && path.length > 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
            {path.map((p, i) => (
              <span key={p.value} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                {i > 0 ? <ChevronRight size={9} style={{ color: "var(--text-faint)" }} /> : null}
                <span style={{ color: i === path.length - 1 ? "var(--text-primary)" : "var(--text-faint)" }}>{p.title}</span>
              </span>
            ))}
          </span>
        ) : value ? (
          // Legacy / unrecognized action type — render the raw token so
          // the operation is still identifiable and pickable.
          <span style={{ color: "var(--text-muted)", fontStyle: "italic" }} title={`Unknown action: ${value}`}>
            {value}
          </span>
        ) : (
          <span>{placeholder}</span>
        )}
      </button>

      {open ? createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left,
            zIndex: 10000,
            width: 340, maxHeight: 420,
            background: "var(--surface-overlay)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            boxShadow: "var(--menu-shadow-2)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Breadcrumb header */}
          <div style={{
            padding: "6px 8px",
            background: "var(--input-bg)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex", alignItems: "center", gap: 6,
            minHeight: 28,
          }}>
            {chain.length > 0 ? (
              <button
                type="button"
                onClick={goBack}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, borderRadius: 3,
                  background: "transparent", border: "1px solid var(--border-subtle)",
                  color: "var(--text-muted)", cursor: "pointer", padding: 0,
                }}
                aria-label="Back"
                title="Back"
              >
                <ChevronLeft size={11} />
              </button>
            ) : null}
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>
              {breadcrumb.length > 0 ? `Action ▸ ${breadcrumb.join(" ▸ ")}` : "Pick an action category"}
            </span>
          </div>

          {/* Tiles */}
          <div style={{
            padding: 6,
            display: "flex", flexDirection: "column", gap: 4,
            overflowY: "auto",
          }}>
            {levelNodes.map(node => (
              <Tile
                key={node.value}
                node={node}
                onBodyClick={handleBodyClick}
                onPickThis={handlePickThis}
              />
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
