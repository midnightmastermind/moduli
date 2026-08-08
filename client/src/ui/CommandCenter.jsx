// ui/CommandCenter.jsx
// ============================================================
// Command Center — Fixed slide-down drawer (slides from below toolbar)
// Collapses to tab bar only while dragging so grid is accessible
// ============================================================

import React, { useState } from "react";
import {
  User,
  Settings2,
  Workflow,
  Link2,
  Keyboard,
  LayoutGrid,
  Palette,
} from "lucide-react";

import { FieldsTab } from "./commandCenter/FieldsTab";
import { OperationsTab } from "./commandCenter/OperationsTab";
import { ConnectionsTab } from "./commandCenter/ConnectionsTab";
import { ShortcutsTab } from "./commandCenter/ShortcutsTab";
import { UserSettingsTab } from "./commandCenter/UserSettingsTab";
import { GridSettingsTab } from "./commandCenter/GridSettingsTab";
import { AppearanceTab } from "./commandCenter/AppearanceTab";

// ============================================================
// TAB DEFINITIONS
// ============================================================
const TABS = [
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "fields", label: "Fields", icon: Settings2 },
  { id: "operations", label: "Operations", icon: Workflow },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "settings", label: "User Settings", icon: User },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function CommandCenter({ open, onOpenChange, isMobileLayout }) {
  const [activeTab, setActiveTab] = useState("fields");

  // Per user request: CC is centered horizontally with no side backdrop,
  // and the max height is fixed (no longer scales with active tab) so it
  // matches the longest tab (Shortcuts). Outer wrapper has no background —
  // only the inner centered card does — so the area to either side of the
  // CC stays transparent and the grid remains visible behind it.
  const CC_MAX_H = isMobileLayout ? "70vh" : "560px"; // 560px ≈ Shortcuts tab full height
  const CC_MAX_W = "900px";
  return (
    <div
      data-testid="command-center"
      className="absolute left-0 right-0 font-mono"
      style={{
        top: "100%",
        zIndex: 200,
        maxHeight: open ? CC_MAX_H : 0,
        overflow: "hidden",
        // Slow glide-from-above feel — translateY pairs with max-height so the
        // contents slide down rather than unroll in place (matches the panel
        // header autohide animation pattern, 2026-05-22 direction).
        transform: open ? "translateY(0)" : "translateY(-8px)",
        opacity: open ? 1 : 0,
        transition: isMobileLayout
          ? "max-height 0.18s ease-out, transform 0.18s ease-out, opacity 0.18s ease-out"
          : "max-height 0.36s cubic-bezier(0.4, 0, 0.2, 1), transform 0.36s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.32s ease-out",
        // No outer bg/border so the grid shows through to the sides of the
        // centered card.
        background: "transparent",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div
        className="cc-card mx-auto overflow-hidden font-mono"
        style={{
          maxWidth: CC_MAX_W,
          width: isMobileLayout ? "100%" : "calc(100% - 32px)",
          background: "var(--body-bg)",
          border: open ? "1px solid var(--border-default)" : "none",
          borderRadius: open ? 8 : 0,
          marginTop: open ? 8 : 0,
          boxShadow: open ? "0 6px 22px rgba(0,0,0,0.55)" : "none",
          maxHeight: CC_MAX_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Tab bar — horizontal scroll on mobile ── */}
        <div className="flex items-center gap-0.5 px-2.5 py-1 border-b border-border-subtle bg-black/20 min-h-[32px] overflow-x-auto cc-tab-bar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                className={[
                  "inline-flex items-center gap-[5px] px-2.5 py-[3px] rounded-md text-[11px] cursor-pointer transition-all duration-150 whitespace-nowrap border",
                  isActive
                    ? "bg-accent-blue-bg text-accent-blue-text border-accent-blue-border"
                    : "bg-transparent text-text-muted border-transparent hover:text-foreground/70 hover:bg-white/[0.05]",
                ].join(" ")}
              >
                <Icon className="w-[11px] h-[11px] shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Content — flex:1 lets every tab fill available height; overflow:auto inside */}
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {activeTab === "fields"      && <FieldsTab />}
          {activeTab === "operations"  && <OperationsTab />}
          {activeTab === "grid"        && <GridSettingsTab />}
          {activeTab === "appearance"  && <AppearanceTab />}
          {activeTab === "shortcuts"   && <ShortcutsTab />}
          {activeTab === "settings"    && <UserSettingsTab />}
          {activeTab === "connections" && <ConnectionsTab />}
        </div>
      </div>
    </div>
  );
}
