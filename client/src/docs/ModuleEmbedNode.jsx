// docs/ModuleEmbedNode.jsx
// React NodeView for moduleEmbed — renders a <Container embedded> card
// with alignment controls (left/center/right/full) and a resize handle.
import { NodeViewWrapper } from "@tiptap/react";
import { useContext, useRef, useCallback, useState } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import Container from "../modules/Container.jsx";

const ALIGN_OPTIONS = [
  { key: "left",   label: "◧", title: "Float left (40%)" },
  { key: "center", label: "⊡", title: "Center" },
  { key: "right",  label: "◨", title: "Float right (40%)" },
  { key: "full",   label: "⊞", title: "Full width" },
];

function alignStyle(align, width) {
  const w = width ? `${width}px` : align === "full" ? "100%" : "40%";
  switch (align) {
    case "left":   return { float: "left",  width: w, marginRight: 12, marginBottom: 4, clear: "left" };
    case "right":  return { float: "right", width: w, marginLeft: 12,  marginBottom: 4, clear: "right" };
    case "center": return { margin: "0 auto", width: w, display: "block" };
    default:       return { width: "100%" };
  }
}

export default function ModuleEmbedNode({ node, updateAttributes, selected }) {
  const { occurrencesById, modulesById, dispatch, socket } = useContext(GridActionsContext) || {};
  const occurrenceId = node.attrs.occurrenceId;
  const align = node.attrs.align || "full";
  const width = node.attrs.width || null;
  const occurrence = occurrencesById?.[occurrenceId];
  const mod = occurrence?.targetId ? modulesById?.[occurrence.targetId] : null;

  // Resize drag state
  const resizeRef = useRef(null);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const [isResizing, setIsResizing] = useState(false);

  const onResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = resizeRef.current?.closest("[data-occ-id]") || resizeRef.current?.parentElement;
    startXRef.current = e.clientX;
    startWRef.current = container ? container.getBoundingClientRect().width : (width || 300);
    setIsResizing(true);

    const onMove = (ev) => {
      const delta = ev.clientX - startXRef.current;
      const newW = Math.max(120, Math.round(startWRef.current + delta));
      updateAttributes({ width: newW });
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, updateAttributes]);

  if (!mod) {
    return (
      <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", borderRadius: 4, border: "1px dashed var(--border-default)", margin: "2px 0" }}>
          embed: {occurrenceId || "missing"}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
      <div style={{ position: "relative", ...alignStyle(align, width) }}>
        {/* Alignment + reset controls — visible when node is selected */}
        {selected && (
          <div
            style={{
              position: "absolute", top: -22, left: 0, zIndex: 10,
              display: "flex", gap: 2, padding: "2px 4px",
              background: "var(--surface-card)", borderRadius: 5,
              border: "1px solid var(--input-border)",
            }}
          >
            {ALIGN_OPTIONS.map(opt => (
              <button
                key={opt.key}
                title={opt.title}
                onClick={() => updateAttributes({ align: opt.key, width: null })}
                style={{
                  background: align === opt.key ? "var(--accent-blue-bg)" : "transparent",
                  border: align === opt.key ? "1px solid var(--accent-blue-border)" : "1px solid transparent",
                  borderRadius: 3, color: "var(--text-primary)", cursor: "pointer",
                  fontSize: 11, padding: "1px 5px", lineHeight: 1.4,
                }}
              >
                {opt.label}
              </button>
            ))}
            {width && (
              <button
                title="Reset width"
                onClick={() => updateAttributes({ width: null })}
                style={{
                  background: "transparent", border: "1px solid transparent",
                  borderRadius: 3, color: "var(--text-muted)", cursor: "pointer",
                  fontSize: 9, padding: "1px 5px",
                }}
              >
                ×w
              </button>
            )}
          </div>
        )}

        <Container
          module={mod}
          panel={null}
          dispatch={dispatch}
          socket={socket}
          embedded={true}
          occurrenceOverride={occurrence}
        />

        {/* Resize handle — right edge drag */}
        {align !== "full" && (
          <div
            ref={resizeRef}
            onMouseDown={onResizeMouseDown}
            style={{
              position: "absolute", right: -4, top: 0, bottom: 0, width: 8,
              cursor: "ew-resize", zIndex: 5,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div style={{
              width: 3, height: 24, borderRadius: 2,
              background: selected || isResizing ? "var(--accent-blue)" : "var(--border-default)",
              transition: "background 0.15s",
            }} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
