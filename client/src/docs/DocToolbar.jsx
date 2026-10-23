// docs/DocToolbar.jsx
// ============================================================
// Formatting toolbar for DocEditor
// Provides buttons for text formatting, headings, lists, etc.
// ============================================================

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Undo,
  Redo,
  Pill,
  Unlink,
  Download,
} from "lucide-react";
import { tiptapToMarkdown } from "../helpers/exportMarkdown";

/**
 * DocToolbar - Formatting toolbar for Tiptap editor
 *
 * Props:
 * - editor: Tiptap editor instance
 */
export default function DocToolbar({ editor, onMakeInlineTextblock = null }) {
  if (!editor) return null;

  const ToolbarButton = ({ onClick, isActive, children, title }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      className={`
        h-7 w-7 p-0
        ${isActive ? "bg-accent text-accent-foreground" : ""}
      `}
    >
      {children}
    </Button>
  );

  const Separator = () => (
    <div className="w-px h-5 bg-border mx-1" />
  );

  return (
    <div className="doc-toolbar flex items-center gap-0.5 px-2 py-1 border-b border-border bg-background flex-wrap sticky top-0 z-10">
      {/* Text Formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="Inline Code"
      >
        <Code className="w-4 h-4" />
      </ToolbarButton>

      <Separator />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>

      <Separator />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        <Minus className="w-4 h-4" />
      </ToolbarButton>

      <Separator />

      {/* Undo/Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Ctrl+Z)"
      >
        <Undo className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (Ctrl+Y)"
      >
        <Redo className="w-4 h-4" />
      </ToolbarButton>

      {/* Field Insert Button */}
      <Separator />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // Trigger @ suggestion programmatically
          editor.chain().focus().insertContent("@").run();
        }}
        title="Insert Field (@)"
        className="h-7 px-2 text-xs"
      >
        @ Field
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={!onMakeInlineTextblock}
        onClick={() => {
          // The selection becomes a MINI TEXTBLOCK — a real occurrence whose body
          // is the text. It used to mint an instancePill with no module behind
          // it, its stored label its only content (2026-10-03).
          const { from, to, empty } = editor.state.selection;
          if (empty || !onMakeInlineTextblock) return;
          onMakeInlineTextblock(from, to, editor.state.doc.textBetween(from, to));
        }}
        title="Make the selection an inline textblock"
        className="h-7 px-2 text-xs"
      >
        <Pill className="w-3 h-3 mr-1" /> Pill
      </Button>

      {/* Pill → Text conversion */}
      {(() => {
        const { selection, doc } = editor.state;
        const node = doc.nodeAt(selection.from);
        const isOnPill = node?.type?.name === "fieldPill" || node?.type?.name === "instancePill";
        if (!isOnPill) return null;

        const handleConvert = () => {
          const n = doc.nodeAt(selection.from);
          if (!n) return;
          let text = "";
          if (n.type.name === "fieldPill") {
            text = `#${n.attrs.fieldName || n.attrs.fieldId || "field"}`;
          } else if (n.type.name === "instancePill") {
            text = n.attrs.instanceLabel || n.attrs.instanceId || "instance";
          }
          editor.chain()
            .focus()
            .deleteRange({ from: selection.from, to: selection.from + n.nodeSize })
            .insertContent(text)
            .run();
        };

        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleConvert}
            title="Convert pill to plain text"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Unlink className="w-3 h-3 mr-1" /> Unlink
          </Button>
        );
      })()}

      {/* Export to Markdown */}
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const json = editor.getJSON();
          const md = tiptapToMarkdown(json).trim();
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "document.md";
          a.click();
          URL.revokeObjectURL(url);
        }}
        title="Export as Markdown"
        className="h-7 px-2 text-xs"
      >
        <Download className="w-3 h-3 mr-1" /> MD
      </Button>
    </div>
  );
}
