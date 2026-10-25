// helpers/buttonBindings.js — the button fields an occurrence's module binds, for surfaces that show buttons but not
// the rest of the fields (a textblock inside a doc: its text is its body, so it shows its buttons as a strip under
// the text, not every field).

/** Visible bindings whose field is a `button`, in binding order. */
export function buttonBindings(module, fieldsById = {}) {
  const bindings = Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];
  return bindings
    .filter((b) => b && !b.hidden && fieldsById?.[b.fieldId]?.type === "button" && !fieldsById[b.fieldId].trashed)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
