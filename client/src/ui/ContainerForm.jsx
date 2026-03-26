// forms/ContainerForm.jsx
import React, { useContext, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import IterationSettings from "./IterationSettings";
import StyleEditor from "./StyleEditor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GridActionsContext } from "../GridActionsContext";
import { getOtherOccurrences } from "../state/selectors";

const ITERATION_MODES = [
  { value: "inherit", label: "Inherit from Panel" },
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

export default function ContainerForm({
  value,             // { label }
  onChange,          // (next) => void
  onCommitLabel,     // () => void
  onDeleteContainer, // () => void
  containerId,
  container,         // Full container object (for style fields)
  onContainerUpdate, // (updates) => void — persist arbitrary container fields
  iteration,         // { mode, timeFilter }
  onIterationChange, // (next) => void
  defaultDragMode,   // "move" | "copy"
  onDragModeChange,  // (mode) => void
  occurrence,        // The occurrence for this container (for persistence settings)
  onOccurrenceUpdate, // (updates) => void
  onSaveAsTemplate,  // () => void — save current items as a template
  onFillFromTemplate, // (templateId) => void — fill from a saved template
  templates,         // Array of available templates
}) {
  const iter = iteration || { mode: "inherit", timeFilter: "daily" };
  const { occurrencesById, modulesById, fieldsById } = useContext(GridActionsContext);

  // All markdown fields available for attaching
  const markdownFieldOptions = useMemo(() => {
    if (!fieldsById) return [];
    return Object.values(fieldsById)
      .filter(f => f.type === "markdown")
      .map(f => ({ value: f.id, label: f.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [fieldsById]);

  const attachedHeader = container?.attachedFields?.header || [];
  const attachedBody   = container?.attachedFields?.body   || [];

  const otherPlacements = useMemo(
    () => getOtherOccurrences(occurrencesById, modulesById, containerId, occurrence?.id),
    [occurrencesById, modulesById, containerId, occurrence?.id]
  );

  return (
    <div className="font-mono flex flex-col w-72">
      {/* Header */}
      <div className="px-3 pt-2 pb-1.5 border-b border-border shrink-0">
        <h4 className="text-sm font-semibold text-foreground">Container settings</h4>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="settings">
        <TabsList className="grid grid-cols-3 mx-2 mt-1.5 h-7">
          <TabsTrigger value="settings" className="text-[10px]">Settings</TabsTrigger>
          <TabsTrigger value="style" className="text-[10px]">Style</TabsTrigger>
          <TabsTrigger value="templates" className="text-[10px]">Templates</TabsTrigger>
        </TabsList>

        {/* SETTINGS TAB */}
        <TabsContent value="settings" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <FormInput
            schema={{
              className: "",
              type: "text-input",
              key: "label",
              label: "Label",
              placeholder: "Untitled",
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommitLabel?.();
                  e.currentTarget.blur();
                }
              },
            }}
            value={value}
            onChange={onChange}
          />

          {/* Attached Fields */}
          {markdownFieldOptions.length > 0 && (
            <>
              <Separator />
              <div className="py-2">
                <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Attached Fields</h4>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Fields whose content becomes the header or body of this container. All fields in each slot share the same value.
                </p>
                {[
                  { label: "Header fields", key: "header", current: attachedHeader },
                  { label: "Body fields",   key: "body",   current: attachedBody   },
                ].map(({ label, key, current }) => (
                  <div key={key} className="mb-2">
                    <span className="text-[10px] text-muted-foreground font-semibold">{label}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {current.map(fId => {
                        const fname = fieldsById?.[fId]?.name || fId;
                        return (
                          <span key={fId} style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            padding: "1px 6px", borderRadius: 999, fontSize: 10,
                            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
                            color: "var(--accent-blue-text)", fontFamily: "var(--font-mono)",
                          }}>
                            {fname}
                            <button type="button"
                              onClick={() => {
                                const next = current.filter(id => id !== fId);
                                onContainerUpdate?.({ attachedFields: { ...(container?.attachedFields || {}), [key]: next } });
                              }}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, color: "inherit", opacity: 0.6 }}
                            >×</button>
                          </span>
                        );
                      })}
                      <select
                        className="text-[10px] h-5 px-1 rounded border border-border bg-input text-foreground"
                        value=""
                        onChange={e => {
                          const fId = e.target.value;
                          if (!fId || current.includes(fId)) return;
                          onContainerUpdate?.({ attachedFields: { ...(container?.attachedFields || {}), [key]: [...current, fId] } });
                        }}
                      >
                        <option value="">+ Add field</option>
                        {markdownFieldOptions.filter(o => !current.includes(o.value)).map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Separator />

          {/* Drag Behavior */}
          <div className="py-2">
            <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Drag Behavior</h4>
            <FormInput
              schema={{
                type: "select",
                key: "__defaultDragMode",
                label: "Default Mode",
                options: DRAG_MODE_OPTIONS,
                description: "Default behavior when dragging this container.",
              }}
              value={{ __defaultDragMode: defaultDragMode || "move" }}
              onChange={(next) => onDragModeChange?.(next?.__defaultDragMode || "move")}
            />
          </div>

          <Separator />

          {/* Behavior Toggles (Phase 5.2) */}
          <div className="py-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Behavior</h4>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3 h-3"
                  checked={(container?.behaviorMode || "inherit") === "own"}
                  onChange={(e) => onContainerUpdate?.({ behaviorMode: e.target.checked ? "own" : "inherit" })}
                />
                <span className="text-[10px] text-foregroundScale-2">Own settings</span>
              </label>
            </div>
            {(container?.behaviorMode === "own") ? (
              <div className="flex flex-col gap-1.5 pl-1">
                {[
                  { key: "sortable",  label: "Sortable",  desc: "Children can be reordered" },
                  { key: "draggable", label: "Draggable", desc: "This container can be dragged" },
                  { key: "droppable", label: "Droppable", desc: "Accepts drops from outside" },
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3"
                      checked={container?.behavior?.[key] ?? true}
                      onChange={(e) => onContainerUpdate?.({
                        behavior: { ...(container?.behavior || {}), [key]: e.target.checked }
                      })}
                    />
                    <span className="text-[10px] text-foreground">{label}</span>
                    <span className="text-[10px] text-muted-foreground">— {desc}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Inheriting behavior from parent panel.</p>
            )}
          </div>

          {/* Persistence Mode (occurrence-level) */}
          {occurrence && (
            <>
              <Separator />
              <div className="py-2">
                <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Persistence</h4>
                <IterationSettings
                  occurrence={occurrence}
                  onUpdate={onOccurrenceUpdate}
                  entityType="container"
                  compact
                />
              </div>
            </>
          )}

          <Separator />

          {/* Iteration Settings */}
          <div className="pt-2 pb-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Iteration</h4>
              <span className="text-[10px] opacity-70">Time-based filtering</span>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-3">
              <FormInput
                schema={{
                  type: "select",
                  key: "__iterMode",
                  label: "Mode",
                  options: ITERATION_MODES,
                  description: "Inherit uses the panel's iteration. Own sets a specific time filter.",
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
                    description: "How occurrences are grouped for this container.",
                  }}
                  value={{ __iterTimeFilter: iter.timeFilter || "daily" }}
                  onChange={(next) => onIterationChange?.({ ...iter, timeFilter: next?.__iterTimeFilter || "daily" })}
                />
              )}
            </div>

            {iter.mode === "inherit" && (
              <p className="mt-2 text-[10px] text-foregroundScale-2/80">
                This container inherits iteration from its panel.
              </p>
            )}
          </div>

          {/* Other Placements */}
          {otherPlacements.length > 0 && (
            <>
              <Separator />
              <div className="py-2">
                <h4 className="text-xs font-semibold text-foreground/70 mb-2">Other Placements ({otherPlacements.length})</h4>
                <div className="space-y-1">
                  {otherPlacements.map(({ occurrence: occ, parentLabel }) => (
                    <div key={occ.id} className="flex items-center gap-2 text-[10px] text-muted-foreground px-1 py-0.5 rounded bg-muted/20">
                      <span className="text-muted-foreground/50">&#x2192;</span>
                      <span className="truncate">{parentLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* STYLE TAB */}
        <TabsContent value="style" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <StyleEditor
            styleMode={container?.styleMode || "inherit"}
            ownStyle={container?.ownStyle}
            onStyleModeChange={(mode) => onContainerUpdate?.({ styleMode: mode })}
            onOwnStyleChange={(style) => onContainerUpdate?.({ ownStyle: style })}
            label="Container Style"
            inheritLabel="Panel"
            customCss={container?.customCss || ""}
            onCustomCssChange={(css) => onContainerUpdate?.({ customCss: css })}
            moduleId={containerId}
          />

          <Separator />

          <StyleEditor
            styleMode={container?.childInstanceStyle ? "own" : "inherit"}
            ownStyle={container?.childInstanceStyle}
            onStyleModeChange={(mode) => {
              if (mode === "inherit") onContainerUpdate?.({ childInstanceStyle: null });
            }}
            onOwnStyleChange={(style) => onContainerUpdate?.({ childInstanceStyle: style })}
            label="Child Instance Defaults"
            inheritLabel="Panel"
          />
        </TabsContent>

        {/* TEMPLATES TAB */}
        <TabsContent value="templates" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <div className="py-2">
            <h4 className="text-xs font-semibold text-foregroundScale-2 mb-2">Templates</h4>
            <div className="flex flex-col gap-1.5">
              {onSaveAsTemplate && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs w-full"
                  onClick={onSaveAsTemplate}
                >
                  Save Current Items as Template
                </Button>
              )}
              {(templates || []).length > 0 && (
                <div className="space-y-1">
                  {templates.map(t => (
                    <Button
                      key={t.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs w-full justify-start"
                      onClick={() => onFillFromTemplate?.(t.id)}
                    >
                      Fill from: {t.name}
                    </Button>
                  ))}
                </div>
              )}
              {!(templates || []).length && (
                <p className="text-[10px] text-muted-foreground">No templates saved yet.</p>
              )}
              {(templates || []).length > 0 && (
                <div className="mt-2">
                  <label className="text-[10px] text-foregroundScale-2 block mb-1">
                    Default Template (auto-fill on day change)
                  </label>
                  <select
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1 text-foreground"
                    value={container?.defaultTemplateId || ""}
                    onChange={(e) => onContainerUpdate?.({ defaultTemplateId: e.target.value || null })}
                  >
                    <option value="">— None —</option>
                    {(templates || []).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
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
              `Remove this container from the grid? The module will remain in the Command Center.`
            );
            if (!ok) return;
            onDeleteContainer?.();
          }}
          disabled={!onDeleteContainer}
        >
          Remove from grid
        </Button>
      </div>
    </div>
  );
}
