// ui/ZoomableImage.jsx
//
// ZOOM AN OPENED IMAGE (user, 2026-10-14: "i should be able to zoom when an
// image file is open too"). Wheel or pinch zooms about the pointer, a drag pans
// while zoomed, double-click zooms in (or back out), and − / + / reset buttons
// cover a mouse with no wheel. The math is helpers/graphView — the chart viewer's
// pure zoom model — so the two cannot drift.
//
// View model: (cx, cy) is where the box's centre point lands, in percent of the
// box; a content point x lands at cx + zoom·(x − 50). As CSS that is
// translate(cx−50 %, cy−50 %) scale(zoom) about the centre.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize } from "lucide-react";
import { DEFAULT_VIEW, zoomAt, panBy, wheelFactor, pinchFactor, distanceBetween, isDefaultView } from "../helpers/graphView";

const DOUBLE_CLICK_ZOOM = 2.5;
const BUTTON_STEP = 1.4;

export default function ZoomableImage({ children, frameStyle }) {
  const boxRef = useRef(null);
  const [view, setView] = useState(DEFAULT_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const lastPinch = useRef(0);

  // The point under (clientX, clientY) as percent of the box.
  const pct = useCallback((clientX, clientY) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return [50, 50];
    return [((clientX - r.left) / r.width) * 100, ((clientY - r.top) / r.height) * 100];
  }, []);

  // Wheel is bound by hand: React attaches wheel PASSIVELY, so an onWheel prop
  // cannot stop the page scrolling under the image.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const [fx, fy] = pct(e.clientX, e.clientY);
      setView((v) => zoomAt(v, wheelFactor(e.deltaY), fx, fy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pct]);

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      lastPinch.current = distanceBetween(a, b);
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = distanceBetween(a, b);
      const [fx, fy] = pct((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView((v) => zoomAt(v, pinchFactor(lastPinch.current, d), fx, fy));
      lastPinch.current = d;
      return;
    }
    if (viewRef.current.zoom <= 1) return;
    const r = boxRef.current?.getBoundingClientRect();
    if (!r?.width) return;
    setView((v) => panBy(v, ((cur.x - prev.x) / r.width) * 100, ((cur.y - prev.y) / r.height) * 100));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = 0;
  };
  const onDoubleClick = (e) => {
    if (!isDefaultView(viewRef.current)) { setView(DEFAULT_VIEW); return; }
    const [fx, fy] = pct(e.clientX, e.clientY);
    setView((v) => zoomAt(v, DOUBLE_CLICK_ZOOM, fx, fy));
  };

  const zoomed = view.zoom > 1;
  const btn = (onClick, title, Icon, disabled) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} title={title} aria-label={title} disabled={disabled}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, border: 0, borderRadius: 6,
        background: "transparent", color: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      <Icon size={14} />
    </button>
  );

  return (
    <div style={{ position: "relative", ...frameStyle }}>
      <div
        ref={boxRef}
        data-testid="zoomable-image"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{
          position: "relative", width: "100%", height: "100%", overflow: "hidden",
          touchAction: zoomed ? "none" : "pan-y", cursor: zoomed ? "grab" : "default",
        }}
      >
        <div style={{
          width: "100%", height: "100%", transformOrigin: "50% 50%",
          transform: `translate(${view.cx - 50}%, ${view.cy - 50}%) scale(${view.zoom})`,
          // The browser's own image drag would start instead of a pan.
          pointerEvents: "none",
        }}>
          {children}
        </div>
      </div>
      <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 5, display: "flex", alignItems: "center", gap: 2, padding: 2,
        borderRadius: 8, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
        {btn(() => setView((v) => zoomAt(v, 1 / BUTTON_STEP)), "Zoom out", Minus, !zoomed)}
        <span data-testid="zoom-level" style={{ minWidth: 38, textAlign: "center", fontSize: 11, color: "#fff" }}>{Math.round(view.zoom * 100)}%</span>
        {btn(() => setView((v) => zoomAt(v, BUTTON_STEP)), "Zoom in", Plus, view.zoom >= 12)}
        {btn(() => setView(DEFAULT_VIEW), "Fit", Maximize, isDefaultView(view))}
      </div>
    </div>
  );
}
