// Pure data layer for CategoryPathPicker.
// Each category provides level-1 items via resolveItems(ctx). Items carry
// title, sub (right-of-title detail), and description (under title) so the
// picker renders rich rows like PanelKindSelector everywhere it appears.
//
// ctx shape:
//   { sources, localVars, fields, fieldsById, modulesById, occurrencesById }
//
// `entityType` strings on Source rows determine what bucket of the runtime JSON
// is bound to that source. Anything that maps to a collection of occurrences
// makes the source visible inside the Occurrences category. Field bindings
// stay in the Fields category alongside the global field templates.

import { Database, Box, Hash, Variable, Sparkles } from "lucide-react";

const OCCURRENCE_COLLECTION_TYPES = new Set([
  "allOccurrences", "allContainers", "allPages", "allInstances", "allTemplates",
]);

const FIELD_LIKE_TYPES = new Set(["field", "localField"]);

function describeSource(src) {
  if (src.entityType === "trigger") {
    return src.triggerProp ? `Trigger ▸ ${src.triggerProp}` : "Bound from trigger event";
  }
  if (src.entityType === "parentFilter") return "Effective filter walked from trigger ancestors";
  if (src.entityType === "effectiveFilter") return src.targetLabel
    ? `Effective filter for "${src.targetLabel}"`
    : "Effective filter for a chosen container";
  if (src.entityType === "occurrence") return src.entityId ? `Specific occurrence` : "Pick an occurrence";
  if (src.entityType === "instance" || src.entityType === "container" || src.entityType === "panel")
    return `Bound from ${src.entityType} module`;
  if (OCCURRENCE_COLLECTION_TYPES.has(src.entityType)) {
    if (src.entityType === "allOccurrences") return "Every occurrence on the grid";
    if (src.entityType === "allContainers") return "Every container occurrence";
    if (src.entityType === "allPages")      return "Every page-role panel";
    if (src.entityType === "allInstances")  return "Every leaf instance";
    if (src.entityType === "allTemplates")  return "Every module template";
  }
  if (src.entityType === "field" || src.entityType === "localField")
    return src.entityId ? "Bound from a field record" : "Pick a field";
  if (src.entityType === "grid") return "The current grid record";
  return src.entityType || "Bound source";
}

export const CATEGORIES = [
  {
    id: "sources",
    label: "Sources",
    description: "Variables you bound from the trigger, filters, or other entities. Add a Source row to expose more.",
    icon: Database,
    color: "rgba(59,130,246,0.7)",   // blue
    resolveItems: (ctx) => (ctx.sources || []).map(s => ({
      value: `$${s.variableName}`,
      title: `$${s.variableName}`,
      sub: s.entityType,
      description: describeSource(s),
      hasChildren: true,
    })),
  },
  {
    id: "occurrences",
    label: "Occurrences",
    description: "Collections of placements on the grid. Bind a Source first to expose one here.",
    icon: Box,
    color: "rgba(34,197,94,0.7)",    // green
    resolveItems: (ctx) => (ctx.sources || [])
      .filter(s => OCCURRENCE_COLLECTION_TYPES.has(s.entityType))
      .map(s => ({
        value: `$${s.variableName}`,
        title: `$${s.variableName}`,
        sub: s.entityType,
        description: describeSource(s),
        hasChildren: true,
      })),
  },
  {
    id: "fields",
    label: "Fields",
    description: "Field templates declared on the grid (read aggregated values).",
    icon: Hash,
    color: "rgba(168,85,247,0.7)",   // purple
    resolveItems: (ctx) => {
      const sourceFields = (ctx.sources || [])
        .filter(s => FIELD_LIKE_TYPES.has(s.entityType))
        .map(s => ({
          value: `$${s.variableName}`,
          title: `$${s.variableName}`,
          sub: s.entityType,
          description: describeSource(s),
          hasChildren: true,
        }));
      const templateFields = (ctx.fields || []).map(f => ({
        value: `field:${f.id}`,
        title: f.name || "(unnamed field)",
        sub: f.type || "field",
        description: f.meta?.description || `Aggregated ${f.type || "field"} value`,
        hasChildren: true,
      }));
      return [...sourceFields, ...templateFields];
    },
  },
  {
    id: "localVars",
    label: "Local Variables",
    description: "Vars declared by INIT_VAR, SET_VAR, or loop iteration earlier in this pipeline.",
    icon: Variable,
    color: "rgba(251,191,36,0.7)",   // amber
    resolveItems: (ctx) => (ctx.localVars || []).map(name => ({
      value: name,
      title: name,
      sub: "local",
      description: "Declared earlier in this pipeline",
      hasChildren: true,
    })),
  },
  {
    id: "builtins",
    label: "Built-ins",
    description: "Date/time/grid scalars provided by the runtime.",
    icon: Sparkles,
    color: "rgba(244,114,182,0.7)",  // pink
    resolveItems: () => [
      { value: "$today",            title: "$today",            sub: "string",     description: "Local YYYY-MM-DD",                hasChildren: false },
      { value: "$now",              title: "$now",              sub: "ISO",        description: "Current ISO timestamp",            hasChildren: false },
      { value: "$activeDate",       title: "$activeDate",       sub: "string",     description: "Date the active filter is on",    hasChildren: false },
      { value: "$activeDateLabel",  title: "$activeDateLabel",  sub: "string",     description: "Human-readable active date",      hasChildren: false },
      { value: "$activeDayOfWeek",  title: "$activeDayOfWeek",  sub: "string",     description: "Monday/Tuesday/...",              hasChildren: false },
      { value: "$grid",             title: "$grid",             sub: "object",     description: "The current grid record",          hasChildren: true  },
    ],
  },
];

export function resolveCategoryItems(categoryId, ctx) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return cat ? cat.resolveItems(ctx) : [];
}
