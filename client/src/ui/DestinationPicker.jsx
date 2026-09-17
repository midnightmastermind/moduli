// ui/DestinationPicker.jsx
//
// "WHERE DOES THIS GO?" — ONE SEARCHABLE ANSWER.
//
// User, 2026-09-16: *"theres got to be a search for choosing where to put the
// magic page (when i press the button) or anywhere else we choose where to place
// something. we need to use our components that allows search"*.
//
// Three places asked that question, three different ways: the browser's
// + Page / Save bookmark bar and the Pomodoro's "Send pomodoros to" were native
// `<select>`s over every container on the grid (hundreds of rows, no search), and
// Jonah's location card had its own hand-rolled filter that showed eight results.
//
// The body is `OptionSearchList` — the same list every occurrence dropdown
// opens — in its search-only mode, so a destination is filtered exactly the way
// an option is, and a fix to one reaches the other.
import React, { useMemo, useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { OptionSearchList } from "./Field.jsx";

/**
 * @param {Array<{id:string,label:string,hint?:string}>} options
 * @param {string|null} value        the chosen id ("" / null = nothing)
 * @param {(id:string|null)=>void} onChange
 * @param {string} placeholder       shown on the trigger when nothing is chosen
 * @param {string|null} noneLabel    when set, offers an explicit "no destination" row
 */
export default function DestinationPicker({
  options = [],
  value = null,
  onChange,
  placeholder = "Choose a destination…",
  noneLabel = null,
  disabled = false,
  style = null,
  searchPlaceholder = "Search destinations…",
}) {
  const [open, setOpen] = useState(false);

  // OptionSearchList speaks `{ value, label }`. The none row gets the empty
  // value, so picking it hands `null` back rather than a sentinel string.
  const listOptions = useMemo(() => {
    const rows = options.map((o) => ({ value: o.id, label: o.label, hint: o.hint || "" }));
    return noneLabel != null ? [{ value: "", label: noneLabel }, ...rows] : rows;
  }, [options, noneLabel]);

  const chosen = useMemo(() => options.find((o) => o.id === value) || null, [options, value]);

  const pick = useCallback((v) => {
    onChange?.(v === "" ? null : v);
    setOpen(false);
  }, [onChange]);

  const renderOption = useCallback((o) => (
    <span className="flex items-center gap-2 min-w-0 w-full">
      <span className="truncate">{o.label}</span>
      {o.hint && <span className="ml-auto text-[10px] opacity-50 flex-shrink-0">{o.hint}</span>}
    </span>
  ), []);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose destination"
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
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chosen ? chosen.label : (value == null || value === "") && noneLabel != null ? noneLabel : placeholder}
          </span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="bottom">
        <OptionSearchList
          options={listOptions}
          selected={value ? [value] : noneLabel != null ? [""] : []}
          onPick={pick}
          renderOption={renderOption}
          searchPlaceholder={searchPlaceholder}
          autoFocus
          emptyText="Nowhere to put it yet"
        />
      </PopoverContent>
    </Popover>
  );
}
