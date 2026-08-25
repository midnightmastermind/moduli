// ui/ConfirmListHost.jsx
//
// "Which of these?" — a multi-select confirmation over a list the app just
// discovered. Built for the `link-follow` intake shape (user decision D5: one
// hop, any domain, CONFIRM FIRST, per-page checkboxes and a count, import
// nothing until approved), and kept generic because nothing about it is about
// links: it is a list, some of it ticked, and a button that says how many.
//
// WHY THIS IS NOT A SECOND STEP INSIDE `IntakeSheet`, which is where a
// follow-up question normally lives (2026-08-09 (2)):
//
//   • The list DOES NOT EXIST until a page has been fetched and read. The
//     sheet's contract is that it is pure UI which "never writes at all" and
//     is cheap to dismiss; holding it open across a 20-second network call is
//     exactly what `IntakeSheetHost` avoids when it closes the sheet BEFORE
//     running the caller's callback.
//   • Escape from the sheet's step 2 goes BACK to step 1. Backing out of a
//     crawl that is still in flight is a state nobody needs to get right.
//
// So the shape is picked in the sheet, the sheet closes, and the ROUTE runs the
// crawl and opens this. Same imperative-host pattern as `openIntakeSheet` and
// `openImagePicker`, and for the same reason: the caller is a plain function in
// `helpers/`, with nowhere to render.
//
// ON THE DEFAULT SELECTION, because it looks like it contradicts the sheet's
// "there shouldn't be a default" rule: it does not. That rule is about the app
// answering "what should this become" for you. Here the outcome is already
// chosen — the user asked to follow the links — and this is a SCOPE control.
// Starting with nothing ticked would make the confirm button dead on arrival
// and demand twenty clicks to do the thing they just asked for. The count is in
// the button, so the size of what happens is stated before it happens.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MenuSurface from "./MenuSurface";

let _confirmHost = null;
export function registerConfirmListHost(fn) {
  _confirmHost = fn;
  return () => { if (_confirmHost === fn) _confirmHost = null; };
}

/**
 * Ask the user to tick a subset of `items` and confirm.
 *
 * REFUSED rather than silently skipped when no host is mounted (a preview
 * iframe, a test harness). The caller MUST honour a `false` return by doing
 * nothing: this surface exists because the action behind it is heavy and
 * irreversible-ish, so "no way to ask" has to mean "do not do it", never
 * "do it all anyway".
 *
 * @param {object}   request
 * @param {string}   request.title         header line
 * @param {string}   [request.subtitle]    muted line under it (source, counts, caveats)
 * @param {Array<{id:string,label:string,sub?:string}>} request.items
 * @param {(ids:string[]) => void} request.onConfirm  ticked ids, never empty
 * @param {() => void} [request.onCancel]
 * @param {string}   [request.confirmLabel] verb for the button ("Import")
 * @param {{top:number,left:number}} [request.position]
 * @returns {boolean} whether the list opened
 */
export function openConfirmList(request) {
  if (!_confirmHost) {
    console.warn("[confirm-list] no host mounted — is <ConfirmListHost/> in App?");
    return false;
  }
  if (!request?.items?.length) return false;
  _confirmHost(request);
  return true;
}

export function ConfirmListHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerConfirmListHost((r) => setReq(r || null)), []);
  if (!req?.items?.length) return null;
  // Close FIRST, then run the callback — the confirm kicks off a long series of
  // imports, and leaving the list sitting over its own work reads as a hang.
  return (
    <ConfirmList
      {...req}
      onConfirm={(ids) => { setReq(null); req.onConfirm?.(ids); }}
      onCancel={() => { setReq(null); req.onCancel?.(); }}
    />
  );
}

const wrapSt = {
  width: 360,
  maxWidth: "100%",
  background: "var(--surface-overlay)",
  border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
  borderRadius: 10,
  boxShadow: "var(--menu-shadow-3)",
  padding: 0,
  overflow: "hidden",
};

const headSt = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.07))",
  background: "var(--input-bg, rgba(255,255,255,0.03))",
};

const listSt = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  padding: 6,
  maxHeight: 320,
  overflowY: "auto",
};

const rowSt = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-primary, rgba(255,255,255,0.92))",
  cursor: "pointer",
  font: "inherit",
};

const footSt = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.07))",
};

const btnSt = {
  font: "inherit",
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 6,
  cursor: "pointer",
  border: "1px solid var(--border-default, rgba(255,255,255,0.14))",
  background: "transparent",
  color: "var(--text-primary, rgba(255,255,255,0.92))",
};

const linkBtnSt = {
  font: "inherit",
  fontSize: 10.5,
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--text-muted, rgba(255,255,255,0.55))",
};

export default function ConfirmList({
  title,
  subtitle = "",
  items = [],
  confirmLabel = "Import",
  position = null,
  onConfirm,
  onCancel,
  zIndex = 1200,
}) {
  const dialogRef = useRef(null);
  // Everything ticked to start — see the header for why this is a scope
  // control and not a recommendation.
  const [picked, setPicked] = useState(() => new Set(items.map((i) => i.id)));

  const toggle = useCallback((id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => { dialogRef.current?.focus(); }, []);

  // Bound at the document so there is no focus-dependent dead spot where
  // Escape silently does nothing — the same reason IntakeSheet does.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel?.();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const count = picked.size;
  const ordered = useMemo(
    () => items.filter((i) => picked.has(i.id)).map((i) => i.id),
    [items, picked],
  );

  if (!items.length) return null;

  return (
    <MenuSurface
      position={position}
      style={wrapSt}
      zIndex={zIndex}
      onClose={onCancel}
      className="confirm-list"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        tabIndex={-1}
        style={{ outline: "none" }}
      >
        <div style={headSt}>
          <div style={{ fontSize: 12, fontWeight: 600 }} data-testid="confirm-list-title">{title}</div>
          {subtitle && (
            <div style={{ fontSize: 10.5, color: "var(--text-muted, rgba(255,255,255,0.55))", marginTop: 2 }}>
              {subtitle}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="button" style={linkBtnSt} onClick={() => setPicked(new Set(items.map((i) => i.id)))}>
              Select all
            </button>
            <button type="button" style={linkBtnSt} onClick={() => setPicked(new Set())}>
              Select none
            </button>
          </div>
        </div>

        <div style={listSt}>
          {items.map((it) => {
            const on = picked.has(it.id);
            return (
              <button
                key={it.id}
                type="button"
                style={rowSt}
                aria-pressed={on}
                data-testid={`confirm-item-${it.id}`}
                onClick={() => toggle(it.id)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: 13,
                    height: 13,
                    marginTop: 2,
                    borderRadius: 3,
                    border: `1px solid ${on
                      ? "var(--accent-blue, rgb(90,150,230))"
                      : "var(--border-default, rgba(255,255,255,0.25))"}`,
                    background: on ? "var(--accent-blue, rgb(90,150,230))" : "transparent",
                    color: "var(--on-accent)",
                    fontSize: 10,
                    lineHeight: "12px",
                    textAlign: "center",
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12 }}>{it.label}</span>
                  {it.sub && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "var(--text-faint, rgba(255,255,255,0.4))",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={it.sub}
                    >
                      {it.sub}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div style={footSt}>
          <button
            type="button"
            style={{
              ...btnSt,
              opacity: count ? 1 : 0.45,
              cursor: count ? "pointer" : "not-allowed",
              borderColor: count ? "var(--accent-blue, rgb(90,150,230))" : btnSt.border,
            }}
            disabled={!count}
            data-testid="confirm-list-go"
            onClick={() => count && onConfirm?.(ordered)}
          >
            {confirmLabel} {count}
          </button>
          <button type="button" style={btnSt} data-testid="confirm-list-cancel" onClick={() => onCancel?.()}>
            Cancel
          </button>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-faint, rgba(255,255,255,0.4))" }}>
            Esc to cancel
          </span>
        </div>
      </div>
    </MenuSurface>
  );
}
