// ui/FieldSelect.jsx
//
// "WHICH FIELD?" — ONE SEARCHABLE ANSWER.
//
// User, 2026-09-28: *"we need to replace the field selection for local filters,
// with our component that allows search for field … i wanted to add a filter on
// the bookmarks page and it was incredibly hard to find the field. we also need
// that search selector for the sort fields"* — and then, deciding the scope:
// *"any place that selects a field should be using that one"*.
//
// It is the same complaint `DestinationPicker` was built for one surface
// earlier (*"we need to use our components that allows search"*), so it gets
// the same answer rather than a second one: this WRAPS that picker, which
// wraps `OptionSearchList` — the list every occurrence dropdown opens. Three
// surfaces, one filtering behaviour, one place to fix it.
//
// What it adds over the bare picker is what a FIELD list needs:
//   · the type as a hint, because "Date" and "Logged On" are told apart by it
//   · extra non-field rows a caller needs (Label · Manual order · Any field)
//   · a row for a STORED id the grid no longer carries, so the trigger never
//     goes blank against real data — the rule the comparator catalog learned
//     when 576 stored comparators rendered as something they were not.
import React, { useMemo } from "react";
import DestinationPicker from "./DestinationPicker.jsx";

const nameOf = (f) => f?.label || f?.name || f?.id || "";

/**
 * @param {Array} fields            field records ({ id, name, label?, type?, trashed? })
 * @param {string|null} value       the chosen field id ("" / null = nothing)
 * @param {(id:string|null)=>void} onChange
 * @param {string|null} noneLabel   the "no field" row's label; null omits the row
 * @param {Array<{value:string,label:string,hint?:string}>} extraOptions
 *        rows that are not fields but belong in the same list (e.g. "Label")
 */
export default function FieldSelect({
  fields = [],
  value = null,
  onChange,
  noneLabel = null,
  extraOptions = [],
  placeholder = "Choose a field…",
  searchPlaceholder = "Search fields…",
  disabled = false,
  style = null,
  ariaLabel = "Choose field",
}) {
  const options = useMemo(() => {
    const rows = [
      ...extraOptions.map((o) => ({ id: o.value, label: o.label, hint: o.hint || "" })),
      ...fields
        .filter((f) => f && !f.trashed)
        .map((f) => ({ id: f.id, label: nameOf(f), hint: f.type || "" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
    // A value nothing offers still has to READ as itself. A picker that shows
    // an empty trigger over a stored id is the same defect as a `<select>`
    // whose value is absent from its options.
    if (value && !rows.some((r) => r.id === value)) {
      rows.push({ id: value, label: value, hint: "not on this grid" });
    }
    return rows;
  }, [fields, extraOptions, value]);

  return (
    <DestinationPicker
      options={options}
      value={value ?? null}
      onChange={onChange}
      noneLabel={noneLabel}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      style={style}
      ariaLabel={ariaLabel}
      emptyText="No fields match"
    />
  );
}
