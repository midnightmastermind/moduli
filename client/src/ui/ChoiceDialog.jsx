// ui/ChoiceDialog.jsx
//
// A question with more than two answers (window.confirm has only OK / Cancel). One
// <ChoiceDialogHost/> is mounted in App; anything calls `askChoice({ title, message, choices })`
// and gets a Promise of the picked choice's value, or null when dismissed (Escape, the backdrop,
// Cancel). With no host mounted it resolves null — the caller must treat that as "do nothing".
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

let pushRequest = null;

export function askChoice({ title = "", message = "", choices = [] } = {}) {
  if (!pushRequest || !choices.length) return Promise.resolve(null);
  return new Promise((resolve) => pushRequest({ title, message, choices, resolve }));
}

export function ChoiceDialogHost() {
  const [req, setReq] = useState(null);
  useEffect(() => {
    pushRequest = (r) => setReq((cur) => { cur?.resolve(null); return r; });
    return () => { pushRequest = null; };
  }, []);
  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  if (!req) return null;
  function finish(value) { req.resolve(value); setReq(null); }
  return (
    <div
      role="presentation"
      onClick={() => finish(null)}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        role="dialog"
        aria-label={req.title || "Choose"}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-card)", border: "1px solid var(--input-border)", borderRadius: 8,
          padding: 16, minWidth: 320, maxWidth: "calc(100vw - 32px)",
          display: "flex", flexDirection: "column", gap: 10, boxShadow: "var(--menu-shadow-2)",
        }}
      >
        {req.title && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{req.title}</div>}
        {req.message && <div style={{ fontSize: 12, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>{req.message}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>Cancel</Button>
          {req.choices.map((c, i) => (
            <Button
              key={c.value}
              type="button"
              size="sm"
              style={{ padding: "3px 10px", ...(c.danger ? { background: "var(--danger-bg)", borderColor: "var(--danger-border)", color: "var(--danger-text)" } : null) }}
              autoFocus={i === 0}
              onClick={() => finish(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
