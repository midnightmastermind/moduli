// ui/LayoutCascadeEditor.jsx — Reusable layout-cascade editor
// ============================================================
// Mirrors `StyleEditor.jsx` for layout-cascade rules
// (see `helpers/layoutCascade.js`). Six rule keys:
//
//   - dragInView          ("preview" | "representation" | "actual")
//   - navOptions          subset of the three view modes
//   - navAllowChange      boolean
//   - locked              boolean
//   - showFieldsByDefault boolean
//   - representationFieldIds  (inline-chip whitelist for Representation view —
//                              user-asked extension from task #35)
//
// The editor can be used:
//   - at the grid level (writes `grid.meta.layoutCascadeDefaults`)
//   - at panel / page / container level (writes `occ.meta.layoutCascade`)
//   - at the leaf level (writes `occ.meta.layoutCascadeOverride`)
//
// All four storage shapes are partial objects — keys the user didn't set
// pass through from the cascade. Inherit mode wipes the storage; Own mode
// persists the partial.
//
// Props:
//   value:         the stored partial (e.g. occ.meta.layoutCascade)
//   onChange:      (next) => void; receives the full partial (or null to clear)
//   cascade:       optional { levels, resolved } from resolveLayoutCascade
//   label:         section heading
//   inheritLabel:  what this level inherits from (e.g. "Panel default")
//   showRepresentationFieldIds: when true, surface the chip-fields list
//   fieldsList:    Array<{ id, name }> — used by the chip-fields multi-pick

import React, { useCallback } from "react";

const VIEW_MODES = ["preview", "representation", "actual"];
const VIEW_MODE_LABELS = { preview: "Preview", representation: "Representation", actual: "Actual" };

export default function LayoutCascadeEditor({
  value,
  onChange,
  cascade,
  label = "Layout cascade",
  inheritLabel = "Parent",
  showRepresentationFieldIds = true,
  fieldsList = [],
}) {
  const mode = (value && Object.keys(value).length > 0) ? "own" : "inherit";
  const cur = value || {};

  const patch = useCallback((next) => {
    if (!next || Object.keys(next).filter(k => next[k] != null).length === 0) {
      onChange?.(null);
      return;
    }
    onChange?.(next);
  }, [onChange]);

  const setKey = useCallback((key, v) => {
    const next = { ...cur };
    if (v == null) delete next[key];
    else next[key] = v;
    patch(next);
  }, [cur, patch]);

  const toggleMode = useCallback(() => {
    if (mode === "own") {
      onChange?.(null);
    } else {
      // Seed with current resolved values so the user has a starting point.
      const r = cascade?.resolved || {};
      const seed = {};
      if (r.dragInView) seed.dragInView = r.dragInView;
      if (Array.isArray(r.navOptions)) seed.navOptions = r.navOptions;
      if (typeof r.navAllowChange === "boolean") seed.navAllowChange = r.navAllowChange;
      if (typeof r.locked === "boolean") seed.locked = r.locked;
      if (typeof r.showFieldsByDefault === "boolean") seed.showFieldsByDefault = r.showFieldsByDefault;
      if (typeof r.stickyHeaders === "boolean") seed.stickyHeaders = r.stickyHeaders;
      // Seed the layout shape too, so switching to Own starts from what is
      // on screen rather than snapping the board back to a stacked default.
      if (r.mode) seed.mode = r.mode;
      if (Number.isFinite(r.columns)) seed.columns = r.columns;
      if (Number.isFinite(r.childGap)) seed.childGap = r.childGap;
      onChange?.(seed);
    }
  }, [mode, onChange, cascade]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontWeight: 600 }}>
          {label}
        </span>
        <button
          type="button"
          onClick={toggleMode}
          style={{
            padding: "2px 7px", borderRadius: 4,
            background: mode === "own" ? "var(--accent-blue-bg)" : "var(--input-bg)",
            border: `1px solid ${mode === "own" ? "var(--accent-blue-text)" : "var(--border-subtle)"}`,
            color: mode === "own" ? "var(--accent-blue-text)" : "var(--text-muted)",
            fontSize: 9, fontFamily: "var(--font-mono)", cursor: "pointer",
          }}
        >
          {mode === "own" ? "Own (clear to inherit)" : `Inherit (${inheritLabel})`}
        </button>
      </div>

      {/* Read-only cascade view */}
      {cascade?.levels && cascade.levels.length > 0 ? (
        <div style={{
          padding: 6, borderRadius: 4,
          background: "var(--surface, rgba(255,255,255,0.02))",
          border: "1px solid var(--border-subtle)",
          display: "flex", flexDirection: "column", gap: 3,
          fontSize: 9, fontFamily: "var(--font-mono)",
        }}>
          <div style={{ color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Inherited cascade
          </div>
          {cascade.levels.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 4, color: "var(--text-muted)" }}>
              <span style={{ color: "var(--text-faint)", minWidth: 72 }}>{l.label}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summarize(l.contribution)}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 4, marginTop: 4, paddingTop: 4, borderTop: "1px dashed var(--border-subtle)" }}>
            <span style={{ color: "var(--accent-blue-text)", minWidth: 72 }}>Resolved</span>
            <span style={{ flex: 1, color: "var(--text-primary)" }}>{summarize(cascade.resolved)}</span>
          </div>
        </div>
      ) : null}

      {/* Editor controls — only shown in own mode */}
      {mode === "own" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* How this surface arranges its children. Consumed by PageBoard —
              "Columns" is the side-by-side layout the Schedule uses. */}
          <RuleRadio
            label="Arrangement"
            value={cur.mode ?? null}
            onChange={(v) => setKey("mode", v)}
            options={[
              { value: null, label: "—" },
              { value: "stack", label: "Stack" },
              { value: "flex-row", label: "Columns" },
              { value: "grid", label: "Grid" },
            ]}
          />
          {cur.mode === "grid" ? (
            <RuleNumber
              label="Grid columns"
              value={cur.columns ?? null}
              onChange={(v) => setKey("columns", v)}
              min={1}
              max={12}
            />
          ) : null}
          <RuleNumber
            label="Gap (px)"
            value={cur.childGap ?? null}
            onChange={(v) => setKey("childGap", v)}
            min={0}
            max={64}
          />
          <RuleSelect
            label="Order by"
            value={cur.sortChildrenByField ?? null}
            onChange={(v) => setKey("sortChildrenByField", v)}
            options={[
              { value: null, label: "Manual order" },
              ...fieldsList.map(f => ({ value: f.id, label: f.name })),
            ]}
          />
          <RuleRadio
            label="Drag-in view"
            value={cur.dragInView ?? null}
            onChange={(v) => setKey("dragInView", v)}
            options={[
              { value: null, label: "—" },
              { value: "preview", label: "Preview" },
              { value: "representation", label: "Repr" },
              { value: "actual", label: "Actual" },
            ]}
          />
          <RuleCheckboxes
            label="Nav options"
            values={cur.navOptions ?? []}
            onChange={(v) => setKey("navOptions", v.length === 0 ? null : v)}
            options={VIEW_MODES.map(m => ({ value: m, label: VIEW_MODE_LABELS[m] }))}
          />
          <RuleSwitch
            label="Allow change"
            value={cur.navAllowChange ?? null}
            onChange={(v) => setKey("navAllowChange", v)}
            tooltip="When off, the view-mode switcher is hidden."
          />
          <RuleSwitch
            label="Locked"
            value={cur.locked ?? null}
            onChange={(v) => setKey("locked", v)}
            tooltip="When on, children can't be dragged out of this surface."
          />
          <RuleSwitch
            label="Show fields"
            value={cur.showFieldsByDefault ?? null}
            onChange={(v) => setKey("showFieldsByDefault", v)}
            tooltip="Whether Representation chips show inline field chips by default."
          />
          <RuleSwitch
            label="Sticky header"
            value={cur.stickyHeaders ?? null}
            onChange={(v) => setKey("stickyHeaders", v)}
            tooltip="Pin the container header to the top of the scroll region as you scroll past it. Cascades to descendants until overridden."
          />
          {showRepresentationFieldIds ? (
            <RuleFieldList
              label="Repr fields"
              value={cur.representationFieldIds ?? null}
              onChange={(v) => setKey("representationFieldIds", v && v.length === 0 ? null : v)}
              fieldsList={fieldsList}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RuleRadio({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78 }}>{label}</span>
      <div style={{ display: "inline-flex", gap: 2 }}>
        {options.map(opt => {
          const active = (opt.value ?? null) === (value ?? null);
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                padding: "1px 5px", borderRadius: 3,
                background: active ? "var(--accent-blue-bg)" : "var(--input-bg)",
                border: `1px solid ${active ? "var(--accent-blue-text)" : "var(--border-subtle)"}`,
                color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
                fontSize: 9, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleNumber({ label, value, onChange, min = 0, max = 99 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78 }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") { onChange(null); return; }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        style={{
          width: 56, padding: "1px 5px", borderRadius: 3,
          background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)", fontSize: 9, fontFamily: "var(--font-mono)",
        }}
      />
    </div>
  );
}

function RuleSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78 }}>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
          flex: 1, minWidth: 0, padding: "1px 4px", borderRadius: 3,
          background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
          color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)",
        }}
      >
        {options.map(o => (
          <option key={o.value ?? "__none"} value={o.value ?? ""}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function RuleCheckboxes({ label, values, onChange, options }) {
  const set = new Set(values || []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78 }}>{label}</span>
      <div style={{ display: "inline-flex", gap: 2 }}>
        {options.map(opt => {
          const active = set.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const next = new Set(set);
                if (active) next.delete(opt.value);
                else next.add(opt.value);
                onChange(Array.from(next));
              }}
              style={{
                padding: "1px 5px", borderRadius: 3,
                background: active ? "var(--accent-blue-bg)" : "var(--input-bg)",
                border: `1px solid ${active ? "var(--accent-blue-text)" : "var(--border-subtle)"}`,
                color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
                fontSize: 9, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleSwitch({ label, value, onChange, tooltip }) {
  // Tri-state: null (unset) / true / false. Cycle on click.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }} title={tooltip || undefined}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78 }}>{label}</span>
      <button
        type="button"
        onClick={() => {
          if (value == null) onChange(true);
          else if (value === true) onChange(false);
          else onChange(null);
        }}
        style={{
          padding: "1px 7px", borderRadius: 3,
          background: value === true ? "var(--accent-blue-bg)" : value === false ? "rgba(248,113,113,0.12)" : "var(--input-bg)",
          border: `1px solid ${value === true ? "var(--accent-blue-text)" : value === false ? "rgba(248,113,113,0.4)" : "var(--border-subtle)"}`,
          color: value === true ? "var(--accent-blue-text)" : value === false ? "rgb(248,113,113)" : "var(--text-muted)",
          fontSize: 9, fontFamily: "var(--font-mono)", cursor: "pointer", minWidth: 38,
        }}
      >
        {value === true ? "On" : value === false ? "Off" : "—"}
      </button>
    </div>
  );
}

function RuleFieldList({ label, value, onChange, fieldsList }) {
  const set = new Set(Array.isArray(value) ? value : []);
  const opts = (fieldsList || []).slice(0, 40);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-faint)", minWidth: 78, marginTop: 2 }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, flex: 1 }}>
        {opts.map(f => {
          const active = set.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                const next = new Set(set);
                if (active) next.delete(f.id);
                else next.add(f.id);
                onChange(Array.from(next));
              }}
              style={{
                padding: "1px 5px", borderRadius: 3,
                background: active ? "var(--accent-blue-bg)" : "var(--input-bg)",
                border: `1px solid ${active ? "var(--accent-blue-text)" : "var(--border-subtle)"}`,
                color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
                fontSize: 9, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              {f.name}
            </button>
          );
        })}
        {opts.length === 0 ? (
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontStyle: "italic" }}>(no fields on grid)</span>
        ) : null}
      </div>
    </div>
  );
}

const MODE_LABELS = { stack: "stack", "flex-row": "columns", grid: "grid" };

function summarize(rule) {
  if (!rule) return "—";
  const parts = [];
  if (rule.mode) parts.push(MODE_LABELS[rule.mode] || rule.mode);
  if (rule.mode === "grid" && Number.isFinite(rule.columns)) parts.push(`${rule.columns}col`);
  if (Number.isFinite(rule.childGap)) parts.push(`gap ${rule.childGap}`);
  if (rule.sortChildrenByField) parts.push("sorted");
  if (rule.dragInView) parts.push(`drag→${rule.dragInView}`);
  if (Array.isArray(rule.navOptions)) parts.push(`nav[${rule.navOptions.join("/") || "—"}]`);
  if (typeof rule.navAllowChange === "boolean") parts.push(rule.navAllowChange ? "open" : "locked");
  if (rule.locked === true) parts.push("locked-children");
  if (rule.showFieldsByDefault === false) parts.push("no-fields");
  return parts.length > 0 ? parts.join(" · ") : "—";
}
