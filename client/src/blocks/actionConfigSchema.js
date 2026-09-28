// blocks/actionConfigSchema.js
//
// WHAT EACH ACTION IS CONFIGURED WITH, as data.
//
// `OperationsBuilder` hand-writes a step editor per action. 35 of the 70
// actions in the picker had none, so choosing one rendered a step with nothing
// to configure — it ran, silently, on whatever defaults its executor case
// happened to take. Found 2026-08-18 by building operations through the UI.
//
// Writing 35 more bespoke editors would be 35 more places for the editor and
// the executor to drift. These actions have a very regular shape — a source
// variable, a knob or two, a destination variable — so the shape is declared
// here and ONE renderer draws it.
//
// Every entry was read off the executor's own `case` in
// `helpers/operationActions.js`, which is the specification. Kinds:
//
//   var    a $variable NAME       (stored with a leading `$`)
//   expr   an expression or path  (ExprOrPath: `$item.value`, `5`, `literal:x`)
//   path   a DOTTED PATH INSIDE EACH ROW (`date`, `fields.x.value`) — NOT an
//          expression; the executor walks it per element, so a `$var` here is
//          silently wrong and the placeholder says so
//   text   a plain string
//   number a number
//   select one of `options`
//   bool   a checkbox
//   list   a list of expressions
//
// `hint` is the one-line explanation shown under the row. A field marked
// `optional` renders the default the executor applies when it is blank, so a
// blank input is never a mystery.

export const ACTION_CONFIG_SCHEMA = {
  // ── Aggregators over an array variable ───────────────────────────────────
  SUM_VAR: {
    fields: [
      { key: "name", kind: "var", label: "sum $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "pages   (blank = the number itself)" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$sum" },
    ],
    hint: "Adds up an array. `by` is a path inside each row; blank treats each row as the number.",
  },
  MIN_VAR: {
    fields: [
      { key: "name", kind: "var", label: "min of $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "pages" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$min" },
    ],
    hint: "Smallest number in an array. Empty array → null, not 0.",
  },
  MAX_VAR: {
    fields: [
      { key: "name", kind: "var", label: "max of $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "pages" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$max" },
    ],
    hint: "Largest number in an array. Empty array → null, not 0.",
  },
  AVG_VAR: {
    fields: [
      { key: "name", kind: "var", label: "average of $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "pages" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$avg" },
    ],
    hint: "Mean of an array, skipping anything that is not a number.",
  },
  STREAK_VAR: {
    fields: [
      { key: "name", kind: "var", label: "streak in $" },
      { key: "by", kind: "path", label: "date at", optional: true, defaultsTo: "date" },
      { key: "today", kind: "expr", label: "ending", optional: true, defaultsTo: "$today" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$streak" },
    ],
    hint: "Consecutive days present in the array, counting back from `ending`. A gap stops the count.",
  },
  ARRAY_LENGTH: {
    fields: [
      { key: "name", kind: "var", label: "length of $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$length" },
    ],
  },

  // ── Collections ──────────────────────────────────────────────────────────
  PUSH_TO_ARRAY: {
    fields: [
      { key: "name", kind: "var", label: "push into $" },
      { key: "value", kind: "expr", label: "value", placeholder: "$item.label   or   json:{\"a\":\"$x\"}" },
    ],
    hint: "Appends one entry. An object value has every leaf resolved, so `{label: \"$item.label\"}` works.",
  },
  MERGE_ARRAY: {
    fields: [
      { key: "name", kind: "var", label: "merge into $" },
      { key: "with", kind: "expr", label: "with", placeholder: "$otherList" },
      { key: "unique", kind: "bool", label: "drop duplicates" },
    ],
  },
  SORT_VAR: {
    fields: [
      { key: "name", kind: "var", label: "sort $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "pages   (blank = the value itself)" },
      { key: "direction", kind: "select", label: "order", options: ["asc", "desc"], optional: true, defaultsTo: "asc" },
    ],
    hint: "Sorts in place. Nulls always sort last.",
  },
  UNIQUE_VAR: {
    fields: [
      { key: "name", kind: "var", label: "dedupe $" },
      { key: "by", kind: "path", label: "by", optional: true, placeholder: "id" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  REVERSE_VAR: {
    fields: [
      { key: "name", kind: "var", label: "reverse $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  SLICE_VAR: {
    fields: [
      { key: "name", kind: "var", label: "slice $" },
      { key: "start", kind: "expr", label: "from", placeholder: "0" },
      { key: "end", kind: "expr", label: "to", optional: true, placeholder: "(blank = the end)" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
    hint: "Works on an array or a string.",
  },
  ARRAY_AT: {
    fields: [
      { key: "name", kind: "var", label: "item of $" },
      { key: "index", kind: "expr", label: "at", placeholder: "0   or   -1 for the last" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$item" },
    ],
  },
  INDEX_OF_VAR: {
    fields: [
      { key: "name", kind: "var", label: "find in $" },
      { key: "find", kind: "expr", label: "value", placeholder: "$needle" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$index" },
    ],
    hint: "Writes the position, or -1 when it is not there.",
  },
  REPLACE_IN_VAR: {
    fields: [
      { key: "name", kind: "var", label: "in $" },
      { key: "at", kind: "expr", label: "replace index", placeholder: "0" },
      { key: "value", kind: "expr", label: "with", placeholder: "$newRow" },
    ],
  },
  REMOVE_FROM_VAR: {
    fields: [
      { key: "name", kind: "var", label: "from $" },
      { key: "at", kind: "expr", label: "remove index", optional: true, placeholder: "0" },
      { key: "value", kind: "expr", label: "or remove value", optional: true, placeholder: "$row" },
    ],
    hint: "Give an index OR a value. An index wins when both are set.",
  },
  MAP_VAR: {
    fields: [
      { key: "name", kind: "var", label: "map $" },
      { key: "as", kind: "var", label: "each as $", optional: true, defaultsTo: "$item" },
      { key: "expr", kind: "expr", label: "to", placeholder: "$item.label" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
    hint: "`$index` is bound alongside each element.",
  },
  FILTER_VAR: {
    fields: [
      { key: "name", kind: "var", label: "filter $" },
      { key: "as", kind: "var", label: "each as $", optional: true, defaultsTo: "$item" },
      { key: "comparator", kind: "select", label: "keep when", optional: true, defaultsTo: "IS",
        options: ["IS", "IS_NOT", "GREATER_THAN", "LESS_THAN", "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY"] },
      { key: "right", kind: "expr", label: "value", optional: true, placeholder: "true" },
    ],
    hint: "The element itself is the left side of the comparison.",
  },
  GROUP_BY: {
    fields: [
      { key: "name", kind: "var", label: "group $" },
      { key: "by", kind: "path", label: "by", placeholder: "muscleGroup" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$groups" },
    ],
    hint: "Writes an object of key → array of rows.",
  },

  // ── Strings ──────────────────────────────────────────────────────────────
  SPLIT_STRING: {
    fields: [
      { key: "name", kind: "var", label: "split $" },
      { key: "by", kind: "expr", label: "on", optional: true, defaultsTo: "a space" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  JOIN_ARRAY: {
    fields: [
      { key: "name", kind: "var", label: "join $" },
      { key: "by", kind: "expr", label: "with", optional: true, defaultsTo: "nothing" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  TO_LOWER: {
    fields: [
      { key: "name", kind: "var", label: "lowercase $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  TO_UPPER: {
    fields: [
      { key: "name", kind: "var", label: "uppercase $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  TRIM_STRING: {
    fields: [
      { key: "name", kind: "var", label: "trim $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  REPLACE_STRING: {
    fields: [
      { key: "name", kind: "var", label: "in $" },
      { key: "find", kind: "expr", label: "replace", placeholder: "old" },
      { key: "replace", kind: "expr", label: "with", placeholder: "new" },
      { key: "all", kind: "bool", label: "every occurrence" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "(in place)" },
    ],
  },
  CONTAINS_STRING: {
    fields: [
      { key: "name", kind: "var", label: "does $" },
      { key: "find", kind: "expr", label: "contain", placeholder: "needle" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$contains" },
    ],
  },
  CONCAT_STRINGS: {
    fields: [
      { key: "values", kind: "list", label: "join", placeholder: "$a" },
      { key: "separator", kind: "expr", label: "with", optional: true, defaultsTo: "nothing" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$concat" },
    ],
  },
  TYPE_OF: {
    fields: [
      { key: "name", kind: "var", label: "type of $" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$type" },
    ],
  },

  // ── Dates ────────────────────────────────────────────────────────────────
  DATE_ADD: {
    fields: [
      { key: "base", kind: "expr", label: "from", optional: true, defaultsTo: "$today" },
      { key: "amount", kind: "expr", label: "add", placeholder: "1   (negative goes back)" },
      { key: "unit", kind: "select", label: "unit", optional: true, defaultsTo: "day",
        options: ["day", "week", "month", "year"] },
      { key: "advanceUntil", kind: "expr", label: "advance past", optional: true,
        placeholder: "$day   (repeats the step until it passes this)" },
      { key: "resultVar", kind: "var", label: "→ $", optional: true, defaultsTo: "$date" },
    ],
    hint: "Also writes a field when `targetFieldId` is set on the step — that half has no control here yet.",
  },
  DATE_FORMAT: {
    fields: [
      { key: "date", kind: "expr", label: "format", placeholder: "$today" },
      { key: "format", kind: "expr", label: "as", optional: true, defaultsTo: "EEE MMM d" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$formatted" },
    ],
  },

  // ── Occurrences ──────────────────────────────────────────────────────────
  ADD_CHILD: {
    fields: [
      { key: "parentId", kind: "expr", label: "list under", placeholder: "$page.id" },
      { key: "childId", kind: "expr", label: "the item", placeholder: "$row.id" },
    ],
    hint: "LISTS a child without moving it — the child keeps its own parent, so one row can appear in several places. Use \"Link to parent\" to actually move it.",
  },
  LINK_OCCURRENCE_TO_PARENT: {
    fields: [
      { key: "parentId", kind: "expr", label: "move under", placeholder: "$page.id" },
      { key: "childId", kind: "expr", label: "the item", placeholder: "$row.id" },
    ],
    hint: "MOVES the item: unlists it from its old parent, re-parents it, and lists it under the new one.",
  },
  COPY_LINK: {
    fields: [
      { key: "sourceId", kind: "expr", label: "copy", placeholder: "$row.id" },
      { key: "parent", kind: "expr", label: "into", optional: true, placeholder: "$dest.id" },
      { key: "label", kind: "expr", label: "label", optional: true, defaultsTo: "the source's" },
      // ON unless explicitly false (`cfg.recursive !== false`) — the checkbox
      // must say so, or an unset step reads "off" while copying the children.
      { key: "recursive", kind: "bool", label: "include children", defaultValue: true },
      { key: "itemIdVar", kind: "var", label: "new id → $", optional: true },
    ],
    hint: "The copy SHARES its fields with the source: ticking one ticks all of them.",
  },

  // ── Outbound ─────────────────────────────────────────────────────────────
  CALL_API: {
    fields: [
      { key: "url", kind: "expr", label: "url", placeholder: "https://…" },
      { key: "method", kind: "select", label: "method", optional: true, defaultsTo: "GET",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { key: "body", kind: "expr", label: "body", optional: true, placeholder: "json:{\"a\":1}" },
      { key: "responseVar", kind: "var", label: "response → $", optional: true, defaultsTo: "$response" },
      { key: "onError", kind: "select", label: "on error", optional: true, defaultsTo: "fail",
        options: ["fail", "continue"] },
      { key: "errorVar", kind: "var", label: "error → $", optional: true, defaultsTo: "$apiError" },
    ],
    hint: "Headers and query are not editable here yet.",
  },
  GET_USER_INPUT: {
    fields: [
      { key: "question", kind: "expr", label: "ask", placeholder: "What should it be called?" },
      { key: "inputType", kind: "select", label: "as", optional: true, defaultsTo: "text",
        options: ["text", "number", "date", "select"] },
      { key: "defaultValue", kind: "expr", label: "default", optional: true },
      { key: "resultVar", kind: "var", label: "→ $", optional: true, defaultsTo: "$userInput" },
    ],
    hint: "Pauses the operation until the person answers. Cancelling stops the rest of it.",
  },

  // ── 2026-09-27: the fifteen the ACTION PICKER had never offered ───────────
  // They are all implemented by `executeActionItem` and 7 of them run in live
  // pipelines (`SET_FILTER` is what `Grid: Snap Filter To Today` uses to move
  // the date). Adding them to `ui/actionTree.js` made them SELECTABLE; without
  // an entry here `ActionConfig`'s default branch returns null, so the step
  // rendered with nothing to configure — a leaf you can pick and cannot set.
  // `__tests__/actionEditorCoverage.test.js` is what caught that, and it is the
  // reason these exist. Every key below was read off the executor's own case.
  SET_FILTER: {
    fields: [
      { key: "fieldId", kind: "text", label: "filter field", placeholder: "the filter's field id" },
      { key: "value", kind: "expr", label: "=", placeholder: "$today" },
    ],
    hint: "Writes a value into the grid's active filter — what snaps the date to today. Writes BOTH the nav widget and the filter cascade, so the display and the filtering cannot disagree.",
  },
  SCROLL_TO: {
    fields: [
      { key: "itemId", kind: "expr", label: "row", placeholder: "$item.id" },
      { key: "block", kind: "select", label: "align", optional: true, defaultsTo: "center",
        options: ["start", "center", "end", "nearest"] },
    ],
    hint: "Scrolls an occurrence into view and flashes it. Does nothing when the row is not rendered.",
  },
  REMOVE_CHILD: {
    fields: [
      { key: "parentId", kind: "expr", label: "from parent", placeholder: "$col.id" },
      { key: "childId", kind: "expr", label: "remove child", placeholder: "$item.id" },
    ],
    hint: "UNLISTS a child — the occurrence itself survives. The exact inverse of Add child; use Delete to destroy a row.",
  },
  PREPEND_OCCURRENCE: {
    fields: [
      { key: "instanceId", kind: "expr", label: "row", placeholder: "$item.id" },
      { key: "containerId", kind: "expr", label: "into", placeholder: "$col.id" },
    ],
    hint: "Lists a row as its parent's FIRST child, rather than appending it.",
  },
  SET_TEXTMAP: {
    fields: [
      { key: "occurrenceId", kind: "expr", label: "on", placeholder: "$doc.id" },
      { key: "content", kind: "expr", label: "content", placeholder: "$computedTextmap" },
      { key: "mode", kind: "select", label: "mode", optional: true, defaultsTo: "replace",
        options: ["replace", "append", "prepend", "insert"] },
      { key: "nodeType", kind: "text", label: "node", optional: true, placeholder: "paragraph" },
      { key: "position", kind: "number", label: "at", optional: true },
    ],
    hint: "Replaces a doc's whole textmap. `append` / `prepend` / `insert` add one node instead — `insert` uses `at`.",
  },
  HIDE_OCCURRENCE: {
    fields: [
      { key: "occurrenceIdExpr", kind: "expr", label: "hide", placeholder: "$item.id" },
    ],
    hint: "Hides one PLACEMENT (display: none). The row is not deleted and its other placements are untouched.",
  },
  SHOW_OCCURRENCE: {
    fields: [
      { key: "occurrenceIdExpr", kind: "expr", label: "show", placeholder: "$item.id" },
    ],
    hint: "Reveals a placement a Hide occurrence step hid.",
  },
  PICK_RANDOM_FROM_POOL: {
    fields: [
      { key: "poolId", kind: "expr", label: "from pool", placeholder: "the pool container's MODULE id" },
      { key: "varName", kind: "var", label: "→ $", optional: true, defaultsTo: "$pickedLabel" },
      { key: "fieldId", kind: "text", label: "read field", optional: true, placeholder: "blank = the label" },
    ],
    hint: "Draws one occurrence at random out of a pool container. `poolId` is the container's MODULE id, not an occurrence id.",
  },
  DATE_DIFF: {
    fields: [
      { key: "dateFieldId", kind: "text", label: "date field", placeholder: "the field holding the date" },
      { key: "targetFieldId", kind: "text", label: "write to field", placeholder: "the display field" },
      { key: "perOccurrence", kind: "bool", label: "per row", optional: true, defaultsTo: "on", defaultValue: true },
    ],
    hint: "Days from today to a date field — negative in the past. Per row by default; off writes ONE value, the nearest upcoming date.",
  },
  COUNT_DATE_OVERDUE: {
    fields: [
      { key: "dateFieldId", kind: "text", label: "date field", placeholder: "the field holding the date" },
      { key: "targetFieldId", kind: "text", label: "write to field", placeholder: "the display field" },
    ],
    hint: "Counts rows whose date field is before today.",
  },
  COUNT_DATE_UPCOMING: {
    fields: [
      { key: "dateFieldId", kind: "text", label: "date field", placeholder: "the field holding the date" },
      { key: "targetFieldId", kind: "text", label: "write to field", placeholder: "the display field" },
      { key: "withinDays", kind: "number", label: "within days", optional: true, defaultsTo: "7" },
    ],
    hint: "Counts rows whose date field falls inside the next N days.",
  },
  IS_DUE_ON: {
    fields: [
      { key: "due", kind: "expr", label: "due", placeholder: "$item.fields.<Due>.value" },
      { key: "day", kind: "expr", label: "on day", placeholder: "$today" },
      { key: "completedOn", kind: "expr", label: "completed on", optional: true },
      { key: "from", kind: "expr", label: "recurring from", optional: true },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$isDue" },
    ],
    hint: "Does a recurring item fall on a given day? `completed on` and `recurring from` are what let a repeat skip a day it was already done.",
  },
  SLOTS_COVERED: {
    fields: [
      { key: "start", kind: "expr", label: "start slot", placeholder: "$item.fields.<Time Slot>.value" },
      { key: "duration", kind: "expr", label: "duration", placeholder: "$item.fields.<Duration>.value" },
      { key: "slotLabels", kind: "expr", label: "all slots", placeholder: "$slotLabels" },
      { key: "to", kind: "var", label: "→ $", optional: true, defaultsTo: "$slotsCovered" },
    ],
    hint: "Every slot a start slot plus a duration spans — what places one shift across several time slots. `all slots` is the ordered label list to walk.",
  },
  IMPORT_HTML: {
    fields: [
      { key: "html", kind: "expr", label: "html", placeholder: "$response.body" },
      { key: "parentExpr", kind: "expr", label: "into", optional: true, placeholder: "blank = grid level" },
      { key: "title", kind: "expr", label: "title", optional: true, defaultsTo: "Imported" },
      { key: "resultVar", kind: "var", label: "→ $", optional: true, defaultsTo: "$importResult" },
      { key: "onError", kind: "select", label: "on error", optional: true, defaultsTo: "fail",
        options: ["fail", "continue"] },
    ],
    hint: "Converts HTML into containers / textblocks / artifacts and places the result. Suspends until the import lands.",
  },
  IMPORT_MARKDOWN: {
    fields: [
      { key: "markdown", kind: "expr", label: "markdown", placeholder: "$llmResponse.text" },
      { key: "parentExpr", kind: "expr", label: "into", optional: true, placeholder: "blank = grid level" },
      { key: "title", kind: "expr", label: "title", optional: true, defaultsTo: "Imported" },
      { key: "resultVar", kind: "var", label: "→ $", optional: true, defaultsTo: "$importResult" },
      { key: "onError", kind: "select", label: "on error", optional: true, defaultsTo: "fail",
        options: ["fail", "continue"] },
    ],
    hint: "Converts markdown into containers / textblocks / artifacts and places the result. Suspends until the import lands.",
  },
};

/** Does this action have a declared config shape? */
export function hasActionSchema(actionType) {
  return Object.prototype.hasOwnProperty.call(ACTION_CONFIG_SCHEMA, actionType);
}
