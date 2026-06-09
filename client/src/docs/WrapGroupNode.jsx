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
  const wrap = node.attrs.wrap !== false;
  const hostOccId = node.firstChild?.attrs?.occurrenceId || null;
  const neighborOccId = node.lastChild?.attrs?.occurrenceId || null;

  const { occurrencesById, dispatch, socket } = useGridActions() || {};
  const wrapRef = useRef(null);
  const lastSize = useRef({ w: -1, h: -1 });

  // Push a wrapSpacer of size w×h to the FRONT of the host's textmap (or update
  // the existing one / strip it when wrap is off).
  const syncNotch = useCallback((w, h) => {
    if (!hostOccId) return;
    const host = occurrencesById?.[hostOccId];
    if (!host?.textmap?.content || !Array.isArray(host.textmap.content)) return;
    const hasSpacer = host.textmap.content[0]?.type === "wrapSpacer";

    if (!wrap) {
      if (!hasSpacer) return;
      const content = host.textmap.content.slice(1); // drop the spacer
      lastSize.current = { w: -1, h: -1 };
      updateOccurrence({ dispatch, socket, occurrence: { ...host, textmap: { ...host.textmap, content } } });
      return;
    }

    const rw = Math.round(w);
    const rh = Math.round(h);
    if (Math.abs(rw - lastSize.current.w) < MIN_DELTA && Math.abs(rh - lastSize.current.h) < MIN_DELTA) return;
    const cur = host.textmap.content[0];
    if (hasSpacer && cur.attrs?.w === rw && cur.attrs?.h === rh && cur.attrs?.side === side) {
      lastSize.current = { w: rw, h: rh };
      return;
    }
    lastSize.current = { w: rw, h: rh };
    const spacer = { type: "wrapSpacer", attrs: { w: rw, h: rh, side } };
    const content = hasSpacer
      ? [spacer, ...host.textmap.content.slice(1)]
      : [spacer, ...host.textmap.content];
    updateOccurrence({ dispatch, socket, occurrence: { ...host, textmap: { ...host.textmap, content } } });
  }, [wrap, hostOccId, side, occurrencesById, dispatch, socket]);

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
