// containers/ContainerPool.jsx
// Pool container content — draggable pill library with search + inline add.
// Manages its own search/add UI state; delegates persistence to CommitHelpers.
import React, { useState, useCallback } from "react";
import { Search, Plus, X } from "lucide-react";
import { PoolPill } from "../PoolContent.jsx";
import * as CommitHelpers from "../../helpers/CommitHelpers";

export default function ContainerPool({ itemsWithOccurrences, dispatch, socket, listDropRef, module, ctxState }) {
  const [poolSearch, setPoolSearch] = useState("");
  const [poolAddLabel, setPoolAddLabel] = useState("");
  const [isPoolAdding, setIsPoolAdding] = useState(false);

  const handlePoolAdd = useCallback(() => {
    const label = poolAddLabel.trim();
    if (!label) return;
    const { grid } = ctxState || {};
    const userId = ctxState?.userId;
    const gridId = grid?._id;
    if (!userId || !gridId) return;
    const instanceId = crypto.randomUUID();
    CommitHelpers.createInstanceInContainer({
      dispatch, socket,
      containerId: module.id,
      instance: { id: instanceId, role: "instance", kind: "board", label, userId, gridId, fieldBindings: [] },
      emit: true,
    });
    setPoolAddLabel("");
    setIsPoolAdding(false);
  }, [poolAddLabel, ctxState, dispatch, socket, module.id]);

  const filtered = poolSearch
    ? itemsWithOccurrences.filter(({ instance }) =>
        (instance.label || "").toLowerCase().includes(poolSearch.toLowerCase()))
    : itemsWithOccurrences;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* Toolbar: search + add */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 4, background: "var(--input-bg)", borderRadius: 6, padding: "2px 6px", border: "1px solid var(--input-border)" }}>
          <Search size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
          <input
            value={poolSearch}
            onChange={e => setPoolSearch(e.target.value)}
            placeholder="search…"
            style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)", flex: 1, minWidth: 0 }}
            onPointerDown={e => e.stopPropagation()}
          />
          {poolSearch && (
            <button onClick={() => setPoolSearch("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}>
              <X size={9} />
            </button>
          )}
        </div>
        {isPoolAdding ? (
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <input
              autoFocus
              value={poolAddLabel}
              onChange={e => setPoolAddLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handlePoolAdd();
                if (e.key === "Escape") { setIsPoolAdding(false); setPoolAddLabel(""); }
                e.stopPropagation();
              }}
              placeholder="new item…"
              style={{ fontSize: 12, fontFamily: "var(--font-mono)", background: "var(--input-bg)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 5, padding: "2px 6px", color: "var(--text-primary)", outline: "none", width: 100 }}
              onPointerDown={e => e.stopPropagation()}
            />
            <button onClick={handlePoolAdd} style={{ background: "rgba(99,102,241,0.3)", border: "1px solid rgba(99,102,241,0.5)", borderRadius: 4, cursor: "pointer", padding: "2px 5px", color: "rgba(180,190,255,0.9)", fontSize: 12 }}>Add</button>
            <button onClick={() => { setIsPoolAdding(false); setPoolAddLabel(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><X size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setIsPoolAdding(true)}
            onPointerDown={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 5, padding: "3px 7px", cursor: "pointer", color: "rgba(180,190,255,0.85)", fontSize: 12, fontFamily: "var(--font-mono)", flexShrink: 0 }}
          >
            <Plus size={9} /> Add
          </button>
        )}
      </div>

      {/* Pills body */}
      <div
        ref={listDropRef}
        style={{ flex: 1, overflow: "auto", padding: "6px 6px", display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 5 }}
      >
        {filtered.map(({ instance, occurrence: occ }) => (
          <PoolPill
            key={occ.id}
            instanceModule={instance}
            occurrence={occ}
            onDelete={() => occ?.id && CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occ.id, occurrence: occ })}
          />
        ))}
        {itemsWithOccurrences.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", padding: "8px 4px", width: "100%" }}>
            Empty pool — add items or drag here
          </div>
        )}
      </div>
    </div>
  );
}
