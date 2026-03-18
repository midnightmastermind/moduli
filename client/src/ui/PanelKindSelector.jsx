// ui/PanelKindSelector.jsx
// ============================================================
// Popup selector for choosing panel kind when adding new panel
// Options: Board (default), Notebook (docs with tree), Doc (single doc)
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, BookOpen, FileText, Layers, FolderTree, Image } from "lucide-react";

const PANEL_KINDS = [
  {
    kind: "board",
    label: "Board",
    description: "Grid of containers and items",
    icon: LayoutGrid,
    color: "bg-blue-600 hover:bg-blue-500",
  },
  {
    kind: "artifact-viewer",
    label: "Artifact Viewer",
    description: "Tree sidebar with content viewer",
    icon: FolderTree,
    color: "bg-purple-600 hover:bg-purple-500",
  },
  {
    kind: "doc",
    label: "Document",
    description: "Single rich text document",
    icon: FileText,
    color: "bg-teal-600 hover:bg-teal-500",
  },
  {
    kind: "mixed",
    label: "Mixed",
    description: "Flexible container types",
    icon: Layers,
    color: "bg-amber-600 hover:bg-amber-500",
  },
];

/**
 * PanelKindSelector - Popup for selecting panel kind
 *
 * Props:
 * - open: Whether the selector is visible
 * - onClose: Callback to close the selector
 * - onSelect: Callback when a kind is selected (receives kind string)
 * - position: { top, left } for fixed positioning
 */
export default function PanelKindSelector({
  open = false,
  onClose,
  onSelect,
  position = null,
}) {
  const [anchor, setAnchor] = useState({ top: 100, left: 100 });
  const popupRef = useRef(null);

  // Calculate position
  useEffect(() => {
    if (!open) return;

    if (position) {
      setAnchor(position);
    } else {
      // Default to center of viewport
      setAnchor({
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 100,
      });
    }
  }, [open, position]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleClick = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSelect = useCallback((kind) => {
    onSelect?.(kind);
    onClose?.();
  }, [onSelect, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="panel-kind-selector fixed z-[9999] bg-background border border-border rounded-lg shadow-xl overflow-hidden"
      style={{
        top: anchor.top,
        left: anchor.left,
        minWidth: 220,
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/50">
        <span className="text-sm font-medium">Panel Type</span>
      </div>

      {/* Options */}
      <div className="p-1">
        {PANEL_KINDS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.kind}
              type="button"
              onClick={() => handleSelect(item.kind)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
            >
              <span className={`p-1.5 rounded-md ${item.color}`}>
                <Icon className="w-4 h-4 text-white" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {item.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
