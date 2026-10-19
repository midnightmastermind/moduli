// ui/DefinitionCard.jsx
// ============================================================
// "Define" from the text right-click menu shows the word's meanings in a small
// card where you right-clicked — Windows' Define card. It used to be a toast
// from "sonner", which nothing in the app mounts, so it showed nothing at all;
// and a definition is too long for a notification pill anyway (UI sweep
// 2026-10-19).
//
// One host in App, opened imperatively (`openDefinition(word)`), the same
// pattern as ImagePickerHost: the menu that asks has already closed. The card
// sits at the last right-click (a desktop surface); MenuSurface makes it a
// bottom sheet on a phone. Escape / a click outside closes it.
// ============================================================
import React, { useEffect, useState } from "react";
import MenuSurface from "./MenuSurface";
import { defineWord, dictionaryUrl } from "../helpers/textLookup.js";

let _host = null;
const lastPoint = { x: null, y: null };
if (typeof window !== "undefined") {
  window.addEventListener("contextmenu", (e) => { lastPoint.x = e.clientX; lastPoint.y = e.clientY; }, true);
}

/** Show `word`'s definition near the last right-click. */
export function openDefinition(word) {
  const w = String(word ?? "").trim();
  if (!w || !_host) return false;
  _host({ word: w, x: lastPoint.x, y: lastPoint.y });
  return true;
}

const CARD_W = 320;
/** PURE: a desktop position for the card that keeps it on screen. */
export function definitionCardPosition(x, y, vw, vh, { w = CARD_W, h = 220 } = {}) {
  if (x == null || y == null) return null;
  const left = Math.max(8, Math.min(x, vw - w - 8));
  const top = y + h + 8 > vh ? Math.max(8, y - h) : y + 8;
  return { top, left };
}

export function DefinitionHost() {
  const [req, setReq] = useState(null);
  const [lines, setLines] = useState(undefined); // undefined = looking up, null = unreachable
  useEffect(() => { _host = (r) => { setLines(undefined); setReq(r); }; return () => { _host = null; }; }, []);

  useEffect(() => {
    if (!req) return undefined;
    let live = true;
    defineWord(req.word).then((l) => { if (live) setLines(l); });
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setReq(null); } };
    const onDown = (e) => { if (!e.target.closest?.(".definition-card")) setReq(null); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => { live = false; document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); };
  }, [req]);

  if (!req) return null;
  const position = definitionCardPosition(req.x, req.y, window.innerWidth, window.innerHeight);
  return (
    <MenuSurface
      position={position}
      zIndex={1300}
      className="definition-card"
      onClose={() => setReq(null)}
      style={{
        width: CARD_W, maxWidth: "calc(100vw - 16px)", padding: "10px 12px",
        background: "var(--surface-overlay)", color: "var(--text-primary)",
        border: "1px solid var(--border-default)", borderRadius: 8, boxShadow: "var(--menu-shadow-2)",
      }}
    >
      <div role="dialog" aria-label={`Definition of ${req.word}`} data-testid="definition-card">
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{req.word}</div>
        {lines === undefined && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Looking up…</div>}
        {lines === null && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Couldn't reach the dictionary — try the link below.</div>
        )}
        {lines && lines.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No definition found.</div>
        )}
        {lines && lines.length > 0 && (
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 4 }}>
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        )}
        <a href={dictionaryUrl(req.word)} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: "var(--accent-blue)" }}>
          More in the dictionary ↗
        </a>
      </div>
    </MenuSurface>
  );
}
