// docs/suggestions/DocLinkSuggestion.jsx
// ============================================================
// Popup for [[ document link suggestions
// Shows available documents and day pages to link to
// ============================================================

import { useState, useEffect, useRef, useMemo, useContext, useCallback } from "react";
import { FileText, Calendar, Search } from "lucide-react";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";

/**
 * DocLinkSuggestion - Popup for [[ document link suggestions
 *
 * Props:
 * - query: Current search query (text after [[)
 * - position: { top, left } for popup positioning
 * - onSelect: Callback when document is selected
 * - onClose: Callback to close the popup
 */
export default function DocLinkSuggestion({
  query = "",
  position = { top: 0, left: 0 },
  onSelect,
  onClose,
}) {
  const { containersById = {}, occurrencesById = {}, viewsById = {} } = useGridActions() || {};
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef(null);

  const docContainers = useMemo(() => {
    return Object.values(containersById).filter((c) => {
      if (!c) return false;
      const occ = Object.values(occurrencesById).find(o => o?.moduleId === c.id);
      return occ?.viewId ? viewsById[occ.viewId]?.viewType === "doc" : false;
    });
  }, [containersById, occurrencesById, viewsById]);

  // Generate recent day pages
  const dayPages = useMemo(() => {
    const pages = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      pages.push({
        id: `day-${dateStr}`,
        label: i === 0 ? "Today" : i === 1 ? "Yesterday" : dateStr,
        dateStr,
        type: "dayPage",
      });
    }
    return pages;
  }, []);

  // Combine and filter based on query
  const suggestions = useMemo(() => {
    const containers = docContainers.map((c) => ({ id: c.id, label: c.label || "Untitled", type: "doc" }));
    const all = [...dayPages, ...containers];

    if (!query) return all;

    const q = query.toLowerCase();
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.dateStr && item.dateStr.includes(q))
    );
  }, [docContainers, dayPages, query]);

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

  // Handle selection
  const handleSelect = useCallback(
    (item) => {
      onSelect?.({
        targetId: item.id,
        label: item.label,
        linkType: item.type,
      });
    },
    [onSelect]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (suggestions[selectedIndex]) {
            handleSelect(suggestions[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose?.();
          break;
        case "]":
          // If user types ]], close and create link with current query as label
          if (query) {
            e.preventDefault();
            onSelect?.({
              targetId: null,
              label: query,
              linkType: "doc",
            });
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [suggestions, selectedIndex, handleSelect, onClose, onSelect, query]);

  if (suggestions.length === 0 && !query) {
    return (
      <div
        className="doc-link-suggestion absolute bg-popover border border-border rounded-lg shadow-lg p-2 z-50"
        style={{ top: position.top, left: position.left, minWidth: 200 }}
      >
        <p className="text-sm text-muted-foreground p-2">No documents found</p>
      </div>
    );
  }

  return (
    <div
      className="doc-link-suggestion absolute bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
      style={{ top: position.top, left: position.left, minWidth: 240, maxHeight: 280 }}
    >
      {/* Search header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {query ? `[[${query}` : "Link to document..."}
        </span>
      </div>

      {/* Suggestions list */}
      <div ref={listRef} className="overflow-y-auto max-h-[200px]">
        {suggestions.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            <p>No matches. Press <kbd className="px-1 bg-muted rounded">]]</kbd> to create link to "{query}"</p>
          </div>
        ) : (
          suggestions.map((item, index) => {
            const isSelected = index === selectedIndex;
            const Icon = item.type === "dayPage" ? Calendar : FileText;

            return (
              <div
                key={item.id}
                data-index={index}
                onClick={() => handleSelect(item)}
                className={`
                  flex items-center gap-2 px-3 py-2 cursor-pointer
                  transition-colors
                  ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}
                `}
              >
                <Icon className={`w-4 h-4 ${item.type === "dayPage" ? "text-amber-500" : "text-blue-400"}`} />
                <span className="text-sm truncate">{item.label}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-border text-xs text-muted-foreground flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↵</kbd>
        <span>select</span>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">]]</kbd>
        <span>create</span>
      </div>
    </div>
  );
}
