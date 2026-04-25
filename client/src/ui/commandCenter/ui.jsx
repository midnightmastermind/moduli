// commandCenter/ui.jsx — shared UI primitives for command center tabs
import React from "react";

// ── TabShell ──────────────────────────────────────────────────
// Wraps a tab: optional header row + scrollable content area.
export function TabShell({ header, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {header && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)",
          background: "var(--body-bg)", flexShrink: 0,
        }}>
          {header}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────
export function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 6,
      }}>
        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── FormGrid ──────────────────────────────────────────────────
// Two-column label/input grid.
export function FormGrid({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", alignItems: "center" }}>
      {children}
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────
// Single label + input row for use inside FormGrid.
export function Field({ label, children }) {
  return (
    <>
      <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {label}
      </label>
      <div>{children}</div>
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────
export function Row({ children, gap = 6 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      {children}
    </div>
  );
}

// ── TextInput ─────────────────────────────────────────────────
export function TextInput({ value, onChange, placeholder, style }) {
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        height: 26, fontSize: 11, fontFamily: "monospace",
        background: "var(--input-bg)", border: "1px solid var(--input-border)",
        borderRadius: 4, color: "var(--text-primary)", padding: "0 7px",
        outline: "none", width: "100%", boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

// ── NumberInput ───────────────────────────────────────────────
export function NumberInput({ value, onChange, min, max, style }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={e => onChange(Number(e.target.value))}
      min={min}
      max={max}
      style={{
        height: 26, fontSize: 11, fontFamily: "monospace",
        background: "var(--input-bg)", border: "1px solid var(--input-border)",
        borderRadius: 4, color: "var(--text-primary)", padding: "0 7px",
        outline: "none", width: "100%", boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

// ── SelectInput ───────────────────────────────────────────────
export function SelectInput({ value, onChange, options, style }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      style={{
        height: 26, fontSize: 11, fontFamily: "monospace",
        background: "var(--input-bg)", border: "1px solid var(--input-border)",
        borderRadius: 4, color: "var(--text-primary)", padding: "0 6px",
        outline: "none", width: "100%", boxSizing: "border-box",
        ...style,
      }}
    >
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

// ── Toggle ────────────────────────────────────────────────────
export function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
      <span
        onClick={() => onChange(!checked)}
        style={{
          width: 28, height: 16, borderRadius: 8, position: "relative",
          background: checked ? "var(--accent-blue)" : "var(--border-default)",
          transition: "background 0.15s", cursor: "pointer", flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 14 : 2,
          width: 12, height: 12, borderRadius: "50%",
          background: "var(--text-primary)", transition: "left 0.15s",
        }} />
      </span>
      {label && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
          {label}
        </span>
      )}
    </label>
  );
}

// ── Pill ──────────────────────────────────────────────────────
export function Pill({ label, onRemove, color = "59,130,246" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 7px", borderRadius: 10,
      background: `rgba(${color},0.12)`, border: `1px solid rgba(${color},0.3)`,
      color: `rgb(${color})`, fontSize: 10, fontFamily: "monospace",
    }}>
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, fontSize: 11 }}
        >
          ×
        </button>
      )}
    </span>
  );
}
