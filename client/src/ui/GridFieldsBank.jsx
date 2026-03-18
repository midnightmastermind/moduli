// ui/GridFieldsBank.jsx
// ============================================================
// Grid-level Field Bank - Centralized field management
// All field definitions, calculations, and automations are configured here
// ============================================================

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ChevronDown, ChevronUp, Settings2, Zap, Filter } from "lucide-react";
import { uid } from "../uid";
import { OperationsBuilder } from "../blocks";
import {
  SCOPES as CALC_SCOPES,
  TIME_FILTERS,
  COMPARISONS,
} from "../helpers/CalculationHelpers";

const FIELD_TYPES = [
  { value: "number", label: "Number", defaultValue: 0 },
  { value: "text", label: "Text", defaultValue: "" },
  { value: "boolean", label: "Boolean", defaultValue: false },
  { value: "select", label: "Select", defaultValue: null },
  { value: "date", label: "Date", defaultValue: null },
  { value: "rating", label: "Rating", defaultValue: 0 },
  { value: "duration", label: "Duration", defaultValue: 0 },
];

const FIELD_MODES = [
  { value: "input", label: "Input" },
  { value: "derived", label: "Derived (Calculated)" },
];

const SCOPES = Object.entries(CALC_SCOPES).map(([value, config]) => ({
  value,
  label: config.label,
}));

const TIME_FILTER_OPTIONS = Object.entries(TIME_FILTERS).map(([value, config]) => ({
  value,
  label: config.label,
}));

const COMPARISON_OPTIONS = Object.entries(COMPARISONS).map(([value, config]) => ({
  value,
  label: config.label,
}));

const TRIGGER_EVENTS = [
  { value: "onDrop", label: "When Dropped" },
  { value: "onChange", label: "When Changed" },
  { value: "onComplete", label: "When Completed" },
];

/**
 * GridFieldsBank - Modal for managing all fields in a grid
 */
export default function GridFieldsBank({
  open,
  onOpenChange,
  gridId,
  fields = [],
  panels = [],
  containers = [],
  instances = [],
  onCreateField,
  onUpdateField,
  onDeleteField,
}) {
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Filter fields for this grid
  const gridFields = useMemo(() =>
    fields.filter(f => f.gridId === gridId),
    [fields, gridId]
  );

  const selectedField = useMemo(() =>
    gridFields.find(f => f.id === selectedFieldId),
    [gridFields, selectedFieldId]
  );

  const handleCreateNew = useCallback(() => {
    const newField = {
      id: uid(),
      gridId,
      name: "",
      type: "number",
      mode: "input",
      meta: { prefix: "", postfix: "", increment: 1 },
      metric: null,
      conditions: null,
      triggers: [],
      display: { role: "input", showLabel: true, order: 0 },
    };
    setSelectedFieldId(newField.id);
    setIsCreatingNew(true);
    // Don't save yet - wait for user to fill in details
  }, [gridId]);

  const handleSelectField = useCallback((fieldId) => {
    setSelectedFieldId(fieldId);
    setIsCreatingNew(false);
  }, []);

  const handleSaveField = useCallback((field) => {
    if (isCreatingNew) {
      onCreateField?.(field);
      setIsCreatingNew(false);
    } else {
      onUpdateField?.(field);
    }
  }, [isCreatingNew, onCreateField, onUpdateField]);

  const handleDeleteField = useCallback((fieldId) => {
    onDeleteField?.(fieldId);
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(null);
    }
  }, [selectedFieldId, onDeleteField]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Field Bank
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Field list sidebar */}
          <div className="w-48 flex flex-col border-r border-border pr-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground">Fields</Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCreateNew}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {gridFields.map(field => (
                <button
                  key={field.id}
                  onClick={() => handleSelectField(field.id)}
                  className={`
                    w-full text-left px-2 py-1.5 rounded text-sm
                    flex items-center gap-2
                    ${selectedFieldId === field.id
                      ? "bg-primary/20 text-primary"
                      : "hover:bg-muted"
                    }
                  `}
                >
                  <span className={`
                    w-2 h-2 rounded-full
                    ${field.mode === "input" ? "bg-blue-500" : "bg-purple-500"}
                  `} />
                  <span className="flex-1 truncate">{field.name || field.type}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {field.type}
                  </span>
                </button>
              ))}

              {gridFields.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No fields yet
                </div>
              )}
            </div>
          </div>

          {/* Field editor */}
          <div className="flex-1 overflow-y-auto">
            {selectedFieldId || isCreatingNew ? (
              <FieldEditor
                field={selectedField || {
                  id: selectedFieldId,
                  gridId,
                  name: "",
                  type: "number",
                  mode: "input",
                  meta: {},
                  metric: null,
                  conditions: null,
                  triggers: [],
                  display: { role: "input", showLabel: true, order: 0 },
                }}
                allFields={gridFields}
                panels={panels}
                containers={containers}
                instances={instances}
                isNew={isCreatingNew}
                onSave={handleSaveField}
                onDelete={() => handleDeleteField(selectedFieldId)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a field or create a new one
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FieldEditor - Full editor for a single field
 */
function FieldEditor({
  field,
  allFields,
  panels,
  containers,
  instances,
  isNew,
  onSave,
  onDelete,
}) {
  const [localField, setLocalField] = useState(field);
  const [activeTab, setActiveTab] = useState("basic");

  // Reset when field changes
  useMemo(() => {
    setLocalField(field);
  }, [field.id]);

  const handleChange = useCallback((key, value) => {
    setLocalField(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleMetaChange = useCallback((key, value) => {
    setLocalField(prev => ({
      ...prev,
      meta: { ...(prev.meta || {}), [key]: value },
    }));
  }, []);

  const handleMetricChange = useCallback((key, value) => {
    setLocalField(prev => ({
      ...prev,
      metric: { ...(prev.metric || {}), [key]: value },
    }));
  }, []);

  const handleDisplayChange = useCallback((key, value) => {
    setLocalField(prev => ({
      ...prev,
      display: { ...(prev.display || {}), [key]: value },
    }));
  }, []);

  const handleConditionsChange = useCallback((blockTree) => {
    setLocalField(prev => ({
      ...prev,
      conditions: { ...(prev.conditions || {}), blockTree },
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave(localField);
  }, [localField, onSave]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="calculation">Calculation</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
        </TabsList>

        {/* Basic Settings */}
        <TabsContent value="basic" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Field Name</Label>
              <Input
                value={localField.name || ""}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="Field name"
              />
            </div>

            <div>
              <Label>Type</Label>
              <Select
                value={localField.type}
                onValueChange={(v) => handleChange("type", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Mode</Label>
              <Select
                value={localField.mode}
                onValueChange={(v) => {
                  handleChange("mode", v);
                  if (v === "derived" && !localField.metric) {
                    handleChange("metric", { scope: "container", blockTree: null });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Display Role</Label>
              <Select
                value={localField.display?.role || "input"}
                onValueChange={(v) => handleDisplayChange("role", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">Input</SelectItem>
                  <SelectItem value="display">Display Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Number-specific settings */}
          {localField.type === "number" && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Prefix</Label>
                <Input
                  value={localField.meta?.prefix || ""}
                  onChange={(e) => handleMetaChange("prefix", e.target.value)}
                  placeholder="$"
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Postfix</Label>
                <Input
                  value={localField.meta?.postfix || ""}
                  onChange={(e) => handleMetaChange("postfix", e.target.value)}
                  placeholder="kg"
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Increment</Label>
                <Input
                  type="number"
                  value={localField.meta?.increment ?? 1}
                  onChange={(e) => handleMetaChange("increment", Number(e.target.value))}
                  className="h-8"
                />
              </div>
            </div>
          )}

          {/* Select options */}
          {localField.type === "select" && (
            <SelectOptionsEditor
              options={localField.meta?.options || []}
              onChange={(options) => handleMetaChange("options", options)}
            />
          )}
        </TabsContent>

        {/* Calculation Tab */}
        <TabsContent value="calculation" className="space-y-4 mt-4">
          {localField.mode === "derived" ? (
            <>
              <OperationsBuilder
                initialBlocks={localField.metric?.blockTree || null}
                availableFields={allFields}
                context={{
                  scope: localField.metric?.scope || "container",
                  timeFilter: localField.metric?.timeFilter || "all",
                }}
                onChange={(blockTree) => handleMetricChange("blockTree", blockTree)}
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Scope</Label>
                  <Select
                    value={localField.metric?.scope || "container"}
                    onValueChange={(v) => handleMetricChange("scope", v)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Time Period</Label>
                  <Select
                    value={localField.metric?.timeFilter || "all"}
                    onValueChange={(v) => handleMetricChange("timeFilter", v)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_FILTER_OPTIONS.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Allowed Fields - Configure which fields and destinations to include */}
              <div className="pt-3 border-t">
                <AllowedFieldsEditor
                  allowedFields={localField.metric?.allowedFields || []}
                  allFields={allFields}
                  panels={panels}
                  containers={containers}
                  onChange={(allowedFields) => handleMetricChange("allowedFields", allowedFields)}
                />
              </div>

              {/* Target */}
              {localField.type === "number" && (
                <div className="pt-2 border-t">
                  <Label className="text-xs">Target</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Select
                      value={localField.metric?.target?.op || ">="}
                      onValueChange={(v) => handleMetricChange("target", {
                        ...(localField.metric?.target || {}),
                        op: v,
                      })}
                    >
                      <SelectTrigger className="h-8 w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPARISON_OPTIONS.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={localField.metric?.target?.value ?? ""}
                      onChange={(e) => handleMetricChange("target", {
                        ...(localField.metric?.target || {}),
                        op: localField.metric?.target?.op || ">=",
                        value: e.target.value === "" ? undefined : Number(e.target.value),
                      })}
                      placeholder="Target value"
                      className="h-8 w-24"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground text-sm text-center py-8">
              Switch to "Derived" mode to configure calculations
            </div>
          )}
        </TabsContent>

        {/* Conditions Tab */}
        <TabsContent value="conditions" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground mb-4">
            Define when this field should be active. Leave empty to always be active.
          </div>

          <OperationsBuilder
            initialBlocks={localField.conditions?.blockTree || null}
            availableFields={allFields}
            context={{ panels, containers, instances }}
            onChange={handleConditionsChange}
          />

          {/* Quick filters */}
          <div className="pt-4 border-t space-y-3">
            <Label className="text-xs text-muted-foreground">Quick Filters</Label>

            <div>
              <Label className="text-xs">Only in Panels</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {panels.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const current = localField.conditions?.panelIds || [];
                      const updated = current.includes(p.id)
                        ? current.filter(id => id !== p.id)
                        : [...current, p.id];
                      setLocalField(prev => ({
                        ...prev,
                        conditions: { ...(prev.conditions || {}), panelIds: updated },
                      }));
                    }}
                    className={`
                      px-2 py-0.5 text-xs rounded
                      ${(localField.conditions?.panelIds || []).includes(p.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                      }
                    `}
                  >
                    {p.label || "Panel"}
                  </button>
                ))}
                {panels.length === 0 && (
                  <span className="text-xs text-muted-foreground">No panels</span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs">Only for Instance Types</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {instances.map(i => (
                  <button
                    key={i.id}
                    onClick={() => {
                      const current = localField.conditions?.instanceIds || [];
                      const updated = current.includes(i.id)
                        ? current.filter(id => id !== i.id)
                        : [...current, i.id];
                      setLocalField(prev => ({
                        ...prev,
                        conditions: { ...(prev.conditions || {}), instanceIds: updated },
                      }));
                    }}
                    className={`
                      px-2 py-0.5 text-xs rounded
                      ${(localField.conditions?.instanceIds || []).includes(i.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                      }
                    `}
                  >
                    {i.label || "Instance"}
                  </button>
                ))}
                {instances.length === 0 && (
                  <span className="text-xs text-muted-foreground">No instances</span>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Triggers Tab */}
        <TabsContent value="triggers" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground mb-4">
            Automations that run when events occur.
          </div>

          <TriggersEditor
            triggers={localField.triggers || []}
            allFields={allFields}
            onChange={(triggers) => handleChange("triggers", triggers)}
          />
        </TabsContent>
      </Tabs>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          disabled={isNew}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Delete Field
        </Button>

        <Button onClick={handleSave}>
          {isNew ? "Create Field" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/**
 * SelectOptionsEditor - Editor for select field options
 */
function SelectOptionsEditor({ options, onChange }) {
  const [newLabel, setNewLabel] = useState("");

  const addOption = useCallback(() => {
    if (!newLabel.trim()) return;
    const value = newLabel.toLowerCase().replace(/\s+/g, "_");
    onChange([...options, { value, label: newLabel.trim() }]);
    setNewLabel("");
  }, [newLabel, options, onChange]);

  return (
    <div className="space-y-2">
      <Label className="text-xs">Select Options</Label>
      <div className="space-y-1">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={opt.label}
              onChange={(e) => {
                const updated = options.map((o, idx) =>
                  idx === i ? { ...o, label: e.target.value } : o
                );
                onChange(updated);
              }}
              className="h-7 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addOption()}
          placeholder="Add option..."
          className="h-7 text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={addOption}
          disabled={!newLabel.trim()}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * AllowedFieldsEditor - Configure which fields and destinations to include in calculations
 */
function AllowedFieldsEditor({ allowedFields = [], allFields, panels, containers, onChange }) {
  const addAllowedField = useCallback(() => {
    onChange([
      ...allowedFields,
      {
        fieldId: null,
        destinations: [],
        flowFilter: "any",
      },
    ]);
  }, [allowedFields, onChange]);

  const updateAllowedField = useCallback((index, updates) => {
    onChange(
      allowedFields.map((af, i) => (i === index ? { ...af, ...updates } : af))
    );
  }, [allowedFields, onChange]);

  const removeAllowedField = useCallback((index) => {
    onChange(allowedFields.filter((_, i) => i !== index));
  }, [allowedFields, onChange]);

  const addDestination = useCallback((fieldIndex) => {
    const af = allowedFields[fieldIndex];
    updateAllowedField(fieldIndex, {
      destinations: [
        ...(af.destinations || []),
        { id: null, timeFilter: "all" },
      ],
    });
  }, [allowedFields, updateAllowedField]);

  const updateDestination = useCallback((fieldIndex, destIndex, updates) => {
    const af = allowedFields[fieldIndex];
    const newDests = (af.destinations || []).map((d, i) =>
      i === destIndex ? { ...d, ...updates } : d
    );
    updateAllowedField(fieldIndex, { destinations: newDests });
  }, [allowedFields, updateAllowedField]);

  const removeDestination = useCallback((fieldIndex, destIndex) => {
    const af = allowedFields[fieldIndex];
    updateAllowedField(fieldIndex, {
      destinations: (af.destinations || []).filter((_, i) => i !== destIndex),
    });
  }, [allowedFields, updateAllowedField]);

  // Build destination options
  const destinationOptions = useMemo(() => {
    const opts = [];
    panels.forEach(p => {
      opts.push({ value: `panel:${p.id}`, label: `Panel: ${p.label || p.id}`, type: "panel" });
    });
    containers.forEach(c => {
      opts.push({ value: `container:${c.id}`, label: `Container: ${c.label || c.id}`, type: "container" });
    });
    return opts;
  }, [panels, containers]);

  // Only show input fields as source options
  const inputFields = useMemo(() =>
    allFields.filter(f => f.mode === "input"),
    [allFields]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Source Fields</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={addAllowedField}
          className="h-6 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Field
        </Button>
      </div>

      {allowedFields.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded">
          No source fields configured. Add fields to define what values to aggregate.
        </div>
      )}

      {allowedFields.map((af, fieldIndex) => (
        <div key={fieldIndex} className="border rounded-lg p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            {/* Field selector */}
            <Select
              value={af.fieldId || ""}
              onValueChange={(v) => updateAllowedField(fieldIndex, { fieldId: v })}
            >
              <SelectTrigger className="h-7 flex-1">
                <SelectValue placeholder="Select field..." />
              </SelectTrigger>
              <SelectContent>
                {inputFields.map(f => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name || f.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Flow filter — multiselect for in/out/replace */}
            <div className="flex items-center gap-0.5">
              {[
                { key: "in", label: "In", color: "text-green-400 border-green-500/40 bg-green-500/10" },
                { key: "out", label: "Out", color: "text-red-400 border-red-500/40 bg-red-500/10" },
                { key: "replace", label: "=", color: "text-blue-400 border-blue-500/40 bg-blue-500/10" },
              ].map(opt => {
                // Support legacy string format and new array format
                const currentFilter = af.flowFilter || "any";
                const selectedFlows = currentFilter === "any" ? ["in", "out", "replace"]
                  : Array.isArray(currentFilter) ? currentFilter
                  : [currentFilter];
                const isActive = selectedFlows.includes(opt.key);

                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      let newFlows;
                      if (isActive) {
                        newFlows = selectedFlows.filter(f => f !== opt.key);
                        if (newFlows.length === 0) newFlows = [opt.key]; // Can't deselect all
                      } else {
                        newFlows = [...selectedFlows, opt.key];
                      }
                      // If all 3 selected, store as "any" for backwards compat
                      const flowFilter = newFlows.length === 3 ? "any" : newFlows;
                      updateAllowedField(fieldIndex, { flowFilter });
                    }}
                    className={`
                      px-1.5 py-0.5 text-[10px] rounded border transition-colors
                      ${isActive ? opt.color + " font-semibold" : "text-muted-foreground/40 border-border/40 opacity-40"}
                    `}
                    title={`${isActive ? "Exclude" : "Include"} ${opt.label} flows`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Delete button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeAllowedField(fieldIndex)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          {/* Destinations */}
          <div className="pl-4 border-l-2 border-muted space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">From destinations:</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addDestination(fieldIndex)}
                className="h-5 text-[10px] px-1"
              >
                <Plus className="h-2 w-2 mr-0.5" />
                Add
              </Button>
            </div>

            {(af.destinations || []).length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">
                All locations (no filter)
              </span>
            )}

            {(af.destinations || []).map((dest, destIndex) => (
              <div key={destIndex} className="flex items-center gap-1">
                <Select
                  value={dest.id || ""}
                  onValueChange={(v) => updateDestination(fieldIndex, destIndex, { id: v })}
                >
                  <SelectTrigger className="h-6 text-[10px] flex-1">
                    <SelectValue placeholder="Select location..." />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={dest.timeFilter || "all"}
                  onValueChange={(v) => updateDestination(fieldIndex, destIndex, { timeFilter: v })}
                >
                  <SelectTrigger className="h-6 text-[10px] w-16">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_FILTER_OPTIONS.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => removeDestination(fieldIndex, destIndex)}
                >
                  <Trash2 className="h-2 w-2" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * TriggersEditor - Editor for field triggers/automations
 */
function TriggersEditor({ triggers, allFields, onChange }) {
  const addTrigger = useCallback(() => {
    onChange([...triggers, {
      event: "onDrop",
      blockTree: null,
      targetFieldId: null,
      action: "set",
      value: null,
    }]);
  }, [triggers, onChange]);

  const updateTrigger = useCallback((index, key, value) => {
    onChange(triggers.map((t, i) =>
      i === index ? { ...t, [key]: value } : t
    ));
  }, [triggers, onChange]);

  const removeTrigger = useCallback((index) => {
    onChange(triggers.filter((_, i) => i !== index));
  }, [triggers, onChange]);

  return (
    <div className="space-y-3">
      {triggers.map((trigger, index) => (
        <div key={index} className="p-3 border rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <Select
                value={trigger.event}
                onValueChange={(v) => updateTrigger(index, "event", v)}
              >
                <SelectTrigger className="h-7 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_EVENTS.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeTrigger(index)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          <OperationsBuilder
            initialBlocks={trigger.blockTree}
            availableFields={allFields}
            onChange={(blockTree) => updateTrigger(index, "blockTree", blockTree)}
            compact
          />
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={addTrigger}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-1" />
        Add Trigger
      </Button>
    </div>
  );
}

export { GridFieldsBank };
