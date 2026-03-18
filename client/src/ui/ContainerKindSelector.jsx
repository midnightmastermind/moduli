// ui/ContainerKindSelector.jsx
// ============================================================
// Popup selector for choosing container kind when adding new container
// Options: List (default), Doc (rich text), Log (time-ordered)
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { List, FileText, Clock, LayoutGrid } from "lucide-react";

const CONTAINER_KINDS = [
  {
    kind: "list",
    label: "List",
    description: "Sortable list of items",
    icon: List,
    color: "bg-blue-600 hover:bg-blue-500",
  },
  {
    kind: "doc",
    label: "Document",
    description: "Rich text with field pills",
    icon: FileText,
    color: "bg-purple-600 hover:bg-purple-500",
  },
  {
    kind: "log",
    label: "Log",
    description: "Time-ordered entries",
    icon: Clock,
    color: "bg-amber-600 hover:bg-amber-500",
  },
  {
    kind: "smart",
    label: "Smart",
    description: "Auto-filtered view",
    icon: LayoutGrid,
    color: "bg-teal-600 hover:bg-teal-500",
  },
];

/**
 * ContainerKindSelector - Popup for selecting container kind
 *
 * Props:
 * - open: Whether the selector is visible
 * - onClose: Callback to close the selector
 * - onSelect: Callback when a kind is selected (receives kind string)
 * - anchorRef: Ref to the element to anchor the popup to
 * - position: Optional { top, left } for fixed positioning
 */
export default function ContainerKindSelector({
  open = false,
  onClose,
  onSelect,
  anchorRef,
  position = null,
}) {
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const popupRef = useRef(null);

  // Calculate position from anchor element
  useEffect(() => {
    if (!open) return;

    if (position) {
      setAnchor(position);
      return;
    }

    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setAnchor({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
  }, [open, anchorRef, position]);

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
      className="container-kind-selector fixed z-[9999] bg-background border border-border rounded-lg shadow-xl overflow-hidden"
      style={{
        top: anchor.top,
        left: anchor.left,
        minWidth: 200,
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/50">
        <span className="text-sm font-medium">Container Type</span>
      </div>

      {/* Options */}
      <div className="p-1">
        {CONTAINER_KINDS.map((item) => {
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
