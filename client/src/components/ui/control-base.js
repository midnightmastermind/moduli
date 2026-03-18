// components/ui/control-base.js
// Shared visual base for all form controls (Input, Select, Switch, Checkbox, etc.)
// Keeps every interactive element visually consistent.

export const CONTROL_H = "h-7";          // standard row height
export const CONTROL_COMPACT_H = "h-6";  // compact row height

export const CONTROL_BASE =
  "rounded border border-borderScale-0 bg-inputScale-2 text-xs font-mono text-foreground " +
  "focus:outline-none focus:ring-1 focus:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";
