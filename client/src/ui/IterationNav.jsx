// ui/IterationNav.jsx
// ============================================================
// Navigation component for iteration/time-based filtering
// Includes: iteration selector dropdown, date navigation arrows,
// and a period display button that opens a quick date picker
// ============================================================

import React, { useMemo, useCallback, useState } from "react";
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
import { ChevronLeft, ChevronRight, CalendarDays, Plus } from "lucide-react";
import { uid } from "../uid";

/**
 * Format a date based on time filter type
 */
function formatPeriodDisplay(date, timeFilter) {
  if (!date) return "Select date";
  const d = new Date(date);

  switch (timeFilter) {
    case "daily":
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    case "weekly": {
      // Show week range
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return `${startOfWeek.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${endOfWeek.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    case "monthly":
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "yearly":
      return d.getFullYear().toString();
    default:
      return d.toLocaleDateString();
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
 * QuickDatePicker - Simple date selection options
 */
function QuickDatePicker({ currentDate, timeFilter, onSelect }) {
  const quickOptions = useMemo(() => {
    const now = new Date();
    const options = [];

    if (timeFilter === "daily") {
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        options.push({
          date: d,
          label: i === 0 ? "Today" : i === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        });
      }
    } else if (timeFilter === "weekly") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - (i * 7));
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        options.push({
          date: d,
          label: i === 0 ? "This Week" : i === 1 ? "Last Week" : `Week of ${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        });
      }
    } else if (timeFilter === "monthly") {
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(now.getMonth() - i);
        options.push({
          date: d,
          label: i === 0 ? "This Month" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        });
      }
    } else if (timeFilter === "yearly") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setFullYear(now.getFullYear() - i);
        options.push({
          date: d,
          label: i === 0 ? "This Year" : d.getFullYear().toString(),
        });
      }
    }

    return options;
  }, [timeFilter]);

  return (
    <div className="flex flex-col gap-1">
      {quickOptions.map((opt, i) => (
        <Button
          key={i}
          variant="ghost"
          size="sm"
          className="justify-start h-7 text-xs"
          onClick={() => onSelect(opt.date)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * IterationNav - Navigation for iteration-based time filtering
 *
 * Props:
 * - iterations: Array of { id, name, timeFilter }
 * - selectedIterationId: Currently selected iteration ID
 * - onSelectIteration: (id) => void
 * - currentValue: Current date/period value
 * - onValueChange: (date) => void
 */
const TIME_FILTER_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "all", label: "All Time" },
];

export default function IterationNav({
  iterations = [],
  selectedIterationId,
  onSelectIteration,
  currentValue,
  onValueChange,
  onCommitIterations, // optional: if provided, shows "+" button to create new iteration
}) {
  // New-iteration form state
  const [newPopoverOpen, setNewPopoverOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTimeFilter, setNewTimeFilter] = useState("daily");

  const handleCreateIteration = useCallback(() => {
    const name = newName.trim() || "New";
    const newIter = { id: uid(), name, timeFilter: newTimeFilter };
    const updated = [...iterations, newIter];
    onCommitIterations?.(updated);
    onSelectIteration?.(newIter.id);
    setNewName("");
    setNewTimeFilter("daily");
    setNewPopoverOpen(false);
  }, [newName, newTimeFilter, iterations, onCommitIterations, onSelectIteration]);

  // Get the selected iteration
  const selectedIteration = useMemo(() => {
    return iterations.find(i => i.id === selectedIterationId) || iterations[0];
  }, [iterations, selectedIterationId]);

  const timeFilter = selectedIteration?.timeFilter || "daily";
  const currentDate = currentValue ? new Date(currentValue) : new Date();

  // Navigation handlers
  const handlePrev = useCallback(() => {
    const newDate = navigateDate(currentDate, timeFilter, "prev");
    onValueChange?.(newDate);
  }, [currentDate, timeFilter, onValueChange]);

  const handleNext = useCallback(() => {
    const newDate = navigateDate(currentDate, timeFilter, "next");
    onValueChange?.(newDate);
  }, [currentDate, timeFilter, onValueChange]);

  const handleDateSelect = useCallback((date) => {
    if (date) {
      onValueChange?.(date);
    }
  }, [onValueChange]);

  // Jump to today
  const handleToday = useCallback(() => {
    onValueChange?.(new Date());
  }, [onValueChange]);

  // Format display text
  const displayText = formatPeriodDisplay(currentDate, timeFilter);

  // Check if we're on today/current period
  const isCurrentPeriod = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = new Date(currentDate);
    current.setHours(0, 0, 0, 0);

    switch (timeFilter) {
      case "daily":
        return today.getTime() === current.getTime();
      case "weekly": {
        const todayWeekStart = new Date(today);
        todayWeekStart.setDate(today.getDate() - today.getDay());
        const currentWeekStart = new Date(current);
        currentWeekStart.setDate(current.getDate() - current.getDay());
        return todayWeekStart.getTime() === currentWeekStart.getTime();
      }
      case "monthly":
        return today.getFullYear() === current.getFullYear() &&
               today.getMonth() === current.getMonth();
      case "yearly":
        return today.getFullYear() === current.getFullYear();
      default:
        return false;
    }
  }, [currentDate, timeFilter]);

  return (
    <div className="iteration-nav flex items-center gap-0.5">
      {/* Iteration selector dropdown */}
      {iterations.length > 0 && (
        <Select
          value={selectedIterationId || iterations[0]?.id}
          onValueChange={onSelectIteration}
        >
          <SelectTrigger className="px-1 w-auto min-w-[60px] text-[9px] sm:text-xs bg-inputScale-2 border border-borderScale-0 rounded">
            <SelectValue placeholder="Iteration" />
          </SelectTrigger>
          <SelectContent>
            {iterations.map(iter => (
              <SelectItem key={iter.id} value={iter.id}>
                {iter.name || iter.timeFilter}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Create new iteration button */}
      {onCommitIterations && (
        <Popover open={newPopoverOpen} onOpenChange={setNewPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              title="Create new iteration"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">New Iteration</p>
              <input
                className="h-7 text-xs px-2 rounded border border-border bg-background text-foreground outline-none"
                placeholder="Name (e.g. Daily)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateIteration();
                  if (e.key === "Escape") setNewPopoverOpen(false);
                }}
                autoFocus
              />
              <Select value={newTimeFilter} onValueChange={setNewTimeFilter}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_FILTER_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs" onClick={handleCreateIteration}>
                Create
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Navigation controls */}
      <div className="flex items-center gap-0">
        {/* Previous button */}
        <Button
          size="sm"
          className="px-0.5"
          onClick={handlePrev}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Period display / date picker button */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              className={`px-1.5 min-w-[80px] ${
                isCurrentPeriod ? "text-primary" : ""
              }`}
            >
              <CalendarDays className="h-3 w-3 mr-1" />
              {displayText}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="center">
            <QuickDatePicker
              currentDate={currentDate}
              timeFilter={timeFilter}
              onSelect={handleDateSelect}
            />
            {!isCurrentPeriod && (
              <div className="pt-2 border-t border-border mt-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleToday}
                >
                  Go to Today
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Next button */}
        <Button
          size="sm"
          className="px-0.5"
          onClick={handleNext}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
