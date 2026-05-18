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
  useCallback, useContext, useEffect, useMemo, useRef, useState,
  forwardRef, useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { NATIVE_DND_MIME } from "../helpers/dragSystem";
import { embedDeleteRegistry } from "../helpers/embedRegistry";

import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { FieldPill } from "../docs/FieldPillExtension";
import { InstancePill } from "../docs/InstancePillExtension";
import { DocLink } from "../docs/DocLinkExtension";
import { PillBackspace } from "../docs/PillBackspaceExtension";
import { HeadingFocus } from "../docs/HeadingFocusExtension";
import { ModuleEmbed } from "../docs/ModuleEmbedExtension";
import { InstanceTextblock } from "../docs/InstanceTextblockExtension";
import { ExprPill } from "../docs/ExprPillExtension";
import { CellEmbedContext } from "../docs/CellEmbedContext";
import FieldSuggestion from "../docs/suggestions/FieldSuggestion";
import CommandPalette from "../docs/suggestions/CommandPalette";
import DocLinkSuggestion from "../docs/suggestions/DocLinkSuggestion";
import DocToolbar from "../docs/DocToolbar";
import ContextMenu from "./ContextMenu";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Bold, Italic, Strikethrough, Code, RemoveFormatting, AtSign, List, Box } from "lucide-react";

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

function tryMoveEmbedNodeInDoc(editor, nodeTypeName, match, insertPos) {
  if (!editor || insertPos == null) return false;
  let sourcePos = null;
  let sourceNode = null;
  let sourceIndex = -1;
  let runningIndex = 0;
  editor.state.doc.forEach((child, offset) => {
    if (sourceNode) return;
    if (child.type.name === nodeTypeName
        && Object.entries(match).every(([k, v]) => child.attrs?.[k] === v)) {
      sourcePos = offset;
      sourceNode = child;
      sourceIndex = runningIndex;
    }
    runningIndex += 1;
  });
  if (sourcePos == null) return false;

  const sourceEnd = sourcePos + sourceNode.nodeSize;
  // Drop INSIDE the source range is a no-op (the cursor never actually left
  // the source). Boundary drops, though, are the "drop on adjacent sibling"
  // case the snap math resolves to — those should snap PAST the sibling so
  // the move actually happens.
  if (insertPos > sourcePos && insertPos < sourceEnd) return true;
  if (insertPos === sourcePos || insertPos === sourceEnd) {
    const childCount = editor.state.doc.childCount;
    if (insertPos === sourceEnd && sourceIndex + 1 < childCount) {
      const nextSibling = editor.state.doc.child(sourceIndex + 1);
      insertPos = sourceEnd + nextSibling.nodeSize;
    } else if (insertPos === sourcePos && sourceIndex > 0) {
      const prevSibling = editor.state.doc.child(sourceIndex - 1);
      insertPos = sourcePos - prevSibling.nodeSize;
    } else {
      // Source is at the doc edge with no neighbour to swap past — genuine no-op.
      return true;
    }
  }

  // Delete shifts every position past sourcePos by -nodeSize; adjust the
  // insert target so it lands where the user dropped.
  const adjusted = insertPos > sourcePos ? insertPos - sourceNode.nodeSize : insertPos;

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
  // Cell-mode column-level field filter (independent of displayFieldId).
  // Shape: { mode: "show" | "hide", fieldIds: [...] } or null. Consumed by
  // ModuleInstance via CellEmbedContext — embed renders the full instance
  // form but filters which field bindings appear.
  fieldFilter = null,
}, ref) {
  // Cell mode: opt-in via mode="cell". Gates doc-only behaviors and enables
  // spreadsheet navigation keymaps. The default mode="doc" path is unchanged.
  const isCell = mode === "cell";
  const { fieldsById, instancesById, occurrencesById, modulesById } = useContext(GridActionsContext) || {};

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
  const occurrencesByIdRef = useRef(occurrencesById);
  const dispatchRef = useRef(dispatch);
  const socketRef = useRef(socket);
  occurrencesByIdRef.current = occurrencesById;
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
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false, allowBase64: true }),
      FieldPill,
      InstancePill,
      InstanceTextblock,
      DocLink,
      PillBackspace,
      HeadingFocus,
      ModuleEmbed,
      ExprPill,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: content || { type: "doc", content: [{ type: "paragraph", content: [] }] },
    editable,
    onCreate: ({ editor }) => {
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
      if (!isCell && onAutoCreateTextblock && transaction.docChanged && !transaction.getMeta("skipAutoCreate")) {
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
              const targetOcc = occurrencesById?.[occId];
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
              const targetOcc = occurrencesById?.[occId];
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
      attributes: { class: "doc-editor-content prose prose-invert max-w-none focus:outline-none", draggable: "false" },
      handleDOMEvents: {
        dragstart: (view, event) => {
          // Only allow dragstart from drag handle elements — prevents native
          // text-selection drag from interfering with cursor placement.
          const target = event.target;
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
    const items = [
      hasSelection && { label: "Bold", icon: Bold, onClick: () => editor.chain().focus().toggleBold().run() },
      hasSelection && { label: "Italic", icon: Italic, onClick: () => editor.chain().focus().toggleItalic().run() },
      hasSelection && { label: "Strikethrough", icon: Strikethrough, onClick: () => editor.chain().focus().toggleStrike().run() },
      hasSelection && { label: "Code", icon: Code, onClick: () => editor.chain().focus().toggleCode().run() },
      hasSelection && { separator: true },
      hasSelection && { label: "Clear formatting", icon: RemoveFormatting, onClick: () => editor.chain().focus().unsetAllMarks().run() },
      { separator: true },
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
        editor.commands.setContent(content, { emitUpdate: false });
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

    const blockStart = $pos.before(1); // position of the gap before the top-level block
    const blockEnd = $pos.after(1);   // position of the gap after the top-level block

    // Left-edge heuristic: when the cursor sits to the LEFT of the block's
    // text column (e.g. in the leading margin of a paragraph), force "before"
    // insertion. The vertical-midline math below otherwise flips to "after"
    // whenever the cursor is in the bottom half of a line, even though a
    // left-margin hover intuitively reads as "insert above this line".
    const blockDom = editor.view.nodeDOM(blockStart);
    if (blockDom && blockDom.getBoundingClientRect) {
      const blockRect = blockDom.getBoundingClientRect();
      // 10px slack so hovers right against the text edge still count.
      if (clientX < blockRect.left + 10) return blockStart;
    }

    // Compare against the LINE rect (caret rect at the resolved position),
    // not the full paragraph rect. Paragraph-rect bias was sending hovers on
    // the first line of a multi-line block to "after" because the cursor sat
    // above the paragraph's midpoint only when near the very top.
    try {
      const lineCoords = editor.view.coordsAtPos(rawPos);
      if (lineCoords && Number.isFinite(lineCoords.top) && Number.isFinite(lineCoords.bottom)) {
        // If posAtCoords resolved a position on a DIFFERENT line than the
        // cursor's actual y (the empty area to the left of a line can spill
        // upward into the previous line's range), compare cursor-y to the
        // line's bounds rather than its midpoint — otherwise the midline
        // math compares against the wrong line.
        if (clientY < lineCoords.top) return blockStart;
        if (clientY > lineCoords.bottom) return blockEnd;
        const lineMid = (lineCoords.top + lineCoords.bottom) / 2;
        return clientY < lineMid ? blockStart : blockEnd;
      }
    } catch (_) { /* fall through */ }

    if (blockDom) {
      const rect = blockDom.getBoundingClientRect();
      const mid = (rect.top + rect.bottom) / 2;
      return clientY < mid ? blockStart : blockEnd;
    }
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

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let lastNativeEvent = null;
    const onDragOver = (e) => { lastNativeEvent = e; };
    el.addEventListener("dragover", onDragOver);

    const cleanup = dropTargetForElements({
      element: el,
      getData: () => ({ type: "doc-editor" }),
      canDrop: ({ source }) => {
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
        return type === "instance" || type === "field" || type === "container" || type === "artifact" || type === "module";
      },
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => setIsDropTarget(false),
      onDrop: ({ source, location }) => {
        setIsDropTarget(false);
        if (source.data?.fromDoc) return;
        const sd = source.data || {};
        const { type, id, data, context } = sd;
        // Prefer Pragmatic DnD's own coordinates (exact drop point) over lastNativeEvent
        const dropInput = location?.current?.input;

        // Don't handle drops that landed inside a nested instanceTextblock sub-editor.
        // The sub-editor has its own dropTargetForElements and handles insertion itself.
        // Guard: only skip when the textblock is a DESCENDANT of this editor's wrapper (el).
        // Without el.contains() check, the inner sub-editor's own onDrop would also return
        // early (because it too is inside .instance-textblock-block), silently swallowing drops.
        if (dropInput?.clientX != null && dropInput?.clientY != null) {
          const dropEl = document.elementFromPoint(dropInput.clientX, dropInput.clientY);
          const textblock = dropEl?.closest('.instance-textblock-block');
          if (textblock && el.contains(textblock)) return;
        }

        const isBlockDrop = type !== "field";
        const insertPos = resolveInsertPos(dropInput || lastNativeEvent, isBlockDrop);

        // A textblock dragged from a list container (TextblockCard wrapped by
        // ModuleInstance) ships with `type: "instance"` because the drag
        // happens through ModuleInstance.useDragDrop. Without this reroute it
        // would hit the type==="instance" branch below, insert a moduleEmbed,
        // and ModuleEmbedNode's render fallback would draw a textblock module
        // as `<Container>` — the "becomes a container with text" bug. Force
        // the type into the module branch so `sourceRoleStr === "textblock"`
        // hits and an `instanceTextblock` node is inserted instead.
        const sourceRole = sd.role || data?.role || sd.data?.role;
        const effectiveType = (type === "instance" && sourceRole === "textblock")
          ? "module"
          : type;

        if (effectiveType === "instance") {
          // Instance drops → insert as embed directly; convert to pill via radial menu on the node
          const occsById = occurrencesByIdRef.current || {};
          let occurrenceId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
          if (!occurrenceId && id) {
            const existing = Object.values(occsById).find(o => o.moduleId === id);
            if (existing) occurrenceId = existing.id;
          }
          if (!occurrenceId) return;

          const dragMode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? "move";
          const sourceOcc = occsById[occurrenceId];

          if (dragMode === "copy") {
            // Copy: create a fresh occurrence for the embed — original stays in its container
            const newOccId = crypto.randomUUID();
            CommitHelpers.createOccurrence({
              dispatch: dispatchRef.current, socket: socketRef.current,
              occurrence: {
                id: newOccId,
                moduleId: sourceOcc?.moduleId || id,
                gridId: sourceOcc?.gridId,
                occurrences: [],
                fields: sourceOcc?.fields || {},
                meta: sourceOcc?.meta || {},
                dragMode: sourceOcc?.dragMode ?? null,
              },
              emit: true,
            });
            insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId: newOccId } });
          } else {
            // Move: same-doc rearrange = atomic node move (no delete +
            // recreate). If the source isn't in this editor, fall back to
            // the cross-doc path: registry-delete source TipTap node /
            // detach from container, then insert a new moduleEmbed node.
            if (insertPos == null) return;
            const moved = tryMoveEmbedNodeInDoc(editor, "moduleEmbed", { occurrenceId }, insertPos);
            if (moved) return;
            // Insert destination FIRST. Only detach source on confirmed commit
            // so a silent failure (invalid pos, stale editor) can't orphan the
            // occurrence.
            const inserted = insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId } });
            if (!inserted) return;
            if (context?.sourceType === "doc-embed") {
              embedDeleteRegistry.get(occurrenceId)?.();
            } else if (sourceOcc) {
              const parentOcc = Object.values(occsById).find(
                occ => Array.isArray(occ.occurrences) && occ.occurrences.includes(occurrenceId)
              );
              if (parentOcc) {
                CommitHelpers.updateOccurrence({
                  dispatch: dispatchRef.current, socket: socketRef.current,
                  occurrence: {
                    id: parentOcc.id,
                    occurrences: (parentOcc.occurrences || []).filter(eid => eid !== occurrenceId),
                  },
                  emit: true,
                });
              }
            }
          }
          return;
        }
        if (effectiveType === "container" || effectiveType === "artifact" || effectiveType === "module") {
          // occurrenceId can be in context (DragProvider items), in data, or at root level (doc pills, tree items)
          let occurrenceId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
          // CC drops have no occurrenceId — find an existing occurrence of this module
          if (!occurrenceId && id) {
            const existing = Object.values(occurrencesByIdRef.current || {}).find(o => o.moduleId === id);
            if (existing) occurrenceId = existing.id;
          }
          if (!occurrenceId) return;

          // ── TEXTBLOCK BRANCH ─────────────────────────────────────────
          // Source is a textblock. The same `instanceTextblock` node should
          // *move* — we do not delete + recreate. The TipTap node and its
          // occurrence are the same entity regardless of position.
          //
          // Same-doc rearrange:    atomic single-transaction move (delete +
          //                        insert in one tr, position-adjusted).
          // Cross-doc / from CC:   delete source node via the registry,
          //                        insert a node referencing the same
          //                        occurrenceId in the new doc.
          // Copy mode:             clone the occurrence (textmap + fields),
          //                        insert a node pointing at the new occ;
          //                        leave the source untouched.
          const sourceRoleStr = sd.role || data?.role;
          if (sourceRoleStr === "textblock") {
            if (insertPos == null) return;
            const occsById = occurrencesByIdRef.current || {};
            const dragModeTb = data?.defaultDragMode ?? data?.occurrence?.dragMode ?? "move";

            // Same-doc rearrange = atomic move via shared helper. Falls
            // through (returns false) when the source lives in a different
            // doc, which the cross-doc branch below handles.
            if (dragModeTb !== "copy") {
              const moved = tryMoveEmbedNodeInDoc(editor, "instanceTextblock", { occurrenceId }, insertPos);
              if (moved) return;
            }

            if (dragModeTb === "copy") {
              const sourceOccTb = occsById[occurrenceId];
              const newOccId = crypto.randomUUID();
              CommitHelpers.createOccurrence({
                dispatch: dispatchRef.current, socket: socketRef.current,
                occurrence: {
                  id: newOccId,
                  moduleId: sourceOccTb?.moduleId || id,
                  gridId: sourceOccTb?.gridId,
                  fields: sourceOccTb?.fields || {},
                  textmap: sourceOccTb?.textmap || null,
                  dragMode: sourceOccTb?.dragMode ?? null,
                },
                emit: true,
              });
              insertAtPos(insertPos, {
                type: "instanceTextblock",
                attrs: { instanceId: id, occurrenceId: newOccId },
              });
              return;
            }

            // Cross-doc move: insert destination first, only detach source on
            // confirmed commit so a silent failure can't orphan the occurrence.
            const insertedTb = insertAtPos(insertPos, {
              type: "instanceTextblock",
              attrs: { instanceId: id, occurrenceId },
            });
            if (!insertedTb) return;
            if (context?.sourceType === "doc-embed") {
              embedDeleteRegistry.get(occurrenceId)?.();
            } else {
              const parentOcc = Object.values(occsById).find(
                occ => Array.isArray(occ.occurrences) && occ.occurrences.includes(occurrenceId)
              );
              if (parentOcc) {
                CommitHelpers.updateOccurrence({
                  dispatch: dispatchRef.current, socket: socketRef.current,
                  occurrence: { id: parentOcc.id, occurrences: (parentOcc.occurrences || []).filter(eid => eid !== occurrenceId) },
                  emit: true,
                });
              }
            }
            return;
          }
          // ─────────────────────────────────────────────────────────────

          const dragMode = data?.defaultDragMode ?? data?.occurrence?.dragMode ?? "move";
          if (dragMode === "copy") {
            // Deep copy: recursively clone the container and all children so that
            // deleting a child from the embed doesn't affect the original.
            const occsById = occurrencesByIdRef.current || {};
            const deepCopyOcc = (occ) => {
              if (!occ) return null;
              const childIds = [];
              for (const childOccId of (occ.occurrences || [])) {
                const childOcc = occsById[childOccId];
                if (!childOcc) continue;
                const newChildId = deepCopyOcc(childOcc);
                if (newChildId) childIds.push(newChildId);
              }
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
            const sourceOcc = occsById[occurrenceId];
            const copyRootId = deepCopyOcc(sourceOcc);
            if (!copyRootId) return;
            insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId: copyRootId } });
            return;
          }

          // Move mode: same-doc rearrange = atomic node move via the
          // shared helper. If the source isn't in this doc, fall back to
          // the cross-target removal paths below.
          if (insertPos == null) return;
          if (tryMoveEmbedNodeInDoc(editor, "moduleEmbed", { occurrenceId }, insertPos)) return;
          // Insert destination FIRST so a silent failure can't orphan the source.
          const insertedC = insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId } });
          if (!insertedC) return;
          if (context?.sourceType === "doc-embed") {
            embedDeleteRegistry.get(occurrenceId)?.();
          } else if (context?.pageOccurrenceId) {
            const pageOcc = occurrencesByIdRef.current?.[context.pageOccurrenceId];
            if (pageOcc) {
              CommitHelpers.updateOccurrence({
                dispatch: dispatchRef.current, socket: socketRef.current,
                occurrence: { id: pageOcc.id, occurrences: (pageOcc.occurrences || []).filter(eid => eid !== occurrenceId) },
                emit: true,
              });
            }
          } else if (context?.panelId) {
            const panelOcc = Object.values(occurrencesByIdRef.current || {}).find(o => o.moduleId === context.panelId);
            if (panelOcc) {
              CommitHelpers.updateOccurrence({
                dispatch: dispatchRef.current, socket: socketRef.current,
                occurrence: { id: panelOcc.id, occurrences: (panelOcc.occurrences || []).filter(eid => eid !== occurrenceId) },
                emit: true,
              });
            }
          }
          return;
        }
        if (type === "field") {
          const field = data || {};
          insertAtPos(insertPos, {
            type: "fieldPill",
            attrs: { fieldId: id || field.id, fieldName: field.name || "Field", fieldType: field.type || "text", showValue: true, showLabel: true },
          });
        }
      },
    });

    return () => {
      el.removeEventListener("dragover", onDragOver);
      cleanup();
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

    // File drops
    const files = dt.files;
    if (files?.length) {
      e.preventDefault(); e.stopPropagation();
      for (const file of files) {
        const module = await CommitHelpers.uploadFile({ dispatch, file, gridId: null, userId: null });
        if (!module) continue;
        if (file.type.startsWith("image/") && module.fileRef) {
          editor.chain().focus().setImage({ src: `/uploads/${module.fileRef}`, alt: module.label || file.name }).run();
          editor.chain().insertContent({ type: "paragraph" }).run();
        } else {
          editor.chain().focus().insertContent({
            type: "instancePill",
            attrs: { instanceId: module.id, instanceLabel: module.label || file.name },
          }).insertContent(" ").run();
        }
      }
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
      module: { id: newId, label, role: "instance", kind: "list", meta: url ? { url } : {} },
      emit: true,
    });
    editor.chain().focus().insertContent({
      type: "instancePill",
      attrs: { instanceId: newId, instanceLabel: label, showIcon: true },
    }).insertContent(" ").run();
  }, [editor, dispatch, socket]);

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
        const occ = occurrencesById?.[itemId];
        const inst = instancesById[occ?.moduleId || itemId];
        if (!inst) return null;
        return { type: "listItem", content: [{ type: "paragraph", content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label || inst.id, occurrenceId: occ?.id || null, containerId: container.id, showIcon: true } }] }] };
      }).filter(Boolean);
      if (listItems.length > 0) nodes.push({ type: "bulletList", content: listItems });
    }
    editor.chain().focus().insertContent(nodes).run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor, deleteAtTrigger, instancesById, occurrencesById]);

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
    const occs = occurrencesById ? Object.values(occurrencesById) : [];
    return occs.filter(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.role === "container" && mod?.label;
    }).filter(occ => {
      if (!embedQuery) return true;
      const mod = modulesById?.[occ.moduleId];
      return mod?.label?.toLowerCase().includes(embedQuery.toLowerCase());
    }).slice(0, 12);
  }, [occurrencesById, modulesById, embedQuery]);

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
        onMouseDown={(e) => {
          // Block content sync briefly so ProseMirror's cursor placement on mousedown
          // isn't overwritten by a server echo arriving before the focus event fires.
          recentMousedownRef.current = true;
          setTimeout(() => { recentMousedownRef.current = false; }, 300);

          // Fix cursor placement for editors nested inside contenteditable="false"
          // (e.g. textblock sub-editors). The browser can't resolve click position
          // across contenteditable boundaries, so it defaults to offset 0 (beginning).
          // We compute the correct position from click coords and set it explicitly.
          if (editor && editor.isEditable && e.target !== e.currentTarget) {
            const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (coords) {
              requestAnimationFrame(() => {
                try { editor.commands.setTextSelection(coords.pos); } catch (_) {}
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
          editor.commands.focus('end');
        }}
      >
        <CellEmbedContext.Provider value={{ displayFieldId, fieldFilter }}>
          <EditorContent editor={editor} />
        </CellEmbedContext.Provider>
      </div>

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
