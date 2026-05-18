// ui/FilterNav.jsx
// Toolbar navigation for the active named filter.
// If the active filter contains a date-type field, shows date prev/next/picker.
// Otherwise date nav is grayed out.
// Replaces IterationNav.jsx.

import React, { useMemo, useCallback } from "react";
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

const UNIT_LABELS = { day: "D", week: "W", month: "M", year: "Y" };
const UNIT_ORDER = ["day", "week", "month", "year"];
const SCALE_TO_UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };

// Active filter values can be either a bare YYYY-MM-DD string OR
// `{value, unit}`. `readValueShape` normalizes to `{ value: Date|null, unit }`.
function readValueShape(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { value: v.value ? new Date(v.value) : null, unit: v.unit || "day" };
  }
  if (v) return { value: new Date(v), unit: null };
  return { value: null, unit: null };
}

function formatDateDisplay(date, unit) {
  if (!date) return "Select date";
  const d = new Date(date);
  switch (unit) {
    case "day":
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    case "week": {
      const start = new Date(d);
      const dow = start.getDay();
      const offset = dow === 0 ? -6 : 1 - dow;
      start.setDate(start.getDate() + offset);
      return `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    case "month":
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "year":
      return String(d.getFullYear());
    default:
      return d.toLocaleDateString();
  }
}

function stepDate(date, unit, direction) {
  const d = new Date(date);
  const n = direction === "next" ? 1 : -1;
  switch (unit) {
    case "day":   d.setDate(d.getDate() + n); break;
    case "week":  d.setDate(d.getDate() + n * 7); break;
    case "month": d.setMonth(d.getMonth() + n); break;
    case "year":  d.setFullYear(d.getFullYear() + n); break;
    default:      d.setDate(d.getDate() + n);
  }
  return d;
}

function QuickDatePicker({ currentDate, unit, onSelect }) {
  const now = new Date();
  const options = useMemo(() => {
    const list = [];
    if (unit === "day") {
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        list.push({ date: d, label: i === 0 ? "Today" : i === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) });
      }
    } else if (unit === "week") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i * 7);
        const ws = new Date(d);
        ws.setDate(d.getDate() - d.getDay());
        list.push({ date: d, label: i === 0 ? "This Week" : i === 1 ? "Last Week" : `Week of ${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` });
      }
    } else if (unit === "month") {
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(now.getMonth() - i);
        list.push({ date: d, label: i === 0 ? "This Month" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
      }
    } else if (unit === "year") {
      for (let i = 0; i < 5; i++) {
        const d = new Date(now);
        d.setFullYear(now.getFullYear() - i);
        list.push({ date: d, label: i === 0 ? "This Year" : String(d.getFullYear()) });
      }
    }
    return list;
  }, [unit]);

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

  // Allowed units come from `activeFilter.units` if specified; otherwise we
  // expose all four (D/W/M/Y). The value's own `unit` wins over the filter's
  // static `timeScale` so per-occurrence toggles don't require editing the
  // named filter definition.
  const allowedUnits = useMemo(() => {
    const decl = Array.isArray(activeFilter?.units) ? activeFilter.units.filter(u => UNIT_ORDER.includes(u)) : null;
    return decl && decl.length ? decl : UNIT_ORDER;
  }, [activeFilter]);

  const rawValue = dateCond ? activeFilterValues[dateCond.fieldId] : null;
  const shape = readValueShape(rawValue);
  const unit = shape.unit || SCALE_TO_UNIT[activeFilter?.timeScale] || "day";
  const hasDateNav = !!dateCond;

  const currentDate = shape.value || new Date();
  const wasObjectShape = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue);

  const writeFilterValue = useCallback((date, nextUnit) => {
    if (!hasDateNav) return;
    const out = wasObjectShape || nextUnit !== "day"
      ? { value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, unit: nextUnit }
      : date;
    onFilterValueChange?.(dateCond.fieldId, out);
  }, [hasDateNav, dateCond, wasObjectShape, onFilterValueChange]);

  const isCurrentPeriod = useMemo(() => {
    if (!hasDateNav) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cur = new Date(currentDate);
    cur.setHours(0, 0, 0, 0);
    switch (unit) {
      case "day":   return today.getTime() === cur.getTime();
      case "week": {
        const ts = new Date(today); ts.setDate(today.getDate() - today.getDay());
        const cs = new Date(cur);   cs.setDate(cur.getDate() - cur.getDay());
        return ts.getTime() === cs.getTime();
      }
      case "month": return today.getFullYear() === cur.getFullYear() && today.getMonth() === cur.getMonth();
      case "year":  return today.getFullYear() === cur.getFullYear();
      default: return false;
    }
  }, [hasDateNav, currentDate, unit]);

  const handlePrev = useCallback(() => {
    if (!hasDateNav) return;
    writeFilterValue(stepDate(currentDate, unit, "prev"), unit);
  }, [hasDateNav, currentDate, unit, writeFilterValue]);

  const handleNext = useCallback(() => {
    if (!hasDateNav) return;
    writeFilterValue(stepDate(currentDate, unit, "next"), unit);
  }, [hasDateNav, currentDate, unit, writeFilterValue]);

  const handleToday = useCallback(() => {
    if (!hasDateNav) return;
    writeFilterValue(new Date(), unit);
  }, [hasDateNav, unit, writeFilterValue]);

  const handleDateSelect = useCallback((date) => {
    if (!hasDateNav) return;
    writeFilterValue(date, unit);
  }, [hasDateNav, unit, writeFilterValue]);

  const handleUnitChange = useCallback((u) => {
    if (!hasDateNav) return;
    writeFilterValue(currentDate, u);
  }, [hasDateNav, currentDate, writeFilterValue]);

  const h = compact ? "h-6" : "h-7";
  const textSz = compact ? "text-[10px]" : "text-xs";

  // Mobile: single Filter button → popover with full filter UI
  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" style={{ height: 26, width: 26, padding: 0 }} title="Filters">
            <Filter className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2 settings-sheet" align="end" side="bottom" collisionPadding={8}>
          <div className="flex flex-col gap-2" style={{ minWidth: 180 }}>
            {/* Filter selector */}
            {namedFilters.length > 0 && (
              <Select value={activeFilterId || ""} onValueChange={onSelectFilter}>
                <SelectTrigger className="px-1 w-full h-7 text-xs bg-inputScale-2 border border-borderScale-0 rounded">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 1300 }}>
                  {namedFilters.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name || "Untitled"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Date navigation */}
            {hasDateNav && (
              <div className="flex items-center" style={{ gap: 0 }}>
                <Button size="sm" onClick={handlePrev} className="!p-0" style={{ height: 26, width: 20, minWidth: 20 }}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  onClick={handleToday}
                  className={`!px-1 flex-1 ${isCurrentPeriod ? "text-primary" : ""}`}
                  style={{ height: 26, minWidth: 0, fontSize: 9 }}
                >
                  {formatDateDisplay(currentDate, unit)}
                </Button>
                <Button size="sm" onClick={handleNext} className="!p-0" style={{ height: 26, width: 20, minWidth: 20 }}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Unit toggle (D / W / M / Y) — only renders when 2+ allowed */}
            {hasDateNav && allowedUnits.length > 1 && (
              <div className="flex items-center justify-center" style={{ gap: 2 }}>
                {allowedUnits.map(u => (
                  <button
                    key={u}
                    onClick={() => handleUnitChange(u)}
                    title={u}
                    style={{
                      padding: "1px 6px", fontSize: 10, lineHeight: "14px",
                      borderRadius: 4,
                      border: "1px solid var(--panel-border, #374151)",
                      background: u === unit ? "var(--accent, #14b8a6)" : "transparent",
                      color: "inherit", cursor: "pointer",
                    }}
                  >{UNIT_LABELS[u]}</button>
                ))}
              </div>
            )}

            {/* Quick date picker */}
            {hasDateNav && (
              <>
                <div className="h-px bg-border" />
                <QuickDatePicker currentDate={currentDate} unit={unit} onSelect={handleDateSelect} />
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Desktop: inline filter + date nav
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

      {/* Date navigation — only shown when active filter has a date field + timeScale */}
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
              {hasDateNav ? formatDateDisplay(currentDate, unit) : "No date"}
            </Button>
          </PopoverTrigger>
          {hasDateNav && (
            <PopoverContent className="w-auto p-2" align="center">
              <QuickDatePicker currentDate={currentDate} unit={unit} onSelect={handleDateSelect} />
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

        {/* Unit toggle (D / W / M / Y) — compact pill row */}
        {hasDateNav && allowedUnits.length > 1 && (
          <div className="flex items-center ml-1" style={{ gap: 1 }}>
            {allowedUnits.map(u => (
              <button
                key={u}
                onClick={() => handleUnitChange(u)}
                title={u}
                style={{
                  padding: "0 4px", fontSize: 9, lineHeight: compact ? "16px" : "20px",
                  borderRadius: 3,
                  border: "1px solid var(--panel-border, #374151)",
                  background: u === unit ? "var(--accent, #14b8a6)" : "transparent",
                  color: "inherit", cursor: "pointer",
                }}
              >{UNIT_LABELS[u]}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
