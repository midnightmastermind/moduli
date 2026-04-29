// ui/GridRadialMenu.jsx
// ============================================================
// Grid-level radial menu with undo/redo/history/fields buttons
// Opens downward to fit all options
// ============================================================

import React, { useMemo } from "react";
import { Undo2, Redo2, Settings } from "lucide-react";
import RadialMenu from "./RadialMenu";

export default function GridRadialMenu({
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  disabled = false,
}) {
  const menuItems = useMemo(() => [
    {
      icon: Undo2,
      label: "Undo",
      onClick: canUndo ? onUndo : null,
      color: canUndo
        ? "bg-amber-600 hover:bg-amber-500"
        : "bg-slate-700 opacity-50",
    },
    {
      icon: Redo2,
      label: "Redo",
      onClick: canRedo ? onRedo : null,
      color: canRedo
        ? "bg-amber-600 hover:bg-amber-500"
        : "bg-slate-700 opacity-50",
    },
  ], [onUndo, onRedo, canUndo, canRedo]);

  return (
    <div className="grid-radial-menu fixed bottom-4 right-4 z-50">
      <RadialMenu
        items={menuItems}
        forceDirection="down"
        handleIcon={Settings}
        handleTitle="Grid Settings - Click for menu"
        handleClassName="bg-slate-700 hover:bg-slate-600 rounded-lg shadow-lg border border-white/20"
        size="md"
        disabled={disabled}
      />
    </div>
  );
}
