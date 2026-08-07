// ui/IntakeSheet.jsx
//
// Task 2 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// THE ASK. The audit's first finding was that nothing asks: every drop decided
// silently, so the same file dropped two feet apart became two different things
// and the user was never told why.
//
// This is the only surface that asks, and it is deliberately cheap to dismiss:
//
//   • the best shape is PRE-SELECTED and focused on open, so Enter commits it
//   • Escape cancels and WRITES NOTHING — this component never writes at all
//   • ONE sheet per gesture, never per item: nine files ask once, for the set
//
// It renders through MenuSurface, so it is an anchored menu on desktop and a
// bottom drawer on a phone by construction (2026-08-05).
//
// CONTRACT: this file is pure UI. It takes a classification and returns a shape
// id through `onPick`. Every write lives in the router (`intakeApply`, Task 3),
// which is what makes "Escape commits nothing" true by construction rather than
// by remembering to guard each branch.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MenuSurface from "./MenuSurface";

// ── Imperative controller ────────────────────────────────────────────────
// The callers are DROP HANDLERS — plain functions in `helpers/`, not
// components — so they have nowhere to render a sheet. One <IntakeSheetHost>
// is mounted in App and `openIntakeSheet({ classification, position, onPick,
// onCancel })` drives it. Same shape as ImagePickerHost, and for the same
// reason: the surface must outlive whatever triggered it.
let _intakeHost = null;
export function registerIntakeSheetHost(fn) {
  _intakeHost = fn;
  return () => { if (_intakeHost === fn) _intakeHost = null; };
}

/**
 * Ask the user what a payload should become.
 *
 * If no host is mounted the request is REFUSED rather than silently dropped —
 * a drop that asks nothing and writes nothing looks identical to a broken
 * drop, so the caller is told and can fall back.
 * @returns {boolean} whether the sheet opened
 */
export function openIntakeSheet(request) {
  if (!_intakeHost) {
    console.warn("[intake] no host mounted — is <IntakeSheetHost/> in App?");
    return false;
  }
  _intakeHost(request);
  return true;
}

export function IntakeSheetHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerIntakeSheetHost((r) => setReq(r || null)), []);
  if (!req?.classification) return null;
  // Each outcome closes the sheet FIRST, then runs the caller's callback, so a
  // slow write (a fetch, an upload) never leaves the sheet sitting open over
  // the work it started.
  return (
    <IntakeSheet
      classification={req.classification}
      position={req.position || null}
      onPick={(shapeId) => { setReq(null); req.onPick?.(shapeId); }}
      onCancel={() => { setReq(null); req.onCancel?.(); }}
    />
  );
}

/**
 * One line naming what is being brought in, for the sheet header.
 * The COUNT is the load-bearing part — "9 files" is what tells the user this
 * one sheet covers the whole gesture rather than the first item of nine.
 */
export function describeIntakePayload(payload = {}) {
  const p = payload || {};
  switch (p.kind) {
    case "files":
      return `${p.files?.length ?? p.count ?? 0} files`;
    case "file": {
      const name = p.files?.[0]?.name;
      return name || "1 file";
    }
    case "link": {
      const n = p.urls?.length ?? p.count ?? 0;
      if (n > 1) return `${n} links`;
      return p.urls?.[0] || "1 link";
    }
    case "html":
      return "Pasted content";
    case "text":
      return "Pasted text";
    default:
      return "Dropped item";
  }
}

const wrapSt = {
  width: 320,
  maxWidth: "100%",
  background: "var(--surface, #1f2125)",
  border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
  borderRadius: 10,
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  padding: 0,
  overflow: "hidden",
};

const headSt = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.07))",
  background: "var(--input-bg, rgba(255,255,255,0.03))",
};

const listSt = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: 6,
  maxHeight: 360,
  overflowY: "auto",
};

const footSt = {
  padding: "7px 12px",
  borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.07))",
  fontSize: 10,
  color: "var(--text-faint, rgba(255,255,255,0.4))",
};

function tileStyle(isPreselected) {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--text-primary, rgba(255,255,255,0.92))",
    cursor: "pointer",
    font: "inherit",
    ...(isPreselected
      ? {
          borderColor: "var(--accent-blue, rgb(50,150,255))",
          background: "var(--accent-blue-bg, rgba(50,150,255,0.10))",
        }
      : null),
  };
}

/**
 * @param {object}   classification  `classifyIntake` output — { payload, shapes[], preselected }
 * @param {object}   position        desktop anchor `{ top, left }` (MenuSurface ignores it on mobile)
 * @param {Function} onPick          (shapeId) => void — the ONLY way this sheet produces an outcome
 * @param {Function} onCancel        () => void — Escape / backdrop / Cancel. Writes nothing.
 */
export default function IntakeSheet({ classification, position = null, onPick, onCancel, zIndex = 1200 }) {
  const shapes = classification?.shapes || [];
  const preselected = classification?.preselected || shapes[0]?.id || null;
  const surfaceRef = useRef(null);
  const itemRefs = useRef([]);

  const preIdx = useMemo(() => {
    const i = shapes.findIndex((s) => s.id === preselected);
    return i >= 0 ? i : 0;
  }, [shapes, preselected]);

  // Focus the pre-selected tile on open. THIS is what makes "drop → Enter" one
  // keystroke rather than a hunt: the browser's own activation handles Enter and
  // Space, so there is no key handling to get wrong.
  useEffect(() => {
    const el = itemRefs.current[preIdx];
    if (el) el.focus();
  }, [preIdx]);

  // Escape must reach us even when focus has wandered off the tiles (the
  // backdrop, a scroll). Bound at the document so there is no focus-dependent
  // dead spot where Escape silently does nothing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel?.();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const move = useCallback(
    (delta) => {
      const els = itemRefs.current.filter(Boolean);
      if (!els.length) return;
      const cur = els.indexOf(document.activeElement);
      const next = (cur < 0 ? preIdx : cur + delta + els.length) % els.length;
      els[next]?.focus();
    },
    [preIdx],
  );

  const onListKeyDown = useCallback(
    (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    },
    [move],
  );

  if (!shapes.length) return null;

  return (
    <MenuSurface
      position={position}
      style={wrapSt}
      zIndex={zIndex}
      surfaceRef={surfaceRef}
      onClose={onCancel}
      className="intake-sheet"
    >
      <div role="dialog" aria-modal="true" aria-label="What should this become?">
        <div style={headSt}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>What should this become?</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted, rgba(255,255,255,0.55))",
              marginLeft: "auto",
              maxWidth: 150,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={describeIntakePayload(classification?.payload)}
            data-testid="intake-payload"
          >
            {describeIntakePayload(classification?.payload)}
          </span>
        </div>

        <div style={listSt} onKeyDown={onListKeyDown}>
          {shapes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              ref={(el) => { itemRefs.current[i] = el; }}
              style={tileStyle(s.id === preselected)}
              data-testid={`intake-shape-${s.id}`}
              data-preselected={s.id === preselected ? "true" : undefined}
              onClick={() => onPick?.(s.id)}
            >
              <div style={{ fontSize: 12, fontWeight: 500 }}>{s.label}</div>
              {s.hint && (
                <div style={{ fontSize: 10.5, color: "var(--text-muted, rgba(255,255,255,0.5))", marginTop: 1 }}>
                  {s.hint}
                </div>
              )}
            </button>
          ))}
        </div>

        <div style={footSt}>Enter to accept · Esc to cancel</div>
      </div>
    </MenuSurface>
  );
}
