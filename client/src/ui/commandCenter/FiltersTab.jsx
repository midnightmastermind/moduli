// ui/commandCenter/FiltersTab.jsx
// Named filter presets management tab in Command Center.
// Allows creating, editing, and deleting namedFilters on the grid.
// Conditions are stored as [ConditionGroup] — {operator: "AND"|"OR", rules: [...]}.

import React, { useState, useCallback, useContext, useMemo } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Check, Lock, Unlock } from "lucide-react";

import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { uid } from "../../uid";
import ConditionGroup from "../../blocks/ConditionGroup";

const TIME_SCALE_OPTIONS = [
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly",  label: "Yearly" },
  { value: null,      label: "All (no date)" },
];

const styleBase = {
  fontFamily: "monospace",
  fontSize: 11,
  color: "var(--text-primary)",
};

const inputStyle = {
  ...styleBase,
  height: 24,
  padding: "0 8px",
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 4,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle = {
  ...styleBase,
  height: 24,
  padding: "0 6px",
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 4,
  outline: "none",
  cursor: "pointer",
};

// Migrate legacy {fieldId} entries + wrap everything in a single root group.
function toRootGroup(conditions) {
  const arr = Array.isArray(conditions) ? conditions : [];
  if (arr.length === 1 && Array.isArray(arr[0]?.rules)) return arr[0];
  const rules = arr.map(c => {
    if (!c) return null;
    if (Array.isArray(c.rules)) return c;
    if (c.fieldId) {
      return { left: `$occ.fields.${c.fieldId}.value`, comparator: "IS", right: "" };
    }
    if (c.left !== undefined) return c;
    return null;
  }).filter(Boolean);
  return { operator: "AND", rules };
}

// ── FilterRow ─────────────────────────────────────────────────────────────────
function FilterRow({ filter, isActive, onActivate, onUpdate, onDelete, fieldsById }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(filter.name || "");

  const rootGroup = useMemo(() => toRootGroup(filter.conditions), [filter.conditions]);

  const fieldsList = useMemo(() => Object.values(fieldsById || {}), [fieldsById]);

  const handleGroupChange = useCallback((nextGroup) => {
    onUpdate({ ...filter, conditions: [nextGroup] });
  }, [filter, onUpdate]);

  const handleNameBlur = () => {
    if (name.trim() !== filter.name) {
      onUpdate({ ...filter, name: name.trim() || "Untitled" });
    }
  };

  const handleTimeScaleChange = (e) => {
    const val = e.target.value === "__null__" ? null : e.target.value;
    onUpdate({ ...filter, timeScale: val });
  };

  const handleToggleLock = () => {
    onUpdate({ ...filter, lock: !filter.lock });
  };

  // Sources shape: filter conditions evaluate against $occ (the occurrence).
  const sources = useMemo(() => [{ variableName: "occ" }], []);

  const ruleCount = (rootGroup.rules || []).length;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: 4,
        marginBottom: 4,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
        <button
          onClick={onActivate}
          title={isActive ? "Active filter" : "Set as active filter"}
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: isActive ? "2px solid var(--accent-blue)" : "2px solid var(--border-default)",
            background: isActive ? "var(--accent-blue)" : "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            padding: 0,
          }}
        >
          {isActive && <Check style={{ width: 9, height: 9, color: "#fff" }} />}
        </button>

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          style={{ ...inputStyle, flex: 1 }}
        />

        <select
          value={filter.timeScale ?? "__null__"}
          onChange={handleTimeScaleChange}
          style={{ ...selectStyle, flexShrink: 0, maxWidth: 90 }}
        >
          {TIME_SCALE_OPTIONS.map(o => (
            <option key={o.value ?? "__null__"} value={o.value ?? "__null__"}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          onClick={handleToggleLock}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: filter.lock ? "var(--accent-blue)" : "var(--text-faint)",
            padding: "1px 2px",
            display: "flex",
            alignItems: "center",
          }}
          title={filter.lock ? "Locked — children cannot override" : "Unlocked — children may override"}
        >
          {filter.lock
            ? <Lock style={{ width: 11, height: 11 }} />
            : <Unlock style={{ width: 11, height: 11 }} />
          }
        </button>

        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-faint)",
            padding: "1px 2px",
            display: "flex",
            alignItems: "center",
          }}
          title="Edit conditions"
        >
          {expanded
            ? <ChevronDown style={{ width: 12, height: 12 }} />
            : <ChevronRight style={{ width: 12, height: 12 }} />
          }
        </button>

        <button
          onClick={onDelete}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(255,80,80,0.4)",
            padding: "1px 2px",
            display: "flex",
            alignItems: "center",
          }}
          title="Delete filter"
        >
          <Trash2 style={{ width: 11, height: 11 }} />
        </button>
      </div>

      {!expanded && ruleCount > 0 && (
        <div style={{ paddingLeft: 22, fontFamily: "monospace", fontSize: 9, color: "var(--text-faint)" }}>
          {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
        </div>
      )}

      {expanded && (
        <div style={{ paddingLeft: 22 }}>
          <ConditionGroup
            group={rootGroup}
            onChange={handleGroupChange}
            sources={sources}
            fields={fieldsList}
          />

          <div style={{ fontFamily: "monospace", fontSize: 9, color: "var(--text-faint)", marginTop: 4 }}>
            Rules use <code>$occ.fields.&lt;fieldId&gt;.value</code> for the occurrence field.
            No value on an occurrence = persistent (always visible).
          </div>
        </div>
      )}
    </div>
  );
}

// ── FiltersTab ─────────────────────────────────────────────────────────────────
export function FiltersTab() {
  const { dispatch, socket, state, fieldsById } = useGridActions();

  const grid = state?.grid;
  const gridId = state?.gridId || grid?._id;
  const namedFilters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId || null;

  const saveFilters = useCallback((filters) => {
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { namedFilters: filters } });
  }, [dispatch, socket, gridId]);

  const handleActivate = useCallback((filterId) => {
    socket?.emit("update_grid_filter", { gridId, activeFilterId: filterId });
    dispatch?.({ type: "UPDATE_GRID", payload: { gridId, grid: { activeFilterId: filterId } } });
  }, [dispatch, socket, gridId]);

  const handleUpdate = useCallback((updated) => {
    const next = namedFilters.map(f => f.id === updated.id ? updated : f);
    saveFilters(next);
  }, [namedFilters, saveFilters]);

  const handleDelete = useCallback((filterId) => {
    const next = namedFilters.filter(f => f.id !== filterId);
    saveFilters(next);
    if (activeFilterId === filterId && next.length > 0) {
      handleActivate(next[0].id);
    }
  }, [namedFilters, saveFilters, activeFilterId, handleActivate]);

  const handleCreate = useCallback(() => {
    const newFilter = {
      id: "filter_" + uid(),
      name: "New Filter",
      conditions: [{ operator: "AND", rules: [] }],
      timeScale: "daily",
    };
    saveFilters([...namedFilters, newFilter]);
  }, [namedFilters, saveFilters]);

  return (
    <div style={{ padding: "10px 12px", minHeight: 80 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-faint)" }}>
          Named Filters — {namedFilters.length} preset{namedFilters.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={handleCreate}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontFamily: "monospace",
            fontSize: 10,
            background: "var(--accent-green-bg)",
            border: "1px solid var(--accent-green-border)",
            borderRadius: 4,
            color: "var(--accent-green-text)",
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          <Plus style={{ width: 10, height: 10 }} />
          New Filter
        </button>
      </div>

      {namedFilters.length === 0 && (
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-faint)", textAlign: "center", padding: "20px 0" }}>
          No filters — click "New Filter" to create one.
        </div>
      )}
      {namedFilters.map(filter => (
        <FilterRow
          key={filter.id}
          filter={filter}
          isActive={filter.id === activeFilterId}
          onActivate={() => handleActivate(filter.id)}
          onUpdate={handleUpdate}
          onDelete={() => handleDelete(filter.id)}
          fieldsById={fieldsById || {}}
        />
      ))}

      <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 9, color: "var(--text-faint)", lineHeight: 1.5 }}>
        Active filter controls which occurrences are visible in containers and panels.
        Click the circle to make a filter active in the toolbar.
      </div>
    </div>
  );
}
