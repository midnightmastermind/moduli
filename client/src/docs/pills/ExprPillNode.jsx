// docs/pills/ExprPillNode.jsx
// ============================================================
// Renders an expression pill in TipTap docs.
// Formula: field names + arithmetic operators (+ - * / ( ))
// Field names resolved against computedValues + fieldsById
// ============================================================

import { useMemo, useState, useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import { useComputedValuesMap } from "../../state/computedValuesStore";
import { Trash2, Settings } from "lucide-react";
import RadialMenu from "../../ui/RadialMenu";

const PILL = {
  display: "inline-flex", alignItems: "center", gap: 3,
  padding: "2px 6px", borderRadius: 999,
  border: "1px solid rgba(250,204,21,0.25)",
  background: "rgba(250,204,21,0.08)",
  fontSize: 10, fontFamily: "var(--font-mono)",
  color: "rgba(250,204,21,0.85)", flexShrink: 0,
  cursor: "default", userSelect: "none",
  transition: "border-color 0.15s, background 0.15s",
};
const PILL_HOV = {
  ...PILL,
  border: "1px solid rgba(250,204,21,0.45)",
  background: "rgba(250,204,21,0.14)",
};

/** Safely evaluate expr: replaces field names with numeric values, then evals only math. */
function evalExpr(expr, valueMap) {
  if (!expr) return null;

  // Replace field name tokens with their numeric values
  let resolved = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
    const v = valueMap[name];
    if (v == null) return "0";
    const n = parseFloat(v);
    return isNaN(n) ? "0" : String(n);
  });

  // Whitelist check: only numbers, operators, parens, spaces, dots allowed
  if (!/^[\d\s+\-*/().]+$/.test(resolved)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${resolved});`)();
    if (!isFinite(result)) return null;
    // Round to 2 decimal places
    return Math.round(result * 100) / 100;
  } catch {
    return null;
  }
}

export default function ExprPillNode({ node, updateAttributes, selected, deleteNode }) {
  const { fieldsById = {} } = useGridActions() || {};
  const computedValues = useComputedValuesMap();

  const { expr } = node.attrs;
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(expr);
  const inputRef = useRef(null);

  // Build name→value map from computedValues + fieldsById
  const valueMap = useMemo(() => {
    const map = {};
    // computedValues is { fieldId: value, "fieldId:occurrenceId": value }
    // Map by field name (from fieldsById)
    for (const [fieldId, val] of Object.entries(computedValues)) {
      // Skip occurrence-specific keys
      if (fieldId.includes(":")) continue;
      const field = fieldsById[fieldId];
      if (field?.name) {
        const name = field.name.replace(/\s+/g, "_");
        map[name] = val;
      }
    }
    // Also add raw field names from fieldsById (inputEnabled fields)
    for (const [, field] of Object.entries(fieldsById)) {
      if (field?.name) {
        const name = field.name.replace(/\s+/g, "_");
        if (!(name in map)) map[name] = null;
      }
    }
    return map;
  }, [computedValues, fieldsById]);

  const result = useMemo(() => evalExpr(expr, valueMap), [expr, valueMap]);
  const displayResult = result != null ? String(result) : "?";

  const startEdit = useCallback((e) => {
    e.stopPropagation();
    setEditDraft(expr);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, [expr]);

  const commitEdit = useCallback(() => {
    const trimmed = editDraft.trim();
    updateAttributes?.({ expr: trimmed || expr });
    setEditing(false);
  }, [editDraft, expr, updateAttributes]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const radialItems = useMemo(() => [
    { icon: Trash2, label: "Remove", onClick: () => deleteNode?.(), color: "bg-red-600 hover:bg-red-500" },
  ], [deleteNode]);

  const showMenu = hovered || menuOpen;

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <span
        style={{ ...(hovered ? PILL_HOV : PILL), outline: selected ? "1px solid var(--border-default)" : "none", outlineOffset: 1, position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={startEdit}
        title={`=${expr} → ${displayResult}`}
      >
        <span style={{ opacity: 0.6 }}>=</span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: "transparent", border: "none", outline: "none", color: "rgba(250,204,21,0.9)", fontFamily: "var(--font-mono)", fontSize: 10, width: `${Math.max(editDraft.length, 4) + 1}ch`, minWidth: 30 }}
          />
        ) : (
          <>
            <span style={{ opacity: 0.75 }}>{expr}</span>
            <span style={{ color: "rgba(250,204,21,1)", fontWeight: 500 }}>= {displayResult}</span>
          </>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, marginRight: -2, opacity: showMenu ? 1 : 0, pointerEvents: showMenu ? "auto" : "none", transition: "opacity 0.15s" }} contentEditable={false}>
          <RadialMenu
            items={radialItems}
            handleIcon={Settings}
            size="sm"
            handleClassName="border-none !rounded !w-4 !h-4 !px-0"
            forceDirection="down"
            onOpenChange={setMenuOpen}
          />
        </span>
      </span>
    </NodeViewWrapper>
  );
}
