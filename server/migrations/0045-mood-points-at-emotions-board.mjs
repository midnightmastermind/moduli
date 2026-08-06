// server/migrations/0045-mood-points-at-emotions-board.mjs
//
// `Mood` stops being 47 loose strings and starts pointing at the Emotions board
// (user's choice, 2026-08-06 — "option A").
//
// WHY IT HAS TO BE THIS WAY for the wheel to work: a graph click carries an
// OCCURRENCE ID. If Mood kept storing strings, that id would have to be
// translated to a label on the way in and back to an id on the way out for the
// highlight — two truths to keep in sync. Pointing Mood at the board makes the
// click, the stored value and the graph's highlight all the SAME ids.
//
// SAFE BECAUSE NOTHING IS STORED YET. Measured on poms grid: Mood is bound by 16
// modules (Express, Check In, Vent, 13× Journal) but ZERO occurrences carry a
// value. This RE-ASSERTS that at run time rather than trusting the measurement —
// if any occurrence has since gained one, it refuses and says so, because
// converting a stored string into an occurrence reference is a data migration
// this does not attempt.
//
// THE VOCABULARY IMPROVES RATHER THAN SHRINKS, and that is why the wheel choice
// mattered. An earlier pass used the WILLCOX wheel (6 cores: Mad, Scared,
// Joyful, Powerful, Peaceful, Sad) and 21 of the 47 old words had no counterpart
// there — Happy, Grateful, Calm, Curious, Eager, Interested, Anticipating,
// Disgusted, Amazed, Worried, Nervous, Stressed … That unexplained loss was the
// clue that the wrong wheel had been used. The 8-core Emotions Wheel covers
// them. This migration MEASURES the overlap at run time and reports anything
// still unmatched, rather than asserting it is fine.
//
// The 47 previous options, recorded verbatim so nothing is silently lost:
//   Joyful, Happy, Content, Cheerful, Proud, Optimistic, Playful, Excited,
//   Trusting, Accepting, Peaceful, Serene, Grateful, Anxious, Scared, Worried,
//   Nervous, Insecure, Surprised, Amazed, Confused, Stunned, Sad, Lonely,
//   Disappointed, Depressed, Hopeless, Guilty, Disgusted, Disapproving, Bored,
//   Angry, Frustrated, Irritated, Annoyed, Resentful, Jealous, Anticipating,
//   Interested, Curious, Eager, Neutral, Tired, Stressed, Overwhelmed, Calm,
//   Focused
export const id = "0045-mood-points-at-emotions-board";
export const describe =
  "Repoint the Mood field from 47 manual strings to an occurrence dropdown over the Emotions board. " +
  "Refuses if any occurrence already carries a Mood value. Deletes no occurrences.";

const TAG = "emotion";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Occurrence, Module } = models;

  const mood = await Field.findOne({ gridId, name: /^mood$/i }).lean();
  if (!mood) { log("no Mood field on this grid — nothing to do"); return; }

  // IDEMPOTENT: already an occurrence dropdown means this ran.
  if (mood.type === "occurrence") { log("Mood is already an occurrence dropdown — nothing to do"); return; }

  const boardCategory = await Field.findOne({ gridId, name: /^board category$/i }).lean();
  if (!boardCategory) { log("no 'Board Category' field — cannot scope the dropdown"); return; }

  // The board must exist first (0044). Refuse rather than point at nothing.
  //
  // Counted the way the DROPDOWN will actually resolve them — role:"instance"
  // only, because the predicate below runs over `$allInstances`. The board's
  // CONTAINER carries the same tag (that is how a board feeds itself), so a
  // naive count reports one too many and the log would be quietly wrong about
  // what the user is going to see in the picker.
  const allModules = await Module.find({ gridId }).lean();
  const modById = new Map(allModules.map((m) => [m.id, m]));
  const tagged = await Occurrence.find({
    gridId, [`fields.${boardCategory.id}.value`]: TAG,
  }).lean();
  const emotions = tagged.filter((o) => modById.get(o.moduleId)?.role === "instance");
  if (emotions.length === 0) {
    log(`no instance occurrences tagged "${TAG}" — run 0044-emotions-board first`);
    return;
  }
  log(`Emotions board: ${emotions.length} selectable emotion(s) ` +
      `(${tagged.length - emotions.length} non-instance tagged occurrence excluded, as the picker will)`);

  // THE PRECONDITION, re-measured rather than trusted.
  const withValue = await Occurrence.countDocuments({ gridId, [`fields.${mood.id}`]: { $exists: true } });
  if (withValue > 0) {
    log(`REFUSING: ${withValue} occurrence(s) already carry a Mood value.`);
    log("Converting stored strings into occurrence references is a data migration this does not attempt.");
    return;
  }
  log("0 occurrences carry a Mood value — safe to repoint");

  const bound = await Module.find({ gridId, "fieldBindings.fieldId": mood.id }).lean();
  const oldOptions = mood.meta?.options || mood.meta?.optionsSource?.values || [];
  log(`Mood: type "${mood.type}" → "occurrence", multiSelect ${mood.meta?.multiSelect ? "kept" : "set"}`);
  log(`${oldOptions.length} manual option(s) replaced by the board; ${bound.length} module binding(s) unaffected`);
  log(`bound by: ${bound.map((m) => m.label).slice(0, 6).join(", ")}${bound.length > 6 ? " …" : ""}`);

  // What the change costs, MEASURED rather than asserted.
  const wheelLabels = new Set(emotions.map((o) => (o.label || modById.get(o.moduleId)?.label || "").toLowerCase()));
  const lost = oldOptions
    .map((o) => (typeof o === "string" ? o : o?.label || o?.value))
    .filter(Boolean)
    .filter((l) => !wheelLabels.has(String(l).toLowerCase()));
  log(`old options with NO counterpart on the wheel (${lost.length}/${oldOptions.length}): ${lost.join(", ") || "none"}`);

  if (dryRun) { log("dry run — no writes"); return; }

  await Field.updateOne({ gridId, id: mood.id }, {
    $set: {
      type: "occurrence",
      "meta.multiSelect": true,          // several emotions a day is the normal case
      "meta.optionsSource": {
        mode: "find",
        collection: "$allInstances",
        predicate: { conjunction: "AND", rules: [
          { left: `fields.${boardCategory.id}.value`, comparator: "CONTAINS", right: TAG },
          // Feed copies inherit their source's tag and would double-list — the
          // established exclusion on every board dropdown here.
          { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: null },
        ]},
      },
    },
    // The manual list is gone; it lives in this file's header for the record.
    $unset: { "meta.options": "" },
  });

  log(`Mood now resolves ${emotions.length} emotions from the board`);
}
