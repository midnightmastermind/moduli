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

/**
 * Convert TipTap JSON content to Markdown string
 */
function tiptapToMarkdown(node, depth = 0) {
  if (!node) return "";

  const children = (node.content || []).map(c => tiptapToMarkdown(c, depth)).join("");

  switch (node.type) {
    case "doc": return children;
    case "paragraph": return children ? children + "\n\n" : "\n";
    case "heading": {
      const level = node.attrs?.level || 1;
      return "#".repeat(level) + " " + children.replace(/\n+$/, "") + "\n\n";
    }
    case "bulletList": return children;
    case "orderedList": return children;
    case "listItem": {
      const indent = "  ".repeat(depth);
      const prefix = depth === 0 ? "- " : "  - ";
      return indent + prefix + children.replace(/\n\n$/, "\n");
    }
    case "blockquote": return children.split("\n").map(l => l ? "> " + l : ">").join("\n") + "\n\n";
    case "codeBlock": return "```\n" + children + "\n```\n\n";
    case "horizontalRule": return "---\n\n";
    case "hardBreak": return "\n";
    case "text": {
      let t = node.text || "";
      const marks = node.marks || [];
      for (const mark of marks) {
        if (mark.type === "bold") t = `**${t}**`;
        else if (mark.type === "italic") t = `*${t}*`;
        else if (mark.type === "strike") t = `~~${t}~~`;
        else if (mark.type === "code") t = `\`${t}\``;
      }
      return t;
    }
    case "table": {
      const rows = node.content || [];
      return rows.map((row, ri) => {
        const cells = (row.content || []).map(cell => {
          const cellText = (cell.content || []).map(p => tiptapToMarkdown(p)).join("").replace(/\n+/g, " ").trim();
          return ` ${cellText} `;
        });
        const line = "|" + cells.join("|") + "|";
        if (ri === 0) {
          const sep = "|" + cells.map(() => " --- ").join("|") + "|";
          return line + "\n" + sep;
        }
        return line;
      }).join("\n") + "\n\n";
    }
    case "tableRow":
    case "tableCell":
    case "tableHeader":
      return children;
    case "fieldPill": return `#${node.attrs?.fieldName || node.attrs?.fieldId || "field"}`;
    case "instancePill": return node.attrs?.instanceLabel || node.attrs?.instanceId || "";
    default: return children;
  }
}

/**
 * DocToolbar - Formatting toolbar for Tiptap editor
 *
 * Props:
 * - editor: Tiptap editor instance
 */
export default function DocToolbar({ editor }) {
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
        onClick={() => {
          // Convert selected text to an instance pill
          const { from, to, empty } = editor.state.selection;
          if (empty) return;
          const selectedText = editor.state.doc.textBetween(from, to);
          if (!selectedText.trim()) return;

          const pillId = crypto.randomUUID();
          editor.chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent({
              type: "instancePill",
              attrs: {
                instanceId: pillId,
                instanceLabel: selectedText,
                showIcon: false,
              },
            })
            .run();
        }}
        title="Convert selection to pill"
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
