// 0214 — the tasks goal becomes ONE number instead of two that silently disagree.
//
// Audit item C1, and the last open piece of *"make sure i can edit everything in
// the ui"*. Your acceptance test was *"i'd like to change my tasks goal from 10 to
// 5"* — and it passes, twice, if you know:
//
//     Tasks Completed   { startValue: 0, targetValue: 5, targetOp: ">=" }   counts UP
//     Tasks Left        { startValue: 5, targetValue: 0, targetOp: "<=" }   counts DOWN
//
// Both encode "5 tasks", in two field editors under two names. Changing one is
// not an error; it just leaves the pair inconsistent, with nothing on screen
// saying so.
//
// `Tasks Left.startValue` now DECLARES that it follows `Tasks Completed.targetValue`
// (`meta.deriveDisplayFrom`), so the renderer resolves it and the field editor shows
// it read-only with "follows Tasks Completed". One number.
//
// **IT WRITES NO VALUE, WHICH IS THE POINT.** The stored `startValue` stays exactly
// as it is and remains the fallback: `resolveDisplayConfig` fails soft, so a grid on
// an older bundle, or one where `Tasks Completed` is later deleted, renders precisely
// what it renders today. Nothing here can make a goal tile go blank.
//
// **CHECKED, NOT ASSUMED: the pair currently AGREES** (5 and 5), so switching to the
// derived value changes nothing on screen right now. Had they disagreed, this would
// silently move the bar — so the migration REPORTS the two numbers and refuses if it
// cannot find exactly one field of each name.
//
// Resolved by name AND `displayEnabled`, because this grid has carried duplicate
// field names (2026-08-11 renamed five pairs; `0053` had to discriminate two fields
// called `Due` by TYPE). A selector that matches more than it names is the `0035`
// class.
export const id = "0214-tasks-left-follows-tasks-completed";
export const description =
  "Tasks Left's start value follows Tasks Completed's target — the tasks goal becomes one number";

const SOURCE = "Tasks Completed";
const TARGET = "Tasks Left";

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;

  const pick = async (name) => {
    const all = await Field.find({ gridId, name }).lean();
    const display = all.filter((f) => f.displayEnabled === true);
    return { all, display };
  };

  const src = await pick(SOURCE);
  const tgt = await pick(TARGET);
  if (src.display.length !== 1 || tgt.display.length !== 1) {
    log(`  expected exactly one display field named "${SOURCE}" and "${TARGET}" — ` +
        `found ${src.display.length} and ${tgt.display.length} (of ${src.all.length}/${tgt.all.length} by name) — REFUSING`);
    return { stamped: 0, refused: true };
  }
  const source = src.display[0];
  const target = tgt.display[0];

  // Report the pair rather than assuming it agrees — if these two numbers differ,
  // the derivation MOVES the bar, and that should be visible in the log.
  const sv = source.displayConfig?.targetValue;
  const tv = target.displayConfig?.startValue;
  log(`  ${SOURCE}.targetValue = ${sv}   ${TARGET}.startValue = ${tv}` +
      (sv === tv ? "   (agree — nothing changes on screen)" : "   ⚠ THEY DISAGREE — the derived value wins from now on"));

  const existing = target.meta?.deriveDisplayFrom;
  if (existing?.fieldId === source.id && existing?.from === "targetValue" && existing?.to === "startValue") {
    log("  already declared — nothing to do");
    return { stamped: 0, alreadyDone: true };
  }

  log(`${dryRun ? "[dry run] " : ""}${TARGET}.startValue now follows ${SOURCE}.targetValue`);
  if (!dryRun) {
    // $set the one key rather than writing `meta` whole — a field carries more
    // than this (optionsSource, multiSelect, increment, placeholder …).
    await Field.updateOne(
      { id: target.id, gridId },
      { $set: { "meta.deriveDisplayFrom": { fieldId: source.id, from: "targetValue", to: "startValue" } } }
    );
  }
  return { stamped: 1 };
}
