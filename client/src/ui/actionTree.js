// actionTree.js
//
// Categorized, multi-level tree of all operation pipeline actions. Drives
// the ActionPicker UI (a DrilldownPicker-styled tree picker). Each leaf
// commits an action `value` string that matches the executor's action type
// names (operationActions.js).
//
// Spec: docket task #31 — "drilldown action picker (>2 levels). Merge
// 'value manipulation' as a category. We should be using the category
// picker except drilling down into diff actions."
//
// Tree shape (recursive):
//   {
//     value: "<action-type>" | "<group-id>",
//     title: string,
//     sub?: string,         — small grey detail (e.g. "$x += expr")
//     description?: string,
//     icon?: LucideIcon,    — optional category icon
//     color?: string,       — optional accent color
//     children?: ActionTreeNode[]  — group node (leaves have no children)
//   }
//
// A node with `children` is a category — clicking drills in.
// A node without `children` is a leaf — clicking commits its `value`.

import {
  Variable,
  Database,
  Layers,
  GitBranch,
  Eye,
  Wrench,
} from "lucide-react";

export const ACTION_TREE = [
  // ── Variables ─────────────────────────────────────────────────────────
  {
    value: "variables",
    title: "Variables",
    description: "Set, add, multiply, push to local $vars",
    icon: Variable,
    color: "rgba(168,85,247,0.75)", // purple
    children: [
      {
        value: "assign",
        title: "Assign",
        description: "Set a local variable's value",
        children: [
          { value: "INIT_VAR", title: "=  assign", sub: "$x = value or expr", description: "Initialize / set a local variable" },
          { value: "SET_VAR",  title: "=  set",    sub: "$x = any expression", description: "Re-assign a variable, alias of INIT_VAR" },
        ],
      },
      {
        value: "arithmetic",
        title: "Arithmetic",
        description: "Add / subtract / multiply / divide",
        children: [
          { value: "ADD_TO_VAR",        title: "+= add",        sub: "$x += expr",       description: "Add an expression to a numeric var" },
          { value: "SUBTRACT_FROM_VAR", title: "-= subtract",   sub: "$x -= expr",       description: "Subtract from a numeric var" },
          { value: "MULTIPLY_VAR",      title: "*= multiply",   sub: "$x *= expr",       description: "Multiply a numeric var" },
          { value: "DIV_VAR",           title: "/= divide",     sub: "$x /= expr",       description: "Divide a numeric var (rounded to 2 decimals)" },
          { value: "INCREMENT_VAR",     title: "++ increment",  sub: "$x += N (default 1)", description: "Bump a counter" },
          { value: "DECREMENT_VAR",     title: "-- decrement",  sub: "$x -= N (default 1)", description: "Decrement a counter" },
        ],
      },
      {
        value: "aggregators",
        title: "Aggregators",
        description: "Numeric / temporal aggregations over arrays",
        children: [
          { value: "SUM_VAR",    title: "Σ sum",      sub: "sum of an array",            description: "Sum a numeric array. Optional `by` path for object arrays (e.g. by:'amount')." },
          { value: "MIN_VAR",    title: "↓ min",      sub: "smallest value",             description: "Smallest numeric value in an array." },
          { value: "MAX_VAR",    title: "↑ max",      sub: "largest value",              description: "Largest numeric value in an array." },
          { value: "AVG_VAR",    title: "x̄ average",   sub: "arithmetic mean",           description: "Mean of a numeric array (rounded to 2 decimals)." },
          { value: "STREAK_VAR", title: "🔥 streak",   sub: "consecutive days backward", description: "Count consecutive days backward from today where at least one row's date matches. `by` defaults to 'date'." },
        ],
      },
      {
        value: "collections",
        title: "Collections",
        description: "Push, sort, manipulate arrays in $vars",
        children: [
          { value: "PUSH_TO_VAR",     title: "[] push",          sub: "push scalar onto array",     description: "Append a single value to an array var" },
          { value: "PUSH_TO_ARRAY",   title: "[] push object",   sub: "push {...} onto array",      description: "Append an object literal (each leaf is resolved via $vars)" },
          { value: "MERGE_ARRAY",     title: "[] merge",         sub: "concat or unique-merge",     description: "Concatenate another array (with optional dedup)" },
          { value: "SORT_VAR",        title: "[] sort",          sub: "asc/desc, optional key",     description: "Sort an array var in place (objects → sort by key)" },
          { value: "REPLACE_IN_VAR",  title: "[] replace at",    sub: "arr[i] = value",             description: "Replace an array element at a given index" },
          { value: "REMOVE_FROM_VAR", title: "[] remove",        sub: "by index or first value",    description: "Remove an array element (by index OR first value match)" },
          { value: "ARRAY_LENGTH",    title: "[] length",        sub: "write length → $length",     description: "Write array/string length to another var" },
          { value: "SLICE_VAR",       title: "[] slice",         sub: "arr.slice(start, end)",      description: "Take a sub-range. Negative indices count from the end (e.g. last 5 → start:-5)." },
          { value: "UNIQUE_VAR",      title: "[] unique",        sub: "Set-style dedup",            description: "Remove duplicates. Optional `by` path for object arrays (e.g. by:'id')." },
          { value: "REVERSE_VAR",     title: "[] reverse",       sub: "in place",                   description: "Reverse an array (or string)." },
          { value: "ARRAY_AT",        title: "[] at index",      sub: "arr[i] (negative-friendly)", description: "Read an array (or string) element by index. Negative indices count from the end." },
          { value: "INDEX_OF_VAR",    title: "[] find index",    sub: "arr.indexOf(value)",         description: "Find the index of a value in an array or substring in a string. -1 when missing." },
          { value: "MAP_VAR",         title: "[] map",           sub: "transform each element",     description: "Apply an expression to each array element. Use $item (or custom `as`) + $index inside the expression." },
          { value: "FILTER_VAR",      title: "[] filter",        sub: "comparator predicate",       description: "Keep elements matching a comparator. Simpler than wrapping a LOOP+IF for the common $item IS value case." },
          { value: "GROUP_BY",        title: "[] group by",      sub: "{key: [items...]} object",   description: "Group an array of objects into a key→items map by a dotted path (e.g. 'type', 'fields.X.value', 'meta.flag')." },
        ],
      },
      {
        value: "strings",
        title: "Strings",
        description: "Split, join, case, trim, replace, contains",
        children: [
          { value: "SPLIT_STRING",    title: "split string",  sub: "string → array",       description: "Split a string into an array by separator (default space)" },
          { value: "JOIN_ARRAY",      title: "join array",    sub: "array → string",       description: "Join an array into a string with a separator" },
          { value: "TO_LOWER",        title: "to lower",      sub: "case conversion",      description: "Lowercase a string." },
          { value: "TO_UPPER",        title: "to upper",      sub: "case conversion",      description: "Uppercase a string." },
          { value: "TRIM_STRING",     title: "trim",          sub: "strip whitespace",     description: "Remove leading and trailing whitespace." },
          { value: "REPLACE_STRING",  title: "replace",       sub: "find/replace literal", description: "Replace a substring. `all:true` replaces every match; default replaces first only. Literal — no regex." },
          { value: "CONTAINS_STRING", title: "contains?",     sub: "substring test → bool",description: "Write true/false based on substring presence." },
          { value: "CONCAT_STRINGS",  title: "concat",        sub: "multi-arg join",       description: "Concatenate N values into one string with an optional separator." },
        ],
      },
      {
        value: "type",
        title: "Type / introspection",
        description: "JavaScript type checks",
        children: [
          { value: "TYPE_OF", title: "typeof", sub: "→ array|string|number|...", description: "Write the JS type of a var to another var" },
        ],
      },
      {
        value: "dates",
        title: "Dates",
        description: "Date arithmetic + formatting",
        children: [
          { value: "DATE_ADD",    title: "📅 add",    sub: "base + N units",         description: "Add N days/weeks/months/years to a base date. Optional setDay snap. Optional advanceUntil cycle. resultVar binds ISO output." },
          { value: "DATE_FORMAT", title: "📅 format", sub: "ISO → human label",       description: "Format ISO date via CLDR-like tokens. yyyy / yy / MMMM / MMM / MM / M / dd / d / EEEE / EEE. Default 'EEE MMM d' → 'Mon May 5'." },
        ],
      },
    ],
  },

  // ── Find / Filter ─────────────────────────────────────────────────────
  {
    value: "find",
    title: "Find",
    description: "Locate items by predicate; bind results to $vars",
    icon: Database,
    color: "rgba(59,130,246,0.75)", // blue
    children: [
      // FIND auto-detects: single match → bare item, multiple matches →
      // array. No switch needed per user direction "find should just be find
      // and that autodoes it if i finds multiple". `multiple: true` is still
      // accepted as an optional force-array hint for shape consistency.
      { value: "FIND", title: "Find", sub: "auto single|array", description: "Match items by rules. Auto-returns bare item when 1 match, array when many. Sets itemIdVar / itemVar." },
    ],
  },

  // ── Effects: Create / Update / Delete on occurrences ──────────────────
  {
    value: "occurrences",
    title: "Occurrences",
    description: "Create, update, delete grid occurrences",
    icon: Layers,
    color: "rgba(34,197,94,0.75)", // green
    children: [
      {
        value: "create",
        title: "Create",
        description: "Mint new items or occurrences",
        children: [
          // CREATE has a `multiple: true` switch that turns it into a bulk
          // creator (consumes `cfg.rows: [{name, fields}]`). Same single
          // umbrella action — no separate Create Multiple entry per user
          // direction "make sure the create and the createMultiple are one
          // ui action … just have a switch".
          { value: "CREATE",            title: "Create",            sub: "+ multiple switch",     description: "Mint a template-instance pair. Toggle `multiple` for bulk-create from {rows}." },
          { value: "CREATE_OCCURRENCE", title: "Create occurrence", sub: "for existing module",   description: "Add another occurrence of an existing module." },
          { value: "COPY_OCCURRENCE",   title: "Copy occurrence",   sub: "deep clone subtree",    description: "Clone an occurrence and its children." },
          { value: "COPY_LINK",         title: "Copy linked",       sub: "linked-group fan-out",  description: "Mint a copy sharing linkedGroupId — edits propagate." },
          { value: "ADD_CHILD",         title: "Add as child",      sub: "wire to parent.occurrences[]", description: "Append occurrence ID to a parent's children list." },
          { value: "LINK_OCCURRENCE_TO_PARENT", title: "Link to parent", sub: "set parentId",     description: "Reparent an existing occurrence." },
          { value: "APPLY_TEMPLATE",    title: "Apply template",    sub: "fill from saved template", description: "Stamp a template subtree into a target." },
          { value: "CREATE_OCCURRENCE_WITH_ITERATION", title: "Create page (by date)", sub: "find-or-create date-keyed", description: "Idempotent day-page creator." },
        ],
      },
      {
        value: "update",
        title: "Update",
        description: "Write values to occurrences / modules",
        children: [
          { value: "UPDATE",             title: "Update",            sub: "path = value", description: "Write a value at $item.<path>." },
          { value: "SET_FIELD_VALUE",    title: "Set field",         sub: "occurrence.fields[id]", description: "Write to an occurrence's field." },
          { value: "INCREMENT_FIELD",    title: "Increment field",   sub: "+= / -=",               description: "Add or subtract from a numeric field." },
          { value: "MARK_COMPLETE",      title: "Mark complete",     sub: "boolean field = true/false", description: "Tick a completion field." },
          { value: "UPDATE_MODULE",      title: "Update module",     sub: "patch module record",   description: "JSON patch the template." },
          { value: "UPDATE_STYLE",       title: "Set style",         sub: "ownStyle.bg / color / ...", description: "Set per-module style overrides." },
          { value: "UPDATE_VIEW",        title: "Update view",       sub: "viewId.activeOccurrenceId", description: "Switch active artifact / day-page." },
          { value: "APPEND_TO_DOC",      title: "Append to doc",     sub: "paragraph to textmap",  description: "Add a paragraph to an occurrence's TipTap doc." },
        ],
      },
      {
        value: "delete",
        title: "Delete",
        description: "Remove occurrences / modules",
        children: [
          // Each action carries a `multiple: true` switch that consumes
          // `ids[]` instead of a single id — per user direction every action
          // gets a switch under one umbrella. No separate _MULTIPLE entries.
          { value: "DELETE",             title: "Delete item",       sub: "+ multiple switch", description: "Remove an item by id. Toggle `multiple` for ids[] bulk-delete." },
          { value: "REMOVE_OCCURRENCE",  title: "Remove occurrence", sub: "+ multiple switch", description: "Delete an occurrence (template untouched). Toggle `multiple` for ids[]." },
          { value: "DELETE_MODULE",      title: "Delete module",     sub: "by id",             description: "Delete a module + all its occurrences." },
        ],
      },
      {
        value: "move",
        title: "Move / Reparent",
        description: "Relocate occurrences",
        children: [
          { value: "MOVE_OCCURRENCE",   title: "Move occurrence",   sub: "+ multiple switch",            description: "Move an occurrence to a new parent. Toggle `multiple` for ids[]." },
          { value: "NAVIGATE_DAY_PAGE", title: "Navigate day page", sub: "find-or-create + switch view", description: "Atomic day-page nav." },
        ],
      },
    ],
  },

  // ── Display ───────────────────────────────────────────────────────────
  {
    value: "display",
    title: "Display",
    description: "Show values on display fields, node cards, notifications",
    icon: Eye,
    color: "rgba(245,158,11,0.75)", // amber
    children: [
      { value: "SHOW_VALUE",            title: "Display → field",   sub: "send computed value", description: "Write computed value to a display field." },
      { value: "DISPLAY_LOCAL_FIELDS",  title: "Show on node",      sub: "rows: [{label,expr}]", description: "Render rows on the op node card." },
      { value: "NOTIFY",                title: "Notification",      sub: "toast message",       description: "Show a toast on the user's grid." },
    ],
  },

  // ── Control flow ──────────────────────────────────────────────────────
  {
    value: "control",
    title: "Control",
    description: "Invoke other operations and pool ops",
    icon: GitBranch,
    color: "rgba(236,72,153,0.75)", // pink
    children: [
      { value: "RUN_OPERATION",      title: "Run operation",     sub: "by id or name",  description: "Call another op; effects bubble up." },
      { value: "CYCLE_FIELD_VALUE",  title: "Cycle field options", sub: "by day-of-year", description: "Rotate a select field's value." },
      { value: "ADD_TO_POOL",        title: "Add to pool",       sub: "pool container", description: "Mint a pool occurrence." },
      { value: "REMOVE_FROM_POOL",   title: "Remove from pool",  sub: "by moduleId",    description: "Delete a pool occurrence." },
      { value: "RESET_RECURRING_TASK", title: "Reset recurring task", sub: "completion + dueDate", description: "Reset boolean + advance due-date by recurrenceDays." },
      { value: "CREATE_FOLDER",      title: "Create folder",     sub: "by name",        description: "Find/create folder; sets $lastCreatedFolderId." },
    ],
  },

  // ── Outbound ──────────────────────────────────────────────────────────
  {
    value: "outbound",
    title: "Outbound",
    description: "External calls and user input",
    icon: Wrench,
    color: "rgba(14,165,233,0.75)", // sky
    children: [
      { value: "CALL_API",       title: "Call API",       sub: "HTTP fetch",       description: "Outbound HTTP. Suspends until response." },
      { value: "GET_USER_INPUT", title: "Ask the user",   sub: "modal prompt",     description: "Suspend the pipeline for user input." },
    ],
  },
];

// Flatten the tree to a Map<value, node> for quick label lookups when
// rendering the picker's closed state (so it can show "Find ▸ Find" or
// "Variables ▸ Arithmetic ▸ += add" without re-walking the tree).
export function findActionPath(value, tree = ACTION_TREE, ancestors = []) {
  if (!value) return null;
  for (const node of tree) {
    if (node.value === value && !node.children) return [...ancestors, node];
    if (node.children) {
      const hit = findActionPath(value, node.children, [...ancestors, node]);
      if (hit) return hit;
    }
  }
  return null;
}

// Quick lookup: value → leaf node.
export function findActionLeaf(value, tree = ACTION_TREE) {
  if (!value) return null;
  for (const node of tree) {
    if (node.value === value && !node.children) return node;
    if (node.children) {
      const hit = findActionLeaf(value, node.children);
      if (hit) return hit;
    }
  }
  return null;
}
