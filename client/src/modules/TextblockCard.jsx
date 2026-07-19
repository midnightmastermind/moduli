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
import React, { useEffect, useRef, useState, useMemo } from "react";
import Editor from "../ui/Editor.jsx";
import { useGridActions } from "../GridActionsContext";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";

// Per-placement link (occurrence.meta) wins over the template default (module.meta).
function resolveLink(occurrence, module) {
  return occurrence?.meta?.link || module?.meta?.link || null;
}

// One plain-text string per top-level block — used as a lightweight, roughly
// height-matched placeholder before the live editor mounts (see below).
function textmapBlocks(textmap) {
  if (!textmap || typeof textmap !== "object") return [];
  const content = Array.isArray(textmap.content) ? textmap.content : [];
  return content.map((node) => {
    const parts = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(node);
    return parts.join("");
  });
}

export default function TextblockCard({ occurrence, module }) {
  const { dispatch, socket } = useGridActions();
  const isInline = module?.kind === "inline";
  const link = resolveLink(occurrence, module);

  // Block-wrap (project_block_wrap_redesign): when this textblock is a wrapGroup
  // HOST, the wrap CSS clips `.textblock-card` to the L via the `--wrap-host-clip`
  // var WrapGroupNode measures from the floated neighbor — no work needed here.
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

  // Long imported lists flow into multiple columns CAPPED BY HEIGHT (importer sets
  // meta.listCapRows ≈ 20 items): the list fills a column to ~20 rows then wraps
  // into the next column, so the number of columns responds to the height rather
  // than a fixed count.
  const listCapRows = Number(occurrence?.meta?.listCapRows) || 0;
  const baseCls = isInline ? "textblock-card textblock-card--inline" : "textblock-card";
  const cardStyle = listCapRows > 0 ? { "--list-cap-rows": listCapRows } : {};
  const cls = listCapRows > 0 ? `${baseCls} textblock-card--cols` : baseCls;

  // PERF: a live TipTap/ProseMirror editor per textblock is the app's dominant
  // render cost (~250 on the live grid; 100+ on an imported article). Mount the
  // real editor only once this block scrolls near the viewport (or is clicked/
  // focused). Until then show a readable, roughly height-matched plain-text
  // placeholder. Once live it STAYS live (no scroll-away unmount → no flash, no
  // lost edit state). Inline chips + empty blocks mount eagerly (small / editable
  // immediately). Falls back to eager mount if IntersectionObserver is missing.
  const hasContent = !!(occurrence?.textmap && typeof occurrence.textmap === "object");
  const eager = isInline || !hasContent;
  const blocks = useMemo(() => (eager ? [] : textmapBlocks(occurrence.textmap)), [eager, occurrence?.textmap]);
  const cardRef = useRef(null);
  const [live, setLive] = useState(eager);
  useEffect(() => {
    if (live) return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setLive(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: "700px" });
    io.observe(el);
    return () => io.disconnect();
  }, [live]);

  if (!live) {
    return (
      <div
        ref={cardRef}
        className={cls}
        style={Object.keys(cardStyle).length ? cardStyle : undefined}
        onPointerDown={() => setLive(true)}
        title="Click to edit"
      >
        <div className="textblock-card-placeholder" style={{ cursor: "text" }}>
          {blocks.map((b, i) => (
            <div key={i} style={{ minHeight: "1.35em" }}>{b || " "}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={cardRef} className={cls} style={Object.keys(cardStyle).length ? cardStyle : undefined}>
      <Editor
        occurrence={occurrence}
        content={hasContent ? occurrence.textmap : null}
        dispatch={dispatch}
        socket={socket}
        placeholder="Type…"
        mode={isInline ? "inline" : "doc"}
      />
    </div>
  );
}
