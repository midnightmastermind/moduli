// forms/InstanceForm.jsx
import React, { useState, useCallback, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import EditorBindingSection from "./EditorBindingSection.jsx";
import FieldBindingsEditor from "./FieldBindingsEditor.jsx";
import StyleEditor from "./StyleEditor";
import LayoutCascadeSection from "./LayoutCascadeSection";
import { useGridActions } from "../GridActionsContext";
import { getOtherOccurrences } from "../state/selectors";
import { buildStyleCascadeContext, resolveStyleCascade } from "../helpers/StyleHelpers";
import * as CommitHelpers from "../helpers/CommitHelpers";


import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const DRAG_MODE_OPTIONS = [
  { value: "move", label: "Move (relocate occurrence)" },
  { value: "copy", label: "Copy (create new occurrence)" },
  { value: "copylink", label: "Copylink (linked occurrence)" },
];

export default function InstanceForm({
  value,            // { label }
  onChange,         // (next) => void
  onCommitLabel,    // () => void
  onDeleteInstance, // () => void
  instanceId,
  instance,         // Full instance object with fieldBindings
  occurrence,       // The occurrence (for iteration/persistence settings)
  iteration,        // { mode, timeFilter }
  onIterationChange, // (next) => void
  dispatch,
  socket,
}) {
  const { fieldsById, occurrencesById, modulesById, state } = useGridActions();

  // Cascade context — walks from THIS instance occurrence up through
  // Container → Page → Panel → Grid so the StyleEditor's "Inherited
  // cascade" view shows what every ancestor is contributing before the
  // user picks an override at the instance level.
  const cascadeForInstance = useMemo(() => {
    if (!occurrence) return null;
    const ctx = buildStyleCascadeContext({
      leafOccurrence: occurrence,
      occurrencesById,
      modulesById,
      grid: state?.grid,
    });
    // The walker buckets ancestors by role — the instance itself is
    // surfaced as `ctx.instance` so leaf rules fire correctly.
    const leafKind = instance?.role === "textblock" ? "textblock"
      : instance?.role === "artifact" ? "artifact"
      : "instance";
    return resolveStyleCascade(ctx, leafKind);
  }, [occurrence, instance?.role, occurrencesById, modulesById, state?.grid]);

  const handleOccurrenceUpdate = useCallback((updates) => {
    if (!occurrence?.id) return;
    const updatedOccurrence = {
      ...occurrence,
      ...updates,
      iteration: {
        ...(occurrence.iteration || {}),
        ...(updates.iteration || {}),
      },
    };
    CommitHelpers.updateOccurrence({
      dispatch,
      socket,
      occurrence: updatedOccurrence,
      emit: true,
    });
  }, [occurrence, dispatch, socket]);

  const allFields = Object.values(fieldsById || {});

  return (
    <div className="font-mono flex flex-col w-72">
      {/* Header */}
      <div className="px-3 pt-2 pb-1.5 border-b border-border shrink-0">
        <h4 className="text-sm font-semibold text-foreground">Instance settings</h4>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="settings">
        <TabsList className="grid grid-cols-3 mx-2 mt-1.5 h-7">
          <TabsTrigger value="settings" className="text-[10px]">Settings</TabsTrigger>
          <TabsTrigger value="style" className="text-[10px]">Style</TabsTrigger>
          <TabsTrigger value="fields" className="text-[10px]">Fields</TabsTrigger>
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
                description: "Default behavior when dragging this instance.",
              }}
              value={{ __defaultDragMode: instance?.defaultDragMode || "move" }}
              onChange={(next) => {
                if (instance) {
                  CommitHelpers.updateModule({
                    dispatch,
                    socket,
                    module: {
                      id: instance.id,
                      defaultDragMode: next?.__defaultDragMode || "move",
                    },
                    emit: true,
                  });
                }
              }}
            />
          </div>

          {/* Auto-check on drop */}
          <div className="flex items-center justify-between gap-2 py-1 px-1">
            <Label className="text-xs">Auto-check on drop</Label>
            <Switch
              checked={instance?.meta?.autoCheckOnDrop || false}
              onCheckedChange={(checked) => {
                if (instance) {
                  CommitHelpers.updateModule({
                    dispatch,
                    socket,
                    module: {
                      id: instance.id,
                      meta: { ...(instance.meta || {}), autoCheckOnDrop: checked },
                    },
                    emit: true,
                  });
                }
              }}
            />
          </div>

          {/* Disable module (R7) */}
          <div className="flex items-center justify-between gap-2 py-1 px-1">
            <div>
              <Label className="text-xs">Disabled</Label>
              <p className="text-[10px] text-muted-foreground/70">Hide all field inputs — read-only display only</p>
            </div>
            <Switch
              checked={!!instance?.meta?.disabled}
              onCheckedChange={(checked) => {
                if (instance) {
                  CommitHelpers.updateModule({
                    dispatch,
                    socket,
                    module: {
                      id: instance.id,
                      meta: { ...(instance.meta || {}), disabled: checked },
                    },
                    emit: true,
                  });
                }
              }}
            />
          </div>

          <Separator />

          {/* Sibling Links */}
          <SiblingLinksSection
            instance={instance}
            dispatch={dispatch}
            socket={socket}
          />

          <Separator />

          {/* Behavior Toggles (Phase 5.2) */}
          <div className="py-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-foregroundScale-2">Behavior</h4>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3 h-3"
                  checked={(instance?.behaviorMode || "inherit") === "own"}
                  onChange={(e) => {
                    if (instance) CommitHelpers.updateModule({ dispatch, socket, module: { id: instance.id, behaviorMode: e.target.checked ? "own" : "inherit" }, emit: true });
                  }}
                />
                <span className="text-[10px] text-foregroundScale-2">Own settings</span>
              </label>
            </div>
            {instance?.behaviorMode === "own" ? (
              <label className="flex items-center gap-2 cursor-pointer pl-1">
                <input
                  type="checkbox"
                  className="w-3 h-3"
                  checked={instance?.behavior?.draggable ?? true}
                  onChange={(e) => {
                    if (instance) CommitHelpers.updateModule({ dispatch, socket, module: { id: instance.id, behavior: { ...(instance.behavior || {}), draggable: e.target.checked } }, emit: true });
                  }}
                />
                <span className="text-[10px] text-foreground">Draggable</span>
                <span className="text-[10px] text-muted-foreground">— can be dragged from its container</span>
              </label>
            ) : (
              <p className="text-[10px] text-muted-foreground">Inheriting drag behavior from parent container.</p>
            )}
          </div>

          {/* Link (textblock mini-blocks only) */}
          {instance?.role === "textblock" && occurrence && (
            <LinkSettingsSection
              occurrence={occurrence}
              dispatch={dispatch}
              socket={socket}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
            />
          )}

          {/* Other Placements */}
          {instance && (
            <OtherPlacements
              moduleId={instance.id}
              excludeOccId={occurrence?.id}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
            />
          )}
        </TabsContent>

        {/* STYLE TAB */}
        <TabsContent value="style" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <StyleEditor
            kind={instance?.role === "textblock" ? "textblock" : instance?.role === "artifact" ? "artifact" : "instance"}
            cascade={cascadeForInstance}
            styleMode={instance?.styleMode || "inherit"}
            ownStyle={instance?.ownStyle}
            onStyleModeChange={(mode) => {
              if (instance) {
                CommitHelpers.updateModule({
                  dispatch,
                  socket,
                  module: { id: instance.id, styleMode: mode },
                  emit: true,
                });
              }
            }}
            onOwnStyleChange={(style) => {
              if (instance) {
                CommitHelpers.updateModule({
                  dispatch,
                  socket,
                  module: { id: instance.id, ownStyle: style },
                  emit: true,
                });
              }
            }}
            label="Instance Style"
            inheritLabel="Container / Page / Panel / Grid"
          />

          {occurrence && (
            <>
              <Separator />
              {/* Layout cascade override — per-placement final-say for this
                  instance. Writes occurrence.meta.layoutCascadeOverride; the
                  resolver in helpers/layoutCascade.js uses this as the
                  strongest layer (beats Grid/Panel/Page/Container). */}
              <LayoutCascadeSection occurrence={occurrence} />
            </>
          )}
        </TabsContent>

        {/* FIELDS TAB */}
        <TabsContent value="fields" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <FieldBindingsEditor module={instance} />

          {/* Body binding picker — textblock-role instances only */}
          {instance?.role === "textblock" && (
            <BodyBindingPicker
              instance={instance}
              occurrence={occurrence}
              fields={allFields}
              dispatch={dispatch}
              socket={socket}
            />
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
            // The old wording said the opposite of what happens: this calls
            // `removeOccurrence`, which emits `delete_occurrence` and lets the
            // server cascade to everything parented to this row. "Remove from
            // the container" reads as unlinking, so a container row could be
            // destroyed by someone who believed they were tidying a placement.
            // The module really does survive — that half was true and is kept.
            const ok = window.confirm(
              `Delete this item? Anything inside it is deleted too. The module stays in the Command Center.`
            );
            if (!ok) return;
            onDeleteInstance?.();
          }}
          disabled={!onDeleteInstance}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

/**
 * BodyBindingPicker — wraps EditorBindingSection with the read/write plumbing
 * for textblock-role instance bindings. Module-level binding lives at
 * instance.meta.bodyLink; occurrence-level at occurrence.meta.bodyLink.
 */
function BodyBindingPicker({ instance, occurrence, fields, dispatch, socket }) {
  const [bindingScope, setBindingScope] = useState("module");
  const sortedFields = useMemo(
    () => (fields || []).filter((f) => !f.trashed).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fields]
  );
  const bindingValue = bindingScope === "module"
    ? (instance?.meta?.bodyLink ?? null)
    : (occurrence?.meta?.bodyLink ?? instance?.meta?.bodyLink ?? null);
  const setBinding = (next) => {
    if (bindingScope === "module") {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { ...instance, meta: { ...(instance?.meta || {}), bodyLink: next } },
        emit: true,
      });
    } else if (occurrence?.id) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrence.id, meta: { ...(occurrence?.meta || {}), bodyLink: next } },
        emit: true,
      });
    }
  };
  return (
    <EditorBindingSection
      slot="body"
      binding={bindingValue}
      onChange={setBinding}
      scope={bindingScope}
      onScopeChange={setBindingScope}
      fields={sortedFields}
    />
  );
}

/**
 * SiblingLinksSection - Manage sibling link IDs on an instance.
 */
function SiblingLinksSection({ instance, dispatch, socket }) {
  const { instancesById } = useGridActions();
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const siblingLinks = instance?.siblingLinks || [];

  const candidates = useMemo(() => {
    const q = search.toLowerCase();
    return Object.values(instancesById || {})
      .filter(inst => inst.id !== instance?.id && !siblingLinks.includes(inst.id))
      .filter(inst => !q || (inst.label || "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [instancesById, instance?.id, siblingLinks, search]);

  const handleAdd = useCallback((targetId) => {
    if (!instance || siblingLinks.includes(targetId)) return;
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { id: instance.id, siblingLinks: [...siblingLinks, targetId] },
      emit: true,
    });
    const target = instancesById?.[targetId];
    if (target) {
      const targetSiblings = target.siblingLinks || [];
      if (!targetSiblings.includes(instance.id)) {
        CommitHelpers.updateModule({
          dispatch, socket,
          module: { id: targetId, siblingLinks: [...targetSiblings, instance.id] },
          emit: true,
        });
      }
    }
    setSearch("");
    setShowPicker(false);
  }, [instance, siblingLinks, instancesById, dispatch, socket]);

  const handleRemove = useCallback((targetId) => {
    if (!instance) return;
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { id: instance.id, siblingLinks: siblingLinks.filter(id => id !== targetId) },
      emit: true,
    });
    const target = instancesById?.[targetId];
    if (target) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: targetId, siblingLinks: (target.siblingLinks || []).filter(id => id !== instance.id) },
        emit: true,
      });
    }
  }, [instance, siblingLinks, instancesById, dispatch, socket]);

  return (
    <div className="py-2">
      <h4 className="text-xs font-semibold text-foreground/70 mb-2">Sibling Links</h4>
      <p className="text-[10px] text-muted-foreground/60 mb-2">
        Linked instances appear together in the focused view (e.g. Q↔A pairs).
      </p>

      {siblingLinks.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {siblingLinks.map((linkId) => {
            const linked = instancesById?.[linkId];
            return (
              <span
                key={linkId}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-primary/10 text-primary/80 border border-primary/20"
              >
                {linked?.label || linkId.slice(0, 10) + "…"}
                <button
                  type="button"
                  className="hover:text-red-400 transition-colors"
                  onClick={() => handleRemove(linkId)}
                  aria-label="Remove sibling link"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {showPicker ? (
        <div className="border border-border rounded-md overflow-hidden">
          <Input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search instances…"
            className="h-7 text-xs border-0 border-b border-border rounded-none"
          />
          <div className="max-h-36 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-2 py-2 text-[10px] text-muted-foreground/50 italic">No matches</div>
            ) : candidates.map(inst => (
              <button
                key={inst.id}
                type="button"
                onClick={() => handleAdd(inst.id)}
                className="w-full text-left px-2 py-1 text-xs hover:bg-muted/30 transition-colors flex items-center gap-1"
              >
                <span className="text-muted-foreground/50 font-mono text-[9px]">↗</span>
                {inst.label || "(unlabeled)"}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2 gap-1"
          onClick={() => setShowPicker(true)}
        >
          <Plus className="h-3 w-3" /> Link sibling
        </Button>
      )}
    </div>
  );
}

/**
 * OtherPlacements — shows where else this module appears in the grid
 */
function OtherPlacements({ moduleId, excludeOccId, occurrencesById, modulesById }) {
  const placements = useMemo(
    () => getOtherOccurrences(occurrencesById, modulesById, moduleId, excludeOccId),
    [occurrencesById, modulesById, moduleId, excludeOccId]
  );
  if (placements.length === 0) return null;
  return (
    <>
      <Separator />
      <div className="py-2">
        <h4 className="text-xs font-semibold text-foreground/70 mb-2">Other Placements ({placements.length})</h4>
        <div className="space-y-1">
          {placements.map(({ occurrence: occ, parentLabel }) => (
            <div key={occ.id} className="flex items-center gap-2 text-[10px] text-muted-foreground px-1 py-0.5 rounded bg-muted/20">
              <span className="text-muted-foreground/50">&#x2192;</span>
              <span className="truncate">{parentLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * LinkSettingsSection — turns a textblock mini-block into a clickable link.
 * Writes occurrence.meta.link, which TextblockCard renders as a chip:
 *   - { kind: "url", url }          → opens the URL in a new tab
 *   - { kind: "occurrence", occId } → navigates to + flashes that occurrence
 * Three modes: None / URL / In-app (search any occurrence by label).
 */
function LinkSettingsSection({ occurrence, dispatch, socket, occurrencesById, modulesById }) {
  const link = occurrence?.meta?.link || null;
  const isInternal = !!(link && (link.occId || link.target || link.kind === "occurrence"));
  const isUrl = !!(link && !isInternal && (link.url || link.kind === "url"));
  const mode = isInternal ? "internal" : isUrl ? "url" : "none";
  const [search, setSearch] = useState("");

  const setLink = useCallback((next) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket, emit: true,
      occurrence: { ...occurrence, meta: { ...(occurrence.meta || {}), link: next } },
    });
  }, [occurrence, dispatch, socket]);

  const targetId = link?.occId || link?.target || null;
  const targetLabel = useMemo(() => {
    if (!targetId) return null;
    const o = occurrencesById?.[targetId];
    return o ? (modulesById?.[o.moduleId]?.label || targetId) : targetId;
  }, [targetId, occurrencesById, modulesById]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const o of Object.values(occurrencesById || {})) {
      if (o.id === occurrence?.id) continue;
      const m = modulesById?.[o.moduleId];
      const label = m?.label;
      if (!label || !label.toLowerCase().includes(q)) continue;
      out.push({ id: o.id, label, role: m.role });
      if (out.length >= 12) break;
    }
    return out;
  }, [search, occurrencesById, modulesById, occurrence?.id]);

  const tabBtn = (m, txt) => (
    <button
      type="button"
      onClick={() => {
        if (m === "none") setLink(null);
        else if (m === "url") setLink({ kind: "url", url: link?.url || "" });
        else setLink({ kind: "occurrence", occId: targetId || "" });
      }}
      className={`text-[10px] px-2 py-0.5 rounded border ${mode === m ? "bg-accent-blue/20 border-accent-blue text-foreground" : "border-border text-muted-foreground"}`}
    >{txt}</button>
  );

  return (
    <>
      <Separator />
      <div className="py-2 space-y-2">
        <h4 className="text-xs font-semibold text-foreground/70">Link</h4>
        <div className="flex gap-1">{tabBtn("none", "None")}{tabBtn("url", "URL")}{tabBtn("internal", "In-app")}</div>

        {mode === "url" && (
          <Input
            value={link?.url || ""}
            onChange={(e) => setLink({ kind: "url", url: e.target.value })}
            placeholder="https://…"
            className="h-7 text-[11px]"
          />
        )}

        {mode === "internal" && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground">
              Target: {targetLabel ? <span className="text-foreground">{targetLabel}</span> : <span className="opacity-60">— pick one —</span>}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search pages / containers / items…"
              className="h-7 text-[11px]"
            />
            {matches.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {matches.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setLink({ kind: "occurrence", occId: o.id }); setSearch(""); }}
                    className={`w-full text-left text-[10px] px-2 py-0.5 rounded border ${o.id === targetId ? "bg-accent-blue/20 border-accent-blue" : "border-border bg-muted/20"}`}
                  >
                    {o.label} <span className="opacity-45">{o.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          {mode === "url" ? "Opens in a new tab when clicked."
            : mode === "internal" ? "Navigates to + highlights the item when clicked."
            : "This textblock renders as normal editable text."}
        </p>
      </div>
    </>
  );
}
