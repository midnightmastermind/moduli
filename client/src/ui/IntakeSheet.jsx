// ui/IntakeSheet.jsx
//
// Task 2 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// THE ASK. The audit's first finding was that nothing asks: every drop decided
// silently, so the same file dropped two feet apart became two different things
// and the user was never told why.
//
// This is the only surface that asks, and it is deliberately cheap to dismiss:
//
//   • NOTHING is pre-selected — the user picks every time (2026-08-09)
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

import React, { useCallback, useEffect, useRef, useState } from "react";
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
      onPick={(shapeId, answer) => { setReq(null); req.onPick?.(shapeId, answer); }}
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
  boxShadow: "var(--menu-shadow-3)",
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

const backSt = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted, rgba(255,255,255,0.55))",
  cursor: "pointer",
  font: "inherit",
  fontSize: 15,
  lineHeight: 1,
  padding: "0 4px 0 0",
};

const footSt = {
  padding: "7px 12px",
  borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.07))",
  fontSize: 10,
  color: "var(--text-faint, rgba(255,255,255,0.4))",
};

// No selected state: nothing is chosen until the user chooses it. The only
// distinguishing style a tile can carry is FOCUS, which follows the keyboard
// rather than announcing a recommendation.
const tileSt = {
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
};

/**
 * @param {object}   classification  `classifyIntake` output — { payload, shapes[] }.
 *                                   Its `fallback` is deliberately IGNORED here:
 *                                   nothing is pre-selected, so the sheet has no
 *                                   opinion to render (see helpers/intake.js).
 * @param {object}   position        desktop anchor `{ top, left }` (MenuSurface ignores it on mobile)
 * @param {Function} onPick          (shapeId, answer?) => void — the ONLY way this
 *                                   sheet produces an outcome. `answer` is set
 *                                   for shapes that declared a `followUp`.
 * @param {Function} onCancel        () => void — Escape / backdrop / Cancel. Writes nothing.
 */
export default function IntakeSheet({ classification, position = null, onPick, onCancel, zIndex = 1200 }) {
  const allShapes = classification?.shapes || [];
  const surfaceRef = useRef(null);
  const dialogRef = useRef(null);
  const itemRefs = useRef([]);

  // ── STEP 2 ────────────────────────────────────────────────────────────────
  // Some shapes cannot be carried out from the shape alone: "Set as field
  // value" needs to know WHICH field. Rather than a bespoke dialog per shape,
  // a shape may declare `followUp` and the sheet renders a second list in
  // place. The shape is not committed until that list is answered — picking
  // `Set as field value` writes nothing on its own.
  const [followUpFor, setFollowUpFor] = useState(null);
  const followUp = followUpFor?.followUp || null;

  // Whatever list is on screen right now. Both steps render the same tiles and
  // share the same arrow-key handling, so there is one interaction to get right
  // instead of two that drift.
  const items = followUp
    ? followUp.options.map((o) => ({ id: o.value, label: o.label, hint: o.hint }))
    : allShapes;
  // Drop refs left by the other step. In the render body deliberately — an
  // effect runs AFTER the ref callbacks and would wipe this render's own refs.
  itemRefs.current.length = items.length;

  const choose = useCallback((id) => {
    if (followUpFor) { onPick?.(followUpFor.id, id); return; }
    const shape = allShapes.find((s) => s.id === id);
    if (shape?.followUp?.options?.length) { setFollowUpFor(shape); return; }
    onPick?.(id);
  }, [followUpFor, allShapes, onPick]);

  // NOTHING IS PRE-SELECTED (user, 2026-08-09: "there shouldnt be a default, it
  // should ask everytime"). Focus lands on the DIALOG, not on a tile — focusing
  // a tile would make Enter commit it, which is a default wearing a different
  // hat. Arrow keys move into the list from here, so the keyboard path is intact
  // without one shape being quietly privileged.
  // Re-parked when the step changes, so focus is never left on a tile that has
  // just been replaced — and step 2 opens with nothing selected, exactly like
  // step 1. There is no default at either level.
  useEffect(() => {
    dialogRef.current?.focus();
  }, [followUpFor]);

  // Escape must reach us even when focus has wandered off the tiles (the
  // backdrop, a scroll). Bound at the document so there is no focus-dependent
  // dead spot where Escape silently does nothing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      // From step 2, Escape goes BACK rather than throwing the gesture away —
      // you answered "what should this become", not "what field". Either way
      // it commits nothing, which is the property that matters.
      if (followUpFor) { setFollowUpFor(null); return; }
      onCancel?.();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel, followUpFor]);

  const move = useCallback((delta) => {
    const els = itemRefs.current.filter(Boolean);
    if (!els.length) return;
    const cur = els.indexOf(document.activeElement);
    // From the dialog (nothing focused yet) the first Down lands on the first
    // tile and the first Up on the last — arriving at an end, not at a default.
    const next = cur < 0
      ? (delta > 0 ? 0 : els.length - 1)
      : (cur + delta + els.length) % els.length;
    els[next]?.focus();
  }, []);

  const onListKeyDown = useCallback(
    (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    },
    [move],
  );

  if (!allShapes.length) return null;

  const title = followUp ? followUp.title : "What should this become?";

  return (
    <MenuSurface
      position={position}
      style={wrapSt}
      zIndex={zIndex}
      surfaceRef={surfaceRef}
      onClose={onCancel}
      className="intake-sheet"
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
          {followUp && (
            <button
              type="button"
              onClick={() => setFollowUpFor(null)}
              style={backSt}
              data-testid="intake-back"
              aria-label="Back to shapes"
            >
              ‹
            </button>
          )}
          <span style={{ fontSize: 12, fontWeight: 600 }} data-testid="intake-title">{title}</span>
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
            title={followUp ? followUpFor.label : describeIntakePayload(classification?.payload)}
            data-testid="intake-payload"
          >
            {followUp ? followUpFor.label : describeIntakePayload(classification?.payload)}
          </span>
        </div>

        <div style={listSt} onKeyDown={onListKeyDown}>
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              ref={(el) => { itemRefs.current[i] = el; }}
              style={tileSt}
              data-testid={followUp ? `intake-option-${it.id}` : `intake-shape-${it.id}`}
              onClick={() => choose(it.id)}
            >
              <div style={{ fontSize: 12, fontWeight: 500 }}>{it.label}</div>
              {it.hint && (
                <div style={{ fontSize: 10.5, color: "var(--text-muted, rgba(255,255,255,0.5))", marginTop: 1 }}>
                  {it.hint}
                </div>
              )}
            </button>
          ))}
        </div>

        <div style={footSt}>
          {followUp ? "Pick one · ↑↓ to move · Esc to go back" : "Pick one · ↑↓ to move · Esc to cancel"}
        </div>
      </div>
    </MenuSurface>
  );
}
