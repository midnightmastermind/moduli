// ui/Editor.jsx
// ============================================================
// General-purpose TipTap rich-text editor.
// Replaces docs/DocEditor.jsx + docs/DocContainer.jsx.
//
// Props:
//   content       – TipTap JSON (occurrence.textmap)
//   onChange      – called with TipTap JSON on each change (debounced)
//   onBlur        – called with TipTap JSON on blur (immediate save)
//   occurrence    – if provided, saves automatically to occurrence.textmap
//   dispatch      – for CommitHelpers
//   socket        – for CommitHelpers
//   editable      – always true by default (drops work without switching mode)
//   showToolbar   – only show formatting toolbar when true (e.g., when user is editing)
//   placeholder   – placeholder text
//   className     – extra wrapper classes
//   onConvertListToInstances – (texts: string[]) => void (context-menu "convert list")
// ============================================================

import {
  useCallback, useEffect, useMemo, useRef, useState,
  forwardRef, useImperativeHandle,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { watchRegion } from "../helpers/gapHover.js";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TaskListMarkdown } from "../docs/TaskListMarkdown";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { NATIVE_DND_MIME, registerDocTouchDrop, getDocTouchDropZone } from "../helpers/dragSystem";
import { embedDeleteRegistry } from "../helpers/embedRegistry";
import { findGroupMember, unwrapGroupAt, isNeighborMember } from "../helpers/wrapGroupOps";
import { sideFromFrac, anchorOffsetForDrop, isTextmappedModule } from "../docs/wrapAnchor";
import { logCaretPointerDown, logCaretInterference } from "../helpers/caretDiag";

// px — a drop this far BELOW a wrap host's rendered text bottom is treated as an
// insert-after (not a wrap-beside), so dropping under a short host beside a tall
// neighbor no longer adds the block as a top-anchored neighbor. See detectSideHost.
const BELOW_HOST_TOL = 8;

// ONE document-level dragend/drop listener pair shared by every mounted doc
// editor (page editors + delegate-only nested section editors). Each editor
// registers a clear-indicators callback instead of attaching its own pair —
// a big page mounts several editors, and every drop/dragend anywhere in the
// app used to fan out through all of them (same registry pattern as
// dragSystem's _docTouchDropZones).
const _dragEndClearFns = new Set();
let _dragEndListenersOn = false;
function registerDragEndClear(fn) {
  _dragEndClearFns.add(fn);
  if (!_dragEndListenersOn && typeof document !== "undefined") {
    _dragEndListenersOn = true;
    const runAll = () => { for (const f of _dragEndClearFns) f(); };
    document.addEventListener("dragend", runAll);
    document.addEventListener("drop", runAll, true);
  }
  return () => { _dragEndClearFns.delete(fn); };
}

import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { FieldPill } from "../docs/FieldPillExtension";
import { InstancePill } from "../docs/InstancePillExtension";
import { Footnote } from "../docs/FootnoteExtension";
import { DocLink } from "../docs/DocLinkExtension";
import { PillBackspace } from "../docs/PillBackspaceExtension";
import { HeadingFocus } from "../docs/HeadingFocusExtension";
import { ModuleEmbed } from "../docs/ModuleEmbedExtension";
import { WrapGroup } from "../docs/WrapGroupExtension";
import { InstanceTextblock } from "../docs/InstanceTextblockExtension";
import { InstanceTextblockInline } from "../docs/InstanceTextblockInlineExtension";
import { ExprPill } from "../docs/ExprPillExtension";
import { CellEmbedContext } from "../docs/CellEmbedContext";
import FieldSuggestion from "../docs/suggestions/FieldSuggestion";
import CommandPalette from "../docs/suggestions/CommandPalette";
import DocLinkSuggestion from "../docs/suggestions/DocLinkSuggestion";
import DocToolbar from "../docs/DocToolbar";
import ContextMenu from "./ContextMenu";
import { useGridActionsSelector } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { createArtifactPlaceholders, uploadArtifactPlaceholders } from "../helpers/artifactUpload";
import QuickAddMenu from "./QuickAddMenu.jsx";
import { Bold, Italic, Strikethrough, Code, RemoveFormatting, AtSign, List, Box, Type, Plus, Shuffle } from "lucide-react";
import { convertLeafRole } from "../helpers/convertOccurrence";
import { consumeTextblockFocus } from "../helpers/pendingTextblockFocus";
import { operationsBridge } from "../state/bindSocketToStore";

// Atomic same-doc move for a TipTap embed node (instanceTextblock,
// moduleEmbed). Scans the editor's doc for a node whose attrs match
// `match`; if found, performs `delete(from, to)` + `insert(adjustedPos,
// sameNode)` in ONE transaction. Same node object → same NodeView attrs
// → React reuses the component, no flicker, no recreation. Returns true
// when handled. When the source isn't in this doc (cross-doc / from CC)
// the function returns false and the caller falls back to the
// registry-delete + new-node-insert path.
// Concatenate two inline-content arrays (the `.content` of paragraph nodes).
// Adjacent text nodes that share their mark set are coalesced into a single
// text run — otherwise each merged keystroke would remain a separate text
// node, which still renders fine but bloats the textmap and breaks cursor
// arithmetic in the sub-editor.
function concatInline(a, b) {
  const result = a.slice();
  for (const node of b) {
    const tail = result[result.length - 1];
    const sameMarks = JSON.stringify(tail?.marks || []) === JSON.stringify(node?.marks || []);
    if (tail?.type === "text" && node?.type === "text" && sameMarks) {
      result[result.length - 1] = { ...tail, text: (tail.text || "") + (node.text || "") };
    } else {
      result.push(node);
    }
  }
  return result;
}

// The nearest top-level block BOUNDARY (gap) to a vertical cursor position.
// Returns { pos, top } where `pos` is the ProseMirror insert position at that
// gap and `top` is wrapper-relative px for rendering the indicator. Unlike
// posAtCoords this works in the EMPTY MARGIN between blocks (where posAtCoords
// returns null), so the hover affordance + drag indicator don't vanish in the
// very gap the user is aiming at — and the actual drop reuses it, so the block
// lands exactly where the indicator showed.
function nearestDocBoundary(view, doc, wrapEl, clientY) {
  if (!view || !doc || !wrapEl || doc.childCount === 0) return null;
  const wrapTop = wrapEl.getBoundingClientRect().top;
  let best = null, bestDist = Infinity;
  const cand = (pos, y) => {
    const d = Math.abs(y - clientY);
    if (d < bestDist) { bestDist = d; best = { pos, top: y - wrapTop }; }
  };
  doc.forEach((node, off) => {
    let dom = null;
    try { dom = view.nodeDOM(off); } catch (_) { /* */ }
    const rect = dom?.getBoundingClientRect?.();
    if (!rect) return;
    cand(off, rect.top);                    // gap before this block
    cand(off + node.nodeSize, rect.bottom); // gap after this block
  });
  return best;
}

// True when clientY falls inside any top-level block's content box (i.e. the
// pointer is over a block, not in the inter-block gutter). The hover insert-gap
// affordance uses this to stay OUT of the way while the user is clicking into a
// block to edit it — the gap only belongs in the empty margin BETWEEN blocks.
// Drag/drop intentionally does NOT consult this (a drop over a block should
// still snap to the nearest boundary), so it lives separate from
// nearestDocBoundary.
function isOverTopBlock(view, doc, clientY) {
  if (!view || !doc || doc.childCount === 0) return false;
  let over = false;
  doc.forEach((node, off) => {
    if (over) return;
    let dom = null;
    try { dom = view.nodeDOM(off); } catch (_) { /* */ }
    const rect = dom?.getBoundingClientRect?.();
    if (rect && clientY >= rect.top && clientY <= rect.bottom) over = true;
  });
  return over;
}

// Atomically relocate the top-level node that matches `match` (by attrs) to
// `insertPos`. `nodeTypeName` is an optional filter — pass null to match ANY
// node type, so a same-doc reorder moves whatever node already holds the
// occurrence (a moduleEmbed OR a legacy auto-typed instanceTextblock) without
// the caller having to know or care which. Preserves the node (and its type).
function tryMoveEmbedNodeInDoc(editor, nodeTypeName, match, insertPos) {
  if (!editor || insertPos == null) return false;
  let sourcePos = null;
  let sourceNode = null;
  editor.state.doc.forEach((child, offset) => {
    if (sourceNode) return;
    if ((nodeTypeName == null || child.type.name === nodeTypeName)
        && Object.entries(match).every(([k, v]) => child.attrs?.[k] === v)) {
      sourcePos = offset;
      sourceNode = child;
    }
  });
  if (sourcePos == null) { console.log("[DROP tryMove] source NOT FOUND in this doc by occId", match, "→ returns false (cross-doc path)"); return false; }

  const sourceEnd = sourcePos + sourceNode.nodeSize;
  // A drop anywhere within the source's own span (both edges inclusive) is a
  // no-op — the block already occupies that position. `=== sourcePos` is the
  // gap right before it; `=== sourceEnd` the gap right after it; both are where
  // it already sits. (These edges previously "snapped past" the neighbour,
  // overshooting by one — dropping the 1st block above the 2nd landed it below.)
  if (insertPos >= sourcePos && insertPos <= sourceEnd) {
    console.log("[DROP tryMove] NO-OP — insertPos within source span", { insertPos, sourcePos, sourceEnd, nodeType: sourceNode.type.name });
    return true;
  }

  // The delete shifts every position past sourcePos left by nodeSize; adjust the
  // insert target so it lands where the user dropped.
  const adjusted = insertPos > sourcePos ? insertPos - sourceNode.nodeSize : insertPos;
  console.log("[DROP tryMove] MOVING", { from: sourcePos, to: insertPos, adjusted, nodeType: sourceNode.type.name });

  const tr = editor.state.tr;
  tr.setMeta("skipAutoCreate", true);
  tr.delete(sourcePos, sourceEnd);
  tr.insert(adjusted, sourceNode);
  editor.view.dispatch(tr);
  return true;
}

const Editor = forwardRef(function Editor({
  content = null,
  onChange,
  onBlur,
  occurrence,
  dispatch,
  socket,
  editable = true,
  showToolbar = false,
  stickyToolbar = false,
  placeholder = "Click to edit…",
  className = "",
  onConvertListToInstances = null,
  onExitBlock = null,
  onDeleteBlock = null,
  onAutoCreateTextblock = null,
  recentAutoCreateRef = null,
  mode = "doc",
  onCellCommitMove = null,
  // Cell-mode column projection: when set, moduleEmbed NodeViews inside this
  // cell render ONLY the named field via FieldRenderer instead of the full
  // instance form. Undefined / null = standard doc-mode render (unchanged).
  displayFieldId = null,
  // Cell-mode column-level field visibility (independent of displayFieldId).
  // Shape: { mode: "show" | "hide", fieldIds: [...] } or null. Consumed by
  // ModuleInstance via CellEmbedContext — embed renders the full instance
  // form but filters which field bindings appear. This is the per-column
  // LOCAL override; it wins over the occurrence-level fieldVisibility cascade.
  fieldVisibility = null,
  hideLabel = false,
  // Opt-in "insert here" gap affordance between top-level doc blocks (primary
  // doc editors only — NOT cell editors or textblock sub-editors). Mirrors the
  // board/list InsertGap: hover a block boundary → highlight bar + QuickAddMenu
  // "+" → mints an occurrence and inserts a moduleEmbed at that block position.
  enableInsertGaps = false,
}, ref) {
  // Cell mode: opt-in via mode="cell". Gates doc-only behaviors and enables
  // spreadsheet navigation keymaps. The default mode="doc" path is unchanged.
  const isCell = mode === "cell";
  // Per-slice selectors — the previous full useGridActions() subscription
  // re-rendered EVERY mounted editor (one per doc container / textblock) on
  // every occurrence write. occurrencesById is read at callback time via the
  // non-subscribing getter; module/field maps are stable across writes.
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const instancesById = useGridActionsSelector(s => s.instancesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  // Grid/user id for artifact uploads dropped into a doc / table cell (an
  // embedded doc container or a cell has no owning `occurrence` to read them off).
  const ctxGrid = useGridActionsSelector(s => s.grid);
  const ctxUserId = useGridActionsSelector(s => s.userId);

  // Suggestion / palette state
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 });
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandPos, setCommandPos] = useState({ top: 0, left: 0 });
  const [showDocLink, setShowDocLink] = useState(false);
  const [docLinkQuery, setDocLinkQuery] = useState("");
  const [docLinkPos, setDocLinkPos] = useState({ top: 0, left: 0 });
  const [showExprSuggestion, setShowExprSuggestion] = useState(false);
  const [exprQuery, setExprQuery] = useState("");
  const [exprPos, setExprPos] = useState({ top: 0, left: 0 });
  const [showEmbedPicker, setShowEmbedPicker] = useState(false);
  const [embedQuery, setEmbedQuery] = useState("");
  const [embedPos, setEmbedPos] = useState({ top: 0, left: 0 });
  const [exprActiveIndex, setExprActiveIndex] = useState(-1);
  const exprListRef = useRef(null);


  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  // Insert-here doc gap: { top (wrapper-relative px), pos (PM insert position) }
  // or null. Driven by mousemove over the editor wrapper when enableInsertGaps.
  const [docGap, setDocGap] = useState(null);
  const docGapElRef = useRef(null);
  // A menu-opened ("pinned") gap must survive the hover machinery — every
  // gap clear/move site funnels through these two so the pinned rule can't be
  // forgotten at a new call site (2026-07-12 doc "Add occurrence here…").
  const clearDocGapUnlessPinned = useCallback(() => {
    setDocGap((prev) => (prev?.pinned ? prev : null));
  }, []);
  const setDocGapUnlessPinned = useCallback((b) => {
    setDocGap((prev) => (prev?.pinned ? prev : (b && prev && prev.pos === b.pos ? prev : b)));
  }, []);
  // `mouseleave` cannot fire when the layout shifts under a STATIONARY pointer,
  // so a doc gap could stay lit after an op drain reflowed the page — the same
  // stale-pointer bug the board gaps had. Re-test the pointer against the
  // editor's CURRENT rect instead of trusting the leave event.
  useEffect(() => {
    if (!docGap || docGap.pinned) return undefined;
    return watchRegion(docGapElRef.current, () => clearDocGapUnlessPinned());
  }, [docGap, clearDocGapUnlessPinned]);
  // Bumped by the context menu's "Add occurrence here…" row to imperatively
  // open the doc gap's QuickAddMenu at the right-clicked block boundary (#13).
  const [gapAddTrigger, setGapAddTrigger] = useState(0);
  // Live drop indicator while DRAGGING a block over this (page) editor — shows
  // exactly where it will land so reordering isn't a finicky guess. { top, pos }.
  const [dragGap, setDragGap] = useState(null);
  const [wrapDrop, setWrapDrop] = useState(null); // { top, side } | null
  // D11: convert-to-module prompt

  const lastCharRef = useRef("");
  const wrapperRef = useRef(null);
  const saveTimeout = useRef(null);
  const autoCreateTimerRef = useRef(null);
  // Suppress content-sync from server echoes for 1.5s after any local edit.
  // Without this, a debounced save from before auto-create fires can echo back
  // after the sub-editor takes focus (outer hasFocus=false) and reset the doc
  // to the pre-textblock state, removing the empty paragraphs the user created.
  const locallyModifiedRef = useRef(false);
  const locallyModifiedTimerRef = useRef(null);

  // ── available fields for @ suggestions ──────────────────────
  const availableFields = useMemo(
    () => (fieldsById ? Object.values(fieldsById).filter(f => f?.id) : []),
    [fieldsById],
  );
  const filteredFields = useMemo(() => {
    if (!suggestionQuery) return availableFields;
    const q = suggestionQuery.toLowerCase();
    return availableFields.filter(f =>
      f.name?.toLowerCase().includes(q) || f.id?.toLowerCase().includes(q),
    );
  }, [availableFields, suggestionQuery]);

  const filteredExprFields = useMemo(() => {
    if (!exprQuery) return availableFields;
    const q = exprQuery.toLowerCase();
    return availableFields.filter(f => f.name?.toLowerCase().includes(q));
  }, [availableFields, exprQuery]);

  // ── cursor position helper ───────────────────────────────────
  const getCursorPosition = useCallback(() => {
    const sel = window.getSelection();
    if (sel?.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const wrap = wrapperRef.current?.getBoundingClientRect();
      if (wrap) return { top: rect.bottom - wrap.top + 4, left: rect.left - wrap.left };
    }
    return { top: 0, left: 0 };
  }, []);

  // ── key handlers ─────────────────────────────────────────────
  const handleAtKey = useCallback(() => {
    if (!showSuggestion) { setSuggestionPos(getCursorPosition()); setShowSuggestion(true); setSuggestionQuery(""); }
  }, [showSuggestion, getCursorPosition]);

  const handleSlashKey = useCallback(() => {
    if (!showCommandPalette) { setCommandPos(getCursorPosition()); setShowCommandPalette(true); setCommandQuery(""); }
  }, [showCommandPalette, getCursorPosition]);

  const handleDocLinkTrigger = useCallback(() => {
    if (!showDocLink) { setDocLinkPos(getCursorPosition()); setShowDocLink(true); setDocLinkQuery(""); }
  }, [showDocLink, getCursorPosition]);

  const handleEqualKey = useCallback(() => {
    if (!showExprSuggestion) { setExprPos(getCursorPosition()); setShowExprSuggestion(true); setExprQuery(""); }
  }, [showExprSuggestion, getCursorPosition]);

  const handleEmbedTrigger = useCallback(() => {
    if (!showEmbedPicker) { setEmbedPos(getCursorPosition()); setShowEmbedPicker(true); setEmbedQuery(""); }
  }, [showEmbedPicker, getCursorPosition]);

  // ── stable refs for sub-editor exit/delete callbacks ─────────
  // editorProps closures are captured once at useEditor init — refs ensure
  // the callbacks stay current across renders without recreating the editor.
  const onExitBlockRef = useRef(onExitBlock);
  const onDeleteBlockRef = useRef(onDeleteBlock);
  onExitBlockRef.current = onExitBlock;
  onDeleteBlockRef.current = onDeleteBlock;

  // Keep drop-handler refs fresh — the dropTargetForElements effect only re-registers when
  // editor changes, so occurrencesById/dispatch/socket would otherwise be stale closures.
  // occurrencesByIdRef reads through the non-subscribing getter so `.current` is
  // ALWAYS the live map without this editor subscribing to per-write rebuilds.
  const occurrencesByIdRef = useMemo(() => ({ get current() { return getOccMap(); } }), [getOccMap]);
  const modulesByIdRef = useRef(modulesById);
  const dispatchRef = useRef(dispatch);
  const socketRef = useRef(socket);
  modulesByIdRef.current = modulesById;
  dispatchRef.current = dispatch;
  socketRef.current = socket;

  // ── debounced save ────────────────────────────────────────────
  const persistContent = useCallback((json, immediate = false) => {
    if (!occurrence?.id || !dispatch || !socket) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    setIsSaving(true);
    const doSave = () => {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { ...occurrence, textmap: json },
        emit: true,
      });
      setIsSaving(false);
    };
    if (immediate) { doSave(); }
    else { saveTimeout.current = setTimeout(doSave, 500); }
  }, [occurrence, dispatch, socket]);

  // ── TipTap editor ─────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      // dropcursor OFF: PM's native drop cursor (a currentColor line per editor
      // instance) drew 1-2 extra "dead" white lines during every doc drag — the
      // custom handleDocDrop owns all drops, so the only honest indicators are
      // our own .doc-insert-gap--drag / .wrap-drop-line (2026-07-11).
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, dropcursor: false }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskListMarkdown,
      FieldPill,
      InstancePill,
      InstanceTextblock,
      InstanceTextblockInline,
      Footnote,
      DocLink,
      PillBackspace,
      HeadingFocus,
      ModuleEmbed,
      WrapGroup,
      ExprPill,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: content || { type: "doc", content: [{ type: "paragraph", content: [] }] },
    editable,
    onCreate: ({ editor }) => {
      // A textblock the user just created BY TYPING claims the caret here — the
      // first frame its editor exists. The creator used to rAF-poll the DOM for
      // this editor instead (up to 60 frames); when the poll missed, the next
      // keystroke spawned ANOTHER textblock. See helpers/pendingTextblockFocus.
      //
      // Gated on `content`: the content-sync effect SKIPS a focused editor (so a
      // server echo can't yank the caret mid-typing), so focusing one that has
      // not received its content yet strands it empty — the character that
      // created the textblock is then dropped and the user sees "robe check".
      // When content isn't here yet the claim stays pending and the sync effect
      // below consumes it the moment it lands.
      if (occurrence?.id && content && consumeTextblockFocus(occurrence.id)) {
        editor.commands.focus("end");
      }
      // Migrate old instancePill+pillDisplay:block nodes to instanceTextblock.
      // These were created before the textblock was its own node type.
      // Runs on first open; persists the migrated JSON immediately so subsequent
      // opens don't need to migrate again.
      if (!onAutoCreateTextblock && !occurrence?.id) return; // only migrate in doc-owning editors
      const { doc, tr } = editor.state;
      let hasMigrations = false;
      doc.forEach((topNode, offset) => {
        if (
          topNode.type.name === "paragraph" &&
          topNode.childCount === 1 &&
          topNode.firstChild?.type?.name === "instancePill" &&
          topNode.firstChild?.attrs?.pillDisplay === "block"
        ) {
          const pill = topNode.firstChild;
          const textblockNode = editor.schema.nodes.instanceTextblock?.create({
            instanceId: pill.attrs.instanceId,
            occurrenceId: pill.attrs.occurrenceId,
          });
          if (textblockNode) {
            tr.replaceWith(offset, offset + topNode.nodeSize, textblockNode);
            hasMigrations = true;
          }
        }
      });
      if (hasMigrations) {
        tr.setMeta("skipAutoCreate", true);
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
        persistContent(editor.getJSON(), true);
      }
    },
    onUpdate: ({ editor, transaction }) => {
      // Mark as locally modified — suppress server echoes for 1.5s so stale
      // echoes (e.g. from before auto-create) can't reset the doc after the
      // sub-editor takes focus and hasFocus becomes false on the outer editor.
      locallyModifiedRef.current = true;
      if (locallyModifiedTimerRef.current) clearTimeout(locallyModifiedTimerRef.current);
      locallyModifiedTimerRef.current = setTimeout(() => {
        locallyModifiedRef.current = false;
      }, 3000);

      // Slide the auto-create merge window forward on every keystroke during
      // the focus race. Without this, slow saves + fast typing can let the
      // initial 1500ms window expire before the sub-editor takes focus, and
      // subsequent typed chars land as plain paragraphs in the outer doc.
      if (recentAutoCreateRef?.current?.occId) {
        recentAutoCreateRef.current.expireAt = Math.max(
          recentAutoCreateRef.current.expireAt || 0,
          Date.now() + 1500
        );
      }

      const json = editor.getJSON();
      onChange?.(json);
      persistContent(json, false);
      // A deliberate textblock-exit tr always closes the merge window. The
      // exit handler tagged the chain with `textblockExit`; without this
      // shutdown, the user's first post-exit keystroke would still meet
      // the `recent.occId` gate and get folded back into the textblock
      // they just left.
      if (transaction.getMeta("textblockExit") && recentAutoCreateRef?.current) {
        recentAutoCreateRef.current = { occId: null, expireAt: 0 };
      }
      // Auto-create textblock: first character typed on a previously empty paragraph.
      // Gated behind !isCell — cell editors have no auto-create-textblock behavior.
      // ALSO gated on the text CONTENT actually changing: an attribute-only
      // transaction (a wrapGroup seam RESIZE writing `neighborWidth`, or a re-morph
      // writing `anchorIndex`/`side`) is `docChanged` but types nothing — without this
      // it folded the whole wrapGroup into a brand-new parent textblock on every
      // column resize ("an extra random parent textblock containing the wrap stuff").
      const textChanged = transaction.before.textContent !== editor.state.doc.textContent;
      if (!isCell && onAutoCreateTextblock && transaction.docChanged && textChanged && !transaction.getMeta("skipAutoCreate")) {
        let handled = false;
        // ── Pre-pass: merge paragraphs that LAND DURING THE FOCUS-RACE
        // WINDOW right after a just-auto-created textblock. Window is gated
        // by `recentAutoCreateRef.current.occId` — set when auto-create runs,
        // cleared the moment focus lands in the sub-editor (or rAF retries
        // cap out). Outside the window any paragraph after a textblock is
        // deliberate (Enter-exit-then-type, editing an old doc) and must
        // not be absorbed, otherwise the user can't insert gaps between
        // textblocks.
        {
          const recent = recentAutoCreateRef?.current;
          const recentOccId = recent?.occId && Date.now() < (recent.expireAt || 0)
            ? recent.occId
            : null;
          const merges = [];
          if (recentOccId) {
            let prev = null;
            let offset = 0;
            editor.state.doc.forEach((node) => {
              if (prev?.type.name === "instanceTextblock"
                  && prev.attrs?.occurrenceId === recentOccId
                  && node.type.name === "paragraph" && node.textContent.length > 0) {
                // Skip if the paragraph contains a hardBreak — those are
                // inserted by deliberate Shift+Enter gestures and should
                // remain as a sibling paragraph below the textblock, not
                // get folded into it.
                let hasHardBreak = false;
                node.forEach((child) => {
                  if (child.type.name === "hardBreak") hasHardBreak = true;
                });
                if (!hasHardBreak) {
                  merges.push({
                    offset, nodeSize: node.nodeSize,
                    occId: prev.attrs.occurrenceId,
                    nodeJson: node.toJSON(),
                  });
                }
              }
              prev = node;
              offset += node.nodeSize;
            });
          }
          if (merges.length > 0) {
            const tr = editor.state.tr;
            tr.setMeta("skipAutoCreate", true);
            for (let i = merges.length - 1; i >= 0; i--) {
              const { offset: off, nodeSize, occId, nodeJson } = merges[i];
              // Read the LIVE cache first, not the per-render lookup map. The
              // textblock this merge folds into was created microseconds ago in
              // the same tick: CommitHelpers.createOccurrence pushes it into the
              // executor's cache synchronously, while the render-scoped map is a
              // frame behind. Reading the stale map returned an occurrence with
              // no textmap, so `existing` came back empty, the concat branch was
              // skipped, and the merge OVERWROTE the character that created the
              // textblock — type "probe check" fast and it stored "robe check".
              const targetOcc = operationsBridge.getLocalOcc?.(occId) || getOccMap()[occId];
              if (targetOcc) {
                const tm = targetOcc.textmap || { type: "doc", content: [] };
                const existing = tm.content || [];
                const last = existing[existing.length - 1];
                // When the textmap's last node and the captured node are
                // both paragraphs, fold the captured inline content into the
                // last paragraph (concatenating adjacent text runs that
                // share marks). Otherwise the user sees each merged char
                // on its own line inside the textblock — every captured
                // outer paragraph would render as a fresh inner paragraph.
                let mergedContent;
                if (last?.type === "paragraph" && nodeJson?.type === "paragraph") {
                  mergedContent = [
                    ...existing.slice(0, -1),
                    { ...last, content: concatInline(last.content || [], nodeJson.content || []) },
                  ];
                } else {
                  mergedContent = [...existing, nodeJson];
                }
                CommitHelpers.updateOccurrence({
                  dispatch, socket,
                  occurrence: { ...targetOcc, textmap: { type: "doc", content: mergedContent } },
                });
                tr.delete(off, off + nodeSize);
              }
            }
            // Cancel any pending auto-create timer — the merged paragraph
            // would otherwise fire a stale onAutoCreateTextblock against a
            // now-deleted position.
            if (autoCreateTimerRef.current) {
              clearTimeout(autoCreateTimerRef.current);
              autoCreateTimerRef.current = null;
            }
            // Bump the merge window so continuous fast typing keeps the
            // funnel open. The window snaps shut on the first pause >
            // 200 ms, which is what makes "exit, then resume typing" spawn
            // a fresh textblock instead of feeding the previous one.
            if (recentAutoCreateRef?.current) {
              recentAutoCreateRef.current.expireAt = Date.now() + 200;
            }
            editor.view.dispatch(tr);
            handled = true;
          }
        }
        const { from } = editor.state.selection;
        const $pos = editor.state.doc.resolve(from);
        if (!handled && $pos.depth === 1) {
          const node = $pos.parent;
          if (node.type.name === "paragraph" && node.textContent.length === 1) {
            if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current);
            const capturedStart = $pos.before(1);
            autoCreateTimerRef.current = setTimeout(() => {
              autoCreateTimerRef.current = null;
              try {
                const currentNode = editor.state.doc.nodeAt(capturedStart);
                if (currentNode && currentNode.type.name === "paragraph" && currentNode.textContent.length > 0) {
                  onAutoCreateTextblock(capturedStart, currentNode.textContent, currentNode.nodeSize);
                }
              } catch (_) {}
            }, 0);
            handled = true;
          } else if (node.type.name === "paragraph" && node.textContent.length > 1 && autoCreateTimerRef.current) {
            handled = true;
          }
        }
        // Auto-wrap top-level list nodes — batch merge into preceding textblocks
        if (!handled) {
          const merges = []; // collect all mergeable lists
          let standaloneList = null; // first standalone list (no preceding textblock)
          let idx = 0;
          editor.state.doc.forEach((node, offset) => {
            if (node.type.name === "bulletList" || node.type.name === "orderedList") {
              let merged = false;
              if (idx > 0) {
                const prevNode = editor.state.doc.child(idx - 1);
                if (prevNode.type.name === "paragraph" && prevNode.childCount === 1) {
                  const pill = prevNode.firstChild;
                  if (pill?.type?.name === "instanceTextblock" && pill.attrs.occurrenceId) {
                    merges.push({ offset, nodeSize: node.nodeSize, occId: pill.attrs.occurrenceId, nodeJson: node.toJSON() });
                    merged = true;
                  }
                }
              }
              if (!merged && !standaloneList) {
                standaloneList = { offset, nodeSize: node.nodeSize, nodeJson: node.toJSON() };
              }
            }
            idx++;
          });
          // Batch-merge all lists into their preceding textblocks (reverse order for stable offsets)
          if (merges.length > 0) {
            const tr = editor.state.tr;
            tr.setMeta("skipAutoCreate", true);
            for (let i = merges.length - 1; i >= 0; i--) {
              const { offset, nodeSize, occId, nodeJson } = merges[i];
              // Read the LIVE cache first, not the per-render lookup map. The
              // textblock this merge folds into was created microseconds ago in
              // the same tick: CommitHelpers.createOccurrence pushes it into the
              // executor's cache synchronously, while the render-scoped map is a
              // frame behind. Reading the stale map returned an occurrence with
              // no textmap, so `existing` came back empty, the concat branch was
              // skipped, and the merge OVERWROTE the character that created the
              // textblock — type "probe check" fast and it stored "robe check".
              const targetOcc = operationsBridge.getLocalOcc?.(occId) || getOccMap()[occId];
              if (targetOcc) {
                const tm = targetOcc.textmap || { type: "doc", content: [] };
                CommitHelpers.updateOccurrence({
                  dispatch, socket,
                  occurrence: { ...targetOcc, textmap: { type: "doc", content: [...(tm.content || []), nodeJson] } },
                });
                tr.delete(offset, offset + nodeSize);
              }
            }
            editor.view.dispatch(tr);
            handled = true;
          }
          // Standalone list (no preceding textblock) — create new textblock
          if (!handled && standaloneList) {
            onAutoCreateTextblock(standaloneList.offset, null, standaloneList.nodeSize, standaloneList.nodeJson);
            handled = true;
          }
        }
        // ── Strict-block sweep ─────────────────────────────────────────────
        // Page docs should never carry raw paragraphs/headings/blockquotes/
        // codeBlocks/etc. at the top level — only `instanceTextblock` nodes.
        // The earlier branches handle the active-typing flow (single-char
        // paragraph, pending timer, top-level lists). Anything else that
        // landed at the top level (paste of multi-char text, markdown heading
        // shortcut, blockquote shortcut, undo restoring orphaned content) is
        // converted here in a single batched transaction. Bypasses the
        // DocContent cooldown by writing directly via CommitHelpers — there's
        // no focus-race to manage for these bulk conversions; user can click
        // into the new textblock.
        if (!handled && !autoCreateTimerRef.current && occurrence?.userId && occurrence?.gridId && occurrence?.id) {
          const schema = editor.state.schema;
          if (schema.nodes.instanceTextblock) {
            const conversions = [];
            editor.state.doc.forEach((node, offset) => {
              if (node.type.name === "instanceTextblock") return;
              // Skip truly empty paragraphs (cursor placeholder TipTap maintains).
              if (node.type.name === "paragraph" && node.textContent.length === 0 && node.childCount <= 1) return;
              conversions.push({ offset, nodeSize: node.nodeSize, nodeJson: node.toJSON() });
            });
            if (conversions.length > 0) {
              const tr = editor.state.tr;
              tr.setMeta("skipAutoCreate", true);
              // Reverse order keeps earlier offsets stable across replacements.
              for (let i = conversions.length - 1; i >= 0; i--) {
                const { offset, nodeSize, nodeJson } = conversions[i];
                const tbModId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `m_${Math.random().toString(36).slice(2)}`;
                const tbOccId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `o_${Math.random().toString(36).slice(2)}`;
                CommitHelpers.createModule({
                  dispatch, socket,
                  module: { id: tbModId, userId: occurrence.userId, gridId: occurrence.gridId, role: "textblock", kind: "doc", label: "" },
                  emit: true,
                });
                CommitHelpers.createOccurrence({
                  dispatch, socket,
                  occurrence: {
                    id: tbOccId, userId: occurrence.userId, gridId: occurrence.gridId,
                    moduleId: tbModId,
                    parentId: occurrence.id,
                    iteration: { mode: "persistent" },
                    textmap: { type: "doc", content: [nodeJson] },
                    fields: {},
                  },
                  emit: true,
                });
                tr.replaceWith(offset, offset + nodeSize, schema.nodes.instanceTextblock.create({
                  instanceId: tbModId,
                  occurrenceId: tbOccId,
                }));
              }
              editor.view.dispatch(tr);
              handled = true;
            }
          }
        }
      }
    },
    onBlur: ({ editor }) => {
      const json = editor.getJSON();
      onBlur?.(json);
      persistContent(json, true);
      setTimeout(() => setShowSuggestion(false), 200);
    },
    editorProps: {
      instancesById,
      // spellcheck starts OFF so unfocused textblocks don't show misspelling
      // squiggles; the focus/blur handlers below flip it on only while editing.
      attributes: { class: "doc-editor-content prose prose-invert max-w-none focus:outline-none", draggable: "false", spellcheck: "false" },
      handleDOMEvents: {
        // Show the red misspelling squiggles ONLY when the textblock is focused
        // (clicked into) — an unfocused block reads as clean prose. Toggling the
        // contenteditable's `spellcheck` attr re-runs / clears the browser check.
        focus: (view) => {
          view.dom.setAttribute("spellcheck", "true");
          return false;
        },
        blur: (view) => {
          view.dom.setAttribute("spellcheck", "false");
          return false;
        },
        dragstart: (view, event) => {
          // Only allow dragstart from drag handle elements — prevents native
          // text-selection drag from interfering with cursor placement.
          const target = event.target;
          // A Pragmatic-registered embed drag fires dragstart with the
          // DRAGGABLE element itself as target (instance-wrap / container
          // shell), not the handle the gesture started on — let it through
          // (Pragmatic's own dragHandle check still gates non-handle starts).
          // Text-selection drags target non-draggable prose, so they still
          // hit the preventDefault below.
          if (target?.draggable === true) return false;
          if (!target?.closest?.('[data-dnd-handle]') && !target?.closest?.('.module-drag-handle')) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        keydown: (_view, event) => {
          // Shift+Enter inside a textblock sub-editor:
          //   - empty sub-editor → collapse the textblock back to a paragraph
          //   - cursor on the last position of the doc → exit (handleExitBlock
          //     navigates into the next sibling textblock if one exists)
          //   - anywhere else → fall through to TipTap's default (paragraph
          //     break / hardBreak), so the user can keep adding lines INSIDE
          //     the textblock without leaving it prematurely
          if (event.key === "Enter" && event.shiftKey) {
            if (onDeleteBlockRef.current) {
              const docIsEmpty = _view.state.doc.textContent.length === 0;
              if (docIsEmpty) {
                event.preventDefault();
                onDeleteBlockRef.current(true);
                return true;
              }
            }
            if (onExitBlockRef.current) {
              const { $to, empty: selEmpty } = _view.state.selection;
              // Treat "on the last line" as: cursor sits in the last
              // top-level child of the sub-editor's doc. PM text positions
              // max out at `content.size - 1` (just inside the last block's
              // close), so a `>= size` check would never fire. Comparing
              // the cursor's top-level index against `doc.childCount - 1`
              // is the structural version: anywhere in the last paragraph
              // → exit on Shift+Enter; earlier paragraphs → default break.
              const atLastBlock = selEmpty && $to.index(0) === _view.state.doc.childCount - 1;
              if (atLastBlock) {
                event.preventDefault();
                onExitBlockRef.current();
                return true;
              }
            }
            return false;
          }
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        // (Enter/Shift+Enter handled in handleDOMEvents.keydown above)
        // Backspace at position 0 — delete textblock if empty, navigate back if not.
        if (event.key === "Backspace" && onDeleteBlockRef.current) {
          const { from, empty: selEmpty } = _view.state.selection;
          if (from <= 1 && selEmpty) {
            const docIsEmpty = _view.state.doc.textContent.length === 0;
            event.preventDefault();
            onDeleteBlockRef.current(docIsEmpty);
            return true;
          }
        }
        // ArrowLeft at position 0 — always navigate back (never delete).
        if (event.key === "ArrowLeft" && onDeleteBlockRef.current) {
          const { from, empty: selEmpty } = _view.state.selection;
          if (from <= 1 && selEmpty) {
            event.preventDefault();
            onDeleteBlockRef.current(false);
            return true;
          }
        }
        // ArrowRight at end of content — exit to next block.
        if (event.key === "ArrowRight" && onExitBlockRef.current) {
          const { to, empty: selEmpty } = _view.state.selection;
          if (to >= _view.state.doc.content.size && selEmpty) {
            event.preventDefault();
            onExitBlockRef.current();
            return true;
          }
        }
        // ArrowUp at first visual line of the FIRST block — navigate back (exit upward).
        // Guard: $anchor.index(0) === 0 ensures we only exit when in the first top-level
        // block. Without this, endOfTextblock("up") fires at the top of every block,
        // causing the cursor to skip lines in multi-paragraph sub-editors.
        if (event.key === "ArrowUp" && onDeleteBlockRef.current) {
          const { $anchor } = _view.state.selection;
          if ($anchor.index(0) === 0 && _view.endOfTextblock("up")) {
            event.preventDefault();
            onDeleteBlockRef.current();
            return true;
          }
        }
        // ArrowDown at last visual line of the LAST block — exit to next block.
        // Same guard: only exit when cursor is in the last top-level block.
        if (event.key === "ArrowDown" && onExitBlockRef.current) {
          const { $anchor } = _view.state.selection;
          if ($anchor.index(0) === _view.state.doc.childCount - 1 && _view.endOfTextblock("down")) {
            event.preventDefault();
            onExitBlockRef.current();
            return true;
          }
        }
        // ── Cell-mode keymaps (only active when mode="cell") ────────────────
        // These are purely additive — the isCell guard ensures they never
        // fire on the default mode="doc" path.
        if (isCell) {
          // Shift+Enter intentionally has no entry here — soft break is handled by handleDOMEvents.keydown above.
          // Enter (no shift) → commit and move down
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onCellCommitMove?.("down");
            return true;
          }
          // Tab → commit and move right; Shift+Tab → move left
          if (event.key === "Tab") {
            event.preventDefault();
            if (event.shiftKey) {
              onCellCommitMove?.("left");
            } else {
              onCellCommitMove?.("right");
            }
            return true;
          }
          // Escape → blur (defocus the cell editor).
          // Only fires when no suggestion popup is open — suggestion popups
          // take priority so the user can dismiss them first.
          if (event.key === "Escape" && !showSuggestion && !showCommandPalette && !showDocLink && !showExprSuggestion && !showEmbedPicker) {
            event.preventDefault();
            _view.dom.blur();
            return true;
          }
          // ArrowUp at first visual line of the first block → move up.
          // Reuses the exact same edge check used by the sub-editor exit-block
          // ArrowUp handler above (same structural guard: $anchor.index(0)===0
          // + endOfTextblock("up")).
          if (event.key === "ArrowUp") {
            const { $anchor } = _view.state.selection;
            if ($anchor.index(0) === 0 && _view.endOfTextblock("up")) {
              event.preventDefault();
              onCellCommitMove?.("up");
              return true;
            }
            return false;
          }
          // ArrowDown at last visual line of the last block → move down.
          if (event.key === "ArrowDown") {
            const { $anchor } = _view.state.selection;
            if ($anchor.index(0) === _view.state.doc.childCount - 1 && _view.endOfTextblock("down")) {
              event.preventDefault();
              onCellCommitMove?.("down");
              return true;
            }
            return false;
          }
        }
        // ── end cell-mode keymaps ─────────────────────────────────────────────

        if (event.key === "@") handleAtKey();
        if (event.key === "/") handleSlashKey();
        if (event.key === "[" && lastCharRef.current === "[") handleDocLinkTrigger();
        if (event.key === "=" && !showExprSuggestion) handleEqualKey();
        if (event.key === ":" && lastCharRef.current === "@") handleEmbedTrigger();
        lastCharRef.current = event.key;
        if (event.key === "Escape") {
          if (showSuggestion) { setShowSuggestion(false); return true; }
          if (showCommandPalette) { setShowCommandPalette(false); return true; }
          if (showDocLink) { setShowDocLink(false); return true; }
          if (showExprSuggestion) { setShowExprSuggestion(false); return true; }
          if (showEmbedPicker) { setShowEmbedPicker(false); return true; }
        }
        return false;
      },
      handleTextInput: (_view, _from, _to, text) => {
        if (showSuggestion) setSuggestionQuery(p => p + text);
        if (showCommandPalette) setCommandQuery(p => p + text);
        if (showDocLink) setDocLinkQuery(p => p + text);
        if (showExprSuggestion) setExprQuery(p => p + text);
        if (showEmbedPicker) setEmbedQuery(p => p + text);
        return false;
      },
    },
  });

  // Sync editable prop → TipTap after initialization (useEditor doesn't auto-sync)
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable, false);
    }
  }, [editor, editable]);

  // Track when user has actively focused the editor — used by content sync
  // to decide whether to restore cursor position or leave it at pos 1.
  useEffect(() => {
    if (!editor) return;
    const onFocus = () => { userHasFocusedRef.current = true; };
    editor.on("focus", onFocus);
    return () => { editor.off("focus", onFocus); };
  }, [editor]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current);
    if (locallyModifiedTimerRef.current) clearTimeout(locallyModifiedTimerRef.current);
  }, []);


  // ── context menu (declared AFTER editor to avoid TDZ) ────────
  const handleContextMenu = useCallback((e) => {
    if (!editor || !editable) return;
    e.preventDefault(); e.stopPropagation();
    const hasSelection = !editor.state.selection.empty;
    const { $from, from: selFrom, to: selTo } = editor.state.selection;
    const capturedFrom = selFrom;
    const capturedTo = selTo;
    const capturedY = e.clientY;
    const capturedText = hasSelection ? editor.state.doc.textBetween(selFrom, selTo) : "";
    const inTable = Array.from({ length: $from.depth }, (_, i) => $from.node(i + 1))
      .some(n => n.type.name === "table" || n.type.name === "tableRow" || n.type.name === "tableCell" || n.type.name === "tableHeader");
    const inList = $from.depth > 0 && (
      $from.node($from.depth - 1)?.type?.name === "bulletList" ||
      $from.node($from.depth - 1)?.type?.name === "orderedList" ||
      $from.node($from.depth)?.type?.name === "bulletList" ||
      $from.node($from.depth)?.type?.name === "orderedList"
    );
    const extractListTexts = () => {
      const texts = [];
      let listNode = null; let listPos = null;
      editor.state.doc.descendants((node, pos) => {
        if ((node.type.name === "bulletList" || node.type.name === "orderedList") && !listNode) {
          if (pos <= $from.pos && pos + node.nodeSize >= $from.pos) { listNode = node; listPos = pos; }
        }
      });
      if (listNode) listNode.forEach(item => { const t = item.textContent.trim(); if (t) texts.push(t); });
      return { texts, listPos, listNode };
    };
    // Bulk convert: every TEXTBLOCK embed inside the selection → an instance
    // (the headline "type a board in a doc, highlight the list, convert" flow).
    // Reuses the tested planLeafRoleConversion per occurrence.
    const selectedTextblockOccs = [];
    if (hasSelection) {
      editor.state.doc.nodesBetween(capturedFrom, capturedTo, (node) => {
        if (node.type?.name === "moduleEmbed" && node.attrs?.occurrenceId) {
          const occ = occurrencesByIdRef.current?.[node.attrs.occurrenceId];
          const mod = occ?.moduleId ? modulesByIdRef.current?.[occ.moduleId] : null;
          if (mod?.role === "textblock" && !selectedTextblockOccs.some(x => x.occ.id === occ.id)) {
            selectedTextblockOccs.push({ occ, mod });
          }
        }
      });
    }
    const items = [
      selectedTextblockOccs.length > 0 && dispatch && socket && {
        label: `Convert ${selectedTextblockOccs.length} textblock${selectedTextblockOccs.length === 1 ? "" : "s"} to instance${selectedTextblockOccs.length === 1 ? "" : "s"}`,
        icon: Shuffle,
        onClick: () => selectedTextblockOccs.forEach(({ occ, mod }) =>
          convertLeafRole({ dispatch, socket, occurrence: occ, module: mod, targetRole: "instance" })),
      },
      selectedTextblockOccs.length > 0 && { separator: true },
      hasSelection && { label: "Bold", icon: Bold, onClick: () => editor.chain().focus().toggleBold().run() },
      hasSelection && { label: "Italic", icon: Italic, onClick: () => editor.chain().focus().toggleItalic().run() },
      hasSelection && { label: "Strikethrough", icon: Strikethrough, onClick: () => editor.chain().focus().toggleStrike().run() },
      hasSelection && { label: "Code", icon: Code, onClick: () => editor.chain().focus().toggleCode().run() },
      hasSelection && { separator: true },
      hasSelection && { label: "Clear formatting", icon: RemoveFormatting, onClick: () => editor.chain().focus().unsetAllMarks().run() },
      { separator: true },
      // "Add occurrence here…" (#13, 2026-07-12): opens the doc-gap QuickAddMenu
      // at the block boundary nearest the right-click. Works in every doc-capable
      // editor (not just the gap-enabled primary page editor) — the gap overlay
      // renders whenever docGap is set.
      !isCell && dispatch && socket && occurrence?.userId && {
        label: "Add occurrence here…",
        icon: Plus,
        onClick: () => {
          const wrapEl = wrapperRef.current;
          let b = null;
          try { b = nearestDocBoundary(editor.view, editor.state.doc, wrapEl, capturedY); } catch (_) {}
          if (!b) b = { top: 0, pos: editor.state.doc.content.size };
          if (window.__dragDiag) console.log("[addocc] gap", JSON.stringify(b));
          // `pinned` keeps the hover machinery (gap-move / mouse-leave) from
          // clearing a menu-driven gap — the pointer is over content when the
          // context menu closes, and the very next mousemove would wipe it.
          setDocGap({ ...b, pinned: true });
          // QuickAddMenu honors a positive openTrigger at MOUNT, so the gap +
          // bump can land in the same commit — no deferral race.
          setGapAddTrigger((n) => n + 1);
        },
      },
      !isCell && dispatch && socket && occurrence?.userId && { separator: true },
      inList && onConvertListToInstances && {
        label: "Convert list to instances", icon: List,
        onClick: () => {
          const { texts, listPos, listNode } = extractListTexts();
          if (!texts.length) return;
          onConvertListToInstances(texts);
          if (listNode && listPos != null) {
            editor.chain().focus().deleteRange({ from: listPos, to: listPos + listNode.nodeSize }).run();
          }
        },
      },
      hasSelection && dispatch && socket && occurrence?.userId && { separator: true },
      hasSelection && dispatch && socket && occurrence?.userId && {
        label: "Make inline textblock",
        icon: Type,
        onClick: () => {
          const userId = occurrence.userId;
          const gridId = occurrence.gridId;
          const modId = crypto.randomUUID();
          const occId = crypto.randomUUID();
          const text = (capturedText || "").trim();
          const initialTextmap = text
            ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
            : { type: "doc", content: [{ type: "paragraph" }] };
          CommitHelpers.createModule({
            dispatch, socket,
            module: { id: modId, userId, gridId, role: "textblock", kind: "inline", label: "" },
            emit: true,
          });
          CommitHelpers.createOccurrence({
            dispatch, socket,
            occurrence: {
              id: occId, userId, gridId,
              moduleId: modId,
              parentId: occurrence?.id,
              textmap: initialTextmap,
              fields: {},
            },
            emit: true,
          });
          const schema = editor.state.schema;
          if (!schema.nodes.instanceTextblockInline) return;
          const inlineNode = schema.nodes.instanceTextblockInline.create({
            instanceId: modId,
            occurrenceId: occId,
          });
          editor.chain().focus().insertContentAt(
            { from: capturedFrom, to: capturedTo },
            inlineNode.toJSON()
          ).run();
        },
      },
      hasSelection && dispatch && socket && occurrence?.userId && {
        label: "Split into inline textblocks",
        icon: Type,
        onClick: () => {
          const userId = occurrence.userId;
          const gridId = occurrence.gridId;
          // Split on whitespace runs — keeps each visible "word" as a
          // separate chip. Punctuation stays attached to the adjacent
          // word (e.g. "hello," is one chip) — matches how a user reads
          // a sentence. The original whitespace BETWEEN chips is
          // discarded; chips render with their own padding so the
          // visual gap is preserved.
          const tokens = (capturedText || "")
            .split(/\s+/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
          if (tokens.length === 0) return;
          const schema = editor.state.schema;
          if (!schema.nodes.instanceTextblockInline) return;

          // Mint one textblock module + occurrence per token. Build the
          // TipTap content array as we go so we can replace the entire
          // selection in a single transaction.
          const inlineNodes = [];
          for (const tok of tokens) {
            const modId = crypto.randomUUID();
            const occId = crypto.randomUUID();
            CommitHelpers.createModule({
              dispatch, socket,
              module: { id: modId, userId, gridId, role: "textblock", kind: "inline", label: "" },
              emit: true,
            });
            CommitHelpers.createOccurrence({
              dispatch, socket,
              occurrence: {
                id: occId, userId, gridId,
                moduleId: modId,
                parentId: occurrence?.id,
                textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: tok }] }] },
                fields: {},
              },
              emit: true,
            });
            inlineNodes.push(schema.nodes.instanceTextblockInline.create({ instanceId: modId, occurrenceId: occId }));
          }
          // Replace the selection with the chip sequence in one tx.
          const docFragment = inlineNodes.map((n) => n.toJSON());
          editor.chain().focus().insertContentAt(
            { from: capturedFrom, to: capturedTo },
            docFragment
          ).run();
        },
      },
      hasSelection && dispatch && socket && occurrence?.userId && {
        label: "Make mini block",
        icon: Box,
        onClick: () => {
          const userId = occurrence.userId;
          const gridId = occurrence.gridId;
          const modId = crypto.randomUUID();
          const occId = crypto.randomUUID();
          // Build textmap from captured selection content
          let textmapContent;
          try {
            const slice = editor.state.doc.slice(capturedFrom, capturedTo);
            textmapContent = slice.content.toJSON();
          } catch (_) {
            textmapContent = capturedText ? [{ type: "paragraph", content: [{ type: "text", text: capturedText }] }] : [];
          }
          const initialTextmap = { type: "doc", content: textmapContent?.length ? textmapContent : [{ type: "paragraph", content: capturedText ? [{ type: "text", text: capturedText }] : [] }] };
          CommitHelpers.createModule({
            dispatch, socket,
            module: { id: modId, userId, gridId, role: "instance", kind: "doc", label: "" },
            emit: true,
          });
          CommitHelpers.createOccurrence({
            dispatch, socket,
            occurrence: {
              id: occId, userId, gridId,
              moduleId: modId,
              parentId: occurrence?.id,
              iteration: { mode: "persistent" },
              textmap: initialTextmap,
              fields: {},
            },
            emit: true,
          });
          // Replace selection with instanceTextblock
          const schema = editor.state.schema;
          if (!schema.nodes.instanceTextblock) return;
          const textblockNode = schema.nodes.instanceTextblock.create({
            instanceId: modId,
            occurrenceId: occId,
          });
          editor.chain().focus().insertContentAt(
            { from: capturedFrom, to: capturedTo },
            textblockNode.toJSON()
          ).run();
        },
      },
      inTable && { separator: true },
      inTable && { label: "Insert row above", onClick: () => editor.chain().focus().addRowBefore().run() },
      inTable && { label: "Insert row below", onClick: () => editor.chain().focus().addRowAfter().run() },
      inTable && { label: "Delete row", danger: true, onClick: () => editor.chain().focus().deleteRow().run() },
      inTable && { separator: true },
      inTable && { label: "Insert column left", onClick: () => editor.chain().focus().addColumnBefore().run() },
      inTable && { label: "Insert column right", onClick: () => editor.chain().focus().addColumnAfter().run() },
      inTable && { label: "Delete column", danger: true, onClick: () => editor.chain().focus().deleteColumn().run() },
      { label: "Insert field (@)", icon: AtSign, onClick: () => editor.chain().focus().insertContent("@").run() },
    ].filter(Boolean);
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [editor, editable, onConvertListToInstances, dispatch, socket, occurrence]);

  // Track recent mousedown on the editor — prevents content sync from resetting
  // the cursor in the window between mousedown (ProseMirror places cursor at click)
  // and focus (editor becomes activeElement). Without this, a server echo arriving
  // during that ~50ms window would call setContent and move cursor to position 1.
  const recentMousedownRef = useRef(false);
  const userHasFocusedRef = useRef(false);

  // ── sync content prop → editor (when not focused) ────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed || !content) return;
    // Reject compressed textmaps (base64 strings) — should never reach here,
    // but guard against it so TipTap doesn't render garbled text.
    if (typeof content === "string") return;
    try {
      // Skip if editor has focus (user is typing) OR mid-click (mousedown fired but focus not yet)
      const editorDom = editor.view?.dom;
      const hasFocus = editorDom && document.activeElement && editorDom.contains(document.activeElement);
      if (hasFocus) return;
      if (recentMousedownRef.current) return;
      // Skip if the editor was recently modified locally. Without this, a debounced
      // save from before auto-create fires echoes back after the sub-editor takes focus
      // (outer hasFocus=false) and resets the doc to the pre-textblock state.
      if (locallyModifiedRef.current) return;
      const current = editor.getJSON();
      if (JSON.stringify(current) !== JSON.stringify(content)) {
        const { from, to } = editor.state.selection;
        // [caret] diag — a content sync inside the click window is the classic
        // caret-reset suspect (setContent collapses selection to doc start).
        logCaretInterference("editor.setContent(sync)", {
          occId: (occurrence?.id || "").slice(0, 8),
          selBefore: { from, to },
          willRestore: userHasFocusedRef.current && (from > 1 || to > 1),
        });
        editor.commands.setContent(content, { emitUpdate: false });
        // A just-typed textblock whose editor mounted BEFORE its content arrived
        // takes the caret now — content first, then focus, so the character that
        // created it is never dropped (see the onCreate claim above).
        if (occurrence?.id && consumeTextblockFocus(occurrence.id)) {
          editor.commands.focus("end");
          return;
        }
        // Only restore cursor if user has actively positioned it (not the initial pos 1).
        // Without this guard, initial content load restores pos 1 = beginning,
        // which fights with the user's first click placement.
        if (userHasFocusedRef.current && (from > 1 || to > 1)) {
          try {
            const docSize = editor.state.doc.content.size;
            editor.commands.setTextSelection({
              from: Math.min(from, docSize),
              to: Math.min(to, docSize),
            });
          } catch (_) {}
        }
      }
    } catch (_) {
      // Editor view not ready yet (TipTap throws if view isn't mounted during rapid re-renders)
    }
  }, [editor, content]);

  // ── expr + embed selection handlers (declared AFTER editor to avoid TDZ) ─
  const handleSelectExpr = useCallback((fieldName) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const eqIndex = textBefore.lastIndexOf("=");
    const chain = editor.chain().focus();
    if (eqIndex >= 0) chain.deleteRange({ from: from - (textBefore.length - eqIndex), to: from });
    chain.insertExprPill({ expr: fieldName }).run();
    setShowExprSuggestion(false); setExprQuery("");
  }, [editor]);

  // ── key handling for popup query modes ──────────────────────
  useEffect(() => {
    if (!showSuggestion && !showCommandPalette && !showDocLink && !showExprSuggestion && !showEmbedPicker) return;
    const handle = (e) => {
      // Backspace — trim query or close popup for @/slash/doclink modes
      if (e.key === "Backspace") {
        if (showSuggestion) suggestionQuery.length > 0 ? setSuggestionQuery(p => p.slice(0, -1)) : setShowSuggestion(false);
        if (showCommandPalette) commandQuery.length > 0 ? setCommandQuery(p => p.slice(0, -1)) : setShowCommandPalette(false);
        if (showDocLink) docLinkQuery.length > 0 ? setDocLinkQuery(p => p.slice(0, -1)) : setShowDocLink(false);
        if (showExprSuggestion) exprQuery.length > 0 ? setExprQuery(p => p.slice(0, -1)) : setShowExprSuggestion(false);
        if (showEmbedPicker) embedQuery.length > 0 ? setEmbedQuery(p => p.slice(0, -1)) : setShowEmbedPicker(false);
        return;
      }
      // Expr popup — keyboard navigation + formula insertion
      if (showExprSuggestion) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setExprActiveIndex(prev => Math.min(prev + 1, filteredExprFields.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setExprActiveIndex(prev => Math.max(prev - 1, -1));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (exprActiveIndex >= 0 && filteredExprFields[exprActiveIndex]) {
            handleSelectExpr(filteredExprFields[exprActiveIndex].name);
          } else if (exprQuery.trim()) {
            // Insert whole query as formula (e.g. "protein * 4")
            handleSelectExpr(exprQuery.trim());
          } else {
            setShowExprSuggestion(false);
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [showSuggestion, suggestionQuery, showCommandPalette, commandQuery, showDocLink, docLinkQuery, showExprSuggestion, exprQuery, exprActiveIndex, filteredExprFields, handleSelectExpr, showEmbedPicker, embedQuery, editor]);

  // ── DnD drop target (instances / fields / containers) ────────
  const resolveInsertPos = useCallback((nativeEvent, isBlock = false) => {
    if (!editor?.view || !nativeEvent) return null;
    const { clientX, clientY } = nativeEvent;
    if (clientX == null || clientY == null) return null;
    const result = editor.view.posAtCoords({ left: clientX, top: clientY });
    if (!result) return null;

    const rawPos = result.pos;
    if (!isBlock) return rawPos; // inline nodes: use raw position as-is

    // Block nodes: snap to the boundary before/after the enclosing top-level block.
    // posAtCoords returns an inline offset inside the nearest block — we want
    // the gap between top-level blocks so insertContentAt places the embed correctly.
    const $pos = editor.state.doc.resolve(rawPos);
    if ($pos.depth === 0) return rawPos;

    const blockStart = $pos.before(1); // gap before the top-level block
    const blockEnd = $pos.after(1);    // gap after the top-level block

    // Block placement is a WHOLE-BLOCK decision: hover the block's upper half →
    // insert before it, lower half → after it, using the block's own bounding
    // rect. (Per-LINE midpoint math made tall blocks finicky — a drop visually
    // ABOVE a multi-line block could land past an inner line's midpoint and
    // resolve to "after it", so dragging a block above a tall neighbour silently
    // no-op'd.) A left-margin hover also reads as "insert above this block".
    const blockDom = editor.view.nodeDOM(blockStart);
    if (blockDom && blockDom.getBoundingClientRect) {
      const rect = blockDom.getBoundingClientRect();
      if (clientX < rect.left + 10) { console.log("[DROP resolveInsertPos] left-margin → blockStart", { blockStart, blockEnd }); return blockStart; }
      const mid = (rect.top + rect.bottom) / 2;
      const r = clientY < mid ? blockStart : blockEnd;
      console.log("[DROP resolveInsertPos] block-midpoint", { rawPos, blockStart, blockEnd, clientY: Math.round(clientY), top: Math.round(rect.top), bottom: Math.round(rect.bottom), mid: Math.round(mid), chose: r === blockStart ? "before(blockStart)" : "after(blockEnd)" });
      return r;
    }
    console.log("[DROP resolveInsertPos] no blockDom → blockEnd", { blockEnd });
    return blockEnd;
  }, [editor]);

  const insertAtPos = useCallback((pos, nodeContent) => {
    if (!editor) return false;
    if (autoCreateTimerRef.current) {
      clearTimeout(autoCreateTimerRef.current);
      autoCreateTimerRef.current = null;
    }
    const nodeDef = editor.schema.nodes[nodeContent.type];
    const isBlock = nodeDef?.spec?.group?.includes("block");
    if (pos != null) {
      const chain = editor.chain().focus()
        .command(({ tr }) => { tr.setMeta("skipAutoCreate", true); return true; })
        .insertContentAt(pos, nodeContent);
      if (!isBlock) chain.insertContentAt(pos + 1, " ");
      return chain.run();
    }
    const chain = editor.chain().focus()
      .command(({ tr }) => { tr.setMeta("skipAutoCreate", true); return true; })
      .insertContent(nodeContent);
    if (!isBlock) chain.insertContent(" ");
    return chain.run();
  }, [editor]);

  // ── Block-wrap host detection (hoisted to component scope) ───────────────
  // detectSideHost + its closures must be reachable OUTSIDE the onDrop callback
  // (a later task calls detectSideHost from onDragOver). They read `editor` +
  // the stable *Ref.current maps.
  // Only a TEXTMAPPED occurrence can be the morphing host (role:"textblock" OR a
  // kind:"doc" container) — never a board/list/table.
  const isTextmappedHost = useCallback((occId) => {
    const occ = occId ? occurrencesByIdRef.current?.[occId] : null;
    const mod = occ?.moduleId ? modulesByIdRef.current?.[occ.moduleId] : null;
    return isTextmappedModule(mod);
  }, []);
  // The host's top-level block index at clientY → the EXACT line the notch
  // morphs at (L at line 0, C/J mid-flow). Kept for back-compat (anchorIndex).
  const blockIndexAtY = useCallback((hostDom, clientY) => {
    const pm = hostDom?.querySelector?.(".ProseMirror");
    if (!pm) return 0;
    const blocks = Array.from(pm.children);
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return Math.max(0, blocks.length - 1);
  }, []);
  // Line-level offset: snap the float's margin-top to the nearest visual line top
  // AT OR ABOVE the drop (px from the host prose top). Drives the wrapGroup's
  // anchorOffset (consumed by WrapGroupNode.measure → --wrap-mt).
  const offsetFor = useCallback((hostEl, clientY) => {
    const pm = hostEl?.querySelector?.(".ProseMirror") || hostEl;
    if (!pm) return 0;
    const proseTop = pm.getBoundingClientRect().top;
    const lineTops = [];
    Array.from(pm.children).forEach((b) => {
      const rects = b.getClientRects?.();
      if (rects && rects.length) {
        for (const r of rects) lineTops.push(Math.round(r.top - proseTop));
      } else {
        lineTops.push(Math.round(b.getBoundingClientRect().top - proseTop));
      }
    });
    lineTops.sort((a, z) => a - z);
    return anchorOffsetForDrop({ dropY: clientY, hostProseTop: proseTop, lineTops });
  }, []);
  const detectSideHost = useCallback((input) => {
    // [WRAP-DIAG] one structured log per null so a single live drop reveals exactly
    // which guard rejects the wrap. Remove once the host-detection is solid.
    const bail = (why, extra) => {
      if (typeof window !== "undefined" && window.__dragDiag === true) console.log("[detectSideHost] null —", why, extra || "");
      return null;
    };
    if (!editor?.view || !input || input.clientX == null) return bail("no editor/input");
    const res = editor.view.posAtCoords({ left: input.clientX, top: input.clientY });
    if (!res) return bail("posAtCoords miss", { x: input.clientX, y: input.clientY });
    const $p = editor.state.doc.resolve(res.pos);
    let topPos, topNode;
    if ($p.depth < 1) {
      // posAtCoords resolves to the DOC-level gap at a block's left/right edge —
      // reliably so over an atom that is the ONLY child of a nested section
      // editor ("can't drag to the right of anything" in single-block sections).
      // Fast path: the hovered element (dragover target, threaded through
      // `input.target`) maps straight to a top-level block via DOM identity —
      // no layout reads. The rect scan below only runs when the pointer is in
      // the gutter BESIDE a partial-width block (hovered element = the PM root),
      // the exact geometry the fallback was built for; per-frame it's rare.
      let found = null;
      const pmEl = editor.view.dom;
      const hoverEl = input.target instanceof Element ? input.target
        : (typeof document !== "undefined" ? document.elementFromPoint?.(input.clientX, input.clientY) : null);
      if (hoverEl && hoverEl !== pmEl && pmEl.contains(hoverEl)) {
        let child = hoverEl;
        while (child.parentElement && child.parentElement !== pmEl) child = child.parentElement;
        if (child.parentElement === pmEl) {
          editor.state.doc.forEach((n, offset) => {
            if (found) return;
            let dom = null;
            try { dom = editor.view.nodeDOM(offset); } catch (_) { /* not rendered */ }
            if (dom === child) found = { pos: offset, node: n };
          });
        }
      }
      if (!found) {
        // Slow path — the top-level block whose vertical band contains the
        // pointer; a genuine between-blocks hover has no such block and still
        // bails to the boundary gap line.
        editor.state.doc.forEach((n, offset) => {
          if (found) return;
          let dom = null;
          try { dom = editor.view.nodeDOM(offset); } catch (_) { /* not rendered */ }
          const r = dom?.getBoundingClientRect?.();
          if (r && r.height > 0 && input.clientY >= r.top && input.clientY <= r.bottom) found = { pos: offset, node: n };
        });
      }
      if (!found) return bail("depth<1, no block under Y", { pos: res.pos });
      topPos = found.pos;
      topNode = found.node;
    } else {
      topPos = $p.before(1);
      topNode = editor.state.doc.nodeAt(topPos);
    }
    if (!topNode) return bail("no topNode", { topPos });

    // Dropping INSIDE an existing wrapGroup (isolating → posAtCoords resolves to the
    // group, not its host child) → this is a RE-MORPH: recompute side + the exact
    // line offset the notch should sit at.
    if (topNode.type.name === "wrapGroup") {
      const hostNode = topNode.lastChild; // host is the LAST child (neighbor-first)
      const hostOccId = hostNode?.attrs?.occurrenceId || null;
      // A group is ALREADY two columns. Until there's real 3-col support, side
      // drops from OUTSIDE are disabled here (2026-07-12, per user) — the drop
      // falls through to a plain insert above/below the group. Only the group's
      // OWN members keep the side affordance (dragging a member re-morphs its
      // side/anchor). The dragged occ id comes from the body dataset stamp
      // (DragProvider.handleDragStart) so no reactive subscription is needed.
      const draggedOccId = input.draggedOccId
        || (typeof document !== "undefined" && document.body?.dataset?.dragOccId) || null;
      let draggedIsMember = false;
      topNode.forEach((c) => { if (draggedOccId && c.attrs?.occurrenceId === draggedOccId) draggedIsMember = true; });
      let groupDom = null;
      try { groupDom = editor.view.nodeDOM(topPos); } catch (_) { return bail("nodeDOM threw (group)"); }
      const holder = groupDom?.querySelector?.(".wrap-group-content > [data-node-view-content-react]")
        || groupDom?.querySelector?.(".wrap-group-content");
      // Outside drags: NO side points on a 2-col group (no 3-col support) —
      // EXCEPT directly over the NEIGHBOR COLUMN, which stacks the drop into
      // that column (columns hold multiple occurrences). Members always pass
      // (dragging one re-morphs its side/anchor).
      if (!draggedIsMember) {
        const kids = holder ? Array.from(holder.children) : [];
        const neighborsOnly = kids.slice(0, -1);
        const overNeighborCol = neighborsOnly.some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && input.clientX >= r.left && input.clientX <= r.right;
        });
        if (!overNeighborCol) return bail("group already 2-col — outside side drops disabled", { draggedOccId });
      }
      const groupTextmapped = isTextmappedHost(hostOccId);
      const hostEl = holder?.lastElementChild || groupDom;
      const rect = groupDom?.getBoundingClientRect?.();
      if (!rect || rect.width <= 0) return null;
      // A drop BELOW the host's actual content is an INSERT-AFTER gesture, not a
      // wrap-beside. When the neighbor (e.g. a tall infobox) is taller than a short
      // host, the isolating wrapGroup's bounding box — and thus posAtCoords — keeps
      // extending down PAST the host's text; without this check a drop underneath the
      // short host was added as a top-anchored neighbor ("jumped to the top above the
      // infobox"). Return null so it falls through to a normal insert below the wrap.
      const hostProseEl = hostEl?.querySelector?.(".ProseMirror") || hostEl;
      const hostContentRect = hostProseEl?.getBoundingClientRect?.();
      if (hostContentRect && input.clientY > hostContentRect.bottom + BELOW_HOST_TOL)
        return bail("below host content → plain insert", { y: input.clientY, hostBottom: Math.round(hostContentRect.bottom) });
      const frac = (input.clientX - rect.left) / rect.width;
      const side = sideFromFrac(frac); // any in-group drop picks a side (no dead middle)
      const anchorOffset = groupTextmapped ? offsetFor(hostEl, input.clientY) : 0;
      return { hostPos: topPos, hostOccId, side, anchorOffset, anchorIndex: null, hostRect: rect, columnOnly: !groupTextmapped };
    }

    if (topNode.type.name !== "moduleEmbed") return bail("top not moduleEmbed/wrapGroup", { type: topNode.type.name });
    const hostOccId = topNode.attrs?.occurrenceId || null;
    // NON-textmapped hosts (board/list/table/artifact/instance) can't morph —
    // but they CAN hold a side-by-side COLUMN (wrapGroup wrap:false, restored
    // 2026-07-12 per user: "dropping right/left of ANYTHING forms a wrap or
    // nonwrapped column"). Only over the EDGE THIRDS though — the middle of a
    // non-prose embed keeps meaning a plain insert above/below, so reordering
    // rows in a doc doesn't accidentally form columns.
    const textmapped = isTextmappedHost(hostOccId);
    let dom = null;
    try { dom = editor.view.nodeDOM(topPos); } catch (_) { return bail("nodeDOM threw"); }
    const rect = dom?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return bail("no host rect");
    const frac = (input.clientX - rect.left) / rect.width;
    if (!textmapped && frac > 0.33 && frac < 0.67) return bail("non-text host, middle third → plain insert", { hostOccId, frac: frac.toFixed(2) });
    const side = sideFromFrac(frac); // textmapped: pick a side ANYWHERE (no dead middle third)
    const anchorOffset = textmapped ? offsetFor(dom, input.clientY) : 0;
    return { hostPos: topPos, hostOccId, side, anchorOffset, anchorIndex: null, hostRect: rect, columnOnly: !textmapped };
  }, [editor, isTextmappedHost, blockIndexAtY, offsetFor]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // A SUB-EDITOR (a textblock / embedded doc rendered INSIDE another doc
    // editor) must NOT register its own Pragmatic drop target. The OUTER (page)
    // editor owns every doc drop, so a block dropped on/near a textblock reorders
    // at the page level — instead of being captured by the textblock's own editor
    // (which silently no-op'd, and let DragProvider's monitor re-route the drag
    // to a board container on another panel). Detected at runtime: el is the
    // `.doc-editor` wrapper; if it has an ANCESTOR `.doc-editor`, it's nested.
    const nestedInDoc = !!el.parentElement?.closest?.(".doc-editor");
    // Belt-and-suspenders: a textblock CARD / inline mini-textblock / table CELL
    // editor renders INSIDE the page prose, but its `.doc-editor` ancestor can be
    // hidden from the check above when the embed NodeView is portal-rendered — so it
    // sneaks in as a top-level drop target and STEALS a page drop (it buries the
    // dropped embed inside ITSELF + detaches the source = "the move didn't happen /
    // it landed in the wrong place / it reloaded"). Such an editor always sits inside
    // one of these card/cell wrappers; the page editor never does. So it bails here.
    const isCardOrCell = !!el.closest?.(".textblock-card, .instance-textblock-block, .table-td");
    // EXCEPTION: a nested DOC-CONTAINER editor (kind:"doc" container embedded in
    // the page prose) owns its OWN textmap. Without a zone of its own, a drop
    // aimed inside it is processed by the page editor, whose nearest top-level
    // boundary is the top/bottom of the whole embed — the item leaves the pointer,
    // lands at the very top of the page, and the source list loses it ("the drop
    // reloaded the page"). It registers a DELEGATE-ONLY zone (no Pragmatic target,
    // so one-editor-per-native-drop still holds): the page editor's handleDocDrop
    // and DragProvider's touch routing both hand it drops landing inside it.
    const ownMod = occurrence?.moduleId ? modulesByIdRef.current?.[occurrence.moduleId] : null;
    const delegateOnly = nestedInDoc && !isCardOrCell && ownMod?.role === "container" && ownMod?.kind === "doc";
    if (typeof window !== "undefined" && window.__dragDiag === true) {
      console.log("[doc-zone] register?", { occId: occurrence?.id, label: ownMod?.label, nestedInDoc, isCardOrCell, kind: ownMod?.kind, delegateOnly, bails: (nestedInDoc || isCardOrCell) && !delegateOnly });
    }
    if ((nestedInDoc || isCardOrCell) && !delegateOnly) return;
    let lastNativeEvent = null;
    // Live drop indicator math (nearestDocBoundary + detectSideHost → offsetFor,
    // which getClientRects()-walks EVERY block of the hovered host) is throttled
    // to one rAF per frame and skipped while the pointer sits still (<4px) — on
    // long imported articles the per-dragover version was the doc-drag jank.
    let dragOverRaf = 0;
    let lastGapX = -Infinity, lastGapY = -Infinity;
    const onDragOver = (e) => {
      lastNativeEvent = e;
      if (!editor?.view) return;
      const x = e.clientX, y = e.clientY;
      // dragover's target is already the deepest element under the pointer —
      // carry it into the rAF so the zone check + detectSideHost's depth<1
      // fallback never need a forced elementFromPoint hit-test per frame
      // (dragover bubbles, so nested + page editors both run this every frame).
      const tgt = e.target instanceof Element ? e.target : null;
      const dx = x - lastGapX, dy = y - lastGapY;
      if (dragOverRaf || dx * dx + dy * dy < 16) return;
      dragOverRaf = requestAnimationFrame(() => {
        dragOverRaf = 0;
        lastGapX = x; lastGapY = y;
        // Indicator delegation — same zone lookup handleDocDrop uses for the
        // DROP: when the pointer is inside a nested doc-container's registered
        // zone, THAT editor paints its own gap/wrap lines (it also listens to
        // dragover now); this editor must not draw a second, misleading line
        // at its own top-level boundary (the drop won't land there).
        const innerEl = tgt?.closest?.(".doc-editor");
        if (innerEl && innerEl !== el && el.contains(innerEl)) {
          const zone = getDocTouchDropZone(innerEl);
          if (zone && zone.el !== el) { setDragGap(null); setWrapDrop(null); return; }
        }
        const sh = detectSideHost({ clientX: x, clientY: y, target: tgt });
        if (sh && sh.anchorOffset != null) {
          const wr = el.getBoundingClientRect();
          const pm = el.querySelector(".ProseMirror");
          const proseTop = pm ? pm.getBoundingClientRect().top - wr.top : 0;
          // Wrapper-relative host box → the VERTICAL edge bar (the affordance the
          // user actually reads as "dropping to the LEFT/RIGHT of this block"; the
          // thin horizontal anchor line alone was invisible in practice, 2026-07-11).
          const hr = sh.hostRect;
          const host = hr ? {
            top: Math.round(hr.top - wr.top), height: Math.round(hr.height),
            left: Math.round(hr.left - wr.left), right: Math.round(hr.right - wr.left),
          } : null;
          setWrapDrop({ top: Math.round(proseTop + sh.anchorOffset), side: sh.side, host });
          // A side-drop WRAPS (handleDocDrop prefers sideHost over the boundary
          // insert) — the boundary gap line would be a second, lying indicator.
          setDragGap(null);
        } else {
          setWrapDrop(null);
          const b = nearestDocBoundary(editor.view, editor.state.doc, el, y);
          setDragGap((prev) => (b && prev && prev.pos === b.pos ? prev : b));
        }
      });
    };
    const onDragLeaveNative = (e) => {
      // Only clear when the drag actually left the editor (not entering a child).
      if (!el.contains(e.relatedTarget)) {
        if (dragOverRaf) { cancelAnimationFrame(dragOverRaf); dragOverRaf = 0; }
        setDragGap(null);
        setWrapDrop(null);
      }
    };
    // Delegate-only (nested doc-container) editors listen to dragover TOO — for
    // INDICATORS only (they still register no Pragmatic target; the page editor
    // hands them the actual drop). Without this, a drag over a nested section
    // showed either the page editor's wrong top-level line or nothing at all —
    // and the wrap-beside affordance (detectSideHost runs against THIS editor's
    // doc, where the host actually lives) never appeared.
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeaveNative);
    // A drop clears indicators via handleDocDrop on the OWNING editor; the
    // delegate-only editor's own lines are cleared by its zone fn running the
    // same handler, plus the shared document-level dragend/drop registry
    // (covers cancelled drags without a listener pair per mounted editor).
    const unregisterDragEndClear = registerDragEndClear(() => { setDragGap(null); setWrapDrop(null); });

    // Named so BOTH the Pragmatic registration (desktop) and the touch drop
    // zone (registerDocTouchDrop below) share the exact same drop logic.
    const canDropDoc = ({ source }) => {
        const sd = source.data || {};
        const type = sd.type;
        // Self-drop guard: when the dragged item's source occurrence IS this
        // editor's wrapping occurrence, reject the drop target. Without this,
        // dragging a textblock OUT of its own sub-editor still lights up the
        // sub-editor's drop highlight (because canDrop returned true) — and
        // any drop landing inside the source's own range would have been a
        // silent no-op anyway via tryMoveEmbedNodeInDoc's self-guard. Hiding
        // the indicator is the visible half of that contract.
        const sourceOccId = sd.context?.occurrenceId || sd.occurrenceId;
        if (sourceOccId && occurrence?.id && sourceOccId === occurrence.id) return false;
        // Per user request: fields + operations from the CommandCenter are
        // organize-in-place only. Reject drops of those payloads when they
        // originate in the CC. Use `@` mention inside the editor to insert
        // a field pill instead.
        if (sd.sourceType === "command-center" && (type === "field" || type === "operation")) return false;
        return type === "instance" || type === "field" || type === "container" || type === "artifact" || type === "module";
    };
    const handleDocDrop = ({ source, location }) => {
        setIsDropTarget(false);
        setDragGap(null);
        setWrapDrop(null);
        const sd = source.data || {};
        const { type, id, data, context } = sd;
        const dropInput = location?.current?.input;
        // [DROP] full diagnostic logging — `ed` = which editor fired (page vs an
        // inner textblock/cell sub-editor; both register drop targets so the
        // INNERMOST under the pointer wins). DLOG every branch so a full test
        // shows exactly what each droppable does. Remove once drop is solid.
        const DLOG = (...a) => {
          if (typeof window !== "undefined" && window.__dragDiag === true) console.log(`[DROP ed=${occurrence?.id || "?"}]`, ...a);
        };
        DLOG("onDrop fired", { type, role: sd.role || data?.role, sourceType: context?.sourceType, occId: context?.occurrenceId || data?.occurrenceId || sd.occurrenceId, fromDoc: source.data?.fromDoc, x: dropInput?.clientX, y: dropInput?.clientY });
        // ONE editor per drop. Pragmatic DnD fires onDrop on EVERY registered drop
        // target under the pointer (innermost-first). A nested textblock sub-editor
        // that slipped past the registration guard (line ~1260) would otherwise ALSO
        // run this whole handler — so a single drop became three cross-doc inserts +
        // three detaches: the doc churned/"reloaded", a stray copy appeared, and the
        // source didn't cleanly move. The OUTERMOST doc editor owns the embed/wrapGroup
        // model (it's where a wrap-beside forms), so only it processes the drop.
        const docTargets = (location?.current?.dropTargets || []).filter((t) => t.data?.type === "doc-editor");
        if (docTargets.length > 1 && docTargets[docTargets.length - 1].element !== el) {
          DLOG("BAIL — not the outermost doc-editor in the drop stack", { stack: docTargets.length });
          return;
        }
        if (source.data?.fromDoc) { DLOG("BAIL fromDoc (field pill self-drag)"); return; }
        // A drop INSIDE a nested doc-container embed belongs to THAT container's
        // textmap. Nested doc-container editors register delegate-only zones
        // (registerDocTouchDrop, no Pragmatic target) — route the drop to the
        // innermost zone under the point when it isn't this editor itself.
        // getDocTouchDropZone climbs past unregistered sub-editors (textblocks,
        // cells), so those still resolve to this editor and reorder at this level.
        {
          const px = dropInput?.clientX ?? lastNativeEvent?.clientX;
          const py = dropInput?.clientY ?? lastNativeEvent?.clientY;
          const innerEl = px != null ? document.elementFromPoint(px, py)?.closest?.(".doc-editor") : null;
          if (innerEl && innerEl !== el && el.contains(innerEl)) {
            const zone = getDocTouchDropZone(innerEl);
            if (zone && zone.el !== el) {
              DLOG("DELEGATE → nested doc-container editor under the point");
              zone.fn({ source, clientX: px, clientY: py });
              return;
            }
          }
        }
        // (Removed the old "drop landed inside a nested .instance-textblock-block"
        // bail — sub-editors no longer register drop targets, so the page editor
        // OWNS drops that land on a textblock and reorders it instead of bailing.)

        const isBlockDrop = type !== "field";
        // Block drops snap to the SAME nearest-boundary the drag indicator showed
        // (so the block lands exactly where the glowing line was). Field pills are
        // inline → keep the raw caret position.
        const dropY = (dropInput || lastNativeEvent)?.clientY;
        let insertPos = isBlockDrop && dropY != null
          ? (nearestDocBoundary(editor?.view, editor?.state?.doc, el, dropY)?.pos ?? resolveInsertPos(dropInput || lastNativeEvent, true))
          : resolveInsertPos(dropInput || lastNativeEvent, isBlockDrop);
        DLOG("isBlockDrop", isBlockDrop, "initial insertPos", insertPos);

        // ── Block-wrap drop-beside (project_block_wrap_l_shape) ─────────────
        // If a block is dropped over the LEFT/RIGHT third of an existing
        // top-level moduleEmbed, form a wrapGroup (that embed = HOST, the
        // dropped one = NEIGHBOR in its notch) instead of inserting a plain
        // sibling. Detection happens at the raw drop coords (pre-snap).
        // (detectSideHost + isTextmappedHost + blockIndexAtY + offsetFor are now
        // hoisted to component scope — see above the dropTargetForElements effect.)
        const wrapHostWithNeighbor = (neighborOccId, sideHost) => {
          const WLOG = (...a) => { if (typeof window !== "undefined" && window.__dragDiag === true) console.log("[wrapHost]", ...a); };
          if (!editor || !sideHost || !neighborOccId) return WLOG("bail: missing editor/sideHost/neighbor") ?? false;
          const groupType = editor.schema.nodes.wrapGroup;
          const embedType = editor.schema.nodes.moduleEmbed;
          if (!groupType || !embedType) return WLOG("bail: schema types missing") ?? false;
          // hostPos is a TOP-LEVEL position from detectSideHost. Resolve via
          // childAfter (top level only) — nodeAt() descends into a wrapGroup's
          // children at its boundary, which mis-targeted the group's first
          // neighbor and nested a group inside a group.
          const { node: host, offset: hostOffset } = editor.state.doc.childAfter(sideHost.hostPos);
          if (!host || hostOffset !== sideHost.hostPos) return WLOG("bail: hostPos not a top-level node start", { hostPos: sideHost.hostPos }) ?? false;
          // Host already wrapped (e.g. the seeded logo⇄description group) → ADD
          // the dropped occurrence as another stacked neighbor (schema allows
          // moduleEmbed{2,}; WrapGroupNode stacks children 0..N-2 down the side).
          if (host.type.name === "wrapGroup") {
            let already = false;
            host.forEach((c) => { if (c.attrs?.occurrenceId === neighborOccId) already = true; });
            if (already) return WLOG("bail: occurrence already a group member") ?? false;
            const neighbor = embedType.create({ occurrenceId: neighborOccId });
            const ran = editor.chain().focus().command(({ tr }) => { tr.insert(sideHost.hostPos + 1, neighbor); return true; }).run();
            WLOG("group-add neighbor ran →", ran, { groupPos: sideHost.hostPos });
            return ran;
          }
          if (host.type.name !== "moduleEmbed") return WLOG("bail: host at pos not moduleEmbed", { hostPos: sideHost.hostPos, type: host?.type?.name }) ?? false;
          if (host.attrs?.occurrenceId === neighborOccId) return WLOG("bail: self-wrap") ?? false;
          const neighbor = embedType.create({ occurrenceId: neighborOccId });
          // Neighbor FIRST so it floats and the host's prose wraps around it (L).
          // columnOnly (non-textmapped host) → wrap:false = side-by-side columns.
          const group = groupType.create({ side: sideHost.side, anchor: sideHost.anchor || "top", anchorIndex: sideHost.anchorIndex ?? null, anchorOffset: sideHost.anchorOffset ?? null, wrap: !sideHost.columnOnly }, [neighbor, host]);
          const from = sideHost.hostPos;
          const to = sideHost.hostPos + host.nodeSize;
          const ran = editor.chain().focus().command(({ tr }) => { tr.replaceWith(from, to, group); return true; }).run();
          WLOG("replaceWith ran →", ran, { from, to });
          return ran;
        };
        // Top-level (depth-1) embed lookup by occurrenceId — used to relocate a
        // moved node. Restricted to top level so we never reach inside an
        // existing wrapGroup (which must keep its two children).
        const findTopEmbedPos = (doc, occId, typeNames = ["moduleEmbed", "instanceTextblock"]) => {
          let found = null;
          doc.forEach((n, offset) => {
            if (found) return;
            if (typeNames.includes(n.type.name) && n.attrs?.occurrenceId === occId) found = { pos: offset, size: n.nodeSize };
          });
          return found;
        };
        // MOVE-beside: when an embed ALREADY IN THIS DOC is dragged beside a host
        // embed, delete it from its old spot and fold it into a wrapGroup as the
        // host's neighbor — in one transaction (so positions stay consistent).
        // Cross-doc sources aren't in this doc → returns false, normal move runs.
        const wrapMoveBeside = (occurrenceId, sideHost) => {
          if (!editor || !sideHost || !occurrenceId || occurrenceId === sideHost.hostOccId) return false;
          const groupType = editor.schema.nodes.wrapGroup;
          const embedType = editor.schema.nodes.moduleEmbed;
          if (!groupType || !embedType) return false;
          const src = findTopEmbedPos(editor.state.doc, occurrenceId);
          if (!src) return false;
          return editor.chain().focus().command(({ tr }) => {
            tr.delete(src.pos, src.pos + src.size);
            const host = findTopEmbedPos(tr.doc, sideHost.hostOccId, ["moduleEmbed"]);
            if (host) {
              const hostNode = tr.doc.nodeAt(host.pos);
              if (!hostNode || hostNode.type.name !== "moduleEmbed") return false;
              const neighbor = embedType.create({ occurrenceId });
              // Neighbor FIRST so it floats and the host's prose wraps around it (L).
              // columnOnly (non-textmapped host) → wrap:false = side-by-side columns.
              const group = groupType.create({ side: sideHost.side, anchor: sideHost.anchor || "top", anchorIndex: sideHost.anchorIndex ?? null, anchorOffset: sideHost.anchorOffset ?? null, wrap: !sideHost.columnOnly }, [neighbor, hostNode]);
              tr.replaceWith(host.pos, host.pos + hostNode.nodeSize, group);
              return true;
            }
            // Host not a bare top-level embed — it may be the HOST (last child)
            // of an existing wrapGroup: add the moved embed as another neighbor.
            let groupPos = null;
            tr.doc.forEach((n, offset) => {
              if (groupPos != null) return;
              if (n.type.name === "wrapGroup" && n.lastChild?.attrs?.occurrenceId === sideHost.hostOccId) groupPos = offset;
            });
            if (groupPos == null) return false;
            tr.insert(groupPos + 1, embedType.create({ occurrenceId }));
            return true;
          }).run();
        };
        // The dragged occ id is threaded INTO detectSideHost at drop time (the
        // 2-col gate needs it to allow member re-morphs; the body dataset stamp
        // covers dragover, but the drop knows the id authoritatively).
        const draggedOccId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
        const sideInputOf = (ev) => (ev ? { clientX: ev.clientX, clientY: ev.clientY, draggedOccId } : ev);
        let sideHost = isBlockDrop ? detectSideHost(sideInputOf(dropInput || lastNativeEvent)) : null;
        DLOG("sideHost (wrap-beside detect)", sideHost);

        // ── Grouped member: normal-drag reposition / unwrap-on-move-out ──────────
        // If the dragged occurrence is already inside a wrapGroup in THIS doc, a
        // normal drag of its radial handle either (a) re-morphs the notch when the
        // NEIGHBOR is dropped on the SAME host (move anchorIndex/side — replaces the
        // deleted grip), or (b) un-wraps the group when dropped anywhere else, then
        // falls through to the normal move/insert below (positions recomputed).
        const grouped = draggedOccId ? findGroupMember(editor.state.doc, draggedOccId) : null;
        DLOG("grouped-member?", grouped ? { groupPos: grouped.groupPos, hostOccId: grouped.hostOccId, isNeighbor: isNeighborMember(grouped) } : null);
        if (grouped) {
          const isNeighbor = isNeighborMember(grouped);
          if (isNeighbor && sideHost && sideHost.hostOccId === grouped.hostOccId) {
            DLOG("grouped → re-morph notch in place (anchorIndex/side)");
            // Re-morph in place — just move the notch to the dropped line / side.
            editor.chain().focus().command(({ tr }) => {
              const g = tr.doc.nodeAt(grouped.groupPos);
              if (!g || g.type.name !== "wrapGroup") return false;
              tr.setNodeMarkup(grouped.groupPos, undefined, {
                ...g.attrs,
                anchorIndex: sideHost.anchorIndex ?? g.attrs.anchorIndex,
                anchorOffset: sideHost.anchorOffset ?? g.attrs.anchorOffset,
                anchor: (sideHost.anchorIndex ?? 0) === 0 ? "top" : "middle",
                side: sideHost.side,
              });
              return true;
            }).run();
            return;
          }
          const draggedMode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? "move";
          if (draggedMode !== "copy") {
            DLOG("grouped → unwrap group then recompute (dragged off its host)");
            // Dropped away from its host (or dragging the host itself) → un-wrap,
            // then recompute the drop target on the now-flattened doc.
            unwrapGroupAt(editor, grouped.groupPos);
            insertPos = resolveInsertPos(dropInput || lastNativeEvent, isBlockDrop);
            sideHost = isBlockDrop ? detectSideHost(sideInputOf(dropInput || lastNativeEvent)) : null;
            // Don't immediately re-wrap onto the SAME host it was just dragged off.
            if (sideHost && sideHost.hostOccId === grouped.hostOccId) sideHost = null;
          }
        }

        // ── Block-embed drop — ONE path for every embeddable occurrence ──────
        // instance / textblock / artifact / container all embed the same way: a
        // `moduleEmbed` node (ModuleEmbedNode renders the right component per the
        // occurrence's role). So there is no per-role branching and no per-node-
        // type branching:
        //   • same-doc reorder  → relocate whatever node already holds the occ
        //                          (type-agnostic find → preserves its node type)
        //   • copy              → deep-clone the occurrence (recurses children),
        //                          embed the clone
        //   • cross-doc / from a container → insert a moduleEmbed, detach source
        if (type === "instance" || type === "container" || type === "artifact" || type === "module") {
          const occsById = occurrencesByIdRef.current || {};
          let occurrenceId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
          // CC drops carry no occurrenceId — reuse an existing occurrence of the module.
          if (!occurrenceId && id) {
            const existing = Object.values(occsById).find(o => o.moduleId === id);
            if (existing) occurrenceId = existing.id;
          }
          if (!occurrenceId) { DLOG("BAIL block-embed: no occurrenceId resolved"); return; }
          const dragMode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? "move";
          DLOG("block-embed path", { occurrenceId, dragMode, dragModeSource: data?.occurrence?.dragMode != null ? "occurrence.dragMode" : data?.defaultDragMode != null ? "defaultDragMode" : "DEFAULT(move)", hasSideHost: !!sideHost });

          // COPY — deep-clone (recurses children for a container; a leaf just
          // clones its own fields/textmap/meta), then embed the clone.
          if (dragMode === "copy") {
            const deepCopyOcc = (occ) => {
              if (!occ) return null;
              const childIds = (occ.occurrences || [])
                .map((cid) => deepCopyOcc(occsById[cid]))
                .filter(Boolean);
              const copyId = crypto.randomUUID();
              CommitHelpers.createOccurrence({
                dispatch: dispatchRef.current, socket: socketRef.current,
                occurrence: {
                  id: copyId,
                  moduleId: occ.moduleId,
                  gridId: occ.gridId,
                  occurrences: childIds,
                  fields: occ.fields || {},
                  meta: occ.meta || {},
                  dragMode: occ.dragMode ?? null,
                  textmap: occ.textmap || null,
                },
                emit: true,
              });
              return copyId;
            };
            const copyId = deepCopyOcc(occsById[occurrenceId]);
            if (!copyId) { DLOG("BAIL copy: deepCopyOcc returned null"); return; }
            const wrapped = sideHost && wrapHostWithNeighbor(copyId, sideHost);
            DLOG("COPY done", { copyId, wrappedBeside: !!wrapped });
            if (!wrapped) insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId: copyId } });
            return;
          }

          // MOVE — beside a host embed → fold into a wrapGroup.
          if (sideHost && wrapMoveBeside(occurrenceId, sideHost)) { DLOG("MOVE → wrapMoveBeside committed"); return; }
          if (insertPos == null) { DLOG("BAIL move: insertPos null"); return; }
          // Same-doc rearrange: relocate the existing node (any type) in place.
          // Returns false when the source lives elsewhere → cross-target path.
          const sameDocMoved = tryMoveEmbedNodeInDoc(editor, null, { occurrenceId }, insertPos);
          DLOG("MOVE same-doc tryMoveEmbedNodeInDoc →", sameDocMoved);
          if (sameDocMoved) return;
          // Cross-doc / from a container: insert FIRST (so a silent failure
          // can't orphan the source), then detach the source from wherever it
          // lived — a sibling doc-embed node, or a page/panel/container's list.
          // A detected side host still means "fold into a wrapGroup" — the
          // same-doc wrapMoveBeside above returned false only because the
          // source isn't a node in THIS doc; wrapHostWithNeighbor embeds any
          // occurrence id as the floated neighbor (same call the copy path uses).
          // Capture the doc-embed source's registry deleter BEFORE inserting:
          // the wrap/insert mounts a NEW embed NodeView for the SAME occurrence
          // id, which overwrites the registry entry — a post-insert lookup would
          // delete the freshly inserted node instead of the old source.
          const sourceEmbedDelete = context?.sourceType === "doc-embed" ? embedDeleteRegistry.get(occurrenceId) : null;
          const wrappedCross = sideHost ? wrapHostWithNeighbor(occurrenceId, sideHost) : false;
          const insertedCross = wrappedCross || insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId } });
          DLOG("MOVE cross-doc insert →", insertedCross, { wrappedBeside: !!wrappedCross, sourceType: context?.sourceType, pageOccurrenceId: context?.pageOccurrenceId, panelId: context?.panelId });
          if (!insertedCross) return;
          // Detach the source from wherever it ACTUALLY lives. A doc-embed source
          // is a TipTap node (registry delete). Otherwise the source occurrence is
          // a child of exactly one parent's `occurrences[]` — find THAT parent by
          // scanning (not by guessing panelId/pageOccurrenceId: a board instance
          // lives in its CONTAINER, not the panel, so the panelId guess removed
          // nothing → the source stayed → it looked copied instead of moved).
          if (context?.sourceType === "doc-embed") {
            DLOG("DETACH via embedDeleteRegistry (pre-insert capture)", { hasEntry: !!sourceEmbedDelete });
            sourceEmbedDelete?.();
          } else {
            const parentOcc = Object.values(occsById).find((o) => Array.isArray(o.occurrences) && o.occurrences.includes(occurrenceId));
            if (!parentOcc) DLOG("DETACH FAILED — no parent lists this occurrence");
            else {
              DLOG("DETACH source from parent (occurrences-scan)", { parentId: parentOcc.id });
              CommitHelpers.updateOccurrence({
                dispatch: dispatchRef.current, socket: socketRef.current,
                occurrence: { id: parentOcc.id, occurrences: (parentOcc.occurrences || []).filter((eid) => eid !== occurrenceId) },
                emit: true,
              });
            }
          }
          return;
        }
        if (type === "field") {
          DLOG("FIELD pill insert", { fieldId: id || data?.id, insertPos });
          const field = data || {};
          insertAtPos(insertPos, {
            type: "fieldPill",
            attrs: { fieldId: id || field.id, fieldName: field.name || "Field", fieldType: field.type || "text", showValue: true, showLabel: true },
          });
          return;
        }
        DLOG("NO BRANCH MATCHED type", type);
    };

    // A delegate-only (nested doc-container) editor registers NO Pragmatic
    // target — native drops still fire once, on the page editor, which then
    // hands them here through the zone registry.
    const cleanup = delegateOnly ? null : dropTargetForElements({
      element: el,
      getData: () => ({ type: "doc-editor" }),
      canDrop: canDropDoc,
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => { setIsDropTarget(false); setDragGap(null); setWrapDrop(null); },
      onDrop: handleDocDrop,
    });

    // TOUCH: our custom touch drags never fire Pragmatic drop targets, so the
    // doc editor registers the SAME drop handler as a touch drop zone.
    // dragSystem / DragProvider route doc-landing touch drops here with a
    // synthetic single-entry dropTargets stack (this editor = the outermost).
    const touchDropCleanup = registerDocTouchDrop(el, ({ source, clientX, clientY }) => {
      if (!canDropDoc({ source })) return;
      handleDocDrop({
        source,
        location: { current: { input: { clientX, clientY }, dropTargets: [{ data: { type: "doc-editor" }, element: el }] } },
      });
    });

    return () => {
      if (dragOverRaf) cancelAnimationFrame(dragOverRaf);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeaveNative);
      unregisterDragEndClear();
      cleanup?.();
      touchDropCleanup();
    };
  }, [resolveInsertPos, insertAtPos, occurrence?.id]);

  // ── native file/text drops ────────────────────────────────────
  const handleFileDrop = useCallback(async (e) => {  // still async for file uploads
    if (!editor) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    // Skip Pragmatic DnD drops — they're handled by dropTargetForElements' onDrop.
    // Without this guard, the text/plain label from the drag payload creates a duplicate instance.
    if (dt.types && Array.from(dt.types).includes(NATIVE_DND_MIME)) return;

    // File drops → create an ARTIFACT INSTANCE embedded at the drop point.
    // This is the doc / table-cell arm of the site-wide "drop an upload → it
    // becomes an instance of the file" behavior (helpers/artifactUpload.js) —
    // the board/canvas arm lives in helpers/dropHandlers.handleFileDrop. Every
    // artifact kind (image / video / audio / pdf / …) renders via ArtifactCard
    // inside the moduleEmbed, so the doc gets a real, movable instance instead
    // of a dead pill or a bare inline image.
    const files = dt.files;
    if (files?.length) {
      e.preventDefault(); e.stopPropagation();
      const gridId = occurrence?.gridId || ctxGrid?._id || ctxGrid?.id || ctxGrid?.gridId || null;
      const userId = occurrence?.userId || ctxUserId || null;
      if (!gridId || !userId) return;
      const pos = resolveInsertPos(e, true);
      const placeholders = createArtifactPlaceholders(Array.from(files), {
        gridId, userId, dispatch,
        occExtra: () => (occurrence?.id ? { parentId: occurrence.id } : {}),
      });
      // Insert one moduleEmbed per uploaded file at the drop position.
      editor.chain().focus().insertContentAt(
        pos,
        placeholders.map(p => ({ type: "moduleEmbed", attrs: { occurrenceId: p.occurrenceId } })),
      ).run();
      uploadArtifactPlaceholders(placeholders, {
        gridId, userId, dispatch, socket,
        persist: () => (occurrence?.id ? { parentId: occurrence.id } : null),
      });
      return;
    }

    // N1: plain text or URL drops from outside the browser
    const url = dt.getData("text/uri-list") || dt.getData("URL");
    const text = dt.getData("text/plain");
    const label = (url || text || "").trim().slice(0, 120);
    if (!label) return;
    e.preventDefault(); e.stopPropagation();
    // Create a new instance module and insert as pill
    const newId = crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    CommitHelpers.createModule({
      dispatch, socket,
      module: { id: newId, label, role: "instance", kind: "board", meta: url ? { url } : {} },
      emit: true,
    });
    editor.chain().focus().insertContent({
      type: "instancePill",
      attrs: { instanceId: newId, instanceLabel: label, showIcon: true },
    }).insertContent(" ").run();
  }, [editor, dispatch, socket, occurrence, ctxGrid, ctxUserId, resolveInsertPos]);

  // ── insert helpers exposed via ref ───────────────────────────
  const deleteAtTrigger = useCallback(() => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex >= 0) {
      const deleteFrom = from - (textBefore.length - atIndex);
      editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
  }, [editor]);

  const insertFieldPill = useCallback((field) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atIndex = textBefore.lastIndexOf("@");
    const chain = editor.chain().focus();
    if (atIndex >= 0) chain.deleteRange({ from: from - (textBefore.length - atIndex), to: from });
    chain.insertFieldPill({ fieldId: field.id, fieldName: field.name, fieldType: field.type || "text", showValue: true, showLabel: true }).run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor]);

  const handleSelectField = useCallback((field) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atIndex = textBefore.lastIndexOf("@");
    const chain = editor.chain().focus();
    if (atIndex >= 0) chain.deleteRange({ from: from - (textBefore.length - atIndex), to: from });
    chain.insertFieldPill({ fieldId: field.id, fieldName: field.name, fieldType: field.type || "text", showValue: true, showLabel: false }).run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor]);

  const handleSelectInstance = useCallback((instance) => {
    if (!editor) return;
    deleteAtTrigger();
    editor.chain().focus().insertContent({
      type: "instancePill",
      attrs: { instanceId: instance.id, instanceLabel: instance.label || instance.id, containerId: instance.containerId || null, showIcon: true },
    }).insertContent(" ").run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor, deleteAtTrigger]);

  const handleSelectPanel = useCallback((panel) => {
    if (!editor) return;
    deleteAtTrigger();
    editor.chain().focus().insertContent({
      type: "docLink",
      attrs: { targetId: panel.id, label: panel.label || panel.id, linkType: "panel" },
    }).insertContent(" ").run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor, deleteAtTrigger]);

  const handleSelectContainer = useCallback((container) => {
    if (!editor) return;
    deleteAtTrigger();
    const nodes = [{ type: "paragraph", content: [{ type: "text", text: container.label || container.id, marks: [{ type: "bold" }] }] }];
    const items = container.occurrences || [];
    if (items.length > 0 && instancesById) {
      const listItems = items.map(itemId => {
        const occ = getOccMap()[itemId];
        const inst = instancesById[occ?.moduleId || itemId];
        if (!inst) return null;
        return { type: "listItem", content: [{ type: "paragraph", content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label || inst.id, occurrenceId: occ?.id || null, containerId: container.id, showIcon: true } }] }] };
      }).filter(Boolean);
      if (listItems.length > 0) nodes.push({ type: "bulletList", content: listItems });
    }
    editor.chain().focus().insertContent(nodes).run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor, deleteAtTrigger, instancesById, getOccMap]);

  // ── expr pill insertion (= trigger) ──────────────────────────
  const handleSelectEmbed = useCallback((occurrenceId) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atIdx = textBefore.lastIndexOf("@:");
    const chain = editor.chain().focus();
    if (atIdx >= 0) chain.deleteRange({ from: from - (textBefore.length - atIdx), to: from });
    chain.insertModuleEmbed({ occurrenceId }).run();
    setShowEmbedPicker(false); setEmbedQuery("");
  }, [editor]);

  const filteredEmbedContainers = useMemo(() => {
    // Only computed while the @: embed picker is OPEN — scanning every
    // occurrence per editor per render was a top entry in the drop CPU profile.
    if (!showEmbedPicker) return [];
    const occs = Object.values(getOccMap());
    return occs.filter(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.role === "container" && mod?.label;
    }).filter(occ => {
      if (!embedQuery) return true;
      const mod = modulesById?.[occ.moduleId];
      return mod?.label?.toLowerCase().includes(embedQuery.toLowerCase());
    }).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmbedPicker, getOccMap, modulesById, embedQuery]);

  // Reset keyboard nav index when filtered list changes
  useEffect(() => { setExprActiveIndex(-1); }, [exprQuery]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (!showExprSuggestion || exprActiveIndex < 0 || !exprListRef.current) return;
    const items = exprListRef.current.querySelectorAll("[data-expr-item]");
    items[exprActiveIndex]?.scrollIntoView({ block: "nearest" });
  }, [exprActiveIndex, showExprSuggestion]);

  useImperativeHandle(ref, () => ({
    editor,
    insertFieldPill,
    insertInstancePill: (instance) => {
      if (!editor) return;
      editor.chain().focus().insertContent({
        type: "instancePill",
        attrs: { instanceId: instance.id, instanceLabel: instance.label || "Item", containerId: instance.containerId || null, showIcon: true },
      }).run();
    },
  }), [editor, insertFieldPill]);

  // ── insert-here doc gap ───────────────────────────────────────
  const gapsOn = enableInsertGaps && !isCell && editable && !!occurrence?.userId;

  // Track the nearest top-level block boundary under the cursor.
  const handleGapMove = useCallback((e) => {
    if (!gapsOn) return;
    const view = editor?.view;
    const wrapEl = wrapperRef.current;
    if (!view || !wrapEl) return;
    // Don't recompute while the pointer is over the affordance itself.
    if (e.target?.closest?.(".doc-insert-gap")) return;
    // Only the editor that OWNS the pointer draws a gap (2026-07-25, per user:
    // "2 hover add new lines at the bottom of the container"). mousemove
    // bubbles through every ancestor editor, so hovering inside a nested doc
    // CONTAINER made both that container's editor AND the page editor paint
    // one — two stacked insert lines. Same ownership test the mousedown
    // caret fix-up uses.
    const myDocEditor = wrapEl.closest(".doc-editor");
    if (myDocEditor && e.target?.closest?.(".doc-editor") !== myDocEditor) {
      clearDocGapUnlessPinned();
      return;
    }
    // Only show the gap in the empty gutter BETWEEN blocks. While the pointer is
    // over a block's content (clicking a heading to edit, selecting text) stay
    // hidden — otherwise a click-to-edit pops a stray insert line under the
    // block that the keyboard can't dismiss (it's an overlay).
    if (isOverTopBlock(view, editor.state.doc, e.clientY)) {
      clearDocGapUnlessPinned();
      return;
    }
    // Nearest block boundary (works in the empty margin between blocks too, so
    // the "+" doesn't vanish exactly where the user hovers to insert).
    setDocGapUnlessPinned(nearestDocBoundary(view, editor.state.doc, wrapEl, e.clientY));
  }, [gapsOn, editor, clearDocGapUnlessPinned, setDocGapUnlessPinned]);

  // Mint a standalone occurrence (NOT into any occurrences[] — doc embeds are
  // standalone) and insert a moduleEmbed for it at `pos`. existingModuleId →
  // a fresh placement of a picked module; else a new role:"instance" module.
  const insertDocItemAt = useCallback((pos, { existingModuleId = null, fieldIds = [] } = {}) => {
    if (!editor || !occurrence?.userId) return;
    const userId = occurrence.userId;
    const gridId = occurrence.gridId;
    const occId = crypto.randomUUID();
    let moduleId = existingModuleId;
    if (!moduleId) {
      moduleId = crypto.randomUUID();
      const module = { id: moduleId, userId, gridId, role: "instance", kind: "list", label: "" };
      if (Array.isArray(fieldIds) && fieldIds.length) {
        module.fieldBindings = fieldIds.map((fid) => ({ fieldId: fid, role: "input" }));
      }
      CommitHelpers.createModule({ dispatch, socket, module, emit: true });
    }
    CommitHelpers.createOccurrence({
      dispatch, socket,
      occurrence: { id: occId, userId, gridId, moduleId, parentId: occurrence?.id, iteration: { mode: "persistent" }, fields: {} },
      emit: true,
    });
    const at = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    editor.chain().focus().insertContentAt(at, { type: "moduleEmbed", attrs: { occurrenceId: occId } }).run();
    setDocGap(null);
  }, [editor, occurrence, dispatch, socket]);

  // ── render ────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className={`doc-editor relative flex flex-col flex-1 min-h-0 ${className}`}
      onContextMenu={handleContextMenu}
      onDrop={handleFileDrop}
      onDragOver={(e) => {
        const types = e.dataTransfer?.types || [];
        if (types.includes("Files") || types.includes("text/plain") || types.includes("text/uri-list") || types.includes("URL")) {
          e.preventDefault();
        }
      }}
      style={{
        outline: isDropTarget ? "2px solid rgba(50,150,255,0.9)" : "none",
        minHeight: 32,
        position: "relative",
      }}
    >
      <ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />

      {isDropTarget && (
        <div className="absolute inset-0 pointer-events-none z-10" style={{ background: "rgba(50,150,255,0.06)" }} />
      )}

      {isSaving && (
        <div className="absolute top-1 right-1 text-xs text-muted-foreground opacity-60 z-20">Saving…</div>
      )}

      {showToolbar && editor && (
        <div className={stickyToolbar ? "doc-toolbar-sticky" : ""}>
          <DocToolbar editor={editor} />
        </div>
      )}

      <div
        className={`doc-editor-wrapper min-h-[100px] pr-2 pl-3 flex-1${stickyToolbar ? " overflow-auto" : ""}`}
        style={{ paddingTop: 5, paddingBottom: 5 }}
        draggable={false}
        ref={(el) => { docGapElRef.current = el; }}
        onMouseMove={gapsOn ? handleGapMove : undefined}
        onMouseLeave={gapsOn ? (e) => { if (!e.relatedTarget?.closest?.(".doc-insert-gap")) clearDocGapUnlessPinned(); } : undefined}
        onMouseDown={(e) => {
          // Block content sync briefly so ProseMirror's cursor placement on mousedown
          // isn't overwritten by a server echo arriving before the focus event fires.
          recentMousedownRef.current = true;
          setTimeout(() => { recentMousedownRef.current = false; }, 300);

          // [caret] diag — which editor owns the click, and what posAtCoords says
          // (see helpers/caretDiag.js; window.__caretDiag=false to mute).
          logCaretPointerDown("editor.wrapper", e, {
            occId: (occurrence?.id || "").slice(0, 8),
            host: e.target?.closest?.(".instance-textblock-block") ? "block-mini-textblock"
              : e.target?.closest?.(".textblock-card") ? "textblock-card"
              : e.target?.closest?.(".instance-textblock-inline") ? "inline-chip"
              : e.target?.closest?.(".table-td") ? "table-cell" : "doc",
            isCell, editable: !!editor?.isEditable,
          });

          // Fix cursor placement for editors nested inside contenteditable="false"
          // (e.g. textblock sub-editors). The browser can't resolve click position
          // across contenteditable boundaries — and in FIREFOX any draggable=true
          // ANCESTOR (every embed row) suppresses native caret placement outright —
          // so we compute the position from click coords and set it explicitly.
          // ONLY the editor that OWNS the click runs the fix-up: mousedown BUBBLES
          // through every ancestor editor's wrapper, and each used to resolve
          // posAtCoords against ITS OWN doc (the ancestors resolve the nested
          // editor's atom boundary = pos 0/1) and schedule a competing
          // setTextSelection rAF — caretDiag showed 4 selection writes per click.
          const ownsClick = e.target?.closest?.(".doc-editor-wrapper") === e.currentTarget;
          if (editor && editor.isEditable && ownsClick && e.target !== e.currentTarget) {
            const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
            logCaretInterference("editor.posAtCoords-fixup", {
              occId: (occurrence?.id || "").slice(0, 8),
              pos: coords?.pos ?? null, inside: coords?.inside ?? null,
              docSize: editor.state.doc.content.size,
            });
            if (coords) {
              requestAnimationFrame(() => {
                try {
                  editor.commands.setTextSelection(coords.pos);
                  logCaretInterference("editor.setTextSelection(rAF)", {
                    occId: (occurrence?.id || "").slice(0, 8),
                    setTo: coords.pos, nowAt: editor.state.selection.from,
                  });
                } catch (err) {
                  logCaretInterference("editor.setTextSelection THREW", {
                    occId: (occurrence?.id || "").slice(0, 8), pos: coords.pos, err: String(err).slice(0, 80),
                  });
                }
              });
            }
          }
        }}
        onClick={(e) => {
          if (!editor || !editor.isEditable) return;
          if (e.target !== e.currentTarget) return;
          // Click is on wrapper padding (not on ProseMirror content itself).
          // Use 'end' so TipTap doesn't default to editor.state.selection (pos 1
          // for an unfocused editor), which always places cursor at the beginning.
          // Guard: when the doc ends in an ATOM (embed/textblock), 'end' is a
          // doc-level position with no inline content → ProseMirror throws
          // "TextSelection endpoint not pointing into a node with inline content".
          logCaretInterference("editor.padding-click focus('end')", { occId: (occurrence?.id || "").slice(0, 8) });
          try { editor.commands.focus('end'); } catch (_) { try { editor.commands.focus(); } catch (_) {} }
        }}
      >
        <CellEmbedContext.Provider value={{ displayFieldId, fieldVisibility, hideLabel, __inCell: true }}>
          <EditorContent editor={editor} />
        </CellEmbedContext.Provider>
      </div>

      {/* docGap is set by hover (gap-enabled editors only) OR by the context
          menu's "Add occurrence here…" row (any doc editor) — render whenever
          it's set. Hover can only have produced it under gapsOn, so the old
          gapsOn gate here was redundant for hover and wrong for the menu path. */}
      {docGap && (
        <div
          className="doc-insert-gap"
          style={{ top: docGap.top }}
          onMouseLeave={(e) => { if (!e.relatedTarget?.closest?.(".doc-editor-wrapper")) clearDocGapUnlessPinned(); }}
        >
          <div className="insert-gap-line" />
          <div className="insert-gap-btn">
            <QuickAddMenu
              targetRole="instance"
              hostOccurrence={occurrence}
              onSelect={(m) => insertDocItemAt(docGap.pos, { existingModuleId: m?.id ?? m })}
              onCreateNew={({ fieldIds } = {}) => insertDocItemAt(docGap.pos, { fieldIds })}
              openTrigger={gapAddTrigger}
              // onOpenChange fires on real transitions only (never on mount),
              // so a close always means "the user is done with this gap".
              onOpenChange={(open) => { if (!open) setDocGap(null); }}
            />
          </div>
        </div>
      )}

      {/* Live drop indicator while dragging a block over this editor — same blue
          line as the hover/board gap so reorder targeting reads identically. */}
      {dragGap && (
        <div className="doc-insert-gap doc-insert-gap--drag" style={{ top: dragGap.top }}>
          <div className="insert-gap-line" />
        </div>
      )}

      {wrapDrop && (
        <div
          className={`wrap-drop-line wrap-drop-line--${wrapDrop.side}`}
          style={{ top: wrapDrop.top }}
        />
      )}
      {wrapDrop?.host && (
        <div
          className="wrap-drop-edge"
          style={{
            top: wrapDrop.host.top,
            height: wrapDrop.host.height,
            left: wrapDrop.side === "left" ? wrapDrop.host.left - 5 : wrapDrop.host.right + 2,
          }}
        />
      )}

      {showSuggestion && (
        <FieldSuggestion
          fields={filteredFields}
          query={suggestionQuery}
          onSelect={handleSelectField}
          onSelectInstance={handleSelectInstance}
          onSelectContainer={handleSelectContainer}
          onSelectPanel={handleSelectPanel}
          onClose={() => setShowSuggestion(false)}
          position={suggestionPos}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          query={commandQuery}
          position={commandPos}
          onSelect={() => {}}
          onClose={() => { setShowCommandPalette(false); setCommandQuery(""); }}
          editor={editor}
        />
      )}

      {showDocLink && (
        <DocLinkSuggestion
          query={docLinkQuery}
          position={docLinkPos}
          onSelect={(linkData) => {
            if (!editor) return;
            const { from } = editor.state.selection;
            const textBefore = editor.state.doc.textBetween(Math.max(0, from - 30), from);
            const bracketIndex = textBefore.lastIndexOf("[[");
            if (bracketIndex >= 0) {
              const deleteFrom = from - (textBefore.length - bracketIndex);
              editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).insertDocLink(linkData).run();
            }
            setShowDocLink(false); setDocLinkQuery("");
          }}
          onClose={() => { setShowDocLink(false); setDocLinkQuery(""); }}
        />
      )}

      {/* Embed container picker — triggered by @: sequence */}
      {showEmbedPicker && (
        <div style={{
          position: "absolute", zIndex: 200,
          top: embedPos.top, left: embedPos.left,
          background: "var(--surface-card)", border: "1px solid rgba(134,239,172,0.3)",
          borderRadius: 6, padding: "4px 0", minWidth: 220, maxHeight: 220, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          <div style={{ padding: "4px 10px 3px", fontSize: 9, color: "rgba(134,239,172,0.5)", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid rgba(134,239,172,0.1)", marginBottom: 2 }}>
            Embed Container
          </div>
          {filteredEmbedContainers.length === 0 && (
            <div style={{ padding: "4px 10px", fontSize: 10, color: "var(--text-faint)" }}>No containers found</div>
          )}
          {filteredEmbedContainers.map(occ => {
            const mod = modulesById?.[occ.moduleId];
            return (
              <div
                key={occ.id}
                onMouseDown={(e) => { e.preventDefault(); handleSelectEmbed(occ.id); }}
                style={{
                  padding: "3px 10px", cursor: "pointer", fontSize: 10,
                  color: "rgba(134,239,172,0.85)", fontFamily: "var(--font-mono)",
                  display: "flex", alignItems: "center", gap: 6,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(134,239,172,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ opacity: 0.5 }}>⊞</span>
                <span>{mod?.label}</span>
                <span style={{ opacity: 0.35, marginLeft: "auto", fontSize: 9 }}>{mod?.kind}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Expression pill suggestion — triggered by = key */}
      {showExprSuggestion && (
        <div style={{
          position: "absolute", zIndex: 200,
          top: exprPos.top, left: exprPos.left,
          background: "var(--surface-card)", border: "1px solid rgba(250,204,21,0.3)",
          borderRadius: 6, padding: "4px 0", minWidth: 200, maxHeight: 220, overflowY: "auto",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }} ref={exprListRef}>
          {/* Formula preview header */}
          <div style={{ padding: "4px 10px 3px", fontSize: 9, color: "rgba(250,204,21,0.5)", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid rgba(250,204,21,0.1)", marginBottom: 2 }}>
            {exprQuery
              ? <><span style={{ color: "rgba(250,204,21,0.85)", fontFamily: "var(--font-mono)" }}>= {exprQuery}</span><span style={{ marginLeft: 6 }}>↵ insert</span></>
              : "= type formula or pick field"}
          </div>
          {filteredExprFields.length === 0 && (
            <div style={{ padding: "4px 10px", fontSize: 10, color: "var(--text-faint)" }}>No field matches — press ↵ to insert formula</div>
          )}
          {filteredExprFields.slice(0, 12).map((f, i) => (
            <div
              key={f.id}
              data-expr-item
              onMouseDown={(e) => { e.preventDefault(); handleSelectExpr(f.name); }}
              onMouseEnter={() => setExprActiveIndex(i)}
              style={{
                padding: "3px 10px", cursor: "pointer", fontSize: 10,
                color: "rgba(250,204,21,0.85)", fontFamily: "var(--font-mono)",
                display: "flex", alignItems: "center", gap: 6,
                background: exprActiveIndex === i ? "rgba(250,204,21,0.12)" : "transparent",
              }}
            >
              <span style={{ opacity: 0.5 }}>Σ</span>
              <span>{f.name}</span>
              <span style={{ opacity: 0.35, marginLeft: "auto", fontSize: 9 }}>{f.type}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
});

export default Editor;
