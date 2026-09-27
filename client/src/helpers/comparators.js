// helpers/comparators.js
// THE comparator catalog. `evalRule` (operationActions.js) is the canonical
// EVALUATOR; this file is the canonical LIST of what it can evaluate, so every
// editor that offers a comparator offers the same set of names.
//
// WHY THIS IS ONE LIST NOW. There were three, each hand-maintained and each
// incomplete: this file's 12 (grid named filters, table-column filters, feed
// conditions), `ConditionGroup.jsx`'s 20 (pipeline IF rules and find
// predicates), and `evalRule`'s 34. Measured across every grid on 2026-09-27:
//
//     248 operations · 3,475 condition rules
//     138 operations (56%) use at least one comparator NO editor could offer
//     DATE_IN_PERIOD 390 rules · ARRAY_NOT_INCLUDES 107 · DATE_AFTER 35 ·
//     DATE_ON_OR_BEFORE_PERIOD 14 · ARRAY_INCLUDES 12 · TIME_BEFORE 6 ·
//     TIME_AFTER 5 · NOT_HAS_ANCESTOR 4 · DATE_BEFORE 3
//
// Every one of those rules was written by a seed or a migration, because the
// editor's <select> did not carry the option — so a tracker like poms' Coffee
// count could be READ in the UI and never AUTHORED there. That is the same
// "implemented, documented, unit-tested and unreachable" shape as the grid-root
// field visibility (2026-09-22) and the button field's operationId (09-21).
//
// `comparatorCatalog.test.js` WALKS `evalRule`'s own source and fails when the
// evaluator learns a comparator this list does not carry, so the drift cannot
// come back. Its control is that every value here also evaluates.
//
// Entry shape:
//   value  — the stored enum, exactly as evalRule cases on it
//   label  — human text for the surfaces that show labels
//   group  — <optgroup> heading in the pipeline editor
//   unary  — true when the comparator takes NO right-hand operand
//   alias  — true when it is a second spelling of another entry (hidden from
//            pickers; still accepted, so a hand-typed predicate keeps working)
//   simple — true when it belongs in the SMALL subset the filter editors show

export const COMPARATOR_CATALOG = [
  // ── Value ───────────────────────────────────────────────────────────────
  { value: "IS",            label: "is",                                group: "Value",  simple: true },
  { value: "IS_NOT",        label: "is not",                            group: "Value",  simple: true },
  { value: "CONTAINS",      label: "contains",                          group: "Value",  simple: true },
  { value: "NOT_CONTAINS",  label: "does not contain",                  group: "Value" },
  { value: "SAME_TEXT",     label: "same text (ignores case, accents)",  group: "Value",  simple: true },
  { value: "IS_EMPTY",      label: "is empty",                          group: "Value",  simple: true, unary: true },
  { value: "IS_NOT_EMPTY",  label: "not empty",                         group: "Value",  simple: true, unary: true },

  // ── Numbers ─────────────────────────────────────────────────────────────
  { value: "GREATER",                   label: ">",  group: "Numbers", simple: true },
  { value: "LESS",                      label: "<",  group: "Numbers", simple: true },
  { value: "GREATER_OR_EQUAL",          label: ">=", group: "Numbers" },
  { value: "LESS_OR_EQUAL",             label: "<=", group: "Numbers" },
  { value: "GREATER_THAN",              label: ">",  group: "Numbers", alias: true },
  { value: "LESS_THAN",                 label: "<",  group: "Numbers", alias: true },
  { value: "GREATER_THAN_OR_EQUAL",     label: ">=", group: "Numbers", alias: true },
  { value: "LESS_THAN_OR_EQUAL",        label: "<=", group: "Numbers", alias: true },

  // ── Dates ───────────────────────────────────────────────────────────────
  { value: "SAME_DAY",                 label: "same day",                 group: "Dates", simple: true },
  { value: "SAME_WEEK",                label: "same week",                group: "Dates", simple: true },
  { value: "SAME_MONTH",               label: "same month",               group: "Dates", simple: true },
  { value: "SAME_YEAR",                label: "same year",                group: "Dates", simple: true },
  { value: "DATE_EQUALS",              label: "date equals",              group: "Dates" },
  { value: "DATE_BEFORE",              label: "before date",              group: "Dates" },
  { value: "DATE_AFTER",               label: "after date",               group: "Dates" },
  { value: "DATE_IS_TODAY",            label: "is today",                 group: "Dates", unary: true },
  { value: "DATE_BEFORE_TODAY",        label: "before today",             group: "Dates", unary: true },
  { value: "DATE_AFTER_TODAY",         label: "after today",              group: "Dates", unary: true },
  { value: "DATE_WITHIN_DAYS",         label: "within N days",            group: "Dates" },
  { value: "DATE_IN_PERIOD",           label: "in the period",            group: "Dates" },
  { value: "DATE_ON_OR_BEFORE_PERIOD", label: "on or before the period",  group: "Dates" },

  // ── Time of day ─────────────────────────────────────────────────────────
  { value: "TIME_BEFORE", label: "time before", group: "Time of day" },
  { value: "TIME_AFTER",  label: "time after",  group: "Time of day" },

  // ── Lists ───────────────────────────────────────────────────────────────
  { value: "ARRAY_INCLUDES",     label: "list includes",         group: "Lists" },
  { value: "ARRAY_NOT_INCLUDES", label: "list does not include", group: "Lists" },

  // ── Structure ───────────────────────────────────────────────────────────
  { value: "HAS_ANCESTOR",     label: "has ancestor",            group: "Structure" },
  { value: "NOT_HAS_ANCESTOR", label: "does not have ancestor",  group: "Structure" },
];

/** The SMALL subset the grid named-filter editor, the table-column filter
 *  popover and the feed-condition editor show. A filter is a simple thing and
 *  deliberately does not offer the whole pipeline language.
 *
 *  The ORDER is spelled out rather than taken from the catalog: these three
 *  dropdowns are mostly used on DATE filters, so the day/week/month/year block
 *  has led the list since the list existed. A test pins this sequence, because
 *  deriving it from the catalog would silently re-sort three live dropdowns the
 *  first time an entry moved. */
const SIMPLE_ORDER = [
  "SAME_DAY", "SAME_WEEK", "SAME_MONTH", "SAME_YEAR",
  "IS", "IS_NOT", "CONTAINS", "SAME_TEXT", "GREATER", "LESS",
  "IS_EMPTY", "IS_NOT_EMPTY",
];
export const COMPARATOR_OPTIONS = SIMPLE_ORDER.map((v) => {
  const c = COMPARATOR_CATALOG.find((e) => e.value === v);
  return { value: c.value, label: c.label };
});

/** Comparators that take no right-hand value. Read by the feed-predicate
 *  validator (a comparator needing a value and having none is not a condition
 *  yet) and by every editor that hides its value box. */
export const UNARY_COMPARATORS = new Set(
  COMPARATOR_CATALOG.filter((c) => c.unary).map((c) => c.value)
);

/** Everything the pipeline condition editor offers, grouped, aliases hidden.
 *  An alias is a second spelling — offering both would present the same
 *  comparator twice and make the choice look meaningful. */
export const PIPELINE_COMPARATOR_GROUPS = (() => {
  const out = [];
  for (const c of COMPARATOR_CATALOG) {
    if (c.alias) continue;
    let g = out.find((o) => o.group === c.group);
    if (!g) { g = { group: c.group, items: [] }; out.push(g); }
    g.items.push(c);
  }
  return out;
})();

/** Every comparator value, aliases included — what a stored rule may hold. */
export const COMPARATOR_VALUES = new Set(COMPARATOR_CATALOG.map((c) => c.value));
