// ui/LocalIterationNav.jsx
// ============================================================
// Compact iteration navigation for panels/containers
// Shows arrows + period display when entity has "own" iteration mode
// Can be embedded in panel headers or container headers
// ============================================================

import React, { useMemo, useCallback, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Link2, Unlink, Filter } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";

/**
 * Format a date based on time filter type (compact version)
 */
function formatPeriodCompact(date, timeFilter) {
  if (!date) return "—";
  const d = new Date(date);

  switch (timeFilter) {
    case "daily":
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    case "weekly": {
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      return `Wk ${startOfWeek.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    case "monthly":
      return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    case "yearly":
      return d.getFullYear().toString();
    default:
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

/**
 * Navigate the date by the iteration's time increment
 */
function navigateDate(date, timeFilter, direction) {
  const d = new Date(date);
  const increment = direction === "next" ? 1 : -1;

  switch (timeFilter) {
    case "daily":
      d.setDate(d.getDate() + increment);
      break;
    case "weekly":
      d.setDate(d.getDate() + increment * 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + increment);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + increment);
      break;
  }

  return d;
}

/**
 * Navigate category value (cycle through available values)
 */
function navigateCategory(currentValue, values, direction) {
  if (!values || values.length === 0) return currentValue;

  const currentIndex = values.indexOf(currentValue);
  const increment = direction === "next" ? 1 : -1;

  if (currentIndex === -1) {
    return values[0];
  }

  const newIndex = (currentIndex + increment + values.length) % values.length;
  return values[newIndex];
}

/**
 * LocalIterationNav - Compact iteration navigation for entities
 *
 * Props:
 * - occurrence: The occurrence object with iteration settings
 * - onUpdate: (updates) => void - Callback to update the occurrence
 * - showModeToggle: boolean - Show inherit/own mode toggle
 * - compact: boolean - Extra compact mode for tight spaces
 */
export default function LocalIterationNav({
  occurrence,
  onUpdate,
  showModeToggle = true,
  compact = false,
  alwaysExpanded = false,
  collapsible = false,
  toggleable = false,
}) {
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const context = useContext(GridActionsContext) || {};
  const {
    iterations = [],
    selectedIterationId,
    currentIterationValue,
    categoryDimensions = [],
    selectedCategoryId,
    currentCategoryValue,
    isMobile,
  } = context;

  // Get the iteration settings from occurrence
  const iterationMode = occurrence?.iteration?.inheritMode || "inherit";
  const isOwn = iterationMode === "own";

  // Get effective values (own or inherited)
  const effectiveTimeFilter = useMemo(() => {
    if (isOwn && occurrence?.iteration?.timeFilter) {
      return occurrence.iteration.timeFilter;
    }
    const selectedIteration = iterations.find(i => i.id === selectedIterationId) || iterations[0];
    return selectedIteration?.timeFilter || "daily";
  }, [isOwn, occurrence, iterations, selectedIterationId]);

  const effectiveTimeValue = useMemo(() => {
    if (isOwn && (occurrence?.iteration?.timeValue || occurrence?.iteration?.value)) {
      return new Date(occurrence.iteration.timeValue || occurrence.iteration.value);
    }
    return currentIterationValue ? new Date(currentIterationValue) : new Date();
  }, [isOwn, occurrence, currentIterationValue]);

  const effectiveCategoryKey = useMemo(() => {
    if (isOwn && occurrence?.iteration?.categoryKey) {
      return occurrence.iteration.categoryKey;
    }
    return selectedCategoryId;
  }, [isOwn, occurrence, selectedCategoryId]);

  const effectiveCategoryValue = useMemo(() => {
    if (isOwn && occurrence?.iteration?.categoryValue) {
      return occurrence.iteration.categoryValue;
    }
    return currentCategoryValue;
  }, [isOwn, occurrence, currentCategoryValue]);

  // Get the selected category dimension for value navigation
  const selectedCategoryDimension = useMemo(() => {
    return categoryDimensions.find(c => c.id === effectiveCategoryKey);
  }, [categoryDimensions, effectiveCategoryKey]);

  // Toggle inherit/own mode
  const handleModeToggle = useCallback(() => {
    const newMode = isOwn ? "inherit" : "own";
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        inheritMode: newMode,
        // When switching to own, copy current grid values
        ...(newMode === "own" ? {
          timeValue: effectiveTimeValue,
          timeFilter: effectiveTimeFilter,
          categoryKey: effectiveCategoryKey,
          categoryValue: effectiveCategoryValue,
        } : {}),
      },
    });
  }, [isOwn, occurrence, onUpdate, effectiveTimeValue, effectiveTimeFilter, effectiveCategoryKey, effectiveCategoryValue]);

  // Time navigation — auto-switches to "own" mode if currently inheriting
  const handleTimePrev = useCallback(() => {
    const newDate = navigateDate(effectiveTimeValue, effectiveTimeFilter, "prev");
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        inheritMode: "own",
        timeValue: newDate,
        timeFilter: effectiveTimeFilter,
      },
    });
  }, [occurrence, onUpdate, effectiveTimeValue, effectiveTimeFilter]);

  const handleTimeNext = useCallback(() => {
    const newDate = navigateDate(effectiveTimeValue, effectiveTimeFilter, "next");
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        inheritMode: "own",
        timeValue: newDate,
        timeFilter: effectiveTimeFilter,
      },
    });
  }, [occurrence, onUpdate, effectiveTimeValue, effectiveTimeFilter]);

  // Category navigation — auto-switches to "own" mode if currently inheriting
  const handleCategoryPrev = useCallback(() => {
    if (!selectedCategoryDimension) return;
    const newValue = navigateCategory(effectiveCategoryValue, selectedCategoryDimension.values, "prev");
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        inheritMode: "own",
        categoryValue: newValue,
      },
    });
  }, [occurrence, onUpdate, effectiveCategoryValue, selectedCategoryDimension]);

  const handleCategoryNext = useCallback(() => {
    if (!selectedCategoryDimension) return;
    const newValue = navigateCategory(effectiveCategoryValue, selectedCategoryDimension.values, "next");
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        inheritMode: "own",
        categoryValue: newValue,
      },
    });
  }, [occurrence, onUpdate, effectiveCategoryValue, selectedCategoryDimension]);

  // Format display text
  const timeDisplay = formatPeriodCompact(effectiveTimeValue, effectiveTimeFilter);
  const categoryDisplay = effectiveCategoryValue || "All";

  const buttonSize = compact ? "h-5 w-5" : "h-6 w-6";
  const iconSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  const textSize = compact ? "text-[9px]" : "text-[10px]";

  // Toggleable mode: Filter icon toggles inline date nav visibility
  // Auto-activates on mobile unless already using collapsible mode
  const effectiveToggleable = toggleable || (isMobile && !collapsible);

  if (effectiveToggleable) {
    return (
      <div className="local-iteration-nav flex items-center gap-0.5">
        <Button
          size="sm" variant="ghost"
          className="h-5 w-5 p-0"
          onClick={() => setToggleOpen(prev => !prev)}
          title={toggleOpen ? "Hide date nav" : "Show date nav"}
        >
          <Filter className={`h-3 w-3 ${toggleOpen ? "text-blue-400" : "opacity-40"}`} />
        </Button>
        {toggleOpen && (
          <>
            {showModeToggle && (
              <Button size="sm" variant={isOwn ? "secondary" : "ghost"} className="h-5 w-5 p-0" onClick={handleModeToggle}>
                {isOwn ? <Unlink className="h-3 w-3" /> : <Link2 className="h-3 w-3 opacity-50" />}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleTimePrev}><ChevronLeft className="h-3 w-3" /></Button>
            <span className="text-[9px] min-w-[50px] text-center text-muted-foreground">{timeDisplay}</span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleTimeNext}><ChevronRight className="h-3 w-3" /></Button>
          </>
        )}
      </div>
    );
  }

  // Collapsible mode: icon always visible, click to open popover with full nav
  if (collapsible) {
    return (
      <Popover open={collapsibleOpen} onOpenChange={setCollapsibleOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-5 p-0"
            title={isOwn ? "Using own iteration" : "Inheriting from parent — click to adjust"}
          >
            {isOwn ? (
              <Unlink className="h-3 w-3 text-blue-400" />
            ) : (
              <Link2 className="h-3 w-3 opacity-40 hover:opacity-70" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" collisionPadding={8} className="w-auto p-2">
          <div className="flex items-center gap-0.5">
            <Button size="sm" variant={isOwn ? "secondary" : "ghost"} className="h-5 w-5 p-0" onClick={handleModeToggle} title={isOwn ? "Using own iteration" : "Inheriting"}>
              {isOwn ? <Unlink className="h-3 w-3" /> : <Link2 className="h-3 w-3 opacity-50" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleTimePrev}><ChevronLeft className="h-3 w-3" /></Button>
            <span className="text-[9px] min-w-[50px] text-center text-muted-foreground">{timeDisplay}</span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleTimeNext}><ChevronRight className="h-3 w-3" /></Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="local-iteration-nav flex items-center gap-0.5">
      {/* Mode toggle (inherit/own) */}
      {showModeToggle && (
        <Button
          size="sm"
          variant={isOwn ? "secondary" : "ghost"}
          className={`${buttonSize} p-0`}
          onClick={handleModeToggle}
          title={isOwn ? "Using own iteration (click to inherit)" : "Inheriting from parent (click for own)"}
        >
          {isOwn ? (
            <Unlink className={iconSize} />
          ) : (
            <Link2 className={`${iconSize} opacity-50`} />
          )}
        </Button>
      )}

      {/* Time navigation — always shown; clicking arrows auto-switches to "own" mode */}
      <div className="flex items-center gap-0">
        <Button
          size="sm"
          variant="ghost"
          className={`${buttonSize} p-0`}
          onClick={handleTimePrev}
          title="Previous period (switches to own mode)"
        >
          <ChevronLeft className={iconSize} />
        </Button>

        <span className={`${textSize} min-w-[50px] text-center ${isOwn ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
          {timeDisplay}
        </span>

        <Button
          size="sm"
          variant="ghost"
          className={`${buttonSize} p-0`}
          onClick={handleTimeNext}
          title="Next period (switches to own mode)"
        >
          <ChevronRight className={iconSize} />
        </Button>
      </div>

      {/* Category navigation — always shown when a category dimension is selected */}
      {selectedCategoryDimension && selectedCategoryDimension.values.length > 0 && (
        <div className="flex items-center gap-0 ml-1 pl-1 border-l border-border">
          <Button
            size="sm"
            variant="ghost"
            className={`${buttonSize} p-0`}
            onClick={handleCategoryPrev}
          >
            <ChevronLeft className={iconSize} />
          </Button>

          <span className={`${textSize} min-w-[40px] text-center ${isOwn ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
            {categoryDisplay}
          </span>

          <Button
            size="sm"
            variant="ghost"
            className={`${buttonSize} p-0`}
            onClick={handleCategoryNext}
          >
            <ChevronRight className={iconSize} />
          </Button>
        </div>
      )}
    </div>
  );
}
