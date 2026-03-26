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
import { ExprPill } from "../docs/ExprPillExtension";
import FieldSuggestion from "../docs/suggestions/FieldSuggestion";
import CommandPalette from "../docs/suggestions/CommandPalette";
import DocLinkSuggestion from "../docs/suggestions/DocLinkSuggestion";
import DocToolbar from "../docs/DocToolbar";
import ContextMenu from "./ContextMenu";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Bold, Italic, Strikethrough, Code, RemoveFormatting, AtSign, List, Box, GripVertical } from "lucide-react";

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

  // D12: block handle
  const [blockHandle, setBlockHandle] = useState(null); // { top, nodeStart } or null
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const blockHandleRef = useRef(null);
  const blockHideTimerRef = useRef(null);

  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  // D9: reformat popup — shown when instance/container is dropped
  const [dropReformat, setDropReformat] = useState(null); // { pos, screenPos, type, id, data, context }
  // D11: convert-to-module prompt
  const [convertPrompt, setConvertPrompt] = useState(null); // { text } or null
  const convertTimerRef = useRef(null);
  const initialContentRef = useRef(null);

  const lastCharRef = useRef("");
  const wrapperRef = useRef(null);
  const saveTimeout = useRef(null);

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

  // ── D12: block handle mouse tracking ────────────────────────
  const cancelBlockHide = useCallback(() => {
    if (blockHideTimerRef.current) { clearTimeout(blockHideTimerRef.current); blockHideTimerRef.current = null; }
  }, []);

  const scheduleBlockHide = useCallback(() => {
    blockHideTimerRef.current = setTimeout(() => { setBlockHandle(null); setBlockMenuOpen(false); }, 200);
  }, []);

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
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      onChange?.(json);
      persistContent(json, false);
      // D11: detect newly typed heading/list content → prompt to convert to module
      if (typeof localStorage !== "undefined" && localStorage.getItem("moduli_no_convert_prompt")) return;
      if (initialContentRef.current == null) { initialContentRef.current = JSON.stringify(json); return; }
      if (JSON.stringify(json) === initialContentRef.current) return;
      const nodes = json.content || [];
      const hasStructure = nodes.some(n => n.type === "heading" || n.type === "bulletList" || n.type === "orderedList");
      const text = editor.getText().trim();
      if (hasStructure && text.length > 3) {
        if (convertTimerRef.current) clearTimeout(convertTimerRef.current);
        convertTimerRef.current = setTimeout(() => setConvertPrompt({ text }), 2000);
      } else {
        if (convertTimerRef.current) clearTimeout(convertTimerRef.current);
        setConvertPrompt(null);
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
      attributes: { class: "doc-editor-content prose prose-invert max-w-none focus:outline-none" },
      handleKeyDown: (_view, event) => {
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

  // ── block handle mouse tracking (declared AFTER editor to avoid TDZ) ─
  const handleEditorMouseMove = useCallback((e) => {
    if (!editor || !editable || !wrapperRef.current) return;
    if (blockHandleRef.current?.contains(e.target)) { cancelBlockHide(); return; }

    const result = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!result) { scheduleBlockHide(); return; }

    const $pos = editor.state.doc.resolve(result.pos);
    if ($pos.depth === 0) { scheduleBlockHide(); return; }

    const nodeStart = $pos.before(1);

    let domResult;
    try { domResult = editor.view.domAtPos(nodeStart + 1); } catch { scheduleBlockHide(); return; }
    let domEl = domResult.node;
    if (domEl.nodeType === 3) domEl = domEl.parentElement;

    const proseMirrorEl = wrapperRef.current.querySelector(".ProseMirror");
    if (!proseMirrorEl) return;
    while (domEl && domEl.parentElement !== proseMirrorEl) {
      if (!domEl.parentElement) { scheduleBlockHide(); return; }
      domEl = domEl.parentElement;
    }
    if (!domEl) return;

    cancelBlockHide();
    const wrapRect = wrapperRef.current.getBoundingClientRect();
    const blockRect = domEl.getBoundingClientRect();
    const top = blockRect.top - wrapRect.top;
    setBlockHandle({ top, nodeStart });
  }, [editor, editable, cancelBlockHide, scheduleBlockHide]);

  // ── context menu (declared AFTER editor to avoid TDZ) ────────
  const handleContextMenu = useCallback((e) => {
    if (!editor || !editable) return;
    e.preventDefault(); e.stopPropagation();
    const hasSelection = !editor.state.selection.empty;
    const { $from } = editor.state.selection;
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
      hasSelection && dispatch && socket && {
        label: "Turn into instance",
        icon: Box,
        onClick: () => {
          const { from, to } = editor.state.selection;
          const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
          if (!selectedText) return;
          const newModule = {
            id: crypto.randomUUID(),
            label: selectedText,
            role: "instance",
            kind: "list",
            defaultDragMode: "move",
            occurrences: [],
          };
          CommitHelpers.createModule({ dispatch, socket, module: newModule });
          editor.chain().focus()
            .deleteRange({ from, to })
            .insertContentAt(from, {
              type: "instancePill",
              attrs: { instanceId: newModule.id, instanceLabel: selectedText, showIcon: true },
            })
            .run();
        },
      },
      { label: "Insert field (@)", icon: AtSign, onClick: () => editor.chain().focus().insertContent("@").run() },
    ].filter(Boolean);
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [editor, editable, onConvertListToInstances]);

  // ── sync content prop → editor (when not focused) ────────────
  useEffect(() => {
    if (editor && content && !editor.isFocused) {
      const current = editor.getJSON();
      if (JSON.stringify(current) !== JSON.stringify(content)) {
        editor.commands.setContent(content);
      }
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

  // ── key handling for popup query modes + block menu ─────────
  useEffect(() => {
    if (!showSuggestion && !showCommandPalette && !showDocLink && !showExprSuggestion && !showEmbedPicker && !blockMenuOpen) return;
    const handle = (e) => {
      // Block handle menu — close on Escape or any printable key, then refocus editor
      if (blockMenuOpen) {
        if (e.key === "Escape" || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
          setBlockMenuOpen(false);
          editor?.commands.focus();
        }
        return;
      }
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
  }, [showSuggestion, suggestionQuery, showCommandPalette, commandQuery, showDocLink, docLinkQuery, showExprSuggestion, exprQuery, exprActiveIndex, filteredExprFields, handleSelectExpr, showEmbedPicker, embedQuery, blockMenuOpen, editor]);

  // D12: close block menu on outside click
  useEffect(() => {
    if (!blockMenuOpen) return;
    const handler = (e) => { if (!blockHandleRef.current?.contains(e.target)) setBlockMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [blockMenuOpen]);

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
    if (pos != null) {
      editor.chain().focus().insertContentAt(pos, nodeContent).insertContentAt(pos + 1, " ").run();
    } else {
      editor.chain().focus().insertContent(nodeContent).insertContent(" ").run();
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
        return type === "instance" || type === "field" || type === "container";
      },
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => setIsDropTarget(false),
      onDrop: ({ source }) => {
        setIsDropTarget(false);
        if (source.data?.fromDoc) return;
        const { type, id, data, context } = source.data || {};
        const insertPos = resolveInsertPos(lastNativeEvent);
        const screenPos = lastNativeEvent
          ? { x: lastNativeEvent.clientX, y: lastNativeEvent.clientY }
          : { x: 200, y: 200 };

        if (type === "instance" || type === "container") {
          // D9: show reformat popup instead of immediately inserting
          setDropReformat({ pos: insertPos, screenPos, type, id, data: data || {}, context: context || {} });
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
      onMouseMove={handleEditorMouseMove}
      onMouseLeave={scheduleBlockHide}
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

      {/* D12: Block handle — single grip icon opens block menu */}
      {blockHandle && editable && (
        <div
          ref={blockHandleRef}
          onMouseEnter={cancelBlockHide}
          onMouseLeave={scheduleBlockHide}
          style={{
            position: "absolute",
            top: blockHandle.top,
            left: 5,
            display: "flex",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div style={{ position: "relative" }}>
            <button
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 2px", color: "var(--text-faint)", borderRadius: 3, display: "flex", lineHeight: 1 }}
              onMouseDown={(e) => { e.preventDefault(); setBlockMenuOpen(v => !v); }}
              title="Block options"
            >
              <GripVertical size={15} />
            </button>
            {blockMenuOpen && (
              <div style={{
                position: "absolute", left: "100%", top: 0, zIndex: 400,
                background: "var(--surface-card)", border: "1px solid var(--border-default)",
                borderRadius: 6, padding: "4px 0", minWidth: 150,
                boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
              }}>
                {[
                  { label: "Text", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).setNode("paragraph").run() },
                  { label: "Heading 1", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).setNode("heading", { level: 1 }).run() },
                  { label: "Heading 2", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).setNode("heading", { level: 2 }).run() },
                  { label: "Heading 3", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).setNode("heading", { level: 3 }).run() },
                  { label: "Bullet list", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).toggleBulletList().run() },
                  { label: "Quote", fn: () => editor?.chain().focus().setTextSelection(blockHandle.nodeStart + 1).toggleBlockquote().run() },
                  null,
                  { label: "Insert field", fn: () => {
                    if (!editor || blockHandle == null) return;
                    const node = editor.state.doc.nodeAt(blockHandle.nodeStart);
                    const insertPos = node ? blockHandle.nodeStart + node.nodeSize : blockHandle.nodeStart + 1;
                    editor.commands.setTextSelection(insertPos);
                    setShowSuggestion(true);
                    setSuggestionQuery("");
                    setSuggestionPos({ top: blockHandle.top, left: 40 });
                  }},
                  { label: "Insert module", fn: () => {
                    if (!editor || blockHandle == null) return;
                    // Position cursor at block end, then trigger embed picker
                    const node = editor.state.doc.nodeAt(blockHandle.nodeStart);
                    const insertPos = node ? blockHandle.nodeStart + node.nodeSize : blockHandle.nodeStart + 1;
                    editor.commands.setTextSelection(insertPos);
                    // Show embed picker positioned at block handle
                    const wrap = wrapperRef.current?.getBoundingClientRect();
                    setEmbedPos({ top: blockHandle.top, left: wrap ? 40 : 0 });
                    setShowEmbedPicker(true);
                    setEmbedQuery("");
                  }},
                  null,
                  { label: "Duplicate", fn: () => {
                    if (!editor || blockHandle == null) return;
                    const node = editor.state.doc.nodeAt(blockHandle.nodeStart);
                    if (!node) return;
                    const end = blockHandle.nodeStart + node.nodeSize;
                    editor.chain().focus().insertContentAt(end, node.toJSON()).run();
                  }},
                  { label: "Delete", danger: true, fn: () => {
                    if (!editor || blockHandle == null) return;
                    const node = editor.state.doc.nodeAt(blockHandle.nodeStart);
                    if (!node) return;
                    editor.chain().focus().deleteRange({ from: blockHandle.nodeStart, to: blockHandle.nodeStart + node.nodeSize }).run();
                  }},
                ].map((item, i) => item === null
                  ? <div key={`s${i}`} style={{ height: 1, background: "var(--border-default)", margin: "3px 0" }} />
                  : (
                    <div
                      key={item.label}
                      onMouseDown={(e) => { e.preventDefault(); item.fn(); setBlockMenuOpen(false); setBlockHandle(null); }}
                      style={{ padding: "4px 12px", cursor: "pointer", fontSize: 11, color: item.danger ? "rgba(252,129,129,0.9)" : "var(--text-primary)" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "var(--border-subtle)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {item.label}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isDropTarget && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none z-10 flex items-center justify-center">
          <span className="text-sm text-blue-400 font-medium">Drop to insert</span>
        </div>
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
        className={`doc-editor-wrapper min-h-[100px] py-3 pr-3 pl-8 flex-1${stickyToolbar ? " overflow-auto" : ""}`}
        onClick={() => {
          // D8 removed: no jump-to-end on empty space click
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

      {/* D11: Convert to module prompt */}
      {convertPrompt && (
        <div style={{
          position: "absolute", bottom: 6, left: 8, right: 8, zIndex: 200,
          background: "rgba(26,26,46,0.97)", border: "1px solid rgba(99,179,237,0.3)",
          borderRadius: 6, padding: "6px 10px",
          display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)", fontSize: 11,
        }}>
          <Box size={12} style={{ color: "rgba(99,179,237,0.7)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-primary)", flex: 1 }}>Turn this into a module?</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); onConvertListToInstances?.([convertPrompt.text]); setConvertPrompt(null); if (convertTimerRef.current) clearTimeout(convertTimerRef.current); }}
            style={{ background: "rgba(99,179,237,0.2)", border: "1px solid rgba(99,179,237,0.4)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "rgba(99,179,237,0.9)", fontSize: 10 }}
          >Convert</button>
          <button
            onMouseDown={(e) => { e.preventDefault(); setConvertPrompt(null); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, padding: "2px 4px" }}
          >Not now</button>
          <button
            onMouseDown={(e) => { e.preventDefault(); localStorage.setItem("moduli_no_convert_prompt", "1"); setConvertPrompt(null); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 10, padding: "2px 4px" }}
          >Don't ask again</button>
        </div>
      )}

      {/* D9: Drop reformat popup */}
      {dropReformat && (
        <DropReformatPopup
          dropReformat={dropReformat}
          wrapperRef={wrapperRef}
          onSelect={(node) => {
            insertAtPos(dropReformat.pos, node);
            setDropReformat(null);
          }}
          onDismiss={() => setDropReformat(null)}
        />
      )}
    </div>
  );
});

function DropReformatPopup({ dropReformat, wrapperRef, onSelect, onDismiss }) {
  const { screenPos, type, id, data, context } = dropReformat;
  const wrap = wrapperRef.current?.getBoundingClientRect();
  const left = wrap ? Math.min(screenPos.x - wrap.left, wrap.width - 180) : screenPos.x;
  const top = wrap ? screenPos.y - wrap.top + 8 : screenPos.y + 8;

  const label = data?.label || id || "Item";

  const options = type === "instance"
    ? [
        { key: "pill",  label: "Pill",  node: { type: "instancePill", attrs: { instanceId: id || data.id, instanceLabel: label, occurrenceId: context?.occurrenceId || null, containerId: context?.containerId || null, showIcon: true, pillDisplay: "block" } } },
        { key: "embed", label: "Embed", node: { type: "moduleEmbed",  attrs: { occurrenceId: context?.occurrenceId || null } } },
        { key: "text",  label: "Text",  node: { type: "text", text: label } },
      ]
    : [
        { key: "link",  label: "Link",  node: { type: "docLink", attrs: { targetId: id || data.id, label, linkType: data?.kind === "doc" ? "doc" : "container" } } },
        { key: "embed", label: "Embed", node: { type: "moduleEmbed", attrs: { occurrenceId: context?.occurrenceId || null } } },
        { key: "text",  label: "Text",  node: { type: "text", text: label } },
      ];

  // Dismiss on outside click
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onDismiss]);

  return (
    <div ref={ref} style={{
      position: "absolute", zIndex: 300, top, left,
      background: "var(--surface-card)", border: "1px solid rgba(99,179,237,0.35)",
      borderRadius: 6, padding: "4px 0",
      boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
    }}>
      <div style={{ padding: "3px 10px 3px", fontSize: 9, color: "rgba(99,179,237,0.5)", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid rgba(99,179,237,0.1)", marginBottom: 2 }}>
        Insert as
      </div>
      {options.map(opt => (
        <div
          key={opt.key}
          onMouseDown={(e) => { e.preventDefault(); onSelect(opt.node); }}
          style={{
            padding: "4px 14px", cursor: "pointer", fontSize: 11,
            color: "var(--text-primary)",
            display: "flex", alignItems: "center", gap: 8,
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(99,179,237,0.12)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}

export default Editor;
