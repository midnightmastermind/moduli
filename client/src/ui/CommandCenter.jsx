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
  List,
  Keyboard,
  File,
  Network,
  Filter,
  LayoutGrid,
  Palette,
} from "lucide-react";

import { FieldsTab } from "./commandCenter/FieldsTab";
import { OperationsTab } from "./commandCenter/OperationsTab";
import { ComponentsTab } from "./commandCenter/ComponentsTab";
import { ConnectionsTab } from "./commandCenter/ConnectionsTab";
import { FilesTab } from "./commandCenter/FilesTab";
import { ListsTab } from "./commandCenter/ListsTab";
import { ShortcutsTab } from "./commandCenter/ShortcutsTab";
import { UserSettingsTab } from "./commandCenter/UserSettingsTab";
import { EntityTreeTab } from "./commandCenter/EntityTreeTab";
import { FiltersTab } from "./commandCenter/FiltersTab";
import { GridSettingsTab } from "./commandCenter/GridSettingsTab";
import { AppearanceTab } from "./commandCenter/AppearanceTab";

// ============================================================
// TAB DEFINITIONS
// ============================================================
const TABS = [
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "fields", label: "Fields", icon: Settings2 },
  { id: "operations", label: "Operations", icon: Workflow },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "tree", label: "Components", icon: Network },
  { id: "files", label: "Files", icon: File },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "lists", label: "Lists", icon: List },
  { id: "settings", label: "User Settings", icon: User },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

// ============================================================
// STUB TAB
// ============================================================
function StubTab({ label }) {
  return (
    <div className="px-4 py-7 text-center text-text-faint text-xs font-mono">
      {label} — coming soon
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function CommandCenter({ open, onOpenChange, isMobile }) {
  const [activeTab, setActiveTab] = useState("fields");

  return (
    // Absolute-positioned overlay — slides down from below the header, overlays the grid.
    <div
      data-testid="command-center"
      className="absolute left-0 right-0 overflow-hidden font-mono"
      style={{
        top: "100%",
        zIndex: 200,
        maxHeight: open ? (isMobile ? "70vh" : "50vh") : 0,
        transition: isMobile
          ? "max-height 0.12s ease-out"
          : "max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        background: "var(--body-bg)",
        borderBottom: open ? "1px solid var(--border-default)" : "none",
        boxShadow: open ? "0 4px 16px rgba(0,0,0,0.5)" : "none",
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

      {/* ── Content ── */}
      <div style={{ overflow: "auto", maxHeight: isMobile ? "calc(70vh - 40px)" : "calc(50vh - 40px)" }}>
        {activeTab === "fields"      && <FieldsTab />}
        {activeTab === "operations"  && <OperationsTab />}
        {activeTab === "filters"     && <FiltersTab />}
        {activeTab === "grid"        && <GridSettingsTab />}
        {activeTab === "appearance"  && <AppearanceTab />}
        {activeTab === "tree"        && <EntityTreeTab />}
        {activeTab === "lists"       && <ListsTab />}
        {activeTab === "shortcuts"   && <ShortcutsTab />}
        {activeTab === "settings"    && <UserSettingsTab />}
        {activeTab === "connections" && <ConnectionsTab />}
        {activeTab === "files"       && <FilesTab />}
      </div>
    </div>
  );
}
