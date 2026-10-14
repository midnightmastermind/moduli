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
import FieldSelect from "./FieldSelect.jsx";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { PIPELINE_COMPARATOR_GROUPS, UNARY_COMPARATORS } from "../helpers/comparators";

// The feed predicate is evaluated by the executor's own evaluator, so the editor
// offers the WHOLE comparator catalog (2026-10-08): with only the 12 simple ones,
// poms' Completed feed (Date DATE_BEFORE $today) could be stored by a seed and
// never authored. A stored comparator the catalog lacks still gets its option.
const OFFERED = new Set(PIPELINE_COMPARATOR_GROUPS.flatMap((g) => g.items.map((c) => c.value)));
import { resolveFeedItems } from "../state/selectors";

const uid = () => `feedc-${Math.random().toString(36).slice(2, 9)}`;

const ROLE_OPTIONS = ["instance", "textblock", "artifact", "container"];

// How deep the EDITOR lets you nest. `helpers/feedPredicate` tolerates more and
// refuses beyond its own cap; this is the smaller, friendlier limit — two levels
// covers "either of these, or both of those" and anything past it is unreadable
// in a dropdown this size.
const MAX_UI_DEPTH = 2;

const isGroup = (entry) => Array.isArray(entry?.conditions);
// A condition can name WHERE a row sits instead of a field: "under" an
// occurrence (any of its parents' chains) or directly in one. The value is the
// occurrence's id.
const UNDER_OPTIONS = [
  { value: "@_ancestors", label: "Under (occurrence)", hint: "anywhere inside it" },
  { value: "@parentId", label: "In (occurrence)", hint: "directly in it" },
];
const pickLeft = (entry, id) => {
  const { path: _p, ...rest } = entry;
  if (id === "@_ancestors") return { ...rest, fieldId: "", path: "_ancestors", comparator: "HAS_ANCESTOR" };
  if (id === "@parentId") return { ...rest, fieldId: "", path: "parentId", comparator: "IS" };
  return { ...rest, fieldId: id || "" };
};
const newLeaf = () => ({ id: uid(), fieldId: "", comparator: "IS", value: "" });
const newGroup = () => ({ id: uid(), operator: "AND", conditions: [newLeaf()] });

// The stored value keeps the coercion the flat editor always had: "true"/"false"
// become booleans, numeric strings become numbers, everything else stays a
// string — which is what leaves a "$today" token intact.
const coerce = (raw) => (raw === "true" ? true : raw === "false" ? false
  : raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw);

// AND/OR, said in words. "match all / match any" reads correctly to someone who
// has never written a predicate; AND/OR does not.
function OperatorToggle({ operator, onChange }) {
  const isOr = String(operator).toUpperCase() === "OR";
  return (
    <button
      onClick={() => onChange(isOr ? "AND" : "OR")}
      title={isOr ? "ANY one of these is enough" : "EVERY one of these must hold"}
      style={{
        background: isOr ? "rgb(var(--signal-warn) / 0.18)" : "rgb(var(--signal-zero) / 0.14)",
        color: isOr ? "rgb(250,224,160)" : "rgb(186,214,255)",
        border: "1px solid var(--border-subtle)", borderRadius: 4,
        fontSize: 12, fontFamily: "var(--font-mono)", padding: "1px 6px", cursor: "pointer",
      }}
    >
      match {isOr ? "any" : "all"}
    </button>
  );
}

function AddButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        background: "none", border: "1px dashed var(--border-subtle)", borderRadius: 4,
        color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)",
        padding: "2px 8px", cursor: "pointer",
      }}
    >
      <Plus size={10} /> {children}
    </button>
  );
}

// One level of the tree. Recursive, so a group renders the same control set as
// the top level — there is no second implementation to drift.
function ConditionList({ entries, operator, onEntries, onOperator, fields, depth = 0 }) {
  const replaceAt = (i, v) => onEntries(entries.map((e, j) => (j === i ? v : e)));
  const removeAt = (i) => onEntries(entries.filter((_, j) => j !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <OperatorToggle operator={operator} onChange={onOperator} />
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            of the {entries.length} below
          </span>
        </div>
      )}

      {entries.map((entry, i) => isGroup(entry) ? (
        <div
          key={entry.id || i}
          style={{
            display: "flex", gap: 6, alignItems: "flex-start",
            borderLeft: "2px solid var(--border-subtle)", paddingLeft: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <ConditionList
              entries={entry.conditions || []}
              operator={entry.operator}
              onEntries={(next) => replaceAt(i, { ...entry, conditions: next })}
              onOperator={(op) => replaceAt(i, { ...entry, operator: op })}
              fields={fields}
              depth={depth + 1}
            />
          </div>
          <button
            onClick={() => removeAt(i)}
            title="Remove group"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <div key={entry.id || i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <FieldSelect
              fields={fields}
              extraOptions={UNDER_OPTIONS}
              value={entry.path ? `@${entry.path}` : (entry.fieldId || null)}
              onChange={(id) => replaceAt(i, pickLeft(entry, id))}
              noneLabel="field…"
              placeholder="field…"
              style={inputStyle}
            />
          </div>
          <select
            value={entry.comparator || "IS"}
            onChange={(e) => replaceAt(i, { ...entry, comparator: e.target.value })}
            style={{ ...inputStyle, flex: 2 }}
          >
            {entry.comparator && !OFFERED.has(entry.comparator) && (
              <option value={entry.comparator}>{entry.comparator}</option>
            )}
            {PIPELINE_COMPARATOR_GROUPS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(c => <option key={c.value} value={c.value}>{c.label || c.value}</option>)}
              </optgroup>
            ))}
          </select>
          {!UNARY_COMPARATORS?.has?.(entry.comparator) && (
            <input
              value={entry.value ?? ""}
              placeholder="value"
              onChange={(e) => replaceAt(i, { ...entry, value: coerce(e.target.value) })}
              style={{ ...inputStyle, flex: 2 }}
            />
          )}
          <button
            onClick={() => removeAt(i)}
            title="Remove condition"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6 }}>
        <AddButton onClick={() => onEntries([...entries, newLeaf()])}>condition</AddButton>
        {depth < MAX_UI_DEPTH && (
          <AddButton onClick={() => onEntries([...entries, newGroup()])}>group</AddButton>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--input-bg, rgba(0,0,0,0.25))",
  border: "1px solid var(--border-subtle)", borderRadius: 4,
  color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)",
  padding: "3px 6px",
};

export default function FeedSection({ occurrence }) {
  const { dispatch, socket, occurrencesById, modulesById, fieldsById } = useGridActions() || {};
  const feed = occurrence?.feed || null;
  const cfg = feed || {};

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

  // Counted while Off too ("would match"), so the conditions can be checked
  // before the feed is switched On and starts minting copies.
  const matchCount = useMemo(() => {
    if (!feed) return null;
    try {
      return resolveFeedItems({ ...occurrence, feed: { ...feed, enabled: true } }, { occurrencesById, modulesById }).length;
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
          fontSize: 12, fontWeight: 600, color: "var(--text-primary)",
          fontFamily: "var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          <Rss size={11} /> Feed
          {matchCount != null && (
            <span style={{ color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
              · {matchCount} {feed?.enabled ? `match${matchCount === 1 ? "" : "es"} now` : "would match"}
            </span>
          )}
        </div>
        <button
          onClick={() => patch({ enabled: !feed?.enabled })}
          style={{
            fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
            padding: "2px 8px", borderRadius: 10,
            border: `1px solid ${feed?.enabled ? "rgb(var(--signal-zero) / 0.5)" : "var(--border-subtle)"}`,
            background: feed?.enabled ? "rgb(var(--signal-zero) / 0.18)" : "transparent",
            color: feed?.enabled ? "rgb(186,214,255)" : "var(--text-muted)",
          }}
        >
          {feed?.enabled ? "On" : "Off"}
        </button>
      </div>

      {/* SHOWN WHILE OFF, so a feed is built BEFORE it pulls anything. It used to
          appear only once switched On — and an On feed with no conditions pulls
          every row its roles allow, so building one meant minting a copy of the
          whole grid first (2026-10-14: 183 copies each into Beverages and
          Supplements on the rebuild). */}
      {(
        <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: feed?.enabled ? 1 : 0.75 }}>
          {/* Conditions — one recursive control set, so a nested group offers
              exactly what the top level does. `conditionOperator` is absent on
              every feed authored before 2026-08-08 and reads as AND. */}
          <ConditionList
            entries={cfg.conditions || []}
            operator={cfg.conditionOperator}
            onEntries={(conditions) => patch({ conditions })}
            onOperator={(conditionOperator) => patch({ conditionOperator })}
            fields={fields}
          />
          {/* The token is stored verbatim (the value coercion leaves a "$" string
              alone) and resolved at match time by helpers/feedTokens. Without this
              line it works but nobody would ever guess it exists. */}
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            date comparators accept <code>$today</code> as a value
          </span>

          {/* Roles */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>pull:</span>
            {ROLE_OPTIONS.map(role => {
              const on = (cfg.roles || ["instance"]).includes(role);
              return (
                <button
                  key={role}
                  onClick={() => {
                    const cur = new Set(cfg.roles || ["instance"]);
                    if (on) cur.delete(role); else cur.add(role);
                    if (cur.size === 0) cur.add("instance");
                    patch({ roles: [...cur] });
                  }}
                  style={{
                    fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
                    padding: "1px 7px", borderRadius: 9,
                    border: `1px solid ${on ? "rgb(var(--signal-zero) / 0.5)" : "var(--border-subtle)"}`,
                    background: on ? "rgba(96,165,250,0.15)" : "transparent",
                    color: on ? "rgb(186,214,255)" : "var(--text-muted)",
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
              value={cfg.scope || ""}
              onChange={(e) => patch({ scope: e.target.value || null })}
              title="Only pull occurrences under this page"
              style={{ ...inputStyle, flex: 3 }}
            >
              <option value="">whole grid</option>
              {scopeOptions.map(o => <option key={o.id} value={o.id}>under: {o.label}</option>)}
            </select>
            <input
              type="number" min={1} max={500}
              value={cfg.limit ?? 50}
              onChange={(e) => patch({ limit: Math.max(1, Number(e.target.value) || 50) })}
              title="Max pulled items"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <div style={{ flex: 3, minWidth: 0 }}>
              <FieldSelect
                fields={fields}
                value={cfg.sort?.fieldId || null}
                onChange={(id) => patch({ sort: id ? { fieldId: id, dir: cfg.sort?.dir || "asc" } : null })}
                noneLabel="no sort"
                placeholder="no sort"
                extraOptions={[{ value: "label", label: "Label" }]}
                searchPlaceholder="Search fields to sort by…"
                style={inputStyle}
              />
            </div>
            {cfg.sort?.fieldId && (
              <button
                onClick={() => patch({ sort: { ...cfg.sort, dir: cfg.sort.dir === "desc" ? "asc" : "desc" } })}
                style={{ ...inputStyle, flex: 1, cursor: "pointer", textAlign: "center" }}
              >
                {cfg.sort.dir === "desc" ? "↓" : "↑"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
