// helpers/autoAppliedFields.js
// ============================================================
// PURE. `(module, fieldsById, fieldVisibility, autoAppliedFieldIds) → [{ field, binding }]`
// — the fields an OCCURRENCE renders, for every role.
//
// TWO CASCADES, AND THIS FILE CONSUMES BOTH RESOLVED. User, 2026-08-10:
// *"its a cascade of shown fields and auto applied fields."*
//
//   AUTO-APPLIED  which fields the occurrence HAS without its module binding them
//   SHOWN         of the fields it has, which ones render
//
// Both are resolved by nearest-wins walks in `state/selectors.js`
// (`getEffectiveAutoAppliedFieldIds`, `getEffectiveFieldVisibilityForOccurrence`)
// and arrive here as plain values. This file does no walking and holds no
// policy about WHERE a list came from — that is what keeps it testable as a
// pure function and keeps the two cascades from leaking into each other.
//
// NOTHING HERE NAMES A FIELD. User, correcting the earlier name twice:
// *"universal fields arent anything hard coded, its just what the app sets at a
// grid level and passed down."* So this file has no idea which id is Tags or
// Date. An empty list behaves byte-identically to the code before auto-applied
// fields existed — the property that makes it safe to have on every surface.
//
// WHY A SYNTHESIZED BINDING RATHER THAN A MIGRATION. The alternative was writing
// the binding onto all 2,505 modules of poms grid: a large write to protected
// live data, and a rule every future module has to remember — the "next call
// site forgets" class this repo has been bitten by four sessions running. A
// cascaded list cannot be forgotten by a module that does not exist yet.
//
// AUTO-APPLIED BINDINGS ARE BORN VISIBLE, and that is the correction that
// prompted this file's existence. They used to be born HIDDEN and revealed by
// naming them in a `show`-mode `fieldVisibility` — but show-mode is a WHITELIST,
// so revealing one field hid every other. Migration 0064 did exactly that to the
// Trackers page and the user saw the result: *"currently none of the trackers
// are showing their fields either… just the tags field."* Applied and shown are
// different questions; an applied field renders unless the SHOWN cascade hides
// it, like any ordinary binding.
// ============================================================

/**
 * The GRID-level auto-applied ids, defensively — `meta` is Mixed.
 *
 * This is the ROOT of the cascade, not the resolved answer for any particular
 * occurrence: use `getEffectiveAutoAppliedFieldIds` (state/selectors) wherever
 * an occurrence is in hand. This exists for the surfaces that edit or describe
 * the grid-level default itself and have no occurrence — Grid Settings, and the
 * module-level field-bindings editor.
 */
export function gridAutoAppliedFieldIds(grid) {
  const ids = grid?.meta?.autoAppliedFieldIds;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
}

/**
 * The fields to render for an occurrence — container, page, panel, textblock,
 * artifact, instance.
 *
 * MIRRORS `ModuleInstance`'s historical rules on purpose ("works with the same
 * rules" was the ask): the media-role exclusion, the force-show that lets a
 * table column ask for a hidden binding by name, show-mode extras for values
 * stamped without a declared binding, and the order sort.
 *
 * @param module               the occurrence's module (carries `fieldBindings`)
 * @param fieldsById           field lookup
 * @param fieldVisibility      RESOLVED shown cascade (`{mode, fieldIds}` | null)
 * @param autoAppliedFieldIds  RESOLVED auto-applied cascade (array of field ids)
 * @param autoAppliedRoles     which ROLES receive the auto-applied list; null =
 *                             every role, which is the historical behaviour
 *
 * ── WHY ROLES AND NOT THE CASCADE (user, 2026-08-11: *"please hide date, tags
 *    on page headers too"*) ────────────────────────────────────────────────
 *
 * The obvious move is to write `[]` onto the page's own auto-applied cascade.
 * It cannot work: that cascade is NEAREST-WINS, so `[]` on a page silences
 * every occurrence beneath it — and the whole point of the Trackers / Tasks /
 * Schedule pages is that the INSTANCES under them show Date. The cascade
 * answers "which fields exist here and below"; this answers "which kinds of
 * surface render them", and they are different questions.
 *
 * Measured before choosing: 3 pages and 147 containers were rendering the
 * universal Date/Tags purely because they sit above (or are) the three pages
 * where Date is shown. A page header and a container header are chrome; the
 * row is the thing carrying the data.
 *
 * STILL NAMES NO FIELD, and an absent list behaves exactly as before — the
 * property that makes this safe to have on every surface.
 */
export function resolveOccurrenceFields({
  module,
  fieldsById,
  fieldVisibility = null,
  autoAppliedFieldIds = [],
  autoAppliedRoles = null,
} = {}) {
  if (!fieldsById) return [];
  const bindings = Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];
  const roleAllowed = !Array.isArray(autoAppliedRoles)
    || autoAppliedRoles.includes(module?.role);
  const applied = roleAllowed && Array.isArray(autoAppliedFieldIds) ? autoAppliedFieldIds : [];

  // Show-mode ids: a field named here renders EVEN IF its binding is hidden.
  // The hidden flag means "not in the normal inline render"; an explicit show
  // is a surface asking for it by name, which outranks that. (This is what
  // makes the Schedule Table's Date column work — the task module binds the
  // date hidden, and the column asks for it.)
  const showSet = fieldVisibility?.mode === "show" && Array.isArray(fieldVisibility.fieldIds)
    ? new Set(fieldVisibility.fieldIds)
    : null;

  const passes = (fieldId) => {
    if (!fieldVisibility || !fieldVisibility.mode || fieldVisibility.mode === "off") return true;
    const inList = Array.isArray(fieldVisibility.fieldIds) && fieldVisibility.fieldIds.includes(fieldId);
    if (fieldVisibility.mode === "show") return inList;
    if (fieldVisibility.mode === "hide") return !inList;
    return true;
  };

  const take = (binding) => {
    // A media-role binding renders in the dedicated media block, never as an
    // inline pill — dropping this filter puts a poster URL in the pill row.
    if (binding.role === "media") return null;
    const forced = showSet?.has(binding.fieldId);
    if (binding.hidden && !forced) return null;
    if (!passes(binding.fieldId)) return null;
    const field = fieldsById[binding.fieldId];
    if (!field) return null;
    // Clone without the hidden flag when force-shown, so downstream UI reading
    // `binding.hidden` agrees with what is on screen.
    return { field, binding: binding.hidden && forced ? { ...binding, hidden: false } : binding };
  };

  const bound = new Set(bindings.map((b) => b.fieldId));
  const out = bindings.map(take).filter(Boolean);

  // Auto-applied fields the module does not already bind. An EXPLICIT binding
  // always wins — the module said something specific about this field (an
  // order, a role, a hidden flag) and an inherited default must not overwrite
  // it. Same precedence `homeFolderForUpload` gives an explicitly chosen folder.
  //
  // `source: "cascade"` marks where the binding came from, so an editor can
  // show it as inherited rather than as something this module declared.
  for (const fid of applied) {
    if (bound.has(fid)) continue;
    bound.add(fid);
    const b = take({ fieldId: fid, role: "input", source: "cascade" });
    if (b) out.push(b);
  }

  // Show-mode ids bound nowhere and not auto-applied either — the pre-existing
  // behaviour for values stamped onto occurrences without a declared binding
  // (Build Day's defaultFields stamps date/timeslot this way).
  if (showSet) {
    for (const fid of showSet) {
      if (bound.has(fid)) continue;
      const field = fieldsById[fid];
      if (!field) continue;
      out.push({ field, binding: { fieldId: fid, role: "input" } });
    }
  }

  return out.sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0));
}
