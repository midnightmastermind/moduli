// helpers/siblingFieldBindings.js
//
// What a new occurrence should already be wearing when it lands somewhere.
//
// User, 2026-08-21: *"when im selecting a field as well to add to a new occurnce.
// could you already have like fields set (what other occurances have in the place
// im placing it)"* / *"so if i have add an ingrediant, it already has all those
// fields set"*.
//
// ── DERIVED FROM THE DESTINATION, so nothing learns what an ingredient is ──
//
// The rule is "whatever the rows already here bind". An Ingredients board full of
// 18-field rows prefills 18 fields; an empty container prefills nothing. No list
// of names, no per-board configuration, and it keeps working for a board that
// does not exist yet — which is exactly what `noDomainKnowledge` is protecting.
//
// ── EVERY FIELD THE SIBLINGS BIND (the user's own pick over two narrower rules) ──
//
// Not "only the fields they ALL share" — a container with one odd row would then
// prefill almost nothing — and not "copy the nearest sibling", where one unusual
// neighbour propagates its shape to everything added after it. The union is the
// rule that matches "it already has all those fields set".
//
// ── ORDER IS THE FIRST SIBLING'S, THEN WHATEVER IS NEW ─────────────────────────
//
// Binding order IS render order, so the union has to be ordered or the new row's
// controls appear in an order no existing row uses. First-seen wins: walk the
// siblings in list order and append each unseen field where it first appears.
//
// ── THE BINDING'S ROLE IS CARRIED, NOT FLATTENED TO "input" ───────────────────
//
// A binding is `{fieldId, role}` and the role decides how the control renders —
// `display` is written by an operation and has no input at all, `media`/`files`
// draw a thumbnail. Minting every prefilled binding as `input` would give the new
// row a typable box where its siblings show a computed value. First-seen wins
// here too, for the same reason.

/** Bindings a leaf occurrence's module declares, normalized. */
function bindingsOf(occ, modulesById) {
  const raw = modulesById?.[occ?.moduleId]?.fieldBindings;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && b.fieldId)
    .map((b) => ({ fieldId: b.fieldId, role: b.role || "input" }));
}

/**
 * The ordered field bindings a new child of `destination` should inherit.
 *
 * @param {object}  destination     the occurrence being added into
 * @param {object}  occurrencesById
 * @param {object}  modulesById
 * @param {object} [opts]
 * @param {number} [opts.maxSiblings=200]  scan cap — a feed-backed board can
 *        hold hundreds of copies and the answer converges long before that.
 * @returns {Array<{fieldId: string, role: string}>}
 */
export function siblingFieldBindings(destination, occurrencesById, modulesById, opts = {}) {
  const { maxSiblings = 200 } = opts;
  const childIds = destination?.occurrences;
  if (!Array.isArray(childIds) || !childIds.length) return [];

  const seen = new Map();
  let scanned = 0;
  for (const id of childIds) {
    if (scanned >= maxSiblings) break;
    const occ = occurrencesById?.[id];
    if (!occ) continue;
    const mod = modulesById?.[occ.moduleId];
    // LEAVES ONLY. A container or page nested in this destination binds fields
    // for its own header, which is not what a new ITEM should wear.
    if (!mod || (mod.role && mod.role !== "instance")) continue;
    scanned++;
    for (const b of bindingsOf(occ, modulesById)) {
      if (!seen.has(b.fieldId)) seen.set(b.fieldId, b);
    }
  }
  return [...seen.values()];
}

/** Just the ids, for the picker's selection state. */
export function siblingFieldIds(destination, occurrencesById, modulesById, opts) {
  return siblingFieldBindings(destination, occurrencesById, modulesById, opts).map((b) => b.fieldId);
}

/**
 * Split a field list into the two sections the picker shows.
 *
 * User: *"i need the display and then input fields seperated by section"*.
 * `Field.displayEnabled` is the grid's own distinction — a display field's value
 * is written by an operation and cannot be typed — so the split is read off the
 * field rather than invented here. Display comes FIRST, in the user's order.
 */
export function splitDisplayInput(fields) {
  const display = [], input = [];
  for (const f of fields || []) (f?.displayEnabled === true ? display : input).push(f);
  return { display, input };
}

/**
 * The bindings a freshly minted module should carry, from whatever the picker
 * sent. ONE implementation because there are four mint sites — App's "+ Item",
 * `createLeafInstanceInParent`, `createLeafInstanceAtIndex` and the doc gap —
 * and three of them had already drifted into their own copy of the same three
 * lines. `fieldBindings` WINS over `fieldIds` when both arrive: only the former
 * carries each binding's role.
 *
 * @param {object}  src
 * @param {Array}  [src.fieldBindings]
 * @param {Array}  [src.fieldIds]
 * @param {boolean} [src.hidden]  include `hidden: false` (App's shape)
 */
export function normalizeFieldBindings({ fieldBindings, fieldIds, hidden = false } = {}) {
  const stamp = (fieldId, role) =>
    hidden ? { fieldId, role, hidden: false } : { fieldId, role };
  if (Array.isArray(fieldBindings) && fieldBindings.length) {
    return fieldBindings.filter((b) => b && b.fieldId).map((b) => stamp(b.fieldId, b.role || "input"));
  }
  if (Array.isArray(fieldIds) && fieldIds.length) return fieldIds.map((fid) => stamp(fid, "input"));
  return [];
}

/**
 * Which of the picked fields the add menu offers a control for.
 *
 * User, 2026-08-21: *"1 to quickly set values for fields in the add item menu"*,
 * then correcting a first attempt that only handled the typeable primitives:
 * ***"it shouldnt be just typable. any input field should be valued inside that
 * editor"*** / *"so the oppropriate inputs need to be there"*.
 *
 * They were right, and the first version was a second implementation of every
 * input type — a hand-rolled number/text/select box beside the real ones. The
 * step renders `Field` itself now, which is the app's ONE renderer for every
 * type, so an occurrence dropdown, a rating, a duration and a boolean all behave
 * exactly as they do on a row.
 *
 * So the filter is only about what has no INPUT to render at all:
 *
 * - a `display` field's value is written by an OPERATION and would be overwritten
 *   on the next load — a control that appears to work and does not is worse than
 *   no control. (Both the FIELD's `displayEnabled` and the BINDING's role are
 *   checked; either alone leaves the other case through.)
 * - `inputEnabled === false` is the field saying so itself.
 * - `media` / `files` need an upload or a drop target, which a menu has nowhere
 *   to put. Those stay BOUND and are filled in on the row.
 */
const NO_INPUT_TYPES = new Set(["media", "files"]);

export function typeableFields(fieldIds, fieldsById, rolesByFieldId = {}) {
  return (fieldIds || [])
    .map((id) => fieldsById?.[id])
    .filter((f) => f && !f.trashed
      && f.displayEnabled !== true
      && f.inputEnabled !== false
      && !NO_INPUT_TYPES.has(f.type)
      && (rolesByFieldId[f.id] || "input") === "input");
}

/** The `{fieldId: {value, flow}}` map a mint site wants, dropping anything unset. */
export function toInitialFields(values) {
  const out = {};
  for (const [fieldId, v] of Object.entries(values || {})) {
    if (v === "" || v === undefined || v === null) continue;
    out[fieldId] = { value: v, flow: "in" };
  }
  return out;
}

/**
 * Order a field list with the SELECTED ones first.
 *
 * User, 2026-08-21: *"and the selected ones should go to the top"*. With the
 * picker now opening pre-ticked from the destination's siblings, the fields that
 * are ON are the ones you came to check — and they were scattered through an
 * alphabetical list of every field on the grid.
 *
 * STABLE within each group, so the alphabetical order the caller sorted by
 * survives inside "selected" and inside "the rest". Unticking a field moves it
 * down; that is the same rule read backwards, and it is what makes the position
 * mean something.
 */
export function selectedFirst(fields, selectedIds) {
  const sel = new Set(selectedIds || []);
  const on = [], off = [];
  for (const f of fields || []) (sel.has(f?.id) ? on : off).push(f);
  return [...on, ...off];
}
