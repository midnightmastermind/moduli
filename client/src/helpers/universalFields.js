// helpers/universalFields.js
// ============================================================
// PURE. `(module, grid, fieldsById, fieldVisibility) → [{ field, binding }]` —
// the fields an OCCURRENCE shows, for every role.
//
// THE GRID SAYS WHICH FIELDS ARE UNIVERSAL. NOTHING HERE NAMES ONE.
// User, 2026-08-10: *"it shouldnt be hard coded at all, it should be set on the
// grid level to give every occurance that field (and Date). just like we do on
// the schedule level."* So `grid.meta.universalFieldIds` is a list of field ids,
// exactly like the existing `grid.meta.scheduleFieldIds`, and this file has no
// idea which of them is Tags. A grid that names none behaves byte-identically to
// before — that is the property that makes this safe to ship everywhere at once.
//
// WHY A SYNTHESIZED BINDING RATHER THAN A MIGRATION. The alternative was writing
// the binding onto all 2,505 modules of poms grid: a large write to protected
// live data, and a rule every future module has to remember — the "next call
// site forgets" class this repo has been bitten by four sessions running. A
// grid-level list cannot be forgotten by a module that does not exist yet.
//
// UNIVERSAL BINDINGS ARE BORN HIDDEN, and that is the user's call ("we should
// set them to hide but i want to make sure its at least working"). They become
// visible through the SAME mechanism that already exists for this — an
// occurrence whose resolved fieldVisibility is `show` mode listing the field.
// No new visibility concept was invented; see the force-show note below.
// ============================================================

/** The grid's universal field ids, defensively — `meta` is Mixed. */
export function universalFieldIds(grid) {
  const ids = grid?.meta?.universalFieldIds;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
}

/**
 * The fields to render for an occurrence — container, page, panel, textblock,
 * artifact.
 *
 * MIRRORS `ModuleInstance`'s rules on purpose ("works with the same rules" was
 * the ask) but **INSTANCES DELIBERATELY DO NOT USE IT** — user, 2026-08-10:
 * *"instances shouldnt change at all."* That path renders on every row of every
 * board and carries behaviours this does not (the table-cell column override,
 * the media split, `meta.disabled`); rewriting it to share code would be a
 * refactor of the hottest render path in the app to ship a feature elsewhere.
 * The duplication is chosen, and it is one function against one memo — if the
 * two ever need to diverge, they can.
 *
 * @param module          the occurrence's module (carries `fieldBindings`)
 * @param grid            for `meta.universalFieldIds`
 * @param fieldsById      field lookup
 * @param fieldVisibility the RESOLVED cascade output (getEffectiveFieldVisibility…)
 */
export function resolveOccurrenceFields({ module, grid, fieldsById, fieldVisibility = null } = {}) {
  if (!fieldsById) return [];
  const bindings = Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];

  // Show-mode ids: a field named here renders EVEN IF its binding is hidden.
  // The hidden flag means "not in the normal inline render"; an explicit show
  // is a surface asking for it by name, which outranks that. (This is what
  // makes the Schedule Table's Date column work — the task module binds the
  // date hidden, and the column asks for it.) Universal fields ride the same
  // path: born hidden, shown when an occurrence opts them in.
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

  // Universal fields the module does not already bind. An EXPLICIT binding
  // always wins — the module said something specific about this field (an
  // order, a role, a hidden flag) and a grid-wide default must not overwrite
  // it. Same precedence `homeFolderForUpload` gives an explicitly chosen folder.
  for (const fid of universalFieldIds(grid)) {
    if (bound.has(fid)) continue;
    bound.add(fid);
    const b = take({ fieldId: fid, role: "input", hidden: true, source: "grid" });
    if (b) out.push(b);
  }

  // Show-mode ids bound nowhere and not universal either — the pre-existing
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
