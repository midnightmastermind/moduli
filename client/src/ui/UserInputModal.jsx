// ui/UserInputModal.jsx
// Modal that asks the user a question on behalf of the GET_USER_INPUT op
// action. App.jsx mounts one instance and wires operationsBridge.requestUserInput
// to a setter that pushes a request onto this modal's pending queue. On submit
// (Enter or button click), resolves the pending Promise with the value.
// On cancel/escape, rejects so the executor can bail the pipeline cleanly.
//
// Supports inputType: "text" | "number" | "select" | "boolean" | "date".
// Chained GET_USER_INPUTs work naturally: when the user answers one, the
// pipeline resumes and may immediately suspend again with the next request,
// which arrives via the same bridge and pushes onto the queue.
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function UserInputModal({ request, onSubmit, onCancel }) {
  const [value, setValue] = useState(
    request?.defaultValue !== undefined && request?.defaultValue !== null
      ? request.defaultValue
      : initialFor(request?.inputType)
  );
  const inputRef = useRef(null);

  // Reset value when request changes (chained questions).
  useEffect(() => {
    setValue(
      request?.defaultValue !== undefined && request?.defaultValue !== null
        ? request.defaultValue
        : initialFor(request?.inputType)
    );
  }, [request]);

  // Focus + escape handler.
  useEffect(() => {
    if (!request) return;
    const t = setTimeout(() => inputRef.current?.focus?.(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [request, onCancel]);

  if (!request) return null;

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    let v = value;
    if (request.inputType === "number") v = Number(v);
    onSubmit?.(v);
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--input-border)",
          borderRadius: 8,
          padding: 16,
          minWidth: 320, maxWidth: "calc(100vw - 32px)",
          display: "flex", flexDirection: "column", gap: 10,
          boxShadow: "var(--menu-shadow-2)",
        }}
      >
        {request.title && (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {request.title}
          </div>
        )}
        <label style={{ fontSize: 12, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
          {request.question}
        </label>
        {renderInput(request, value, setValue, inputRef)}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm">Submit</Button>
        </div>
      </form>
    </div>
  );
}

function initialFor(inputType) {
  if (inputType === "number") return 0;
  if (inputType === "boolean") return false;
  return "";
}

function renderInput(request, value, setValue, ref) {
  const baseInputStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    background: "var(--input-bg)",
    border: "1px solid var(--input-border)",
    borderRadius: 4,
    color: "var(--text-primary)",
  };
  if (request.inputType === "select") {
    const options = request.options || [];
    return (
      <select ref={ref} value={value ?? ""} onChange={(e) => setValue(e.target.value)} style={baseInputStyle}>
        <option value="">— pick —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label || o.value}</option>
        ))}
      </select>
    );
  }
  if (request.inputType === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-primary)" }}>
        <input
          ref={ref}
          type="checkbox"
          checked={!!value}
          onChange={(e) => setValue(e.target.checked)}
        />
        Yes
      </label>
    );
  }
  if (request.inputType === "number") {
    return (
      <input
        ref={ref}
        type="number"
        value={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
        style={baseInputStyle}
      />
    );
  }
  if (request.inputType === "date") {
    return (
      <input
        ref={ref}
        type="date"
        value={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
        style={baseInputStyle}
      />
    );
  }
  // default: text
  return (
    <input
      ref={ref}
      type="text"
      value={value ?? ""}
      onChange={(e) => setValue(e.target.value)}
      style={baseInputStyle}
    />
  );
}
