// ui/commandCenter/FiltersTab.jsx
// Named filter presets management tab in Command Center.
// Allows creating, editing, and deleting namedFilters on the grid.

import React, { useState, useCallback, useContext } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Check } from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { uid } from "../../uid";

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

// ── ConditionRow ─────────────────────────────────────────────────────────────
function ConditionRow({ condition, fieldsById, onRemove }) {
  const field = fieldsById[condition.fieldId];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 0",
      }}
    >
      <span
        style={{
          flex: 1,
          fontFamily: "monospace",
          fontSize: 10,
          color: "var(--text-muted)",
          background: "var(--input-bg)",
          border: "1px solid var(--border-default)",
          borderRadius: 4,
          padding: "1px 6px",
        }}
      >
        {field?.name || condition.fieldId} ({field?.type || "?"})
      </span>
      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-faint)",
          padding: "1px 3px",
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
        }}
        title="Remove condition"
      >
        <Trash2 style={{ width: 11, height: 11 }} />
      </button>
    </div>
  );
}

// ── FilterRow ─────────────────────────────────────────────────────────────────
function FilterRow({ filter, isActive, onActivate, onUpdate, onDelete, fieldsById }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(filter.name || "");

  const handleNameBlur = () => {
    if (name.trim() !== filter.name) {
      onUpdate({ ...filter, name: name.trim() || "Untitled" });
    }
  };

  const handleTimeScaleChange = (e) => {
    const val = e.target.value === "__null__" ? null : e.target.value;
    onUpdate({ ...filter, timeScale: val });
  };

  const handleAddCondition = (e) => {
    const fieldId = e.target.value;
    if (!fieldId) return;
    const already = (filter.conditions || []).some(c => c.fieldId === fieldId);
    if (already) return;
    onUpdate({ ...filter, conditions: [...(filter.conditions || []), { fieldId }] });
    e.target.value = "";
  };

  const handleRemoveCondition = (fieldId) => {
    onUpdate({ ...filter, conditions: (filter.conditions || []).filter(c => c.fieldId !== fieldId) });
  };

  const dateFields = Object.values(fieldsById).filter(f => f.type === "date");
  const availableFields = Object.values(fieldsById);
  const conditionFieldIds = new Set((filter.conditions || []).map(c => c.fieldId));
  const addableFields = availableFields.filter(f => !conditionFieldIds.has(f.id));

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
        {/* Active indicator */}
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

        {/* Name input */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          style={{ ...inputStyle, flex: 1 }}
        />

        {/* TimeScale select */}
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

        {/* Expand toggle */}
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

        {/* Delete */}
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

      {/* Conditions (expanded) */}
      {expanded && (
        <div style={{ paddingLeft: 22 }}>
          {/* Condition list */}
          {(filter.conditions || []).length === 0 && (
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-faint)", padding: "3px 0" }}>
              No conditions — matches all occurrences
            </div>
          )}
          {(filter.conditions || []).map(c => (
            <ConditionRow
              key={c.fieldId}
              condition={c}
              fieldsById={fieldsById}
              onRemove={() => handleRemoveCondition(c.fieldId)}
            />
          ))}

          {/* Add condition */}
          {addableFields.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <select
                defaultValue=""
                onChange={handleAddCondition}
                style={{ ...selectStyle, width: "100%", fontSize: 10 }}
              >
                <option value="">+ Add field condition…</option>
                {addableFields.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Help text */}
          <div style={{ fontFamily: "monospace", fontSize: 9, color: "var(--text-faint)", marginTop: 4 }}>
            Date conditions compare occurrence field value to the toolbar date.
            No value on an occurrence = persistent (always visible).
          </div>
        </div>
      )}
    </div>
  );
}

// ── FiltersTab ─────────────────────────────────────────────────────────────────
export function FiltersTab() {
  const { dispatch, socket, state, fieldsById } = useContext(GridActionsContext);

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
      conditions: [],
      timeScale: "daily",
    };
    saveFilters([...namedFilters, newFilter]);
  }, [namedFilters, saveFilters]);

  return (
    <div style={{ padding: "10px 12px", minHeight: 80 }}>
      {/* Header */}
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

      {/* Filter list */}
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

      {/* Help */}
      <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 9, color: "var(--text-faint)", lineHeight: 1.5 }}>
        Active filter controls which occurrences are visible in containers and panels.
        Click the circle to make a filter active in the toolbar.
      </div>
    </div>
  );
}
