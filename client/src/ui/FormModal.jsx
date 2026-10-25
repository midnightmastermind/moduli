// ui/FormModal.jsx — the window an "Ask with a form" (ASK_FORM) step opens.
//
// App mounts one, fed from the same operationsBridge.requestUserInput queue as UserInputModal: a request with
// `form: true` comes here. One control per item — a field item uses that grid field's own input (ui/Field, the
// same control the row has: a select, an occurrence picker, a rating…), a free item a plain input of its type.
// Submit is off while a required item is empty and says which. Enter submits (not in a long-text box), Escape
// cancels. On a phone it is a bottom drawer (MenuSurface), centred on a desktop.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import MenuSurface, { isDrawerLayout } from "./MenuSurface.jsx";
import Field from "./Field.jsx";
import { itemType, missingRequired } from "../helpers/formItems.js";

function initialValue(item) {
  if (item.default !== undefined && item.default !== null) return item.default;
  return itemType(item) === "boolean" ? false : null;
}

function initialValues(items) {
  const out = {};
  for (const it of items || []) out[it.key] = initialValue(it);
  return out;
}

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 12,
  background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 4,
  color: "var(--text-primary)", boxSizing: "border-box",
};

function FreeInput({ item, value, onChange, inputRef }) {
  const id = `form-item-${item.key}`;
  const type = itemType(item);
  if (type === "longtext") {
    return <textarea id={id} ref={inputRef} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />;
  }
  if (type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-primary)" }}>
        <input id={id} ref={inputRef} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Yes
      </label>
    );
  }
  if (type === "select") {
    return (
      <select id={id} ref={inputRef} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} style={inputStyle}>
        <option value="">— pick —</option>
        {(item.options || []).map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
      </select>
    );
  }
  if (type === "number") {
    return (
      <input id={id} ref={inputRef} type="number" value={value ?? ""} style={inputStyle}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    );
  }
  return (
    <input id={id} ref={inputRef} type={type === "date" ? "date" : "text"} value={value ?? ""} style={inputStyle}
      onChange={(e) => onChange(e.target.value)} />
  );
}

/** A dropdown (Radix popover / listbox) is open inside the form — Escape belongs to it, not to the form. */
function innerPopupOpen() {
  return !!document.querySelector("[data-radix-popper-content-wrapper], [role='listbox']");
}

export default function FormModal({ request, onSubmit, onCancel }) {
  const items = useMemo(() => request?.items || [], [request]);
  const [values, setValues] = useState(() => initialValues(items));
  const firstRef = useRef(null);

  useEffect(() => { setValues(initialValues(items)); }, [items]);

  useEffect(() => {
    if (!request) return undefined;
    const t = setTimeout(() => firstRef.current?.focus?.(), 30);
    const onKey = (e) => {
      if (e.key !== "Escape" || innerPopupOpen()) return;
      e.preventDefault();
      onCancel?.();
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); };
  }, [request, onCancel]);

  if (!request) return null;

  const missing = missingRequired(items, values);
  const labelOf = (key) => items.find((i) => i.key === key)?.label || key;
  const set = (key) => (v) => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = (e) => {
    e?.preventDefault?.();
    if (missing.length) return;
    onSubmit?.(values);
  };

  const onKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (e.target?.tagName === "TEXTAREA" || innerPopupOpen()) return;
    e.preventDefault();
    submit();
  };

  const drawer = isDrawerLayout();
  const body = (
    <form onSubmit={submit} onKeyDown={onKeyDown} data-testid="form-modal"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, minWidth: drawer ? 0 : 340, maxWidth: drawer ? "none" : 460 }}>
      {request.title && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{request.title}</div>}
      {items.map((it, i) => (
        <div key={it.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "var(--text-primary)" }}>
            <label htmlFor={`form-item-${it.key}`}>{it.label || it.key}</label>
            {it.required && <span aria-hidden="true" style={{ color: "var(--danger-text)" }}> *</span>}
          </div>
          {it.field ? (
            <Field
              field={it.field}
              binding={{ fieldId: it.field.id, role: "input" }}
              compact={false}
              hideName
              value={values[it.key]}
              flow={it.field.meta?.flow || "in"}
              onChange={set(it.key)}
              onCommit={set(it.key)}
            />
          ) : (
            <FreeInput item={it} value={values[it.key]} onChange={set(it.key)} inputRef={i === 0 ? firstRef : undefined} />
          )}
          {it.help && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{it.help}</div>}
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Needs: {missing.map(labelOf).join(", ")}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={missing.length > 0}>{request.submitLabel || "Submit"}</Button>
      </div>
    </form>
  );

  return (
    <>
      {!drawer && createPortal(
        <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1999, background: "var(--scrim)" }} />,
        document.body,
      )}
      <MenuSurface zIndex={2000} onClose={onCancel}
        style={drawer ? {} : { background: "var(--surface-card)", border: "1px solid var(--input-border)", borderRadius: 8, boxShadow: "var(--menu-shadow-2)" }}>
        {body}
      </MenuSurface>
    </>
  );
}
