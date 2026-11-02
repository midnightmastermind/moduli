// ui/JellyfinPlayerHost.jsx — mounted once in App. `openJellyfinPlayer(...)` (helpers/jellyfinPlay) shows the
// player over the grid; the player itself is lazy, so hls.js is only fetched when something is played.
import React, { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { registerJellyfinPlayerHost } from "../helpers/jellyfinPlay";

const JellyfinPlayer = lazy(() => import("./JellyfinPlayer.jsx"));

export function JellyfinPlayerHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerJellyfinPlayerHost((r) => setReq(r || null)), []);
  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setReq(null); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [req]);
  if (!req || typeof document === "undefined") return null;
  const close = () => setReq(null);
  return createPortal(
    <div role="presentation" onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 1350, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div role="dialog" aria-label={req.label || "Player"} onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1200px, calc(100vw - 32px))", height: "min(760px, calc(100vh - 32px))", background: "var(--surface-card)",
          border: "1px solid var(--border-default)", borderRadius: 8, boxShadow: "var(--menu-shadow-3)", overflow: "hidden" }}>
        <Suspense fallback={null}>
          <JellyfinPlayer key={req.occurrenceId} {...req} onClose={close} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

export default JellyfinPlayerHost;
