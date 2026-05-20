// forms/InstanceForm.jsx
import React, { useState, useCallback, useContext, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import { X, Eye, EyeOff, Hash, Plus } from "lucide-react";
import CategoryPathPicker from "./CategoryPathPicker";
import EditorBindingSection from "./EditorBindingSection.jsx";
import StyleEditor from "./StyleEditor";
import { GridActionsContext } from "../GridActionsContext";
import { getOtherOccurrences } from "../state/selectors";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const { fieldsById, containersById, panelsById, occurrencesById, modulesById } = useContext(GridActionsContext);

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

  const [localBindings, setLocalBindings] = useState(() =>
    instance?.fieldBindings || []
  );

  const allFields = Object.values(fieldsById || {});
  const panels = Object.values(panelsById || {});
  const containers = Object.values(containersById || {});

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
            inheritLabel="Container / Panel"
          />
        </TabsContent>

        {/* FIELDS TAB */}
        <TabsContent value="fields" className="max-h-[55vh] overflow-y-auto px-3 pb-2 mt-1">
          <FieldsSection
            instance={instance}
            localBindings={localBindings}
            setLocalBindings={setLocalBindings}
            allFields={allFields}
            fieldsById={fieldsById}
            panels={panels}
            containers={containers}
            dispatch={dispatch}
            socket={socket}
          />

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
            const ok = window.confirm(
              `Remove this instance from the container? The module will remain in the Command Center.`
            );
            if (!ok) return;
            onDeleteInstance?.();
          }}
          disabled={!onDeleteInstance}
        >
          Remove from container
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
  const { instancesById } = useContext(GridActionsContext);
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
 * FieldsSection — CategoryPathPicker (set to fields) drives attach/detach.
 * Field creation, renaming, type changes, and deletion live exclusively in
 * the Command Center → Fields tab. This popover only binds/unbinds fields
 * and toggles per-binding visibility.
 */
function FieldsSection({
  instance,
  localBindings,
  setLocalBindings,
  allFields,
  fieldsById,
  dispatch,
  socket,
}) {
  const boundFieldIds = useMemo(
    () => new Set(localBindings.map(b => b.fieldId).filter(Boolean)),
    [localBindings]
  );

  // Single-category picker exposing the grid's fields, minus the ones already
  // bound. One click commits — no drilling past the category step.
  const pickerConfig = useMemo(() => ({
    placeholder: "Add field",
    categories: [{
      id: "fields",
      label: "Pick a field to bind",
      description: "Fields are created and edited in Command Center → Fields.",
      icon: Hash,
      color: "rgba(168,85,247,0.7)",
      resolveItems: () => allFields
        .filter(f => !boundFieldIds.has(f.id))
        .map(f => ({
          value: f.id,
          title: f.name || "(unnamed field)",
          sub: f.type || "field",
          description: f.meta?.description || `${f.type || "field"} field`,
          hasChildren: false,
        })),
    }],
  }), [allFields, boundFieldIds]);

  const commitBindings = useCallback((newBindings) => {
    setLocalBindings(newBindings);
    if (instance) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: instance.id, fieldBindings: newBindings },
        emit: true,
      });
    }
  }, [instance, dispatch, socket, setLocalBindings]);

  const handlePickField = useCallback((picked) => {
    if (!picked) return;
    // Picker commits the picked field id as a dot-joined chain. With our
    // single-flat-category config, that chain is just the field id.
    const fieldId = picked.split(".").pop();
    if (!fieldId || boundFieldIds.has(fieldId)) return;
    commitBindings([
      ...localBindings,
      { fieldId, role: "input", order: localBindings.length },
    ]);
  }, [localBindings, boundFieldIds, commitBindings]);

  const updateBinding = useCallback((fieldId, updates) => {
    commitBindings(localBindings.map(b =>
      b.fieldId === fieldId ? { ...b, ...updates } : b
    ));
  }, [localBindings, commitBindings]);

  const removeBinding = useCallback((fieldId) => {
    commitBindings(localBindings.filter(b => b.fieldId !== fieldId));
  }, [localBindings, commitBindings]);

  return (
    <div className="py-2">
      <div className="mb-2">
        <h4 className="text-xs font-semibold text-white">Fields</h4>
      </div>

      <p className="text-[10px] text-foregroundScale-2/80 mb-2">
        Attach existing fields. Create, rename, or change types in Command Center → Fields.
      </p>

      <CategoryPathPicker
        value=""
        onChange={handlePickField}
        ctx={{ fields: allFields, sources: [], localVars: [] }}
        config={pickerConfig}
      />

      {localBindings.filter(b => b.fieldId).length > 0 && (
        <div className="mt-3 space-y-1">
          {localBindings.filter(b => b.fieldId).map((binding) => {
            const field = fieldsById[binding.fieldId];
            if (!field) return null;
            return (
              <FieldBindingRow
                key={binding.fieldId}
                field={field}
                binding={binding}
                onUpdateBinding={(updates) => updateBinding(binding.fieldId, updates)}
                onRemove={() => removeBinding(binding.fieldId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * FieldBindingRow — read-only label + per-binding toggles only.
 * No field name/type/meta editing.
 */
function FieldBindingRow({ field, binding, onUpdateBinding, onRemove }) {
  const pillColor = "bg-blue-500/20 text-blue-300 border-blue-500/30";
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className={`w-full flex items-center justify-between px-2 py-1.5 ${binding.hidden ? "bg-muted/10" : "bg-muted/30"}`}>
        <div className="flex items-center gap-2 flex-1">
          <span className={`px-2 py-0.5 text-[10px] rounded-full border ${binding.hidden ? "opacity-40 " : ""}${pillColor}`}>
            {field.name || field.type}
          </span>
          <span className="text-[10px] text-muted-foreground">{field.type}</span>
        </div>
        <button
          type="button"
          title={binding.hidden ? "Show field" : "Hide field"}
          className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); onUpdateBinding({ hidden: !binding.hidden }); }}
        >
          {binding.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title="Unbind field"
          className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
