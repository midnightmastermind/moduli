// ui/pickers/SinglePick.jsx — THE single-choice picker (deep UI sweep Task 6b, user 2026-11-03 14:10: "if we have a
// custom multiselect picker or select picker for example, lets reuse it as much as possible wherever its needed and
// not just have a new one … ik we have custom selects and multiselects not used places").
//
// A trigger + a popover holding `OptionSearchList` (the occurrence dropdown's own list) in single mode. Grown out of
// DestinationPicker (2026-09-16), which every "where does this go?" already used.
//   - picking the chosen option again CLEARS it (`clearable`, default on) — the user could not unpick (2026-11-03);
//   - the chosen option is marked with a ✓ (OptionSearchList), not a tint that reads like hover in the Terminal skin;
//   - a search box appears once there are more than SEARCH_AT options (or always with `searchPlaceholder`);
//   - `renderTrigger(label, chosen)` lets a field pill keep its own look — the list underneath is the same.
import React, { useMemo, useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { OptionSearchList } from "../Field.jsx";

export const SEARCH_AT = 8;

/** The next value after picking `picked` when `current` is chosen: picking the chosen one clears it. */
export const togglePick = (current, picked) => (current === picked ? null : picked);

/**
 * @param {Array<{value:string,label:string,hint?:string}>} options
 * @param {string|null} value
 * @param {(value:string|null)=>void} onChange
 */
export default function SinglePick({
  options = [],
  value = null,
  onChange,
  placeholder = "Choose…",
  noneLabel = null,
  clearable = true,
  disabled = false,
  style = null,
  ariaLabel = "Choose",
  searchPlaceholder = null,
  emptyText = "Nothing to choose yet",
  renderTrigger = null,
  renderOption = null,
  wrapLabels = false,
  // passed straight to the list (occurrence pickers)
  onAddOption = null,
  onAdded = null,
  addNewTargets = null,
  searchProvider = null,
  onImportResult = null,
  contentClassName = "w-80 p-0",
  align = "start",
}) {
  const [open, setOpen] = useState(false);

  // A none row gets the empty value, so picking it hands back null rather than a sentinel string.
  const listOptions = useMemo(() => (noneLabel != null ? [{ value: "", label: noneLabel }, ...options] : options), [options, noneLabel]);
  const chosen = useMemo(() => options.find((o) => o.value === value) || null, [options, value]);
  const label = chosen ? chosen.label : (value == null || value === "") && noneLabel != null ? noneLabel : placeholder;

  const pick = useCallback((v) => {
    const picked = v === "" ? null : v;
    if (picked === value || (picked == null && (value == null || value === ""))) {
      if (clearable && picked != null) onChange?.(null);
    } else onChange?.(picked);
    setOpen(false);
  }, [onChange, value, clearable]);

  const wrappedOption = useCallback((o) => (
    <span className="flex items-center gap-2 min-w-0 w-full">
      {/* WRAPPED, NOT TRUNCATED: a crumb's most specific part is its END ("… › Wednesday › 9:30pm"). */}
      <span style={wrapLabels ? { whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.3 } : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
      {o.hint && <span className="ml-auto text-[10px] opacity-50 flex-shrink-0">{o.hint}</span>}
    </span>
  ), [wrapLabels]);

  const search = searchPlaceholder || (listOptions.length > SEARCH_AT ? "Search…" : null);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        {renderTrigger ? renderTrigger(label, chosen) : (
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            title={chosen?.label || placeholder}
            style={{
              display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%",
              padding: "3px 6px", textAlign: "left", cursor: disabled ? "not-allowed" : "pointer",
              background: "var(--input-bg)", color: chosen ? "var(--text-primary)" : "var(--text-faint)",
              border: "1px solid var(--input-border)", borderRadius: 3,
              fontSize: "inherit", fontFamily: "inherit",
              ...(style || null),
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className={contentClassName} align={align} side="bottom">
        <OptionSearchList
          options={listOptions}
          selected={value != null && value !== "" ? [value] : noneLabel != null ? [""] : []}
          onPick={pick}
          renderOption={renderOption || wrappedOption}
          searchPlaceholder={search}
          autoFocus={!!search}
          emptyText={emptyText}
          onAddOption={onAddOption}
          onAdded={onAdded}
          addNewTargets={addNewTargets}
          searchProvider={searchProvider}
          onImportResult={onImportResult}
        />
      </PopoverContent>
    </Popover>
  );
}
