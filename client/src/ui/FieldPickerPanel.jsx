// THE field picker. One panel, two surfaces.
//
// User, 2026-09-06: *"the menu to add a field to a new occurance thats been
// added via the multiselect, should have the same field picker as the quick add
// menu, not some new popup."*
//
// They are right, and the popup was mine: the add-an-option flow asked for
// fields one at a time through the GET_USER_INPUT modal — a chain of yes/no
// questions where the quick-add menu already had a searchable, sectioned,
// tick-and-type panel. Two pickers for one job is how the labels, the order and
// the which-fields-appear rule start disagreeing; this is that panel, lifted out
// of `QuickAddMenu` unchanged so there is one of it.
//
// It renders and reports. It does not write, does not know what a "new option"
// or a "new item" is, and holds only the search box's own text — every other
// piece of state belongs to the caller, which is what lets the same panel serve
// a row that does not exist yet (quick add) and one that already does (the
// add-an-option flow).
import React, { useCallback, useMemo, useState } from "react";
import { Search, Check, ChevronLeft } from "lucide-react";
import { splitDisplayInput, typeableFields } from "../helpers/siblingFieldBindings.js";
import { resolveOptions } from "../helpers/optionsResolver";
import Field from "./Field.jsx";

const backBtnStyle = {
  display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "5px 10px",
  background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)",
  cursor: "pointer", color: "var(--text-muted)", fontSize: 10,
  fontFamily: "var(--font-mono)", textAlign: "left",
};
const emptyStyle = {
  padding: "10px", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
};

export default function FieldPickerPanel({
  fieldsById,
  picked,                 // string[] — ticked field ids, in pick order
  values,                 // { [fieldId]: rawValue }
  onToggle,               // (fieldId) => void
  onSetValue,             // (fieldId, value) => void
  onConfirm,
  onSkip = null,          // omitted -> no Skip button
  onBack = null,          // omitted -> no Back row
  title,
  confirmLabel = "Create",
  skipLabel = "Skip",
  // The row the fields are FOR. Quick add has none yet and passes the
  // destination as `parentOccurrence` so ancestor-scoped dropdowns resolve; the
  // add-an-option flow has a real row and passes it directly.
  occurrence = null,
  parentOccurrence = null,
  inheritedRoles = {},
  getOccMap,
  modulesById,
  foldersById,
}) {
  const [search, setSearch] = useState("");

  // Three sections (user, 2026-08-22: "put the selected fields first, then
  // input fields and then display fields"). Ticked fields used to sort to the
  // top WITHIN each section, which on a grid with ~99 display fields left the
  // ones you can type into below the fold.
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = Object.values(fieldsById || {})
      .filter((f) => !f.trashed)
      .filter((f) => !q || (f.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const sel = new Set(picked || []);
    const on = splitDisplayInput(all.filter((f) => sel.has(f.id)));
    const off = splitDisplayInput(all.filter((f) => !sel.has(f.id)));
    return [
      { key: "selected", title: "Selected", fields: [...on.input, ...on.display] },
      { key: "input", title: "Input", fields: off.input },
      { key: "display", title: "Display", fields: off.display },
    ].filter((s) => s.fields.length);
  }, [fieldsById, picked, search]);

  const count = useMemo(() => sections.reduce((n, s) => n + s.fields.length, 0), [sections]);

  // A stand-in for the row when there is not one yet. An occurrence dropdown
  // may scope its pool by ANCESTOR, so the draft has to name the destination as
  // its parent or those fields resolve to nothing — the 2026-07-07 `_ancestors`
  // gap in the options resolver.
  const host = useMemo(() => (
    occurrence
      || (parentOccurrence
        ? { id: "__draft__", parentId: parentOccurrence.id, moduleId: null, fields: {} }
        : null)
  ), [occurrence, parentOccurrence]);

  // Resolve the pool the way FieldRenderer does — one call, not a second
  // implementation. Only select/occurrence read it.
  const withOptions = useCallback((f) => {
    if (f?.type !== "select" && f?.type !== "occurrence") return f;
    let resolved = { options: [], totalMatched: 0 };
    try {
      resolved = resolveOptions(
        f,
        { occurrencesById: getOccMap?.() || {}, modulesById, fieldsById, foldersById },
        host
      ) || resolved;
    } catch { /* a pool that cannot resolve renders empty, never a crash */ }
    return { ...f, meta: { ...f.meta, _resolvedOptions: resolved.options, _totalMatched: resolved.totalMatched } };
  }, [getOccMap, modulesById, fieldsById, foldersById, host]);

  // Which TICKED fields may carry a typed value. Asked through `typeableFields`
  // so the rule stays in one place rather than the row re-deriving it and
  // drifting from what the caller reads back.
  const typeableIds = useMemo(
    () => new Set(typeableFields(picked || [], fieldsById, inheritedRoles).map((f) => f.id)),
    [picked, fieldsById, inheritedRoles]
  );

  return (
    <>
      {onBack && (
        <button onClick={onBack} style={backBtnStyle}>
          <ChevronLeft size={10} /> Back
        </button>
      )}
      <div style={{ padding: "8px 10px 4px", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border-subtle)" }}>
        {title} ({(picked || []).length} selected)
      </div>
      <div style={{ position: "relative" }}>
        <Search size={10} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fields…"
          style={{ background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "6px 8px 6px 22px", fontSize: 11, color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)", width: "100%", boxSizing: "border-box" }}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {count === 0 && <div style={emptyStyle}>No fields found</div>}
        {sections.map((sec) => (
          <div key={sec.key}>
            <div style={{ padding: "6px 10px 3px", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
              {sec.title}
            </div>
            {sec.fields.map((f) => {
              const selected = (picked || []).includes(f.id);
              // A ticked field that can hold a typed value gets its control
              // HERE, on its own row. The row is a <div> and only the
              // name+checkbox half toggles: an <input> nested in a <button> is
              // invalid, and clicking into the control would otherwise untick
              // the field you were filling in.
              const typeable = typeableIds.has(f.id);
              return (
                <div
                  key={f.id}
                  style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "3px 10px", minHeight: 24, background: selected ? "var(--accent-blue-bg)" : "none", color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)" }}
                >
                  <button
                    onClick={() => onToggle(f.id)}
                    title={f.name || "(unnamed)"}
                    style={{ display: "flex", alignItems: "center", gap: 6, flex: typeable ? "0 0 108px" : 1, minWidth: 0, padding: "2px 0", background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${selected ? "var(--accent-blue)" : "var(--border-default)"}`, background: selected ? "var(--accent-blue)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {selected && <Check size={10} color="var(--on-accent)" strokeWidth={3} />}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name || "(unnamed)"}</span>
                  </button>
                  {typeable ? (
                    /* The REAL control for the type, not a hand-rolled subset —
                       `Field` is this app's one renderer, so an occurrence
                       dropdown, a rating and a duration all behave here exactly
                       as they do on a row. NOT compact: the compact form is a
                       pill you click to reveal an input, which is right on a
                       crowded row and wrong here. */
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Field
                        field={withOptions(f)}
                        binding={{ fieldId: f.id, role: "input" }}
                        compact={false}
                        hideName
                        hostOccurrence={host}
                        value={values?.[f.id]}
                        flow={f.meta?.flow || "in"}
                        onCommit={(nv) => onSetValue(f.id, nv)}
                      />
                    </span>
                  ) : (
                    f.type && <span style={{ fontSize: 9, color: "var(--text-faint)", flexShrink: 0 }}>{f.type}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid var(--border-subtle)", background: "var(--input-bg)" }}>
        {onSkip && (
          <button onClick={onSkip} style={{ flex: 1, padding: "5px 8px", background: "transparent", border: "1px solid var(--border-default)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{skipLabel}</button>
        )}
        <button onClick={onConfirm} style={{ flex: 1, padding: "5px 8px", background: "var(--accent-blue)", border: "1px solid var(--accent-blue)", borderRadius: 4, cursor: "pointer", color: "var(--on-accent)", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{confirmLabel}</button>
      </div>
    </>
  );
}
