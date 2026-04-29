// forms/InstanceForm.jsx
import React, { useState, useCallback, useContext, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, X, Eye, EyeOff } from "lucide-react";
import MultiSelectPills from "./MultiSelectPills";
import StyleEditor from "./StyleEditor";
import { GridActionsContext } from "../GridActionsContext";
import { getOtherOccurrences } from "../state/selectors";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { uid } from "../uid";
import { INPUT_FLOWS } from "../helpers/CalculationHelpers";
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

// Flow options for input fields
const INPUT_FLOW_OPTIONS = Object.entries(INPUT_FLOWS).map(([value, config]) => ({
  value,
  label: config.label,
}));

// Field type options
const FIELD_TYPES = [
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
];

/**
 * FieldsSection - MultiSelect-based field binding management
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
  const fieldOptions = useMemo(() => {
    return allFields.map(f => ({
      value: f.id,
      label: f.name || f.type,
      description: `${f.type}`,
      color: f.inputEnabled
        ? "bg-blue-500/20 text-blue-300"
        : "bg-violet-500/20 text-violet-300",
    }));
  }, [allFields]);

  const selectedFieldIds = useMemo(() => {
    return localBindings.map(b => b.fieldId).filter(Boolean);
  }, [localBindings]);

  const handleFieldSelectionChange = useCallback((selectedIds) => {
    const newBindings = selectedIds.map((fieldId, index) => {
      const existing = localBindings.find(b => b.fieldId === fieldId);
      if (existing) return existing;
      return { fieldId, role: "input", order: index };
    });
    setLocalBindings(newBindings);
    if (instance) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: instance.id, fieldBindings: newBindings },
        emit: true,
      });
    }
  }, [localBindings, instance, dispatch, socket, setLocalBindings]);

  const addNewField = useCallback(() => {
    const newFieldId = uid();
    const newField = {
      id: newFieldId,
      name: "",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { prefix: "", postfix: "", increment: 1 },
    };
    CommitHelpers.createField({ dispatch, socket, field: newField, emit: true });
    const newBinding = { fieldId: newFieldId, role: "input", order: localBindings.length };
    const newBindings = [...localBindings, newBinding];
    setLocalBindings(newBindings);
    if (instance) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: instance.id, fieldBindings: newBindings },
        emit: true,
      });
    }
  }, [localBindings, instance, dispatch, socket, setLocalBindings]);

  const updateField = useCallback((field) => {
    CommitHelpers.updateField({ dispatch, socket, field, emit: true });
  }, [dispatch, socket]);

  const updateBinding = useCallback((fieldId, updates) => {
    const newBindings = localBindings.map(b =>
      b.fieldId === fieldId ? { ...b, ...updates } : b
    );
    setLocalBindings(newBindings);
    if (instance) {
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: instance.id, fieldBindings: newBindings },
        emit: true,
      });
    }
  }, [localBindings, instance, dispatch, socket, setLocalBindings]);

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-white">Fields</h4>
        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={addNewField}>
          <Plus className="h-3 w-3 mr-1" />
          Add New Field
        </Button>
      </div>

      <p className="text-[10px] text-foregroundScale-2/80 mb-2">
        Select existing fields or add new ones.
      </p>

      <MultiSelectPills
        options={fieldOptions}
        selected={selectedFieldIds}
        onChange={handleFieldSelectionChange}
        placeholder="Select existing fields..."
        emptyMessage="No fields defined yet"
        compact
      />

      {localBindings.filter(b => b.fieldId).length > 0 && (
        <div className="mt-3 space-y-2">
          {localBindings.filter(b => b.fieldId).map((binding) => {
            const field = fieldsById[binding.fieldId];
            if (!field) return null;
            return (
              <FieldBindingRow
                key={binding.fieldId}
                field={field}
                binding={binding}
                allFields={allFields}
                onUpdateField={updateField}
                onUpdateBinding={(updates) => updateBinding(binding.fieldId, updates)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * FieldBindingRow - Individual field binding with full field editing
 */
function FieldBindingRow({ field, binding, allFields, onUpdateField, onUpdateBinding }) {
  const [expanded, setExpanded] = useState(false);
  const pillColor = "bg-blue-500/20 text-blue-300 border-blue-500/30";

  const handleFieldChange = useCallback((key, value) => {
    onUpdateField({ ...field, [key]: value });
  }, [field, onUpdateField]);

  const handleMetaChange = useCallback((key, value) => {
    onUpdateField({ ...field, meta: { ...(field.meta || {}), [key]: value } });
  }, [field, onUpdateField]);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className={`w-full flex items-center justify-between px-2 py-1.5 ${binding.hidden ? "bg-muted/10" : "bg-muted/30"} hover:bg-muted/50`}>
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
          <span className={`px-2 py-0.5 text-[10px] rounded-full border ${binding.hidden ? "opacity-40 " : ""}${pillColor}`}>
            {field.name || field.type}
          </span>
          <span className="text-[10px] text-muted-foreground">{field.type}</span>
        </button>
        <button
          type="button"
          title={binding.hidden ? "Show field" : "Hide field"}
          className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); onUpdateBinding({ hidden: !binding.hidden }); }}
        >
          {binding.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      </div>

      {expanded && (
        <div className="p-2 space-y-3 border-t border-border">
          <Input
            type="text"
            value={field.name || ""}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            placeholder="Field name"
            className="h-7 text-xs w-full"
          />

          <div className="space-y-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Type</Label>
              <Select value={field.type} onValueChange={(v) => handleFieldChange("type", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {field.type === "number" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Prefix</Label>
                  <Input
                    type="text"
                    value={field.meta?.prefix || ""}
                    onChange={(e) => handleMetaChange("prefix", e.target.value)}
                    placeholder="e.g., $"
                    className="h-6 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Postfix</Label>
                  <Input
                    type="text"
                    value={field.meta?.postfix || ""}
                    onChange={(e) => handleMetaChange("postfix", e.target.value)}
                    placeholder="e.g., kg"
                    className="h-6 text-xs"
                  />
                </div>
              </div>
            )}

            {field.type === "number" && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Flow (how value affects aggregates)</Label>
                <Select
                  value={field.meta?.flow || "in"}
                  onValueChange={(v) => handleMetaChange("flow", v)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INPUT_FLOW_OPTIONS.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
