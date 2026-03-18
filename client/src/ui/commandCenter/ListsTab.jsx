// ui/commandCenter/ListsTab.jsx
// ListsTab

import React, { useState, useContext } from "react";
import { ChevronDown, ChevronRight, Tag, X } from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";

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

export function ListsTab() {
  const { state, dispatch, socket } = useContext(GridActionsContext);
  const grid = state?.grid;
  const gridId = state?.gridId;

  const iters = (grid?.iterations || []).filter(it => it.categoryKey || it.categoryOptions?.length);

  const [expandedId, setExpandedId] = useState(null);
  const [newValue, setNewValue] = useState("");

  const commitIterations = (updated) => {
    const gid = grid._id?.toString() || grid.id || gridId;
    CommitHelpers.updateGrid({ dispatch, socket, gridId: gid, grid: { ...grid, iterations: updated }, emit: true });
  };

  const addOption = (iter) => {
    const val = newValue.trim();
    if (!val) return;
    const opts = iter.categoryOptions || [];
    if (opts.includes(val)) return;
    commitIterations((grid.iterations || []).map(it =>
      it.id === iter.id ? { ...it, categoryOptions: [...opts, val] } : it
    ));
    setNewValue("");
  };

  const removeOption = (iter, opt) => {
    commitIterations((grid.iterations || []).map(it =>
      it.id === iter.id ? { ...it, categoryOptions: (it.categoryOptions || []).filter(v => v !== opt) } : it
    ));
  };

  if (!iters.length) {
    return (
      <div style={{ padding: "20px 16px", color: "var(--text-faint)", fontSize: 11, fontFamily: "monospace" }}>
        No category lists yet. In Grid Settings → Iterations, add a Category Key to an iteration to create filterable lists.
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...labelStyle, fontSize: 11, color: "var(--text-muted)" }}>
        Category option lists — values used in compound iteration filters
      </span>

      {iters.map(iter => {
        const isExpanded = expandedId === iter.id;
        const opts = iter.categoryOptions || [];
        return (
          <div
            key={iter.id}
            style={{
              background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
              borderRadius: 7, overflow: "hidden",
            }}
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : iter.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%",
                padding: "6px 10px", background: "none", border: "none",
                color: "var(--text-primary)", fontSize: 11, fontFamily: "monospace",
                cursor: "pointer", textAlign: "left",
              }}
            >
              {isExpanded
                ? <ChevronDown style={{ width: 11, height: 11 }} />
                : <ChevronRight style={{ width: 11, height: 11 }} />
              }
              <Tag style={{ width: 11, height: 11, color: "rgb(99,102,241)" }} />
              <strong>{iter.name || iter.timeFilter}</strong>
              {iter.categoryKey && (
                <span style={{ opacity: 0.4, fontSize: 10 }}>key: {iter.categoryKey}</span>
              )}
              <span style={{ marginLeft: "auto", opacity: 0.4, fontSize: 10 }}>{opts.length} values</span>
            </button>

            {isExpanded && (
              <div style={{ padding: "0 10px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, minHeight: 24 }}>
                  {opts.length > 0
                    ? opts.map(opt => (
                        <span key={opt} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
                          background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.35)",
                          color: "rgb(165,180,252)",
                        }}>
                          {opt}
                          <button
                            onClick={() => removeOption(iter, opt)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, display: "inline-flex" }}
                          >
                            <X style={{ width: 8, height: 8 }} />
                          </button>
                        </span>
                      ))
                    : <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>No values yet</span>
                  }
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addOption(iter); if (e.key === "Escape") setNewValue(""); }}
                    placeholder="Add value..."
                    style={{ ...inputStyle, flex: 1, height: 24, fontSize: 10 }}
                  />
                  <button
                    onClick={() => addOption(iter)}
                    style={{
                      padding: "0 10px", height: 24, borderRadius: 5, fontSize: 10,
                      fontFamily: "monospace", cursor: "pointer",
                      background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)",
                      color: "rgb(165,180,252)",
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
