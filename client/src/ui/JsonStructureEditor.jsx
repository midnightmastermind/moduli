// ui/JsonStructureEditor.jsx
//
// Generic recursive editor for arbitrary structured data (JS values).
// Lets users author objects + arrays + primitives in a node-tree UI,
// no JSON typing required. Each node renders:
//   - a TYPE pill (str / num / bool / null / arr / obj)
//   - an INPUT appropriate to the type, OR child rows for arr/obj
//   - a REMOVE button on hover
//
// Not specific to any feature — used wherever a pipeline cfg wants
// structured data (display-rules at the top of an operation is the
// first caller, but the editor knows nothing about rules).
//
// Props:
//   value     — current value (any JS value)
//   onChange  — (next) => void
//   rootLabel — optional label rendered above the root container
//
// Storage convention: when wired through `ExprOrPath`'s structured
// mode, the editor's value is serialized via `JSON.stringify` and
// stored on the pipeline cfg as `json:<stringified>` so the existing
// `json:` prefix handler in `resolveExpr` parses it back at runtime.

import React, { useState, useCallback } from "react";
import { Plus, Trash2, ChevronRight, ChevronDown, ArrowUp, ArrowDown } from "lucide-react";

// ─── Type plumbing ─────────────────────────────────────────────────

const TYPES = ["string", "number", "boolean", "null", "array", "object"];
const TYPE_LABEL = {
  string:  "str",
  number:  "num",
  boolean: "bool",
  null:    "null",
  array:   "[ ]",
  object:  "{ }",
};
const TYPE_COLOR = {
  string:  "rgb(134,239,172)",   // green
  number:  "rgb(96,165,250)",    // blue
  boolean: "rgb(252,211,77)",    // amber
  null:    "rgb(148,163,184)",   // slate
  array:   "rgb(196,181,253)",   // violet
  object:  "rgb(252,165,165)",   // rose
};

function detectType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function emptyForType(t) {
  switch (t) {
    case "string":  return "";
    case "number":  return 0;
    case "boolean": return false;
    case "null":    return null;
    case "array":   return [];
    case "object":  return {};
    default:        return null;
  }
}

// Try to keep the existing data when the user switches types. Falls
// back to emptyForType when coercion doesn't make sense.
function coerceTo(v, t) {
  if (detectType(v) === t) return v;
  if (t === "string")  return v == null ? "" : String(v);
  if (t === "number")  { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  if (t === "boolean") return !!v;
  if (t === "null")    return null;
  return emptyForType(t);
}

// ─── Inline styles ─────────────────────────────────────────────────

const ROW = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "2px 0", fontFamily: "var(--font-mono)", fontSize: 11,
};
const PILL = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 18, padding: "0 6px", borderRadius: 4, cursor: "pointer",
  fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
  border: "1px solid var(--border-default)",
  background: "var(--input-bg)", flexShrink: 0, userSelect: "none",
};
const INPUT = {
  height: 22, padding: "0 6px", fontSize: 11,
  border: "1px solid var(--border-default)",
  background: "var(--input-bg)", color: "var(--text-primary)",
  borderRadius: 4, fontFamily: "var(--font-mono)", minWidth: 0,
};
const ICON_BTN = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: 3, border: "none",
  background: "transparent", color: "var(--text-muted)",
  cursor: "pointer", flexShrink: 0,
};
const INDENT_GUIDE = {
  borderLeft: "1px dashed var(--border-default)",
  marginLeft: 10, paddingLeft: 8,
};

// ─── Type pill (click to cycle / pick) ─────────────────────────────

function TypePill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const t = detectType(value);
  return (
    <span style={{ position: "relative", flexShrink: 0 }}>
      <span
        title="Change type"
        onClick={() => setOpen(o => !o)}
        style={{ ...PILL, color: TYPE_COLOR[t], borderColor: TYPE_COLOR[t] + "40" }}
      >
        {TYPE_LABEL[t]}
      </span>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 100,
            background: "var(--surface, #1f2125)", border: "1px solid var(--border-default)",
            borderRadius: 4, padding: 2, display: "flex", flexDirection: "column", gap: 1,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}>
            {TYPES.map(tt => (
              <button
                key={tt}
                onClick={() => { onChange(coerceTo(value, tt)); setOpen(false); }}
                style={{
                  ...PILL, height: 20, justifyContent: "flex-start", gap: 6,
                  border: "none", background: tt === t ? "rgba(255,255,255,0.05)" : "transparent",
                  color: TYPE_COLOR[tt], minWidth: 64, paddingRight: 8,
                }}
              >
                {TYPE_LABEL[tt]}
                <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: 9 }}>{tt}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// ─── Primitive value input ─────────────────────────────────────────

function PrimitiveInput({ value, onChange }) {
  const t = detectType(value);
  if (t === "null") {
    return <span style={{ ...INPUT, color: "var(--text-faint)", fontStyle: "italic" }}>null</span>;
  }
  if (t === "boolean") {
    return (
      <button
        onClick={() => onChange(!value)}
        style={{ ...INPUT, cursor: "pointer", color: value ? "rgb(134,239,172)" : "rgb(252,165,165)" }}
      >
        {value ? "true" : "false"}
      </button>
    );
  }
  if (t === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={e => { const n = Number(e.target.value); onChange(Number.isFinite(n) ? n : 0); }}
        style={{ ...INPUT, width: 100 }}
      />
    );
  }
  // string (default)
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      style={{ ...INPUT, flex: 1, minWidth: 60 }}
    />
  );
}

// ─── Recursive node ────────────────────────────────────────────────

function Node({ value, onChange, onRemove, keyName, onRenameKey, indexInArray, onMoveItem, isLast }) {
  const t = detectType(value);
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [draftKey, setDraftKey] = useState(keyName ?? "");

  const commitRename = useCallback(() => {
    setRenaming(false);
    if (draftKey && draftKey !== keyName) onRenameKey?.(draftKey);
    else setDraftKey(keyName ?? "");
  }, [draftKey, keyName, onRenameKey]);

  // Key/index column on the left of every row.
  const keyCol = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, minWidth: 60 }}>
      {indexInArray != null && (
        <>
          <button
            title="Move up"
            disabled={indexInArray === 0}
            onClick={() => onMoveItem?.(-1)}
            style={{ ...ICON_BTN, opacity: indexInArray === 0 ? 0.25 : 0.7 }}
          >
            <ArrowUp size={11} />
          </button>
          <button
            title="Move down"
            disabled={isLast}
            onClick={() => onMoveItem?.(+1)}
            style={{ ...ICON_BTN, opacity: isLast ? 0.25 : 0.7 }}
          >
            <ArrowDown size={11} />
          </button>
          <span style={{ color: "var(--text-faint)", fontSize: 10, minWidth: 16, textAlign: "right" }}>
            {indexInArray}
          </span>
        </>
      )}
      {keyName != null && (
        renaming ? (
          <input
            autoFocus
            value={draftKey}
            onChange={e => setDraftKey(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setRenaming(false); setDraftKey(keyName); } }}
            style={{ ...INPUT, width: 110, height: 20 }}
          />
        ) : (
          <span
            onClick={() => setRenaming(true)}
            title="Rename key"
            style={{ color: "var(--text-primary)", cursor: "text", padding: "1px 4px", borderRadius: 3 }}
          >
            "{keyName}"
          </span>
        )
      )}
    </span>
  );

  if (t === "object" || t === "array") {
    const isArr = t === "array";
    const entries = isArr
      ? value.map((v, i) => ({ k: i, v }))
      : Object.entries(value).map(([k, v]) => ({ k, v }));
    const count = entries.length;
    const previewLabel = isArr ? `[ ${count} ]` : `{ ${count} }`;

    return (
      <div>
        <div style={ROW}>
          {keyCol}
          <button
            title={open ? "Collapse" : "Expand"}
            onClick={() => setOpen(o => !o)}
            style={{ ...ICON_BTN, color: "var(--text-muted)" }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <TypePill value={value} onChange={onChange} />
          <span style={{ color: "var(--text-faint)", fontSize: 10 }}>{previewLabel}</span>
          <span style={{ flex: 1 }} />
          <button
            title={isArr ? "Add item" : "Add key"}
            onClick={() => {
              if (isArr) onChange([...value, ""]);
              else {
                const baseKey = "newKey";
                let k = baseKey, i = 1;
                while (k in value) k = `${baseKey}${i++}`;
                onChange({ ...value, [k]: "" });
              }
            }}
            style={{ ...ICON_BTN, color: "var(--accent-blue, #60a5fa)" }}
          >
            <Plus size={12} />
          </button>
          {onRemove && (
            <button title="Remove" onClick={onRemove} style={{ ...ICON_BTN, color: "var(--danger-text)" }}>
              <Trash2 size={11} />
            </button>
          )}
        </div>
        {open && entries.length > 0 && (
          <div style={INDENT_GUIDE}>
            {entries.map(({ k, v }, idx) => (
              <Node
                key={isArr ? `${idx}` : `k:${k}`}
                value={v}
                keyName={isArr ? null : k}
                indexInArray={isArr ? idx : null}
                isLast={idx === entries.length - 1}
                onChange={(nv) => {
                  if (isArr) {
                    const next = value.slice();
                    next[idx] = nv;
                    onChange(next);
                  } else {
                    onChange({ ...value, [k]: nv });
                  }
                }}
                onRemove={() => {
                  if (isArr) onChange(value.filter((_, i) => i !== idx));
                  else { const next = { ...value }; delete next[k]; onChange(next); }
                }}
                onRenameKey={(newK) => {
                  if (isArr) return;
                  if (!newK || newK === k || newK in value) return;
                  // Preserve key order: rebuild the object so the renamed
                  // key stays in its original position.
                  const next = {};
                  for (const [kk, vv] of Object.entries(value)) {
                    next[kk === k ? newK : kk] = vv;
                  }
                  onChange(next);
                }}
                onMoveItem={(dir) => {
                  if (!isArr) return;
                  const j = idx + dir;
                  if (j < 0 || j >= value.length) return;
                  const next = value.slice();
                  [next[idx], next[j]] = [next[j], next[idx]];
                  onChange(next);
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Primitive node
  return (
    <div style={ROW}>
      {keyCol}
      <TypePill value={value} onChange={onChange} />
      <PrimitiveInput value={value} onChange={onChange} />
      <span style={{ flex: 1 }} />
      {onRemove && (
        <button title="Remove" onClick={onRemove} style={{ ...ICON_BTN, color: "var(--danger-text)" }}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ─── Root component ────────────────────────────────────────────────

export default function JsonStructureEditor({ value, onChange, rootLabel }) {
  // Normalize undefined to null so detectType etc. behave.
  const v = value === undefined ? null : value;
  return (
    <div style={{
      border: "1px solid var(--border-subtle)",
      borderRadius: 6,
      padding: 8,
      background: "var(--surface-base, rgba(255,255,255,0.02))",
      fontFamily: "var(--font-mono)",
    }}>
      {rootLabel && (
        <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4 }}>
          {rootLabel}
        </div>
      )}
      <Node value={v} onChange={onChange} />
    </div>
  );
}
