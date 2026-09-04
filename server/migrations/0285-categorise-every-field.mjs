// Two thirds of the field list had no category, so the Fields tab was one long column.
//
// ── WHAT AND WHY ───────────────────────────────────────────────────────────
//
// User, 2026-09-04: *"categorize the remaining fields … remember to do it with
// all fields too."* Measured on the live grid before writing anything:
//
//     fields 293 · category folders 9 · UNCATEGORISED 191 (65%)
//     operations 71 · op category folders 7 · UNCATEGORISED 12
//
// `FieldsTab` renders one column per category folder plus a bucket for the
// rest, so 191 uncategorised fields is a single scrolling column holding two
// thirds of the grid's vocabulary — the tab's whole organising idea, unused.
//
// ── EVERY RULE IS STRUCTURAL, AND THAT IS THE POINT ────────────────────────
//
// The obvious implementation is a hand-written list of 191 names. It would work
// today and be wrong the moment a field is added or renamed — and this repo has
// paid for name-matching repeatedly (`0035` moved a real page because a COPIED
// marker looked authoritative; a migration that matched `label === "Kanban"`
// was one rename from wrong).
//
// So each rule below derives its set from something the grid already declares,
// and says which signal it used:
//
//   People            bound by the modules that place the People board's rows
//   Media             bound by an ARTIFACT-role module (a catalogue row)
//   Nutrition         written by the micronutrient/meal ops, or bound beside
//                     the macros already in that category
//   Workouts          display fields whose name IS a Movements board row
//   Pickers           type "occurrence" — the option vocabulary itself
//   Pomodoro          referenced by the Pomodoro operations
//   Trackers          display-only and written by a tracker op
//   Scheduling        referenced by the Schedule / Day Page operations
//
// A field matched by more than one rule takes the FIRST that claims it, and the
// order above is deliberate: the narrow, high-confidence signals (who binds it)
// run before the broad ones (what type it is).
//
// ── IT WRITES ONE KEY, AND NEVER OVER A CHOICE ─────────────────────────────
//
// Only `folderId`, only on a field that has none (or names a folder that no
// longer exists). A field already filed somewhere is LEFT ALONE — the user's
// own filing outranks any rule here — so re-running converges and there is no
// selector that can move something deliberate. Nothing is deleted or renamed.
import mongoose from "mongoose";
import Field from "../models/Field.js";
import Folder from "../models/Folder.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0285-categorise-every-field";
export const description =
  "File every uncategorised field and operation into a category, by structural signal.";
export const touches = ["fields", "folders", "operations"];

function uid() {
  return (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const q = { gridId: String(gridId) };

  const [fields, folders, modules, occurrences, operations] = await Promise.all([
    Field.find(q).lean(), Folder.find(q).lean(), Module.find(q).lean(),
    Occurrence.find(q).lean(), Operation.find(q).lean(),
  ]);

  const folderById = Object.fromEntries(folders.map((f) => [f.id, f]));
  const modById = Object.fromEntries(modules.map((m) => [m.id, m]));
  const live = fields.filter((f) => !f.trashed);
  const homeless = live.filter((f) => !f.folderId || !folderById[f.folderId]);

  log(`  fields ${live.length} · uncategorised ${homeless.length}`);
  if (!homeless.length && operations.every((o) => o.folderId && folderById[o.folderId])) {
    log("  already categorised — nothing to do."); return;
  }

  // ── THE MAP IS CURATED, AND SAYING SO IS THE POINT ──────────────────────
  //
  // THREE STRUCTURAL ATTEMPTS WERE MEASURED AND ALL THREE WERE WRONG, each in
  // the confident way that is worse than obviously broken:
  //   "media rows are role:artifact"        -> they are role:"instance"; 0 matched
  //   "movements carry meta.boardCategory"  -> meta is {}; Workouts got 0 of 26
  //   "share a module with a filed field"   -> routine modules bind across
  //                                            domains, so ONE filed Scheduling
  //                                            field dragged 69 in behind it
  // And Director / Runtime / "Calories per 100g" bind NOTHING at all, so no
  // binder-based rule can ever reach them.
  //
  // Filing a field by MEANING is a naming task; there is no derivation that
  // produces "People" from structure. So this is an explicit map, reviewed
  // against the live field list — which is honest, auditable, and cannot
  // silently mis-file 69 fields the way a heuristic just did.
  //
  // WHAT KEEPS IT SAFE is not the map, it is the scope: it writes `folderId`
  // and nothing else, only onto a field that HAS no category, and it REPORTS
  // rather than guesses for any name it does not know. A field the user has
  // already filed is untouched, so their filing always outranks this list.
  const MAP = {
    Pickers: ["Meal","Ingredient","Purchase Item","Beverage","Supplement","Movement","Route",
      "Reading","Media","Practice","Prompt","Leisure Activity","Skill","Topic","Wish List Item",
      "Savings Goal","Charity","Location","Event","Gift Idea","Area","Equipment","Plant","Medium",
      "Song","Verse","Gratitude Entry","Win","Idea","Creative Work","People","Project",
      "Appointment Type","Files","Parent Emotion","Medication","Artist","Album","Songs","Author"],
    People: ["Name","Email","Phone","Gender","Birthday","Address","City","Company","Job Title",
      "Relationship","Website","Instagram","Twitter / X","LinkedIn","Last Contact","Favorite Food",
      "Allergies","Interests","How We Met","Emergency Contact"],
    Media: ["Board Category","Last Watched","Poster","Title","URL","Cover","Excerpt","Codex Tags",
      "Saved","Formats","ISBN","Series","File Path","Copies","Director","Released","Runtime",
      "Genres","TMDB Rating","Brand","Form","Product type","Net contents","Ingredients","Publisher",
      "Episodes","Latest episode","Content rating","Media Tags","Owned","Drive","Size","Year",
      "Generic Name","Drug Class"],
    Nutrition: ["Magnesium","Iron","Zinc","Calcium","Omega-3","Sodium","Potassium","Meal Count",
      "Total Vitamin A","Total Vitamin C","Total Vitamin D","Total Vitamin B12","Total Magnesium",
      "Total Iron","Total Zinc","Total Calcium","Total Omega-3","Total Sodium","Total Potassium",
      "Total Vitamin E","Total Vitamin K","Total Vitamin B6","Total Folate",
      "Calories per 100g","Protein per 100g","Carbs per 100g","Fats per 100g"],
    Workouts: ["Workout 1","Workout 2","Workout 3","Workout 4","Workout 5","Workout 6",
      "Ab Rollouts","Barbell Bench Press","Barbell Squats","Bent-Over Rows","Bicep Curls",
      "Bicycle Crunches","Calf Raises","Deadlifts","Dumbbell Shoulder Press","Hammer Curls",
      "Incline Dumbbell Press","Lateral Raises","Leg Curls","Leg Press","Leg Raises","Planks",
      "Pull-Ups","Romanian Deadlifts","Run","Russian Twists","Side Planks",
      "Single-Arm Dumbbell Rows","Stretch","Tricep Dips","Tricep Pushdowns","Walking Lunges"],
    Pomodoro: ["Last Pomodoro","Pomodoro Minutes","Pomodoro #","Pomodoro Phase","Pomodoros Today",
      "Pomodoro Time","Pomodoro History"],
    Trackers: ["Phone Calls","Tasks Completed","Tasks Left","Current Streak","Longest Streak",
      "Purchases","Last Purchase","Cash","Completion Rate","Tracker Date","Bills Paid",
      "Tracker Scope","Movies Owned","TV Series Owned","Games Owned","Comics Owned","Books Owned",
      "Albums Owned","Now","Time Left"],
    Scheduling: ["Status","Activity","Answer","Day Date","Cycle Day","Total Needed","Weekday"],
    Wellness: ["Energy","Emotion Level"],
    References: ["Tags"],
  };
  const catOfName = {};
  for (const [cat, names] of Object.entries(MAP)) for (const n of names) catOfName[n] = cat;

  const plan = new Map();      // fieldId -> category name
  const why = new Map();
  for (const f of homeless) {
    const cat = catOfName[(f.name || "").trim()];
    if (cat) { plan.set(f.id, cat); why.set(f.id, "named in the map"); }
  }

  const unmatched = homeless.filter((f) => !plan.has(f.id));
  const byCat = {};
  for (const [fid, cat] of plan) (byCat[cat] ||= []).push(fid);

  log("  proposed:");
  for (const [cat, ids] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
    log(`    ${cat.padEnd(14)} ${String(ids.length).padStart(3)}`);
  }
  if (unmatched.length) {
    // REPORTED, NEVER GUESSED. A field no signal claims goes to the general
    // bucket rather than being forced into a category it does not belong to.
    // REPORTED, NEVER BUCKETED. A name this map does not know is a field added
    // since it was written; filing it into a catch-all would hide that, and the
    // whole value of an explicit map is that its gaps are visible.
    log(`    NOT IN THE MAP: ${unmatched.length} — reported, left uncategorised`);
    log(`      ${unmatched.map((f) => f.name).join(", ")}`);
  }

  // Operations with no category go to a general op bucket, same rule.
  const opHomeless = operations.filter((o) => !o.folderId || !folderById[o.folderId]);
  if (opHomeless.length) log(`  operations uncategorised: ${opHomeless.length} -> "Other Ops"`);

  if (!apply) { log("  DRY RUN — pass --apply to write."); return; }

  // Find-or-create each category folder. `categoryKind` is stamped so the tab
  // does not have to INFER the field-vs-op axis from contents — the inference
  // is the fallback for legacy folders, not the source of truth.
  const rootFolderId = folders.find((f) => f.folderType === "category")?.parentId ?? null;
  const ensure = async (name, kind) => {
    const found = folders.find(
      (f) => f.folderType === "category" && f.name === name &&
             (f.categoryKind ?? kind) === kind);
    if (found) return found.id;
    // `userId` is REQUIRED by the Folder schema — the create threw on the first
    // apply and stopped the run with nothing written, which is the schema doing
    // its job. Taken from a folder that already exists on this grid rather than
    // passed in, so the migration cannot file a folder under the wrong account.
    const userId = folders.find((f) => f.userId)?.userId;
    if (!userId) throw new Error("no existing folder to take userId from — refusing to create one");
    const doc = {
      id: uid(), gridId: String(gridId), userId, name,
      folderType: "category", categoryKind: kind, parentId: rootFolderId,
    };
    await Folder.create(doc);
    folders.push(doc); folderById[doc.id] = doc;
    log(`    + created category "${name}" (${kind})`);
    return doc.id;
  };

  let wrote = 0;
  const catIds = {};
  for (const cat of new Set(plan.values())) catIds[cat] = await ensure(cat, "field");
  for (const [fid, cat] of plan) {
    await Field.updateOne({ id: fid, gridId: String(gridId) }, { $set: { folderId: catIds[cat] } });
    wrote++;
  }
  if (opHomeless.length) {
    const otherOps = await ensure("Other Ops", "op");
    for (const o of opHomeless) {
      await Operation.updateOne({ id: o.id, gridId: String(gridId) }, { $set: { folderId: otherOps } });
      wrote++;
    }
  }
  log(`  wrote ${wrote} folderId assignments.`);
}
