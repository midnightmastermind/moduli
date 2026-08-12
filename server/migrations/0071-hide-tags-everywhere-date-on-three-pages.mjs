// server/migrations/0071-hide-tags-everywhere-date-on-three-pages.mjs
//
// USER, 2026-08-11: *"hide tags everywhere, and date isnt being set on
// trackers. hide date everywhere thats not tasks, schedule, trackers"*
//
// Auto-applied fields (Tags + Date) render on every occurrence since they stopped
// being born hidden. That was necessary — the mechanism that hid them was a
// show-mode WHITELIST which also hid everything else — but the result is noisy.
// The right control is the SHOWN cascade, in HIDE mode: a blacklist, so it
// suppresses only what it names and never a module's own bound fields.
//
// ── A DEFAULT WITH THREE EXCEPTIONS IS A CASCADE WITH A ROOT ────────────────
//
// So the grid gets one (`grid.meta.fieldVisibility`, added the same day):
//
//   grid       hide [Tags, Date]                        ← everywhere
//   Tasks      hide [Tags]                              ← Date shows
//   Trackers   hide [Tags]                              ← Date shows
//   Schedule   hide [Tags, <whatever it already hid>]   ← Date shows
//
// Writing "everywhere" onto all 71 pages instead would need re-writing for every
// page created afterwards.
//
// ── THE SCHEDULE IS NOT A BLANKET OVERWRITE, AND THAT IS DELIBERATE ─────────
//
// It already carries `hide [Date, Time Slot, Last Seen]` — seeded 2026-07-11 so
// its task rows show Completed only. The ask names Date; it says nothing about
// Time Slot or Last Seen. So this REMOVES Date from that list and ADDS Tags,
// leaving the other two exactly as they were. Replacing the list wholesale would
// silently un-hide two fields nobody asked about.
//
// ── WHAT THIS DOES NOT DO: SET A DATE ON TRACKERS ──────────────────────────
//
// Measured: 0 of 35 tracker tiles carry a Date VALUE, so the report is accurate.
// But stamping one is the opposite of a fix, and the history is explicit. From
// 2026-04-30: *"Goals are conceptually persistent — a date field on the
// occurrence makes the named-filter SAME_DAY check fail on any other day, so the
// goal vanished as soon as the user navigated past today."* A migration removed
// exactly this once already.
//
// It is now worse than it was then: since 2026-08-11 a CLEARED date hides
// anything dated, so a stamped tracker would also vanish whenever the filter is
// cleared. Trackers are date-scoped by their PAGE's filter, not by a value they
// carry. Flagged to the user rather than guessed at.

export const id = "0071-hide-tags-everywhere-date-on-three-pages";
export const describe =
  "Hide Tags everywhere via a grid-level fieldVisibility default, and hide Date everywhere except "
  + "the Tasks, Schedule and Trackers pages.";

/** The pages Date stays visible on. Resolved by label + page role. */
const DATE_VISIBLE_PAGES = ["Tasks", "Schedule", "Trackers"];

/**
 * The hide-list for a page that should still show Date: Tags, plus anything the
 * page already hid, minus Date itself.
 *
 * Exported so the test drives the REAL merge — the Schedule's existing list is
 * the case that matters, and replacing it wholesale would un-hide two fields the
 * user never mentioned.
 */
export function mergePageHideList(existing, { tagsId, dateId }) {
  const prior = existing?.mode === "hide" && Array.isArray(existing.fieldIds) ? existing.fieldIds : [];
  const kept = prior.filter((id) => id !== dateId && id !== tagsId);
  return [tagsId, ...kept];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Occurrence, Module, Field } = models;

  const grid = await Grid.findById(gridId).lean();
  if (!grid) { log("  · grid not found"); return; }

  // The two ids come from the grid's OWN auto-applied list — the thing that
  // makes them universal in the first place. Reading them by name would be a
  // second source of truth, and this grid has five duplicate field names.
  const applied = Array.isArray(grid.meta?.autoAppliedFieldIds) ? grid.meta.autoAppliedFieldIds : [];
  if (applied.length < 1) { log("  · this grid auto-applies no fields — nothing to hide"); return; }

  const fields = await Field.find({ gridId }).lean();
  const byId = new Map(fields.map((f) => [f.id, f]));
  const nameOf = (id) => byId.get(id)?.name || `(unknown ${String(id).slice(0, 6)})`;

  const tagsId = applied.find((id) => byId.get(id)?.name === "Tags");
  const dateId = applied.find((id) => byId.get(id)?.type === "date");
  if (!tagsId || !dateId) {
    // Fails CLOSED and names what it could not resolve, rather than hiding the
    // wrong field on every occurrence on the grid.
    log(`  · REFUSED: could not resolve both fields from meta.autoAppliedFieldIds `
      + `[${applied.map(nameOf).join(", ")}] — need one named "Tags" and one of type "date"`);
    return;
  }
  log(`  · Tags = ${nameOf(tagsId)} (${tagsId}), Date = ${nameOf(dateId)} (${dateId})`);

  // ── the grid default ──────────────────────────────────────────────────────
  const wanted = { mode: "hide", fieldIds: [tagsId, dateId] };
  const current = grid.meta?.fieldVisibility;
  if (JSON.stringify(current) === JSON.stringify(wanted)) {
    log("  · grid default already hides both — no change");
  } else {
    log(`  · GRID default -> hide [${nameOf(tagsId)}, ${nameOf(dateId)}]  (applies to every occurrence)`);
    if (!dryRun) {
      await Grid.updateOne({ _id: gridId }, { $set: { "meta.fieldVisibility": wanted } });
    }
  }

  // ── the three exceptions ──────────────────────────────────────────────────
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";

  for (const pageName of DATE_VISIBLE_PAGES) {
    const page = occs.find((o) => modById.get(o.moduleId)?.role === "page" && labelOf(o) === pageName);
    if (!page) { log(`  · "${pageName}" page not found — skipping (Date stays hidden there)`); continue; }

    const next = { mode: "hide", fieldIds: mergePageHideList(page.fieldVisibility, { tagsId, dateId }) };
    if (JSON.stringify(page.fieldVisibility) === JSON.stringify(next)) {
      log(`  · "${pageName}" already correct — no change`);
      continue;
    }
    const kept = next.fieldIds.filter((id) => id !== tagsId);
    log(`  · "${pageName}" -> hide [${next.fieldIds.map(nameOf).join(", ")}]  (Date now VISIBLE`
      + `${kept.length ? `; kept its existing ${kept.map(nameOf).join(" + ")} hide` : ""})`);
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: page.id }, { $set: { fieldVisibility: next } });
    }
  }

  // The report the user actually asked about, stated rather than silently
  // skipped — see the header for why stamping one would make trackers vanish.
  log("  · NOTE: Date is still EMPTY on tracker tiles. Not stamped here — a stored date makes an");
  log("    occurrence date-filtered, and trackers are persistent by design (2026-04-30). Needs a call.");
}
