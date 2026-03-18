// ui/FieldBindingEditor.jsx
// ============================================================
// Field Binding Editor - Selects which grid-level fields to display on an instance
// Field configuration (type, mode, calculations) is managed in GridFieldsBank
// ============================================================

import { useState, useCallback, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus, GripVertical, Eye, EyeOff, Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { GridActionsContext } from "../GridActionsContext";

/**
 * FieldBindingEditor - Simplified field selector for instances
 *
 * Allows selecting which grid-level fields to display on this instance.
 * Full field configuration (type, mode, calculations, triggers) is done in GridFieldsBank.
 */
export default function FieldBindingEditor({
  binding,           // { fieldId, order?, hidden? }
  field,             // The full field object (from fieldsById)
  allFields = [],    // All available grid-level fields
  onUpdate,          // Update the binding
  onDelete,          // Remove this binding
  onOpenFieldsBank,  // Optional: open GridFieldsBank to edit the field
}) {
  const { fieldsById } = useContext(GridActionsContext);

  // Get field info (either passed field or lookup by binding.fieldId)
  const resolvedField = field || (binding?.fieldId ? fieldsById?.[binding.fieldId] : null);

  const fieldName = resolvedField?.name || "Unknown Field";
  const fieldType = resolvedField?.type || "?";
  const fieldMode = resolvedField?.mode || "input";
  const isHidden = binding?.hidden || false;

  const handleFieldSelect = useCallback((fieldId) => {
    if (!fieldId || fieldId === "__none__") {
      onDelete?.();
      return;
    }
    onUpdate?.({ ...binding, fieldId });
  }, [binding, onUpdate, onDelete]);

  const handleToggleHidden = useCallback(() => {
    onUpdate?.({ ...binding, hidden: !isHidden });
  }, [binding, isHidden, onUpdate]);

  // If no field is bound yet, show selector
  if (!resolvedField) {
    return (
      <div className="field-binding-editor border border-dashed border-border rounded-md p-3 mb-2">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <Select onValueChange={handleFieldSelect}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Add field..." />
            </SelectTrigger>
            <SelectContent>
              {allFields.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  No fields available. Create fields in the Fields Bank.
                </div>
              ) : (
                allFields.map(f => (
                  <SelectItem key={f.id} value={f.id}>
                    <div className="flex items-center gap-2">
                      <span>{f.name || f.type}</span>
                      <span className="text-[10px] text-muted-foreground">
                        ({f.type}, {f.mode})
                      </span>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onDelete?.()}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  // Show bound field with display controls
  return (
    <div className={`field-binding-editor border border-border rounded-md mb-2 overflow-hidden ${isHidden ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        {/* Drag handle (for reordering in parent) */}
        <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab flex-shrink-0" />

        {/* Field pill */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className={`px-2 py-0.5 text-xs rounded-full truncate ${
            fieldMode === "derived"
              ? "bg-purple-500/20 text-purple-400"
              : "bg-primary/20 text-primary"
          }`}>
            {fieldName}
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {fieldType}
          </span>
          {fieldMode === "derived" && (
            <span className="text-[9px] text-purple-400 flex-shrink-0">
              (calculated)
            </span>
          )}
        </div>

        {/* Field selector to change */}
        <Select value={binding?.fieldId} onValueChange={handleFieldSelect}>
          <SelectTrigger className="h-6 w-6 p-0 border-0 bg-transparent [&>svg]:hidden">
            <Settings className="h-3 w-3 text-muted-foreground" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              <span className="text-destructive">Remove binding</span>
            </SelectItem>
            {allFields.map(f => (
              <SelectItem key={f.id} value={f.id}>
                {f.name || f.type} ({f.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Toggle visibility */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={handleToggleHidden}
          title={isHidden ? "Show field" : "Hide field"}
        >
          {isHidden ? (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Eye className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>

        {/* Open field config in Fields Bank */}
        {onOpenFieldsBank && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => onOpenFieldsBank(resolvedField.id)}
            title="Edit field in Fields Bank"
          >
            Edit
          </Button>
        )}

        {/* Remove binding */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => onDelete?.()}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * FieldBindingList - List of field bindings with add button
 */
export function FieldBindingList({
  bindings = [],
  allFields = [],
  fieldsById = {},
  onUpdate,
  onAdd,
  onRemove,
  onOpenFieldsBank,
}) {
  // Filter out fields that are already bound
  const boundFieldIds = new Set(bindings.map(b => b.fieldId));
  const availableFields = allFields.filter(f => !boundFieldIds.has(f.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Display Fields</Label>
        {availableFields.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => onAdd?.({ fieldId: null })}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Field
          </Button>
        )}
      </div>

      {bindings.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-md">
          No fields bound. Click "Add Field" to select fields to display.
        </div>
      ) : (
        bindings.map((binding, index) => (
          <FieldBindingEditor
            key={binding.fieldId || index}
            binding={binding}
            field={fieldsById[binding.fieldId]}
            allFields={availableFields}
            onUpdate={(updated) => onUpdate?.(index, updated)}
            onDelete={() => onRemove?.(index)}
            onOpenFieldsBank={onOpenFieldsBank}
          />
        ))
      )}

      {bindings.length > 0 && availableFields.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs border border-dashed"
          onClick={() => onAdd?.({ fieldId: null })}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add another field
        </Button>
      )}
    </div>
  );
}
