import React from "react";
import { Separator } from "@/components/ui/separator";
import FormInput from "./FormInput";
import { Button } from "@/components/ui/button";

export default function GridLayoutForm({
  value,          // { gridName, rows, cols }
  onChange,       // (next) => void
  onCommitGridName,
  onDeleteGrid,
  gridId,
  grid,                        // full grid object (for templates)
  onSetDefaultDayPageTemplate, // (templateId | null) => void
}) {
  return (
    <div className="font-mono">
      <div>
        <h4 className="text-sm font-semibold text-white">Grid settings</h4>
        <p className="text-[11px] pt-[2px] text-foregroundScale-2">
          Edit grid name and dimensions.
        </p>
      </div>

      <Separator />

      <FormInput
        schema={{
          type: "text-input",
          key: "gridName",
          label: "Grid Name",
          placeholder: "My grid",
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitGridName?.(e.currentTarget.value);
              e.currentTarget.blur();
            }
          },
          onBlur: (e) => {
            onCommitGridName?.(e.currentTarget.value);
          },
        }}
        value={value}
        onChange={onChange}
      />

      <Separator />

      <div className="grid pt-[5px] grid-cols-2 gap-3">
        <FormInput
          schema={{
            type: "number-input",
            key: "rows",
            label: "Rows",
            min: 1,
            max: 24,
          }}
          value={value}
          onChange={onChange}
        />

        <FormInput
          schema={{
            type: "number-input",
            key: "cols",
            label: "Cols",
            min: 1,
            max: 24,
          }}
          value={value}
          onChange={onChange}
        />
      </div>

      {(grid?.templates || []).length > 0 && (
        <>
          <Separator />
          <div className="pt-2 pb-1">
            <h4 className="text-xs font-semibold text-white mb-1">Day page template</h4>
            <p className="text-[10px] text-foregroundScale-2/80 mb-2">
              Auto-fill new day pages from this template.
            </p>
            <select
              className="w-full text-[11px] bg-background border border-border rounded px-2 py-1 text-foreground"
              value={grid?.defaultDayPageTemplateId || ""}
              onChange={(e) => onSetDefaultDayPageTemplate?.(e.target.value || null)}
            >
              <option value="">None</option>
              {(grid.templates || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name || t.id}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <Separator />

      <div className="pt-2">
        <h4 className="text-xs font-semibold text-red-400">Danger zone</h4>
        <p className="text-[10px] text-foregroundScale-2/80 mt-1">
          This deletes the grid and all UI inside it.
        </p>

        <div className="mt-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              const ok = window.confirm(
                `Delete this grid${gridId ? ` (${gridId})` : ""}? This cannot be undone.`
              );
              if (!ok) return;
              onDeleteGrid?.();
            }}
            disabled={!onDeleteGrid}
          >
            Delete Grid
          </Button>
        </div>
      </div>
    </div>
  );
}
