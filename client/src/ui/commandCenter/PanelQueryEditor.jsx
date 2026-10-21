// ui/commandCenter/PanelQueryEditor.jsx — the query of an onLoadInPanel /
// onUnloadFromPanel trigger: which occurrences (pages, containers) and/or which
// modules ("any occurrence of Exercise") it watches, and for a load, when it
// fires. Writes `occurrenceIds`, `moduleIds`, `mode` on the trigger object.
import React, { useMemo } from "react";
import { X } from "lucide-react";
import DestinationPicker from "../DestinationPicker";
import ModuleSelect from "../ModuleSelect.jsx";
import { buildContainerCrumbOptions } from "../../helpers/containerCrumbs";

export const PANEL_LOAD_MODES = [
  { value: "appear", label: "each time one appears in a panel" },
  { value: "once", label: "once per app load" },
  { value: "inView", label: "each time one scrolls into view" },
];

export default function PanelQueryEditor({ trigger, onChange, occurrencesById, modulesById, foldersById }) {
  const occIds = trigger.occurrenceIds || [];
  const options = useMemo(
    () => buildContainerCrumbOptions(occurrencesById, modulesById, { foldersById, roles: ["page", "container"] }),
    [occurrencesById, modulesById, foldersById],
  );
  const nameOf = (id) => options.find((o) => o.id === id)?.label || id.slice(-6);
  const chip = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "1px 6px", borderRadius: 999, border: "1px solid var(--border-subtle)", background: "var(--input-bg)", color: "var(--text-primary)" };
  const isLoad = trigger.eventType === "onLoadInPanel";

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>occurrences:</span>
        {occIds.map((id) => (
          <span key={id} style={chip}>
            {nameOf(id)}
            <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange({ occurrenceIds: occIds.filter((x) => x !== id) })}
              style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: 0, display: "inline-flex" }}>
              <X size={10} />
            </button>
          </span>
        ))}
        <DestinationPicker
          options={options.filter((o) => !occIds.includes(o.id))}
          value={null}
          onChange={(id) => { if (id) onChange({ occurrenceIds: [...occIds, id] }); }}
          placeholder="Add a page or container…"
          searchPlaceholder="Search pages and containers…"
          ariaLabel="Add occurrence to the query"
          style={{ width: "auto", minWidth: 170, fontSize: 10 }}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>or any occurrence of:</span>
        <ModuleSelect value={trigger.moduleIds || []} onChange={(ids) => onChange({ moduleIds: ids })}
          modulesById={modulesById} occurrencesById={occurrencesById} />
      </div>
      {isLoad && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>fire:</span>
          <select value={trigger.mode || "appear"} aria-label="When it fires" onChange={(e) => onChange({ mode: e.target.value })}
            style={{ fontSize: 10, background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-primary)", borderRadius: 4, padding: "1px 4px" }}>
            {PANEL_LOAD_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
