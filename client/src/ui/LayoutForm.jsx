// LayoutForm.jsx
import React from "react";
import { Separator } from "@/components/ui/separator";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import IterationSettings from "./IterationSettings";
import StyleEditor from "./StyleEditor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { TooltipProvider, TooltipHelp } from "@/components/ui/tooltip";

import {
  LayoutGrid,
  Columns,
  ArrowLeftRight,
  ArrowUpDown,
  BrickWall,
  AlignVerticalJustifyStart,
  Copy,
  Link2,
  SplitSquareHorizontal,
  Merge,
} from "lucide-react";

const LAYOUT_PRESETS = [
  {
    id: "grid-cards",
    label: "Grid Cards",
    Icon: LayoutGrid,
    hint: "Responsive dashboard grid",
    description:
      "Responsive card grid. Uses auto-fill columns (based on Min width) so items wrap into as many columns as fit.",
    autoFill: true,
    values: {
      display: "grid",
      flow: "row",
      columns: 0,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 0,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "start",
      alignContent: "start",
      justify: "start",
      wrap: "wrap",
      gapPx: 12,
      gapPreset: "md",
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
  {
    id: "h-scroll-row",
    label: "H Scroll",
    Icon: ArrowLeftRight,
    hint: "Single row, scroll sideways",
    description:
      "One horizontal row (no wrap). Items keep a fixed width and you scroll sideways to see more.",
    autoFill: false,
    values: {
      display: "flex",
      flow: "row",
      wrap: "nowrap",
      columns: 0,
      rows: 0,
      widthMode: "fixed",
      fixedWidth: 280,
      minWidthPx: 0,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "start",
      alignContent: "start",
      justify: "start",
      gapPx: 12,
      gapPreset: "md",
      scrollX: "always",
      scrollY: "none",
      scrollType: "always",
    },
  },
  {
    id: "v-stack",
    label: "V Stack",
    Icon: ArrowUpDown,
    hint: "Classic vertical list",
    description:
      "Classic vertical list. Full-width items stacked top → bottom with vertical scrolling.",
    autoFill: false,
    values: {
      display: "flex",
      flow: "col",
      wrap: "wrap",
      columns: 0,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 0,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "stretch",
      alignContent: "start",
      justify: "start",
      gapPx: 8,
      gapPreset: "sm",
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
  {
    id: "schedule",
    label: "Schedule",
    Icon: AlignVerticalJustifyStart,
    hint: "Full-width column list",
    description:
      "Vertical list with full-width containers, tight spacing, ideal for schedule/timeline layouts.",
    autoFill: false,
    values: {
      display: "flex",
      flow: "col",
      wrap: "nowrap",
      columns: 0,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 0,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "stretch",
      alignContent: "start",
      justify: "start",
      gapPx: 2,
      gapPreset: "none",
      padding: "none",
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
  {
    id: "grid-3col",
    label: "3 Columns",
    Icon: Columns,
    hint: "Exactly 3 columns",
    description:
      "Locked column count. Always exactly 3 columns, regardless of viewport width (items resize within those tracks).",
    autoFill: false,
    values: {
      display: "grid",
      flow: "row",
      columns: 3,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 0,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "stretch",
      alignContent: "start",
      justify: "start",
      gapPx: 12,
      gapPreset: "md",
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
  {
    id: "masonryish",
    label: "Masonry-ish",
    Icon: BrickWall,
    hint: "Dense packed feel",
    description:
      "Auto-fill grid with a larger Min width for 'Pinterest-ish' density. Note: this is not true masonry (CSS Grid won't stack into columns by height).",
    autoFill: true,
    values: {
      display: "grid",
      flow: "row",
      columns: 0,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 220,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "start",
      alignContent: "start",
      justify: "start",
      gapPx: 8,
      gapPreset: "sm",
      dense: true,
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
  {
    id: "masonry-columns",
    label: "Masonry",
    Icon: BrickWall,
    hint: "True column masonry (CSS columns)",
    description:
      "True masonry via CSS columns. Items flow top→bottom per column (no shared grid rows).",
    autoFill: true,
    values: {
      display: "columns",
      flow: "col",
      columns: 0,
      rows: 0,
      widthMode: "auto",
      minWidthPx: 220,
      maxWidthPx: 0,
      heightMode: "auto",
      minHeightPx: 0,
      maxHeightPx: 0,
      alignItems: "start",
      alignContent: "start",
      justify: "start",
      wrap: "wrap",
      gapPx: 8,
      gapPreset: "sm",
      dense: true,
      scrollX: "none",
      scrollY: "auto",
      scrollType: "auto",
    },
  },
];

function applyPreset(current, presetValues) {
  const name = current?.name ?? "";
  return { ...current, ...presetValues, name };
}

function ensureLockDefaults(next) {
  const base = next ?? {};
  const lock = base?.lock ?? {};
  return {
    ...base,
    lock: {
      enabled: lock?.enabled ?? false,
      containersDrag: lock?.containersDrag ?? true,
      containersDrop: lock?.containersDrop ?? true,
      instancesDrag: lock?.instancesDrag ?? true,
      instancesDrop: lock?.instancesDrop ?? true,
    },
  };
}

const ITERATION_MODES = [
  { value: "inherit", label: "Inherit from Grid" },
  { value: "own", label: "Use own iteration" },
];

const TIME_FILTER_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const DRAG_MODE_OPTIONS = [
  { value: "move", label: "Move (relocate occurrence)" },
  { value: "copy", label: "Copy (create new occurrence)" },
  { value: "copylink", label: "Copylink (linked occurrence)" },
];

export default function LayoutForm({
  value, onChange, onCommit, onDeletePanel, panelId, panel, onPanelStyleUpdate,
  iteration, onIterationChange, defaultDragMode, onDragModeChange,
  occurrence, onOccurrenceUpdate, currentViewType, onViewTypeChange,
  onCopyPanel, onCopylinkPanel, onSplitPanel, onUnsplitPanel, isSplit,
}) {
  const v = ensureLockDefaults(value);
  const iter = iteration || { mode: "inherit", timeFilter: "daily" };

  const display = v?.display ?? "grid";
  const flow = v?.flow ?? "row";

  const isGrid = display === "grid";
  const isFlex = display === "flex";
  const isColumns = display === "columns";
  const isGridLike = isGrid || isColumns;

  const columnOptions = [
    { value: "0", label: "Auto" },
    ...Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return { value: String(n), label: String(n) };
    }),
  ];

  const showWrap = isFlex && flow === "row";

  const widthMode = v?.widthMode ?? "auto";
  const heightMode = v?.heightMode ?? "auto";

  const setLock = (patch) => {
    onChange?.({ ...v, lock: { ...v.lock, ...patch } });
  };

  const lockEnabled = !!v?.lock?.enabled;

  return (
    <div className="font-mono flex flex-col text-xs w-80">
      {/* Header */}
      <div className="px-3 pt-2 pb-1.5 border-b border-border shrink-0">
        <h4 className="text-sm font-semibold text-foreground">Panel Settings</h4>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="basic">
        <TabsList className="grid grid-cols-4 mx-2 mt-1.5 h-7">
          <TabsTrigger value="basic" className="text-[10px]">Basic</TabsTrigger>
          <TabsTrigger value="layout" className="text-[10px]">Layout</TabsTrigger>
          <TabsTrigger value="style" className="text-[10px]">Style</TabsTrigger>
          <TabsTrigger value="actions" className="text-[10px]">Actions</TabsTrigger>
        </TabsList>

        {/* BASIC TAB: Name, ViewType, DragBehavior, Iteration, Persistence, BehaviorToggle */}
        <TabsContent value="basic" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1 space-y-2">
          {/* Name */}
          <FormInput
            schema={{
              type: "text-input",
              key: "name",
              label: "Name",
              placeholder: "Panel layout name",
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              },
              onBlur: () => {
                onCommit?.(ensureLockDefaults(v));
              },
            }}
            value={v}
            onChange={(next) => onChange?.(ensureLockDefaults(next))}
          />

          {/* View Type */}
          {onViewTypeChange && (
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-semibold uppercase">View Type</label>
              <select
                value={currentViewType || "list"}
                onChange={onViewTypeChange}
                className="w-full text-xs bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                <option value="list">List</option>
                <option value="notebook">Notebook</option>
                <option value="artifact-viewer">Artifact Viewer</option>
                <option value="doc-viewer">Doc Viewer</option>
                <option value="file-manager">File Manager</option>
              </select>
            </div>
          )}

          <Separator />

          {/* Drag Behavior */}
          <div className="pt-1">
            <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Drag Behavior</h4>
            <FormInput
              schema={{
                type: "select",
                key: "__defaultDragMode",
                label: "Default Mode",
                options: DRAG_MODE_OPTIONS,
                description: "Default behavior when dragging this panel.",
              }}
              value={{ __defaultDragMode: defaultDragMode || "move" }}
              onChange={(next) => onDragModeChange?.(next?.__defaultDragMode || "move")}
            />
          </div>

          <Separator />

          {/* Iteration Settings */}
          <div className="pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Iteration</h4>
              <span className="text-[10px] opacity-70">Time-based filtering</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FormInput
                schema={{
                  type: "select",
                  key: "__iterMode",
                  label: "Mode",
                  options: ITERATION_MODES,
                  description: "Inherit uses the grid's current iteration. Own sets a specific time filter for this panel.",
                }}
                value={{ __iterMode: iter.mode || "inherit" }}
                onChange={(next) => onIterationChange?.({ ...iter, mode: next?.__iterMode || "inherit" })}
              />
              {iter.mode === "own" && (
                <FormInput
                  schema={{
                    type: "select",
                    key: "__iterTimeFilter",
                    label: "Time Filter",
                    options: TIME_FILTER_OPTIONS,
                    description: "How occurrences are grouped for this panel.",
                  }}
                  value={{ __iterTimeFilter: iter.timeFilter || "daily" }}
                  onChange={(next) => onIterationChange?.({ ...iter, timeFilter: next?.__iterTimeFilter || "daily" })}
                />
              )}
            </div>
            {iter.mode === "inherit" && (
              <p className="mt-2 text-[10px] text-foregroundScale-2/80">
                This panel inherits iteration settings from the grid.
              </p>
            )}
          </div>

          {/* Persistence */}
          {occurrence && (
            <>
              <Separator />
              <div className="pt-1">
                <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Persistence</h4>
                <IterationSettings
                  occurrence={occurrence}
                  onUpdate={onOccurrenceUpdate}
                  entityType="panel"
                  compact
                />
              </div>
            </>
          )}

          <Separator />

          {/* Panel Behavior Toggles (Phase 5.2) */}
          <div className="pt-1 pb-1">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Child Behavior</h4>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3 h-3"
                  checked={(panel?.behaviorMode || "inherit") === "own"}
                  onChange={(e) => onPanelStyleUpdate?.({ behaviorMode: e.target.checked ? "own" : "inherit" })}
                />
                <span className="text-[10px] text-foregroundScale-2">Own settings</span>
              </label>
            </div>
            {(panel?.behaviorMode === "own") ? (
              <div className="flex flex-col gap-1.5 pl-1">
                {[
                  { key: "sortable",  label: "Sortable",  desc: "Containers can be reordered" },
                  { key: "droppable", label: "Droppable", desc: "Accepts container drops" },
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3"
                      checked={panel?.behavior?.[key] ?? true}
                      onChange={(e) => onPanelStyleUpdate?.({
                        behavior: { ...(panel?.behavior || {}), [key]: e.target.checked }
                      })}
                    />
                    <span className="text-[10px] text-foreground">{label}</span>
                    <span className="text-[10px] text-muted-foreground">— {desc}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Children inherit default behavior.</p>
            )}
          </div>
        </TabsContent>

        {/* LAYOUT TAB: Presets, Display/Flow/Wrap, Width, Height, Alignment, Grid/Gap, Scroll */}
        <TabsContent value="layout" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1 space-y-2">
          {/* Presets */}
          <div className="pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Presets</h4>
              <span className="text-[10px] opacity-70">Tap to autofill</span>
            </div>
            <TooltipProvider>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {LAYOUT_PRESETS.map((p) => {
                  const Icon = p.Icon;
                  const isActive = v?.presetId === p.id;
                  return (
                    <div key={p.id} className="flex flex-col gap-1">
                      <div className="flex items-start">
                        <Button
                          type="button"
                          variant={isActive ? "secondary" : "ghost"}
                          size="sm"
                          className={cn(
                            "h-10 px-2 flex-1 flex flex-col items-center justify-center gap-1",
                            "rounded-md border border-borderScale-0/40"
                          )}
                          onClick={() => {
                            onChange?.(ensureLockDefaults(applyPreset({ ...v, presetId: p.id }, p.values)));
                          }}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-[9px] leading-none">{p.label}</span>
                        </Button>
                        <TooltipHelp size="sm">
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold">{p.label}</div>
                            {p.hint && <div className="text-[10px] text-muted-foreground">{p.hint}</div>}
                            {p.description && <div className="text-[11px] leading-snug">{p.description}</div>}
                            <div className="pt-1 text-[10px] text-muted-foreground">
                              Auto-fill: <span className="text-foreground">{p.autoFill ? "Yes" : "No"}</span>
                            </div>
                          </div>
                        </TooltipHelp>
                      </div>
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
            <p className="mt-2 text-[11px] text-foregroundScale-2">
              Presets set a "known-good" combo. Everything below still works as overrides.
            </p>
          </div>

          <Separator />

          {/* Display */}
          <FormInput
            schema={{
              type: "select",
              key: "display",
              label: "Display",
              options: [
                { value: "grid", label: "Grid" },
                { value: "flex", label: "Flex" },
                { value: "columns", label: "Masonry (Columns)" },
              ],
            }}
            value={v}
            onChange={(next) => {
              const nextDisplay = next?.display ?? "grid";
              const base = ensureLockDefaults({ ...next, display: nextDisplay });
              if (nextDisplay === "grid" || nextDisplay === "columns") {
                onChange?.({ ...base, columns: Number.isFinite(Number(base.columns)) ? Number(base.columns) : 0 });
                return;
              }
              onChange?.({ ...base, wrap: base.wrap ?? "wrap" });
            }}
          />

          {/* Flow */}
          <FormInput
            schema={{
              type: "select",
              key: "flow",
              label: "Flow direction",
              options: [
                { value: "row", label: "Row (left → right)" },
                { value: "col", label: "Column (top → bottom)" },
              ],
            }}
            value={v}
            onChange={(next) => onChange?.(ensureLockDefaults(next))}
          />

          {showWrap && (
            <FormInput
              schema={{
                type: "select",
                key: "wrap",
                label: "Wrap",
                options: [
                  { value: "wrap", label: "Wrap" },
                  { value: "nowrap", label: "No wrap" },
                ],
                description: "Only applies to Flex + Row flow.",
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          )}

          <Separator />

          {/* WIDTH */}
          <div className="grid pt-[5px] grid-cols-2 gap-2">
            <FormInput
              schema={{ type: "select", key: "widthMode", label: "Width mode", options: [{ value: "auto", label: "Auto" }, { value: "fixed", label: "Fixed" }] }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            {widthMode === "fixed" ? (
              <FormInput
                schema={{ type: "number-input", key: "fixedWidth", label: "Fixed width (px)", min: 120, max: 4000, description: "Sets list width directly." }}
                value={v}
                onChange={(next) => onChange?.(ensureLockDefaults(next))}
              />
            ) : (
              <FormInput
                schema={{
                  type: "number-input", key: "minWidthPx", label: "Min width (px)", min: 0, max: 4000,
                  description: isColumns ? "0 = none (auto). In columns mode this is the column-width baseline." : "0 = none (auto).",
                }}
                value={v}
                onChange={(next) => onChange?.(ensureLockDefaults(next))}
              />
            )}
            <FormInput
              schema={{ type: "number-input", key: "maxWidthPx", label: "Max width (px)", min: 0, max: 8000, description: widthMode === "fixed" ? "Optional clamp. 0 = none." : "0 = none." }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          </div>

          {/* HEIGHT */}
          <div className="grid pt-[5px] grid-cols-2 gap-2">
            <FormInput
              schema={{ type: "select", key: "heightMode", label: "Height mode", options: [{ value: "auto", label: "Auto" }, { value: "fixed", label: "Fixed" }] }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            {heightMode === "fixed" ? (
              <FormInput
                schema={{ type: "number-input", key: "fixedHeight", label: "Fixed height (px)", min: 0, max: 8000, description: "Sets list height directly. 0 = none." }}
                value={v}
                onChange={(next) => onChange?.(ensureLockDefaults(next))}
              />
            ) : (
              <FormInput
                schema={{ type: "number-input", key: "minHeightPx", label: "Min height (px)", min: 0, max: 8000, description: "0 = none (auto)." }}
                value={v}
                onChange={(next) => onChange?.(ensureLockDefaults(next))}
              />
            )}
            <FormInput
              schema={{ type: "number-input", key: "maxHeightPx", label: "Max height (px)", min: 0, max: 8000, description: heightMode === "fixed" ? "Optional clamp. 0 = none." : "0 = none." }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          </div>

          {/* Alignment */}
          <FormInput
            schema={{
              type: "select", key: "alignItems", label: "Align items",
              options: [
                { value: "start", label: "Start" }, { value: "center", label: "Center" },
                { value: "end", label: "End" }, { value: "stretch", label: "Stretch" },
                ...(isFlex ? [{ value: "baseline", label: "Baseline" }] : []),
              ],
              description: "align-items (cross-axis alignment of items).",
            }}
            value={v}
            onChange={(next) => onChange?.(ensureLockDefaults(next))}
          />
          <FormInput
            schema={{
              type: "select", key: "alignContent", label: "Align content",
              options: [
                { value: "start", label: "Start" }, { value: "center", label: "Center" },
                { value: "end", label: "End" }, { value: "between", label: "Space between" },
                { value: "around", label: "Space around" }, { value: "evenly", label: "Space evenly" },
                { value: "stretch", label: "Stretch" },
              ],
              description: "align-content (only matters when there's extra space).",
            }}
            value={v}
            onChange={(next) => onChange?.(ensureLockDefaults(next))}
          />
          <FormInput
            schema={{
              type: "select", key: "justify", label: "Justify",
              options: [
                { value: "start", label: "Start" }, { value: "center", label: "Center" },
                { value: "end", label: "End" }, { value: "between", label: "Space between" },
                { value: "around", label: "Space around" }, { value: "evenly", label: "Space evenly" },
              ],
              description: "Applies justify-content to the list container.",
            }}
            value={v}
            onChange={(next) => onChange?.(ensureLockDefaults(next))}
          />

          <Separator />

          {/* Grid/Gap */}
          <div className="grid pt-[5px] grid-cols-2 gap-2">
            {isGridLike && (
              <FormInput
                schema={{
                  type: "select", key: "columns", label: "Columns", options: columnOptions,
                  description: isColumns
                    ? "Auto = responsive by Min width (column-width). Set a number to force a fixed column count."
                    : "Auto = auto-fill by min item width.",
                }}
                value={{ ...v, columns: String(v?.columns ?? 0) }}
                onChange={(next) => {
                  const raw = next?.columns ?? "0";
                  const n = Number(raw);
                  onChange?.(ensureLockDefaults({ ...v, ...next, columns: Number.isFinite(n) ? n : 0 }));
                }}
              />
            )}
            <FormInput
              schema={{
                type: "slider", key: "gapPx", label: "Gap",
                sliderMin: 0, sliderMax: 32, sliderStep: 1, showValue: true, valueSuffix: "px",
                description: "Snaps to none/sm/md/lg internally.",
              }}
              value={v}
              onChange={(next) => {
                const px = next?.gapPx ?? 0;
                const gapPxToPreset = (n) => {
                  const vv = Number(n) || 0;
                  if (vv <= 0) return "none";
                  if (vv <= 8) return "sm";
                  if (vv <= 16) return "md";
                  return "lg";
                };
                onChange?.(ensureLockDefaults({ ...next, gapPreset: gapPxToPreset(px) }));
              }}
            />
            <FormInput
              schema={{
                type: "select", key: "gapPreset", label: "Gap preset",
                options: [{ value: "none", label: "None" }, { value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }],
              }}
              value={v}
              onChange={(next) => {
                const preset = next?.gapPreset ?? "md";
                const presetToPx = { none: 0, sm: 8, md: 12, lg: 20 };
                onChange?.(ensureLockDefaults({ ...next, gapPx: presetToPx[preset] ?? 12 }));
              }}
            />
            <FormInput
              schema={{ type: "number-input", key: "rows", label: "Rows", min: 0, max: 24, description: "Reserved for later; 0 = auto." }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{ type: "toggle", key: "dense", label: "Dense", description: "Tighter list spacing." }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          </div>

          <Separator />

          {/* Scroll */}
          <div className="grid pt-[5px] grid-cols-2 gap-2">
            <FormInput
              schema={{
                type: "select", key: "scrollType", label: "Scrollbar UI",
                options: [{ value: "auto", label: "Auto" }, { value: "always", label: "Always" }, { value: "scroll", label: "Scroll" }, { value: "hover", label: "Hover" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{
                type: "select", key: "scrollX", label: "Scroll X",
                options: [{ value: "none", label: "None" }, { value: "auto", label: "Auto" }, { value: "always", label: "Always" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{
                type: "select", key: "scrollY", label: "Scroll Y",
                options: [{ value: "none", label: "None" }, { value: "auto", label: "Auto" }, { value: "always", label: "Always" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{ type: "number-input", key: "scrollHideDelay", label: "Hide delay (ms)", min: 0, max: 5000 }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          </div>
        </TabsContent>

        {/* STYLE TAB: Child Container Defaults, Child Instance Defaults, Insets/Padding/Variant */}
        <TabsContent value="style" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1 space-y-2">
          <StyleEditor
            styleMode={panel?.childContainerStyle ? "own" : "inherit"}
            ownStyle={panel?.childContainerStyle}
            onStyleModeChange={(mode) => {
              if (mode === "inherit") onPanelStyleUpdate?.({ childContainerStyle: null });
            }}
            onOwnStyleChange={(style) => onPanelStyleUpdate?.({ childContainerStyle: style })}
            label="Container Defaults"
            inheritLabel="Theme"
            customCss={panel?.customCss || ""}
            onCustomCssChange={(css) => onPanelStyleUpdate?.({ customCss: css })}
            moduleId={panelId}
          />

          <Separator />

          <StyleEditor
            styleMode={panel?.childInstanceStyle ? "own" : "inherit"}
            ownStyle={panel?.childInstanceStyle}
            onStyleModeChange={(mode) => {
              if (mode === "inherit") onPanelStyleUpdate?.({ childInstanceStyle: null });
            }}
            onOwnStyleChange={(style) => onPanelStyleUpdate?.({ childInstanceStyle: style })}
            label="Instance Defaults"
            inheritLabel="Theme"
          />

          <Separator />

          {/* Insets / Padding / Variant */}
          <div className="grid pt-[5px] grid-cols-2 gap-2">
            <FormInput
              schema={{
                type: "select", key: "insetX", label: "Inset X",
                options: [{ value: "panel", label: "Inset" }, { value: "none", label: "None" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{
                type: "select", key: "padding", label: "Padding",
                options: [{ value: "none", label: "None" }, { value: "sm", label: "Small" }, { value: "md", label: "Medium" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
            <FormInput
              schema={{
                type: "select", key: "variant", label: "Variant",
                options: [{ value: "default", label: "Default" }, { value: "panel", label: "Panel" }],
              }}
              value={v}
              onChange={(next) => onChange?.(ensureLockDefaults(next))}
            />
          </div>
        </TabsContent>

        {/* ACTIONS TAB: Lock/Permissions, Panel Actions */}
        <TabsContent value="actions" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1 space-y-2">
          {/* Lock / Permissions */}
          <div className="pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Lock</h4>
              <span className="text-[10px] opacity-70">Drag/drop permissions</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FormInput
                schema={{
                  type: "toggle", key: "__lockEnabled", label: "Lock panel interactions",
                  description: "When enabled, the options below decide what dragging/dropping is allowed inside this panel.",
                }}
                value={{ __lockEnabled: lockEnabled }}
                onChange={(next) => setLock({ enabled: !!next?.__lockEnabled })}
              />
              <div className="text-[10px] leading-snug text-foregroundScale-2/80 border border-borderScale-0/40 rounded-md p-2">
                Tip: you can "freeze" a panel by turning off drag/drop for both Containers and Instances.
              </div>
            </div>
            <div className={cn("mt-2 grid grid-cols-2 gap-2", !lockEnabled && "opacity-60")}>
              <FormInput
                schema={{ type: "toggle", key: "__containersDrag", label: "Containers can drag", description: "Allow reordering / moving containers." }}
                value={{ __containersDrag: !!v.lock.containersDrag }}
                onChange={(next) => setLock({ containersDrag: !!next?.__containersDrag })}
                disabled={!lockEnabled}
              />
              <FormInput
                schema={{ type: "toggle", key: "__containersDrop", label: "Containers can drop", description: "Allow dropping containers into this panel." }}
                value={{ __containersDrop: !!v.lock.containersDrop }}
                onChange={(next) => setLock({ containersDrop: !!next?.__containersDrop })}
                disabled={!lockEnabled}
              />
              <FormInput
                schema={{ type: "toggle", key: "__instancesDrag", label: "Instances can drag", description: "Allow dragging instances within/between containers." }}
                value={{ __instancesDrag: !!v.lock.instancesDrag }}
                onChange={(next) => setLock({ instancesDrag: !!next?.__instancesDrag })}
                disabled={!lockEnabled}
              />
              <FormInput
                schema={{ type: "toggle", key: "__instancesDrop", label: "Instances can drop", description: "Allow dropping instances into this panel/containers." }}
                value={{ __instancesDrop: !!v.lock.instancesDrop }}
                onChange={(next) => setLock({ instancesDrop: !!next?.__instancesDrop })}
                disabled={!lockEnabled}
              />
            </div>
          </div>

          {/* Panel Actions */}
          {(onCopyPanel || onCopylinkPanel || onSplitPanel || onUnsplitPanel) && (
            <>
              <Separator />
              <div className="pt-1 space-y-1">
                <h4 className="text-xs font-semibold text-foregroundScale-2">Panel Actions</h4>
                <div className="flex flex-wrap gap-1 pt-1">
                  {onCopyPanel && (
                    <Button type="button" size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={onCopyPanel}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  )}
                  {onCopylinkPanel && (
                    <Button type="button" size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={onCopylinkPanel}>
                      <Link2 className="h-3 w-3" /> Link
                    </Button>
                  )}
                  {onSplitPanel && !isSplit && (
                    <Button type="button" size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={onSplitPanel}>
                      <SplitSquareHorizontal className="h-3 w-3" /> Split
                    </Button>
                  )}
                  {onUnsplitPanel && isSplit && (
                    <Button type="button" size="sm" variant="secondary" className="text-[10px] h-6 gap-1" onClick={onUnsplitPanel}>
                      <Merge className="h-3 w-3" /> Merge
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Sticky Delete Footer */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            const ok = window.confirm(
              `Remove this panel from the grid? The module will remain in the Command Center.`
            );
            if (!ok) return;
            onDeletePanel?.();
          }}
          disabled={!onDeletePanel}
        >
          Remove from grid
        </Button>
      </div>
    </div>
  );
}
