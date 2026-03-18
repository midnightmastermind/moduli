// ui/FilterNav.jsx
// Toolbar navigation for the active named filter.
// If the active filter contains a date-type field, shows date prev/next/picker.
// Otherwise date nav is grayed out.
// Replaces IterationNav.jsx.

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
import { ChevronLeft, ChevronRight, CalendarDays, Filter } from "lucide-react";

function formatDateDisplay(date, timeScale) {
  if (!date) return "Select date";
  const d = new Date(date);
  switch (timeScale) {
    case "daily":
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    case "weekly": {
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    case "monthly":
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "yearly":
      return String(d.getFullYear());
    default:
      return d.toLocaleDateString();
  }
}

function stepDate(date, timeScale, direction) {
  const d = new Date(date);
  const n = direction === "next" ? 1 : -1;
  switch (timeScale) {
    case "daily":   d.setDate(d.getDate() + n); break;
    case "weekly":  d.setDate(d.getDate() + n * 7); break;
    case "monthly": d.setMonth(d.getMonth() + n); break;
    case "yearly":  d.setFullYear(d.getFullYear() + n); break;
  }
  return d;
}

function QuickDatePicker({ currentDate, timeScale, onSelect }) {
  const now = new Date();
  const options = useMemo(() => {
    const list = [];
    if (timeScale === "daily") {
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        list.push({ date: d, label: i === 0 ? "Today" : i === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) });
      }
    } else if (timeScale === "weekly") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i * 7);
        const ws = new Date(d);
        ws.setDate(d.getDate() - d.getDay());
        list.push({ date: d, label: i === 0 ? "This Week" : i === 1 ? "Last Week" : `Week of ${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` });
      }
    } else if (timeScale === "monthly") {
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(now.getMonth() - i);
        list.push({ date: d, label: i === 0 ? "This Month" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
      }
    } else if (timeScale === "yearly") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setFullYear(now.getFullYear() - i);
        list.push({ date: d, label: i === 0 ? "This Year" : String(d.getFullYear()) });
      }
    }
    return list;
  }, [timeScale]);

  return (
    <div className="flex flex-col gap-1">
      {options.map((o, i) => (
        <Button key={i} variant="ghost" size="sm" className="justify-start h-7 text-xs" onClick={() => onSelect(o.date)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * FilterNav
 *
 * Props:
 *   grid              — grid object with namedFilters[], activeFilterId, activeFilterValues
 *   fieldsById        — { [fieldId]: field } map (to determine if a filter field is date type)
 *   onSelectFilter    — (filterId) => void
 *   onFilterValueChange — (fieldId, value) => void   called when date nav changes
 */
export default function FilterNav({ grid, fieldsById = {}, onSelectFilter, onFilterValueChange, compact = false, isMobile = false }) {
  const [dateNavVisible, setDateNavVisible] = useState(!isMobile);
  const namedFilters = grid?.namedFilters || [];
  const activeFilterId = grid?.activeFilterId || namedFilters[0]?.id || null;
  const activeFilterValues = grid?.activeFilterValues || {};

  const activeFilter = useMemo(
    () => namedFilters.find(f => f.id === activeFilterId) || namedFilters[0] || null,
    [namedFilters, activeFilterId]
  );

  // Find the date-type condition in the active filter (if any)
  const dateCond = useMemo(() => {
    if (!activeFilter?.conditions) return null;
    return activeFilter.conditions.find(c => {
      const field = fieldsById[c.fieldId];
      return field?.type === "date";
    }) || null;
  }, [activeFilter, fieldsById]);

  const timeScale = activeFilter?.timeScale || null;
  const hasDateNav = !!(dateCond && timeScale);

  // Current date value for the date field in this filter
  const currentDateValue = dateCond ? (activeFilterValues[dateCond.fieldId] || new Date()) : new Date();
  const currentDate = new Date(currentDateValue);

  const isCurrentPeriod = useMemo(() => {
    if (!hasDateNav) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cur = new Date(currentDate);
    cur.setHours(0, 0, 0, 0);
    switch (timeScale) {
      case "daily":   return today.getTime() === cur.getTime();
      case "weekly": {
        const ts = new Date(today); ts.setDate(today.getDate() - today.getDay());
        const cs = new Date(cur);   cs.setDate(cur.getDate() - cur.getDay());
        return ts.getTime() === cs.getTime();
      }
      case "monthly": return today.getFullYear() === cur.getFullYear() && today.getMonth() === cur.getMonth();
      case "yearly":  return today.getFullYear() === cur.getFullYear();
      default: return false;
    }
  }, [hasDateNav, currentDate, timeScale]);

  const handlePrev = useCallback(() => {
    if (!hasDateNav) return;
    onFilterValueChange?.(dateCond.fieldId, stepDate(currentDate, timeScale, "prev"));
  }, [hasDateNav, dateCond, currentDate, timeScale, onFilterValueChange]);

  const handleNext = useCallback(() => {
    if (!hasDateNav) return;
    onFilterValueChange?.(dateCond.fieldId, stepDate(currentDate, timeScale, "next"));
  }, [hasDateNav, dateCond, currentDate, timeScale, onFilterValueChange]);

  const handleToday = useCallback(() => {
    if (!hasDateNav) return;
    onFilterValueChange?.(dateCond.fieldId, new Date());
  }, [hasDateNav, dateCond, onFilterValueChange]);

  const handleDateSelect = useCallback((date) => {
    if (!hasDateNav) return;
    onFilterValueChange?.(dateCond.fieldId, date);
  }, [hasDateNav, dateCond, onFilterValueChange]);

  const h = compact ? "h-6" : "h-7";
  const textSz = compact ? "text-[10px]" : "text-xs";

  return (
    <div className="filter-nav flex items-center gap-0.5">
      {/* Filter selector */}
      {namedFilters.length > 0 && (
        <Select value={activeFilterId || ""} onValueChange={onSelectFilter}>
          <SelectTrigger className={`px-1 w-auto min-w-[54px] ${h} ${textSz} bg-inputScale-2 border border-borderScale-0 rounded`}>
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            {namedFilters.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name || "Untitled"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Date nav toggle button — on mobile, collapsed by default */}
      {isMobile && hasDateNav && (
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
          onClick={() => setDateNavVisible(v => !v)}
          title={dateNavVisible ? "Hide date nav" : "Show date nav"}>
          <Filter className={`h-3 w-3 ${dateNavVisible ? "text-blue-400" : "opacity-40"}`} />
        </Button>
      )}

      {/* Date navigation — only shown when active filter has a date field + timeScale */}
      {dateNavVisible && (
      <div className={`flex items-center gap-0 ${!hasDateNav ? "opacity-30 pointer-events-none" : ""}`}>
        <Button size="sm" className={`px-0.5 ${h}`} onClick={handlePrev} disabled={!hasDateNav}>
          <ChevronLeft className="h-3 w-3" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              disabled={!hasDateNav}
              className={`px-1 min-w-[72px] ${h} ${textSz} ${isCurrentPeriod ? "text-primary" : ""}`}
            >
              <CalendarDays className="h-3 w-3 mr-1" />
              {hasDateNav ? formatDateDisplay(currentDate, timeScale) : "No date"}
            </Button>
          </PopoverTrigger>
          {hasDateNav && (
            <PopoverContent className="w-auto p-2" align="center">
              <QuickDatePicker currentDate={currentDate} timeScale={timeScale} onSelect={handleDateSelect} />
              {!isCurrentPeriod && (
                <div className="pt-2 border-t border-border mt-2">
                  <Button size="sm" className="w-full" onClick={handleToday}>Go to Today</Button>
                </div>
              )}
            </PopoverContent>
          )}
        </Popover>

        <Button size="sm" className={`px-0.5 ${h}`} onClick={handleNext} disabled={!hasDateNav}>
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
      )}
    </div>
  );
}
