// blocks/StepValueField.jsx — an operation step's value, drawn as the field's own control (ExprOrPath's "value" mode).
// The same `Field` a row and a button's form draw, with its options resolved the same way (ui/FieldPickerPanel).
import React, { useMemo } from "react";
import Field from "../ui/Field.jsx";
import { useGridActions } from "../GridActionsContext";
import { resolveOptions } from "../helpers/optionsResolver";
import { decodeStepValue, encodeStepValue } from "../helpers/stepValue";

export default function StepValueField({ field, value, onChange }) {
  const { getOccMap, modulesById, fieldsById, foldersById } = useGridActions() || {};
  // A display field is written by operations, which is what this step does: here it takes input like any other.
  const editable = useMemo(() => {
    const base = { ...field, inputEnabled: true, displayEnabled: false };
    if (field?.type !== "select" && field?.type !== "occurrence") return base;
    let resolved = { options: [], totalMatched: 0 };
    try {
      resolved = resolveOptions(field, { occurrencesById: getOccMap?.() || {}, modulesById, fieldsById, foldersById }, null) || resolved;
    } catch { /* a pool that cannot resolve shows no choices, never a crash */ }
    return { ...base, meta: { ...base.meta, _resolvedOptions: resolved.options, _totalMatched: resolved.totalMatched } };
  }, [field, getOccMap, modulesById, fieldsById, foldersById]);
  const write = (v) => onChange(encodeStepValue(v, field));
  return (
    <div data-testid="step-value-field" style={{ minWidth: 160, maxWidth: 340 }}>
      <Field field={editable} binding={{ fieldId: field.id, role: "input" }} compact={false} hideName
        value={decodeStepValue(value) ?? null} flow={field.meta?.flow || "in"} onChange={write} onCommit={write} />
    </div>
  );
}
