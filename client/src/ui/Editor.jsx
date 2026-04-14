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

import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { FieldPill } from "../docs/FieldPillExtension";
import { InstancePill } from "../docs/InstancePillExtension";
import { DocLink } from "../docs/DocLinkExtension";
import { PillBackspace } from "../docs/PillBackspaceExtension";
import { HeadingFocus } from "../docs/HeadingFocusExtension";
import { ModuleEmbed } from "../docs/ModuleEmbedExtension";
import { InstanceTextblock } from "../docs/InstanceTextblockExtension";
import { ExprPill } from "../docs/ExprPillExtension";
import FieldSuggestion from "../docs/suggestions/FieldSuggestion";
import CommandPalette from "../docs/suggestions/CommandPalette";
import DocLinkSuggestion from "../docs/suggestions/DocLinkSuggestion";
import DocToolbar from "../docs/DocToolbar";
import ContextMenu from "./ContextMenu";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Bold, Italic, Strikethrough, Code, RemoveFormatting, AtSign, List, Box } from "lucide-react";

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
}, ref) {
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


  // Pill/embed choice popup for instance drops
  const [pendingDrop, setPendingDrop] = useState(null); // { occurrenceId, instanceId, label, insertPos, dropX, dropY }

  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  // D11: convert-to-module prompt

  const lastCharRef = useRef("");
  const wrapperRef = useRef(null);
  const saveTimeout = useRef(null);
  const autoCreateTimerRef = useRef(null);

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
      const json = editor.getJSON();
      onChange?.(json);
      persistContent(json, false);
      // Auto-create textblock: first character typed on a previously empty paragraph
      if (onAutoCreateTextblock && transaction.docChanged && !transaction.getMeta("skipAutoCreate")) {
        let handled = false;
        const { from } = editor.state.selection;
        const $pos = editor.state.doc.resolve(from);
        if ($pos.depth === 1) {
          const node = $pos.parent;
          if (node.type.name === "paragraph" && node.textContent.length === 1) {
            // First char typed: schedule creation on next rAF to capture any batched keystrokes
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
            // Still typing — timer already running, will re-read text when it fires
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
      },
      handleKeyDown: (_view, event) => {
        // Enter in textblock — always exit to parent doc (creates new line outside)
        // Shift+Enter stays inside as a hard break (handled naturally by TipTap StarterKit)
        if (event.key === "Enter" && !event.shiftKey && onExitBlock) {
          event.preventDefault();
          onExitBlock();
          return true;
        }
        // Backspace / ArrowLeft at position 0 — navigate back to parent editor.
        if ((event.key === "Backspace" || event.key === "ArrowLeft") && onDeleteBlock) {
          const { from, empty: selEmpty } = _view.state.selection;
          if (from <= 1 && selEmpty) {
            event.preventDefault();
            onDeleteBlock();
            return true;
          }
        }
        // ArrowRight at end of content — exit to next block.
        if (event.key === "ArrowRight" && onExitBlock) {
          const { to, empty: selEmpty } = _view.state.selection;
          if (to >= _view.state.doc.content.size && selEmpty) {
            event.preventDefault();
            onExitBlock();
            return true;
          }
        }
        // ArrowUp at first visual line — navigate back (exit upward).
        if (event.key === "ArrowUp" && onDeleteBlock) {
          if (_view.endOfTextblock("up")) {
            event.preventDefault();
            onDeleteBlock();
            return true;
          }
        }
        // ArrowDown at last visual line — exit to next block (exit downward).
        if (event.key === "ArrowDown" && onExitBlock) {
          if (_view.endOfTextblock("down")) {
            event.preventDefault();
            onExitBlock();
            return true;
          }
        }
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

  // Cleanup autoCreate timer on unmount
  useEffect(() => () => { if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current); }, []);


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
              targetId: modId, targetType: "module",
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
  const resolveInsertPos = useCallback((nativeEvent) => {
    if (!editor?.view || !nativeEvent) return null;
    const { clientX, clientY } = nativeEvent;
    if (clientX == null || clientY == null) return null;
    const pos = editor.view.posAtCoords({ left: clientX, top: clientY });
    return pos ? pos.pos : null;
  }, [editor]);

  const insertAtPos = useCallback((pos, nodeContent) => {
    if (!editor) return;
    // Cancel any pending auto-create — drops should not trigger mini textblock creation
    if (autoCreateTimerRef.current) {
      clearTimeout(autoCreateTimerRef.current);
      autoCreateTimerRef.current = null;
    }
    // Block nodes (moduleEmbed) don't need a trailing space — it creates an empty textblock
    const nodeDef = editor.schema.nodes[nodeContent.type];
    const isBlock = nodeDef?.spec?.group?.includes("block");
    if (pos != null) {
      const chain = editor.chain().focus()
        .command(({ tr }) => { tr.setMeta("skipAutoCreate", true); return true; })
        .insertContentAt(pos, nodeContent);
      if (!isBlock) chain.insertContentAt(pos + 1, " ");
      chain.run();
    } else {
      const chain = editor.chain().focus()
        .command(({ tr }) => { tr.setMeta("skipAutoCreate", true); return true; })
        .insertContent(nodeContent);
      if (!isBlock) chain.insertContent(" ");
      chain.run();
    }
  }, [editor]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let lastNativeEvent = null;
    const onDragOver = (e) => { lastNativeEvent = e; };
    el.addEventListener("dragover", onDragOver);

    const cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const type = source.data?.type;
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
        const insertPos = resolveInsertPos(dropInput || lastNativeEvent);

        if (type === "instance") {
          // Instance drops → show pill vs embed choice popup
          let occurrenceId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
          if (!occurrenceId && id) {
            const existing = Object.values(occurrencesById || {}).find(o => o.targetId === id);
            if (existing) occurrenceId = existing.id;
          }
          if (!occurrenceId) return;
          setPendingDrop({
            occurrenceId, instanceId: id,
            label: data?.label || sd.label || "",
            insertPos,
            dropX: lastNativeEvent?.clientX,
            dropY: lastNativeEvent?.clientY,
          });
          return;
        }
        if (type === "container" || type === "artifact" || type === "module") {
          // occurrenceId can be in context (DragProvider items), in data, or at root level (doc pills, tree items)
          let occurrenceId = context?.occurrenceId || data?.occurrenceId || sd.occurrenceId;
          // CC drops have no occurrenceId — find an existing occurrence of this module
          if (!occurrenceId && id) {
            const existing = Object.values(occurrencesById || {}).find(o => o.targetId === id);
            if (existing) occurrenceId = existing.id;
          }
          if (!occurrenceId) return;

          // Non-instance drops default to moduleEmbed (block embed)
          insertAtPos(insertPos, { type: "moduleEmbed", attrs: { occurrenceId } });
          return;
        }
        if (type === "field") {
          const field = data || {};
          insertAtPos(insertPos, {
            type: "fieldPill",
            attrs: { fieldId: id || field.id, fieldName: field.name || "Field", fieldType: field.type || "text", fieldMode: field.mode || "input", showValue: true, showLabel: true },
          });
        }
      },
    });

    return () => {
      el.removeEventListener("dragover", onDragOver);
      cleanup();
    };
  }, [resolveInsertPos, insertAtPos]);

  // ── native file/text drops ────────────────────────────────────
  const handleFileDrop = useCallback(async (e) => {  // still async for file uploads
    if (!editor) return;
    const dt = e.dataTransfer;
    if (!dt) return;

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
    chain.insertFieldPill({ fieldId: field.id, fieldName: field.name, fieldType: field.type || "text", fieldMode: field.mode || "input", showValue: true, showLabel: true }).run();
    setShowSuggestion(false); setSuggestionQuery("");
  }, [editor]);

  const handleSelectField = useCallback((field) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atIndex = textBefore.lastIndexOf("@");
    const chain = editor.chain().focus();
    if (atIndex >= 0) chain.deleteRange({ from: from - (textBefore.length - atIndex), to: from });
    chain.insertFieldPill({ fieldId: field.id, fieldName: field.name, fieldType: field.type || "text", fieldMode: field.mode || "input", showValue: true, showLabel: false }).run();
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
        const inst = instancesById[occ?.targetId || itemId];
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
      const mod = modulesById?.[occ.targetId];
      return mod?.role === "container" && mod?.label;
    }).filter(occ => {
      if (!embedQuery) return true;
      const mod = modulesById?.[occ.targetId];
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

      {/* Pill / Embed choice popup for instance drops */}
      {pendingDrop && createPortal(
        <div
          style={{
            position: "fixed",
            left: Math.min((pendingDrop.dropX || 0), window.innerWidth - 190),
            top: (pendingDrop.dropY || 0) + 10,
            zIndex: 1200,
            background: "var(--surface-card, #1a1a2e)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            padding: "6px 6px",
            display: "flex",
            gap: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              insertAtPos(pendingDrop.insertPos, {
                type: "instancePill",
                attrs: { instanceId: pendingDrop.instanceId, instanceLabel: pendingDrop.label, occurrenceId: pendingDrop.occurrenceId, pillDisplay: "inline" },
              });
              setPendingDrop(null);
            }}
            style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer", borderRadius: 5, border: "1px solid var(--border-default)", background: "var(--input-bg)", color: "var(--text-primary)" }}
          >Pill</button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              insertAtPos(pendingDrop.insertPos, { type: "moduleEmbed", attrs: { occurrenceId: pendingDrop.occurrenceId } });
              setPendingDrop(null);
            }}
            style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer", borderRadius: 5, border: "1px solid var(--border-default)", background: "var(--input-bg)", color: "var(--text-primary)" }}
          >Embed</button>
          <button
            onMouseDown={(e) => { e.preventDefault(); setPendingDrop(null); }}
            style={{ fontSize: 11, padding: "3px 6px", cursor: "pointer", borderRadius: 5, border: "none", background: "transparent", color: "var(--text-faint)" }}
          >×</button>
        </div>,
        document.body
      )}


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
        <EditorContent editor={editor} />
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
            const mod = modulesById?.[occ.targetId];
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
