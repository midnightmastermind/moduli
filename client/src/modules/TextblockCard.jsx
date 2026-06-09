// modules/TextblockCard.jsx
// Renderer for role:"textblock" modules in a container.
// Wraps the existing <Editor> on occurrence.textmap. Saves are debounced through
// Editor's existing onChange → updateOccurrence path (same as DocContent).
//
// `kind:"inline"` variant (task #6.6 / LT1 — 2026-05-24): textblock-inline
// renders WITHOUT card chrome — no border, no margin, no padding. The Editor
// shell stays but its block-handle + drag-grip affordances are suppressed
// (via `mode="inline"`) so the block flows seamlessly inline with surrounding
// text. Created via QuickAddMenu's textblock entry when kind:"inline" is
// picked, or via right-click "convert highlight to inline-textblock".
//
// LINK mini-textblock (2026-06-05): when the occurrence (or its module) carries
// `meta.link`, the block renders as a clickable CHIP instead of an editor:
//   - { kind: "url", url }            → opens the URL in a new tab
//   - { kind: "occurrence", occId }   → scrolls to + flashes that occurrence
// The markdown importer emits these for every [text](url) link; a user can also
// set one via the textblock's settings (meta.link on the occurrence).
import React, { useContext } from "react";
import Editor from "../ui/Editor.jsx";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";

// Per-placement link (occurrence.meta) wins over the template default (module.meta).
function resolveLink(occurrence, module) {
  return occurrence?.meta?.link || module?.meta?.link || null;
}

// Block-wrap (project_block_wrap_l_shape): if this host's textmap carries a
// wrapSpacer node, its own text already reflows around the reserved notch (the
// spacer floats). To make the BORDER trace the L/C too (so it reads as a notched
// box rather than a rectangle drawn through the neighbor), we clip the card to a
// polygon that cuts the notch out of the corresponding corner.
function findWrapSpacer(textmap) {
  const content = textmap?.content;
  if (!Array.isArray(content)) return null;
  for (const n of content) {
    if (n?.type === "wrapSpacer") {
      return {
        w: Number(n.attrs?.w) || 0,
        h: Number(n.attrs?.h) || 0,
        side: n.attrs?.side === "left" ? "left" : "right",
      };
    }
  }
  return null;
}

function notchClipPath(spacer) {
  if (!spacer || !spacer.w || !spacer.h) return undefined;
  const { w, h, side } = spacer;
  // Notch sits at the TOP corner on `side` (matches a top-anchored float). The
  // polygon walks the outline with the corner cut inward by the spacer footprint.
  return side === "left"
    ? `polygon(${w}px 0, 100% 0, 100% 100%, 0 100%, 0 ${h}px, ${w}px ${h}px)`
    : `polygon(0 0, calc(100% - ${w}px) 0, calc(100% - ${w}px) ${h}px, 100% ${h}px, 100% 100%, 0 100%)`;
}

export default function TextblockCard({ occurrence, module }) {
  const { dispatch, socket } = useGridActions();
  const isInline = module?.kind === "inline";
  const link = resolveLink(occurrence, module);

  if (link && (link.url || link.occId || link.target)) {
    const label = module?.label
      || occurrence?.textmap?.content?.[0]?.content?.[0]?.text
      || link.url
      || "link";
    const isUrl = link.kind === "url" || (!!link.url && !link.occId && !link.target);
    const targetId = link.occId || link.target || null;

    const chipStyle = {
      display: "inline-flex", alignItems: "center", gap: 4,
      maxWidth: "100%", padding: "2px 8px", borderRadius: 999, fontSize: 12,
      background: "rgba(110,170,230,0.14)", border: "1px solid rgba(110,170,230,0.4)",
      color: "var(--accent-blue-text, rgb(150,195,250))", textDecoration: "none",
      cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    };

    if (isUrl) {
      return (
        <div className="textblock-card textblock-card--link">
          <a href={link.url} target="_blank" rel="noopener noreferrer" style={chipStyle} title={link.url}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            <span style={{ opacity: 0.7, flexShrink: 0 }}>↗</span>
          </a>
        </div>
      );
    }
    // Internal target — navigate within the app (scroll + flash).
    return (
      <div className="textblock-card textblock-card--link">
        <button
          type="button"
          onClick={() => targetId && jumpToOccurrence(targetId)}
          style={{ ...chipStyle, background: "rgba(130,200,150,0.14)", borderColor: "rgba(130,200,150,0.4)", color: "var(--accent-green-text, rgb(150,210,170))" }}
          title="Go to linked item"
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          <span style={{ opacity: 0.7, flexShrink: 0 }}>→</span>
        </button>
      </div>
    );
  }

  const wrapSpacer = findWrapSpacer(occurrence?.textmap);
  const clipPath = notchClipPath(wrapSpacer);

  return (
    <div
      className={isInline ? "textblock-card textblock-card--inline" : "textblock-card"}
      style={clipPath ? { clipPath } : undefined}
    >
      <Editor
        occurrence={occurrence}
        content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
        dispatch={dispatch}
        socket={socket}
        placeholder="Type…"
        mode={isInline ? "inline" : "doc"}
      />
    </div>
  );
}
