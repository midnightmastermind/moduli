// ui/MultiSelectPills.jsx
// ============================================================
// Multi-select component with pill/chip display
// Used for selecting multiple fields, containers, panels, etc.
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Plus, Check } from "lucide-react";

/**
 * MultiSelectPills - Multi-select with pill display
 *
 * Props:
 * - options: Array of { value, label, description?, color? }
 * - selected: Array of selected values
 * - onChange: (selected: string[]) => void
 * - placeholder: string
 * - emptyMessage: string
 * - maxDisplay: number - max pills to show before "+N more"
 * - allowSelectAll: boolean
 * - disabled: boolean
 * - compact: boolean
 */
export default function MultiSelectPills({
  options = [],
  selected = [],
  onChange,
  placeholder = "Select items...",
  emptyMessage = "No items available",
  maxDisplay = 3,
  allowSelectAll = true,
  disabled = false,
  compact = false,
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Get selected options as objects
  const selectedOptions = useMemo(() => {
    return options.filter(opt => selected.includes(opt.value));
  }, [options, selected]);

  // Available options (not selected)
  const availableOptions = useMemo(() => {
    return options.filter(opt => !selected.includes(opt.value));
  }, [options, selected]);

  // Toggle selection
  const toggleOption = useCallback((value) => {
    if (selected.includes(value)) {
      onChange?.(selected.filter(v => v !== value));
    } else {
      onChange?.([...selected, value]);
    }
  }, [selected, onChange]);

  // Remove a selection
  const removeOption = useCallback((value, e) => {
    e?.stopPropagation();
    onChange?.(selected.filter(v => v !== value));
  }, [selected, onChange]);

  // Select all
  const selectAll = useCallback(() => {
    onChange?.(options.map(opt => opt.value));
  }, [options, onChange]);

  // Clear all
  const clearAll = useCallback(() => {
    onChange?.([]);
  }, [onChange]);

  // Pills to display
  const displayPills = selectedOptions.slice(0, maxDisplay);
  const overflowCount = selectedOptions.length - maxDisplay;

  return (
    <div className="multi-select-pills">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            disabled={disabled}
            className={`
              w-full justify-start font-normal
              ${compact ? "h-7 text-[10px]" : "h-8 text-xs"}
              ${selectedOptions.length === 0 ? "text-muted-foreground" : ""}
            `}
          >
            {selectedOptions.length === 0 ? (
              <span>{placeholder}</span>
            ) : (
              <div className="flex flex-wrap gap-1 items-center">
                {displayPills.map(opt => (
                  <span
                    key={opt.value}
                    className={`
                      inline-flex items-center gap-0.5
                      ${compact ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-[10px]"}
                      rounded-full
                      ${opt.color || "bg-primary/20 text-primary"}
                    `}
                  >
                    {opt.label}
                    <X
                      className={compact ? "h-2 w-2" : "h-2.5 w-2.5"}
                      onClick={(e) => removeOption(opt.value, e)}
                    />
                  </span>
                ))}
                {overflowCount > 0 && (
                  <span className={`${compact ? "text-[9px]" : "text-[10px]"} text-muted-foreground`}>
                    +{overflowCount} more
                  </span>
                )}
              </div>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-0" align="start">
          {/* Header with select/clear all */}
          {allowSelectAll && options.length > 0 && (
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-2"
                onClick={selectAll}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-2"
                onClick={clearAll}
              >
                Clear
              </Button>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-48 overflow-y-auto p-1">
            {options.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              options.map(opt => {
                const isSelected = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleOption(opt.value)}
                    className={`
                      w-full flex items-center gap-2 px-2 py-1.5 rounded-sm
                      text-left text-xs
                      transition-colors
                      ${isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted"
                      }
                    `}
                  >
                    <div className={`
                      w-4 h-4 rounded border flex items-center justify-center
                      ${isSelected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/30"
                      }
                    `}>
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{opt.label}</div>
                      {opt.description && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
