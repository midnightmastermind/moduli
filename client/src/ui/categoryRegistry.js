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
    description: "Collections of placements on the grid. $allItems and $allTemplates are always available; bind a Source for filtered subsets.",
    icon: Box,
    color: "rgba(34,197,94,0.7)",    // green
    resolveItems: (ctx) => {
      const builtins = [
        {
          value: "$allItems",
          title: "$allItems",
          sub: "occurrenceArray",
          description: "Every occurrence on the grid, merged with its template (label/role/kind/meta)",
          hasChildren: true,
        },
        {
          value: "$allTemplates",
          title: "$allTemplates",
          sub: "templateArray",
          description: "Every module template (id, label, role, kind, meta)",
          hasChildren: true,
        },
      ];
      const sourceBound = (ctx.sources || [])
        .filter(s => OCCURRENCE_COLLECTION_TYPES.has(s.entityType))
        .map(s => ({
          value: `$${s.variableName}`,
          title: `$${s.variableName}`,
          sub: s.entityType,
          description: describeSource(s),
          hasChildren: true,
        }));
      return [...builtins, ...sourceBound];
    },
  },
  {
    id: "fields",
    label: "Fields",
    description: "Field templates declared on the grid (read aggregated values).",
    icon: Hash,
    color: "rgba(168,85,247,0.7)",   // purple
    resolveItems: (ctx) => {
      const builtins = [{
        value: "$allFields",
        title: "$allFields",
        sub: "fieldArray",
        description: "Every field record on the grid (id, name, type, meta)",
        hasChildren: true,
      }];
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
      return [...builtins, ...sourceFields, ...templateFields];
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
      { value: "$trigger",          title: "$trigger",          sub: "object",     description: "The triggering event payload (occurrence-shaped + extras)", hasChildren: true },
      { value: "$parentFilter",     title: "$parentFilter",     sub: "filter",     description: "Effective filter values walked from the trigger occurrence's ancestor chain (keyed by fieldId)", hasChildren: true },
      { value: "$this",             title: "$this",             sub: "occurrence", description: "The current instance — the row this field is bound to (available in find-mode option predicates)", hasChildren: true },
    ],
  },
];

export function resolveCategoryItems(categoryId, ctx) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return cat ? cat.resolveItems(ctx) : [];
}

// ---- Specialized picker configs ----------------------------------------------
// Find and Loop both take a single collection variable as their iteration target.
// COLLECTION_PICKER_CONFIG drives a CategoryPathPicker that exposes only those
// collections — picked value is committed in one click (no further drilling).
//
// $allOccurrences / $allItems are aliases at runtime; we surface both because
// authors reach for different names depending on context. Same for the
// role-filtered slices.

const COLLECTION_ITEMS = [
  {
    value: "$allOccurrences", title: "$allOccurrences", sub: "occurrenceArray",
    description: "Every occurrence on the grid (alias of $allItems — pick whichever reads better)",
    hasChildren: false,
  },
  {
    value: "$allItems", title: "$allItems", sub: "occurrenceArray",
    description: "Every occurrence on the grid",
    hasChildren: false,
  },
  {
    value: "$allContainers", title: "$allContainers", sub: "occurrenceArray",
    description: "Every container occurrence",
    hasChildren: false,
  },
  {
    value: "$allPages", title: "$allPages", sub: "occurrenceArray",
    description: "Every page-role occurrence (Schedule, Daily Toolkit, …)",
    hasChildren: false,
  },
  {
    value: "$allPanels", title: "$allPanels", sub: "occurrenceArray",
    description: "Every panel-role grid-cell occurrence",
    hasChildren: false,
  },
  {
    value: "$allInstances", title: "$allInstances", sub: "occurrenceArray",
    description: "Every leaf instance occurrence",
    hasChildren: false,
  },
  {
    value: "$allTemplates", title: "$allTemplates", sub: "templateArray",
    description: "Every module template",
    hasChildren: false,
  },
  {
    value: "$allFields", title: "$allFields", sub: "fieldArray",
    description: "Every field record on the grid",
    hasChildren: false,
  },
];

export const COLLECTION_PICKER_CONFIG = {
  placeholder: "Pick collection",
  categories: [{
    id: "collections",
    label: "Pick a collection to iterate",
    description: "What set of records this step looks at",
    icon: Box,
    color: "rgba(34,197,94,0.7)",
    resolveItems: () => COLLECTION_ITEMS,
  }],
};

// Map a collection variable name to the per-record shape the picker should
// drill into. Used by Find: once the user picks `$allOccurrences` for
// `cfg.over`, the predicate left-side picker walks occurrence keys (label,
// fields, role, etc.). `$allTemplates` walks template keys; `$allFields` walks
// field keys.
export function recordShapeForCollection(over) {
  if (!over) return "occurrence";
  if (over === "$allTemplates") return "templateArray";
  if (over === "$allFields") return "fieldArray";
  // Everything else (allOccurrences/allItems/allContainers/allPages/allInstances)
  // resolves to per-occurrence keys.
  return "occurrence";
}

// Build a config for a CategoryPathPicker that picks a record-key path on the
// record currently being iterated. There are no $-prefixed names in the
// committed value — just the dotted key (`label`, `fields.<fid>.value`).
export function buildRecordKeyPickerConfig(over, { placeholder } = {}) {
  return {
    placeholder: placeholder || "Pick record field",
    recordShape: recordShapeForCollection(over),
  };
}

// TEMPLATE_PICKER_CONFIG drives a CategoryPathPicker that lists every saved
// template (occurrence carrying meta.templateName) under one category. Used
// by the APPLY_TEMPLATE action editor so authors can pick a template by name
// instead of hand-typing its occurrence id. Picking a row commits the
// template occurrence id as the chosen value. Falls back to a $-prefixed
// Sources row when sources include `allTemplates` so authors can still bind
// a template via a Source if they prefer.
export const TEMPLATE_PICKER_CONFIG = {
  placeholder: "Pick template",
  categories: [
    {
      id: "templates",
      label: "Saved templates",
      description: "Pick one of the named templates in the Templates manifest",
      icon: Sparkles,
      color: "rgba(139,92,246,0.7)",
      resolveItems: (ctx) => {
        const occById = ctx?.occurrencesById || {};
        const modById = ctx?.modulesById || {};
        return Object.values(occById)
          .filter(o => o?.meta?.templateName)
          .map(o => {
            const mod = modById[o.moduleId || o.targetId];
            const kind = mod?.role || mod?.kind || "";
            return {
              value: o.id,
              title: o.meta.templateName,
              sub: kind || "template",
              description: kind
                ? `Template (${kind}) — apply to a matching ${kind} occurrence`
                : "Saved template",
              hasChildren: false,
            };
          })
          .sort((a, b) => a.title.localeCompare(b.title));
      },
    },
    {
      id: "sources",
      label: "Sources",
      description: "Variables bound from a Source row that resolves to a template",
      icon: Database,
      color: "rgba(59,130,246,0.7)",
      resolveItems: (ctx) => (ctx?.sources || [])
        .filter(s => s.entityType === "allTemplates" || s.entityType === "occurrence")
        .map(s => ({
          value: `$${s.variableName}`,
          title: `$${s.variableName}`,
          sub: s.entityType,
          description: s.entityType === "allTemplates"
            ? "All template modules (pick one via path drill)"
            : "Bound occurrence — must be a template",
          hasChildren: false,
        })),
    },
  ],
};
