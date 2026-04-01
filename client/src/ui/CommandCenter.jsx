// ui/CommandCenter.jsx
// ============================================================
// Command Center — Fixed slide-down drawer (slides from below toolbar)
// Collapses to tab bar only while dragging so grid is accessible
// ============================================================

import React, { useState, Suspense, lazy } from "react";
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

// Lazy-load tabs — only the active tab's code is loaded
const FieldsTab = lazy(() => import("./commandCenter/FieldsTab").then(m => ({ default: m.FieldsTab })));
const OperationsTab = lazy(() => import("./commandCenter/OperationsTab").then(m => ({ default: m.OperationsTab })));
const ComponentsTab = lazy(() => import("./commandCenter/ComponentsTab").then(m => ({ default: m.ComponentsTab })));
const ConnectionsTab = lazy(() => import("./commandCenter/ConnectionsTab").then(m => ({ default: m.ConnectionsTab })));
const FilesTab = lazy(() => import("./commandCenter/FilesTab").then(m => ({ default: m.FilesTab })));
const ListsTab = lazy(() => import("./commandCenter/ListsTab").then(m => ({ default: m.ListsTab })));
const ShortcutsTab = lazy(() => import("./commandCenter/ShortcutsTab").then(m => ({ default: m.ShortcutsTab })));
const UserSettingsTab = lazy(() => import("./commandCenter/UserSettingsTab").then(m => ({ default: m.UserSettingsTab })));
const EntityTreeTab = lazy(() => import("./commandCenter/EntityTreeTab").then(m => ({ default: m.EntityTreeTab })));
const FiltersTab = lazy(() => import("./commandCenter/FiltersTab").then(m => ({ default: m.FiltersTab })));
const GridSettingsTab = lazy(() => import("./commandCenter/GridSettingsTab").then(m => ({ default: m.GridSettingsTab })));
const AppearanceTab = lazy(() => import("./commandCenter/AppearanceTab").then(m => ({ default: m.AppearanceTab })));

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
        <Suspense fallback={null}>
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
        </Suspense>
      </div>
    </div>
  );
}
