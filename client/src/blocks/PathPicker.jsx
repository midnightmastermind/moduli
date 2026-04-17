// blocks/PathPicker.jsx
// Cascading dropdown for selecting an expression path like "$item.fields.water.value".
// Each dropdown shows the available keys at that depth; selecting one reveals the next dropdown.
import React, { useMemo } from "react";

/**
 * @param {object} props
 * @param {string} props.value           — Current expression string ("$item.fields.water.value" or "")
 * @param {function} props.onChange      — Called with new expression string
 * @param {object} props.shapeByVar      — Map of available vars to their shapes: { "$item": { fields: { water: { value, flow } } }, ... }
 * @param {string} [props.placeholder]   — Placeholder dropdown label
 */
export default function PathPicker({ value, onChange, shapeByVar, placeholder = "Select…" }) {
  const parts = useMemo(() => (value ? value.split(".") : []), [value]);

  // Walk the shape tree one dropdown at a time. At each level, show keys available
  // at that depth. The user can change any segment — later segments are cleared.
  const segments = useMemo(() => {
    const result = [];
    let shape = shapeByVar;
    let isTopLevel = true;
    for (let i = 0; i <= parts.length; i++) {
      if (!shape || typeof shape !== "object") break;
      const options = Object.keys(shape).map(k => ({
        key: k,
        label: isTopLevel ? k : k,
      }));
      const selected = parts[i] ?? "";
      result.push({ options, selected });
      if (!selected) break;
      const nextShape = shape[selected];
      if (!nextShape || typeof nextShape !== "object") {
        break;
      }
      shape = nextShape;
      isTopLevel = false;
    }
    return result;
  }, [parts, shapeByVar]);

  const pickSegment = (depth, newKey) => {
    const nextParts = parts.slice(0, depth);
    if (newKey) nextParts.push(newKey);
    onChange(nextParts.join("."));
  };

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--muted)" }}>.</span>}
          <select
            value={seg.selected}
            onChange={(e) => pickSegment(i, e.target.value)}
            style={{ padding: "2px 4px", fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 3 }}
          >
            <option value="">{placeholder}</option>
            {seg.options.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Build the shape map passed to PathPicker, given the operation's sources + available fields.
 *
 * @param {object} args
 * @param {Array}  args.sources      — operation.pipeline.sources (to populate $varName entries)
 * @param {Array}  args.fields       — grid fields (to populate .fields.<fieldId>.value/flow)
 * @param {boolean} args.inLoop      — include $item if building for a rule inside a loop body
 */
export function buildPathShape({ sources = [], fields = [], inLoop = false }) {
  const fieldsShape = {};
  for (const f of fields) {
    fieldsShape[f.id] = { value: null, flow: null };
  }
  const occShape = {
    id: null,
    targetId: null,
    parentId: null,
    _ancestors: null,
    fields: fieldsShape,
  };
  const shape = {
    $now: null,
    $today: null,
    $activeDate: null,
    $iterationValue: null,
  };
  for (const src of sources) {
    if (src.variableName) {
      shape[`$${src.variableName}`] = occShape;
    }
  }
  if (inLoop) {
    shape.$item = occShape;
  }
  shape.$trigger = { occurrenceId: null, fieldId: null, value: null, occurrence: occShape, containerId: null, panelId: null };
  return shape;
}
