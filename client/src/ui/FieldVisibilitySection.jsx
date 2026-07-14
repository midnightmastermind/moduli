// client/src/ui/FieldVisibilitySection.jsx
// HeaderDropdown section — per-occurrence field visibility, cascading the
// same top→down way regular filters do. Mounted next to FiltersSection in
// every module's chevron dropdown (container / page / panel → covers
// list / doc / board / canvas / table).
//
// One mode control drives the whole cascade:
//   Inherit → occurrence.fieldVisibility = null  (use the nearest ancestor's
//             setting; show ALL fields if no ancestor sets one)
//   Off     → { mode: "off" }   (ignore any inherited setting here AND for
//             descendants — show all fields)
//   Show    → { mode: "show", fieldIds }  (whitelist — local override)
//   Hide    → { mode: "hide", fieldIds }  (blacklist — local override)
//
// An "Effective" line shows what actually applies at this level and whether
// it came from a Local override or an inherited Ancestor — the same
// cascade isOccurrenceVisible / ModuleInstance read at render time.

import React, { useMemo } from "react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  getParentOccurrence,
  getEffectiveFieldVisibilityForOccurrence,
} from "../state/selectors";
import { buildParentMap } from "../helpers/dragHitTesting";
import FieldRenderer from "./FieldRenderer";

const MODES = [
  { key: "inherit", label: "Inherit" },
  { key: "off", label: "Off" },
  { key: "show", label: "Show" },
  { key: "hide", label: "Hide" },
];

export default function FieldVisibilitySection({ occurrence }) {
  const ctx = useGridActions();
  const { dispatch, socket, fieldsById, occurrencesById } = ctx;

  const own = occurrence?.fieldVisibility || null;
  const currentMode = own == null ? "inherit" : (own.mode || "inherit");
  const ownFieldIds = Array.isArray(own?.fieldIds) ? own.fieldIds : [];

  const parentByChildId = useMemo(
    () => buildParentMap(occurrencesById || {}),
    [occurrencesById],
  );

  // What this occurrence would inherit if it set nothing — the nearest
  // ancestor's resolved field-visibility (start from the PARENT, not self).
  const inherited = useMemo(() => {
    const parent = getParentOccurrence(occurrence, { occurrencesById, parentByChildId });
    if (!parent) return null;
    return getEffectiveFieldVisibilityForOccurrence(parent, { occurrencesById, parentByChildId });
  }, [occurrence, occurrencesById, parentByChildId]);

  // The setting actually applied AT THIS LEVEL after the cascade resolves.
  const effective = useMemo(
    () => getEffectiveFieldVisibilityForOccurrence(occurrence, { occurrencesById, parentByChildId }),
    [occurrence, occurrencesById, parentByChildId],
  );
  // effective comes from this occurrence's own override only when it set a
  // show/hide. "off" or "inherit" → the source is ancestor (or nothing).
  const effectiveSource = (own && (own.mode === "show" || own.mode === "hide"))
    ? "Local"
    : "Ancestor";

  const allFields = useMemo(
    () => Object.values(fieldsById || {}),
    [fieldsById],
  );

  const write = (nextFieldVisibility) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, fieldVisibility: nextFieldVisibility },
      emit: true,
    });
  };

  const setMode = (mode) => {
    if (mode === "inherit") return write(null);
    if (mode === "off") return write({ mode: "off" });
    // show / hide — keep any fieldIds the user already picked.
    write({ mode, fieldIds: ownFieldIds });
  };

  const toggleFieldId = (fieldId) => {
    const has = ownFieldIds.includes(fieldId);
    const nextIds = has
      ? ownFieldIds.filter(f => f !== fieldId)
      : [...ownFieldIds, fieldId];
    write({ mode: currentMode === "show" || currentMode === "hide" ? currentMode : "show", fieldIds: nextIds });
  };

  const fieldName = (fid) => fieldsById?.[fid]?.name || fid;
  const describe = (fv) => {
    if (!fv || !fv.mode || fv.mode === "off") return "All fields";
    const n = (fv.fieldIds || []).length;
    return `${fv.mode === "show" ? "Show only" : "Hide"} ${n} field${n === 1 ? "" : "s"}`;
  };

  const sectionHeader = { fontSize: 9, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8, marginBottom: 4 };
  const showList = currentMode === "show" || currentMode === "hide";

  return (
    <section style={{ marginBottom: 8, borderTop: "1px solid var(--panel-border, #374151)", paddingTop: 8 }}>
      <div style={sectionHeader}>Field Visibility</div>

      {/* Mode cascade control */}
      <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
        {MODES.map(m => {
          const isActive = currentMode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              style={{
                flex: 1, height: 22, fontSize: 10, fontFamily: "var(--font-mono)",
                borderRadius: 3, border: "1px solid var(--input-border, #374151)",
                background: isActive ? "var(--accent-blue-bg, rgba(96,165,250,0.18))" : "var(--input-bg, transparent)",
                color: isActive ? "var(--accent-blue, #60a5fa)" : "var(--text-muted, #888)",
                cursor: "pointer",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Effective readout — what actually applies here + where it came from */}
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: showList ? 6 : 0 }}>
        Effective: <strong>{describe(effective)}</strong>
        {effective ? ` · ${effectiveSource}` : ""}
        {currentMode === "inherit" && inherited && (
          <span style={{ opacity: 0.7 }}> (inheriting {describe(inherited)})</span>
        )}
      </div>

      {/* Field checklist — only when this occurrence sets a local show/hide.
          Each row shows: include-in-list checkbox + field name + compact value
          editor (FieldRenderer in compact input mode, reads/writes the value on
          THIS occurrence) + type indicator. The value editor is independent of
          the inclusion checkbox: editing the value mutates this occurrence's
          fields[]; toggling the checkbox mutates the visibility set. */}
      {showList && (
        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border-subtle, #374151)", borderRadius: 3, padding: 2 }}>
          {allFields.length === 0 && (
            <div style={{ fontSize: 10, opacity: 0.5, padding: 4 }}>No fields available</div>
          )}
          {allFields.map(f => {
            const checked = ownFieldIds.includes(f.id);
            const binding = { fieldId: f.id, role: f.inputEnabled === false ? "display" : "input" };
            return (
              <div
                key={f.id}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 4px", fontSize: 11, borderRadius: 2 }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFieldId(f.id)}
                  style={{ margin: 0, width: 11, height: 11, flex: "0 0 auto", cursor: "pointer" }}
                  title={checked ? "Remove from list" : "Add to list"}
                />
                <span
                  style={{ flex: "0 1 auto", minWidth: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary, #f3f4f6)", cursor: "pointer" }}
                  onClick={() => toggleFieldId(f.id)}
                  title={f.name || "(unnamed)"}
                >
                  {f.name || "(unnamed)"}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
                  <FieldRenderer
                    field={f}
                    binding={binding}
                    occurrence={occurrence}
                    dispatch={dispatch}
                    socket={socket}
                    compact
                  />
                </div>
                <span style={{ fontSize: 9, opacity: 0.5, flex: "0 0 auto" }}>{f.type}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
