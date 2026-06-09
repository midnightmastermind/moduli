// docs/WrapGroupNode.jsx
// NodeView for the wrapGroup block. Renders the two child embeds (host, neighbor)
// via NodeViewContent; CSS positions the neighbor over the host's notch. The
// NodeView's job is to keep the host's reserved notch the same size as the
// neighbor's actual rendered footprint: it measures the neighbor (ResizeObserver)
// and writes a sized `wrapSpacer` into the HOST occurrence's textmap, so the
// host's own editor flow reflows its text + clips its border (see TextblockCard).
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useRef, useEffect, useCallback } from "react";
import { useGridActions } from "../GridActionsContext.js";
import { updateOccurrence } from "../helpers/CommitHelpers";

const MIN_DELTA = 2; // px — ignore sub-pixel jitter to avoid write storms

export default function WrapGroupNode({ node }) {
  const side = node.attrs.side === "left" ? "left" : "right";
  // anchor: "top" → notch at the host's first line (L); "middle" → notch mid-flow
  // (C: text above + below). Placement = which index the float spacer lands at.
  const anchor = node.attrs.anchor === "middle" ? "middle" : "top";
  const wrap = node.attrs.wrap !== false;
  const hostOccId = node.firstChild?.attrs?.occurrenceId || null;
  const neighborOccId = node.lastChild?.attrs?.occurrenceId || null;

  const { occurrencesById, dispatch, socket } = useGridActions() || {};
  const host = hostOccId ? occurrencesById?.[hostOccId] : null;
  const wrapRef = useRef(null);
  const lastSize = useRef({ w: -1, h: -1 });

  // Place a wrapSpacer of size w×h into the host's textmap at the anchor index
  // (top → 0; middle → ~half), updating the existing one / stripping when off.
  const syncNotch = useCallback((w, h) => {
    if (!hostOccId) return;
    const cur = occurrencesById?.[hostOccId];
    if (!cur?.textmap?.content || !Array.isArray(cur.textmap.content)) return;
    const content = cur.textmap.content;
    const spacerIdx = content.findIndex((n) => n?.type === "wrapSpacer");

    if (!wrap) {
      if (spacerIdx < 0) return;
      const next = content.slice(0, spacerIdx).concat(content.slice(spacerIdx + 1));
      lastSize.current = { w: -1, h: -1 };
      updateOccurrence({ dispatch, socket, occurrence: { ...cur, textmap: { ...cur.textmap, content: next } } });
      return;
    }

    const rw = Math.round(w);
    const rh = Math.round(h);
    const stripped = spacerIdx < 0 ? content.slice() : content.slice(0, spacerIdx).concat(content.slice(spacerIdx + 1));
    const insertIdx = anchor === "middle"
      ? Math.min(stripped.length, Math.max(1, Math.floor(stripped.length / 2)))
      : 0;

    // Already correct (right index + size + side) → no write (avoids storms).
    if (spacerIdx === insertIdx) {
      const s = content[spacerIdx];
      if (s?.attrs?.w === rw && s?.attrs?.h === rh && s?.attrs?.side === side
          && Math.abs(rw - lastSize.current.w) < MIN_DELTA && Math.abs(rh - lastSize.current.h) < MIN_DELTA) {
        lastSize.current = { w: rw, h: rh };
        return;
      }
    }
    lastSize.current = { w: rw, h: rh };
    const spacer = { type: "wrapSpacer", attrs: { w: rw, h: rh, side } };
    const next = stripped.slice(0, insertIdx).concat([spacer], stripped.slice(insertIdx));
    updateOccurrence({ dispatch, socket, occurrence: { ...cur, textmap: { ...cur.textmap, content: next } } });
  }, [wrap, hostOccId, side, anchor, occurrencesById, dispatch, socket]);

  // Measure the neighbor's rendered box; re-size the host notch to match.
  useEffect(() => {
    if (!neighborOccId || !wrapRef.current) return;
    let el = null;
    try {
      el = wrapRef.current.querySelector(`[data-occ-id="${CSS.escape(neighborOccId)}"]`);
    } catch (_) { /* CSS.escape on weird ids — ignore */ }
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect || el.getBoundingClientRect();
      if (r && r.width && r.height) syncNotch(r.width, r.height);
    });
    ro.observe(el);
    // initial sync from current rect (ResizeObserver fires async)
    const r0 = el.getBoundingClientRect();
    if (r0.width && r0.height) syncNotch(r0.width, r0.height);
    return () => ro.disconnect();
  }, [neighborOccId, syncNotch]);

  // Measure where the host's spacer actually lands and expose it as --notch-y so
  // the absolutely-positioned neighbor sits exactly over the notch (top for L,
  // mid-flow for C). Re-measures on host resize + textmap change.
  useEffect(() => {
    const wrapEl = wrapRef.current;
    if (!wrapEl) return;
    const contentEl = wrapEl.querySelector(".wrap-group-content");
    const hostEl = contentEl?.children?.[0];
    if (!contentEl || !hostEl) return;
    const measureY = () => {
      const sp = hostEl.querySelector(".wrap-spacer");
      if (!sp) { wrapEl.style.setProperty("--notch-y", "0px"); return; }
      const y = Math.max(0, Math.round(sp.getBoundingClientRect().top - contentEl.getBoundingClientRect().top));
      wrapEl.style.setProperty("--notch-y", `${y}px`);
    };
    measureY();
    const ro = new ResizeObserver(measureY);
    ro.observe(hostEl);
    return () => ro.disconnect();
  }, [hostOccId, neighborOccId, host?.textmap]);

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`wrap-group wrap-group--${side} ${wrap ? "wrap-group--on" : "wrap-group--off"}`}
      data-side={side}
      data-wrap={wrap ? "on" : "off"}
      contentEditable={false}
    >
      <NodeViewContent className="wrap-group-content" />
    </NodeViewWrapper>
  );
}
