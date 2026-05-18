// docs/ModuleEmbedNode.jsx
// React NodeView for moduleEmbed — renders any module (container, instance, artifact)
// inline in a doc. Embed-specific actions (cycle alignment, pill, remove) are injected
// into the module's own RadialMenu via extraItems — no separate wrapper handle.
import { NodeViewWrapper } from "@tiptap/react";
import { useContext, useRef, useCallback, useState, useMemo, useEffect } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import Container from "../modules/ModuleContainer.jsx";
import ModuleInstance from "../modules/ModuleInstance.jsx";
import ArtifactContent from "../modules/ArtifactContent.jsx";
import TextblockCard from "../modules/TextblockCard.jsx";
import FieldRenderer from "../ui/FieldRenderer.jsx";
import { CellEmbedContext } from "./CellEmbedContext.js";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Box } from "lucide-react";
import { embedDeleteRegistry } from "../helpers/embedRegistry.js";

const ALIGN_CYCLE = ["full", "left", "center", "right"];
const ALIGN_ICONS = { full: AlignJustify, left: AlignLeft, center: AlignCenter, right: AlignRight };

function alignStyle(align, width) {
  const w = width ? `${width}px` : align === "full" ? "100%" : "40%";
  switch (align) {
    case "left":   return { float: "left",  width: w, marginRight: 12, marginBottom: 4, clear: "left" };
    case "right":  return { float: "right", width: w, marginLeft: 12,  marginBottom: 4, clear: "right" };
    case "center": return { margin: "0 auto", width: w, display: "block" };
    default:       return { width: "100%" };
  }
}

export default function ModuleEmbedNode({ node, updateAttributes, editor, getPos, deleteNode }) {
  const { occurrencesById, modulesById, viewsById, dispatch, socket, fieldsById } = useContext(GridActionsContext) || {};
  // Cell-mode projection: set by the enclosing cell <Editor> when the column
  // has a displayFieldId configured. Null/undefined = full doc-mode render.
  const { displayFieldId } = useContext(CellEmbedContext) || {};
  const occurrenceId = node.attrs.occurrenceId;
  const align = node.attrs.align || "full";
  const width = node.attrs.width || null;
  const occurrence = occurrencesById?.[occurrenceId];
  const mod = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const occView = occurrence?.viewId ? viewsById?.[occurrence.viewId] : null;

  // Register deleteNode so DragProvider can remove this embed on drag-out (move mode)
  useEffect(() => {
    if (!occurrenceId) return;
    embedDeleteRegistry.set(occurrenceId, deleteNode);
    return () => { embedDeleteRegistry.delete(occurrenceId); };
  }, [occurrenceId, deleteNode]);

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

  // Injected into the module's own RadialMenu so there's only one menu.
  const embedRadialItems = useMemo(() => {
    const nextAlign = ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(align) + 1) % ALIGN_CYCLE.length];
    const AlignIcon = ALIGN_ICONS[align];
    return [
      {
        label: `Align: ${align} → ${nextAlign}`,
        icon: AlignIcon,
        onClick: () => updateAttributes({ align: nextAlign, width: null }),
      },
      {
        label: "To pill",
        icon: Box,
        color: "bg-indigo-600 hover:bg-indigo-500",
        onClick: () => {
          if (!editor || !getPos || !mod) return;
          const pos = getPos();
          editor.chain().focus()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .insertContentAt(pos, {
              type: "instancePill",
              attrs: { instanceId: mod.id, instanceLabel: mod.label || "Item", occurrenceId },
            })
            .run();
        },
      },
    ];
  }, [align, updateAttributes, editor, getPos, mod, node.nodeSize, occurrenceId]);

  if (!mod) {
    return (
      <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", borderRadius: 4, border: "1px dashed var(--border-default)", margin: "2px 0" }}>
          embed: {occurrenceId || "missing"}
        </div>
      </NodeViewWrapper>
    );
  }

  // ── Cell-mode single-field projection ─────────────────────────────────────
  // When the enclosing table cell's column has a displayFieldId set AND the
  // embedded occurrence is an instance role, render ONLY that field via
  // FieldRenderer (compact, hideName) instead of the full ModuleInstance form.
  //
  // Guard: displayFieldId must be a non-empty string, the occurrence must be
  // an instance role (not container/artifact/textblock), and the field must
  // exist in fieldsById. The binding is synthesised from occurrence.fields so
  // FieldRenderer gets the stored value exactly as it would in normal render.
  //
  // Doc-mode (displayFieldId null/undefined) — falls straight through to the
  // original return below; NOT reached by this branch at all.
  if (displayFieldId && mod?.role === "instance" && occurrence) {
    const projField = fieldsById?.[displayFieldId];
    const projBinding = occurrence.fields?.[displayFieldId]
      ? { fieldId: displayFieldId }
      : { fieldId: displayFieldId };
    if (projField) {
      return (
        <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
          <FieldRenderer
            field={projField}
            binding={projBinding}
            occurrence={occurrence}
            instance={mod}
            compact
            dispatch={dispatch}
            socket={socket}
          />
        </NodeViewWrapper>
      );
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
      <div style={{ position: "relative", ...alignStyle(align, width) }}>
        {mod?.role === "textblock" ? (
          // Defensive: textblocks should appear as their own card even when
          // wrapped in a moduleEmbed node (e.g. from older data where a
          // textblock was inserted via the generic embed path). Without this
          // fall-through they'd render via the Container fallback below.
          <TextblockCard occurrence={occurrence} />
        ) : mod?.role === "instance" ? (
          <ModuleInstance
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
          />
        ) : (mod?.kind === "artifact" || occView?.viewType === "display") ? (
          <ArtifactContent
            occurrence={occurrence}
            viewType={occView?.viewType ?? "display"}
            artifactType={occView?.artifactType ?? null}
            dispatch={dispatch}
            socket={socket}
            view={occView}
          />
        ) : (
          <Container
            module={mod}
            panel={null}
            dispatch={dispatch}
            socket={socket}
            occurrenceOverride={occurrence}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
          />
        )}

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
              background: isResizing ? "var(--accent-blue)" : "var(--border-default)",
              transition: "background 0.15s",
            }} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
