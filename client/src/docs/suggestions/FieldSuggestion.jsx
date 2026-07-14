// docs/suggestions/FieldSuggestion.jsx
// ============================================================
// Searchable multiselect popup for @ command in doc editors.
// Shows fields, instances, and containers.
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Copy, Link2 } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";

const PILL_COLORS = {
  field_input: "bg-blue-500",
  field_derived: "bg-purple-500",
  instance: "bg-emerald-500",
  container: "bg-amber-500",
  panel: "bg-orange-600",
};

/**
 * FieldSuggestion - Searchable multiselect for @ command
 *
 * Props:
 * - fields: Array of field objects
 * - query: Current search query
 * - onSelect: (field) => void
 * - onSelectInstance: (instance, mode) => void
 * - onSelectContainer: (container, mode) => void
 * - onClose: () => void
 * - position: { top, left }
 */
export default function FieldSuggestion({
  fields: fieldsProp = [],
  query = "",
  onSelect,
  onSelectInstance,
  onSelectContainer,
  onSelectPanel,
  onClose,
  position = { top: 0, left: 0 },
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [localQuery, setLocalQuery] = useState(query);
  const [activeCategory, setActiveCategory] = useState("all");
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const ctx = useGridActions() || {};
  const { modulesById } = ctx;

  // Build unified items list
  const allItems = useMemo(() => {
    const items = [];

    // Fields — sorted: title/name fields first, then by type, then alphabetical
    const sortedFields = [...(fieldsProp || [])].sort((a, b) => {
      const aIsTitle = /^(title|name|label)$/i.test(a.name || "");
      const bIsTitle = /^(title|name|label)$/i.test(b.name || "");
      if (aIsTitle !== bIsTitle) return aIsTitle ? -1 : 1;
      const typeCompare = (a.type || "").localeCompare(b.type || "");
      if (typeCompare !== 0) return typeCompare;
      return (a.name || "").localeCompare(b.name || "");
    });

    sortedFields.forEach((f) => {
      items.push({
        _category: "field",
        _id: `field:${f.id}`,
        id: f.id,
        name: f.name || f.id,
        subtitle: `${f.type || "text"} · ${f.inputEnabled ? "input" : "display"}`,
        color: f.inputEnabled ? PILL_COLORS.field_input : PILL_COLORS.field_derived,
        icon: f.inputEnabled ? "📊" : "Σ",
        data: f,
      });
    });

    // Modules — split by role
    if (modulesById) {
      Object.values(modulesById).forEach((mod) => {
        if (!mod?.id) return;
        if (mod.role === "panel") {
          items.push({
            _category: "panel",
            _id: `panel:${mod.id}`,
            id: mod.id,
            name: mod.label || mod.id,
            subtitle: `Panel · ${mod.kind || "board"}`,
            color: PILL_COLORS.panel,
            icon: "⬛",
            data: mod,
          });
        } else if (mod.role === "container") {
          items.push({
            _category: "container",
            _id: `container:${mod.id}`,
            id: mod.id,
            name: mod.label || mod.id,
            subtitle: `Container · ${mod.kind || "board"}`,
            color: PILL_COLORS.container,
            icon: "▣",
            data: mod,
          });
        } else if (mod.role === "instance") {
          items.push({
            _category: "instance",
            _id: `instance:${mod.id}`,
            id: mod.id,
            name: mod.label || mod.id,
            subtitle: `Instance · ${(mod.fieldBindings || []).length} fields`,
            color: PILL_COLORS.instance,
            icon: "◆",
            data: mod,
          });
        }
      });
    }

    return items;
  }, [fieldsProp, modulesById]);

  // Filter by query and category
  const filteredItems = useMemo(() => {
    let items = allItems;
    if (activeCategory !== "all") {
      items = items.filter((i) => i._category === activeCategory);
    }
    if (localQuery) {
      const q = localQuery.toLowerCase();
      items = items.filter(
        (i) =>
          i.name?.toLowerCase().includes(q) ||
          i.id?.toLowerCase().includes(q) ||
          i.subtitle?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [allItems, localQuery, activeCategory]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setLocalQuery(query); }, [query]);
  useEffect(() => { setSelectedIndex(0); }, [filteredItems.length]);

  useEffect(() => {
    if (listRef.current && filteredItems.length > 0) {
      const items = listRef.current.querySelectorAll("[data-item]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, filteredItems.length]);

  const handleSelect = useCallback(
    (item, mode = "copy") => {
      if (item._category === "field") {
        onSelect?.(item.data);
      } else if (item._category === "instance") {
        onSelectInstance?.(item.data, mode);
      } else if (item._category === "container") {
        onSelectContainer?.(item.data, mode);
      } else if (item._category === "panel") {
        onSelectPanel?.(item.data);
      }
      onClose?.();
    },
    [onSelect, onSelectInstance, onSelectContainer, onSelectPanel, onClose]
  );

  const handleKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredItems[selectedIndex]) handleSelect(filteredItems[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          onClose?.();
          break;
        case "Tab":
          e.preventDefault();
          if (filteredItems[selectedIndex]) handleSelect(filteredItems[selectedIndex]);
          break;
      }
    },
    [filteredItems, selectedIndex, handleSelect, onClose]
  );

  const categories = [
    { key: "all", label: "All" },
    { key: "field", label: "Fields" },
    { key: "panel", label: "Panels" },
    { key: "container", label: "Containers" },
    { key: "instance", label: "Instances" },
  ];

  return (
    <div
      className="field-suggestion absolute z-50 bg-background border border-border rounded-lg shadow-xl overflow-hidden"
      style={{ top: position.top, left: position.left, minWidth: 300, maxWidth: 380 }}
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={localQuery}
          onChange={(e) => { setLocalQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search fields, instances, containers..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">{filteredItems.length}</span>
      </div>

      {/* Category tabs */}
      <div className="flex gap-0.5 px-2 py-1 border-b border-border bg-muted/20">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => { setActiveCategory(cat.key); setSelectedIndex(0); }}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              activeCategory === cat.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div ref={listRef} className="max-h-60 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">No results found</div>
        ) : (
          filteredItems.map((item, index) => (
            <div
              key={item._id}
              data-item
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-75 ${
                index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              {/* Icon */}
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${item.color} text-white shrink-0`}>
                {item.icon}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0" onClick={() => handleSelect(item, "copy")}>
                <div className="text-sm font-medium truncate">{item.name}</div>
                <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
              </div>

              {/* Insert / Link buttons */}
              {(item._category === "instance" || item._category === "container" || item._category === "panel") && (
                <div className="flex gap-0.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSelect(item, "copy"); }}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title="Insert link"
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                  {item._category !== "panel" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSelect(item, "copylink"); }}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="Insert linked pill"
                    >
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )}

              {item._category === "field" && index === selectedIndex && (
                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded shrink-0">↵</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-3">
        <span>↑↓ Navigate</span>
        <span>↵ Insert</span>
        <span>Esc Close</span>
      </div>
    </div>
  );
}
