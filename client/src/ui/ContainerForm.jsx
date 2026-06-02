// forms/ContainerForm.jsx
import React, { useContext, useMemo, useState } from "react";
import { Separator } from "@/components/ui/separator";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import StyleEditor from "./StyleEditor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import { getOtherOccurrences } from "../state/selectors";
import EditorBindingSection from "./EditorBindingSection.jsx";
import { buildStyleCascadeContext, resolveStyleCascade } from "../helpers/StyleHelpers";
import LayoutCascadeSection from "./LayoutCascadeSection";

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
  onOccurrenceStyleChange, // (style|null) => void — writes occurrence.ownStyle
}) {
  const iter = iteration || { mode: "inherit", timeFilter: "daily" };
  const { occurrencesById, modulesById, fieldsById, state } = useGridActions();

  // Cascade context for the StyleEditor — shows what every ancestor
  // (Grid → Panel → Page) is pushing down so the user can see WHY this
  // container looks the way it does before overriding. The walk starts
  // from THIS container occurrence and buckets ancestors by role.
  const cascadeForContainer = useMemo(() => {
    if (!occurrence) return null;
    const ctx = buildStyleCascadeContext({
      leafOccurrence: occurrencesById?.[occurrence.parentId] || occurrencesById?.[occurrence.id],
      occurrencesById,
      modulesById,
      grid: state?.grid,
    });
    return resolveStyleCascade(ctx, "container");
  }, [occurrence, occurrencesById, modulesById, state?.grid]);

  // Cascade for the child-instance defaults — same chain but leaf is
  // an instance so the editor shows what an instance dropped INTO this
  // container would inherit from Grid/Panel/Page/Container.
  const cascadeForChildInstance = useMemo(() => {
    if (!occurrence) return null;
    const ctx = buildStyleCascadeContext({
      leafOccurrence: occurrencesById?.[occurrence.id],
      occurrencesById,
      modulesById,
      grid: state?.grid,
    });
    // Include the container itself's contribution at the bottom.
    if (container) {
      ctx.container = container;
      ctx.containerOcc = occurrence;
    }
    return resolveStyleCascade(ctx, "instance");
  }, [occurrence, container, occurrencesById, modulesById, state?.grid]);

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

  // Editor↔field binding picker state — scope toggle between module (template)
  // and occurrence (this placement). Defaults to module.
  const [bindingScope, setBindingScope] = useState("module");
  const allFields = useMemo(
    () => Object.values(fieldsById || {})
      .filter((f) => !f.trashed)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fieldsById]
  );
  const headerBindingValue = bindingScope === "module"
    ? (container?.meta?.headerLink ?? null)
    : (occurrence?.meta?.headerLink ?? container?.meta?.headerLink ?? null);
  const setHeaderBinding = (next) => {
    if (bindingScope === "module") {
      onContainerUpdate?.({ meta: { ...(container?.meta || {}), headerLink: next } });
    } else if (occurrence?.id) {
      onOccurrenceUpdate?.({ meta: { ...(occurrence?.meta || {}), headerLink: next } });
    }
  };

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
        <TabsList className="grid grid-cols-2 mx-2 mt-1.5 h-7">
          <TabsTrigger value="settings" className="text-[10px]">Settings</TabsTrigger>
          <TabsTrigger value="style" className="text-[10px]">Style</TabsTrigger>
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


          <Separator />

          {/* Editor↔Field Binding (header slot) */}
          <EditorBindingSection
            slot="header"
            binding={headerBindingValue}
            onChange={setHeaderBinding}
            scope={bindingScope}
            onScopeChange={setBindingScope}
            fields={allFields}
          />

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
            kind="container"
            cascade={cascadeForContainer}
            styleMode={container?.styleMode || "inherit"}
            ownStyle={container?.ownStyle}
            onStyleModeChange={(mode) => onContainerUpdate?.({ styleMode: mode })}
            onOwnStyleChange={(style) => onContainerUpdate?.({ ownStyle: style })}
            label="Container Style"
            inheritLabel="Page / Panel / Grid"
            customCss={container?.customCss || ""}
            onCustomCssChange={(css) => onContainerUpdate?.({ customCss: css })}
            moduleId={containerId}
          />

          <Separator />

          <StyleEditor
            kind="instance"
            cascade={cascadeForChildInstance}
            styleMode={container?.childInstanceStyle ? "own" : "inherit"}
            ownStyle={container?.childInstanceStyle}
            onStyleModeChange={(mode) => {
              if (mode === "inherit") onContainerUpdate?.({ childInstanceStyle: null });
            }}
            onOwnStyleChange={(style) => onContainerUpdate?.({ childInstanceStyle: style })}
            label="Child Instance Defaults (pushed down)"
            inheritLabel="Page / Panel / Grid"
          />

          {occurrence && (
            <>
              <Separator />
              {/* Per-occurrence style overlay. Writes occurrence.ownStyle —
                  resolveContainerStyle layers this on top of module.ownStyle
                  at render time. Same data path operations write to via
                  UPDATE $occ.ownStyle.<key>, so user edits here and op
                  writes interleave cleanly. */}
              <StyleEditor
                kind="container"
                styleMode={occurrence?.ownStyle ? "own" : "inherit"}
                ownStyle={occurrence?.ownStyle}
                onStyleModeChange={(mode) => {
                  if (mode === "inherit") onOccurrenceStyleChange?.(null);
                }}
                onOwnStyleChange={(style) => onOccurrenceStyleChange?.(style)}
                label="This Placement (overrides module)"
                inheritLabel="Module"
              />

              <Separator />

              {/* Layout cascade — per-container rules pushed DOWN to children
                  (drag-in view / nav options / lock / show fields / repr field
                  whitelist). Writes occurrence.meta.layoutCascade; the resolver
                  in helpers/layoutCascade.js merges this onto descendants. */}
              <LayoutCascadeSection occurrence={occurrence} />
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
