// docs/ModuleEmbedNode.jsx
// React NodeView for moduleEmbed — renders any module (container, instance, artifact)
// inline in a doc. Embed-specific actions (cycle alignment, pill, remove) are injected
// into the module's own RadialMenu via extraItems — no separate wrapper handle.
import { NodeViewWrapper } from "@tiptap/react";
import { useContext, useRef, useCallback, useState, useMemo, useEffect } from "react";
import { useGridActionsSelector } from "../GridActionsContext.js";
import Container from "../modules/ModuleContainer.jsx";
import ModuleInstance from "../modules/ModuleInstance.jsx";
import ArtifactContent from "../modules/ArtifactContent.jsx";
import ArtifactCard from "../modules/ArtifactCard.jsx";
import TextblockCard from "../modules/TextblockCard.jsx";
import FieldRenderer from "../ui/FieldRenderer.jsx";
import { CellEmbedContext } from "./CellEmbedContext.js";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Box, Combine, Ungroup, WrapText } from "lucide-react";
import { embedDeleteRegistry } from "../helpers/embedRegistry.js";
import { findGroupMember, unwrapGroupAt, detachGroupMember } from "../helpers/wrapGroupOps.js";

const ALIGN_CYCLE = ["full", "left", "center", "right"];
const ALIGN_ICONS = { full: AlignJustify, left: AlignLeft, center: AlignCenter, right: AlignRight };

function alignStyle(align, width) {
  const w = width ? `${width}px` : align === "full" ? "100%" : "40%";
  switch (align) {
    case "left":   return { float: "left",  width: w, marginRight: 12, marginBottom: 4, clear: "left" };
    case "right":  return { float: "right", width: w, marginLeft: 12,  marginBottom: 4, clear: "right" };
    case "center": return { margin: "0 auto", width: w, display: "block" };
    // Full-width (default) embeds are PLAIN blocks (non-BFC) at auto width. Beside a
    // right-floated sibling (the Wikipedia lead aside, `align:"right"`) a plain block's
    // inline content wraps beside-then-under the float — a magazine lead where MULTIPLE
    // prose textblocks flow down the left and reclaim full width below the infobox. (A
    // BFC / `flow-root` here would shrink each block beside the float instead of wrapping
    // under it, so it's intentionally NOT used.) With no float present this is an ordinary
    // full-width block — visually identical to before.
    default:       return { width: "auto" };
  }
}

export default function ModuleEmbedNode({ node, updateAttributes, editor, getPos, deleteNode }) {
  // Per-slice selectors — a full useGridActions() re-rendered EVERY embed on
  // every occurrence write (doc pages mount one of these per embedded module).
  // The embed subscribes only to ITS occurrence; module/view maps are stable
  // across occurrence writes.
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const viewsById = useGridActionsSelector(s => s.viewsById);
  const dispatch = useGridActionsSelector(s => s.dispatch);
  const socket = useGridActionsSelector(s => s.socket);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  // Cell-mode projection: set by the enclosing cell <Editor> when the column
  // has a displayFieldId configured. Null/undefined = full doc-mode render.
  const { displayFieldId, hideLabel: cellHideLabel } = useContext(CellEmbedContext) || {};
  const occurrenceId = node.attrs.occurrenceId;
  const align = node.attrs.align || "full";
  const width = node.attrs.width || null;
  const occurrence = useGridActionsSelector(s => (occurrenceId ? s.occurrencesById?.[occurrenceId] : undefined));
  const mod = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const occView = occurrence?.viewId ? viewsById?.[occurrence.viewId] : null;

  // Register deleteNode so DragProvider can remove this embed on drag-out (move mode).
  // If this embed is inside a wrapGroup, a bare deleteNode would leave an invalid
  // 1-child group — detach the member (keeps the group valid / un-morphs the host).
  useEffect(() => {
    if (!occurrenceId) return;
    const onRegistryDelete = () => {
      const member = editor?.state?.doc ? findGroupMember(editor.state.doc, occurrenceId) : null;
      if (member) {
        detachGroupMember(editor, member.groupPos, occurrenceId);
        return;
      }
      deleteNode?.();
    };
    embedDeleteRegistry.set(occurrenceId, onRegistryDelete);
    return () => { embedDeleteRegistry.delete(occurrenceId); };
  }, [occurrenceId, deleteNode, editor, dispatch, socket]);

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

    // Block-wrap (project_block_wrap_l_shape): figure out whether this embed sits
    // inside a wrapGroup (→ offer wrap on/off + unwrap) or has a previous-sibling
    // embed it could wrap into (→ offer "wrap behind previous").
    let wrapGroupPos = null;
    let wrapGroupNode = null;
    let prevEmbed = null;
    if (editor && typeof getPos === "function") {
      try {
        const pos = getPos();
        const $pos = editor.state.doc.resolve(pos);
        if ($pos.parent?.type?.name === "wrapGroup") {
          wrapGroupPos = $pos.before($pos.depth);
          wrapGroupNode = $pos.parent;
        } else if ($pos.nodeBefore?.type?.name === "moduleEmbed") {
          prevEmbed = $pos.nodeBefore;
        }
      } catch (_) { /* position not resolvable yet */ }
    }

    const items = [
      {
        label: `Align: ${align} → ${nextAlign}`,
        icon: AlignIcon,
        onClick: () => updateAttributes({ align: nextAlign, width: null }),
      },
    ];

    if (prevEmbed) {
      // This embed is the NEIGHBOR; the previous embed is the HOST that wraps it.
      items.push({
        label: "Wrap behind previous",
        icon: Combine,
        color: "bg-teal-700 hover:bg-teal-600",
        onClick: () => {
          if (!editor || typeof getPos !== "function") return;
          const pos = getPos();
          const $before = editor.state.doc.resolve(pos);
          const prev = $before.nodeBefore;
          const cur = editor.state.doc.nodeAt(pos);
          if (!prev || prev.type.name !== "moduleEmbed" || !cur || cur.type.name !== "moduleEmbed") return;
          const groupType = editor.schema.nodes.wrapGroup;
          if (!groupType) return;
          const from = pos - prev.nodeSize;
          const to = pos + cur.nodeSize;
          const group = groupType.create({ side: "right", anchor: "top", wrap: true }, [prev, cur]);
          editor.chain().focus().command(({ tr }) => { tr.replaceWith(from, to, group); return true; }).run();
        },
      });
    }

    if (wrapGroupNode && wrapGroupPos != null) {
      const wrapOn = wrapGroupNode.attrs.wrap !== false;
      items.push({
        label: wrapOn ? "Wrap: on → off" : "Wrap: off → on",
        icon: WrapText,
        onClick: () => {
          if (!editor) return;
          const grp = editor.state.doc.nodeAt(wrapGroupPos);
          if (!grp || grp.type.name !== "wrapGroup") return;
          editor.chain().focus().command(({ tr }) => {
            tr.setNodeMarkup(wrapGroupPos, undefined, { ...grp.attrs, wrap: !wrapOn });
            return true;
          }).run();
        },
      });
      items.push({
        label: "Unwrap",
        icon: Ungroup,
        onClick: () => unwrapGroupAt(editor, wrapGroupPos),
      });
    }

    items.push({
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
    });

    return items;
  }, [align, updateAttributes, editor, getPos, mod, node.nodeSize, occurrenceId, dispatch, socket]);

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
    // stored binding carries role/display flags; fall back to a minimal one
    const storedBinding = mod?.fieldBindings?.find(b => b.fieldId === displayFieldId);
    const projBinding = storedBinding ?? { fieldId: displayFieldId };
    if (projField) {
      return (
        <NodeViewWrapper contentEditable={false} data-occ-id={occurrenceId}>
          <FieldRenderer
            field={projField}
            binding={projBinding}
            occurrence={occurrence}
            instance={mod}
            compact
            hideName
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
          // Render through ModuleInstance with renderBody=TextblockCard (the same
          // path ModuleContainer uses for textblock children) so an embedded
          // textblock gets the GripVertical drag handle + radial menu — not just
          // the bare editor. The imported article's prose blocks are textblock
          // occurrences embedded via moduleEmbed; without this they had no handle.
          <ModuleInstance
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            renderBody={() => <TextblockCard occurrence={occurrence} module={mod} />}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
          />
        ) : mod?.role === "instance" ? (
          <ModuleInstance
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
            embedHideLabel={cellHideLabel === true}
          />
        ) : occView?.viewType === "display" ? (
          <ArtifactContent
            occurrence={occurrence}
            viewType={occView?.viewType ?? "display"}
            artifactType={occView?.artifactType ?? null}
            dispatch={dispatch}
            socket={socket}
            view={occView}
          />
        ) : mod?.role === "artifact" ? (
          // Imported media artifacts carry role:"artifact" with a media kind
          // (image/video/audio/pdf) and NO view — route them through
          // ModuleInstance + ArtifactCard (same path ModuleContainer uses) so
          // they render (image <img>, audio <audio>, …) AND get a drag handle.
          // Previously the routing checked `mod.kind === "artifact"` (never true —
          // kind is the media type), so these fell to the Container fallback and
          // rendered nothing — that's why imported images didn't show.
          <ModuleInstance
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            // Hide the instance label row so an embedded artifact reads as a clean,
            // filled media block (not "an instance with a picture"). Drag handle +
            // radial menu stay (still a draggable occurrence).
            embedHideLabel
            renderBody={() => <ArtifactCard module={mod} label={mod.label} occurrence={occurrence} />}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
          />
        ) : (
          <Container
            module={mod}
            panel={null}
            dispatch={dispatch}
            socket={socket}
            occurrenceOverride={occurrence}
            embedded
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
