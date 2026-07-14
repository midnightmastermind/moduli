// blocks/BlockPalette.jsx
// ============================================================
// Block Palette - sidebar with draggable block templates
// ============================================================

import React, { useState, useMemo } from "react";
import { getPaletteCategories, createFieldBlocks } from "../helpers/blockTypes";
import { PaletteBlock } from "./Block";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * BlockPalette - Sidebar containing categorized block templates
 *
 * Props:
 * - fields: Array of field definitions to create field blocks
 * - collapsed: boolean - if true, show only icons
 * - onBlockDragStart: (block) => void
 */
export default function BlockPalette({
  fields = [],
  collapsed = false,
  onBlockDragStart,
}) {
  const [expandedCategories, setExpandedCategories] = useState({
    fields: true,
    values: false,
    math: true,
    aggregations: true,
    logic: false,
    functions: false,
    control: false,
    triggers: false,
  });

  // Create field blocks from available fields
  const fieldBlocks = useMemo(() => createFieldBlocks(fields), [fields]);

  // Get all palette categories with field blocks injected
  const categories = useMemo(() => {
    const cats = getPaletteCategories();

    // Find the fields category and add dynamic field blocks
    const fieldsCategory = cats.find(c => c.id === "fields");
    if (fieldsCategory) {
      fieldsCategory.blocks = fieldBlocks;
    }

    return cats;
  }, [fieldBlocks]);

  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  return (
    <div className={`
      block-palette
      flex flex-col
      h-full overflow-y-auto
      bg-muted/50 border-r border-border
      ${collapsed ? "w-12" : "w-48"}
    `}>
      <div className="p-2 border-b border-border">
        <h3 className={`text-xs font-semibold text-muted-foreground ${collapsed ? "hidden" : ""}`}>
          Blocks
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-1 space-y-1">
        {categories.map(category => (
          <PaletteCategory
            key={category.id}
            category={category}
            expanded={expandedCategories[category.id]}
            onToggle={() => toggleCategory(category.id)}
            collapsed={collapsed}
            onBlockDragStart={onBlockDragStart}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * PaletteCategory - A collapsible category of blocks
 */
function PaletteCategory({
  category,
  expanded,
  onToggle,
  collapsed,
  onBlockDragStart,
}) {
  const colorClass = getCategoryColorClass(category.color);
  const hasBlocks = category.blocks?.length > 0;

  return (
    <div className="palette-category">
      {/* Category header */}
      <button
        onClick={onToggle}
        className={`
          w-full flex items-center gap-1.5
          px-2 py-1.5 rounded
          text-xs font-medium
          hover:bg-muted
          transition-colors
          ${colorClass}
        `}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{category.label}</span>
            <span className="text-[10px] opacity-50">{category.blocks?.length || 0}</span>
          </>
        )}
      </button>

      {/* Category blocks */}
      {expanded && hasBlocks && !collapsed && (
        <div className="pl-4 pr-1 py-1 space-y-1">
          {category.blocks.map(block => (
            <div
              key={block.id}
              className="palette-block-wrapper"
              onMouseDown={() => onBlockDragStart?.(block)}
            >
              <PaletteBlock block={block} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {expanded && !hasBlocks && !collapsed && (
        <div className="pl-4 pr-1 py-2">
          <span className="text-[10px] text-muted-foreground italic">
            {category.id === "fields" ? "No input fields available" : "No blocks"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Get text color class for category
 */
function getCategoryColorClass(color) {
  switch (color) {
    case "blue": return "text-blue-400";
    case "gray": return "text-gray-400";
    case "green": return "text-green-400";
    case "purple": return "text-purple-400";
    case "cyan": return "text-cyan-400";
    case "teal": return "text-teal-400";
    case "orange": return "text-orange-400";
    case "amber": return "text-amber-400";
    case "red": return "text-red-400";
    default: return "text-muted-foreground";
  }
}

/**
 * MiniPalette - Compact horizontal palette for inline use
 */
export function MiniPalette({
  fields = [],
  showCategories = ["fields", "math", "aggregations"],
  onBlockDragStart,
}) {
  const fieldBlocks = useMemo(() => createFieldBlocks(fields), [fields]);

  const categories = useMemo(() => {
    return getPaletteCategories()
      .filter(c => showCategories.includes(c.id))
      .map(c => c.id === "fields" ? { ...c, blocks: fieldBlocks } : c);
  }, [fieldBlocks, showCategories]);

  return (
    <div className="mini-palette flex flex-wrap gap-1 p-2 bg-muted/30 rounded border border-border">
      {categories.map(category => (
        <div key={category.id} className="flex flex-wrap gap-1">
          {category.blocks?.map(block => (
            <div
              key={block.id}
              className="palette-block-wrapper"
              onMouseDown={() => onBlockDragStart?.(block)}
            >
              <PaletteBlock block={block} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * SearchablePalette - Palette with search functionality
 */
export function SearchablePalette({
  fields = [],
  onBlockDragStart,
}) {
  const [search, setSearch] = useState("");
  const fieldBlocks = useMemo(() => createFieldBlocks(fields), [fields]);

  const allBlocks = useMemo(() => {
    const cats = getPaletteCategories();
    const fieldsCategory = cats.find(c => c.id === "fields");
    if (fieldsCategory) {
      fieldsCategory.blocks = fieldBlocks;
    }
    return cats.flatMap(c => c.blocks || []);
  }, [fieldBlocks]);

  const filteredBlocks = useMemo(() => {
    if (!search.trim()) return allBlocks;
    const term = search.toLowerCase();
    return allBlocks.filter(block =>
      block.label.toLowerCase().includes(term) ||
      block.type.toLowerCase().includes(term)
    );
  }, [allBlocks, search]);

  return (
    <div className="searchable-palette flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search blocks..."
          className="w-full h-7 px-2 text-xs rounded border border-border bg-background"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredBlocks.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No blocks match "{search}"
          </div>
        ) : (
          filteredBlocks.map(block => (
            <div
              key={block.id}
              className="palette-block-wrapper"
              onMouseDown={() => onBlockDragStart?.(block)}
            >
              <PaletteBlock block={block} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
