// ui/commandCenter/FieldsTab.jsx
// FieldsTab + FieldPill + FieldDetail

import React, { useState, useMemo, useEffect, useRef } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Plus, FolderPlus, ChevronLeft, GripVertical, Trash2 } from "lucide-react";

import { useGridActions } from "../../GridActionsContext";
import { uid } from "../../uid";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import SelectOptionsSourceEditor from "./SelectOptionsSourceEditor";
import PrefillEditor from "./PrefillEditor";

// Shared style helpers
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

// ============================================================
// COLUMN EDITOR — inline editor for displayConfig.columns
// Used by FieldDetail when displayEnabled=true
// ============================================================
function ColumnEditor({ columns, onChange }) {
  const addColumn = () => {
    onChange([...columns, { path: "", header: "", width: null }]);
  };

  const updateColumn = (i, patch) => {
    const next = columns.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onChange(next);
  };

  const removeColumn = (i) => {
    onChange(columns.filter((_, idx) => idx !== i));
  };

  const moveColumn = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const rowStyle = { display: "flex", alignItems: "center", gap: 4, marginBottom: 4 };
  const smallInput = { ...inputStyle, height: 24, fontSize: 10, padding: "0 6px" };

  return (
    <div>
      {columns.map((col, i) => (
        <div key={i} style={rowStyle}>
          <input
            type="text"
            value={col.path}
            onChange={e => updateColumn(i, { path: e.target.value })}
            placeholder="path"
            title="Field path in the row object, e.g. 'label' or 'pages'"
            style={{ ...smallInput, width: 80 }}
          />
          <input
            type="text"
            value={col.header}
            onChange={e => updateColumn(i, { header: e.target.value })}
            placeholder="header"
            title="Column header label"
            style={{ ...smallInput, width: 70 }}
          />
          <input
            type="number"
            value={col.width ?? ""}
            onChange={e => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              updateColumn(i, { width: v });
            }}
            placeholder="px"
            title="Fixed column width in pixels (leave blank for auto)"
            style={{ ...smallInput, width: 42 }}
          />
          <button
            type="button"
            onClick={() => moveColumn(i, -1)}
            disabled={i === 0}
            title="Move up"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
          >↑</button>
          <button
            type="button"
            onClick={() => moveColumn(i, 1)}
            disabled={i === columns.length - 1}
            title="Move down"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
          >↓</button>
          <button
            type="button"
            onClick={() => removeColumn(i)}
            title="Remove column"
            style={{ background: "none", border: "none", color: "var(--danger-text, #f87171)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
          >✕</button>
        </div>
      ))}
      <button
        type="button"
        onClick={addColumn}
        style={{ fontSize: 10, fontFamily: "monospace", color: "var(--accent-blue, #3b82f6)", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 2 }}
      >+ Add column</button>
    </div>
  );
}

// ============================================================
// FIELD PILL (draggable — drag to instance to add field binding)
// ============================================================
export function FieldPill({ field, selected, onClick, compact = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "field",
        id: field.id,
        data: field,
        sourceType: "command-center",
      }),
    });
  }, [field]);

  const isInput = field.inputEnabled !== false;
  const isOccurrence = field.type === "occurrence";
  const base = isOccurrence ? "6,182,212" : isInput ? "59,130,246" : "168,85,247"; // cyan / blue / purple
  const textColor = isOccurrence ? "rgb(103,232,249)" : isInput ? "rgb(147,197,253)" : "rgb(216,180,254)";
  const dotColor = isOccurrence ? "rgb(34,211,238)" : isInput ? "rgb(96,165,250)" : "rgb(192,132,252)";

  if (compact) {
    // Compact list-item style for category columns
    return (
      <div
        ref={ref}
        onClick={onClick}
        title={`${field.name} (${field.type}) — drag to add to an instance or drop on column to recategorize`}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 7px", borderRadius: 4, cursor: "grab",
          background: selected ? `rgba(${base}, 0.22)` : "var(--input-bg)",
          border: `1px solid ${selected ? `rgba(${base}, 0.5)` : "var(--border-subtle)"}`,
          fontSize: 11, fontFamily: "monospace", userSelect: "none",
          transition: "all 0.1s",
        }}
      >
        <GripVertical style={{ width: 8, height: 8, opacity: 0.3, flexShrink: 0 }} />
        <span style={{ color: textColor, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.name || field.type}
        </span>
        <span style={{ opacity: 0.3, fontSize: 9 }}>{field.type}</span>
      </div>
    );
  }

  return (
    <button
      ref={ref}
      onClick={onClick}
      title={`${field.name} (${field.type}) — drag to add to an instance`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px 3px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: "monospace",
        cursor: "grab",
        transition: "all 0.15s",
        userSelect: "none",
        background: selected
          ? `rgba(${base}, 0.35)`
          : `rgba(${base}, 0.12)`,
        border: `1px solid rgba(${base}, ${selected ? 0.7 : 0.28})`,
        color: textColor,
        outline: "none",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <span>{field.name || field.type}</span>
      <span style={{ opacity: 0.42, fontSize: 10 }}>{field.type}</span>
    </button>
  );
}

// ============================================================
// FIELD DETAIL (native inputs for dark-panel aesthetic)
// ============================================================
// ── AffixEditor — the fixed prefix/postfix AND the per-row option lists ──────
//
// User 2026-08-08: "a dropdown for pfefix and postfix so i can do $ for money
// or like kg ml g any for amount of ingrediants."
//
// The DEFAULT is what every row shows until it picks; the OPTIONS are what a
// row may pick from. Leave options empty and the field behaves exactly as it
// always has — one fixed affix, no picker.
//
// **A unit list does NOT belong on a field that money trackers sum.** Measured
// on poms grid: `Amount` is bound by 27 modules and read by 8 operations
// (Spent, Checking Balance, Monthly Bills…). The affix is presentation only, so
// "300 g" would still add 300 to the spending total. Currency options there are
// safe; grams want their own field.
function AffixEditor({ local, setLocal }) {
  const setMeta = (patch) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), ...patch } }));
  const listToText = (a) => (Array.isArray(a) ? a.join(", ") : "");
  const textToList = (t) => t.split(",").map(x => x.trim()).filter(Boolean);
  const row = (which, label, placeholder) => (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
      <div style={{ flex: "0 0 60px" }}>
        <span style={labelStyle}>{label}</span>
        <input
          value={local.meta?.[which] || ""}
          onChange={(e) => setMeta({ [which]: e.target.value })}
          style={{ ...inputStyle, width: 60 }}
          placeholder={placeholder}
        />
      </div>
      <div style={{ flex: 1 }}>
        <span style={labelStyle}>{label} choices (comma separated — leave empty for none)</span>
        <input
          value={listToText(local.meta?.[`${which}Options`])}
          onChange={(e) => setMeta({ [`${which}Options`]: textToList(e.target.value) })}
          style={{ ...inputStyle, width: "100%" }}
          placeholder={which === "postfix" ? "kg, g, ml, L" : "$, \u20ac, \u00a3"}
        />
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", marginTop: 4 }}>
      {row("prefix", "Prefix", "$")}
      {row("postfix", "Postfix", "kg")}
      <span style={{ fontSize: 9.5, color: "var(--text-faint)" }}>
        Choices let each row pick its own label. The number itself never changes —
        so don\u2019t put units on a field that gets summed as money.
      </span>
    </div>
  );
}

export function FieldDetail({ field, onSave, onDelete, categoryFolders = [] }) {
  const { modulesById, fieldsById } = useGridActions();
  const [local, setLocal] = useState(field);
  const [nameError, setNameError] = useState(null);
  useMemo(() => { setLocal(field); setNameError(null); }, [field.id]);

  const setMeta = (key, val) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), [key]: val } }));

  // Field names are UNIQUE (user rule 2026-07-14: "there shouldnt be duplicate
  // field names") — duplicates break every name-based lookup (label tokens,
  // pickers, tests). Reject a save whose name collides with ANOTHER field.
  const handleSave = () => {
    const wanted = (local.name || "").trim();
    if (!wanted) { setNameError("Name can't be empty."); return; }
    const clash = Object.values(fieldsById || {}).find(
      f => f && f.id !== local.id && !f.trashed &&
        (f.name || "").trim().toLowerCase() === wanted.toLowerCase()
    );
    if (clash) {
      setNameError(`A field named "${clash.name}" already exists — field names must be unique.`);
      return;
    }
    setNameError(null);
    onSave({ ...local, name: wanted });
  };

  // Find all instances that bind this field
  const usedInModules = useMemo(
    () => Object.values(modulesById || {}).filter(
      m => (m.role || "instance") === "instance" && (m.fieldBindings || []).some(b => b.fieldId === field.id)
    ),
    [modulesById, field.id]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Row 1: Name + Type */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 120px" }}>
          <span style={labelStyle}>Name</span>
          <input
            value={local.name || ""}
            onChange={(e) => { setNameError(null); setLocal((p) => ({ ...p, name: e.target.value })); }}
            style={{ ...inputStyle, ...(nameError ? { borderColor: "var(--danger-border)" } : {}) }}
          />
          {nameError && (
            <div style={{ marginTop: 3, fontSize: 10, color: "var(--danger-text)", fontFamily: "monospace" }}>
              {nameError}
            </div>
          )}
        </div>
        <div>
          <span style={labelStyle}>Type</span>
          <select
            value={local.type}
            onChange={(e) => setLocal((p) => ({ ...p, type: e.target.value }))}
            style={{ ...inputStyle, width: "auto", minWidth: 90 }}
          >
            {["number", "text", "boolean", "select", "date", "rating", "duration", "occurrence"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {(local.type === "number" || local.type === "duration") && (
          <div style={{ flex: "0 0 70px" }}>
            <span style={labelStyle}>Unit</span>
            <input
              value={local.unit || ""}
              onChange={(e) => setLocal(p => ({ ...p, unit: e.target.value }))}
              style={{ ...inputStyle, width: 70 }}
              placeholder="e.g. kg"
            />
          </div>
        )}
        {(local.type === "number" || local.type === "duration") && (
          <AffixEditor local={local} setLocal={setLocal} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Enabled</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", paddingTop: 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={local.inputEnabled !== false}
                onChange={(e) => setLocal((p) => ({ ...p, inputEnabled: e.target.checked }))}
              />
              Input
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={local.displayEnabled === true}
                onChange={(e) => setLocal((p) => ({ ...p, displayEnabled: e.target.checked }))}
              />
              Display
            </label>
            {/* Filter auto-stamp opt-in (#60). When this is on, an empty
                value is substituted with whatever the occurrence's effective
                filter currently has for this field. Read-time only — no DB
                write. Useful for date / timeslot fields that should follow
                the active day filter without explicit stamping. */}
            <label
              title="When the stored value is empty, the field shows the current effective filter value for this field. Read-only substitution."
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={local.meta?.autoStampFromFilter === true}
                onChange={(e) => setLocal((p) => ({
                  ...p,
                  meta: { ...(p.meta || {}), autoStampFromFilter: e.target.checked },
                }))}
              />
              Auto-stamp from filter
            </label>
            {/* Flow side-button opt-in (2026-07-11). Compact pills for this
                field render the green/blue/red in/replace/out toggle beside
                the value input — the stored {value, flow} flow decides whether
                trackers add, subtract, or reset with it. Full-size inputs
                always show the toggle; this surfaces it in dense pill mode. */}
            {(local.type === "number" || local.type === "duration") && (
              <label
                title="Show the in/replace/out flow button beside this field's compact pill (green = adds, blue = replaces, red = subtracts)."
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={local.meta?.flowToggle === true}
                  onChange={(e) => setLocal((p) => ({
                    ...p,
                    meta: { ...(p.meta || {}), flowToggle: e.target.checked },
                  }))}
                />
                Flow toggle button
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Display config — target value + period for displayEnabled fields. Operations
          publish a value via UPDATE $display.<fieldId>.<itemId>; the target lives on
          the field's displayConfig and is the basis for the progress bar. */}
      {local.displayEnabled === true && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Start</span>
            <input
              type="number"
              value={local.displayConfig?.startValue ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "" ? null : Number(raw);
                setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), startValue: Number.isNaN(v) ? null : v } }));
              }}
              placeholder="0"
              style={{ ...inputStyle, width: 70 }}
              title="0% progress anchor. Counters: 0 (start low, rise to target). Countdowns: same as target's high end (e.g. 10 if you start with 10 tasks). Defaults to 0."
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Target</span>
            <input
              type="number"
              value={local.displayConfig?.targetValue ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "" ? null : Number(raw);
                setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), targetValue: Number.isNaN(v) ? null : v } }));
              }}
              placeholder="e.g. 64"
              style={{ ...inputStyle, width: 90 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Op</span>
            <select
              value={local.displayConfig?.targetOp || ">="}
              onChange={(e) => setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), targetOp: e.target.value } }))}
              style={{ ...inputStyle, width: "auto", minWidth: 70 }}
              title="≥ for counters (met when value ≥ target). ≤ for countdowns (met when value ≤ target)."
            >
              <option value=">=">≥</option>
              <option value="<=">≤</option>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value="==">=</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Period</span>
            <select
              value={local.displayConfig?.targetPeriod || "daily"}
              onChange={(e) => setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), targetPeriod: e.target.value } }))}
              style={{ ...inputStyle, width: "auto", minWidth: 100 }}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Arrows</span>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer", paddingTop: 2 }}>
              <input
                type="checkbox"
                checked={local.displayConfig?.showArrows === true}
                onChange={(e) => setLocal((p) => ({ ...p, displayConfig: { ...(p.displayConfig || {}), showArrows: e.target.checked } }))}
              />
              show
            </label>
          </div>
        </div>
      )}

      {/* Columns config — for display fields that return array values (e.g. Books Read showing label + pages) */}
      {local.displayEnabled === true && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Columns (for array values)</span>
          <ColumnEditor
            columns={local.displayConfig?.columns || []}
            onChange={(columns) => setLocal(p => ({ ...p, displayConfig: { ...(p.displayConfig || {}), columns } }))}
          />
        </div>
      )}

      {/* Category */}
      {categoryFolders.length > 0 && (
        <div>
          <span style={labelStyle}>Category</span>
          <select
            value={local.folderId || ""}
            onChange={(e) => setLocal((p) => ({ ...p, folderId: e.target.value || null }))}
            style={{ ...inputStyle, width: "auto", minWidth: 120 }}
          >
            <option value="">Uncategorized</option>
            {categoryFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Options source editor — select and occurrence fields */}
      {["select", "occurrence"].includes(local.type) && (
        <div>
          <span style={labelStyle}>Options source</span>
          <SelectOptionsSourceEditor
            source={local.meta?.optionsSource || { mode: "manual", values: [] }}
            fieldType={local.type}
            onChange={(next) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), optionsSource: next } }))}
          />
        </div>
      )}

      {/* Prefill — occurrence fields only: a pick copies values onto what you're editing */}
      {local.type === "occurrence" && (
        <div>
          <span style={labelStyle}>When something is picked</span>
          <PrefillEditor
            prefill={local.meta?.prefill}
            fields={Object.values(fieldsById || {})}
            onChange={(next) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), prefill: next } }))}
          />
        </div>
      )}

      {/* Used In — reverse lookup of all instances binding this field */}
      <div>
        <span style={labelStyle}>
          Used in {usedInModules.length > 0 ? `(${usedInModules.length})` : "— not bound to any instance"}
        </span>
        {usedInModules.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {usedInModules.map(m => (
              <span
                key={m.id}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  padding: "2px 8px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
                  background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)",
                  color: "rgb(216,180,254)",
                }}
                title={`Role: ${m.role || "instance"} — id: ${m.id}`}
              >
                {m.label || m.id}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
            color: "var(--accent-blue-text)", cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "4px 14px", borderRadius: 5, fontSize: 11, fontFamily: "monospace",
            background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
            color: "var(--danger-text)", cursor: "pointer",
          }}
        >
          <Trash2 style={{ width: 10, height: 10, display: "inline", marginRight: 4 }} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================
// FIELDS TAB — pills in a wrapping flex row
// ============================================================
export function FieldsTab() {
  const ctx = useGridActions();
  const { state, fieldsById, foldersById, socket, dispatch } = ctx;
  const gridId = state?.gridId;

  const gridFields = useMemo(
    () => (state?.fields || []).filter((f) => f.gridId === gridId),
    [state?.fields, gridId]
  );

  // Category folders for the FIELD axis. `categoryKind` is stamped at
  // creation (2026-07-13 — identity as data; OperationsTab mirrors this for
  // "op"); LEGACY folders (null, pre-stamp) fall back to the contents
  // inference: a folder holding ops but no fields is an op category → not a
  // field column (before this, every op category — Trackers, Alarms, … —
  // rendered here as an empty column).
  const categoryFolders = useMemo(() => {
    const fieldFolderIds = new Set(Object.values(fieldsById || {}).map((f) => f?.folderId).filter(Boolean));
    const opFolderIds = new Set(Object.values(ctx?.operationsById || {}).map((o) => o?.folderId).filter(Boolean));
    return Object.values(foldersById || {})
      .filter((f) => f.gridId === gridId && f.folderType === "category")
      .filter((f) => f.categoryKind
        ? f.categoryKind === "field"
        : (fieldFolderIds.has(f.id) || !opFolderIds.has(f.id)))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [foldersById, gridId, fieldsById, ctx?.operationsById]);

  // Group fields by folderId
  const fieldsByFolder = useMemo(() => {
    const groups = { uncategorized: [] };
    for (const f of categoryFolders) groups[f.id] = [];
    for (const field of gridFields) {
      const key = field.folderId && groups[field.folderId] !== undefined ? field.folderId : "uncategorized";
      groups[key].push(field);
    }
    return groups;
  }, [gridFields, categoryFolders]);

  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const selectedField = selectedFieldId ? fieldsById?.[selectedFieldId] : null;
  const [dragFieldId, setDragFieldId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  // Track Pragmatic DnD field drags so column HTML5 onDrop can read the dragged field
  useEffect(() => {
    return monitorForElements({
      onDragStart({ source }) {
        if (source.data?.type === "field") setDragFieldId(source.data.id);
      },
      onDrop() { setDragFieldId(null); setOverColumn(null); },
    });
  }, []);

  const handleCreate = (folderId = null) => {
    // Unique default name — two quick "+ Field" clicks must not mint two
    // "New Field"s (field names are unique, 2026-07-14 rule).
    const taken = new Set(Object.values(fieldsById || {})
      .map((f) => (f?.name || "").trim().toLowerCase()));
    let name = "New Field";
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New Field ${n}`;
    const newField = { id: uid(), gridId, name, type: "number", inputEnabled: true, displayEnabled: false, folderId, meta: {} };
    CommitHelpers.createField({ dispatch, socket, field: newField });
    setSelectedFieldId(newField.id);
  };

  const handleCreateCategory = () => {
    const folder = { id: uid(), gridId, name: "New Category", folderType: "category", categoryKind: "field", sortOrder: categoryFolders.length, isExpanded: true };
    CommitHelpers.createFolder({ dispatch, socket, folder });
  };

  const handleDropOnFolder = (folderId) => {
    if (!dragFieldId) return;
    const field = fieldsById?.[dragFieldId];
    if (field) CommitHelpers.updateField({ dispatch, socket, field: { ...field, folderId: folderId || null } });
    setDragFieldId(null);
    setOverColumn(null);
  };

  const toggleSelect = (fieldId) =>
    setSelectedFieldId((prev) => (prev === fieldId ? null : fieldId));

  const colBase = {
    minWidth: 140,
    flex: "0 0 auto",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    transition: "background 0.15s, border-color 0.15s",
  };

  const colStyle = (isOver) => ({
    ...colBase,
    border: `1px solid ${isOver ? "var(--accent-blue-border)" : "var(--border-subtle)"}`,
    background: isOver ? "var(--accent-blue-bg)" : "var(--input-bg)",
  });

  const addBtnStyle = {
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 7px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
    background: "none", border: "1px dashed var(--border-default)",
    color: "var(--text-faint)", cursor: "pointer", alignSelf: "flex-start",
  };

  const renderCategoryColumn = (colKey, label, fields, folderObj) => (
    <div
      key={colKey}
      style={colStyle(overColumn === colKey)}
      onDragOver={(e) => { e.preventDefault(); setOverColumn(colKey); }}
      onDragLeave={() => setOverColumn(null)}
      onDrop={(e) => { e.preventDefault(); handleDropOnFolder(colKey === "uncategorized" ? null : colKey); }}
    >
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        {folderObj ? (
          <input
            defaultValue={label}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== label) CommitHelpers.updateFolder({ dispatch, socket, folder: { ...folderObj, name: newName } });
            }}
            style={{ background: "none", border: "none", outline: "none", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", width: "100%", cursor: "text" }}
          />
        ) : (
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>{label}</span>
        )}
      </div>

      {/* Field chips — scrollable list, draggable to instance OR between columns */}
      <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {fields.map((field) => (
          <FieldPill
            key={field.id}
            field={field}
            compact
            selected={selectedFieldId === field.id}
            onClick={() => toggleSelect(field.id)}
          />
        ))}
        {fields.length === 0 && (
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", fontStyle: "italic" }}>
            drag fields here
          </span>
        )}
      </div>

      {/* + Field button */}
      <button style={addBtnStyle} onClick={() => handleCreate(colKey === "uncategorized" ? null : colKey)}>
        <Plus style={{ width: 8, height: 8 }} /> Field
      </button>
    </div>
  );

  // Drill-down: if a field is selected, show editor full-pane with back button
  if (selectedField) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Back bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)", position: "sticky", top: 0, zIndex: 2 }}>
          <button
            onClick={() => setSelectedFieldId(null)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <ChevronLeft style={{ width: 11, height: 11 }} /> Fields
          </button>
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>{selectedField.name}</span>
        </div>
        {/* Editor content */}
        <div style={{ padding: "10px 14px" }}>
          <FieldDetail
            field={selectedField}
            categoryFolders={categoryFolders}
            onSave={(updated) => CommitHelpers.updateField({ dispatch, socket, field: updated })}
            onDelete={() => {
              CommitHelpers.deleteField({ dispatch, socket, fieldId: selectedFieldId });
              setSelectedFieldId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={handleCreateCategory}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px dashed var(--border-default)", color: "var(--text-muted)", cursor: "pointer" }}
        >
          <FolderPlus style={{ width: 10, height: 10 }} /> Category
        </button>
      </div>

      {/* Category columns */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
        {renderCategoryColumn("uncategorized", "Uncategorized", fieldsByFolder.uncategorized, null)}
        {categoryFolders.map((folder) =>
          renderCategoryColumn(folder.id, folder.name, fieldsByFolder[folder.id] || [], folder)
        )}
      </div>
    </div>
  );
}
