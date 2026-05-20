// EditorBindingSection — picker UI for a slot's editor↔field binding.
//
// A binding is { target, link }: the TARGET field's value is what renders in
// the editor slot; the LINK field's value is the JOIN match between this
// entity and the source occurrence.
//
// Scope:
//   - "module"      → caller writes to module.meta.<slot>Link (template-wide)
//   - "occurrence"  → caller writes to occurrence.meta.<slot>Link (placement-only)
// The toggle only renders when onScopeChange is provided.
import React, { useState, useEffect } from "react";

export default function EditorBindingSection({
  slot,                  // "header" | "body"
  binding,               // current { target, link } | null
  onChange,              // (next: {target,link} | null) => void
  scope,                 // "module" | "occurrence" — current scope being edited
  onScopeChange,         // (next) => void  (optional)
  fields = [],           // [{id,name,type}]
}) {
  const [target, setTarget] = useState(binding?.target || "");
  const [link, setLink] = useState(binding?.link || "");

  // Keep local state in sync if the binding prop changes (e.g. scope toggle).
  useEffect(() => {
    setTarget(binding?.target || "");
    setLink(binding?.link || "");
  }, [binding?.target, binding?.link]);

  const commit = (nextTarget, nextLink) => {
    if (nextTarget && nextLink) onChange({ target: nextTarget, link: nextLink });
  };

  const clear = () => {
    setTarget("");
    setLink("");
    onChange(null);
  };

  return (
    <div
      className="editor-binding-section"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        marginTop: 8,
        border: "1px solid var(--border-default, #333)",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {slot === "header" ? "Header binding" : "Body binding"}
      </div>

      {binding == null && (
        <div style={{ fontSize: 11, opacity: 0.55 }}>No binding</div>
      )}

      <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ opacity: 0.75 }}>Target field (shown content)</span>
        <select
          aria-label="Target field"
          value={target}
          onChange={(e) => {
            const v = e.target.value;
            setTarget(v);
            commit(v, link);
          }}
          style={{ fontSize: 12, padding: "3px 6px", background: "var(--input-bg, #1a1c20)", color: "inherit", border: "1px solid var(--input-border, #333)", borderRadius: 4 }}
        >
          <option value="">— pick —</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.type ? ` · ${f.type}` : ""}</option>
          ))}
        </select>
      </label>

      <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ opacity: 0.75 }}>Link field (JOIN match)</span>
        <select
          aria-label="Link field"
          value={link}
          onChange={(e) => {
            const v = e.target.value;
            setLink(v);
            commit(target, v);
          }}
          style={{ fontSize: 12, padding: "3px 6px", background: "var(--input-bg, #1a1c20)", color: "inherit", border: "1px solid var(--input-border, #333)", borderRadius: 4 }}
        >
          <option value="">— pick —</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.type ? ` · ${f.type}` : ""}</option>
          ))}
        </select>
      </label>

      {onScopeChange && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, marginTop: 2 }}>
          <span style={{ opacity: 0.7 }}>Scope:</span>
          <button
            type="button"
            onClick={() => onScopeChange("module")}
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 3,
              border: "1px solid var(--input-border, #333)",
              background: scope === "module" ? "var(--accent-blue-bg, rgba(59,130,246,0.15))" : "transparent",
              color: "inherit",
              cursor: "pointer",
              fontWeight: scope === "module" ? 700 : 400,
            }}
          >
            This template
          </button>
          <button
            type="button"
            onClick={() => onScopeChange("occurrence")}
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 3,
              border: "1px solid var(--input-border, #333)",
              background: scope === "occurrence" ? "var(--accent-blue-bg, rgba(59,130,246,0.15))" : "transparent",
              color: "inherit",
              cursor: "pointer",
              fontWeight: scope === "occurrence" ? 700 : 400,
            }}
          >
            This placement
          </button>
        </div>
      )}

      {binding && (
        <button
          type="button"
          onClick={clear}
          style={{
            fontSize: 10,
            alignSelf: "flex-start",
            marginTop: 2,
            color: "var(--danger, #f87171)",
            background: "transparent",
            border: "1px solid currentColor",
            padding: "2px 6px",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Clear binding
        </button>
      )}
    </div>
  );
}
