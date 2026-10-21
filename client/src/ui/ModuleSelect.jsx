// ui/ModuleSelect.jsx — pick one or more MODULES by name ("occurrences of Exercise").
//
// Used by the operation editor (Find's "only occurrences of", the
// "Find occurrences of module" action) and onLoadInPanel's query. Each option
// names the module, its role/kind and how many occurrences place it, biggest
// first — the same Exercise is one module however many days it is copied into
// (2026-10-21), so the count is what tells the boards' types apart from strays.
import React, { useMemo } from "react";
import { X } from "lucide-react";
import DestinationPicker from "./DestinationPicker.jsx";
import { placementsByModule } from "../helpers/sharedModule.js";

/** Options for a module list: [{ id, label, hint, count }], most-placed first. PURE. */
export function moduleOptions(modulesById, occurrencesById) {
  const counts = placementsByModule(Object.values(occurrencesById || {}));
  const out = [];
  for (const m of Object.values(modulesById || {})) {
    if (!m?.id || m.trashed) continue;
    const count = (counts.get(m.id) || []).length;
    if (!count) continue; // a module nothing places has no occurrences to find
    const label = m.label || m.name || "(unnamed)";
    const kind = [m.role, m.kind].filter(Boolean).join("/");
    out.push({ id: m.id, label, count, hint: `${kind}${kind ? " · " : ""}${count} placement${count === 1 ? "" : "s"}` });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export default function ModuleSelect({ value = [], onChange, modulesById, occurrencesById, placeholder = "Add a module…", single = false }) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  const options = useMemo(() => moduleOptions(modulesById, occurrencesById), [modulesById, occurrencesById]);
  const remaining = useMemo(() => options.filter((o) => !ids.includes(o.id)), [options, ids]);
  const nameOf = (id) => modulesById?.[id]?.label || modulesById?.[id]?.name || id;
  const emit = (next) => onChange?.(single ? (next[0] ?? null) : next);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      {ids.map((id) => (
        <span key={id} style={{
          display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "1px 6px",
          borderRadius: 999, border: "1px solid var(--border-subtle)", background: "var(--input-bg)", color: "var(--text-primary)",
        }}>
          {nameOf(id)}
          <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => emit(ids.filter((x) => x !== id))}
            style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: 0, display: "inline-flex" }}>
            <X size={11} />
          </button>
        </span>
      ))}
      {(!single || ids.length === 0) && (
        <DestinationPicker
          options={remaining}
          value={null}
          onChange={(id) => { if (id) emit([...ids, id]); }}
          placeholder={placeholder}
          searchPlaceholder="Search modules…"
          ariaLabel="Choose module"
          emptyText="No modules with occurrences"
          style={{ width: "auto", minWidth: 150 }}
        />
      )}
    </div>
  );
}
