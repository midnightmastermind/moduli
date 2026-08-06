// ui/commandCenter/PrefillEditor.jsx
// Configures what a dropdown PICK fills in (helpers/prefillFromPick).
//
// Occurrence fields only — a select of plain strings has no occurrence to pull
// values from. Every row is "read THIS field on the thing I picked, write it to
// THAT field on the thing I'm editing", plus how several picks collapse.
//
// The policy this UI must not pretend otherwise about (settled with the user):
// a pick ALWAYS overwrites, and a filled value carries no marker. So there is
// nothing here about "only fill empty" or "show provenance" — those decisions
// were made, not deferred.
import React, { useMemo } from "react";
import { Plus, X, ArrowRight } from "lucide-react";
import { COMBINERS } from "../../helpers/prefillFromPick";

const rowStyle = { display: "flex", alignItems: "center", gap: 4, marginBottom: 4 };
const selStyle = {
  flex: 1, minWidth: 0, background: "var(--input-bg)", color: "var(--text-primary)",
  border: "1px solid var(--input-border)", borderRadius: 4, fontSize: 10,
  padding: "3px 4px", fontFamily: "var(--font-mono)",
};
const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 6px",
  background: "none", border: "1px dashed var(--border-default)", borderRadius: 4,
  color: "var(--text-muted)", cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)",
};

const COMBINE_LABEL = {
  replace: "take the first",
  sum: "add up",
  avg: "average",
  min: "smallest",
  max: "largest",
  concat: "join as text",
  union: "combine the lists",
};

export default function PrefillEditor({ prefill, fields, onChange }) {
  const cfg = prefill || { enabled: false, map: [], chain: 0 };
  const map = Array.isArray(cfg.map) ? cfg.map : [];

  const sorted = useMemo(
    () => [...(fields || [])].filter(f => !f.trashed).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fields]
  );
  const nameOf = (id) => sorted.find(f => f.id === id)?.name || "—";

  const patch = (next) => onChange({ ...cfg, ...next });
  const setRow = (i, row) => patch({ map: map.map((r, j) => (j === i ? row : r)) });

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={cfg.enabled === true}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span style={{ fontSize: 11, color: "var(--text-primary)" }}>Fill fields when something is picked</span>
      </label>

      {cfg.enabled && (
        <>
          <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 6, lineHeight: 1.4 }}>
            Picking here copies these values onto the occurrence you are editing. Only fields that
            occurrence ALREADY carries are filled — this never adds a field to it. A pick always
            overwrites, including a value you typed by hand.
          </div>

          {map.length === 0 && (
            <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6 }}>
              Nothing is copied yet.
            </div>
          )}

          {map.map((row, i) => (
            <div key={i} style={rowStyle}>
              <select
                style={selStyle}
                value={row.from || ""}
                onChange={(e) => setRow(i, { ...row, from: e.target.value })}
                title="Read this field on the thing you picked"
              >
                <option value="">read…</option>
                {sorted.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <ArrowRight size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
              <select
                style={selStyle}
                value={row.to || ""}
                onChange={(e) => setRow(i, { ...row, to: e.target.value || undefined })}
                title="Write it to this field on what you are editing (defaults to the same field)"
              >
                <option value="">same field ({nameOf(row.from)})</option>
                {sorted.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select
                style={{ ...selStyle, flex: "0 0 110px" }}
                value={row.combine || "replace"}
                onChange={(e) => setRow(i, { ...row, combine: e.target.value })}
                title="How several picks collapse into one value"
              >
                {Object.keys(COMBINERS).map(k => (
                  <option key={k} value={k}>{COMBINE_LABEL[k] || k}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => patch({ map: map.filter((_, j) => j !== i) })}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 2 }}
                title="Remove"
              >
                <X size={11} />
              </button>
            </div>
          ))}

          <button type="button" style={btnStyle} onClick={() => patch({ map: [...map, { from: "", combine: "replace" }] })}>
            <Plus size={10} /> Copy a field
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Keep going</span>
            <input
              type="number"
              min={0}
              max={4}
              value={Number(cfg.chain) || 0}
              onChange={(e) => patch({ chain: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })}
              style={{ ...selStyle, flex: "0 0 56px" }}
            />
            <span style={{ fontSize: 9, color: "var(--text-faint)", flex: 1, lineHeight: 1.35 }}>
              hops. 0 = just these fields. 1 lets a filled dropdown fill its own fields too —
              picking a meal fills the ingredients, and the ingredients fill their nutrition.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
