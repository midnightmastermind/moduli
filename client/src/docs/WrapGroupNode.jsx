// docs/WrapGroupNode.jsx
// NodeView for the wrapGroup block (project_block_wrap_redesign). Renders the
// NEIGHBOR embeds (children 0..N-2) followed by the HOST embed (the LAST child) in
// ONE block flow. CSS floats the neighbors to `side` at `neighborWidth`; the host's
// own prose wraps around them natively (a real L — no ghost wrapSpacer, no absolute
// overlay). This NodeView's ONLY job is to render a draggable seam that sets
// `neighborWidth` live (the prose re-wraps natively as it moves). The L-shape is pure
// CSS: the neighbor floats and the host (a normal in-flow block) wraps beside it and
// reclaims full width underneath — no clip-path, no margin reservation, no ghost spot.
//
// NEIGHBOR-FIRST ORDER IS LOAD-BEARING (see WrapGroupExtension.js): a CSS float only
// wraps content AFTER it, so the neighbor must precede the host in source order.
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useRef, useEffect, useCallback, useState } from "react";

const DEFAULT_NW = 300;   // px — default neighbor column width when unset
const MIN_NW = 120;       // px — splitter clamp floor
const SEAM_GAP = 14;      // px — channel between host edge and neighbor (matches CSS margin)
const BOTTOM_GAP = 14;    // px — gap below the neighbor before the full-width bottom bar
                          // (matches the float's CSS margin-bottom); the seam (vertical inner
                          // line + its ::after notch-bottom line) extends this far past the
                          // neighbor so the bottom-bar's TOP border sits BELOW the image with
                          // margin above it, instead of flush against the image.

// @tiptap/react nests the child embeds inside a [data-node-view-content-react]
// holder, so the real embeds (neighbors + host) are GRANDCHILDREN of
// `.wrap-group-content`. Resolve them regardless of that wrapper.
function embedEls(contentEl) {
  if (!contentEl) return [];
  const holder = contentEl.querySelector(":scope > [data-node-view-content-react]") || contentEl;
  return Array.from(holder.children);
}

export default function WrapGroupNode({ node, updateAttributes }) {
  const side = node.attrs.side === "left" ? "left" : "right";
  // Host is the LAST child; everything before it is a floated neighbor.
  const neighborCount = Math.max(0, node.childCount - 1);
  // The L (overflow-bottom) is the agreed default whenever there's a neighbor to
  // wrap around — the importer still emits `wrap:false` (that was "step 1: side
  // by side"), so we no longer gate on the attr. A right/left float gives BOTH
  // shapes natively off the measured heights: prose sits beside a tall neighbor,
  // and reclaims full width underneath once it's taller (the "extend the bottom").
  const wrap = neighborCount > 0;
  // Shape = where the neighbor sits vertically (× `side` for left/right). Drives which
  // inner-L border lines the seam/clip draw:
  //   top     — anchorIndex 0: notch at the TOP corner, prose beside + full-width below.
  //   middle  — mid-block anchor: notch mid-edge, full-width prose ABOVE and BELOW it.
  //   bottom  — neighbor reaches the host BOTTOM: full-width prose above + beside it, but
  //             NONE below → the host traces an upside-down L. (Distinct from `middle`,
  //             which has a full-width bottom bar.) Detected from the MEASURED neighbor box,
  //             not just anchorIndex, so it's set in measure(); render-time is a first guess.
  // `side` (left/right) gives the mirrored forms — no separate names needed.
  const [measuredShape, setMeasuredShape] = useState(null);
  const shape = measuredShape || (((Number(node.attrs.anchorOffset) || Number(node.attrs.anchorIndex) || 0) > 0) ? "middle" : "top");
  const neighborWidth = node.attrs.neighborWidth == null ? DEFAULT_NW : Number(node.attrs.neighborWidth);

  const wrapRef = useRef(null);
  const [seam, setSeam] = useState(null); // {top,height,left} for the splitter, or null
  const dragRef = useRef(null);
  const rafRef = useRef(0);

  // Measure the floated neighbor stack ONLY to place the draggable resize seam. The
  // wrap itself is pure CSS now: the neighbor floats, and the host (a normal in-flow
  // block — see index.css) wraps its prose beside it and reclaims full width underneath.
  // No clip-path, no margin-top reservation — no ghost spot, no covering on the top.
  const measure = useCallback(() => {
    const wrapEl = wrapRef.current;
    if (!wrapEl) return;
    const contentEl = wrapEl.querySelector(".wrap-group-content");
    if (!contentEl) return;
    const els = embedEls(contentEl);
    // Measure regardless of wrap on/off — the seam (column resize handle) is
    // valid in BOTH the two-column (`wrap:false`) and L-float (`wrap:true`)
    // layouts; it reads the live neighbor box either way. Gating it on `wrap`
    // hid the resize handle in two-column mode (the importer emits wrap:false).
    if (els.length < 2) { setSeam(null); return; }
    const neighbors = els.slice(0, els.length - 1);

    const wrapRect = wrapEl.getBoundingClientRect();
    // Union bounding box of the neighbor column (all stacked neighbors).
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    neighbors.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    });
    if (!isFinite(left) || right <= left) { setSeam(null); return; }

    // The WRAP needs no measurement for the WIDTH — the neighbor floats (--wrap-nw)
    // and the host's prose wraps around it natively (see index.css .wrap-group--on).
    // For the SHAPE (L / C / J) we set the float's margin-top from `anchorIndex` —
    // the host block index the neighbor should START at:
    //   anchorIndex 0           → margin-top 0 → float at the top → L
    //   anchorIndex mid-block   → float pushed down → prose is full-width ABOVE it,
    //                             beside it in the middle, full-width below → C
    //   (J = the same with side="left"/"right" flipped — handled by the `side` attr)
    // This is STABLE (no feedback loop): the blocks ABOVE the anchor are full-width
    // (the float isn't beside them), so their heights — and thus the anchor block's
    // top — don't depend on the float's position.
    const holderEl = contentEl.querySelector(":scope > [data-node-view-content-react]") || contentEl;
    const holderTop = holderEl.getBoundingClientRect().top;
    // Line-level anchor: `anchorOffset` (px from the host prose top) is the float's
    // margin-top directly, so the neighbor can start at ANY visual line — not just a
    // block boundary. Falls back to the legacy anchorIndex→block-top for old nodes.
    const anchorOffset = node.attrs.anchorOffset;
    let mt = 0;
    if (anchorOffset != null && Number.isFinite(Number(anchorOffset))) {
      mt = Math.max(0, Math.round(Number(anchorOffset)));
    } else {
      const anchorIndex = Number(node.attrs.anchorIndex) || 0; // legacy fallback
      if (anchorIndex > 0) {
        const hostPm = els[els.length - 1].querySelector(".ProseMirror");
        const blocks = hostPm ? Array.from(hostPm.children) : [];
        const idx = Math.min(anchorIndex, blocks.length - 1);
        if (idx > 0 && blocks[idx]) {
          mt = Math.max(0, Math.round(blocks[idx].getBoundingClientRect().top - holderTop));
        }
      }
    }
    wrapEl.style.setProperty("--wrap-mt", `${mt}px`);

    // Notch for the host CLIP: the host keeps its column background, but index.css
    // clips it OUT of the neighbor's footprint so the bg/border never extend behind
    // the floated neighbor (which made the neighbor look nested inside the host).
    // Measured relative to the host's OUTER box (.instance-row for a textblock host,
    // .container-shell for a doc-container host) — the element the clip-path is on.
    // notch-y lets the cut sit mid-host for a C (not just the top corner for an L).
    const hostBox = els[els.length - 1].querySelector(".instance-row, .container-shell");
    if (hostBox) {
      const c = hostBox.getBoundingClientRect();
      // Extend the notch by HALF the float-margin gap (SEAM_GAP/2) — exactly to the
      // resize-seam line (which sits at the gap's midpoint). This (a) clips the host's
      // column background out of the sliver to the RIGHT of the seam so it shows the
      // PARENT background, and (b) lands the host's clipped top border ON the seam so
      // the top border meets the resize handle (no gap between them). A FULL SEAM_GAP
      // pulled the border a half-gap left of the seam, leaving that gap unbordered.
      const notchW = side === "right"
        ? Math.round(c.right - left + SEAM_GAP / 2)
        : Math.round(right - c.left + SEAM_GAP / 2);
      // L (anchorIndex 0): notch starts at the very top (0) so no bg/border strip is
      // left above the neighbor. C (anchorIndex > 0): notch sits at the neighbor's top.
      const anchorIdx = Number(node.attrs.anchorIndex) || 0;
      const notchY = anchorIdx > 0 ? Math.max(0, Math.round(top - c.top)) : 0;
      const notchH = Math.round(bottom - top);
      wrapEl.style.setProperty("--notch-w", `${Math.max(0, notchW)}px`);
      wrapEl.style.setProperty("--notch-y", `${Math.max(0, notchY)}px`);
      wrapEl.style.setProperty("--notch-h", `${Math.max(0, notchH)}px`);
      // Classify the shape from the measured boxes: `top` (notch at top), else `bottom`
      // when the neighbor reaches the host BOTTOM (no full-width prose below → upside-down
      // L), else `middle` (neighbor mid-column, prose above AND below).
      const reachesBottom = (c.bottom - bottom) < 24;
      setMeasuredShape(anchorIdx <= 0 ? "top" : (reachesBottom ? "bottom" : "middle"));
    }

    // Seam sits in the gap at the INNER edge of the neighbor column (works for the
    // flex two-column layout AND a float, since it reads the live rendered box).
    const seamLeft = side === "right"
      ? Math.round(left - wrapRect.left - SEAM_GAP / 2)
      : Math.round(right - wrapRect.left + SEAM_GAP / 2);
    // Seam height = the neighbor's height PLUS the bottom gap, so the seam's ::after
    // (the notch-bottom line = the full-width bottom bar's TOP border) sits BELOW the
    // image with a margin above it, not flush against the image bottom.
    setSeam({ top: Math.round(top - wrapRect.top), height: Math.round(bottom - top) + BOTTOM_GAP, left: seamLeft });
  }, [side, node.attrs.anchorIndex, node.attrs.anchorOffset]);

  useEffect(() => {
    const wrapEl = wrapRef.current;
    if (!wrapEl) return;
    // Push the float width as a CSS var so the floats size before we measure.
    wrapEl.style.setProperty("--wrap-nw", `${neighborWidth}px`);
    measure();
    const contentEl = wrapEl.querySelector(".wrap-group-content");
    const ro = new ResizeObserver(measure);
    ro.observe(wrapEl);
    embedEls(contentEl).forEach((el) => ro.observe(el));
    // Re-measure when a neighbor image finishes loading (h=0 until load).
    const imgs = embedEls(contentEl).slice(0, -1).flatMap((el) => Array.from(el.querySelectorAll("img")));
    imgs.forEach((img) => { if (!img.complete) img.addEventListener("load", measure); });
    // Backstop: a Wikipedia infobox is a TABLE whose rows lay out after the RO's
    // last fire, so the seam (and its column-rule line) would be measured too short.
    // Re-measure on a short schedule until it settles. No feedback loop — the seam is
    // an absolutely-positioned overlay, so it never changes the neighbor we measure.
    const timers = [120, 400, 1000, 2200, 4000].map((ms) => setTimeout(measure, ms));
    return () => {
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener("load", measure));
      timers.forEach(clearTimeout);
    };
  }, [neighborWidth, neighborCount, measure]);

  // Seam drag → set neighborWidth live (clamped). Like a grid-column splitter.
  const onSeamDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapEl = wrapRef.current;
    const maxW = wrapEl ? Math.round(wrapEl.getBoundingClientRect().width * 0.7) : 600;
    dragRef.current = { startX: e.clientX, startW: neighborWidth, maxW };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      // Dragging toward the prose (left for a right float) WIDENS the neighbor.
      const delta = side === "right" ? d.startX - ev.clientX : ev.clientX - d.startX;
      const next = Math.max(MIN_NW, Math.min(d.maxW, Math.round(d.startW + delta)));
      if (wrapEl) wrapEl.style.setProperty("--wrap-nw", `${next}px`);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
      dragRef.current.lastW = next;
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (d && d.lastW != null && d.lastW !== d.startW) updateAttributes?.({ neighborWidth: d.lastW });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [neighborWidth, side, measure, updateAttributes]);

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`wrap-group wrap-group--${side} wrap-group--shape-${shape} ${wrap ? "wrap-group--on" : "wrap-group--off"}`}
      data-side={side}
      data-shape={shape}
      data-wrap={wrap ? "on" : "off"}
      contentEditable={false}
    >
      {/* The two real, separate occurrence embeds (neighbor + host) render here —
          each is its own draggable occurrence with its own handle/menu. */}
      <NodeViewContent className="wrap-group-content" />
      {seam && neighborCount > 0 && (
        <div
          className="wrap-seam"
          style={{ top: seam.top, height: seam.height, left: seam.left }}
          onPointerDown={onSeamDown}
          contentEditable={false}
          title="Drag to resize"
        />
      )}
    </NodeViewWrapper>
  );
}
