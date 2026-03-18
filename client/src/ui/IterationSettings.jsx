// ui/IterationSettings.jsx
// ============================================================
// Reusable component for configuring iteration/persistence settings
// Used in Panel, Container, and Instance settings forms
// ============================================================

import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERSISTENCE_MODES } from "../helpers/CalculationHelpers";

// Convert PERSISTENCE_MODES to options array
const PERSISTENCE_MODE_OPTIONS = Object.entries(PERSISTENCE_MODES).map(([value, config]) => ({
  value,
  label: config.label,
  description: config.description,
  icon: config.icon,
}));

/**
 * IterationSettings - Controls for occurrence persistence behavior
 *
 * Props:
 * - occurrence: The occurrence object (with iteration.mode, etc.)
 * - onUpdate: Callback when settings change: (updates) => void
 * - entityType: "panel" | "container" | "instance" - for contextual labels
 * - compact: boolean - use smaller styling
 */
export default function IterationSettings({
  occurrence,
  onUpdate,
  entityType = "instance",
  compact = false,
}) {
  const mode = occurrence?.iteration?.mode || "specific";

  const handleModeChange = (newMode) => {
    onUpdate?.({
      iteration: {
        ...(occurrence?.iteration || {}),
        mode: newMode,
      },
    });
  };

  // Contextual descriptions based on entity type
  const getDescription = (modeValue) => {
    const config = PERSISTENCE_MODES[modeValue];
    if (!config) return "";

    if (entityType === "panel") {
      switch (modeValue) {
        case "persistent":
          return "Panel shows on all days/weeks/months";
        case "specific":
          return "Panel only shows on its specific date";
        case "untilDone":
          return "Panel shows until all items are completed";
        default:
          return config.description;
      }
    }

    if (entityType === "container") {
      switch (modeValue) {
        case "persistent":
          return "Container shows on all iterations (category list)";
        case "specific":
          return "Container only shows on its specific date";
        case "untilDone":
          return "Container shows until completed";
        default:
          return config.description;
      }
    }

    // Instance descriptions
    switch (modeValue) {
      case "persistent":
        return "Template - always available to copy from";
      case "specific":
        return "Only exists on this specific date";
      case "untilDone":
        return "Shows daily until checked off, then stays on completion date";
      default:
        return config.description;
    }
  };

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex items-center justify-between">
        <Label className={compact ? "text-[10px]" : "text-xs"}>
          Iteration Mode
        </Label>
        <span className={`${compact ? "text-[9px]" : "text-[10px]"} opacity-70`}>
          {PERSISTENCE_MODES[mode]?.icon} {PERSISTENCE_MODES[mode]?.label}
        </span>
      </div>

      <Select value={mode} onValueChange={handleModeChange}>
        <SelectTrigger className={compact ? "h-7 text-xs" : "h-8 text-sm"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERSISTENCE_MODE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="flex items-center gap-2">
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className={`${compact ? "text-[9px]" : "text-[10px]"} text-muted-foreground/80`}>
        {getDescription(mode)}
      </p>
    </div>
  );
}
