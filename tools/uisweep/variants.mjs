// tools/uisweep/variants.mjs — the field variants the sweep covers (fixtures + matrix share this list).
// Existing rebuild fields, by name, that cover a variant (measured 2026-11-03).
export const REUSE = [
  ["text", "Notes"], ["text/link", "Website"], ["text/multiline", "Person Notes"],
  ["number", "Quantity"], ["number/flow", "Calories"], ["number/max", "Day"],
  ["boolean/switch", "Completed"], ["boolean/plain", "Owned"],
  ["select/manual", "Gender"], ["select/49-options", "Time Slot"], ["select/find-random", "Daily Question"],
  ["select/multi", "Board Category"], ["select/multi-allowNew", "Tags"],
  ["occurrence/find", "Author"], ["occurrence/addNew", "Meal"], ["occurrence/addNew-search", "Location"],
  ["occurrence/multi-addNew", "People"], ["occurrence/multi-search", "Movement"],
  ["date", "Date"], ["duration/flow", "Duration"], ["duration", "Sleep Time"],
  ["rating/5", "Rating"], ["address", "Address"], ["when", "Schedule"],
];
// Variants the rebuild has no field for: created here.
export const CREATE = [
  ["boolean/checkbox", { name: "Sweep Check", type: "boolean", meta: { variant: "checkbox" } }],
  ["select/single-allowNew", { name: "Sweep Choice", type: "select", meta: { allowNewOptions: true, optionsSource: { mode: "manual", values: ["Alpha", "Beta", "Gamma"] } } }],
  ["rating/10", { name: "Sweep Rating 10", type: "rating", meta: { max: 10 } }],
  ["markdown", { name: "Sweep Markdown", type: "markdown", meta: {} }],
  ["button", { name: "Sweep Button", type: "button", meta: { buttonLabel: "Press" } }],
];

