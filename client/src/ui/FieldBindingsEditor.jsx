// ui/FieldBindingsEditor.jsx
// ============================================================
// THE ONE add-a-field-to-a-thing editor, for EVERY role.
//
// Until now the only way to bind a field to a non-instance occurrence was a
// MIGRATION: `InstanceForm`'s Fields tab was the sole authoring surface, and it
// only ever renders for `role: "instance"`. Containers, pages and panels can
// carry fields perfectly well — `resolveOccurrenceFields` renders them and
// `OccurrenceFields` mounts on all of them — so the gap was authoring, not
// capability.
//
// ONE EDITOR, NOT FOUR. This is mounted by InstanceForm, ContainerForm,
// LayoutForm (panels) and FieldBindingsSection (pages). Four copies of a
// binding editor is exactly the drift this repo keeps paying for; the editor
// knows nothing about which role it is editing, because a binding does not.
//
// ── IT DERIVES FROM THE MODULE, IT DOES NOT CACHE IT ────────────────────────
//
// The version this replaces held `useState(() => instance?.fieldBindings || [])`,
// seeded ONCE. That is stale the moment anything else writes the module — a
// migration, another window, or an inherited auto-applied list changing. Every
// commit here goes through `CommitHelpers.updateModule`, which dispatches
// LOCALLY BEFORE it emits, so deriving from the prop is immediate AND correct.
//
// ── GRID-GIVEN FIELDS ARE SHOWN, NOT HIDDEN ────────────────────────────────
//
// `grid.meta.autoAppliedFieldIds` gives every occurrence a field through a
// SYNTHESIZED binding — nothing is written to the module. So a user opens this
// editor, sees Tags rendering on the occurrence, and does not find it in the
// list. That reads as a bug. Auto-applied fields are listed as their own section,
// marked as coming from the grid, with the one action that makes sense on them:
// BIND, which writes an explicit binding so this module can say something
// specific about the field (show it, order it, change its role). That is the
// precedence `resolveOccurrenceFields` already implements — an explicit binding
// outranks the grid default — surfaced rather than left implicit.
// ============================================================

import React, { useCallback, useMemo } from "react";
import { X, Eye, EyeOff, Hash, Link2, ChevronUp, ChevronDown } from "lucide-react";
import DrilldownPicker from "./DrilldownPicker";
import { useGridActions } from "../GridActionsContext";
import { gridAutoAppliedFieldIds } from "../helpers/autoAppliedFields";
import { sortBindingsForDisplay, moveBinding } from "../helpers/fieldBindingOrder";
import * as CommitHelpers from "../helpers/CommitHelpers";

/**
 * @param module      the module whose `fieldBindings` are edited (required)
 * @param title       section heading
 * @param hint        one-line explanation under the heading
 */
export default function FieldBindingsEditor({
  module,
  title = "Fields",
  hint = "Attach existing fields. Create, rename, or change types in Command Center → Fields.",
}) {
  const { fieldsById, state, dispatch, socket } = useGridActions();

  const allFields = useMemo(() => Object.values(fieldsById || {}), [fieldsById]);

  // DERIVED, never cached — see the header note.
  const bindings = useMemo(
    () => (Array.isArray(module?.fieldBindings) ? module.fieldBindings : []),
    [module]
  );

  const boundFieldIds = useMemo(
    () => new Set(bindings.map((b) => b.fieldId).filter(Boolean)),
    [bindings]
  );

  // Auto-applied ids the module does NOT already bind. One it DOES bind is an
  // ordinary row — the explicit binding is what is in force.
  const gridGivenIds = useMemo(
    () => gridAutoAppliedFieldIds(state?.grid).filter((id) => !boundFieldIds.has(id) && fieldsById?.[id]),
    [state?.grid, boundFieldIds, fieldsById]
  );

  const commit = useCallback((next) => {
    if (!module?.id) return;
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { id: module.id, fieldBindings: next },
      emit: true,
    });
  }, [module?.id, dispatch, socket]);

  // One flat category — a field is picked in one click, no drilling.
  const pickerConfig = useMemo(() => ({
    placeholder: "Add field",
    categories: [{
      id: "fields",
      label: "Pick a field to bind",
      description: "Fields are created and edited in Command Center → Fields.",
      icon: Hash,
      color: "rgba(168,85,247,0.7)",
      resolveItems: () => allFields
        .filter((f) => !boundFieldIds.has(f.id))
        .map((f) => ({
          value: f.id,
          title: f.name || "(unnamed field)",
          sub: f.type || "field",
          description: f.meta?.description || `${f.type || "field"} field`,
          hasChildren: false,
        })),
    }],
  }), [allFields, boundFieldIds]);

  const handlePick = useCallback((picked) => {
    if (!picked) return;
    // The picker commits a dot-joined chain; with one flat category that chain
    // IS the field id.
    const fieldId = String(picked).split(".").pop();
    if (!fieldId || boundFieldIds.has(fieldId)) return;
    commit([...bindings, { fieldId, role: "input", order: bindings.length }]);
  }, [bindings, boundFieldIds, commit]);

  const updateBinding = useCallback((fieldId, updates) => {
    commit(bindings.map((b) => (b.fieldId === fieldId ? { ...b, ...updates } : b)));
  }, [bindings, commit]);

  const removeBinding = useCallback((fieldId) => {
    commit(bindings.filter((b) => b.fieldId !== fieldId));
  }, [bindings, commit]);

  // Move a field one place. `moveBinding` renumbers the WHOLE module rather than
  // swapping two values — against this grid's real data (287 modules with
  // duplicate orders, 464 with gaps, 80 with none at all) a swap moves a row an
  // unpredictable distance. It returns null for a no-op, which is what keeps a
  // press on a disabled edge from minting a transaction.
  const moveField = useCallback((fieldId, delta) => {
    const next = moveBinding(bindings, fieldId, delta);
    if (next) commit(next);
  }, [bindings, commit]);

  // Make the grid's default explicit on THIS module so it can be shown/ordered.
  // Born visible, because binding it by hand is the act of asking for it —
  // unlike the grid default, which lands on every occurrence at once and must
  // stay hidden.
  const bindGridField = useCallback((fieldId) => {
    commit([...bindings, { fieldId, role: "input", order: bindings.length, hidden: false }]);
  }, [bindings, commit]);

  if (!module?.id) return null;

  // LISTED IN RENDER ORDER, not array order. The occurrence sorts by
  // `binding.order`; this list used to sort by nothing, so on 104 of poms grid's
  // 2,136 multi-field modules it showed a different order than the screen. That
  // is tolerable in a read-only list and not tolerable next to an arrow.
  const realBindings = sortBindingsForDisplay(bindings).filter((b) => b.fieldId);

  return (
    <div className="py-2">
      <div className="mb-2">
        <h4 className="text-xs font-semibold text-white">{title}</h4>
      </div>

      <p className="text-[10px] text-foregroundScale-2/80 mb-2">{hint}</p>

      <DrilldownPicker
        value=""
        onChange={handlePick}
        ctx={{ fields: allFields, sources: [], localVars: [] }}
        config={pickerConfig}
      />

      {realBindings.length > 0 && (
        <div className="mt-3 space-y-1">
          {realBindings.map((binding, i) => {
            const field = fieldsById?.[binding.fieldId];
            if (!field) return null;
            return (
              <FieldBindingRow
                key={binding.fieldId}
                field={field}
                binding={binding}
                isFirst={i === 0}
                isLast={i === realBindings.length - 1}
                onMove={(delta) => moveField(binding.fieldId, delta)}
                onUpdateBinding={(updates) => updateBinding(binding.fieldId, updates)}
                onRemove={() => removeBinding(binding.fieldId)}
              />
            );
          })}
        </div>
      )}

      {gridGivenIds.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] text-foregroundScale-2/60 mb-1">
            From the grid — every occurrence carries these
          </div>
          <div className="space-y-1">
            {gridGivenIds.map((fid) => (
              <GridGivenRow
                key={fid}
                field={fieldsById[fid]}
                onBind={() => bindGridField(fid)}
              />
            ))}
          </div>
          <p className="text-[10px] text-foregroundScale-2/60 mt-1">
            Set in Command Center → Grid. Bind one here to show it on this one.
          </p>
        </div>
      )}
    </div>
  );
}

/** A real binding: reorder, hide/show and unbind. No field editing — that is Command Center. */
function FieldBindingRow({ field, binding, isFirst, isLast, onMove, onUpdateBinding, onRemove }) {
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
        {/* Arrows sit FIRST, in the reading order of the thing they move. Both
            stay mounted and go disabled at the ends — a control that disappears
            at the edge of a list re-lays the row out under the pointer and the
            next press lands on the wrong button. */}
        <button
          type="button"
          title={isFirst ? "Already first" : "Move up"}
          disabled={isFirst}
          className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-25 disabled:pointer-events-none"
          onClick={(e) => { e.stopPropagation(); onMove?.(-1); }}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          title={isLast ? "Already last" : "Move down"}
          disabled={isLast}
          className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-25 disabled:pointer-events-none"
          onClick={(e) => { e.stopPropagation(); onMove?.(1); }}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
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

/** A field the GRID gives this occurrence. Not a binding — there is nothing to unbind. */
function GridGivenRow({ field, onBind }) {
  if (!field) return null;
  return (
    <div className="border border-border/60 border-dashed rounded-md overflow-hidden">
      <div className="w-full flex items-center justify-between px-2 py-1.5 bg-muted/10">
        <div className="flex items-center gap-2 flex-1">
          <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="px-2 py-0.5 text-[10px] rounded-full border opacity-60 bg-muted/30 text-muted-foreground border-border">
            {field.name || field.type}
          </span>
          <span className="text-[10px] text-muted-foreground">{field.type}</span>
        </div>
        <button
          type="button"
          title="Bind to this one, so it can be shown or ordered here"
          className="ml-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={(e) => { e.stopPropagation(); onBind(); }}
        >
          Bind
        </button>
      </div>
    </div>
  );
}
