// Options for an operation's op-level `targetOccurrenceId`.
//
// WHAT THE FIELD DOES (operationExecutor.js:1510): the executor resolves the
// op's working DATE from this occurrence's EFFECTIVE filter — `$activeDate`,
// `$filterDate`, `$activePeriodDates`. So it answers "which page's date does
// this operation work against", and it is why a Trackers navigation used to
// rebuild the Schedule for the Schedule's own unchanged dates (2026-08-09 (8)).
//
// It is NOT `cfg.targetOccurrenceId`, which is a per-STEP action config with the
// same name and its own editor in OperationsBuilder. Two different keys.
//
// PAGES ARE THE CANDIDATES, because the date filter a chain resolves to lives on
// a page — but the list is NOT pages-only. `Mood: Record Selection` targets a
// `container/graph`, so a pages-only list would make that op's real value
// unrepresentable, and a select whose value is not among its options renders
// blank and writes null on the next change. The current value is therefore
// ALWAYS present, flagged when it is not a page.
//
// A BARE ID, never an expression. `DrilldownPicker` emits `$allItemsById.<id>`
// paths, and the executor does a bare `occurrencesById[id]` lookup — storing a
// path there resolves to no occurrence, no date, and an op that silently works
// against today instead of the page. That is why this is a plain select.

/** The label a picker should show for an occurrence: its own override, else its module's. */
export function occurrenceLabel(occ, modulesById) {
  if (!occ) return "";
  const own = typeof occ.label === "string" ? occ.label.trim() : "";
  if (own) return own;
  const mod = modulesById?.[occ.moduleId];
  const ml = typeof mod?.label === "string" ? mod.label.trim() : "";
  return ml;
}

/**
 * Build the option list for the op-level target picker.
 * Returns `[{ id, label, role, kind, isCurrent, offList }]`, pages sorted by
 * label, with a non-page current value pinned FIRST and marked `offList`.
 */
export function buildTargetOccurrenceOptions({ occurrencesById, modulesById, currentId = null } = {}) {
  const occs = occurrencesById ? Object.values(occurrencesById) : [];
  const mods = modulesById || {};
  const roleOf = (o) => mods[o?.moduleId]?.role || null;
  const kindOf = (o) => mods[o?.moduleId]?.kind || null;

  const pages = occs
    .filter((o) => o && roleOf(o) === "page")
    .map((o) => {
      const name = occurrenceLabel(o, mods);
      return {
        id: o.id,
        // Sorting on the rendered label would float untitled pages to the TOP,
        // because "(" precedes every letter. Named pages sort together; the
        // untitled ones sink.
        label: name || "(untitled page)",
        _named: name ? 0 : 1,
        role: "page",
        kind: kindOf(o),
        isCurrent: o.id === currentId,
        offList: false,
      };
    })
    .sort((a, b) => a._named - b._named || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map(({ _named, ...rest }) => rest);

  if (!currentId || pages.some((p) => p.id === currentId)) return pages;

  // The current value is not a page. It still has to be selectable, or opening
  // the editor on such an op and touching anything else would drop it.
  const cur = occurrencesById?.[currentId] || null;
  const role = roleOf(cur);
  return [
    {
      id: currentId,
      label: cur ? (occurrenceLabel(cur, mods) || "(untitled)") : "(missing occurrence)",
      role: role || null,
      kind: kindOf(cur),
      isCurrent: true,
      offList: true,
    },
    ...pages,
  ];
}
