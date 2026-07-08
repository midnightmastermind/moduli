// ui/FeedSection.jsx
//
// HeaderDropdown section configuring an occurrence FEED (occurrence.feed) —
// the materialized pull-query (see helpers/feedSync.js): conditions in the
// same shape the filter menu uses, an optional page scope, sort + limit.
// Writes the whole feed object via CommitHelpers.updateOccurrence; the sync
// engine reconciles copies on its next debounced pass. Shows a live "N match
// now" count so the query is verifiable while authoring.
import React, { useCallback, useMemo } from "react";
import { Rss, Plus, X } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { COMPARATOR_OPTIONS, UNARY_COMPARATORS } from "../helpers/comparators";
import { resolveFeedItems } from "../state/selectors";

const uid = () => `feedc-${Math.random().toString(36).slice(2, 9)}`;

const ROLE_OPTIONS = ["instance", "textblock", "artifact", "container"];

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--input-bg, rgba(0,0,0,0.25))",
  border: "1px solid var(--border-subtle)", borderRadius: 4,
  color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)",
  padding: "3px 6px",
};

export default function FeedSection({ occurrence }) {
  const { dispatch, socket, occurrencesById, modulesById, fieldsById } = useGridActions() || {};
  const feed = occurrence?.feed || null;

  const write = useCallback((next) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, feed: next },
      emit: true,
    });
  }, [occurrence?.id, dispatch, socket]);

  const patch = useCallback((p) => {
    write({
      enabled: false, conditions: [], roles: ["instance"], scope: null,
      sort: null, limit: 50,
      ...(feed || {}), ...p,
    });
  }, [feed, write]);

  const fields = useMemo(
    () => Object.values(fieldsById || {}).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fieldsById],
  );

  // Scope options: any page-role occurrence (feeds pull "under a page" or grid-wide).
  const scopeOptions = useMemo(() => {
    const out = [];
    for (const o of Object.values(occurrencesById || {})) {
      const m = modulesById?.[o.moduleId];
      if (m?.role === "page") out.push({ id: o.id, label: o.label || m.label || o.id.slice(0, 8) });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [occurrencesById, modulesById]);

  const matchCount = useMemo(() => {
    if (!feed?.enabled) return null;
    try {
      return resolveFeedItems({ ...occurrence, feed }, { occurrencesById, modulesById }).length;
    } catch { return null; }
  }, [feed, occurrence, occurrencesById, modulesById]);

  if (!occurrence?.id) return null;

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          <Rss size={11} /> Feed
          {matchCount != null && (
            <span style={{ color: "var(--text-faint)", textTransform: "none", letterSpacing: 0 }}>
              · {matchCount} match{matchCount === 1 ? "" : "es"} now
            </span>
          )}
        </div>
        <button
          onClick={() => patch({ enabled: !feed?.enabled })}
          style={{
            fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
            padding: "2px 8px", borderRadius: 10,
            border: `1px solid ${feed?.enabled ? "rgba(96,165,250,0.5)" : "var(--border-subtle)"}`,
            background: feed?.enabled ? "rgba(96,165,250,0.18)" : "transparent",
            color: feed?.enabled ? "rgb(186,214,255)" : "var(--text-muted)",
          }}
        >
          {feed?.enabled ? "On" : "Off"}
        </button>
      </div>

      {feed?.enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Conditions */}
          {(feed.conditions || []).map((c, i) => {
            const unary = UNARY_COMPARATORS?.has?.(c.comparator);
            return (
              <div key={c.id || i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <select
                  value={c.fieldId || ""}
                  onChange={(e) => {
                    const conditions = [...feed.conditions];
                    conditions[i] = { ...c, fieldId: e.target.value };
                    patch({ conditions });
                  }}
                  style={{ ...inputStyle, flex: 2 }}
                >
                  <option value="">field…</option>
                  {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select
                  value={c.comparator || "IS"}
                  onChange={(e) => {
                    const conditions = [...feed.conditions];
                    conditions[i] = { ...c, comparator: e.target.value };
                    patch({ conditions });
                  }}
                  style={{ ...inputStyle, flex: 2 }}
                >
                  {COMPARATOR_OPTIONS.map(op => (
                    <option key={op.value || op} value={op.value || op}>{op.label || op.value || op}</option>
                  ))}
                </select>
                {!unary && (
                  <input
                    value={c.value ?? ""}
                    placeholder="value"
                    onChange={(e) => {
                      const conditions = [...feed.conditions];
                      const raw = e.target.value;
                      const coerced = raw === "true" ? true : raw === "false" ? false
                        : raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
                      conditions[i] = { ...c, value: coerced };
                      patch({ conditions });
                    }}
                    style={{ ...inputStyle, flex: 2 }}
                  />
                )}
                <button
                  onClick={() => patch({ conditions: feed.conditions.filter((_, j) => j !== i) })}
                  title="Remove condition"
                  style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2 }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => patch({ conditions: [...(feed.conditions || []), { id: uid(), fieldId: "", comparator: "IS", value: "" }] })}
            style={{
              display: "flex", alignItems: "center", gap: 4, alignSelf: "flex-start",
              background: "none", border: "1px dashed var(--border-subtle)", borderRadius: 4,
              color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)",
              padding: "2px 8px", cursor: "pointer",
            }}
          >
            <Plus size={10} /> condition
          </button>

          {/* Roles */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>pull:</span>
            {ROLE_OPTIONS.map(role => {
              const on = (feed.roles || ["instance"]).includes(role);
              return (
                <button
                  key={role}
                  onClick={() => {
                    const cur = new Set(feed.roles || ["instance"]);
                    if (on) cur.delete(role); else cur.add(role);
                    if (cur.size === 0) cur.add("instance");
                    patch({ roles: [...cur] });
                  }}
                  style={{
                    fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
                    padding: "1px 7px", borderRadius: 9,
                    border: `1px solid ${on ? "rgba(96,165,250,0.5)" : "var(--border-subtle)"}`,
                    background: on ? "rgba(96,165,250,0.15)" : "transparent",
                    color: on ? "rgb(186,214,255)" : "var(--text-faint)",
                  }}
                >
                  {role}
                </button>
              );
            })}
          </div>

          {/* Scope + sort + limit */}
          <div style={{ display: "flex", gap: 4 }}>
            <select
              value={feed.scope || ""}
              onChange={(e) => patch({ scope: e.target.value || null })}
              title="Only pull occurrences under this page"
              style={{ ...inputStyle, flex: 3 }}
            >
              <option value="">whole grid</option>
              {scopeOptions.map(o => <option key={o.id} value={o.id}>under: {o.label}</option>)}
            </select>
            <input
              type="number" min={1} max={500}
              value={feed.limit ?? 50}
              onChange={(e) => patch({ limit: Math.max(1, Number(e.target.value) || 50) })}
              title="Max pulled items"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <select
              value={feed.sort?.fieldId || ""}
              onChange={(e) => patch({ sort: e.target.value ? { fieldId: e.target.value, dir: feed.sort?.dir || "asc" } : null })}
              title="Sort pulled items by field"
              style={{ ...inputStyle, flex: 3 }}
            >
              <option value="">no sort</option>
              {fields.map(f => <option key={f.id} value={f.id}>sort: {f.name}</option>)}
            </select>
            {feed.sort?.fieldId && (
              <button
                onClick={() => patch({ sort: { ...feed.sort, dir: feed.sort.dir === "desc" ? "asc" : "desc" } })}
                style={{ ...inputStyle, flex: 1, cursor: "pointer", textAlign: "center" }}
              >
                {feed.sort.dir === "desc" ? "↓" : "↑"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
