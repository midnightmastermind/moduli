// docs/suggestions/CommandPalette.jsx
// ============================================================
// Searchable command palette popup triggered by /
// Shows markdown formatting, field insertion, and other commands
// ============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Search,
  Heading1, Heading2, Heading3,
  Bold, Italic, Strikethrough, Code,
  List, ListOrdered, ListChecks,
  Quote, Code2, Minus, Table as TableIcon,
  Box, Hash, Link2, FileText,
  Calendar, Clock, Superscript,
} from "lucide-react";

// Command categories and items. Icons are Lucide components for visual
// parity with the rest of the app (ModulePanel headers, ManifestTree,
// QuickAddMenu); renderer below detects component-vs-string.
const COMMANDS = [
  // Headings
  { id: "h1", label: "Heading 1", shortcut: "# ", category: "Formatting", icon: Heading1, action: "heading", level: 1 },
  { id: "h2", label: "Heading 2", shortcut: "## ", category: "Formatting", icon: Heading2, action: "heading", level: 2 },
  { id: "h3", label: "Heading 3", shortcut: "### ", category: "Formatting", icon: Heading3, action: "heading", level: 3 },

  // Text formatting
  { id: "bold", label: "Bold", shortcut: "**text**", category: "Formatting", icon: Bold, action: "bold" },
  { id: "italic", label: "Italic", shortcut: "*text*", category: "Formatting", icon: Italic, action: "italic" },
  { id: "strike", label: "Strikethrough", shortcut: "~~text~~", category: "Formatting", icon: Strikethrough, action: "strike" },
  { id: "code", label: "Inline Code", shortcut: "`code`", category: "Formatting", icon: Code, action: "code" },

  // Lists
  { id: "bullet", label: "Bullet List", shortcut: "- ", category: "Lists", icon: List, action: "bulletList" },
  { id: "numbered", label: "Numbered List", shortcut: "1. ", category: "Lists", icon: ListOrdered, action: "orderedList" },
  { id: "todo", label: "Task List", shortcut: "[ ] ", category: "Lists", icon: ListChecks, action: "taskList" },

  // Blocks
  { id: "quote", label: "Blockquote", shortcut: "> ", category: "Blocks", icon: Quote, action: "blockquote" },
  { id: "codeblock", label: "Code Block", shortcut: "```", category: "Blocks", icon: Code2, action: "codeBlock" },
  { id: "divider", label: "Divider", shortcut: "---", category: "Blocks", icon: Minus, action: "horizontalRule" },
  { id: "table", label: "Table", shortcut: "", category: "Blocks", icon: TableIcon, action: "insertTable" },
  { id: "embed", label: "Embed Container", shortcut: "@:", category: "Insert", icon: Box, action: "embedContainer" },

  // Insert
  { id: "field", label: "Insert Field", shortcut: "@", category: "Insert", icon: Hash, action: "field" },
  { id: "link", label: "Insert Link", shortcut: "[text](url)", category: "Insert", icon: Link2, action: "link" },
  { id: "doclink", label: "Link to Document", shortcut: "[[doc]]", category: "Insert", icon: FileText, action: "docLink" },
  { id: "footnote", label: "Footnote", shortcut: "[^N]", category: "Insert", icon: Superscript, action: "footnote" },

  // Special
  { id: "today", label: "Today's Date", shortcut: "", category: "Insert", icon: Calendar, action: "insertDate" },
  { id: "time", label: "Current Time", shortcut: "", category: "Insert", icon: Clock, action: "insertTime" },
];

const renderCmdIcon = (icon) => {
  if (!icon) return null;

  // if icon is a React component (function or forwardRef object), render it as an element
  if (typeof icon === "function" || typeof icon === "object") {
    const Icon = icon;
    return <Icon className="w-4 h-4" />;
  }

  // otherwise treat as text (emoji/string)
  return String(icon);
};

/**
 * CommandPalette - Popup for / command suggestions
 *
 * Props:
 * - query: Current search query (text after /)
 * - position: { top, left } for popup positioning
 * - onSelect: Callback when command is selected
 * - onClose: Callback to close the palette
 * - editor: Tiptap editor instance for applying commands
 */
export default function CommandPalette({
  query = "",
  position = { top: 0, left: 0 },
  onSelect,
  onClose,
  editor,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query) return COMMANDS;
    const q = query.toLowerCase();
    return COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        (cmd.shortcut || "").toLowerCase().includes(q)
    );
  }, [query]);

  // Group by category
  const groupedCommands = useMemo(() => {
    const groups = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // Flatten for keyboard navigation
  const flatCommands = useMemo(() => {
    return Object.values(groupedCommands).flat();
  }, [groupedCommands]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keep selected item in view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Execute command
  const deleteSlashQuery = useCallback(() => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 50), from);
    const slashIndex = textBefore.lastIndexOf("/");
    if (slashIndex >= 0) {
      const deleteFrom = from - (textBefore.length - slashIndex);
      editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
  }, [editor]);

  const executeCommand = useCallback(
    (cmd) => {
      if (!editor) return;

      deleteSlashQuery();

      // Apply the command
      switch (cmd.action) {
        case "heading":
          editor.chain().focus().toggleHeading({ level: cmd.level }).run();
          break;
        case "bold":
          editor.chain().focus().toggleBold().run();
          break;
        case "italic":
          editor.chain().focus().toggleItalic().run();
          break;
        case "strike":
          editor.chain().focus().toggleStrike().run();
          break;
        case "code":
          editor.chain().focus().toggleCode().run();
          break;
        case "bulletList":
          editor.chain().focus().toggleBulletList().run();
          break;
        case "orderedList":
          editor.chain().focus().toggleOrderedList().run();
          break;
        case "taskList":
          editor.chain().focus().toggleTaskList().run();
          break;
        case "blockquote":
          editor.chain().focus().toggleBlockquote().run();
          break;
        case "codeBlock":
          editor.chain().focus().toggleCodeBlock().run();
          break;
        case "horizontalRule":
          editor.chain().focus().setHorizontalRule().run();
          break;
        case "field":
          // Trigger @ mention
          editor.chain().focus().insertContent("@").run();
          break;
        case "link":
          const url = prompt("Enter URL:");
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
          break;
        case "docLink":
          editor.chain().focus().insertContent("[[").run();
          break;
        case "insertTable":
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "embedContainer":
          // Insert @: to trigger the embed picker
          editor.chain().focus().insertContent("@:").run();
          break;
        case "footnote":
          // Insert an empty footnote marker; node view auto-numbers by
          // doc position and opens the inline editor on click.
          editor.chain().focus().insertFootnote({ text: "" }).run();
          break;
        case "insertDate": {
          // Local-tz YYYY-MM-DD — same format used by the filter system
          // (date fields, $today, etc.) so inserted dates round-trip
          // cleanly through pickers and field comparators.
          const d = new Date();
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          editor.chain().focus().insertContent(iso).run();
          break;
        }
        case "insertTime": {
          // 12-hour AM/PM to match the app's `formatTimeOfDay` convention
          // (Field.jsx Now field). Avoids the locale-default 24-hour
          // output that doesn't match what users see elsewhere.
          const d = new Date();
          const h24 = d.getHours();
          const ampm = h24 >= 12 ? "PM" : "AM";
          const h12 = h24 % 12 || 12;
          const mm = String(d.getMinutes()).padStart(2, "0");
          editor.chain().focus().insertContent(`${h12}:${mm} ${ampm}`).run();
          break;
        }
        default:
          break;
      }

      onSelect?.(cmd);
      onClose?.();
    },
    [editor, onSelect, onClose, deleteSlashQuery]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatCommands[selectedIndex]) {
            executeCommand(flatCommands[selectedIndex]);
          } else {
            deleteSlashQuery(); // clean up the / + query before closing
            onClose?.();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose?.();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flatCommands, selectedIndex, executeCommand, onClose]);

  if (flatCommands.length === 0) {
    return (
      <div
        className="command-palette absolute bg-popover border border-border rounded-lg shadow-lg p-2 z-50"
        style={{ top: position.top, left: position.left, minWidth: 200 }}
      >
        <p className="text-sm text-muted-foreground p-2">No commands found</p>
      </div>
    );
  }

  let itemIndex = 0;

  return (
    <div
      className="command-palette absolute bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
      style={{ top: position.top, left: position.left, minWidth: 280, maxHeight: 320 }}
    >
      {/* Search header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {query ? `/${query}` : "Type to search..."}
        </span>
      </div>

      {/* Command list */}
      <div ref={listRef} className="overflow-y-auto max-h-[260px]">
        {Object.entries(groupedCommands).map(([category, commands]) => (
          <div key={category}>
            {/* Category header */}
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
              {category}
            </div>

            {/* Commands */}
            {commands.map((cmd) => {
              const currentIndex = itemIndex++;
              const isSelected = currentIndex === selectedIndex;

              return (
                <div
                  key={cmd.id}
                  data-index={currentIndex}
                  onClick={() => executeCommand(cmd)}
                  className={`
                    flex items-center gap-3 px-3 py-2 cursor-pointer
                    transition-colors
                    ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}
                  `}
                >
                  {/* Icon */}
                  <span className="w-6 h-6 flex items-center justify-center text-sm font-mono bg-muted rounded">
                    {renderCmdIcon(cmd.icon)}
                  </span>

                  {/* Label and shortcut */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{cmd.label}</div>
                    {cmd.shortcut && (
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {cmd.shortcut}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-border text-xs text-muted-foreground flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
        <span>navigate</span>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↵</kbd>
        <span>select</span>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">esc</kbd>
        <span>close</span>
      </div>
    </div>
  );
}

// Export command list for reference
export { COMMANDS };
