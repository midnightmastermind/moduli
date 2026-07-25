// scripts/createLiveData.js
// ============================================================
// Creates (or recreates) the "Poms" grid for a user. Intended as the
// production-quality grid that replaces createTestGrid's fixture data.
//
// Runnable standalone via:
//
//   node --env-file=.env scripts/createLiveData.js                 # default user (josh)
//   node --env-file=.env scripts/createLiveData.js test@moduli.test
//
// Standalone runs drop the existing "Poms" grid + its scoped data first so
// re-running is idempotent. Other grids on the user are left UNTOUCHED —
// in particular "test grid" (the frozen pre-2026-07-25 live grid) must
// NEVER be dropped, swept, cleared, or exported by this script.
// The exported `createLiveData(userId, options)` function itself is pure-create
// — callers that have already wiped user data don't need a second drop.
//
// This is the scaffold (Task 6). Content (fields / instances / containers /
// pages / ops / templates) is added in Tasks 7–14.
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import { nanoid } from "nanoid";
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";
import Module from "../models/Module.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { generateTimeSlots } from "../utils/operationBuilders.js";
import { markdownToModuli } from "../services/markdownImporter.js";
import {
  buildGridDoc,
  buildScheduleFilters,
  buildTemplatesManifest,
  buildScheduleTemplatePage,
  buildDayPageTemplate,
  buildProjectTemplate,
  makeScheduleBuildScheduleOp,
  makeDayPageBuildOp,
  makeProjectCreateOp,
  makeProjectStatusRouterOp,
  makeDayPageBuildTasksCompletedOp,
  makeStampDateTimeSlotOp,
  makeClearDateOnMoveOutOp,
  makeTrackerOp,
  makeAlarmOp,
} from "../utils/liveSystemBuilders.js";
import { gateScheduleTrackers, GATE_TRACKER_NAMES } from "../utils/completionGate.js";
import { applyPeriodAllPolicy } from "../utils/periodAllPolicy.js";
import { ensureGridFilterTrigger } from "../utils/gridFilterTrigger.js";
import fs from "fs";
import { parseSectionsWithInstances } from "../utils/mdParsers.js";
import { makeDocContent, buildMergedDocTextmap, inlineToTipTap } from "../utils/docBuilders.js";

// Markdown source files live at moduli/docs/ (same resolution as createDefaultUserData)
const __liveDataDirname = dirname(__filename);
const ROOT_DIR_MD = join(__liveDataDirname, "../../docs/");

const DEFAULT_USER_EMAIL = "josh@jpoms.com";
const DEFAULT_GRID_NAME = "Poms";
const uid = () => nanoid(12);

// Grids this script must never touch, no matter the flags. "test grid" is the
// frozen pre-2026-07-25 live grid (renamed, kept as-is per user).
const PRESERVED_GRID_NAMES = new Set(["test grid"]);

// Drop the existing "Poms" grid for this userId and all its gridId-scoped child docs.
// Scoping is DUAL — both userId AND the literal grid name "Poms" — so this
// can NEVER delete a different user's data or a grid with a different name
// (e.g. "test grid" is completely safe).
export async function dropExistingLiveGrid(userId, gridName = DEFAULT_GRID_NAME) {
  const existing = await Grid.findOne({ userId, name: gridName });
  if (!existing) return false;
  const gridId = existing._id.toString();
  await Promise.all([
    Occurrence.deleteMany({ gridId }),
    Module.deleteMany({ gridId }),
    Field.deleteMany({ gridId }),
    Manifest.deleteMany({ gridId }),
    View.deleteMany({ gridId }),
    Folder.deleteMany({ gridId }),
    Operation.deleteMany({ gridId }),
    Transaction.deleteMany({ gridId }),
  ]);
  await Grid.deleteOne({ _id: existing._id });
  return true;
}

// Stale-skeleton sweep, run on EVERY default reseed. Partial/interrupted
// reseeds (and app-side grid minting against a dead localStorage gridId)
// leave behind unnamed grids with ZERO panels — dead skeletons that
// accumulate and re-surface in the grid picker ("we have 3 grids, there
// should only be 2", 2026-07-04 + 2026-07-07). Rule: a grid with no panel
// occurrences that is NOT 1×1 is a dead skeleton → delete it + its scoped
// docs. Deliberately kept: the user's empty 1×1 scratch grid (0 panels but
// 1×1), the Poms grid (has panels), any real grid with content, and every
// PRESERVED_GRID_NAMES grid unconditionally.
export async function sweepStaleGrids(userId) {
  const grids = await Grid.find({ userId }).lean();
  const stale = grids.filter(g =>
    !PRESERVED_GRID_NAMES.has(g.name) &&
    (g.occurrences || []).length === 0 && !(g.rows === 1 && g.cols === 1)
  );
  for (const g of stale) {
    const gridId = g._id.toString();
    await Promise.all([
      Occurrence.deleteMany({ gridId }),
      Module.deleteMany({ gridId }),
      Field.deleteMany({ gridId }),
      Manifest.deleteMany({ gridId }),
      View.deleteMany({ gridId }),
      Folder.deleteMany({ gridId }),
      Operation.deleteMany({ gridId }),
      Transaction.deleteMany({ gridId }),
    ]);
    await Grid.deleteOne({ _id: g._id });
  }
  return stale.map(g => ({ id: g._id.toString(), name: g.name || "(unnamed)", rows: g.rows, cols: g.cols }));
}

// `--clear` flag: nuke every NON-PRESERVED grid + its grid-scoped docs for
// the user before reseeding. The single-grid `dropExistingLiveGrid` above
// only drops the one named "Poms", so prior runs with different grid
// names (or partial reseeds, or test-grid leftovers) accumulate over
// time. Accumulated stale data is the #1 reason `full_state` queries
// slow down — Atlas has to load + filter every Module/Occurrence row
// the user owns, even when most belong to dead grids. The User doc
// itself is preserved so auth + the user account stay intact.
// PRESERVED_GRID_NAMES grids ("test grid") and all their scoped docs
// survive --clear: deletes are scoped to the doomed gridIds only.
export async function clearAllUserGrids(userId) {
  // Collect every gridId for this user FIRST so we can wipe per-grid
  // scoped collections by id, not by userId — keeps deletes precise.
  const allGrids = await Grid.find({ userId }).select({ _id: 1, name: 1 }).lean();
  const grids = allGrids.filter(g => !PRESERVED_GRID_NAMES.has(g.name));
  const preservedIds = allGrids
    .filter(g => PRESERVED_GRID_NAMES.has(g.name))
    .map(g => g._id.toString());
  const gridIds = grids.map(g => g._id.toString());
  // Grid-scoped docs may carry userId but a stale/null gridId (from earlier
  // failed runs) — include those via the userId arm, but always exclude the
  // preserved grids' docs.
  const filter = {
    $and: [
      gridIds.length
        ? { $or: [{ userId }, { gridId: { $in: gridIds } }] }
        : { userId },
      ...(preservedIds.length ? [{ gridId: { $nin: preservedIds } }] : []),
    ],
  };
  const [occ, mod, fld, man, vw, fol, op, txn] = await Promise.all([
    Occurrence.deleteMany(filter),
    Module.deleteMany(filter),
    Field.deleteMany(filter),
    Manifest.deleteMany(filter),
    View.deleteMany(filter),
    Folder.deleteMany(filter),
    Operation.deleteMany(filter),
    Transaction.deleteMany(filter),
  ]);
  const gridDel = gridIds.length ? await Grid.deleteMany({ _id: { $in: grids.map(g => g._id) } }) : { deletedCount: 0 };
  return {
    grids: gridDel.deletedCount,
    gridNames: grids.map(g => g.name || "(unnamed)"),
    occurrences: occ.deletedCount,
    modules: mod.deletedCount,
    fields: fld.deletedCount,
    manifests: man.deletedCount,
    views: vw.deletedCount,
    folders: fol.deletedCount,
    operations: op.deletedCount,
    transactions: txn.deletedCount,
  };
}

// Snapshot every grid-scoped collection for this user → server/seed/*.json.
// The `{{USER_ID}}` placeholder lets `reloadLiveData.js` re-insert under any
// target user without rewriting ids. Called automatically at the end of
// createLiveData's main() so the on-disk seed always matches the last
// successful `--clear` run.
const SEED_COLLECTIONS_FOR_EXPORT = [
  ["grids",       Grid],
  ["modules",     Module],
  ["occurrences", Occurrence],
  ["fields",      Field],
  ["views",       View],
  ["manifests",   Manifest],
  ["folders",     Folder],
  ["operations",  Operation],
];

export async function exportLiveSeedData(userId, outDir, gridId = null) {
  fs.mkdirSync(outDir, { recursive: true });
  const stats = {};
  for (const [name, model] of SEED_COLLECTIONS_FOR_EXPORT) {
    // Scope to the seeded grid when known — the export must NEVER sweep in
    // other grids' data (the preserved "test grid" would otherwise ride
    // along and get restored/cloned by reloadLiveData).
    const filter = gridId
      ? (name === "grids" ? { userId, _id: gridId } : { userId, gridId })
      : { userId };
    const docs = await model.find(filter).lean();
    const cleaned = docs.map(d => {
      const o = { ...d };
      if (o._id) o._id = o._id.toString();
      if (o.userId) o.userId = "{{USER_ID}}";
      delete o.__v;
      delete o.createdAt;
      delete o.updatedAt;
      return o;
    });
    fs.writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(cleaned, null, 2));
    stats[name] = cleaned.length;
  }
  return stats;
}

export async function createLiveData(userId, options = {}) {
  const { gridName = DEFAULT_GRID_NAME } = options;

  // ── Pre-generate IDs ────────────────────────────────────────────────────────
  // Only the IDs the scaffold itself consumes (buildGridDoc requires dateFieldId
  // + manifestId; schedule-filter wiring requires timeslotFieldId + schedFilterId
  // + timeslotFilterId; later tasks will add more ids inline).
  const dateFieldId      = uid();
  const timeslotFieldId  = uid();
  const dueFieldId       = uid();
  const completedFieldId = uid();
  // lastSeen: stamped on every schedule-drop by Schedule: Stamp Date & Time
  // Slot. Surfaces as a freshness indicator on occurrence-select chips
  // (movies/books/podcasts/courses) so the user can see when each entry
  // was last added to schedule. Type=date so the same display widgets that
  // render the regular `date` field can render it.
  const lastSeenFieldId  = uid();
  const manifestId       = uid();
  const schedFilterId    = uid();
  const timeslotFilterId = uid();
  const goalsFilterId    = uid();
  const accountsFilterId = uid();
  // scheduleFormat: stamped on every Schedule day-column container. Values
  // "timeslot" (≤7-day view — slot containers visible inside the day-col)
  // and "shortened" (>7-day view — flat day-col with no slots, laid out in
  // a wrapped horizontal grid). Build Schedule inflates/deflates each
  // format based on $activePeriodCount; PageBoard reads this field to
  // pick the layout.
  const scheduleFormatFieldId = uid();
  // Bill schedule fields — used by bill instances in the new Bills page.
  // billCadence is a select; billDay/billCadenceN are numeric; billAnchor
  // is a date used as the cycle origin; billNextDue is the op-computed
  // next due date.
  const billCadenceFieldId   = uid();
  const billDayFieldId       = uid();
  const billCadenceNFieldId  = uid();
  const billAnchorFieldId    = uid();
  const billNextDueFieldId   = uid();
  // Occurrence-type references used by tasks to point at the bill / account /
  // subscription instances they target. All find-mode (see optionsSource).
  const accountRefFieldId      = uid();
  const billRefFieldId         = uid();
  const subscriptionRefFieldId = uid();

  // Category folder IDs — pre-generated so field/op records can declare
  // their folderId at definition time. The actual Folder records are
  // persisted in the Manifest step further down. These are command-center
  // category folders (folderType: "category"), not manifest-tree pages.
  const fieldCategoryIds = {
    scheduling:   uid(),
    workouts:     uid(),
    nutrition:    uid(),
    finance:      uid(),
    wellness:     uid(),
    intellectual: uid(),
    bills:        uid(),
    display:      uid(),
    boards:       uid(), // Option-board dropdown fields (2026-07-25)
    refs:         uid(),
  };
  const opCategoryIds = {
    trackers: uid(),
    schedule: uid(),
    daypage:  uid(),
    bills:    uid(),
    library:  uid(),
    alarms:   uid(),
    projects: uid(),
  };

  // Library / Movies Watched fields (matches createTestGrid naming exactly)
  const libraryFieldId              = uid();
  const moviesWatchedFieldId        = uid();
  const moviesWatchedDisplayFieldId = uid();

  // Books Read fields
  const booksReadFieldId           = uid();
  const booksReadDisplayFieldId    = uid();
  const pagesFieldId               = uid(); // pages per book (used by Books Read tracker)
  const posterUrlFieldId           = uid(); // library cover image url (text; role:"media" on bindings)

  // Podcasts Listened fields
  const podcastsListenedFieldId           = uid();
  const podcastsListenedDisplayFieldId    = uid();

  // Media goal per-type "last" fields (Stage 3 Media split). The *Display
  // fields above hold the {label,…} history-rows ARRAY; these add the "last"
  // (scalar title) tile so each Media per-type occurrence reads last + history.
  const lastMovieFieldId     = uid();
  const lastBookFieldId      = uid();
  const lastPodcastFieldId   = uid();

  // Courses Taken fields
  const coursesTakenFieldId           = uid();
  const coursesTakenDisplayFieldId    = uid();

  // People library fields (2026-05-22 — task #46). Person profile fields
  // (name, email, phone, gender, notes) live on each Person occurrence in
  // the Library container with `library: "person"` tag. `peopleAssigned`
  // is a multi-select occurrence-type field usable on task instances
  // (Call / Email / Text X people) — find-mode predicate scoped to
  // library="person". Profile picture lives on a media-role binding
  // using the existing posterUrlFieldId so it shares the Library media
  // pipeline.
  const personNameFieldId    = uid();
  const personEmailFieldId   = uid();
  const personPhoneFieldId   = uid();
  const personGenderFieldId  = uid();
  const personNotesFieldId   = uid();
  // Task #46 extended profile fields (per user direction 2026-05-23):
  // "really flush out the people, give it alot of fields and fill it with examples"
  const personBirthdayFieldId    = uid();
  const personAddressFieldId     = uid();
  const personCityFieldId        = uid();
  const personCompanyFieldId     = uid();
  const personJobTitleFieldId    = uid();
  const personRelationshipFieldId = uid();
  const personWebsiteFieldId     = uid();
  const personInstagramFieldId   = uid();
  const personTwitterFieldId     = uid();
  const personLinkedInFieldId    = uid();
  const personLastContactFieldId = uid();
  const personFavoriteFoodFieldId = uid();
  const personAllergiesFieldId    = uid();
  const personInterestsFieldId    = uid();
  const personHowMetFieldId       = uid();
  const personEmergencyContactFieldId = uid();
  const peopleAssignedFieldId = uid();
  // ── Option Boards (nine-dimensions rebuild, 2026-07-25) ────────────────────
  // boardCategory is THE scoping tag: every option instance carries it, every
  // board dropdown's find predicate filters on it, and every board CONTAINER
  // occurrence carries its own tag value so the addNew flow can stamp new
  // options from whichever parent the user picks at add time (no baked tags).
  const boardCategoryFieldId = uid();
  // The People + Movements board container occ ids are pre-generated: person
  // occurrences (seeded with the Library block) and the 30 exercise
  // occurrences (created in the boards section) parent directly under them.
  const peopleBoardContOccId = uid();
  const movementsBoardContOccId = uid();

  // Project kanban fields — Status select (6 options matching the agile
  // kanban columns) + Project occurrence-ref (lets a single Todo List
  // surface tasks across multiple projects unambiguously by checking
  // this field instead of relying on container ancestry).
  const statusFieldId  = uid();
  const projectFieldId = uid();
  // Projects folder — root of every per-project page minted by
  // Project: Create. Starts empty in the seed; the user mints projects
  // via the operation (mirrors how Day Pages folder gets filled by
  // Day Page: Build over time).
  const projectsFolderId = uid();

  // Library page + container IDs (need before occurrences are created)
  const libraryPageModId  = uid();
  const libraryContModId  = uid();

  // Library > Templates subfolder — holds the Schedule Template page,
  // seeded directly in STEP 7b. Day container inside it is the canonical
  // store for recurring routine instances; the Schedule: Build op
  // COPY_LINKs it into the active Schedule page per visible day.
  const libraryTemplatesFolderId = uid();
  // Pre-generate libraryContOccId so moviesWatchedFieldId / booksReadFieldId /
  // podcastsListenedFieldId / coursesTakenFieldId addNew.parentOccurrenceId
  // can be patched after occurrences are minted (mirrors createTestGrid STEP 6 pattern).
  const libraryContOccId = uid();

  // 8 movie module IDs
  const movieInceptionModId       = uid();
  const movieMatrixModId          = uid();
  const movieArrivalModId         = uid();
  const movieDuneModId            = uid();
  const movieInterstellarModId    = uid();
  const movieBladeRunner2049ModId = uid();
  const moviePrestigeModId        = uid();
  const movieTenetModId           = uid();

  // 7 book module IDs
  const bookAtomicHabitsModId      = uid();
  const bookDeepWorkModId          = uid();
  const bookSapiensModId           = uid();
  const bookThinkingFastSlowModId  = uid();
  const bookMeditationsModId       = uid();
  const bookMansSearchModId        = uid();
  const book4HourWorkweekModId     = uid();

  // 5 podcast module IDs
  const podcastTimFerrissModId     = uid();
  const podcastLexFridmanModId     = uid();
  const podcastHardcoreHistoryModId = uid();
  const podcastHubermanLabModId    = uid();
  const podcastConvosTylerModId    = uid();

  // 4 course module IDs
  const courseAlgorithmsModId      = uid();
  const courseMLSpecModId          = uid();
  const courseSystemDesignModId    = uid();
  const courseIntroPhilosophyModId = uid();

  // 10 person module IDs (task #46, 2026-05-22)
  const personAvaModId       = uid();
  const personBenModId       = uid();
  const personChloeModId     = uid();
  const personDevenModId     = uid();
  const personEliseModId     = uid();
  const personFelixModId     = uid();
  const personGraceModId     = uid();
  const personHenryModId     = uid();
  const personIsabelModId    = uid();
  const personJackModId      = uid();
  // (People page + table + profile-card IDs removed 2026-07-25 — People is a
  // BOARD now; person occurrences parent under the People board container.)

  // Week View / Month View pages REMOVED (2026-05-24). Per user direction:
  // "just have schedule. (not a specific week view or specific month view
  // page). just have the operation let me use schedule with the filters
  // to spin up days." The Schedule page's `Schedule: Build Schedule` op
  // already handles single/multi-day rendering driven by the active
  // filter's period count.

  // Call People task + tracker + goal (task #46 extension 2026-05-23)
  // - callPersonTaskModId — instance template for "Call Person" task.
  //   Carries `peopleAssigned` field + dateFieldId + completedFieldId.
  // - phoneCallsFieldId — array display field (table columns: name + slot).
  // - callPeopleGoalModId — instance under physGoalContOccId that shows
  //   both a scalar "Phone Calls" counter (target=2) and the array.
  const callPersonTaskModId   = uid();
  const phoneCallsFieldId     = uid();
  const totalPhoneCallsFieldId = uid();
  const callPeopleGoalModId   = uid();

  // Library folder ID
  const libraryFolderId = uid();

  // Journal Q&A field IDs — pre-generated so siblingLinks can reference them at definition time
  const journalQuestionFieldId = uid();
  const journalAnswerFieldId   = uid();

  // 100 philosophical/spiritual reflection questions (library "question" type).
  // Tagged in comments by tradition/thinker so it's clear what each draws from;
  // the tag is NOT stored — only the label is. The Daily Question Rotator op
  // (and the Daily Question container's header dropdown via journalQuestion's
  // find-mode optionsSource) picks one of these labels at runtime.
  const PHIL_QUESTIONS = [
    // Stoicism (1–10)
    "What is within my control today, and what is not?",
    "How would I act if I knew today were my last?",
    "Which virtue did I practice today — wisdom, justice, courage, or temperance?",
    "What obstacle is actually showing me the way forward?",
    "Did I respond to events with my mind, or did my emotions decide?",
    "Whose opinion am I letting decide my peace today?",
    "What discomfort could I welcome instead of avoid?",
    "If I lost everything I'm anxious about, what would still remain?",
    "Is the thing I'm angry about a fact, or my judgment about it?",
    "How am I making things harder than they need to be?",
    // Daoism (11–18)
    "Where am I forcing what wants to flow?",
    "What would today look like if I did nothing — and what would actually fall apart?",
    "What am I emptying out to make room for what's next?",
    "Where in life am I the rigid tree that breaks instead of the bamboo that bends?",
    "What unspoken rhythm is the world inviting me to follow?",
    "Where am I trying to grasp water with a closed fist?",
    "What is the gentle thing I keep underestimating today?",
    "Where does the path appear only because I'm willing to stop searching?",
    // Inner Alchemy (19–23)
    "What lead in me is asking to be turned into gold today?",
    "What am I refining inside the vessel of this body right now?",
    "Which of my reactions today was a chance to transmute, not just survive?",
    "What heat am I willing to sit in for the sake of becoming?",
    "Where is the wound that's also the doorway?",
    // Alan Watts (24–28)
    "Am I the wave or the water today?",
    "What if I stopped trying to get somewhere and just listened?",
    "What would I do if money, time, and approval were not the question?",
    "Where am I confusing the menu for the meal?",
    "If I am the universe experiencing itself, what is the universe up to through me right now?",
    // Carl Jung (29–36)
    "What shadow showed up today, and what did it want me to see?",
    "Where am I projecting onto someone else what is actually mine?",
    "What dream image keeps returning, and what is it asking?",
    "Which archetype is moving through me this week — hero, lover, sage, fool?",
    "Where am I refusing the gold hidden in what I despise about myself?",
    "What synchronicity am I treating as coincidence?",
    "What part of me is hungry to be witnessed without judgment?",
    "Where is my persona protecting me, and where is it suffocating me?",
    // Esoteric Christianity (37–41)
    "What inside me is ready to be crucified so something deeper can rise?",
    "Where am I waiting for grace that has already been given?",
    "What does the word neighbor really ask of me today?",
    "Where in my heart is the kingdom hidden, unrecognized?",
    "What forgiveness — given or received — is the work of this moment?",
    // Zen (42–48)
    "What is the sound of my own attention right now?",
    "Who is the one asking these questions?",
    "Where am I confusing the moon with the finger pointing at it?",
    "What is unshakable in me, even amid this?",
    "What am I missing because I expect it to look familiar?",
    "Where is trying to be still louder than stillness itself?",
    "What ordinary thing today is also a teaching?",
    // Mindfulness (49–53)
    "What sensation am I avoiding feeling fully?",
    "Where am I rehearsing the past or auditioning the future?",
    "What does right now actually smell, sound, and taste like?",
    "What is my breath asking me to notice?",
    "Where am I performing presence instead of being present?",
    // Omnism (54–56)
    "What truth from a tradition I'm not from is calling me lately?",
    "Where do the world's wisdoms agree, and how am I living that agreement?",
    "Which voice — religious, secular, ancestral — am I dismissing too quickly?",
    // Philosopher's Stone (57–60)
    "What is the prima materia of my life right now — what raw stuff am I working with?",
    "What in me has been fixed too long and needs to dissolve?",
    "What in me has been dissolved too long and needs to crystallize?",
    "What is the marriage of opposites my soul is asking for?",
    // Mythology / Joseph Campbell (61–68)
    "Where am I in the hero's journey — call, threshold, ordeal, return?",
    "What call am I refusing today?",
    "Who is the mentor my life has quietly placed in front of me?",
    "What treasure am I being asked to bring back from the underworld?",
    "Which myth feels like it is living me right now?",
    "What dragon am I refusing to talk to instead of fight?",
    "Where is my bliss really pointing me?",
    "What story have I been telling about myself that I'm ready to let end?",
    // Synchronicity (69–73)
    "What pattern keeps surfacing that I have not yet honored?",
    "Which coincidence today felt addressed to me?",
    "What did the world rhyme with this week, and what was the rhyme saying?",
    "Where am I in the right place at the right time and pretending I'm not?",
    "What did I miss because I dismissed it as random?",
    // Symbolism (74–78)
    "If today were a tarot card, which one would it be — and why?",
    "What is the dominant image in my mind today, and what does it carry?",
    "Which color, animal, or weather has been with me lately?",
    "What number, name, or place keeps showing up?",
    "What was the metaphor the day kept offering me?",
    // Native American Wisdom (79–83)
    "Whom — human or non-human — did I treat as kin today?",
    "Where am I taking from the earth and forgetting to give back?",
    "What is the seventh-generation cost of what I'm choosing today?",
    "Whose stories am I carrying, and whose am I ignoring?",
    "What does the place I live want me to remember about it?",
    // Ram Dass (84–88)
    "Where am I right now?",
    "Whose suffering today is also mine?",
    "What am I clinging to that is keeping me from loving?",
    "Where would love show up if I let it?",
    "What would change if I treated the person in front of me as the divine in disguise?",
    // Krishnamurti (89–93)
    "Can I observe my mind today without naming what I see?",
    "What thought am I taking as truth that I have never really examined?",
    "Where am I conforming and calling it choosing?",
    "What is the conditioning behind my reaction?",
    "Can I look at this fear without making it a problem to solve?",
    // Thich Nhat Hanh (94–97)
    "What in this moment is already enough?",
    "Whose face am I forgetting to look at carefully?",
    "What suffering — mine or another's — is asking to be held with tenderness?",
    "What is one small breath I could take to come home to myself?",
    // Eckhart Tolle (98–100)
    "Where is my pain-body running the show right now?",
    "What problem dissolves when I bring full presence to it?",
    "Who would I be without the story I'm telling about myself?",
    // Terence McKenna (101–105)
    "What does my imagination know that my reason has not caught up to?",
    "If language is a virus and I am its host, what story am I helping to spread today?",
    "Where in my life would a little more novelty crack the trance open?",
    "What plant, place, or practice keeps trying to talk to me?",
    "What if the felt sense of right now is more real than any theory about it?",
    // Progressive politics / solidarity (106–111)
    "Whose dignity does my comfort depend on going unseen?",
    "Who profits when I am too tired or distracted to care?",
    "What would it mean to think as a we, not just an I, today?",
    "What injustice am I tolerating because it would cost me to name it?",
    "Where is solidarity asking more of me than charity ever could?",
    "What policy or structure shapes my day more than my willpower does?",
    // Freedom from oppression (112–117)
    "Where am I free, and where have I forgotten that I am not yet?",
    "Whose voice was silenced for my comfort, and how can I amplify it?",
    "What kind of liberation am I willing to want for others that I want for myself?",
    "What internalized rule have I mistaken for my own truth?",
    "What does my body know about safety that my mind keeps overriding?",
    "Where is the line between minding my own peace and looking away?",
  ];
  const phQuestionModIds = PHIL_QUESTIONS.map(() => uid());

  // Time slots — needed for buildScheduleFilters' timeslotLabels; later tasks
  // also use timeSlots for the schedule subtree, so hoist here to mirror
  // createTestGrid's pattern.
  const timeSlots      = generateTimeSlots();
  const timeslotLabels = timeSlots.map(s => s.label);

  // ── STEP 1: Grid ────────────────────────────────────────────────────────────
  // buildGridDoc returns a plain object; caller wraps with `new Grid(...)`.
  // activeFilterValues left empty — client resolves to local-tz today on load.
  const grid = new Grid(buildGridDoc({ userId, gridName, manifestId, dateFieldId }));
  await grid.save();
  const gridId = grid._id.toString();

  // ── mkOcc helper ────────────────────────────────────────────────────────────
  // Mirrors createTestGrid exactly. Unused by the scaffold itself but included
  // now so every downstream task (7–14) can use it without adding it piecemeal.
  async function mkOcc(data) {
    const id = data.id || uid();
    const doc = new Occurrence({
      id, userId, gridId,
      timestamp: new Date(),
      fields: {}, meta: {}, hidden: false,
      ...data,
    });
    await doc.save();
    return id;
  }

  // ── STEP 2: Fields ──────────────────────────────────────────────────────────
  //
  // Ported from createDefaultUserData STEP 1 with these transforms applied:
  //
  // EXCLUDED (journal/QA/enrichment-exclusive — evidence in comments):
  //   journalQuestionPool   — WIRED (Feature C): philosophical reflection question pool seeded (see PHIL_QUESTIONS)
  //                            in the Library container with library:"question"; siblingLinks
  //                            wired on journalQuestion/Answer; Daily Question Rotator op added.
  //   wentWellQuestion      — bound only to journalDocInstances.wentWellDocInst
  //   wentWellAnswer        — bound only to journalDocInstances.wentWellDocInst
  //   improvedQuestion      — bound only to journalDocInstances.improvedDocInst
  //   improvedAnswer        — bound only to journalDocInstances.improvedDocInst
  //   gratitudeQuestion     — bound only to journalDocInstances.gratitudeDocInst
  //   gratitudeAnswer       — bound only to journalDocInstances.gratitudeDocInst
  //   watchItem             — pool-select bound only to enrichmentInstances.actWatch
  //   readItem              — pool-select bound only to enrichmentInstances.actRead
  //   listenItem            — pool-select bound only to enrichmentInstances.actListen
  //   playItem              — pool-select bound only to enrichmentInstances.actPlay
  //   roomItem              — pool-select bound only to enrichmentInstances.actDoRoom
  //   cbtItem               — pool-select bound only to enrichmentInstances.actCBT
  //   bookmarkItem          — pool-select bound only to enrichmentInstances.actBookmark
  //   listType              — select bound only to enrichmentInstances (actWatch/Read/Listen/Play)
  //
  // KEPT DESPITE JOURNAL ADJACENCY:
  //   journalQuestion       — also bound to the old toolkit journaling instance (rotator now targets the Journal action) (kept)
  //   journalAnswer         — also bound to the old toolkit journaling instance (rotator now targets the Journal action) (kept)
  //
  // POOL→TEXT conversions (type:"select" + meta.sourceType:"pool" → type:"text"):
  //   None needed after exclusions — all pool-backed selects were enrichment-exclusive
  //   and got excluded above. Remaining selects are real enum selects (mood, muscleGroup,
  //   mealCategory, accountSelect, category, listType excluded; readingList/podcastTitle/bookTitle/movieTitle removed — replaced by occurrence-type fields).
  //   watchlist was removed: watchMovie now uses moviesWatchedFieldId (occurrence-type, live library).
  //
  // SCHEDULE CONTROL FIELD RECONCILIATION (scaffold pre-generated ids → seed names):
  //   dateFieldId      ← fields.date ("Date", date)        [createDefaultUserData uses same id pattern]
  //   timeslotFieldId  ← fields.timeslot ("Time Slot", text) [createDefaultUserData uid()→ override to timeslotFieldId]
  //   dueFieldId       ← fields.due ("Due", date)           [createDefaultUserData uid()→ override to dueFieldId]
  //   completedFieldId ← fields.completed ("Completed", boolean) [override to completedFieldId]
  //   These four ids are referenced by Tasks 13+ op-wiring (makeTrackerOp, makeScheduleBuildDayOp, etc.)
  //   and must match the scaffold's pre-generated values.

  // ── Option-board dropdown fields (2026-07-25, nine-dimensions rebuild) ─────
  // One occurrence-type picker per option board (some query SEVERAL boards via
  // an OR group). All follow the peopleAssigned/moviesWatched find-mode shape,
  // scoped on the boardCategory tag + never listing feed copies (a copy
  // carries the same tag as its source — without the exclusion every option
  // would appear twice). addNew is patched post-create once the board
  // container occurrences exist: single-board fields get parentOccurrenceId,
  // multi-board fields get targets[] (candidate parent occ ids, first =
  // default — consumed by the select-an-occurrence chooser).
  const boardFindSource = (tags) => ({
    mode: "find",
    over: "$allInstances",
    predicate: {
      operator: "AND",
      rules: [
        tags.length === 1
          ? { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: tags[0] }
          : { operator: "OR", rules: tags.map(t => ({ left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: t })) },
        { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
      ],
    },
    valuePath: "id",
    labelPath: "label",
    addNew: { parentOccurrenceId: null }, // patched post-create (see the boards section)
  });
  // [key, field name, tags queried, multiSelect]. Reused fields NOT minted
  // here: People (peopleAssigned), Account (accountRef), Project (repointed
  // above), Course (Courses Taken).
  const BOARD_DROPDOWN_FIELD_DEFS = [
    ["mealPick",       "Meal",             ["meal"],                                                                    false],
    ["ingredient",     "Ingredient",       ["ingredient", "grocery"],                                                   true],
    ["purchaseItem",   "Purchase Item",    ["grocery", "wishlist", "ingredient", "supplement", "equipment", "plant", "gift"], true],
    ["beverage",       "Beverage",         ["beverage"],                                                                false],
    ["supplement",     "Supplement",       ["supplement"],                                                              true],
    // Movement is multiSelect so Workout Program recipes can carry several
    // movements (Push Day A = Bench Press + Incline Press + …); an Exercise
    // log just picks one.
    ["movement",       "Movement",         ["movement"],                                                                true],
    ["workoutProgram", "Workout Program",  ["program"],                                                                 false],
    ["route",          "Route",            ["route"],                                                                   false],
    ["reading",        "Reading",          ["reading", "verse"],                                                        false],
    ["mediaPick",      "Media",            ["media", "song", "course"],                                                 false],
    ["practice",       "Practice",         ["practice"],                                                                false],
    ["prompt",         "Prompt",           ["prompt"],                                                                  false],
    ["leisureActivity","Leisure Activity", ["leisure"],                                                                 false],
    ["skill",          "Skill",            ["skill", "song"],                                                           false],
    ["topic",          "Topic",            ["topic"],                                                                   false],
    ["wishListItem",   "Wish List Item",   ["wishlist"],                                                                false],
    ["savingsGoalPick","Savings Goal",     ["savingsGoal", "wishlist"],                                                 false],
    ["charity",        "Charity",          ["charity"],                                                                 false],
    ["place",          "Place",            ["place"],                                                                   false],
    ["eventPick",      "Event",            ["event"],                                                                   false],
    ["giftIdea",       "Gift Idea",        ["gift"],                                                                    false],
    ["area",           "Area",             ["area"],                                                                    false],
    ["equipment",      "Equipment",        ["equipment"],                                                               false],
    ["plant",          "Plant",            ["plant"],                                                                   false],
    ["medium",         "Medium",           ["medium"],                                                                  false],
    ["song",           "Song",             ["song"],                                                                    false],
    ["verse",          "Verse",            ["verse"],                                                                   false],
    ["gratitudeEntry", "Gratitude Entry",  ["gratitude"],                                                               false],
    ["win",            "Win",              ["win"],                                                                     false],
    ["idea",           "Idea",             ["idea", "prompt"],                                                          false],
    ["creativeWork",   "Creative Work",    ["creativeWork", "project"],                                                 false],
  ];
  const boardDropdownFields = {};
  for (const [key, name, tags, multiSelect] of BOARD_DROPDOWN_FIELD_DEFS) {
    boardDropdownFields[key] = {
      id: uid(),
      name,
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.boards,
      meta: { multiSelect, optionsSource: boardFindSource(tags) },
    };
  }

  const fields = {
    // ── OPTION-BOARD FIELDS (2026-07-25) ─────────────────────────────────────
    // The scoping tag every option instance carries. Board CONTAINER
    // occurrences carry their own tag value too — the addNew flow reads the
    // chosen parent's value at run time and stamps it on the new option.
    boardCategory: {
      id: boardCategoryFieldId,
      name: "Board Category",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.boards,
      meta: {
        multiSelect: false,
        options: ["meal","ingredient","grocery","beverage","supplement","movement","route","reading","media",
                  "practice","prompt","leisure","project","skill","topic","wishlist","charity","place","area",
                  "equipment","plant","medium","song","person","program","course","event","gift","verse",
                  "gratitude","win","idea","savingsGoal","creativeWork"],
      },
    },
    ...boardDropdownFields,

    // ── SCHEDULE CONTROL (4 canonical fields; ids from scaffold pre-gen) ─────
    // These shapes mirror createTestGrid STEP 2 exactly.
    completed: {
      id: completedFieldId,
      name: "Completed",
      type: "boolean",
      inputEnabled: true,
      displayEnabled: false,
      meta: { variant: "switch", defaultValue: false },
      folderId: fieldCategoryIds.scheduling,
    },
    date: {
      id: dateFieldId,
      name: "Date",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.scheduling,
    },
    timeslot: {
      id: timeslotFieldId,
      name: "Time Slot",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.scheduling,
      // Dropdown surfaces all 48 generated slot labels so users can
      // reassign a task's slot inline. Null/unset = Due (no slot).
      // Picking a slot here triggers Schedule: Build Day's slot
      // multi-parent routing on the next op fire.
      meta: {
        optionsSource: {
          mode: "manual",
          values: timeslotLabels.map((label) => ({ value: label, label })),
        },
      },
    },
    due: {
      id: dueFieldId,
      name: "Due",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
      folderId: fieldCategoryIds.scheduling,
    },
    // lastSeen: stamped on every schedule-drop by Schedule: Stamp Date & Time
    // Slot (extended in liveSystemBuilders.makeStampDateTimeSlotOp). Renders
    // on occurrence-select chips (e.g. Movies Watched: "Inception · 2026-05-19")
    // so the user can see when each option was last added to schedule.
    lastSeen: {
      id: lastSeenFieldId,
      name: "Last Seen",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
      folderId: fieldCategoryIds.scheduling,
    },
    // scheduleFormat: stamped on every Schedule day-column container.
    // "timeslot" = ≤7-day view (slot containers visible inside); "shortened" =
    // >7-day view (flat day-col, no slots, wrapped horizontal layout).
    // PageBoard reads this field to pick the layout; Build Schedule
    // inflates/deflates each format based on $activePeriodCount.
    scheduleFormat: {
      id: scheduleFormatFieldId,
      name: "Schedule Format",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        optionsSource: { mode: "manual", options: ["timeslot", "shortened"] },
      },
      folderId: fieldCategoryIds.scheduling,
    },
    // ── BILL SCHEDULE FIELDS ──────────────────────────────────────────────────
    // Used by bill instances in the Bills page (see Phase B3). Together they
    // describe a recurring schedule. `Bill: Compute Next Due` reads these and
    // writes `billNextDue` to the bill. `Schedule Due: Seed` then COPY_LINKs
    // Pay Bill tasks into Schedule's Due container when billNextDue falls in
    // the active window.
    billCadence: {
      id: billCadenceFieldId,
      name: "Cadence",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        optionsSource: {
          mode: "manual",
          options: ["weekly", "biweekly", "monthly", "quarterly", "yearly", "every-n-days"],
        },
      },
      folderId: fieldCategoryIds.bills,
    },
    billDay: {
      id: billDayFieldId,
      // For monthly/quarterly/yearly: day-of-month (1-31).
      // For weekly/biweekly: day-of-week (1=Mon, 7=Sun).
      // Ignored for every-n-days (use billCadenceN + billAnchor).
      name: "Day",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { min: 1, max: 31, increment: 1 },
      folderId: fieldCategoryIds.bills,
    },
    billCadenceN: {
      id: billCadenceNFieldId,
      name: "Every N Days",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { min: 1, increment: 1 },
      folderId: fieldCategoryIds.bills,
    },
    billAnchor: {
      id: billAnchorFieldId,
      name: "Anchor Date",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.bills,
    },
    billNextDue: {
      // Computed by Bill: Compute Next Due. User-editable as override.
      id: billNextDueFieldId,
      name: "Next Due",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.bills,
    },
    // ── REFERENCE FIELDS (occurrence-type, find-mode) ──
    // accountRef: any task whose `amount` field is set can point at the
    // account the money came from / went to. Resolves to account instance
    // labels via find-mode predicate at render time.
    accountRef: {
      id: accountRefFieldId,
      name: "Account",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        // Find any instance under the Accounts page. parentOccurrenceId is
        // patched after the Accounts page is created (see post-seed patch).
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          // Filled in after accounts page occurrence id is known.
          predicate: { conjunction: "AND", rules: [] },
          valuePath: "id",
          labelPath: "label",
        },
      },
      folderId: fieldCategoryIds.refs,
    },
    // billRef: used by the Pay Bill task to select WHICH bill to pay.
    billRef: {
      id: billRefFieldId,
      name: "Bill",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: { conjunction: "AND", rules: [] },
          valuePath: "id",
          labelPath: "label",
        },
      },
      folderId: fieldCategoryIds.refs,
    },
    // subscriptionRef: used by Cancel Subscription. Same shape as billRef
    // but predicate gets scoped to the Subscriptions container.
    subscriptionRef: {
      id: subscriptionRefFieldId,
      name: "Subscription",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: { conjunction: "AND", rules: [] },
          valuePath: "id",
          labelPath: "label",
        },
      },
      folderId: fieldCategoryIds.refs,
    },

    // ── GENERAL INPUT FIELDS ──────────────────────────────────────────────────
    duration: {
      id: uid(),
      name: "Duration",
      type: "duration",
      inputEnabled: true,
      displayEnabled: false,
      meta: { flow: "in" },
    },
    priority: {
      id: uid(),
      name: "Priority",
      type: "rating",
      inputEnabled: true,
      displayEnabled: false,
      meta: { max: 5 },
    },
    notes: {
      id: uid(),
      name: "Notes",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Add notes..." },
    },
    amount: {
      id: uid(),
      name: "Amount",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      // flowToggle: the compact pill renders the green/blue/red in/replace/out
      // side-button (2026-07-11) — the amount's flow decides whether it adds,
      // subtracts, or RESETS a balance (Set Account Balance + supportsReplace).
      meta: { prefix: "$", postfix: "", increment: 5, flow: "out", flowToggle: true },
    },
    income: {
      id: uid(),
      name: "Income",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { prefix: "$", postfix: "", increment: 10, flow: "in" },
    },
    calories: {
      id: uid(),
      name: "Calories",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { postfix: " cal", increment: 50, flow: "in" },
    },
    steps: {
      id: uid(),
      name: "Steps",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { postfix: " steps", increment: 500, flow: "in" },
    },
    water: {
      id: uid(),
      name: "Water",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { postfix: " oz", increment: 8, flow: "in" },
    },
    // Tags — generic multi-select label field (2026-07-12). Bind it to ANY
    // occurrence (textblocks included) and a feed condition "Tags CONTAINS x"
    // collects the tagged occurrences onto another page. allowNewOptions lets
    // the pill mint new tag values inline (persisted onto the field).
    tags: {
      id: uid(),
      name: "Tags",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        allowNewOptions: true,
        options: [
          { value: "journal", label: "journal" },
          { value: "idea",    label: "idea" },
          { value: "todo",    label: "todo" },
          { value: "health",  label: "health" },
          { value: "work",    label: "work" },
        ],
      },
    },
    mood: {
      id: uid(),
      name: "Mood",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        options: [
          // Joy family
          { value: "joyful",        label: "Joyful" },
          { value: "happy",         label: "Happy" },
          { value: "content",       label: "Content" },
          { value: "cheerful",      label: "Cheerful" },
          { value: "proud",         label: "Proud" },
          { value: "optimistic",    label: "Optimistic" },
          { value: "playful",       label: "Playful" },
          { value: "excited",       label: "Excited" },
          // Trust family
          { value: "trusting",      label: "Trusting" },
          { value: "accepting",     label: "Accepting" },
          { value: "peaceful",      label: "Peaceful" },
          { value: "serene",        label: "Serene" },
          { value: "grateful",      label: "Grateful" },
          // Fear family
          { value: "anxious",       label: "Anxious" },
          { value: "scared",        label: "Scared" },
          { value: "worried",       label: "Worried" },
          { value: "nervous",       label: "Nervous" },
          { value: "insecure",      label: "Insecure" },
          // Surprise family
          { value: "surprised",     label: "Surprised" },
          { value: "amazed",        label: "Amazed" },
          { value: "confused",      label: "Confused" },
          { value: "stunned",       label: "Stunned" },
          // Sadness family
          { value: "sad",           label: "Sad" },
          { value: "lonely",        label: "Lonely" },
          { value: "disappointed",  label: "Disappointed" },
          { value: "depressed",     label: "Depressed" },
          { value: "hopeless",      label: "Hopeless" },
          { value: "guilty",        label: "Guilty" },
          // Disgust family
          { value: "disgusted",     label: "Disgusted" },
          { value: "disapproving",  label: "Disapproving" },
          { value: "bored",         label: "Bored" },
          // Anger family
          { value: "angry",         label: "Angry" },
          { value: "frustrated",    label: "Frustrated" },
          { value: "irritated",     label: "Irritated" },
          { value: "annoyed",       label: "Annoyed" },
          { value: "resentful",     label: "Resentful" },
          { value: "jealous",       label: "Jealous" },
          // Anticipation family
          { value: "anticipating",  label: "Anticipating" },
          { value: "interested",    label: "Interested" },
          { value: "curious",       label: "Curious" },
          { value: "eager",         label: "Eager" },
          // Neutral/Other
          { value: "neutral",       label: "Neutral" },
          { value: "tired",         label: "Tired" },
          { value: "stressed",      label: "Stressed" },
          { value: "overwhelmed",   label: "Overwhelmed" },
          { value: "calm",          label: "Calm" },
          { value: "focused",       label: "Focused" },
        ],
      },
    },
    energy: {
      id: uid(),
      name: "Energy",
      type: "rating",
      inputEnabled: true,
      displayEnabled: false,
      meta: { max: 5 },
    },
    pages: {
      id: uid(),
      name: "Pages",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: { postfix: " pages", increment: 5, flow: "in" },
    },

    // ── SELECT FIELDS (kept — real enum selects, not pool-backed) ────────────
    movieRating: {
      id: uid(),
      name: "Rating",
      type: "rating",
      inputEnabled: true,
      displayEnabled: false,
      meta: { max: 5 },
    },
    lastWatched: {
      id: uid(),
      name: "Last Watched",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
    },

    // Library system — mirrors createTestGrid STEP 2 exactly.
    // `library` tags each instance as "movie" / "book" / "tv show".
    // `moviesWatched` is an occurrence-type field (multiSelect) whose options are
    // dynamically resolved from $allInstances where fields.library.value IS "movie".
    // addNew.parentOccurrenceId is patched to libraryContOccId after occurrences
    // are minted (can't set at insertMany time — occIds not known yet).
    library: {
      id: libraryFieldId,
      name: "Library",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { options: ["movie", "book", "tv show", "podcast", "course", "question", "person"], multiSelect: false },
    },
    moviesWatched: {
      id: moviesWatchedFieldId,
      name: "Movies Watched",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "movie" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          // Selected-chip display — shows just the library tag on chips.
          // No media yet (movies don't have posters seeded); label + tag is
          // enough to disambiguate.
          chipDisplay: {
            showLabel: true,
            showMedia: false,
            fieldIds: [libraryFieldId],
          },
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "movie", flow: "in" } },
          },
        },
      },
    },
    moviesWatchedDisplay: {
      id: moviesWatchedDisplayFieldId,
      name: "Movie History",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      // Columns expanded 2026-05-22 (task #29): added timeslot + date so the
      // array conveys WHEN. Same pattern for books/podcasts/courses below.
      displayConfig: {
        // Rich cells: poster = media thumbnail, label = occurrence chip
        // (click-to-jump to the Library movie). timeslot/date stay scalar.
        columns: [
          { path: "poster",   header: "",      width: 44 },
          { path: "label",    header: "Movie" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },

    // ── Media per-type "last" scalars (Stage 3 Media split) ──────────────────
    // last = most-recent title; paired with the *Display rows arrays to form
    // last + history per type.
    lastMovieDisplay: {
      id: lastMovieFieldId, name: "Last Movie", type: "text",
      inputEnabled: false, displayEnabled: true, meta: {},
    },
    lastBookDisplay: {
      id: lastBookFieldId, name: "Last Book", type: "text",
      inputEnabled: false, displayEnabled: true, meta: {},
    },
    lastPodcastDisplay: {
      id: lastPodcastFieldId, name: "Last Podcast", type: "text",
      inputEnabled: false, displayEnabled: true, meta: {},
    },

    // Books Read — occurrence-type field; options sourced from library instances with type "book".
    booksRead: {
      id: booksReadFieldId,
      name: "Books Read",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "book" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          // Selected-chip display config (consumed by Field.jsx's
          // OccurrenceOption). Show the book's page count + library
          // category on each selected chip — demos the new
          // chip-display config UI added in command-center FieldsTab.
          chipDisplay: {
            showLabel: true,
            showMedia: true,  // Link2 placeholder for now; once book covers are added, posters render.
            fieldIds: [pagesFieldId, libraryFieldId],
          },
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "book", flow: "in" } },
          },
        },
      },
    },
    booksReadDisplay: {
      id: booksReadDisplayFieldId,
      name: "Book History",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        // Rich cells: poster = cover thumbnail, label = occurrence chip
        // (click-to-jump to the Library book). pages/timeslot/date stay scalar.
        columns: [
          { path: "poster",   header: "",      width: 44 },
          { path: "label",    header: "Book" },
          { path: "pages",    header: "Pages", width: 70 },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    // Pages field — number of pages in a book (hidden on instances, used by Books Read tracker)
    pages: {
      id: pagesFieldId,
      name: "Pages",
      type: "number",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
    },

    // Poster URL — text field that holds an absolute image URL (or upload
    // fileRef). Bound on library entry modules with role:"media" so the
    // ModuleInstance media block renders it as a cover image below the
    // label. ModuleInstance auto-detects http(s):// vs fileRef and routes
    // src correctly (see "Strip query string..." block in ModuleInstance).
    posterUrl: {
      id: posterUrlFieldId,
      name: "Poster",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
    },

    // Podcasts Listened — occurrence-type field; options sourced from library instances with type "podcast".
    podcastsListened: {
      id: podcastsListenedFieldId,
      name: "Podcasts Listened",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "podcast" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "podcast", flow: "in" } },
          },
        },
      },
    },
    podcastsListenedDisplay: {
      id: podcastsListenedDisplayFieldId,
      name: "Podcast History",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label",    header: "Podcast" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },

    // Courses Taken — occurrence-type field; options sourced from library instances with type "course".
    coursesTaken: {
      id: coursesTakenFieldId,
      name: "Courses Taken",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "course" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "course", flow: "in" } },
          },
        },
      },
    },
    coursesTakenDisplay: {
      id: coursesTakenDisplayFieldId,
      name: "Course History",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label",    header: "Course" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    // ── PEOPLE LIBRARY FIELDS (task #46, 2026-05-22) ──────────────────────
    // Profile fields stamped on each Person occurrence in the Library
    // container (library:"person"). Notes is a longer markdown field.
    // peopleAssigned is the multi-select used on tasks like Call/Email/Text.
    personName: {
      id: personNameFieldId,
      name: "Name",
      type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personEmail: {
      id: personEmailFieldId,
      name: "Email",
      type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personPhone: {
      id: personPhoneFieldId,
      name: "Phone",
      type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personGender: {
      id: personGenderFieldId,
      name: "Gender",
      type: "select",
      inputEnabled: true, displayEnabled: true,
      meta: { options: ["female", "male", "non-binary", "other", "prefer not to say"], multiSelect: false },
    },
    personNotes: {
      id: personNotesFieldId,
      name: "Person Notes",
      type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { multiline: true }, displayConfig: {},
    },
    // ── Extended profile fields (#46, 2026-05-23) ─────────────────────
    personBirthday: {
      id: personBirthdayFieldId, name: "Birthday", type: "date",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personAddress: {
      id: personAddressFieldId, name: "Address", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { multiline: true }, displayConfig: {},
    },
    personCity: {
      id: personCityFieldId, name: "City", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personCompany: {
      id: personCompanyFieldId, name: "Company", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personJobTitle: {
      id: personJobTitleFieldId, name: "Job Title", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personRelationship: {
      id: personRelationshipFieldId, name: "Relationship", type: "select",
      inputEnabled: true, displayEnabled: true,
      meta: { options: ["family", "close friend", "friend", "colleague", "acquaintance", "neighbor", "mentor", "client", "other"], multiSelect: false },
    },
    personWebsite: {
      id: personWebsiteFieldId, name: "Website", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personInstagram: {
      id: personInstagramFieldId, name: "Instagram", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { prefix: "@" }, displayConfig: {},
    },
    personTwitter: {
      id: personTwitterFieldId, name: "Twitter / X", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { prefix: "@" }, displayConfig: {},
    },
    personLinkedIn: {
      id: personLinkedInFieldId, name: "LinkedIn", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personLastContact: {
      id: personLastContactFieldId, name: "Last Contact", type: "date",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personFavoriteFood: {
      id: personFavoriteFoodFieldId, name: "Favorite Food", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    personAllergies: {
      id: personAllergiesFieldId, name: "Allergies", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { multiline: true }, displayConfig: {},
    },
    personInterests: {
      id: personInterestsFieldId, name: "Interests", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { multiline: true }, displayConfig: {},
    },
    personHowMet: {
      id: personHowMetFieldId, name: "How We Met", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: { multiline: true }, displayConfig: {},
    },
    personEmergencyContact: {
      id: personEmergencyContactFieldId, name: "Emergency Contact", type: "text",
      inputEnabled: true, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    // (Show Profile button field removed 2026-07-25 — the People table +
    // profile-card page it drove are gone; People renders as a plain board.)
    peopleAssigned: {
      id: peopleAssignedFieldId,
      name: "People",
      type: "occurrence",
      inputEnabled: true, displayEnabled: false,
      meta: {
        multiSelect: true,
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: {
            conjunction: "AND",
            rules: [
              { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "person" },
            ],
          },
          valuePath: "id",
          labelPath: "label",
          chipDisplay: {
            showLabel: true,
            showMedia: true,
            fieldIds: [personNameFieldId, personEmailFieldId, personPhoneFieldId],
          },
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created (mirrors moviesWatched pattern)
            stampFields: { [libraryFieldId]: { value: "person", flow: "in" } },
          },
        },
      },
    },
    // ── PHONE CALLS DISPLAY (task #46 extension 2026-05-23) ──────────────
    // Array display field — Phone Calls tracker fills with one row per
    // completed Call Person task, in timeslot-anchored order. Columns:
    // person name + timeslot. Multi-day filters also surface a Date col.
    phoneCalls: {
      id: phoneCallsFieldId,
      name: "Phone Calls",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "name",     header: "Person",   width: 140 },
          { path: "timeslot", header: "Time",     width: 90 },
          { path: "date",     header: "Date",     width: 90 },
        ],
      },
    },
    // Scalar counter that pairs with the array — `target: 2` powers
    // the "Call 2 people" progress bar.
    totalPhoneCalls: {
      id: totalPhoneCallsFieldId,
      name: "Total Phone Calls",
      type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: { targetValue: 2, targetPeriod: "daily", showArrows: true },
    },

    // ── PROJECT KANBAN FIELDS ─────────────────────────────────────────────
    // Two new fields for the agile kanban demo (Project: Moduli v1 Launch).
    // status: 6-option select mirroring the kanban column labels. The
    // Status Router op (deferred to a future seed pass) listens for
    // onChange on this field and moves the canonical task occurrence into
    // the matching column container.
    status: {
      id: statusFieldId,
      name: "Status",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        optionsSource: {
          mode: "manual",
          values: [
            "Backburner",
            "Docket",
            "Working On",
            "In Review",
            "Test",
            "Complete",
          ],
        },
      },
    },
    // project: occurrence-ref pointing at a project page. Lets a single
    // Todo List page surface tasks across many projects without
    // ambiguous container ancestry. Find-mode scope: instances whose
    // module label starts with "Project:" — keeps the picker tight.
    project: {
      id: projectFieldId,
      name: "Project",
      type: "occurrence",
      inputEnabled: true,
      displayEnabled: true,
      // Repointed 2026-07-25 (nine-dimensions rebuild): options come from the
      // Projects BOARD (boardCategory:"project") instead of label-matching
      // "Project:" pages. The kanban Status Router never reads this field and
      // no seed value stamps it, so the repoint is behavior-safe; occupational
      // actions (Plan/Build/Code/…) bind it to name what they worked on.
      meta: {
        optionsSource: {
          mode: "find",
          find: {
            over: "$allInstances",
            predicate: {
              operator: "AND",
              rules: [
                { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: "project" },
                { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
              ],
            },
            valuePath: "id",
            labelPath: "label",
          },
          addNew: { parentOccurrenceId: null }, // patched to the Projects board container post-create
        },
      },
    },

    // accountSelect (legacy string-options) removed per B4. accountRef
    // (occurrence-pointer → Accounts page instance) replaces it on every
    // amount-bearing task.

    // ── TEXT INPUT FIELDS ─────────────────────────────────────────────────────
    workoutType: {
      id: uid(),
      name: "Workout",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Workout type..." },
    },
    // (mealDescription free-text "Meal" field removed 2026-07-25 — it was
    // bound nowhere; the name now belongs to the Meals board dropdown.)
    activityDescription: {
      id: uid(),
      name: "Activity",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Describe activity..." },
    },

    // ── JOURNAL Q&A (kept — journalQuestion/Answer also used by toolkit journaling) ──
    // siblingLinks wired bidirectionally — Q&A relationship is explicit in schema.
    // Daily Question Rotator op writes the picked question label to journalQuestion.
    journalQuestion: {
      id: journalQuestionFieldId,
      name: "Daily Question",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      // `randomizable: true` + an `optionsSource.find` pool lets FieldRenderer
      // surface a 🎲 button on the display-only field. The Daily Question
      // Rotator op still drives the value on filter changes; the button is a
      // manual re-roll for "give me a different question right now". valuePath
      // returns the question instance's label, which the rotator op also uses
      // as the written value.
      meta: {
        randomizable: true,
        optionsSource: {
          mode: "find",
          find: {
            over: "$allInstances",
            predicate: {
              conjunction: "AND",
              rules: [
                { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "question" },
              ],
            },
            valuePath: "label",
            labelPath: "label",
          },
        },
      },
      siblingLinks: [], // patched to [journalAnswerFieldId] after fields object is built
    },
    journalAnswer: {
      id: journalAnswerFieldId,
      name: "Answer",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Write your answer..." },
      siblingLinks: [], // patched to [journalQuestionFieldId] after fields object is built
    },

    // ── DISPLAY FIELDS (written by operations) ────────────────────────────────
    totalCompleted: {
      id: uid(),
      name: "Tasks Completed",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      // flow:"in" — counting UP toward target is the "good" direction. Field
      // renders red until value >= targetValue, green at/above. Paired with
      // taskCountdown below (which is the same fact viewed from the other
      // end — flow:"out", target 0, "<=", start 10).
      meta: { prefix: "", postfix: " done", flow: "in" },
      displayConfig: { startValue: 0, targetValue: 10, targetOp: ">=", targetPeriod: "daily" },
    },
    taskCountdown: {
      id: uid(),
      name: "Tasks Left",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      // flow:"out" — the "good" direction is DOWN. UI indicators treat a -1
      // delta as positive (green) for this field. start=10/target=0 makes
      // the progress bar go 0%→100% as the value falls from 10 to 0; same
      // fact as totalCompleted, viewed from the other end.
      meta: { prefix: "", postfix: " left", flow: "out" },
      displayConfig: { startValue: 10, targetValue: 0, targetOp: "<=", targetPeriod: "daily" },
    },
    // Live clock fields — self-update via client-side setInterval in
    // Field.jsx (`useLiveFieldValue`). NO operation, NO socket emit, NO
    // server write per tick — only a local React re-render of mounted
    // instances. Seconds granularity is cheap (one rAF-equivalent per
    // second per mounted pill); switch to "minutes" via meta.liveGranularity
    // if it ever becomes a concern.
    currentTime: {
      id: uid(),
      name: "Now",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: { liveSource: "currentTime", liveGranularity: "seconds", flow: "in" },
      displayConfig: {},
    },
    timeCountdown: {
      id: uid(),
      name: "Time Left",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: { liveSource: "endOfDayCountdown", liveGranularity: "seconds", flow: "out" },
      displayConfig: {},
    },
    totalDuration: {
      id: uid(),
      name: "Time Spent",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " min" },
      displayConfig: {},
    },
    totalSpent: {
      id: uid(),
      name: "Spent",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    totalIncome: {
      id: uid(),
      name: "Earned",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    totalSteps: {
      id: uid(),
      name: "Daily Steps",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " steps" },
      displayConfig: {},
    },
    totalWater: {
      id: uid(),
      name: "Daily Water",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " oz" },
      displayConfig: {},
    },
    lastMood: {
      id: uid(),
      name: "Moods",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      // Array-shaped display — one row per logged mood in the selected period.
      // Tracker: Today's Moods pushes {mood, timeslot, date} rows (task #29 —
      // added timeslot column 2026-05-22; date is helpful when multiday filter
      // is active — single-day filter shows redundant date column but that's
      // a known minor cosmetic trade-off vs hide-on-single-day complexity).
      displayConfig: {
        columns: [
          { path: "mood",     header: "Mood" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    // Single-value "Most Recent Mood" — paired with the Moods array above
    // per task #29. Tracker writes the timeslot-anchored most-recent mood.
    mostRecentMood: {
      id: uid(),
      name: "Last Mood",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {},
    },

    // Vision-vs-now "persistent streaks" — shipped 2026-05-23. Counts the
    // number of consecutive days backward from today where at least one
    // task was completed under Schedule. Computed via the new STREAK_VAR
    // action — no while/break primitive needed.
    currentStreak: {
      id: uid(),
      name: "Current Streak",
      type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " day streak" },
      displayConfig: {
        // Quietly green from the first day so any completion lights up.
        targetValue: 1, targetOp: ">=", targetPeriod: "daily",
      },
    },
    // Personal best — never decreases. The streak tracker MAX's against
    // this on every fire so the badge persists across breaks.
    longestStreak: {
      id: uid(),
      name: "Longest Streak",
      type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { prefix: "🏆 ", postfix: " best" },
      displayConfig: {},
    },

    // Task #29/#54 — Last-X + Array-X pairs for workouts / meals / purchases /
    // pomodoros. Same pattern as mostRecentMood + lastMood: tracker pushes
    // rows into the array AND overwrites the single sink each iteration
    // (timeslot-anchored last entry).

    // Workouts ─────────────────────────────────────────────────────────
    workoutHistory: {
      id: uid(),
      name: "Workouts",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label",    header: "Exercise" },
          { path: "s1",       header: "Set 1" },
          { path: "w1",       header: "Weight 1" },
          { path: "s2",       header: "Set 2" },
          { path: "w2",       header: "Weight 2" },
          { path: "s3",       header: "Set 3" },
          { path: "w3",       header: "Weight 3" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    lastWorkout: {
      id: uid(),
      name: "Last Workout",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {}, displayConfig: {},
    },

    // Meals ────────────────────────────────────────────────────────────
    mealHistory: {
      id: uid(),
      name: "Meals",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label",    header: "Meal" },
          { path: "kcal",     header: "Calories" },
          { path: "protein",  header: "Protein" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    lastMeal: {
      id: uid(),
      name: "Last Meal",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {}, displayConfig: {},
    },

    // Purchases ────────────────────────────────────────────────────────
    purchaseHistory: {
      id: uid(),
      name: "Purchases",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label",    header: "Item" },
          { path: "amount",   header: "Amount" },
          { path: "timeslot", header: "Time" },
          { path: "date",     header: "Date" },
        ],
      },
    },
    lastPurchase: {
      id: uid(),
      name: "Last Purchase",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {}, displayConfig: {},
    },

    // Pomodoros — pomoHistory already exists as the array (see below);
    // add only the single-value sink here to complete the pair.
    lastPomodoro: {
      id: uid(),
      name: "Last Pomodoro",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {}, displayConfig: {},
    },
    totalPages: {
      id: uid(),
      name: "Pages Read",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " pages" },
      displayConfig: {},
    },
    taskCount: {
      id: uid(),
      name: "Task Count",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " tasks" },
      displayConfig: {},
    },

    // ── POMODORO FIELDS ───────────────────────────────────────────────────────
    // Input fields on the Pomodoro Session template instance — copy-linked into
    // a Schedule slot by Pomodoro: Start. pomodoroPhase distinguishes work
    // sessions (which the goal counts) from break sessions (which it ignores).
    pomodoroMinutes: {
      id: uid(),
      name: "Pomodoro Minutes",
      type: "number",
      inputEnabled: true, displayEnabled: false,
      meta: { postfix: " min" },
      displayConfig: {},
    },
    pomodoroNumber: {
      id: uid(),
      name: "Pomodoro #",
      type: "number",
      inputEnabled: true, displayEnabled: false,
      meta: {},
      displayConfig: {},
    },
    pomodoroPhase: {
      id: uid(),
      name: "Pomodoro Phase",
      type: "text",
      inputEnabled: true, displayEnabled: false,
      meta: {},
      displayConfig: {},
    },
    // Display fields on the Pomodoro goal — aggregations from completed
    // pomodoro work sessions.
    pomoCount: {
      id: uid(),
      name: "Pomodoros Today",
      type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " pomos" },
      displayConfig: { targetValue: 3, targetPeriod: "daily", showArrows: true },
    },
    pomoTime: {
      id: uid(),
      name: "Pomodoro Time",
      type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " min" },
      displayConfig: {},
    },
    pomoHistory: {
      id: uid(),
      name: "Pomodoro History",
      type: "text",
      inputEnabled: false, displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "when",    header: "When" },
          { path: "minutes", header: "Minutes" },
          { path: "label",   header: "Note" },
        ],
      },
    },

    // ── ACCOUNT DISPLAY FIELDS (all-time aggregations) ────────────────────────
    // Aggregate field — bound to the Net Worth occurrence. Sums per-account
    // balances. Per the 2026-05-22 account split direction, Checking and
    // Savings each get their OWN balance field (below); netBalance is now
    // reserved for the Net Worth aggregate.
    netBalance: {
      id: uid(),
      name: "Net Worth",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    checkingBalance: {
      id: uid(),
      name: "Checking Balance",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    savingsBalance: {
      id: uid(),
      name: "Savings Balance",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    momsAccountBalance: {
      id: uid(),
      name: "Mom's Account",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    cashBalance: {
      id: uid(),
      name: "Cash",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    totalWorkouts: {
      id: uid(),
      name: "Total Workouts",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " total" },
      displayConfig: {},
    },
    totalReadingTime: {
      id: uid(),
      name: "Reading Time",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " hrs" },
      displayConfig: {},
    },
    completionRate: {
      id: uid(),
      name: "Completion Rate",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: "%" },
      displayConfig: {},
    },

    // ── DUE DATE DISPLAY FIELDS ───────────────────────────────────────────────
    daysUntilDue: {
      id: uid(),
      name: "Days Until Due",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " days" },
      displayConfig: { showArrows: false },
    },
    overdueTasks: {
      id: uid(),
      name: "Overdue Tasks",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " overdue" },
      displayConfig: {},
    },
    upcomingThisWeek: {
      id: uid(),
      name: "Due This Week",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " tasks" },
      displayConfig: {},
    },

    // ── WORKOUT FIELDS ────────────────────────────────────────────────────────
    set1Reps: {
      id: uid(), name: "Set 1", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    set2Reps: {
      id: uid(), name: "Set 2", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    set3Reps: {
      id: uid(), name: "Set 3", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    // Per-set weights (2026-07-14: "add 3 weights too for workouts") — one
    // weight per set, paired with set1/2/3 reps.
    workoutWeight: {
      id: uid(), name: "Weight 1", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " lbs", increment: 5, flow: "in" },
    },
    workoutWeight2: {
      id: uid(), name: "Weight 2", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " lbs", increment: 5, flow: "in" },
    },
    workoutWeight3: {
      id: uid(), name: "Weight 3", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: " lbs", increment: 5, flow: "in" },
    },
    muscleGroup: {
      id: uid(), name: "Muscle Group", type: "select", inputEnabled: true, displayEnabled: false,
      meta: {
        options: [
          { value: "chest",     label: "Chest" },
          { value: "back",      label: "Back" },
          { value: "legs",      label: "Legs" },
          { value: "shoulders", label: "Shoulders" },
          { value: "arms",      label: "Arms" },
          { value: "cardio",    label: "Cardio" },
          { value: "core",      label: "Core" },
        ],
        multiple: false,
      },
    },
    totalRepsToday: {
      id: uid(), name: "Total Reps", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: " reps" },
      displayConfig: { showArrows: true, targetValue: 50, targetPeriod: "daily" },
    },

    // ── NUTRITION FIELDS ──────────────────────────────────────────────────────
    protein: {
      id: uid(), name: "Protein", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: "g", increment: 5, flow: "in" },
    },
    carbs: {
      id: uid(), name: "Carbs", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: "g", increment: 5, flow: "in" },
    },
    fats: {
      id: uid(), name: "Fats", type: "number", inputEnabled: true, displayEnabled: false,
      meta: { postfix: "g", increment: 2, flow: "in" },
    },
    mealCategory: {
      id: uid(), name: "Meal Type", type: "select", inputEnabled: true, displayEnabled: false,
      meta: {
        options: [
          { value: "Breakfast",  label: "Breakfast" },
          { value: "Lunch",      label: "Lunch" },
          { value: "Snack",      label: "Snack" },
          { value: "Dinner",     label: "Dinner" },
          { value: "Ingredient", label: "Ingredient" },
        ],
        multiple: false,
      },
    },
    totalProtein: {
      id: uid(), name: "Total Protein", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalCalories: {
      id: uid(), name: "Total Calories", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: " kcal" }, displayConfig: {},
    },
    totalCarbs: {
      id: uid(), name: "Total Carbs", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalFats: {
      id: uid(), name: "Total Fats", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },

    // ── CATEGORY (hidden iteration-filtering field) ───────────────────────────
    category: {
      id: uid(),
      name: "Category",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        options: [
          "physical", "intellectual", "emotional", "social",
          "spiritual", "occupational", "financial", "environmental",
          "health", "work", "personal", "home", "finance",
        ],
        multiple: false,
      },
      displayConfig: {},
    },

    // ── DAY DATE (date field on day page occurrences; op queries to find today's page) ──
    dayDate: {
      id: uid(),
      name: "Day Date",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
      displayConfig: {},
    },
  };

  // Auto-categorize fields by name pattern so existing fields land in the
  // right command-center category column without touching every single field
  // definition. Explicit folderId set in the definitions above wins (we only
  // fill the missing ones here). Name-based routing is brittle in general,
  // but for the seed it's a one-shot operation against known names.
  const _catRoute = (name) => {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (/(reps|sets?|weight|cardio|muscle|workout|gym|exercise|push|pull|squat|deadlift|run|cycl|jump|burpee)/.test(n)) return fieldCategoryIds.workouts;
    if (/(protein|carb|fat|calor|meal|breakfast|lunch|dinner|snack|nutrition|ingredient|recipe)/.test(n))            return fieldCategoryIds.nutrition;
    if (/(amount|income|spent|earned|budget|salary|balance|finance|expense|investment|net)/.test(n))                  return fieldCategoryIds.finance;
    if (/(water|step|sleep|mood|emotion|gratitude|breath|mindful|stretch|medication|vitamin|drink|wellness|spirit|social)/.test(n)) return fieldCategoryIds.wellness;
    if (/(read|pages?|book|podcast|movie|course|library|study|brain|game|journal)/.test(n))                            return fieldCategoryIds.intellectual;
    if (/(total|count|daily|weekly|monthly|display)/.test(n))                                                           return fieldCategoryIds.display;
    if (/(rating|priority|due|duration|category|select|label|note)/.test(n))                                            return fieldCategoryIds.scheduling;
    return null;
  };
  const _fieldRecords = Object.values(fields).map(f => {
    if (f.folderId) return { ...f, userId, gridId };
    const routed = _catRoute(f.name);
    return { ...f, userId, gridId, ...(routed ? { folderId: routed } : {}) };
  });
  await Field.insertMany(_fieldRecords);

  // Patch siblingLinks bidirectionally for journalQuestion ↔ journalAnswer.
  // Can't set at definition time because each field's id is declared inline and
  // the sibling's id isn't available yet until both are assigned.
  await Field.findOneAndUpdate(
    { id: journalQuestionFieldId },
    { $set: { siblingLinks: [journalAnswerFieldId] } },
  );
  await Field.findOneAndUpdate(
    { id: journalAnswerFieldId },
    { $set: { siblingLinks: [journalQuestionFieldId] } },
  );

  // Register field IDs on grid
  await Grid.findByIdAndUpdate(grid._id, { $set: { fieldIds: Object.values(fields).map(f => f.id) } });

  // ── STEP 3: Instance modules ─────────────────────────────────────────────────
  //
  // Ported from createDefaultUserData STEP 2.
  //
  // EXCLUDED instance sets (journal/QA/enrichment/pool-library):
  //   journalDocInstances   — wentWellDocInst/improvedDocInst/gratitudeDocInst (journal-only)
  //   moviePoolInstances    — movie pool library (excluded; pools brought "in a new way" later)
  //   tvShowPoolInstances   — same
  //   booksPoolInstances    — same
  //   musicPoolInstances    — same
  //   podcastsPoolInstances — same
  //   gamesPoolInstances    — same
  //   activitiesPoolInstances — same
  //   roomsPoolInstances    — same
  //   cbtPoolInstances      — same
  //   bookmarksPoolInstances — same
  //   wentWellQInstances/improvedQInstances/gratitudeQInstances — journal Q&A question
  //     pool REPLACED by library "question" instances (7 seeded in Library container).
  //   enrichmentInstances   — pool-backed enrichment (watchItem/readItem etc. all excluded)
  //   notebookNoteInstancesFlat — notebook sub-heading instances (Task 11)
  //   workoutGoalInstance / nutritionGoalInstance — kept; added as part of goalInstances below
  //
  // KEPT sets: actionInstances (the nine-dimension catalog), workoutInstances
  //            (movement modules), todoInstances, planningInstances,
  //            goalInstances, accountInstances.
  //
  // FIELD MAP NOTE: createDefaultUserData uses `fields.dueDate`; createLiveData uses
  //   `fields.due` (same field, different map key). All `dueDate` refs → `fields.due.id`.
  //
  // DAILY-ROUTINE CONVENTION: routine source instances carry a hidden
  //   `dateFieldId` binding (every ACTION binds it — see the catalog below).
  //   The Daily Routine picks live in routineBySlot (STEP 7b).
  //
  // CATEGORY FIELD: createDefaultUserData injects a hidden category binding on every
  //   instance (line ~1991). Replicated here via the post-loop category injection.

  // ── Nine-dimension ACTION catalog (2026-07-25 rebuild) ──────────────────────
  // One role:"instance" module per granular action (the user's verbatim list
  // + Cook and Buy). Every action binds Completed first, its per-action input
  // fields (board dropdowns + numerics per the design table), and a hidden
  // Date last (the DAILY-ROUTINE CONVENTION — routine sources need the
  // binding; it is uniform + harmless on the rest).
  const bfd = (fieldId, extra = {}) => ({ fieldId, role: "input", ...extra });
  const act = (label, extraBindings = []) => ({
    id: uid(), label, kind: "board", defaultDragMode: "copy",
    fieldBindings: [
      { fieldId: fields.completed.id, role: "input", order: 0 },
      ...extraBindings.map((b, i) => ({ ...b, order: i + 1 })),
      { fieldId: dateFieldId, role: "input", order: 90, hidden: true },
    ],
  });
  // Paired set + weight columns for Exercise / Lift (2026-07-14 convention).
  const setWeightPairs = [
    bfd(fields.set1Reps.id), bfd(fields.workoutWeight.id),
    bfd(fields.set2Reps.id), bfd(fields.workoutWeight2.id),
    bfd(fields.set3Reps.id), bfd(fields.workoutWeight3.id),
  ];
  const actionInstances = {
    // === PHYSICAL ===
    eat:      act("Eat",      [bfd(fields.mealPick.id), bfd(fields.ingredient.id), bfd(fields.calories.id), bfd(fields.protein.id), bfd(fields.carbs.id), bfd(fields.fats.id)]),
    cook:     act("Cook",     [bfd(fields.mealPick.id), bfd(fields.ingredient.id), bfd(fields.duration.id)]),
    drink:    act("Drink",    [bfd(fields.beverage.id), bfd(fields.water.id)]),
    sleep:    act("Sleep",    [bfd(fields.duration.id)]),
    nap:      act("Nap",      [bfd(fields.duration.id)]),
    exercise: act("Exercise", [bfd(fields.workoutProgram.id), bfd(fields.movement.id), ...setWeightPairs]),
    stretch:  act("Stretch",  [bfd(fields.movement.id), bfd(fields.duration.id)]),
    walk:     act("Walk",     [bfd(fields.route.id), bfd(fields.steps.id), bfd(fields.duration.id)]),
    run:      act("Run",      [bfd(fields.workoutProgram.id), bfd(fields.route.id), bfd(fields.steps.id), bfd(fields.duration.id)]),
    lift:     act("Lift",     [bfd(fields.workoutProgram.id), bfd(fields.movement.id), ...setWeightPairs]),
    recover:  act("Recover",  [bfd(fields.supplement.id), bfd(fields.duration.id)]),
    hygiene:  act("Hygiene"),
    groom:    act("Groom"),

    // === EMOTIONAL ===
    journal:    act("Journal",    [bfd(fields.prompt.id), bfd(fields.mood.id)]),
    reflect:    act("Reflect",    [bfd(fields.prompt.id), bfd(fields.duration.id)]),
    meditate:   act("Meditate",   [bfd(fields.practice.id), bfd(fields.duration.id)]),
    checkIn:    act("Check In",   [bfd(fields.mood.id)]),
    express:    act("Express",    [bfd(fields.mood.id)]),
    vent:       act("Vent",       [bfd(fields.mood.id)]),
    celebrate:  act("Celebrate",  [bfd(fields.win.id), bfd(fields.eventPick.id), bfd(fields.leisureActivity.id)]),
    forgive:    act("Forgive"),
    relax:      act("Relax",      [bfd(fields.leisureActivity.id), bfd(fields.duration.id)]),
    decompress: act("Decompress", [bfd(fields.leisureActivity.id), bfd(fields.duration.id)]),

    // === INTELLECTUAL === (the Pomodoro template keeps its home here)
    read:      act("Read",     [bfd(fields.reading.id), bfd(fields.pages.id), bfd(fields.duration.id)]),
    study:     act("Study",    [bfd(fields.topic.id), bfd(fields.coursesTaken.id), bfd(fields.duration.id)]),
    watch:     act("Watch",    [bfd(fields.mediaPick.id), bfd(fields.duration.id)]),
    listen:    act("Listen",   [bfd(fields.mediaPick.id), bfd(fields.duration.id)]),
    practice:  act("Practice", [bfd(fields.skill.id), bfd(fields.duration.id)]),
    memorize:  act("Memorize", [bfd(fields.topic.id), bfd(fields.duration.id)]),
    research:  act("Research", [bfd(fields.topic.id), bfd(fields.duration.id)]),
    explore:   act("Explore",  [bfd(fields.topic.id), bfd(fields.duration.id)]),
    analyze:   act("Analyze",  [bfd(fields.topic.id), bfd(fields.duration.id)]),
    teach:     act("Teach",    [bfd(fields.topic.id), bfd(fields.skill.id), bfd(fields.duration.id)]),
    pomodoro: {
      id: uid(), label: "Pomodoro", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id,        role: "input", order: 0 },
        { fieldId: fields.pomodoroMinutes.id,  role: "input", order: 1 },
        { fieldId: fields.pomodoroNumber.id,   role: "input", order: 2 },
        { fieldId: fields.pomodoroPhase.id,    role: "input", order: 3 },
        { fieldId: dateFieldId,                role: "input", order: 4, hidden: false },
        { fieldId: timeslotFieldId,            role: "input", order: 5, hidden: false },
      ],
    },

    // === SOCIAL ===
    text:        act("Text",        [bfd(peopleAssignedFieldId)]),
    call:        act("Call",        [bfd(peopleAssignedFieldId)]),
    chat:        act("Chat",        [bfd(peopleAssignedFieldId)]),
    meet:        act("Meet",        [bfd(peopleAssignedFieldId), bfd(fields.place.id), bfd(fields.eventPick.id), bfd(fields.duration.id)]),
    date:        act("Date",        [bfd(peopleAssignedFieldId), bfd(fields.place.id), bfd(fields.eventPick.id), bfd(fields.duration.id)]),
    visit:       act("Visit",       [bfd(peopleAssignedFieldId), bfd(fields.place.id), bfd(fields.giftIdea.id), bfd(fields.duration.id)]),
    host:        act("Host",        [bfd(peopleAssignedFieldId), bfd(fields.place.id), bfd(fields.eventPick.id), bfd(fields.duration.id)]),
    collaborate: act("Collaborate", [bfd(peopleAssignedFieldId), bfd(projectFieldId), bfd(fields.duration.id)]),
    mentor:      act("Mentor",      [bfd(peopleAssignedFieldId), bfd(fields.skill.id), bfd(fields.duration.id)]),
    volunteer:   act("Volunteer",   [bfd(peopleAssignedFieldId), bfd(fields.place.id), bfd(fields.charity.id), bfd(fields.duration.id)]),

    // === SPIRITUAL === (duplicate labels across dimensions are separate modules)
    pray:              act("Pray",            [bfd(fields.practice.id), bfd(fields.verse.id), bfd(fields.duration.id)]),
    meditateSpiritual: act("Meditate",        [bfd(fields.practice.id), bfd(fields.duration.id)]),
    reflectSpiritual:  act("Reflect",         [bfd(fields.prompt.id), bfd(fields.duration.id)]),
    worship:           act("Worship",         [bfd(fields.practice.id), bfd(fields.verse.id), bfd(fields.duration.id)]),
    readScripture:     act("Read Scripture",  [bfd(fields.reading.id), bfd(fields.pages.id), bfd(fields.duration.id)]),
    readPhilosophy:    act("Read Philosophy", [bfd(fields.reading.id), bfd(fields.pages.id), bfd(fields.duration.id)]),
    gratitude:         act("Gratitude",       [bfd(fields.gratitudeEntry.id), bfd(fields.practice.id)]),
    mindfulness:       act("Mindfulness",     [bfd(fields.practice.id), bfd(fields.duration.id)]),
    nature:            act("Nature",          [bfd(fields.route.id), bfd(fields.duration.id)]),
    serve:             act("Serve",           [bfd(fields.charity.id), bfd(fields.duration.id)]),

    // === OCCUPATIONAL ===
    plan:       act("Plan",       [bfd(projectFieldId), bfd(fields.duration.id)]),
    prioritize: act("Prioritize", [bfd(projectFieldId), bfd(fields.duration.id)]),
    focus:      act("Focus",      [bfd(fields.duration.id)]),
    build:      act("Build",      [bfd(projectFieldId), bfd(fields.duration.id)]),
    code:       act("Code",       [bfd(projectFieldId), bfd(fields.duration.id)]),
    design:     act("Design",     [bfd(projectFieldId), bfd(fields.duration.id)]),
    write:      act("Write",      [bfd(projectFieldId), bfd(fields.duration.id)]),
    review:     act("Review",     [bfd(projectFieldId), bfd(fields.duration.id)]),
    email:      act("Email",      [bfd(peopleAssignedFieldId)]),
    network:    act("Network",    [bfd(peopleAssignedFieldId)]),

    // === FINANCIAL === (Pay Bill / Cancel Subscription re-home here as peers;
    // Track is the universal money occurrence — the flow toggle decides
    // add / subtract / SET-the-balance, superseding Set Account Balance)
    budget:          act("Budget",    [bfd(fields.accountRef.id), bfd(fields.savingsGoalPick.id), bfd(fields.amount.id)]),
    save:            act("Save",      [bfd(fields.accountRef.id), bfd(fields.savingsGoalPick.id), bfd(fields.amount.id)]),
    earn:            act("Earn",      [bfd(fields.accountRef.id), bfd(fields.amount.id)]),
    invest:          act("Invest",    [bfd(fields.accountRef.id), bfd(fields.savingsGoalPick.id), bfd(fields.amount.id)]),
    spend:           act("Spend",     [bfd(fields.accountRef.id), bfd(fields.purchaseItem.id), bfd(fields.amount.id)]),
    buy:             act("Buy",       [bfd(fields.accountRef.id), bfd(fields.purchaseItem.id), bfd(fields.amount.id)]),
    pay:             act("Pay",       [bfd(fields.accountRef.id), bfd(fields.amount.id)]),
    track:           act("Track",     [bfd(fields.accountRef.id), bfd(fields.amount.id)]),
    reconcile:       act("Reconcile", [bfd(fields.accountRef.id), bfd(fields.amount.id)]),
    donate:          act("Donate",    [bfd(fields.accountRef.id), bfd(fields.charity.id), bfd(fields.amount.id)]),
    reviewFinancial: act("Review",    [bfd(fields.accountRef.id), bfd(fields.amount.id)]),

    // === ENVIRONMENTAL ===
    clean:     act("Clean",     [bfd(fields.area.id), bfd(fields.duration.id)]),
    declutter: act("Declutter", [bfd(fields.area.id), bfd(fields.duration.id)]),
    organize:  act("Organize",  [bfd(fields.area.id), bfd(fields.duration.id)]),
    laundry:   act("Laundry"),
    dishes:    act("Dishes"),
    vacuum:    act("Vacuum",    [bfd(fields.area.id), bfd(fields.duration.id)]),
    recycle:   act("Recycle"),
    repair:    act("Repair",    [bfd(fields.equipment.id), bfd(fields.duration.id)]),
    maintain:  act("Maintain",  [bfd(fields.equipment.id), bfd(fields.duration.id)]),
    garden:    act("Garden",    [bfd(fields.plant.id), bfd(fields.duration.id)]),

    // === CREATIVE ===
    draw:              act("Draw",               [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    paint:             act("Paint",              [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    sketch:            act("Sketch",             [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    writeCreative:     act("Write",              [bfd(fields.prompt.id), bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    journalCreatively: act("Journal Creatively", [bfd(fields.prompt.id), bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    compose:           act("Compose",            [bfd(fields.song.id), bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    sing:              act("Sing",               [bfd(fields.song.id), bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    dance:             act("Dance",              [bfd(fields.song.id), bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    craft:             act("Craft",              [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    photograph:        act("Photograph",         [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    film:              act("Film",               [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    edit:              act("Edit",               [bfd(fields.medium.id), bfd(fields.creativeWork.id), bfd(fields.duration.id)]),
    brainstorm:        act("Brainstorm",         [bfd(fields.idea.id), bfd(fields.prompt.id), bfd(fields.duration.id)]),
    prototype:         act("Prototype",          [bfd(fields.idea.id), bfd(fields.medium.id), bfd(fields.duration.id)]),
    invent:            act("Invent",             [bfd(fields.idea.id), bfd(fields.medium.id), bfd(fields.duration.id)]),
  };

  // ── Workout instances (5 per muscle group × 6 groups = 30) ──────────────────
  function makeWorkout(label, group) {
    return {
      id: uid(), label, kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        // Paired set + weight per slot (2026-07-14).
        { fieldId: fields.set1Reps.id, role: "input", order: 1 },
        { fieldId: fields.workoutWeight.id, role: "input", order: 2 },
        { fieldId: fields.set2Reps.id, role: "input", order: 3 },
        { fieldId: fields.workoutWeight2.id, role: "input", order: 4 },
        { fieldId: fields.set3Reps.id, role: "input", order: 5 },
        { fieldId: fields.workoutWeight3.id, role: "input", order: 6 },
        { fieldId: fields.muscleGroup.id, role: "input", order: 7 },
      ],
      meta: { defaultMuscleGroup: group.toLowerCase() },
    };
  }
  const workoutInstances = {
    benchPress:     makeWorkout("Bench Press",        "Chest"),
    inclinePress:   makeWorkout("Incline Press",      "Chest"),
    chestFly:       makeWorkout("Chest Fly",          "Chest"),
    pushUps:        makeWorkout("Push-ups",           "Chest"),
    cableCrossover: makeWorkout("Cable Crossover",    "Chest"),
    deadlift:       makeWorkout("Deadlift",           "Back"),
    pullUps:        makeWorkout("Pull-ups",           "Back"),
    bentRow:        makeWorkout("Bent-over Row",      "Back"),
    latPulldown:    makeWorkout("Lat Pulldown",       "Back"),
    seatedRow:      makeWorkout("Seated Cable Row",   "Back"),
    squat:          makeWorkout("Squat",              "Legs"),
    legPress:       makeWorkout("Leg Press",          "Legs"),
    lunges:         makeWorkout("Lunges",             "Legs"),
    legCurl:        makeWorkout("Leg Curl",           "Legs"),
    calfRaise:      makeWorkout("Calf Raise",         "Legs"),
    overheadPress:  makeWorkout("Overhead Press",     "Shoulders"),
    lateralRaise:   makeWorkout("Lateral Raise",      "Shoulders"),
    frontRaise:     makeWorkout("Front Raise",        "Shoulders"),
    facePull:       makeWorkout("Face Pull",          "Shoulders"),
    shrugs:         makeWorkout("Shrugs",             "Shoulders"),
    bicepCurl:      makeWorkout("Bicep Curl",         "Arms"),
    hammerCurl:     makeWorkout("Hammer Curl",        "Arms"),
    tricepDip:      makeWorkout("Tricep Dip",         "Arms"),
    skullCrusher:   makeWorkout("Skull Crusher",      "Arms"),
    tricepPushdown: makeWorkout("Tricep Pushdown",    "Arms"),
    running:        makeWorkout("Running",            "Cardio"),
    cycling:        makeWorkout("Cycling",            "Cardio"),
    jumpRope:       makeWorkout("Jump Rope",          "Cardio"),
    rowMachine:     makeWorkout("Row Machine",        "Cardio"),
    burpees:        makeWorkout("Burpees",            "Cardio"),
  };

  // ── Bill instances (Bills page — unchanged by the 2026-07-25 rebuild) ──────
  const billInstances = {
    netflixSub: {
      id: uid(), label: "Netflix", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id,         role: "input", order: 0 },
        { fieldId: fields.accountRef.id,     role: "input", order: 1 },
        { fieldId: fields.billCadence.id,    role: "input", order: 2 },
        { fieldId: fields.billDay.id,        role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id,   role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id,     role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id,    role: "display", order: 6 },
      ],
    },
    spotifySub: {
      id: uid(), label: "Spotify", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    iCloudSub: {
      id: uid(), label: "iCloud+", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    electricBill: {
      id: uid(), label: "Electric", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    waterBill: {
      id: uid(), label: "Water", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    internetBill: {
      id: uid(), label: "Internet", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    phoneBill: {
      id: uid(), label: "Phone", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    carInsuranceBill: {
      id: uid(), label: "Car Insurance", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    renterInsuranceBill: {
      id: uid(), label: "Renter Insurance", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    studentLoanBill: {
      id: uid(), label: "Student Loan", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },
    rentMortgage: {
      id: uid(), label: "Rent / Mortgage", kind: "board",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.billCadence.id, role: "input", order: 2 },
        { fieldId: fields.billDay.id, role: "input", order: 3 },
        { fieldId: fields.billCadenceN.id, role: "input", order: 4, hidden: true },
        { fieldId: fields.billAnchor.id, role: "input", order: 5, hidden: true },
        { fieldId: fields.billNextDue.id, role: "display", order: 6 },
      ],
    },

  };

  // (Nutrition instances removed 2026-07-25 — Eat/Cook + the Meals board
  // replace the per-meal toolkit items.)

  // ── Todo instances ───────────────────────────────────────────────────────────
  // Note: fields.dueDate in createDefaultUserData → fields.due.id here (same field, renamed key)
  // ── Kept todo-era task modules (2026-07-25): Pay Bill + Cancel
  // Subscription live in the FINANCIAL dimension now (bill mechanics
  // unchanged — billRef / subscriptionRef / Schedule Due: Seed).
  const todoInstances = {
    payBills: {
      // Generic Pay Bill task. The user picks which bill via the billRef
      // dropdown; Schedule Due: Seed copies this task into the Schedule Due
      // container for each bill whose billNextDue falls in the active window
      // (B3+C2 — Bills page + ops). amount + account default to whatever's
      // on the selected bill but stay user-editable per instance.
      id: uid(), label: "Pay Bill", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id,  role: "input", order: 0 },
        { fieldId: fields.billRef.id,    role: "input", order: 1 },
        { fieldId: fields.accountRef.id, role: "input", order: 2 },
        { fieldId: fields.amount.id,     role: "input", order: 3 },
        { fieldId: fields.due.id,        role: "input", order: 4 },
      ],
    },
    cancelSub: {
      // Cancel Subscription — user picks which subscription via
      // subscriptionRef (scoped to Subscriptions container in Bills page).
      // Drops amount/daysUntilDue/priority (the legacy bindings the user
      // flagged as spurious — see please-continue.txt B9).
      id: uid(), label: "Cancel Subscription", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id,       role: "input", order: 0 },
        { fieldId: fields.subscriptionRef.id, role: "input", order: 1 },
      ],
    },
  };

  // (Planning instances removed 2026-07-25 — the Tasks page starts EMPTY;
  // the user supplies task data.)

    const goalInstances = {
    // Per-metric split — was a single "Physical Wellness" umbrella holding
    // 8 display fields. Stage 3 of the Goals restructure: one occurrence per
    // logical metric so picker-direct binding (`$allItemsById.<id>`) points at
    // the exact thing each tracker writes to, displayRules key by per-metric
    // label, and each per-metric card on the goals page reads independently.
    physicalCompleted: {
      id: uid(), label: "Completed", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.taskCountdown.id,  role: "display", order: 1 },
      ],
    },
    physicalWater: {
      id: uid(), label: "Water", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalWater.id, role: "display", order: 0 },
      ],
    },
    physicalSteps: {
      id: uid(), label: "Steps", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalSteps.id, role: "display", order: 0 },
      ],
    },
    physicalStreak: {
      id: uid(), label: "Streak", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.currentStreak.id, role: "display", order: 0 },
        { fieldId: fields.longestStreak.id, role: "display", order: 1 },
      ],
    },
    physicalNow: {
      id: uid(), label: "Now", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.currentTime.id,   role: "display", order: 0 },
        { fieldId: fields.timeCountdown.id, role: "display", order: 1 },
      ],
    },
    // Per-metric split — was a single "Intellectual Growth" umbrella holding
    // 7 display fields. Stage 3: one occurrence per logical metric. Courses
    // (formerly a standalone `coursesTakenGoal` container) is folded in here.
    // (`totalCompleted` dropped per-domain — only the Physical "Completed"
    // per-metric occurrence has a tracker writing into it today; the same
    // field on every other domain's summary was rendering 0 forever.)
    intellectualPagesRead: {
      id: uid(), label: "Pages Read", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalPages.id, role: "display", order: 0 },
      ],
    },
    intellectualReadingTime: {
      id: uid(), label: "Reading Time", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalDuration.id, role: "display", order: 0 },
      ],
    },
    intellectualPomodoros: {
      id: uid(), label: "Pomodoros", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.pomoCount.id,    role: "display", order: 0 },
        { fieldId: fields.pomoTime.id,     role: "display", order: 1 },
        // task #29/#54 — Last-X + Array-X pair for Pomodoros (count + last + history).
        { fieldId: fields.lastPomodoro.id, role: "display", order: 2 },
        { fieldId: fields.pomoHistory.id,  role: "display", order: 3 },
      ],
    },
    intellectualCourses: {
      id: uid(), label: "Courses", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: coursesTakenDisplayFieldId, role: "display", order: 0 },
      ],
    },
    // ── Per-metric splits for the remaining wellness summaries ──────────────
    // Same Stage 3 pattern as Physical / Intellectual. `totalCompleted` is
    // omitted on non-physical splits — only Physical has a tracker writing
    // into it today; carrying empty Completed tiles everywhere was noise.
    // Per-metric occurrences keep the structure ready for future domain-
    // scoped Completed trackers.
    emotionalMood: {
      id: uid(), label: "Mood", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        // Last+Array pair: scalar "Last Mood" + array of recent mood rows.
        { fieldId: fields.mostRecentMood.id, role: "display", order: 0 },
        { fieldId: fields.lastMood.id,       role: "display", order: 1 },
      ],
    },
    socialConnectionTime: {
      id: uid(), label: "Connection Time", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalDuration.id, role: "display", order: 0 },
      ],
    },
    socialPhoneCalls: {
      id: uid(), label: "Phone Calls", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        // Task #46 — "Call 2 people" goal piece. Scalar counter w/ target=2
        // for the progress bar; array display lists who was called and when.
        { fieldId: fields.totalPhoneCalls.id, role: "display", order: 0 },
        { fieldId: fields.phoneCalls.id,      role: "display", order: 1 },
      ],
    },
    spiritualPractice: {
      id: uid(), label: "Practice Duration", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalDuration.id, role: "display", order: 0 },
      ],
    },
    occupationalWork: {
      id: uid(), label: "Work Duration", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalDuration.id, role: "display", order: 0 },
      ],
    },
    financialSpent: {
      id: uid(), label: "Spent", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        // Scalar + Last + Array trio for purchases. Same pattern as Pomodoros.
        { fieldId: fields.totalSpent.id,      role: "display", order: 0 },
        { fieldId: fields.lastPurchase.id,    role: "display", order: 1 },
        { fieldId: fields.purchaseHistory.id, role: "display", order: 2 },
      ],
    },
    financialIncome: {
      id: uid(), label: "Income", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalIncome.id, role: "display", order: 0 },
      ],
    },
    environmentalSummary: {
      // 1 field — already atomic, no split needed.
      id: uid(), label: "Environment Care", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
      ],
    },
    creativeDuration: {
      id: uid(), label: "Creative Duration", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalDuration.id, role: "display", order: 0 },
      ],
    },
    planningOverdue: {
      id: uid(), label: "Overdue", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.overdueTasks.id, role: "display", order: 0 },
      ],
    },
    planningUpcoming: {
      id: uid(), label: "Upcoming", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.upcomingThisWeek.id, role: "display", order: 0 },
      ],
    },
    // ── Workout per-metric splits (Stage 3) ──────────────────────────────────
    // Was one "Workout" umbrella bundling reps + steps + last/history. Steps is
    // a Physical metric (written only to physicalSteps — no workout-steps
    // tracker exists), so that tile was dead and is dropped (same omit-dead-tile
    // principle as the 7 summaries above). Per-muscle volume tiles
    // (chest/back/... below) are unchanged siblings.
    workoutReps: {
      id: uid(), label: "Reps", kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalRepsToday.id, role: "display", order: 0 },
      ],
    },
    workoutLog: {
      id: uid(), label: "Workout Log", kind: "board", defaultDragMode: "move",
      // Last+Array pair (task #29/#54): scalar last workout + array history.
      fieldBindings: [
        { fieldId: fields.lastWorkout.id,    role: "display", order: 0 },
        { fieldId: fields.workoutHistory.id, role: "display", order: 1 },
      ],
    },
    // Per-muscle volume goals (B7 Deep). Each tracks the daily sum of
    // set1+set2+set3 reps across workouts whose `muscleGroup` field matches.
    // All share the existing `totalRepsToday` display field — the per-goal
    // value lives on the occurrence, not the field.
    chestVolumeGoal:    { id: uid(), label: "Chest Volume",    kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    backVolumeGoal:     { id: uid(), label: "Back Volume",     kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    legsVolumeGoal:     { id: uid(), label: "Legs Volume",     kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    shouldersVolumeGoal:{ id: uid(), label: "Shoulders Volume",kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    armsVolumeGoal:     { id: uid(), label: "Arms Volume",     kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    cardioVolumeGoal:   { id: uid(), label: "Cardio Volume",   kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalRepsToday.id, role: "display", order: 0 }] },
    // Per-meal nutrition goals (B7 Deep). Each tracks the daily sums of ALL
    // FOUR macros (calories/protein/carbs/fats — was protein-only until
    // 2026-07-14: "set the breakfast nutrition and the others to have more
    // than protein") across nutrition instances whose `mealCategory` matches.
    // Shares the macro display fields — per-goal values live on the occurrence.
    breakfastNutritionGoal: { id: uid(), label: "Breakfast Nutrition", kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCalories.id, role: "display", order: 0 },
        { fieldId: fields.totalProtein.id,  role: "display", order: 1 },
        { fieldId: fields.totalCarbs.id,    role: "display", order: 2 },
        { fieldId: fields.totalFats.id,     role: "display", order: 3 },
      ] },
    lunchNutritionGoal:     { id: uid(), label: "Lunch Nutrition",     kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCalories.id, role: "display", order: 0 },
        { fieldId: fields.totalProtein.id,  role: "display", order: 1 },
        { fieldId: fields.totalCarbs.id,    role: "display", order: 2 },
        { fieldId: fields.totalFats.id,     role: "display", order: 3 },
      ] },
    dinnerNutritionGoal:    { id: uid(), label: "Dinner Nutrition",    kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCalories.id, role: "display", order: 0 },
        { fieldId: fields.totalProtein.id,  role: "display", order: 1 },
        { fieldId: fields.totalCarbs.id,    role: "display", order: 2 },
        { fieldId: fields.totalFats.id,     role: "display", order: 3 },
      ] },
    snackNutritionGoal:     { id: uid(), label: "Snack Nutrition",     kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCalories.id, role: "display", order: 0 },
        { fieldId: fields.totalProtein.id,  role: "display", order: 1 },
        { fieldId: fields.totalCarbs.id,    role: "display", order: 2 },
        { fieldId: fields.totalFats.id,     role: "display", order: 3 },
      ] },
    // ── Nutrition per-metric splits (Stage 3) ────────────────────────────────
    // Was one "Nutrition" umbrella bundling protein/carbs/fats + last/history.
    // Each macro has its own daily tracker (Protein/Carbs/Fats) and the meal
    // log has the Meal History op — all four tiles are written, none dead.
    // Per-meal tiles (breakfast/lunch/... below) are unchanged siblings.
    nutritionProtein: {
      id: uid(), label: "Protein", kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalProtein.id, role: "display", order: 0 }],
    },
    nutritionCarbs: {
      id: uid(), label: "Carbs", kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalCarbs.id, role: "display", order: 0 }],
    },
    nutritionFats: {
      id: uid(), label: "Fats", kind: "board", defaultDragMode: "move",
      fieldBindings: [{ fieldId: fields.totalFats.id, role: "display", order: 0 }],
    },
    nutritionLog: {
      id: uid(), label: "Meal Log", kind: "board", defaultDragMode: "move",
      // Last+Array pair (task #29/#54): scalar last meal + array history.
      fieldBindings: [
        { fieldId: fields.lastMeal.id,    role: "display", order: 0 },
        { fieldId: fields.mealHistory.id, role: "display", order: 1 },
      ],
    },
    // ── Media per-type splits (Stage 3) ──────────────────────────────────────
    // One occurrence per media type, each count + last + history. The count +
    // last scalars are written by the (now picker-direct) Movies/Books/Podcasts
    // trackers alongside the existing history-rows array.
    mediaMovies: {
      id: uid(), label: "Movies", kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: lastMovieFieldId,            role: "display", order: 0 },
        { fieldId: moviesWatchedDisplayFieldId, role: "display", order: 1 },
      ],
    },
    mediaBooks: {
      id: uid(), label: "Books", kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: lastBookFieldId,          role: "display", order: 0 },
        { fieldId: booksReadDisplayFieldId,  role: "display", order: 1 },
      ],
    },
    mediaPodcasts: {
      id: uid(), label: "Podcasts", kind: "board", defaultDragMode: "move",
      fieldBindings: [
        { fieldId: lastPodcastFieldId,             role: "display", order: 0 },
        { fieldId: podcastsListenedDisplayFieldId, role: "display", order: 1 },
      ],
    },
    // (coursesTakenGoal removed — courses now lives as `intellectualCourses`
    // per-metric occurrence inside the Intellectual goal container.)
  };

  // ── Account aggregation instances ────────────────────────────────────────────
  const accountInstances = {
    bankAccount: {
      id: uid(), label: "Checking Account", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        // Each account has its OWN balance field (split 2026-05-22 — was
        // sharing netBalance with Savings and Net Worth, which read as
        // three identical "Net Balance" rows in the UI).
        { fieldId: fields.checkingBalance.id, role: "display", order: 0 },
        { fieldId: fields.totalSpent.id, role: "display", order: 1 },
        { fieldId: fields.totalIncome.id, role: "display", order: 2 },
      ],
    },
    savingsAccount: {
      id: uid(), label: "Savings Account", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.savingsBalance.id, role: "display", order: 0 },
      ],
    },
    momsAccount: {
      id: uid(), label: "Mom's Account", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.momsAccountBalance.id, role: "display", order: 0 },
      ],
    },
    cashAccount: {
      id: uid(), label: "Cash", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.cashBalance.id, role: "display", order: 0 },
      ],
    },
    fitnessAccount: {
      id: uid(), label: "Fitness Stats", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalWorkouts.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
      ],
    },
    readingAccount: {
      id: uid(), label: "Reading Stats", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalReadingTime.id, role: "display", order: 0 },
        { fieldId: fields.totalPages.id, role: "display", order: 1 },
      ],
    },
    productivityAccount: {
      id: uid(), label: "Productivity", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completionRate.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    wellnessAccount: {
      id: uid(), label: "Wellness Score", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.lastMood.id, role: "display", order: 0 },
        { fieldId: fields.totalWater.id, role: "display", order: 1 },
      ],
    },
    // B8 — granular accounts. Net Worth + bill aggregations alongside the
    // existing checking/savings/etc. Display fields reused; aggregator ops
    // can be wired later to feed them (TBD follow-up).
    netWorth: {
      id: uid(), label: "Net Worth", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
      ],
    },
    totalSubscriptions: {
      id: uid(), label: "Total Subscriptions", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "display", order: 0 },
      ],
    },
    monthlyBills: {
      id: uid(), label: "Monthly Bills", kind: "board",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "display", order: 0 },
      ],
    },
  };

  // ── Merge all kept instance sets ─────────────────────────────────────────────
  const allInstances = {
    ...actionInstances,
    ...billInstances,
    ...workoutInstances, // movement option modules (occurrences live on the Movements board)
    ...todoInstances,
    ...goalInstances,
    ...accountInstances,
  };

  // Inject hidden category field on every instance (mirrors createDefaultUserData line ~1991).
  for (const key of Object.keys(allInstances)) {
    const inst = allInstances[key];
    if (!inst.fieldBindings) inst.fieldBindings = [];
    const hasCat = inst.fieldBindings.some(b => b.fieldId === fields.category.id);
    if (!hasCat) {
      const maxOrder = inst.fieldBindings.reduce((m, b) => Math.max(m, b.order ?? 0), 0);
      inst.fieldBindings.push({ fieldId: fields.category.id, role: "input", hidden: true, order: maxOrder + 1 });
    }
  }

  // Task #5 — Filter-date as a field binding on every goal/tracker + account.
  // Replaces the now-deleted custom badge. Each goal/account instance binds
  // dateFieldId as a display-only field pill (hidden as input — user can't
  // type into it). The "Stamp Filter Date" op (seeded with the trackers
  // below) writes each goal's _effectiveFilter date into this field on
  // every filter change so the pill always reflects what the user is
  // currently filtering on.
  // (Removed 2026-05-21) — Date field auto-binding on goal + account
  // instances. The Date display showed up as a stamp on every goal
  // row but the value was never reliably set (the seed "Stamp Filter
  // Date" op didn't resolve $effectiveFilter for goals whose parent
  // chain links via occurrences[] without parentId). User decision:
  // the date filter in the page header covers the same intent — the
  // inline Date row was redundant.

  // Persist instance modules (parallel insertMany in batches)
  const instanceDocs = Object.values(allInstances).map(inst => ({
    ...inst,
    userId,
    gridId,
    role: "instance",
  }));
  await Module.insertMany(instanceDocs);

  // instanceMods map — exposed on return value so Task 9 (occurrences) can
  // reference module ids by their semantic key (e.g. instanceMods.drinkWater.id).
  const instanceMods = allInstances;

  // ── STEP 4: Container modules (NO slot containers) ───────────────────────────
  //
  // Ported from createDefaultUserData STEP 3 `toolkitContainers` / `todoContainers` /
  // `goalContainers` / `accountContainers`.
  //
  // EXCLUDED container sets:
  //   scheduleContainers / slot containers / Due container — built by Daily Routine template
  //     + Schedule: Build Day op (later tasks). NOT created at grid scope here.
  //   notebookDocContainers — Task 11.
  //   Pool containers (moviePool, tvShowPool, booksPool, musicPool, podcastsPool,
  //     gamesPool, activitiesPool, roomsPool, cbtPool, bookmarksPool) — pool-only,
  //     excluded per user directive. Brought back "in a new way" later.
  //   wentWellQPool / improvedQPool / gratitudeQPool — journal Q&A pool-only.
  //   enrichment container — enrichmentInstances excluded; container is enrichment-only.
  //   macroRef — notebook doc, Task 11.
  //
  // KEPT containers: 8 toolkit dimensions + workoutAll + 5 meal categories,
  //   5 todoContainers, 11 goalContainers, 5 accountContainers.
  //
  // meta flags: todoContainers get `meta: { todoListContainer: true }` (matches
  //   createTestGrid convention; used by Schedule: Build Day sweep FIND predicate).
  //   filterOverride on occurrences (Physical/General) is set at OCCURRENCE creation
  //   in Task 9 — NOT on the module record here.

  // ── Toolkit containers ───────────────────────────────────────────────────────
  // Daily Toolkit is now a FOLDER with 11 wellness pages inside; the containers
  // below are sub-groupings WITHIN each wellness page (not top-level dimensions
  // anymore). Physical splits into 4 daily-habit groups; Physical-Fitness into
  // 6 muscle groups; Physical-Nutrition into 5 meal types; the rest are single
  // containers per page until the user wants finer breakdown.
  // ── 9 dimension containers (2026-07-25 rebuild) ─────────────────────────────
  // Colors from the two vintage reference screenshots — distinct in both
  // vintage themes (see the nine-dimensions plan's color table).
  const DIM_COLORS = {
    physical:      "#b34f24", // rust
    emotional:     "#7d3049", // maroon
    intellectual:  "#4a3b52", // plum
    social:        "#e08b31", // orange
    spiritual:     "#e0a63f", // mustard
    occupational:  "#6d7434", // avocado
    financial:     "#3e8e7e", // teal
    environmental: "#4a8c5c", // green
    creative:      "#d94f30", // red
  };
  const toolkitContainerMods = {
    physical:      { id: uid(), label: "Physical",      styleMode: "own", ownStyle: { bg: DIM_COLORS.physical } },
    emotional:     { id: uid(), label: "Emotional",     styleMode: "own", ownStyle: { bg: DIM_COLORS.emotional } },
    intellectual:  { id: uid(), label: "Intellectual",  styleMode: "own", ownStyle: { bg: DIM_COLORS.intellectual } },
    social:        { id: uid(), label: "Social",        styleMode: "own", ownStyle: { bg: DIM_COLORS.social } },
    spiritual:     { id: uid(), label: "Spiritual",     styleMode: "own", ownStyle: { bg: DIM_COLORS.spiritual } },
    occupational:  { id: uid(), label: "Occupational",  styleMode: "own", ownStyle: { bg: DIM_COLORS.occupational } },
    financial:     { id: uid(), label: "Financial",     styleMode: "own", ownStyle: { bg: DIM_COLORS.financial } },
    environmental: { id: uid(), label: "Environmental", styleMode: "own", ownStyle: { bg: DIM_COLORS.environmental } },
    creative:      { id: uid(), label: "Creative",      styleMode: "own", ownStyle: { bg: DIM_COLORS.creative } },
  };

  // ── Task containers (2026-07-25) — the Tasks page's 9 EMPTY dimension
  // containers (fresh modules, NOT multi-parented from Routines). They keep
  // meta.todoListContainer so drag-to-Schedule flows treat them as task
  // sources exactly like the old Todo List containers.
  const taskContainerMods = {
    taskPhysical:      { id: uid(), label: "Physical",      styleMode: "own", ownStyle: { bg: DIM_COLORS.physical },      meta: { todoListContainer: true } },
    taskEmotional:     { id: uid(), label: "Emotional",     styleMode: "own", ownStyle: { bg: DIM_COLORS.emotional },     meta: { todoListContainer: true } },
    taskIntellectual:  { id: uid(), label: "Intellectual",  styleMode: "own", ownStyle: { bg: DIM_COLORS.intellectual },  meta: { todoListContainer: true } },
    taskSocial:        { id: uid(), label: "Social",        styleMode: "own", ownStyle: { bg: DIM_COLORS.social },        meta: { todoListContainer: true } },
    taskSpiritual:     { id: uid(), label: "Spiritual",     styleMode: "own", ownStyle: { bg: DIM_COLORS.spiritual },     meta: { todoListContainer: true } },
    taskOccupational:  { id: uid(), label: "Occupational",  styleMode: "own", ownStyle: { bg: DIM_COLORS.occupational },  meta: { todoListContainer: true } },
    taskFinancial:     { id: uid(), label: "Financial",     styleMode: "own", ownStyle: { bg: DIM_COLORS.financial },     meta: { todoListContainer: true } },
    taskEnvironmental: { id: uid(), label: "Environmental", styleMode: "own", ownStyle: { bg: DIM_COLORS.environmental }, meta: { todoListContainer: true } },
    taskCreative:      { id: uid(), label: "Creative",      styleMode: "own", ownStyle: { bg: DIM_COLORS.creative },      meta: { todoListContainer: true } },
  };

  // ── Goal containers (8 dimensions + workout + nutrition + planning + movies) ────
  const goalContainerMods = {
    physicalGoal:      { id: uid(), label: "Physical",      styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    intellectualGoal:  { id: uid(), label: "Intellectual",  styleMode: "own", ownStyle: { bg: "#1562b0" } },
    emotionalGoal:     { id: uid(), label: "Emotional",     styleMode: "own", ownStyle: { bg: "#a02158" } },
    socialGoal:        { id: uid(), label: "Social",        styleMode: "own", ownStyle: { bg: "#c49000" } },
    spiritualGoal:     { id: uid(), label: "Spiritual",     styleMode: "own", ownStyle: { bg: "#6427c5" } },
    occupationalGoal:  { id: uid(), label: "Occupational",  styleMode: "own", ownStyle: { bg: "#0d7a52" } },
    financialGoal:     { id: uid(), label: "Financial",     styleMode: "own", ownStyle: { bg: "#1d8a30" } },
    environmentalGoal: { id: uid(), label: "Environmental", styleMode: "own", ownStyle: { bg: "#0779a0" } },
    creativeGoal:      { id: uid(), label: "Creative",      styleMode: "own", ownStyle: { bg: "#c2399a" } },
    workoutGoal:      { id: uid(), label: "Workout" },
    nutritionGoal:    { id: uid(), label: "Nutrition" },
    planningGoal:     { id: uid(), label: "Planning" },
    // Media — unified goal container; Movies / Books / Podcasts live inside it
    // as per-type occurrences (each count + last + history). Replaced the three
    // standalone Entertainment / Books Read / Podcasts Listened containers.
    mediaGoal:        { id: uid(), label: "Media" },
    // (coursesTakenGoal container removed — courses moved into Intellectual.)
  };

  // ── Account containers (5 lifetime-aggregation categories) ───────────────────
  const accountContainerMods = {
    financeAccount:      { id: uid(), label: "Finances" },
    fitnessAccount:      { id: uid(), label: "Fitness" },
    learningAccount:     { id: uid(), label: "Learning" },
    productivityAccount: { id: uid(), label: "Productivity" },
    wellnessAccount:     { id: uid(), label: "Wellness" },
  };

  // ── Library container module ────────────────────────────────────────────────
  // Holds the 8 movie instances (and future books/shows). Placed in the manifest
  // Library folder — no grid panel (grid is fully occupied 2×3).
  const libraryContainerMods = {
    library: { id: libraryContModId, label: "Library" },
  };

  // ── Bills containers (5 bill-type groupings) ────────────────────────────────
  // The Bills page (under Library folder) has these as its sub-containers.
  // Subscriptions is the target of subscriptionRef's find predicate; the other
  // four hold non-subscription recurring expenses. Color cue is finance-green
  // to match the Financial wellness column.
  const BILLS_BG = "#1d8a30";
  const billContainerMods = {
    billSubscriptions: { id: uid(), label: "Subscriptions", styleMode: "own", ownStyle: { bg: BILLS_BG } },
    billUtilities:     { id: uid(), label: "Utilities",     styleMode: "own", ownStyle: { bg: BILLS_BG } },
    billInsurance:     { id: uid(), label: "Insurance",     styleMode: "own", ownStyle: { bg: BILLS_BG } },
    billLoans:         { id: uid(), label: "Loans",         styleMode: "own", ownStyle: { bg: BILLS_BG } },
    billOther:         { id: uid(), label: "Other",         styleMode: "own", ownStyle: { bg: BILLS_BG } },
  };

  // ── Merge + persist container modules ────────────────────────────────────────
  const containerMods = {
    ...toolkitContainerMods,
    ...taskContainerMods,
    ...goalContainerMods,
    ...accountContainerMods,
    ...libraryContainerMods,
    ...billContainerMods,
  };

  const containerDocs = Object.values(containerMods).map(c => ({
    id: c.id,
    label: c.label,
    userId,
    gridId,
    role: "container",
    kind: "board",
    ...(c.styleMode ? { styleMode: c.styleMode } : {}),
    ...(c.ownStyle  ? { ownStyle: c.ownStyle }   : {}),
    ...(c.meta      ? { meta: c.meta }            : {}),
  }));
  await Module.insertMany(containerDocs);

  // ── STEP 6: Instance + container occurrences ────────────────────────────────
  //
  // Pattern (mirrors createTestGrid exactly):
  //   1. Pre-generate each container occurrence id.
  //   2. Create child instance occurrences with parentId = container occ id.
  //   3. Create the container occurrence with occurrences: [childIds].
  //
  // filterOverride rules (matching createTestGrid):
  //   - Toolkit containers (Physical / Intellectual / …) → filterOverride: {}
  //     (opt-out from date cascade so toolkit items are always visible)
  //   - Todo containers (Home / Finance / Work / Personal / Plan) → filterOverride: {}
  //     (same opt-out; matches createTestGrid's General todo convention)
  //   - Goal containers → no filterOverride (date cascade from Goals page is intentional)
  //   - Account containers → no filterOverride (all-time aggregation; persistent by design)
  //
  // Pre-filled fields (ported faithfully from createDefaultUserData):
  //   Toolkit instance occs: muscle-group + meal-type + macro defaults from inst.meta.
  //   Planning instance occs: due date pre-fills (moduiLaunch=+45d, doctorCheckup=+90d,
  //     carInsurance=+12d, fileTaxes=+38d, quarterlyReview=+21d).
  //   Toolkit moodCheck: today's mood pre-fill added as an extra occ in emotional container.
  //   Goal / account occurrences: no pre-fills (pure display aggregations).

  // Helper: field-value shape { value, flow, timestamp }
  function fv(value, flow = "in") {
    return { value, flow, timestamp: new Date() };
  }

  // Helper: N days from now (noon local so it's clearly "that day")
  function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // ── Pre-generate container occurrence IDs ─────────────────────────────────
  // Toolkit containers — now grouped by wellness PAGE (folder-based Daily Toolkit).
  // Physical (general) splits into 4 daily-habit groups. Physical-Fitness splits
  // into 6 muscle groups. Physical-Nutrition splits into 5 meal types. Other
  // wellness pages keep a single container until the user wants finer breakdown.
  const physicalContOccId      = uid();
  const intellectualContOccId  = uid();
  const emotionalContOccId     = uid();
  const socialContOccId        = uid();
  const spiritualContOccId     = uid();
  const occupationalContOccId  = uid();
  const financialContOccId     = uid();
  const environmentalContOccId = uid();
  const creativeContOccId      = uid();

  // Bills containers — placed in the Bills page (under Library folder).
  const billSubscriptionsContOccId = uid();
  const billUtilitiesContOccId     = uid();
  const billInsuranceContOccId     = uid();
  const billLoansContOccId         = uid();
  const billOtherContOccId         = uid();

  // Todo containers

  // Goal containers
  const physicalGoalContOccId      = uid();
  const intellectualGoalContOccId  = uid();
  const emotionalGoalContOccId     = uid();
  const socialGoalContOccId        = uid();
  const spiritualGoalContOccId     = uid();
  const occupationalGoalContOccId  = uid();
  const financialGoalContOccId     = uid();
  const environmentalGoalContOccId = uid();
  const creativeGoalContOccId      = uid();
  const workoutGoalContOccId       = uid();
  const nutritionGoalContOccId     = uid();
  const planningGoalContOccId      = uid();

  // Account containers
  const financeAccountContOccId      = uid();
  const fitnessAccountContOccId      = uid();
  const learningAccountContOccId     = uid();
  const productivityAccountContOccId = uid();
  const wellnessAccountContOccId     = uid();

  // Movies Watched / Books Read / Podcasts Listened goal containers
  // (coursesTakenGoalContOccId removed — courses lives inside Intellectual.)
  const mediaGoalContOccId          = uid();

  // ── Container→instance mappings (now grouped by wellness sub-container) ────
  // Each key is a CONTAINER (matches toolkitContainerMods key). instKeys lists
  // the instance modules that live in that container. The wellness PAGE
  // structure (which containers belong to which page) is defined separately
  // in `wellnessPages` below.
  const toolkitMappings = {
    physical:      { contOccId: physicalContOccId,     contModKey: "physical",      instKeys: ["eat", "cook", "drink", "sleep", "nap", "exercise", "stretch", "walk", "run", "lift", "recover", "hygiene", "groom"] },
    emotional:     { contOccId: emotionalContOccId,    contModKey: "emotional",     instKeys: ["journal", "reflect", "meditate", "checkIn", "express", "vent", "celebrate", "forgive", "relax", "decompress"] },
    intellectual:  { contOccId: intellectualContOccId, contModKey: "intellectual",  instKeys: ["read", "study", "watch", "listen", "practice", "memorize", "research", "explore", "analyze", "teach", "pomodoro"] },
    social:        { contOccId: socialContOccId,       contModKey: "social",        instKeys: ["text", "call", "chat", "meet", "date", "visit", "host", "collaborate", "mentor", "volunteer"] },
    spiritual:     { contOccId: spiritualContOccId,    contModKey: "spiritual",     instKeys: ["pray", "meditateSpiritual", "reflectSpiritual", "worship", "readScripture", "readPhilosophy", "gratitude", "mindfulness", "nature", "serve"] },
    occupational:  { contOccId: occupationalContOccId, contModKey: "occupational",  instKeys: ["plan", "prioritize", "focus", "build", "code", "design", "write", "review", "email", "network"] },
    financial:     { contOccId: financialContOccId,    contModKey: "financial",     instKeys: ["budget", "save", "earn", "invest", "spend", "buy", "pay", "track", "reconcile", "donate", "reviewFinancial", "payBills", "cancelSub"] },
    environmental: { contOccId: environmentalContOccId,contModKey: "environmental", instKeys: ["clean", "declutter", "organize", "laundry", "dishes", "vacuum", "recycle", "repair", "maintain", "garden"] },
    creative:      { contOccId: creativeContOccId,     contModKey: "creative",      instKeys: ["draw", "paint", "sketch", "writeCreative", "journalCreatively", "compose", "sing", "dance", "craft", "photograph", "film", "edit", "brainstorm", "prototype", "invent"] },
  };

  // Per-exercise starting weights (lbs) — a realistic intermediate-lifter
  // state, as if the user had been progressively overloading. Bodyweight /
  // cardio movements carry 0 weight. Keyed by workout instance key; any
  // workout not listed falls back to a light 20 lb default.
  const workoutStartWeights = {
    benchPress: 135, inclinePress: 115, chestFly: 30, pushUps: 0, cableCrossover: 25,
    deadlift: 225, pullUps: 0, bentRow: 115, latPulldown: 120, seatedRow: 130,
    squat: 185, legPress: 270, lunges: 40, legCurl: 90, calfRaise: 150,
    overheadPress: 85, lateralRaise: 20, frontRaise: 20, facePull: 40, shrugs: 135,
    bicepCurl: 30, hammerCurl: 30, tricepDip: 0, skullCrusher: 50, tricepPushdown: 50,
    running: 0, cycling: 0, jumpRope: 0, rowMachine: 0, burpees: 0,
  };

  // ── Create toolkit instance occurrences + container occurrences ────────────
  const toolkitContOccIds = {}; // contModKey → containerOccId (exposed for later tasks)
  // The Pomodoro template instance's OCCURRENCE id — Pomodoro: Start binds it
  // picker-direct as its COPY_LINK source. A FIND-by-label can't work here:
  // session copies inherit the module label ("Pomodoro"), so the SECOND
  // start of a day matched template + session #1 → array → broken create
  // ("each timeslot can have multiple pomodoros", 2026-07-14).
  let pomodoroTemplateOccId = null;
  // Action occurrence ids by dimension + key — Task 6 binds trackers and the
  // Daily Routine template picker-direct to these.
  const actionOccIds = {};

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(toolkitMappings)) {
    const childOccIds = [];
    actionOccIds[key] = {};
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      const defaultFields = {};
      // Money actions with a sensible starter amount so financial trackers
      // show non-zero values on first run.
      const toolkitDefaultAmounts = {
        spend:    35,  // generic tracked expense (~coffee + lunch)
        buy:      22,  // small purchase
        donate:   20,
        payBills: 85,  // generic pay-bill default until user picks billRef
        cancelSub: 15, // subscription cancellation fee / last charge
      };
      if (toolkitDefaultAmounts[instKey] !== undefined) {
        defaultFields[fields.amount.id] = fv(toolkitDefaultAmounts[instKey], "out");
      }
      // Track = the universal money occurrence (supersedes Set Account
      // Balance): seeded null + flow "replace" so the source opens in
      // set-the-balance mode; the visible flow toggle flips per entry.
      if (instKey === "track") {
        defaultFields[fields.amount.id] = fv(null, "replace");
      }
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: defaultFields });
      if (instKey === "pomodoro") pomodoroTemplateOccId = childId;
      actionOccIds[key][instKey] = childId;
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds, filterOverride: {} });
    toolkitContOccIds[contModKey] = contOccId;
  }

  // Extra pre-seeded Check In in the Emotional container (demonstrates the
  // mood wheel UI on first load — mirrors the old moodCheck pre-fill).
  const moodTodayOccId = await mkOcc({
    moduleId: actionInstances.checkIn.id,
    parentId: emotionalContOccId,
    sortOrder: 99, // append after the regular instances
    fields: {
      [fields.mood.id]: fv("focused", "in"),
    },
  });
  // Append to the emotional container's occurrences[]
  await Occurrence.findOneAndUpdate({ id: emotionalContOccId }, { $push: { occurrences: moodTodayOccId } });

  // ── Tasks page containers — EMPTY (2026-07-25) ─────────────────────────────
  // The user supplies task data. filterOverride: {} — task containers ignore
  // the date filter (old Todo List convention carried over).
  const taskContOccIds = {};
  for (const [tKey, tMod] of Object.entries(taskContainerMods)) {
    const tOccId = await mkOcc({ moduleId: tMod.id, occurrences: [], filterOverride: {} });
    taskContOccIds[tKey] = tOccId;
  }


  // ── Goal containers ────────────────────────────────────────────────────────
  // Goal containers do NOT get filterOverride: {} — date cascade from the
  // Goals page is intentional (matches createTestGrid physGoalContOccId convention).
  //
  // EXCEPTION — FINANCE (user 2026-07-10): the finance trackers KEEP their date
  // gate (timeFilter:"daily" + period-all's "empty period → do-all"), but their
  // containers opt OUT of the date cascade by DEFAULT (filterOverride:{}), so
  // $goalPeriod resolves EMPTY → the balances/finance totals are CUMULATIVE by
  // default. The gate still exists: activating the date filter on the container
  // (HeaderChevron → FiltersSection) narrows it to the picked day / span. This is
  // the "gate present but disabled by default" the user asked for — NOT the blunt
  // timeFilter:"all" (which removed the gate entirely).
  const DATE_FILTER_OFF_BY_DEFAULT = new Set(["financialGoal", "financeAccount"]);
  const goalMappings = {
    physicalGoal:      { contOccId: physicalGoalContOccId,      contModKey: "physicalGoal",      instKeys: ["physicalCompleted", "physicalWater", "physicalSteps", "physicalStreak", "physicalNow"] },
    intellectualGoal:  { contOccId: intellectualGoalContOccId,  contModKey: "intellectualGoal",  instKeys: ["intellectualPagesRead", "intellectualReadingTime", "intellectualPomodoros", "intellectualCourses"] },
    emotionalGoal:     { contOccId: emotionalGoalContOccId,     contModKey: "emotionalGoal",     instKeys: ["emotionalMood"] },
    socialGoal:        { contOccId: socialGoalContOccId,        contModKey: "socialGoal",        instKeys: ["socialConnectionTime", "socialPhoneCalls"] },
    spiritualGoal:     { contOccId: spiritualGoalContOccId,     contModKey: "spiritualGoal",     instKeys: ["spiritualPractice"] },
    occupationalGoal:  { contOccId: occupationalGoalContOccId,  contModKey: "occupationalGoal",  instKeys: ["occupationalWork"] },
    financialGoal:     { contOccId: financialGoalContOccId,     contModKey: "financialGoal",     instKeys: ["financialSpent", "financialIncome"] },
    environmentalGoal: { contOccId: environmentalGoalContOccId, contModKey: "environmentalGoal", instKeys: ["environmentalSummary"] },
    creativeGoal:      { contOccId: creativeGoalContOccId,      contModKey: "creativeGoal",      instKeys: ["creativeDuration"] },
    workoutGoal:       { contOccId: workoutGoalContOccId,       contModKey: "workoutGoal",       instKeys: ["workoutReps", "workoutLog", "chestVolumeGoal", "backVolumeGoal", "legsVolumeGoal", "shouldersVolumeGoal", "armsVolumeGoal", "cardioVolumeGoal"] },
    nutritionGoal:     { contOccId: nutritionGoalContOccId,     contModKey: "nutritionGoal",     instKeys: ["nutritionProtein", "nutritionCarbs", "nutritionFats", "nutritionLog", "breakfastNutritionGoal", "lunchNutritionGoal", "dinnerNutritionGoal", "snackNutritionGoal"] },
    planningGoal:      { contOccId: planningGoalContOccId,      contModKey: "planningGoal",      instKeys: ["planningOverdue", "planningUpcoming"] },
    mediaGoal:         { contOccId: mediaGoalContOccId,         contModKey: "mediaGoal",         instKeys: ["mediaMovies", "mediaBooks", "mediaPodcasts"] },
    // (coursesTakenGoal entry removed — courses is part of Intellectual now.)
  };

  const goalContOccIds = {};

  // Pre-generate occurrence IDs for goal + account display instances so tracker
  // ops can reference them by id (rename-stable, picker-friendly) instead of
  // FIND-by-label. Consumed below in the goal/account creation loops AND at
  // every tracker call site (`goalOccurrenceId: goalOccIds.<key>`).
  // Stage 2 of the Goals restructure — see handoff 2026-05-20 (item b).
  const goalOccIds = {};
  for (const k of Object.keys(goalInstances)) goalOccIds[k] = uid();
  const accountOccIds = {};
  for (const k of Object.keys(accountInstances)) accountOccIds[k] = uid();

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(goalMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      const childId = await mkOcc({ id: goalOccIds[instKey], moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: {} });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds,
      ...(DATE_FILTER_OFF_BY_DEFAULT.has(contModKey) ? { filterOverride: {} } : {}) });
    goalContOccIds[contModKey] = contOccId;
  }

  // ── Account containers ─────────────────────────────────────────────────────
  // Account containers are all-time aggregations — no filterOverride needed.
  const accountMappings = {
    financeAccount:      { contOccId: financeAccountContOccId,      contModKey: "financeAccount",      instKeys: ["bankAccount", "savingsAccount", "momsAccount", "cashAccount", "netWorth", "totalSubscriptions", "monthlyBills"] },
    fitnessAccount:      { contOccId: fitnessAccountContOccId,      contModKey: "fitnessAccount",      instKeys: ["fitnessAccount"] },
    learningAccount:     { contOccId: learningAccountContOccId,     contModKey: "learningAccount",     instKeys: ["readingAccount"] },
    productivityAccount: { contOccId: productivityAccountContOccId, contModKey: "productivityAccount", instKeys: ["productivityAccount"] },
    wellnessAccount:     { contOccId: wellnessAccountContOccId,     contModKey: "wellnessAccount",     instKeys: ["wellnessAccount"] },
  };

  const accountContOccIds = {};

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(accountMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      const childId = await mkOcc({ id: accountOccIds[instKey], moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: {} });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds,
      ...(DATE_FILTER_OFF_BY_DEFAULT.has(contModKey) ? { filterOverride: {} } : {}) });
    accountContOccIds[contModKey] = contOccId;
  }

  // ── Bill containers + instances (B3 from carry-over plan) ──────────────────
  // Bills page (under Library folder) hosts 5 sub-containers by bill type.
  // Each bill instance carries amount + accountRef + cadence/day/anchor +
  // billNextDue. Initial billNextDue is computed JS-side from cadence + day
  // (+ anchor for every-n-days) so the seed lands realistic next-due values
  // per cadence shape. The Bill: Compute Next Due op (C1 follow-up) will
  // recompute these on cadence-field changes.
  const fortyTwoDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 42); d.setHours(12, 0, 0, 0);
    return d.toISOString();
  })();
  // Compute next-due ISO for a bill given its cadence shape. monthly /
  // quarterly / yearly land on the given day-of-month at the upcoming
  // cycle boundary; weekly / biweekly advance by 7/14 days from today;
  // every-n-days advances anchor + N until > today.
  const computeNextDue = (cadence, day, n, anchorIso) => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const out = new Date(today);
    if (cadence === "monthly" && Number.isFinite(day)) {
      out.setDate(day);
      if (out <= today) out.setMonth(out.getMonth() + 1);
    } else if (cadence === "quarterly" && Number.isFinite(day)) {
      out.setDate(day);
      while (out <= today) out.setMonth(out.getMonth() + 3);
    } else if (cadence === "yearly" && Number.isFinite(day)) {
      out.setDate(day);
      while (out <= today) out.setFullYear(out.getFullYear() + 1);
    } else if (cadence === "weekly") {
      out.setDate(out.getDate() + 7);
    } else if (cadence === "biweekly") {
      out.setDate(out.getDate() + 14);
    } else if (cadence === "every-n-days" && Number.isFinite(n) && anchorIso) {
      const a = new Date(anchorIso); a.setHours(12, 0, 0, 0);
      const next = new Date(a);
      while (next <= today) next.setDate(next.getDate() + n);
      return next.toISOString();
    } else {
      // Unknown cadence → default 30 days out so the field has SOMETHING.
      out.setDate(out.getDate() + 30);
    }
    return out.toISOString();
  };
  const billDefaults = {
    // Each entry: { amount(out), cadence, day-of-month, anchor (for every-n-days) }
    netflixSub:          { amount: 15.99, cadence: "monthly", day: 8 },
    spotifySub:          { amount: 11.99, cadence: "monthly", day: 12 },
    iCloudSub:           { amount: 2.99,  cadence: "monthly", day: 20 },
    electricBill:        { amount: 95.0,  cadence: "monthly", day: 5 },
    waterBill:           { amount: 38.0,  cadence: "monthly", day: 18 },
    internetBill:        { amount: 65.0,  cadence: "monthly", day: 10 },
    phoneBill:           { amount: 55.0,  cadence: "monthly", day: 22 },
    carInsuranceBill:    { amount: 180.0, cadence: "every-n-days", n: 180, anchor: fortyTwoDaysAgo },
    renterInsuranceBill: { amount: 22.0,  cadence: "monthly", day: 1 },
    studentLoanBill:     { amount: 285.0, cadence: "monthly", day: 15 },
    rentMortgage:        { amount: 1450.0,cadence: "monthly", day: 1 },
  };
  const billMappings = {
    billSubscriptions: { contOccId: billSubscriptionsContOccId, contModKey: "billSubscriptions", instKeys: ["netflixSub", "spotifySub", "iCloudSub"] },
    billUtilities:     { contOccId: billUtilitiesContOccId,     contModKey: "billUtilities",     instKeys: ["electricBill", "waterBill", "internetBill", "phoneBill"] },
    billInsurance:     { contOccId: billInsuranceContOccId,     contModKey: "billInsurance",     instKeys: ["carInsuranceBill", "renterInsuranceBill"] },
    billLoans:         { contOccId: billLoansContOccId,         contModKey: "billLoans",         instKeys: ["studentLoanBill"] },
    billOther:         { contOccId: billOtherContOccId,         contModKey: "billOther",         instKeys: ["rentMortgage"] },
  };
  const billContOccIds = {};
  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(billMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      const def = billDefaults[instKey] || {};
      const defaultFields = {};
      if (def.amount !== undefined)     defaultFields[fields.amount.id]        = fv(def.amount, "out");
      if (def.cadence)                  defaultFields[fields.billCadence.id]   = fv(def.cadence, "in");
      if (def.day !== undefined)        defaultFields[fields.billDay.id]       = fv(def.day, "in");
      if (def.n !== undefined)          defaultFields[fields.billCadenceN.id]  = fv(def.n, "in");
      if (def.anchor)                   defaultFields[fields.billAnchor.id]    = fv(def.anchor, "in");
      // Compute initial next-due from cadence shape. C1 (Bill: Compute Next
      // Due) op recomputes this on cadence-field changes.
      const initialDue = computeNextDue(def.cadence, def.day, def.n, def.anchor);
      defaultFields[fields.billNextDue.id] = fv(initialDue, "in");
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: defaultFields });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds, filterOverride: {} });
    billContOccIds[contModKey] = contOccId;
  }

  // ── Library: movies + books + podcasts + courses modules + container + page + field patches ──
  //
  // Mirrors createTestGrid STEP 3 (movie modules), STEP 4 (libraryContModId already
  // added to containerDocs above), STEP 6 (library occurrences), STEP 8 (library page).
  // All done here so libraryContOccId exists before STEP 7 folder tree references it.
  // filterOverride:{} on both container and page — always visible, no date filter.

  // Library bindings — every library entry now also binds posterUrl with
  // role:"media" so the ModuleInstance media block renders the cover image
  // under the label/fields row. Value stays per-occurrence (stamped further
  // below) so the same entry could carry different cover URLs in different
  // contexts if anyone ever wants that.
  const movieFieldBindings = [
    { fieldId: libraryFieldId, role: "input", order: 0, hidden: true },
    { fieldId: posterUrlFieldId, role: "media", order: 1, hidden: true },
  ];
  // 8 movie modules (role:"instance", hidden library + poster bindings)
  await Module.insertMany([
    { id: movieInceptionModId,       userId, gridId, role: "instance", kind: "board", label: "Inception",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieMatrixModId,          userId, gridId, role: "instance", kind: "board", label: "The Matrix",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieArrivalModId,         userId, gridId, role: "instance", kind: "board", label: "Arrival",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieDuneModId,            userId, gridId, role: "instance", kind: "board", label: "Dune",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieInterstellarModId,    userId, gridId, role: "instance", kind: "board", label: "Interstellar",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieBladeRunner2049ModId, userId, gridId, role: "instance", kind: "board", label: "Blade Runner 2049",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: moviePrestigeModId,        userId, gridId, role: "instance", kind: "board", label: "The Prestige",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieTenetModId,           userId, gridId, role: "instance", kind: "board", label: "Tenet",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
  ]);

  // 7 book modules — fieldBindings include libraryFieldId (type), pagesFieldId
  // (page count) AND posterUrl (cover image, role:"media"), all hidden as
  // inline inputs (media block renders separately below the label).
  const bookFieldBindings = [
    { fieldId: libraryFieldId,   role: "input", order: 0, hidden: true },
    { fieldId: pagesFieldId,     role: "input", order: 1, hidden: true },
    { fieldId: posterUrlFieldId, role: "media", order: 2, hidden: true },
  ];
  await Module.insertMany([
    { id: bookAtomicHabitsModId,     userId, gridId, role: "instance", kind: "board", label: "Atomic Habits",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookDeepWorkModId,         userId, gridId, role: "instance", kind: "board", label: "Deep Work",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookSapiensModId,          userId, gridId, role: "instance", kind: "board", label: "Sapiens",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookThinkingFastSlowModId, userId, gridId, role: "instance", kind: "board", label: "Thinking, Fast and Slow",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookMeditationsModId,      userId, gridId, role: "instance", kind: "board", label: "Meditations",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookMansSearchModId,       userId, gridId, role: "instance", kind: "board", label: "Man's Search for Meaning",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: book4HourWorkweekModId,    userId, gridId, role: "instance", kind: "board", label: "The 4-Hour Workweek",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
  ]);

  // Podcast / course modules share the same bindings shape: library type +
  // poster URL (hidden) so the cover image renders below the label.
  const podcastFieldBindings = [
    { fieldId: libraryFieldId,   role: "input", order: 0, hidden: true },
    { fieldId: posterUrlFieldId, role: "media", order: 1, hidden: true },
  ];
  const courseFieldBindings = [
    { fieldId: libraryFieldId,   role: "input", order: 0, hidden: true },
    { fieldId: posterUrlFieldId, role: "media", order: 1, hidden: true },
  ];

  // 5 podcast modules
  await Module.insertMany([
    { id: podcastTimFerrissModId,      userId, gridId, role: "instance", kind: "board", label: "The Tim Ferriss Show",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastLexFridmanModId,      userId, gridId, role: "instance", kind: "board", label: "Lex Fridman Podcast",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastHardcoreHistoryModId, userId, gridId, role: "instance", kind: "board", label: "Hardcore History",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastHubermanLabModId,     userId, gridId, role: "instance", kind: "board", label: "Huberman Lab",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastConvosTylerModId,     userId, gridId, role: "instance", kind: "board", label: "Conversations with Tyler",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
  ]);

  // 4 course modules
  await Module.insertMany([
    { id: courseAlgorithmsModId,      userId, gridId, role: "instance", kind: "board", label: "Algorithms (Coursera)",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseMLSpecModId,          userId, gridId, role: "instance", kind: "board", label: "Machine Learning Specialization",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseSystemDesignModId,    userId, gridId, role: "instance", kind: "board", label: "System Design Primer",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseIntroPhilosophyModId, userId, gridId, role: "instance", kind: "board", label: "Introduction to Philosophy",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
  ]);

  // 10 person modules (task #46, 2026-05-22). Profile fields are bound
  // visibly (name/email/phone/gender shown inline as field pills on the
  // instance row in the People table). Notes is a longer text bound
  // hidden (rendered in the profile card via the page-template). posterUrl
  // shares the Library media pipeline; rendered as a thumbnail via the
  // role:"media" binding (same as movie/book covers).
  const personFieldBindings = [
    { fieldId: libraryFieldId,         role: "input", order: 0,  hidden: true },
    { fieldId: posterUrlFieldId,       role: "media", order: 1,  hidden: true },
    { fieldId: personNameFieldId,      role: "input", order: 2 },
    { fieldId: personEmailFieldId,     role: "input", order: 3 },
    { fieldId: personPhoneFieldId,     role: "input", order: 4 },
    { fieldId: personGenderFieldId,    role: "input", order: 5 },
    { fieldId: personRelationshipFieldId, role: "input", order: 6 },
    { fieldId: personBirthdayFieldId,  role: "input", order: 7 },
    { fieldId: personCompanyFieldId,   role: "input", order: 8 },
    { fieldId: personJobTitleFieldId,  role: "input", order: 9 },
    { fieldId: personCityFieldId,      role: "input", order: 10 },
    { fieldId: personAddressFieldId,   role: "input", order: 11, hidden: true },
    { fieldId: personWebsiteFieldId,   role: "input", order: 12, hidden: true },
    { fieldId: personInstagramFieldId, role: "input", order: 13, hidden: true },
    { fieldId: personTwitterFieldId,   role: "input", order: 14, hidden: true },
    { fieldId: personLinkedInFieldId,  role: "input", order: 15, hidden: true },
    { fieldId: personLastContactFieldId,     role: "input", order: 16, hidden: true },
    { fieldId: personFavoriteFoodFieldId,    role: "input", order: 17, hidden: true },
    { fieldId: personAllergiesFieldId,       role: "input", order: 18, hidden: true },
    { fieldId: personInterestsFieldId,       role: "input", order: 19, hidden: true },
    { fieldId: personHowMetFieldId,          role: "input", order: 20, hidden: true },
    { fieldId: personEmergencyContactFieldId, role: "input", order: 21, hidden: true },
    { fieldId: personNotesFieldId,     role: "input", order: 22, hidden: true },
    // (Show Profile button binding removed 2026-07-25 — People is a board.)
  ];
  await Module.insertMany([
    { id: personAvaModId,    userId, gridId, role: "instance", kind: "board", label: "Ava Martinez",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personBenModId,    userId, gridId, role: "instance", kind: "board", label: "Ben Chen",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personChloeModId,  userId, gridId, role: "instance", kind: "board", label: "Chloe Patel",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personDevenModId,  userId, gridId, role: "instance", kind: "board", label: "Deven Wright",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personEliseModId,  userId, gridId, role: "instance", kind: "board", label: "Elise Nakamura",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personFelixModId,  userId, gridId, role: "instance", kind: "board", label: "Felix Romero",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personGraceModId,  userId, gridId, role: "instance", kind: "board", label: "Grace Okonkwo",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personHenryModId,  userId, gridId, role: "instance", kind: "board", label: "Henry Lindqvist",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personIsabelModId, userId, gridId, role: "instance", kind: "board", label: "Isabel Sokolov",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
    { id: personJackModId,   userId, gridId, role: "instance", kind: "board", label: "Jack Brennan",
      defaultDragMode: "move", fieldBindings: personFieldBindings },
  ]);

  // Reflection question modules (library type "question"). One Module per
  // entry in PHIL_QUESTIONS — the Daily Question Rotator op (and the Daily
  // Question container's header dropdown via journalQuestion's find-mode
  // optionsSource over libraryFieldId="question") picks one of these labels
  // at runtime. Spans Stoicism, Daoism, inner alchemy, Alan Watts, Jung,
  // esoteric Christianity, Zen, mindfulness, omnism, the Philosopher's
  // Stone, mythology / Joseph Campbell, synchronicity, symbolism, Native
  // American wisdom, Ram Dass, Krishnamurti, Thich Nhat Hanh, Eckhart
  // Tolle, Terence McKenna, progressive solidarity, and freedom from
  // oppression — see PHIL_QUESTIONS array at top of file for comments.
  await Module.insertMany(
    PHIL_QUESTIONS.map((label, i) => ({
      id: phQuestionModIds[i],
      userId, gridId,
      role: "instance", kind: "board",
      label,
      defaultDragMode: "move",
      fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }],
    }))
  );

  // Poster URLs per library entry. OpenLibrary covers (by ISBN) are stable
  // and free for books; for movies / podcasts / courses we use placehold.co
  // (a real public placeholder service) with category-coded backgrounds and
  // the title overlaid as text. Real TMDB/Wikipedia URLs can be swapped in
  // per-entry later — values live on each library OCCURRENCE under
  // fields[posterUrlFieldId].value, so a user edit just rewrites that one.
  const ph = (bg, text, title) =>
    `https://placehold.co/300x450/${bg}/${text}.jpg?text=${encodeURIComponent(title)}&font=oswald`;
  const movieBg   = "1d4ed8"; // blue-700
  const bookBg    = "92400e"; // amber-800
  const podcastBg = "7c2d92"; // purple-800
  const courseBg  = "065f46"; // emerald-800
  const txt       = "ffffff";
  const moviePosters = {
    Inception:           ph(movieBg, txt, "Inception"),
    "The Matrix":        ph(movieBg, txt, "The Matrix"),
    Arrival:             ph(movieBg, txt, "Arrival"),
    Dune:                ph(movieBg, txt, "Dune"),
    Interstellar:        ph(movieBg, txt, "Interstellar"),
    "Blade Runner 2049": ph(movieBg, txt, "Blade Runner 2049"),
    "The Prestige":      ph(movieBg, txt, "The Prestige"),
    Tenet:               ph(movieBg, txt, "Tenet"),
  };
  // Books — real OpenLibrary covers by ISBN for the ones with known ISBNs;
  // placeholder for the rest. The OL cover endpoint returns 1x1 if not
  // found, which still looks reasonable; placeholders below are explicit
  // fallbacks so every cell renders something distinctive.
  const bookPosters = {
    "Atomic Habits":              "https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg",
    "Deep Work":                  "https://covers.openlibrary.org/b/isbn/9781455586691-L.jpg",
    Sapiens:                      "https://covers.openlibrary.org/b/isbn/9780062316097-L.jpg",
    "Thinking, Fast and Slow":    "https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg",
    Meditations:                  "https://covers.openlibrary.org/b/isbn/9780812968255-L.jpg",
    "Man's Search for Meaning":   "https://covers.openlibrary.org/b/isbn/9780807014295-L.jpg",
    "The 4-Hour Workweek":        "https://covers.openlibrary.org/b/isbn/9780307465351-L.jpg",
  };
  const podcastPosters = {
    "The Tim Ferriss Show":       ph(podcastBg, txt, "Tim Ferriss"),
    "Lex Fridman Podcast":        ph(podcastBg, txt, "Lex Fridman"),
    "Hardcore History":           ph(podcastBg, txt, "Hardcore History"),
    "Huberman Lab":               ph(podcastBg, txt, "Huberman Lab"),
    "Conversations with Tyler":   ph(podcastBg, txt, "Conversations with Tyler"),
  };
  const coursePosters = {
    "Algorithms (Coursera)":           ph(courseBg, txt, "Algorithms"),
    "Machine Learning Specialization": ph(courseBg, txt, "ML Specialization"),
    "System Design Primer":            ph(courseBg, txt, "System Design"),
    "Introduction to Philosophy":      ph(courseBg, txt, "Intro to Philosophy"),
  };
  const libFields = (libraryType, title, posterMap) => {
    const out = { [libraryFieldId]: fv(libraryType) };
    const url = posterMap[title];
    if (url) out[posterUrlFieldId] = fv(url);
    return out;
  };

  // Helper for book fields (adds pages alongside library+poster). Every book
  // is also a Readings-board option (boardCategory:"reading", 2026-07-25) —
  // the Reading dropdown lists it and the Readings board feed pulls it in.
  const bookFields = (title, pages) => ({
    ...libFields("book", title, bookPosters),
    [pagesFieldId]: fv(pages),
    [boardCategoryFieldId]: fv("reading"),
  });

  // 8 movie occurrences (parentId = libraryContOccId, library field = "movie")
  const movieInceptionOccId       = await mkOcc({ moduleId: movieInceptionModId,       parentId: libraryContOccId, fields: libFields("movie", "Inception",           moviePosters) });
  const movieMatrixOccId          = await mkOcc({ moduleId: movieMatrixModId,          parentId: libraryContOccId, fields: libFields("movie", "The Matrix",          moviePosters) });
  const movieArrivalOccId         = await mkOcc({ moduleId: movieArrivalModId,         parentId: libraryContOccId, fields: libFields("movie", "Arrival",             moviePosters) });
  const movieDuneOccId            = await mkOcc({ moduleId: movieDuneModId,            parentId: libraryContOccId, fields: libFields("movie", "Dune",                moviePosters) });
  const movieInterstellarOccId    = await mkOcc({ moduleId: movieInterstellarModId,    parentId: libraryContOccId, fields: libFields("movie", "Interstellar",        moviePosters) });
  const movieBladeRunner2049OccId = await mkOcc({ moduleId: movieBladeRunner2049ModId, parentId: libraryContOccId, fields: libFields("movie", "Blade Runner 2049",   moviePosters) });
  const moviePrestigeOccId        = await mkOcc({ moduleId: moviePrestigeModId,        parentId: libraryContOccId, fields: libFields("movie", "The Prestige",        moviePosters) });
  const movieTenetOccId           = await mkOcc({ moduleId: movieTenetModId,           parentId: libraryContOccId, fields: libFields("movie", "Tenet",               moviePosters) });

  // 7 book occurrences (library field = "book")
  const bookAtomicHabitsOccId     = await mkOcc({ moduleId: bookAtomicHabitsModId,     parentId: libraryContOccId, fields: bookFields("Atomic Habits",            320) });
  const bookDeepWorkOccId         = await mkOcc({ moduleId: bookDeepWorkModId,         parentId: libraryContOccId, fields: bookFields("Deep Work",                304) });
  const bookSapiensOccId          = await mkOcc({ moduleId: bookSapiensModId,          parentId: libraryContOccId, fields: bookFields("Sapiens",                  464) });
  const bookThinkingFastSlowOccId = await mkOcc({ moduleId: bookThinkingFastSlowModId, parentId: libraryContOccId, fields: bookFields("Thinking, Fast and Slow",  499) });
  const bookMeditationsOccId      = await mkOcc({ moduleId: bookMeditationsModId,      parentId: libraryContOccId, fields: bookFields("Meditations",              304) });
  const bookMansSearchOccId       = await mkOcc({ moduleId: bookMansSearchModId,       parentId: libraryContOccId, fields: bookFields("Man's Search for Meaning", 165) });
  const book4HourWorkweekOccId    = await mkOcc({ moduleId: book4HourWorkweekModId,    parentId: libraryContOccId, fields: bookFields("The 4-Hour Workweek",      320) });

  // 5 podcast occurrences (library field = "podcast")
  const podcastTimFerrissOccId      = await mkOcc({ moduleId: podcastTimFerrissModId,      parentId: libraryContOccId, fields: libFields("podcast", "The Tim Ferriss Show",     podcastPosters) });
  const podcastLexFridmanOccId      = await mkOcc({ moduleId: podcastLexFridmanModId,      parentId: libraryContOccId, fields: libFields("podcast", "Lex Fridman Podcast",      podcastPosters) });
  const podcastHardcoreHistoryOccId = await mkOcc({ moduleId: podcastHardcoreHistoryModId, parentId: libraryContOccId, fields: libFields("podcast", "Hardcore History",         podcastPosters) });
  const podcastHubermanLabOccId     = await mkOcc({ moduleId: podcastHubermanLabModId,     parentId: libraryContOccId, fields: libFields("podcast", "Huberman Lab",             podcastPosters) });
  const podcastConvosTylerOccId     = await mkOcc({ moduleId: podcastConvosTylerModId,     parentId: libraryContOccId, fields: libFields("podcast", "Conversations with Tyler", podcastPosters) });

  // 4 course occurrences (library field = "course"). Also tagged
  // boardCategory:"course" (2026-07-25) so the multi-board Media dropdown
  // (media|song|course) lists them and the Courses board feed pulls them in.
  const courseFields = (title) => ({ ...libFields("course", title, coursePosters), [boardCategoryFieldId]: fv("course") });
  const courseAlgorithmsOccId      = await mkOcc({ moduleId: courseAlgorithmsModId,      parentId: libraryContOccId, fields: courseFields("Algorithms (Coursera)") });
  const courseMLSpecOccId          = await mkOcc({ moduleId: courseMLSpecModId,          parentId: libraryContOccId, fields: courseFields("Machine Learning Specialization") });
  const courseSystemDesignOccId    = await mkOcc({ moduleId: courseSystemDesignModId,    parentId: libraryContOccId, fields: courseFields("System Design Primer") });
  const courseIntroPhilosophyOccId = await mkOcc({ moduleId: courseIntroPhilosophyModId, parentId: libraryContOccId, fields: courseFields("Introduction to Philosophy") });

  // 2 extra Readings-board entries (2026-07-25): scripture/philosophy texts
  // for Read Scripture / Read Philosophy. Regular Library books (tagged
  // reading like the rest) — Meditations already covers the third.
  const bookTaoTeChingModId = uid();
  const bookPsalmsModId     = uid();
  await Module.insertMany([
    { id: bookTaoTeChingModId, userId, gridId, role: "instance", kind: "board", label: "Tao Te Ching",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookPsalmsModId,     userId, gridId, role: "instance", kind: "board", label: "Book of Psalms",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
  ]);
  const bookTaoTeChingOccId = await mkOcc({ moduleId: bookTaoTeChingModId, parentId: libraryContOccId, fields: bookFields("Tao Te Ching", 160) });
  const bookPsalmsOccId     = await mkOcc({ moduleId: bookPsalmsModId,     parentId: libraryContOccId, fields: bookFields("Book of Psalms", 260) });

  // 10 person occurrences (library field = "person"). Each carries profile
  // fields (name/email/phone/gender/notes) so the People table renders them
  // and the Profile-Card APPLY_TEMPLATE op copies the values into the card.
  // Profile picture uses thispersondoesnotexist-style placeholder so we
  // don't ship real photos in the seed; user can swap per-row later.
  const personPosterFor = (gender, seed) =>
    `https://i.pravatar.cc/300?img=${seed}`;
  // Rich profile data (#46, 2026-05-23). Each entry now carries every
  // profile field so the profile card looks fully populated on first load
  // and demonstrates the full surface. Realistic-but-fictional content.
  const peopleSeed = [
    {
      modId: personAvaModId, occId: undefined, label: "Ava Martinez", seed: 1,
      name: "Ava Martinez", email: "ava.martinez@studio-six.com", phone: "+1 415 555 0142", gender: "female", relationship: "colleague",
      birthday: "1992-04-17", city: "San Francisco, CA", address: "421 Folsom St, Apt 12B, San Francisco, CA 94105",
      company: "Studio Six", jobTitle: "Senior Product Designer",
      website: "https://avamartinez.design", instagram: "ava.designs", twitter: "ava_mtz", linkedin: "ava-martinez-design",
      lastContact: "2026-05-14", favoriteFood: "Vietnamese pho", allergies: "Tree nuts (severe — has EpiPen)",
      interests: "Type design, kintsugi, climbing, vinyl records",
      howMet: "Met at WWDC 2024 in line for the design lab. Bonded over a shared frustration with default macOS shortcuts.",
      emergencyContact: "Carlos Martinez (brother) +1 415 555 0144",
      notes: "Designer @ Studio Six. Prefers async; great for product critiques. Strong opinions on type — always run typography past her before shipping.",
    },
    {
      modId: personBenModId, occId: undefined, label: "Ben Chen", seed: 12,
      name: "Ben Chen", email: "ben@chen.dev", phone: "+1 206 555 0188", gender: "male", relationship: "close friend",
      birthday: "1990-11-03", city: "Seattle, WA", address: "1408 NE 65th St, Seattle, WA 98115",
      company: "Cloudshift", jobTitle: "Staff Infrastructure Engineer",
      website: "https://chen.dev", instagram: "", twitter: "benchen_io", linkedin: "ben-chen-eng",
      lastContact: "2026-05-19", favoriteFood: "Sichuan dry-fried green beans", allergies: "None",
      interests: "Mechanical keyboards, distributed systems, bouldering, Magic: the Gathering",
      howMet: "College roommates at CMU. Started Cloudshift together; he stayed, I left. Still review each other's deploy plans.",
      emergencyContact: "Mei Chen (sister) +1 206 555 0190",
      notes: "Infra eng. Owns the deploy pipeline. Reach out before any infra-touching PR. Best person on the planet for incident postmortems.",
    },
    {
      modId: personChloeModId, occId: undefined, label: "Chloe Patel", seed: 5,
      name: "Chloe Patel", email: "chloe.patel@mit.edu", phone: "+1 617 555 0199", gender: "female", relationship: "colleague",
      birthday: "1996-09-22", city: "Cambridge, MA", address: "77 Massachusetts Ave, Cambridge, MA 02139",
      company: "MIT Brain & Cognitive Sciences", jobTitle: "PhD Candidate (cognitive science)",
      website: "https://chloepatel.science", instagram: "chloepatel.brain", twitter: "chloepatel", linkedin: "chloe-patel-cogsci",
      lastContact: "2026-05-09", favoriteFood: "Saag paneer", allergies: "Shellfish",
      interests: "Long-term memory consolidation, sleep research, indie chess, baroque violin",
      howMet: "Reached out cold after I cited her advisor's paper in a blog post. We've collaborated on the memory-replay model since.",
      emergencyContact: "Anjali Patel (mother) +1 617 555 0200",
      notes: "PhD candidate, cognitive science. Collaborator on the long-term memory paper. Defends spring 2027 — invite to send her a draft of the launch announcement for review.",
    },
    {
      modId: personDevenModId, occId: undefined, label: "Deven Wright", seed: 13,
      name: "Deven Wright", email: "deven@wright.studio", phone: "+1 312 555 0117", gender: "non-binary", relationship: "friend",
      birthday: "1994-02-14", city: "Chicago, IL", address: "1933 W Division St #2, Chicago, IL 60622",
      company: "Wright Studio (freelance)", jobTitle: "Illustrator & motion designer",
      website: "https://wright.studio", instagram: "deven.draws", twitter: "deven_wright", linkedin: "deven-wright-studio",
      lastContact: "2026-05-22", favoriteFood: "Korean fried chicken", allergies: "None",
      interests: "Risograph printing, hand-drawn animation, vintage signage, urban sketching",
      howMet: "Hired them to do the v1 marketing site banner via a friend's recommendation. Stayed in touch since.",
      emergencyContact: "Robin Wright (partner) +1 312 555 0119",
      notes: "Illustrator. Did the marketing site banner. Quoted for v2 redesign in Q3 — block 3 weeks. Prefers a hand-off via Loom not email.",
    },
    {
      modId: personEliseModId, occId: undefined, label: "Elise Nakamura", seed: 9,
      name: "Elise Nakamura", email: "elise.n@bridge-labs.io", phone: "+1 415 555 0203", gender: "female", relationship: "client",
      birthday: "1987-07-30", city: "San Francisco, CA", address: "535 Mission St, 14th Floor, San Francisco, CA 94105",
      company: "Bridge Labs", jobTitle: "Founder & CEO",
      website: "https://bridge-labs.io", instagram: "", twitter: "elisenakamura", linkedin: "elise-nakamura-bridgelabs",
      lastContact: "2026-05-17", favoriteFood: "Hand-rolled udon", allergies: "Gluten (mild — manages)",
      interests: "AI safety, women-in-tech mentoring, Japanese ceramics, Pilates",
      howMet: "Intro from Ben at the Cloudshift annual. We had a 30-min hallway chat about pricing models and she followed up the next day.",
      emergencyContact: "Naoki Nakamura (father) +1 415 555 0205",
      notes: "Bridge Labs founder. Potential investor for the assistant product. Wants quarterly updates regardless of investment status. Prefers Sunday-night emails (she catches up then).",
    },
    {
      modId: personFelixModId, occId: undefined, label: "Felix Romero", seed: 14,
      name: "Felix Romero", email: "felix@romero.coffee", phone: "+1 510 555 0166", gender: "male", relationship: "friend",
      birthday: "1988-09-03", city: "Oakland, CA", address: "2440 Telegraph Ave, Oakland, CA 94612",
      company: "Romero Coffee Roasters", jobTitle: "Owner & head roaster",
      website: "https://romero.coffee", instagram: "romerocoffee", twitter: "", linkedin: "",
      lastContact: "2026-05-20", favoriteFood: "Carne asada tacos at El Farolito", allergies: "None",
      interests: "Single-origin coffee, vinyl, soccer (Liga MX), fly-fishing",
      howMet: "Was a regular at the 18th st cafe before he opened his own; we kept the habit when he moved.",
      emergencyContact: "Maria Romero (wife) +1 510 555 0168",
      notes: "Owns the coffee shop on 18th. Birthday: Sep 3 — drop by with the usual bottle of mezcal. Knows everyone in the Mission food scene.",
    },
    {
      modId: personGraceModId, occId: undefined, label: "Grace Okonkwo", seed: 16,
      name: "Grace Okonkwo", email: "grace@okonkwo.law", phone: "+1 202 555 0177", gender: "female", relationship: "client",
      birthday: "1980-12-11", city: "Washington, DC", address: "1100 H St NW, Suite 500, Washington, DC 20005",
      company: "Okonkwo Law Group", jobTitle: "Managing Partner",
      website: "https://okonkwo.law", instagram: "", twitter: "okonkwolaw", linkedin: "grace-okonkwo-esq",
      lastContact: "2026-04-30", favoriteFood: "Jollof rice", allergies: "None",
      interests: "Constitutional law, classical piano, mentorship, marathon running",
      howMet: "Hired her firm for the ToS / privacy review. She personally took the call when we were freaking out about a takedown.",
      emergencyContact: "Adaeze Okonkwo (sister, also at the firm) +1 202 555 0179",
      notes: "Lawyer; reviewed the ToS draft. Bills hourly — keep questions batched. Will answer urgent things by text within an hour but everything else goes through her paralegal.",
    },
    {
      modId: personHenryModId, occId: undefined, label: "Henry Lindqvist", seed: 33,
      name: "Henry Lindqvist", email: "henry.l@nord-fjord.no", phone: "+47 22 555 198", gender: "male", relationship: "colleague",
      birthday: "1976-06-08", city: "Oslo, Norway", address: "Karl Johans gate 22, 0159 Oslo, Norway",
      company: "Nord Fjord Distribution", jobTitle: "Head of Partnerships, Europe",
      website: "https://nord-fjord.no", instagram: "", twitter: "", linkedin: "henry-lindqvist-no",
      lastContact: "2026-03-12", favoriteFood: "Rakfisk (acquired taste — he made me try it)", allergies: "None",
      interests: "Cross-country skiing, jazz quartets, woodworking, English language idioms",
      howMet: "Cold-emailed us about Nordic distribution after seeing our launch on Hacker News. Visited their Oslo office spring 2025.",
      emergencyContact: "Astrid Lindqvist (wife) +47 22 555 200",
      notes: "Nordic distributor. Fluent EN/NO. Annual review every Dec. Prefers in-person where possible — happy to fly out if budget allows.",
    },
    {
      modId: personIsabelModId, occId: undefined, label: "Isabel Sokolov", seed: 26,
      name: "Isabel Sokolov", email: "isabel@sokolov.art", phone: "+1 718 555 0211", gender: "female", relationship: "friend",
      birthday: "1991-01-19", city: "Brooklyn, NY", address: "388 Broadway, 4F, Brooklyn, NY 11211",
      company: "Sokolov Studio", jobTitle: "Composer & sound designer",
      website: "https://sokolov.art", instagram: "isabelsokolov", twitter: "isabel_sokolov", linkedin: "isabel-sokolov",
      lastContact: "2026-05-11", favoriteFood: "Borscht (her grandmother's recipe)", allergies: "None",
      interests: "Modular synths, film scoring, ballet history, foraging",
      howMet: "Did the sound design for the canvas-mode demo. Felix introduced us — they've known each other since music school.",
      emergencyContact: "Mark Sokolov (father) +1 718 555 0213",
      notes: "Composer. Sound design for the canvas-mode demo. Studio sessions are Tue/Thu only — don't suggest other days, it never works.",
    },
    {
      modId: personJackModId, occId: undefined, label: "Jack Brennan", seed: 11,
      name: "Jack Brennan", email: "jack@brennan.house", phone: "+1 415 555 0223", gender: "male", relationship: "close friend",
      birthday: "1989-08-25", city: "San Francisco, CA", address: "1842 Greenwich St, San Francisco, CA 94123",
      company: "Brennan & Co (real estate)", jobTitle: "Broker",
      website: "https://brennan.house", instagram: "jbrennan_sf", twitter: "", linkedin: "jack-brennan-sf",
      lastContact: "2026-05-23", favoriteFood: "In-N-Out double-double animal style", allergies: "None",
      interests: "Half-marathons, golden retrievers, single-malt scotch, Warriors basketball",
      howMet: "College freshmen suitemates. Best man at his wedding. He's seen every dumb thing I've done since 2008.",
      emergencyContact: "Sarah Brennan (wife) +1 415 555 0225",
      notes: "Best friend since college. Pinged for non-work; weekly run on Sat mornings (8am Crissy Field). Knows the SF housing market top-to-bottom.",
    },
  ];
  // Person occurrences parent under the PEOPLE BOARD container (2026-07-25 —
  // People is a board; the standalone People page/table/profile-card are
  // gone). They keep the library:"person" tag so peopleAssigned's existing
  // find predicate is untouched, plus boardCategory:"person" like every
  // other board option.
  for (const p of peopleSeed) {
    p.occId = await mkOcc({
      moduleId: p.modId,
      parentId: peopleBoardContOccId,
      fields: {
        [libraryFieldId]:                fv("person"),
        [boardCategoryFieldId]:          fv("person"),
        [posterUrlFieldId]:              fv(personPosterFor(p.gender, p.seed)),
        [personNameFieldId]:             fv(p.name),
        [personEmailFieldId]:            fv(p.email),
        [personPhoneFieldId]:            fv(p.phone),
        [personGenderFieldId]:           fv(p.gender),
        [personRelationshipFieldId]:     fv(p.relationship),
        [personBirthdayFieldId]:         fv(p.birthday),
        [personCityFieldId]:             fv(p.city),
        [personAddressFieldId]:          fv(p.address),
        [personCompanyFieldId]:          fv(p.company),
        [personJobTitleFieldId]:         fv(p.jobTitle),
        [personWebsiteFieldId]:          fv(p.website),
        [personInstagramFieldId]:        fv(p.instagram),
        [personTwitterFieldId]:          fv(p.twitter),
        [personLinkedInFieldId]:         fv(p.linkedin),
        [personLastContactFieldId]:      fv(p.lastContact),
        [personFavoriteFoodFieldId]:     fv(p.favoriteFood),
        [personAllergiesFieldId]:        fv(p.allergies),
        [personInterestsFieldId]:        fv(p.interests),
        [personHowMetFieldId]:           fv(p.howMet),
        [personEmergencyContactFieldId]: fv(p.emergencyContact),
        [personNotesFieldId]:            fv(p.notes),
      },
    });
  }

  // Reflection question occurrences — one per module above (library field = "question").
  // Parented under the Library container; the Daily Journal Questions board
  // page also lists them via multi-parent occurrences[] membership (see the
  // Daily Journal Questions page creation later in the script).
  const phQuestionOccIds = [];
  for (const modId of phQuestionModIds) {
    const occId = await mkOcc({ moduleId: modId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
    phQuestionOccIds.push(occId);
  }

  // Library container occurrence (libraryContOccId pre-generated at top)
  await mkOcc({
    id: libraryContOccId,
    moduleId: libraryContModId,
    occurrences: [
      // movies
      movieInceptionOccId, movieMatrixOccId, movieArrivalOccId, movieDuneOccId,
      movieInterstellarOccId, movieBladeRunner2049OccId, moviePrestigeOccId, movieTenetOccId,
      // books (incl. the 2 Readings-board scripture/philosophy texts)
      bookAtomicHabitsOccId, bookDeepWorkOccId, bookSapiensOccId, bookThinkingFastSlowOccId,
      bookMeditationsOccId, bookMansSearchOccId, book4HourWorkweekOccId,
      bookTaoTeChingOccId, bookPsalmsOccId,
      // podcasts
      podcastTimFerrissOccId, podcastLexFridmanOccId, podcastHardcoreHistoryOccId,
      podcastHubermanLabOccId, podcastConvosTylerOccId,
      // courses
      courseAlgorithmsOccId, courseMLSpecOccId, courseSystemDesignOccId, courseIntroPhilosophyOccId,
      // (people moved to the People BOARD container, 2026-07-25)
      // questions (one occurrence per PHIL_QUESTIONS entry — ~117 entries)
      ...phQuestionOccIds,
    ],
    filterOverride: {},
  });

  // Patch addNew.parentOccurrenceId for all four occurrence-type library fields
  // now that libraryContOccId is real. Uses dot-notation $set to avoid nuking
  // the rest of meta.optionsSource.
  await Field.findOneAndUpdate(
    { id: moviesWatchedFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );
  await Field.findOneAndUpdate(
    { id: booksReadFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );
  await Field.findOneAndUpdate(
    { id: podcastsListenedFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );
  await Field.findOneAndUpdate(
    { id: coursesTakenFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );
  // peopleAssigned (task #46) — same addNew patch so picker's "+ Add" mints
  // new person occurrences into the Library container with library:"person".
  await Field.findOneAndUpdate(
    { id: peopleAssignedFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": libraryContOccId } },
  );

  // ── STEP 7: Manifest + folder tree ──────────────────────────────────────────
  //
  // Structure (mirrors createTestGrid STEP 7):
  //   Root (normal)
  //   ├── Tasks      (normal, sortOrder: 0)  ← Daily Toolkit + Todo pages (Task 12)
  //   ├── Trackers   (normal, sortOrder: 1)  ← Daily Goals + Accounts pages (Task 12)
  //   ├── Interfaces (normal, sortOrder: 2)  ← Schedule + Canvas pages (Task 12)
  //   ├── Notes      (normal, sortOrder: 3)  ← Notebook docs (Task 11)
  //   ├── Day Pages  (day-pages, sortOrder: 4) ← auto-created by Day Page: Build op (Task 13)
  //   └── Library    (normal, sortOrder: 5)  ← Library page (movies/books/shows)
  //
  // Folder ids are exposed on the return value for Task 11 (notebook docs parent into Notes),
  // Task 12 (pages parent into Tasks/Trackers/Interfaces), and Task 13 (makeDayPageBuildOp
  // needs dayPagesFolderId).

  const rootFolderId         = uid();
  const tasksFolderId        = uid();
  const dailyToolkitFolderId = uid(); // NEW — sub-folder of Tasks holding 11 wellness pages
  const trackersFolderId     = uid();
  const interfacesFolderId   = uid();
  const notesFolderId        = uid();
  const dayPagesFolderId     = uid();
  const examplesFolderId     = uid(); // Seeds image / video / pdf artifacts so the viewer + download button are visible end-to-end on a fresh grid.

  await new Manifest({ id: manifestId, userId, gridId, manifestType: "user", rootFolderId }).save();
  await new Folder({ id: rootFolderId,         userId, gridId, name: "Root",          parentId: null,            folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: tasksFolderId,        userId, gridId, name: "Tasks",         parentId: rootFolderId,    folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: dailyToolkitFolderId, userId, gridId, name: "Daily Toolkit", parentId: tasksFolderId,   folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: trackersFolderId,   userId, gridId, name: "Trackers",   parentId: rootFolderId, folderType: "normal",    sortOrder: 1, isExpanded: true }).save();
  await new Folder({ id: interfacesFolderId, userId, gridId, name: "Interfaces", parentId: rootFolderId, folderType: "normal",    sortOrder: 2, isExpanded: true }).save();
  await new Folder({ id: notesFolderId,      userId, gridId, name: "Notes",      parentId: rootFolderId, folderType: "normal",    sortOrder: 3, isExpanded: true }).save();
  await new Folder({ id: dayPagesFolderId,   userId, gridId, name: "Day Pages",  parentId: rootFolderId, folderType: "day-pages", sortOrder: 4, isExpanded: true }).save();
  await new Folder({ id: libraryFolderId,    userId, gridId, name: "Library",    parentId: rootFolderId, folderType: "normal",    sortOrder: 5, isExpanded: true }).save();
  // Library > Templates subfolder — holds the Schedule Template page
  // (seeded in STEP 7b). Schedule: Build COPY_LINKs the Day container
  // inside that page into the active Schedule page per visible day.
  await new Folder({ id: libraryTemplatesFolderId, userId, gridId, name: "Templates", parentId: libraryFolderId, folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  // Projects folder — root of every per-project page. Demo data seeds one
  // project (Moduli v1 Launch); future projects mint sibling pages here.
  await new Folder({ id: projectsFolderId,   userId, gridId, name: "Projects", parentId: rootFolderId, folderType: "normal",    sortOrder: 6, isExpanded: true }).save();
  await new Folder({ id: examplesFolderId,   userId, gridId, name: "Examples", parentId: rootFolderId, folderType: "normal",    sortOrder: 7, isExpanded: true }).save();

  // ── Category folders (Command Center: Fields + Operations grouping) ────────
  // folderType: "category" is the marker FieldsTab + OperationsTab read off of
  // to render category columns. Field/op records reference these by folderId.
  // IDs were pre-generated at the top so field/op definitions can carry
  // their folderId inline.
  await Promise.all([
    new Folder({ id: fieldCategoryIds.scheduling,   userId, gridId, name: "Scheduling",    parentId: null, folderType: "category", categoryKind: "field", sortOrder: 100, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.workouts,     userId, gridId, name: "Workouts",      parentId: null, folderType: "category", categoryKind: "field", sortOrder: 101, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.nutrition,    userId, gridId, name: "Nutrition",     parentId: null, folderType: "category", categoryKind: "field", sortOrder: 102, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.finance,      userId, gridId, name: "Finance",       parentId: null, folderType: "category", categoryKind: "field", sortOrder: 103, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.wellness,     userId, gridId, name: "Wellness",      parentId: null, folderType: "category", categoryKind: "field", sortOrder: 104, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.intellectual, userId, gridId, name: "Intellectual",  parentId: null, folderType: "category", categoryKind: "field", sortOrder: 105, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.bills,        userId, gridId, name: "Bills",         parentId: null, folderType: "category", categoryKind: "field", sortOrder: 106, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.display,      userId, gridId, name: "Display",       parentId: null, folderType: "category", categoryKind: "field", sortOrder: 107, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.refs,         userId, gridId, name: "References",    parentId: null, folderType: "category", categoryKind: "field", sortOrder: 109, isExpanded: false }).save(),
  ]);

  await Promise.all([
    new Folder({ id: opCategoryIds.trackers, userId, gridId, name: "Trackers",       parentId: null, folderType: "category", categoryKind: "op", sortOrder: 200, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.schedule, userId, gridId, name: "Schedule Ops",   parentId: null, folderType: "category", categoryKind: "op", sortOrder: 201, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.daypage,  userId, gridId, name: "Day Page Ops",   parentId: null, folderType: "category", categoryKind: "op", sortOrder: 202, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.bills,    userId, gridId, name: "Bill Ops",       parentId: null, folderType: "category", categoryKind: "op", sortOrder: 203, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.library,  userId, gridId, name: "Library Ops",    parentId: null, folderType: "category", categoryKind: "op", sortOrder: 204, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.alarms,   userId, gridId, name: "Alarms",         parentId: null, folderType: "category", categoryKind: "op", sortOrder: 205, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.projects, userId, gridId, name: "Projects",       parentId: null, folderType: "category", categoryKind: "op", sortOrder: 206, isExpanded: false }).save(),
  ]);

  // ── STEP 7a: Option Boards (nine-dimensions rebuild, 2026-07-25) ────────────
  //
  // 34 boards. Each board = one page (role:"page" kind:"board") in the Boards
  // folder tree (grouped by life area) + one container whose occurrence:
  //   - carries its OWN boardCategory tag value — the addNew flow reads the
  //     chosen parent occurrence's value at run time and stamps it on the new
  //     option (no per-board ops, no baked tag strings in picker config);
  //   - carries a FEED on that tag: the tag is the source of truth and the
  //     board is the materialized view — an option tagged anywhere in the grid
  //     gets pulled in as a copy-linked child (feedSync excludes the owner,
  //     its own direct children, and other feeds' copies automatically).
  // Option instances mostly mint fresh here. Reuse instead of duplicates:
  // Movements = the 30 exercise occurrences (tagged in the toolkit loop; they
  // feed in as copies until Task 4 re-homes them), Readings/Courses = Library
  // entries (tagged in the Library block), People = the 10 person occurrences
  // (parented under the People board container directly).

  const boardsFolderId = uid();
  const boardGroupFolderIds = {
    food: uid(), body: uid(), mind: uid(), money: uid(),
    home: uid(), social: uid(), creative: uid(),
  };
  await new Folder({ id: boardsFolderId, userId, gridId, name: "Boards", parentId: rootFolderId, folderType: "normal", sortOrder: 8, isExpanded: true }).save();
  const BOARD_GROUPS = [
    ["food", "Food"], ["body", "Body"], ["mind", "Mind"], ["money", "Money"],
    ["home", "Home"], ["social", "Social"], ["creative", "Creative"],
  ];
  await Promise.all(BOARD_GROUPS.map(([key, name], i) =>
    new Folder({ id: boardGroupFolderIds[key], userId, gridId, name, parentId: boardsFolderId, folderType: "normal", sortOrder: i, isExpanded: false }).save()));

  // Folder-page occurrences for Boards + each life-area sub-folder — a bare
  // Folder record shows in the TREE but is invisible on a folder-page card
  // grid (PageFolder lists folder-page occurrences, 2026-06-09 lesson). With
  // these, the Boards page drills: Boards → Food → Meals.
  let boardsFolderPageOccId = null; // the accounts-panel slot opens here (Task 5)
  for (const [folderId, label] of [
    [boardsFolderId, "Boards"],
    ...BOARD_GROUPS.map(([key, name]) => [boardGroupFolderIds[key], name]),
  ]) {
    const modId = uid();
    const pageOccId = uid();
    await new Module({ id: modId, userId, gridId, role: "page", kind: "folder", label }).save();
    await mkOcc({
      id: pageOccId, moduleId: modId,
      parentId: folderId, sortOrder: -1,
      occurrences: [],
      iteration: { mode: "persistent" }, fields: {},
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
    });
    if (folderId === boardsFolderId) boardsFolderPageOccId = pageOccId;
  }

  const personOccByLabel = Object.fromEntries(peopleSeed.map(p => [p.label, p.occId]));
  const opt = (label, extra = null) => ({ label, ...(extra || {}) });

  // The 30 exercise occurrences live ON the Movements board (2026-07-25 —
  // their old fitness sub-containers are gone). Same starting state as the
  // old fitness pages: descending rep pyramid at progressive-overload weights.
  const workoutOccIdByKey = {};
  const movementReuseOccIds = [];
  for (const [wKey, wInst] of Object.entries(workoutInstances)) {
    const wFields = {
      [fields.muscleGroup.id]:    fv(wInst.meta.defaultMuscleGroup, "replace"),
      [boardCategoryFieldId]:     fv("movement"),
      [fields.set1Reps.id]:       fv(12, "replace"),
      [fields.set2Reps.id]:       fv(10, "replace"),
      [fields.set3Reps.id]:       fv(8,  "replace"),
      [fields.workoutWeight.id]:  fv(workoutStartWeights[wKey] ?? 20, "replace"),
      [fields.workoutWeight2.id]: fv(workoutStartWeights[wKey] ?? 20, "replace"),
      [fields.workoutWeight3.id]: fv(workoutStartWeights[wKey] ?? 20, "replace"),
    };
    const wOccId = await mkOcc({ moduleId: wInst.id, parentId: movementsBoardContOccId, fields: wFields });
    workoutOccIdByKey[wKey] = wOccId;
    movementReuseOccIds.push(wOccId);
  }

  // Board table. `options[].bindings` = extra fieldBindings on the option's
  // module (recipe pattern — a Meal carries its Ingredients, a Program its
  // Movements, an Event its People + Place…); `options[].fields` = a THUNK
  // returning the extra stamped values (thunk because recipe values reference
  // option occ ids minted earlier in this same loop).
  const BOARD_DEFS = [
    // ── Food ──
    { key: "ingredient", tag: "ingredient", label: "Ingredients", group: "food", options: [
      opt("Chicken Breast"), opt("Eggs"), opt("Rice"), opt("Spinach"), opt("Greek Yogurt"),
      opt("Oats"), opt("Salmon"), opt("Olive Oil"), opt("Sweet Potatoes"), opt("Black Beans"),
    ]},
    { key: "grocery", tag: "grocery", label: "Grocery List", group: "food", options: [
      opt("Milk"), opt("Bananas"), opt("Coffee Beans"), opt("Paper Towels"), opt("Chicken Thighs"), opt("Frozen Berries"),
    ]},
    { key: "meal", tag: "meal", label: "Meals", group: "food", options: [
      "Scrambled Eggs|Eggs,Olive Oil",
      "Greek Salad with Chicken|Chicken Breast,Spinach,Olive Oil",
      "Oatmeal with Berries|Oats,Greek Yogurt",
      "Protein Shake|Greek Yogurt",
      "Chicken and Rice|Chicken Breast,Rice",
      "Salmon and Vegetables|Salmon,Spinach,Sweet Potatoes,Olive Oil",
    ].map(row => {
      const [label, ings] = row.split("|");
      return opt(label, {
        bindings: [{ fieldId: boardDropdownFields.ingredient.id, role: "input", order: 1 }],
        fields: () => ({ [boardDropdownFields.ingredient.id]: fv(ings.split(",").map(l => boardOptionOccIds.ingredient[l])) }),
      });
    })},
    { key: "beverage", tag: "beverage", label: "Beverages", group: "food", options: [
      opt("Water"), opt("Coffee"), opt("Green Tea"), opt("Electrolyte Drink"), opt("Smoothie"),
    ]},
    { key: "supplement", tag: "supplement", label: "Supplements", group: "food", options: [
      opt("Creatine"), opt("Vitamin D"), opt("Fish Oil"), opt("Magnesium"), opt("Protein Powder"), opt("Multivitamin"),
    ]},
    // ── Body ──
    { key: "movement", tag: "movement", label: "Movements", group: "body", options: [
      opt("Hamstring Stretch"), opt("Hip Flexor Stretch"), opt("Shoulder Stretch"),
    ], reuseOccIds: movementReuseOccIds },
    { key: "program", tag: "program", label: "Workout Programs", group: "body", options: [
      "Push Day A|benchPress,inclinePress,overheadPress,tricepPushdown",
      "Pull Day B|deadlift,pullUps,bentRow,bicepCurl",
      "Leg Day|squat,legPress,lunges,calfRaise",
      "Full Body 5x5|squat,benchPress,deadlift,overheadPress,bentRow",
      "Couch to 5K|running",
    ].map(row => {
      const [label, moves] = row.split("|");
      return opt(label, {
        bindings: [{ fieldId: boardDropdownFields.movement.id, role: "input", order: 1 }],
        fields: () => ({ [boardDropdownFields.movement.id]: fv(moves.split(",").map(k => workoutOccIdByKey[k])) }),
      });
    })},
    { key: "route", tag: "route", label: "Routes", group: "body", options: [
      opt("Neighborhood Loop"), opt("River Trail"), opt("Park Circuit"), opt("Hill Repeats"), opt("Forest Path"),
    ]},
    // ── Mind ──
    { key: "reading", tag: "reading", label: "Readings", group: "mind", options: [] }, // Library books feed in
    { key: "verse", tag: "verse", label: "Verses", group: "mind", options: [
      opt("Psalm 23"), opt("Sermon on the Mount"), opt("Ecclesiastes 3"), opt("Proverbs 3:5-6"),
    ]},
    { key: "media", tag: "media", label: "Media", group: "mind", options: [
      opt("The Daily"), opt("Planet Earth II"), opt("Lex Fridman Podcast"), opt("Veritasium"), opt("Kurzgesagt"),
    ]},
    { key: "course", tag: "course", label: "Courses", group: "mind", options: [] }, // Library courses feed in
    { key: "practice", tag: "practice", label: "Practices", group: "mind", options: [
      opt("Breathwork"), opt("Body Scan"), opt("Loving-Kindness"), opt("Gratitude List"), opt("Silent Prayer"), opt("Walking Meditation"),
    ]},
    { key: "prompt", tag: "prompt", label: "Prompts", group: "mind", options: [
      opt("What went well today?"), opt("What am I avoiding?"), opt("What would make tomorrow great?"),
      opt("Describe a place from memory"), opt("Write a letter you will never send"),
    ]},
    { key: "topic", tag: "topic", label: "Topics", group: "mind", options: [
      opt("Spanish"), opt("Algorithms"), opt("Music Theory"), opt("World History"), opt("Machine Learning"),
    ]},
    { key: "skill", tag: "skill", label: "Skills", group: "mind", options: [
      opt("Guitar"), opt("Typing"), opt("Public Speaking"), opt("Spanish Conversation"), opt("Chess Openings"), opt("Sketching"),
    ]},
    { key: "idea", tag: "idea", label: "Ideas", group: "mind", options: [
      opt("Plant herb wall"), opt("App for tracking loans to friends"), opt("Photo series: doors"),
    ]},
    // ── Money ──
    { key: "wishlist", tag: "wishlist", label: "Wish List", group: "money", options: [
      opt("Standing Desk"), opt("Espresso Machine"), opt("Noise-Canceling Headphones"), opt("Weighted Blanket"), opt("New Running Shoes"),
    ]},
    { key: "savingsGoal", tag: "savingsGoal", label: "Savings Goals", group: "money", options: [
      ["Emergency Fund", 10000], ["Japan Trip", 4000], ["New Laptop", 2500], ["Down Payment", 60000],
    ].map(([label, target]) => opt(label, {
      bindings: [{ fieldId: fields.amount.id, role: "input", order: 1 }],
      fields: () => ({ [fields.amount.id]: fv(target) }),
    }))},
    { key: "charity", tag: "charity", label: "Charities", group: "money", options: [
      opt("Local Food Bank"), opt("Red Cross"), opt("Habitat for Humanity"), opt("Animal Shelter"), opt("Library Fund"),
    ]},
    { key: "gift", tag: "gift", label: "Gift Ideas", group: "money", options: [
      ["Cookbook for Mom", "Jack Brennan"], ["Board Game", "Ben Chen"],
      ["Concert Tickets", "Isabel Sokolov"], ["Handmade Mug", "Felix Romero"],
    ].map(([label, person]) => opt(label, {
      bindings: [{ fieldId: peopleAssignedFieldId, role: "input", order: 1 }],
      fields: () => ({ [peopleAssignedFieldId]: fv([personOccByLabel[person]]) }),
    }))},
    // ── Home ──
    { key: "area", tag: "area", label: "Areas", group: "home", options: [
      opt("Desk"), opt("Kitchen"), opt("Bedroom"), opt("Bathroom"), opt("Garage"), opt("Yard"),
    ]},
    { key: "equipment", tag: "equipment", label: "Equipment", group: "home", options: [
      opt("Car"), opt("Bike"), opt("Lawn Mower"), opt("Laptop"), opt("Coffee Machine"), opt("HVAC Filter"),
    ]},
    { key: "plant", tag: "plant", label: "Plants", group: "home", options: [
      opt("Monstera"), opt("Tomatoes"), opt("Basil"), opt("Snake Plant"), opt("Rosemary"),
    ]},
    // ── Social ──
    { key: "person", tag: "person", label: "People", group: "social", options: [],
      reuseOccIds: peopleSeed.map(p => p.occId) },
    { key: "place", tag: "place", label: "Places", group: "social", options: [
      opt("Coffee Shop"), opt("City Park"), opt("Gym"), opt("Mom's House"), opt("Downtown Library"), opt("Farmers Market"),
    ]},
    { key: "event", tag: "event", label: "Events", group: "social", options: [
      ["Game Night", ["Ben Chen", "Jack Brennan"], "Mom's House"],
      ["Book Club", ["Chloe Patel", "Grace Okonkwo"], "Downtown Library"],
      ["Birthday Dinner", ["Felix Romero"], "Mom's House"],
      ["Movie Night", ["Isabel Sokolov", "Deven Wright"], null],
      ["Barbecue", ["Jack Brennan", "Ben Chen", "Felix Romero"], "City Park"],
    ].map(([label, people, place]) => opt(label, {
      bindings: [
        { fieldId: peopleAssignedFieldId, role: "input", order: 1 },
        { fieldId: boardDropdownFields.place.id, role: "input", order: 2 },
      ],
      fields: () => ({
        [peopleAssignedFieldId]: fv(people.map(p => personOccByLabel[p])),
        ...(place ? { [boardDropdownFields.place.id]: fv(boardOptionOccIds.place[place]) } : {}),
      }),
    }))},
    { key: "leisure", tag: "leisure", label: "Leisure", group: "social", options: [
      opt("Chess"), opt("Video Games"), opt("Hot Bath"), opt("Puzzle"), opt("Movie Night"), opt("Hammock Time"),
    ]},
    { key: "gratitude", tag: "gratitude", label: "Gratitude Log", group: "social", options: [
      opt("Morning coffee on the porch"), opt("Call with Dad"), opt("Finished the 5K"),
    ]},
    { key: "win", tag: "win", label: "Wins", group: "social", options: [
      opt("Shipped the feature"), opt("First pull-up"), opt("Paid off the card"),
    ]},
    // ── Creative ──
    { key: "project", tag: "project", label: "Projects", group: "creative", options: [
      opt("Moduli v1 Launch"), opt("Portfolio Site"), opt("Home Lab"), opt("Garden Build"),
    ]},
    { key: "medium", tag: "medium", label: "Mediums", group: "creative", options: [
      opt("Pencil"), opt("Watercolor"), opt("Acrylic"), opt("Guitar"), opt("Piano"), opt("Camera"), opt("Clay"),
    ]},
    { key: "song", tag: "song", label: "Songs", group: "creative", options: [
      opt("Hallelujah"), opt("Blackbird"), opt("Clair de Lune"), opt("Take Five"), opt("Redbone"),
    ]},
    { key: "creativeWork", tag: "creativeWork", label: "Creative Works", group: "creative", options: [
      ["Sketchbook Vol. 3", "Pencil"], ["Untitled Album", "Piano"],
      ["Short Film: Doors", "Camera"], ["Family Photo Book", "Camera"],
    ].map(([label, medium]) => opt(label, {
      bindings: [{ fieldId: boardDropdownFields.medium.id, role: "input", order: 1 }],
      fields: () => ({ [boardDropdownFields.medium.id]: fv(boardOptionOccIds.medium[medium]) }),
    }))},
  ];

  const boardContOccIds = {};   // tag → container occ id
  const boardOptionOccIds = {}; // tag → { option label → occ id }
  const boardGroupCounters = {};
  for (const def of BOARD_DEFS) {
    const contModId = uid();
    // People / Movements container occ ids were pre-generated (their
    // occurrences are created earlier and parent under them directly).
    const contOccId = def.tag === "person" ? peopleBoardContOccId
      : def.tag === "movement" ? movementsBoardContOccId
      : uid();
    boardContOccIds[def.tag] = contOccId;
    boardOptionOccIds[def.tag] = {};

    const optionOccIds = [];
    for (const o of def.options) {
      const modId = uid();
      await new Module({
        id: modId, userId, gridId, role: "instance", kind: "board",
        label: o.label, defaultDragMode: "move",
        fieldBindings: [
          { fieldId: boardCategoryFieldId, role: "input", order: 0, hidden: true },
          ...(o.bindings || []),
        ],
      }).save();
      const occId = await mkOcc({
        moduleId: modId, parentId: contOccId,
        fields: {
          [boardCategoryFieldId]: fv(def.tag),
          ...(o.fields ? o.fields() : {}),
        },
      });
      boardOptionOccIds[def.tag][o.label] = occId;
      optionOccIds.push(occId);
    }
    const children = [...(def.reuseOccIds || []), ...optionOccIds];

    await new Module({ id: contModId, userId, gridId, role: "container", kind: "board", label: def.label }).save();
    await mkOcc({
      id: contOccId, moduleId: contModId,
      occurrences: children,
      // The container's OWN tag value — read at add time by the addNew flow
      // to stamp new options minted under it.
      fields: { [boardCategoryFieldId]: fv(def.tag) },
      // The board pulls in anything tagged with its category from anywhere in
      // the grid (feedSync self-excludes the owner, its direct children, and
      // feed copies — no extra conditions needed).
      feed: {
        enabled: true,
        conditions: [{ fieldId: boardCategoryFieldId, comparator: "IS", value: def.tag }],
        roles: ["instance"],
        sort: null,
        limit: 200,
      },
    });

    const pageModId = uid();
    const pageOccId = uid();
    const sortOrder = boardGroupCounters[def.group] = (boardGroupCounters[def.group] ?? -1) + 1;
    await new Module({ id: pageModId, userId, gridId, role: "page", kind: "board", label: def.label }).save();
    await mkOcc({
      id: pageOccId, moduleId: pageModId,
      parentId: boardGroupFolderIds[def.group], sortOrder,
      occurrences: [contOccId],
      iteration: { mode: "persistent" }, fields: {},
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
    });
  }

  // addNew patches — EVERY board dropdown takes "+ Add" (per user). Single-
  // board fields get parentOccurrenceId; multi-board fields get targets[]
  // (candidate parent occ ids, first = default — the select-an-occurrence
  // chooser lists them by live label and the chosen parent's boardCategory
  // value is stamped on the new option at run time).
  const singleBoardAddNew = [
    [boardDropdownFields.mealPick.id,        "meal"],
    [boardDropdownFields.beverage.id,        "beverage"],
    [boardDropdownFields.supplement.id,      "supplement"],
    [boardDropdownFields.movement.id,        "movement"],
    [boardDropdownFields.workoutProgram.id,  "program"],
    [boardDropdownFields.route.id,           "route"],
    [boardDropdownFields.practice.id,        "practice"],
    [boardDropdownFields.prompt.id,          "prompt"],
    [boardDropdownFields.leisureActivity.id, "leisure"],
    [boardDropdownFields.topic.id,           "topic"],
    [boardDropdownFields.wishListItem.id,    "wishlist"],
    [boardDropdownFields.charity.id,         "charity"],
    [boardDropdownFields.place.id,           "place"],
    [boardDropdownFields.eventPick.id,       "event"],
    [boardDropdownFields.giftIdea.id,        "gift"],
    [boardDropdownFields.area.id,            "area"],
    [boardDropdownFields.equipment.id,       "equipment"],
    [boardDropdownFields.plant.id,           "plant"],
    [boardDropdownFields.medium.id,          "medium"],
    [boardDropdownFields.song.id,            "song"],
    [boardDropdownFields.verse.id,           "verse"],
    [boardDropdownFields.gratitudeEntry.id,  "gratitude"],
    [boardDropdownFields.win.id,             "win"],
    [projectFieldId,                         "project"],
  ];
  for (const [fieldId, tag] of singleBoardAddNew) {
    await Field.findOneAndUpdate(
      { id: fieldId },
      { $set: { "meta.optionsSource.addNew.parentOccurrenceId": boardContOccIds[tag] } },
    );
  }
  const multiBoardAddNew = [
    [boardDropdownFields.ingredient.id,      ["ingredient", "grocery"]],
    [boardDropdownFields.purchaseItem.id,    ["grocery", "wishlist", "ingredient", "supplement", "equipment", "plant", "gift"]],
    [boardDropdownFields.reading.id,         ["reading", "verse"]],
    [boardDropdownFields.mediaPick.id,       ["media", "song", "course"]],
    [boardDropdownFields.skill.id,           ["skill", "song"]],
    [boardDropdownFields.savingsGoalPick.id, ["savingsGoal", "wishlist"]],
    [boardDropdownFields.idea.id,            ["idea", "prompt"]],
    [boardDropdownFields.creativeWork.id,    ["creativeWork", "project"]],
  ];
  for (const [fieldId, tags] of multiBoardAddNew) {
    await Field.findOneAndUpdate(
      { id: fieldId },
      { $set: { "meta.optionsSource.addNew": { targets: tags.map(t => boardContOccIds[t]) } } },
    );
  }
  // Entry fields at add time (addNew.fieldIds): a new option minted from
  // these dropdowns immediately asks for its recipe fields through the
  // user-input modal (a new Meal asks its Ingredients, a new Savings Goal its
  // Amount, …) and binds them on the minted module.
  const addNewEntryFieldPatches = [
    [boardDropdownFields.mealPick.id,        [boardDropdownFields.ingredient.id]],
    [boardDropdownFields.workoutProgram.id,  [boardDropdownFields.movement.id]],
    [boardDropdownFields.eventPick.id,       [peopleAssignedFieldId, boardDropdownFields.place.id]],
    [boardDropdownFields.giftIdea.id,        [peopleAssignedFieldId]],
    [boardDropdownFields.savingsGoalPick.id, [fields.amount.id]],
    [boardDropdownFields.creativeWork.id,    [boardDropdownFields.medium.id]],
  ];
  for (const [fieldId, fieldIds] of addNewEntryFieldPatches) {
    await Field.findOneAndUpdate(
      { id: fieldId },
      { $set: { "meta.optionsSource.addNew.fieldIds": fieldIds } },
    );
  }
  // Reused fields repoint their addNew at board containers: new people land on
  // the People board (library:"person" stampFields kept — the find predicate
  // is unchanged); new courses land on the Courses board (library:"course"
  // stampFields kept so the Courses Taken dropdown still lists them).
  await Field.findOneAndUpdate(
    { id: peopleAssignedFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": peopleBoardContOccId } },
  );
  await Field.findOneAndUpdate(
    { id: coursesTakenFieldId },
    { $set: { "meta.optionsSource.addNew.parentOccurrenceId": boardContOccIds.course } },
  );

  // ── STEP 7b: Templates manifest + Daily Routine + Day Page templates ────────
  // Separate manifest from the user manifest (createTestGrid pattern).
  // buildTemplatesManifest mints the Templates folder + manifest and returns
  // the root folder id that both template subtrees parent to.
  const { tplManifestRootFolderId } = await buildTemplatesManifest({ userId, gridId, Folder, Manifest });

  // Per-slot routine picks (6 items, no completed/water pre-fills).
  // Slot-label keys are EXACTLY the strings generateTimeSlots() emits:
  //   `${h}:${m}${ampm}` where h has no leading zero, m is "00"/"30", ampm is lowercase.
  const routineBySlot = {
    "6:00am":  [{ sourceModId: instanceMods.drink.id,    label: "Drink" }],
    "7:00am":  [{ sourceModId: instanceMods.hygiene.id,  label: "Hygiene" }],
    "8:00am":  [{ sourceModId: instanceMods.eat.id,      label: "Eat" }],
    "12:00pm": [{ sourceModId: instanceMods.walk.id,     label: "Walk" }],
    "5:00pm":  [{ sourceModId: instanceMods.exercise.id, label: "Exercise" }],
    "9:00pm":  [{ sourceModId: instanceMods.journal.id,  label: "Journal" }],
  };

  // Schedule Template page lives in Library > Templates (NOT in the
  // templates manifest). It IS the canonical store for the recurring
  // routine instances — the Schedule: Build op COPY_LINKs the Day
  // container from here into the active Schedule page per visible day.
  // Returns the Day container's occurrence id so the op can reference it
  // via picker-direct binding ($allItemsById.<id>) instead of FIND-by-label.
  const { dayContainerOccId } = await buildScheduleTemplatePage({
    userId, gridId, timeSlots, timeslotFieldId, routineBySlot,
    libraryTemplatesFolderId, mkOcc, Module,
    findModule: (q) => Module.findOne(q).lean(),
    scheduleFormatFieldId,
  });

  await buildDayPageTemplate({
    userId, gridId, tplManifestRootFolderId, mkOcc, Module,
    // Editor↔field binding wiring: Daily Question container in the day page
    // template carries header binding for journalQuestion (dropdown from the
    // questions pool via find-mode optionsSource) and body binding for
    // journalAnswer. Both join on dateFieldId — Day Page: Build stamps the
    // date on the cloned occurrences, and any other occurrence with matching
    // date + selfField (e.g. journaling instance) syncs automatically via
    // propagateBoundFieldWrite on every write.
    dateFieldId,
    journalQuestionFieldId,
    journalAnswerFieldId,
  });

  // Project page template — generic, user-editable subtree in the
  // Templates manifest. Uses {ProjectName} + {ProjectScope} placeholder
  // tokens that Project: Create swaps via APPLY_TEMPLATE replacements
  // at instantiation time. Mirrors the Day Page template / Daily Routine
  // pattern. Tasks aren't seeded — the user adds them after the project
  // page is minted.
  await buildProjectTemplate({
    userId, gridId, tplManifestRootFolderId, mkOcc, Module,
    statusFieldId, projectFieldId,
  });

  // (Profile Card template removed 2026-07-25 — People is a board; the
  // profile-card page + Show Profile op are gone.)

  // ── STEP 7c: Notebook docs parsed into DB textmaps ──────────────────────────
  //
  // One `role:"page" kind:"doc"` Module + Occurrence per top-level notebook document.
  // All parented to notesFolderId (root tree only — no panel pinning, that's Task 12).
  // textmap built from parsed markdown; NO filesystem writes (uploads/md untouched).
  //
  // FLATTEN decision: createDefaultUserData nested section containers + sub-instance
  // occurrences via instancePill embeds. That machinery is intentionally omitted here
  // (user's Task-3 answer: "notebook docs in the root tree only" without journal
  // instance mechanics). Instead, all sections are merged into a single flat TipTap doc
  // per source file using buildMergedDocTextmap. ALL textual content is preserved:
  // section headings become H2 nodes; body lines (extraLines + instance sub-heading
  // lines) are rendered inline via makeDocContent. Nothing is dropped.
  //
  // Source files + parser calls are faithful to createDefaultUserData:
  //   morenotes.md          parseSectionsWithInstances(…, 1, 2, 8)
  //   philosopherstone.md   parseSectionsWithInstances(…, 1, 2, 8)
  //   gospelofthomasnotes.md parseSectionsWithInstances(…, 2, 3, 8)
  //   uses.md               parseSectionsWithInstances(…, 2, 3, 12)
  //   PRAGMATIC.md          parseSectionsWithInstances(…, 2, 3, 12)
  //   aispecs.md            parseSectionsWithInstances(…, 1, 3, 12)
  //   banglespecs.md        parseSectionsWithInstances(…, 1, 2, 12)
  //   comparitive_religion.md  flat (readRawLines up to 120)
  //   gospelthomas.md       flat (readRawLines up to 80)

  // Helper: read raw lines from a markdown file (mirrors createDefaultUserData.readRawLines)
  function readRawLines(filePath, maxLines = 120) {
    try { return fs.readFileSync(filePath, "utf-8").split("\n").slice(0, maxLines); }
    catch { return []; }
  }

  // Helper: convert parseSectionsWithInstances output into buildMergedDocTextmap sections.
  // Each parsed section → { heading, headingLevel, lines: [...extraLines, ...instance-sub-content] }
  // Sub-heading instances are inlined as H(headingLevel+1) + their body lines — no occurrences created.
  function sectionsToMergeInput(parsed, sectionHeadingLevel = 2) {
    const result = [];
    for (const sec of parsed) {
      // Section heading at sectionHeadingLevel
      result.push({ heading: sec.heading, headingLevel: sectionHeadingLevel, lines: sec.extraLines || [] });
      // Instance sub-headings at next level (inline, not separate occurrences)
      for (const inst of (sec.instances || [])) {
        result.push({ heading: inst.heading, headingLevel: sectionHeadingLevel + 1, lines: inst.lines || [] });
      }
    }
    return result;
  }

  // Helper: build a flat TipTap doc from a sections array produced by sectionsToMergeInput.
  // Uses buildMergedDocTextmap for heading+body merging.
  function buildFlatDocTextmap(title, mergeInput) {
    return buildMergedDocTextmap(title, mergeInput);
  }

  // Helper: split the Gospel of Thomas TEXT into one section per numbered saying.
  // The source has no markdown headings — sayings are marked `(N)` and wrap across
  // raw lines, so we group consecutive lines into the current verse until the next
  // `(N)` marker. The preamble (translator note + opening line) before saying (1)
  // becomes its own leading section. Each section → one textblock occurrence.
  function parseGospelVerses(lines) {
    const sections = [];
    const preamble = [];
    let current = null; // { num, lines: [] }
    const flush = () => {
      if (!current) return;
      const text = current.lines.join(" ").replace(/\s+/g, " ").trim();
      if (text) sections.push({ heading: "", headingLevel: 2, lines: [text] });
      current = null;
    };
    for (const raw of lines) {
      const line = (raw || "").trim();
      const m = line.match(/^\((\d+)\)/); // verse marker — digit-only, so "(Translated…" is NOT a verse
      if (m) {
        flush();
        current = { num: m[1], lines: [line] };
      } else if (current) {
        if (line) current.lines.push(line);
      } else if (line) {
        preamble.push(line);
      }
    }
    flush();
    // Preamble as the first textblock (drop the bare "Gospel of Thomas" title line —
    // it's already the page's title textblock).
    const preambleClean = preamble.filter((l) => l.toLowerCase() !== "gospel of thomas");
    if (preambleClean.length) {
      sections.unshift({ heading: "", headingLevel: 2, lines: [preambleClean.join(" ")] });
    }
    return sections;
  }

  // Helper: build a TipTap doc from flat raw lines (for comparitive_religion + gospelthomas)
  function buildFlatLinesTextmap(title, lines) {
    const bodyNodes = makeDocContent(lines).content
      .filter(n => n.type !== "paragraph" || (n.content && n.content.some(c => c.text && c.text.trim())));
    return {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
        ...bodyNodes,
      ],
    };
  }

  const notebookDocOccIds = {}; // label → occurrenceId (exposed on return for Task 12)

  // Per-section textblock seeder. Mirrors the runtime contract enforced by
  // Editor.jsx's strict-block sweep (May 18 2026): a `role:"page" kind:"doc"`
  // page's textmap should contain ONLY `instanceTextblock` nodes. Each
  // {heading, headingLevel, lines} section becomes its own
  // `role:"textblock" kind:"doc"` occurrence parented under the page; the
  // page textmap is a flat list of references. Title becomes the first
  // textblock (level-1 heading).
  async function seedTextblocksForDoc(title, sections, pageOccId) {
    const refNodes = [];
    // Title textblock
    if (title) {
      const tbModId = uid(); const tbOccId = uid();
      await new Module({ id: tbModId, userId, gridId, role: "textblock", kind: "doc", label: "" }).save();
      await mkOcc({
        id: tbOccId, moduleId: tbModId,
        parentId: pageOccId,
        iteration: { mode: "persistent" }, fields: {},
        textmap: { type: "doc", content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
        ] },
      });
      refNodes.push({ type: "instanceTextblock", attrs: { instanceId: tbModId, occurrenceId: tbOccId } });
    }
    // Section textblocks
    for (const sec of sections) {
      const tbModId = uid(); const tbOccId = uid();
      await new Module({ id: tbModId, userId, gridId, role: "textblock", kind: "doc", label: "" }).save();
      const tbContent = [];
      if (sec.heading) {
        tbContent.push({ type: "heading", attrs: { level: sec.headingLevel || 2 }, content: inlineToTipTap(sec.heading) });
      }
      if (Array.isArray(sec.lines) && sec.lines.length > 0) {
        const bodyDoc = makeDocContent(sec.lines);
        // Drop empty paragraphs — they bloat the textblock and never render
        // anything visible. makeDocContent emits one for blank lines.
        for (const n of bodyDoc.content) {
          if (n.type === "paragraph" && (!n.content || !n.content.some(c => c.text && c.text.trim()))) continue;
          tbContent.push(n);
        }
      }
      // Skip sections that would produce a blank textblock (no heading + no visible
      // body) — these were the empty textblocks scattered through the notebook docs.
      if (tbContent.length === 0) continue;
      await mkOcc({
        id: tbOccId, moduleId: tbModId,
        parentId: pageOccId,
        iteration: { mode: "persistent" }, fields: {},
        textmap: { type: "doc", content: tbContent.length ? tbContent : [{ type: "paragraph", content: [] }] },
      });
      refNodes.push({ type: "instanceTextblock", attrs: { instanceId: tbModId, occurrenceId: tbOccId } });
    }
    return { type: "doc", content: refNodes.length ? refNodes : [{ type: "paragraph", content: [] }] };
  }

  // Flat-line variant (one textblock per paragraph/heading/list) for the
  // two docs that don't have parseSectionsWithInstances structure.
  async function seedTextblocksFromLines(title, lines, pageOccId) {
    // Group the raw lines into "section-like" chunks at any heading boundary
    // so each heading + its following body lines lands in ONE textblock.
    const sections = [];
    let current = null;
    for (const line of lines) {
      const trimmed = line.trim();
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        if (current) sections.push(current);
        current = { heading: headingMatch[2], headingLevel: headingMatch[1].length, lines: [] };
      } else {
        if (!current) current = { heading: "", headingLevel: 2, lines: [] };
        current.lines.push(line);
      }
    }
    if (current) sections.push(current);
    return seedTextblocksForDoc(title, sections, pageOccId);
  }

  // ── 1. Philosopher's Stone ── morenotes.md + philosopherstone.md merged ──
  {
    const moreNotesSections = parseSectionsWithInstances(join(ROOT_DIR_MD, "morenotes.md"), 1, 2, 8);
    const philSections      = parseSectionsWithInstances(join(ROOT_DIR_MD, "philosopherstone.md"), 1, 2, 8);
    const mergeInput = [
      ...sectionsToMergeInput(moreNotesSections, 2),
      ...sectionsToMergeInput(philSections, 2),
    ];
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Philosopher’s Stone", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Philosopher’s Stone" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 0,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Philosopher’s Stone"] = occId;
  }

  // ── 2. Gospel of Thomas (notes) ── gospelofthomasnotes.md ──
  {
    const sections = parseSectionsWithInstances(join(ROOT_DIR_MD, "gospelofthomasnotes.md"), 2, 3, 8);
    const mergeInput = sectionsToMergeInput(sections, 2);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Gospel of Thomas (Notes)", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Gospel of Thomas (Notes)" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 1,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Gospel of Thomas (Notes)"] = occId;
  }

  // ── 3. Uses ── uses.md (secLevel:2, instLevel:3) ──
  {
    const sections = parseSectionsWithInstances(join(ROOT_DIR_MD, "uses.md"), 2, 3, 12);
    const mergeInput = sectionsToMergeInput(sections, 2);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Uses", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Uses" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 2,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Uses"] = occId;
  }

  // ── 4. Pragmatic ── PRAGMATIC.md (secLevel:2, instLevel:3) ──
  {
    const sections = parseSectionsWithInstances(join(ROOT_DIR_MD, "PRAGMATIC.md"), 2, 3, 12);
    const mergeInput = sectionsToMergeInput(sections, 2);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Pragmatic", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Pragmatic" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 3,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Pragmatic"] = occId;
  }

  // ── 5. AI Specs ── aispecs.md (secLevel:1, instLevel:3) ──
  {
    const sections = parseSectionsWithInstances(join(ROOT_DIR_MD, "aispecs.md"), 1, 3, 12);
    const mergeInput = sectionsToMergeInput(sections, 2);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("AI Specs", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "AI Specs" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 4,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["AI Specs"] = occId;
  }

  // ── 6. Bangle Specs ── banglespecs.md (secLevel:1, instLevel:2) ──
  {
    const sections = parseSectionsWithInstances(join(ROOT_DIR_MD, "banglespecs.md"), 1, 2, 12);
    const mergeInput = sectionsToMergeInput(sections, 2);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Bangle Specs", mergeInput, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Bangle Specs" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 5,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Bangle Specs"] = occId;
  }

  // ── 7. Comparative Religion ── comparitive_religion.md (flat) ──
  {
    const lines = readRawLines(join(ROOT_DIR_MD, "comparitive_religion.md"), 120);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksFromLines("Comparative Religion", lines, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Comparative Religion" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 6,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Comparative Religion"] = occId;
  }

  // ── 8. Gospel of Thomas (Text) ── gospelthomas.md (ALL 114 sayings, one textblock per verse) ──
  {
    const lines = readRawLines(join(ROOT_DIR_MD, "gospelthomas.md"), 100000);
    const verseSections = parseGospelVerses(lines);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksForDoc("Gospel of Thomas (Text)", verseSections, occId);
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Gospel of Thomas (Text)" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 7,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Gospel of Thomas (Text)"] = occId;
  }

  // ── STEP 8: Page modules + page occurrences ─────────────────────────────────
  // Mirrors createTestGrid STEP 8. Date-filter scope rule (per user): ONLY the
  // Schedule + Daily Goals pages (and the toolbar/grid filter) actively filter
  // by date. Every OTHER page declares BOTH:
  //   1. `filterOverride: {}` — clears any inherited grid date so its children
  //      aren't hidden on non-today navigation.
  //   2. `filterNavConfig: { filter_daily: { visible: false } }` — hides the
  //      date nav widget LocalFilterNav would otherwise render, so the user
  //      can't silently re-add dateFieldId back into filterOverride via arrows.
  //
  // Page → container-occ wiring:
  //   Daily Toolkit (board) → all toolkit container occs
  //   Todo List     (board) → all todo container occs
  //   Daily Goals   (board) → all goal container occs (date cascade intentional)
  //   Accounts      (board) → all account container occs
  //   Schedule      (board) → EMPTY (Schedule: Build Day seeds it at runtime
  //                            from the Daily Routine template — Task 13)
  //   Canvas        (canvas) → empty free-form scratchpad page

  // Daily Toolkit — 11 wellness pages parented under the Daily Toolkit folder.
  // Each page's occurrences[] = its sub-container occurrence IDs. The grid
  // panel at [0,0] (panelOccIds.toolkit) holds ALL of these as tabs (set
  // further below in panel wiring). manifest tree shows them by label.
  // Loop emits the same per-page filterOverride + nav-hide as every non-
  // Schedule/non-Daily-Goals page (createTestGrid date-scope rule).
  // ── Routines page (2026-07-25) — ONE page, 9 dimension containers ─────────
  // Replaces the 11 wellness pages; the Daily Toolkit folder holds just this.
  const routinesPageModId = uid();
  const routinesPageOccId = uid();
  await new Module({ id: routinesPageModId, userId, gridId, role: "page", kind: "board", label: "Routines" }).save();
  await mkOcc({
    id: routinesPageOccId, moduleId: routinesPageModId,
    parentId: dailyToolkitFolderId, sortOrder: 0,
    occurrences: Object.values(toolkitMappings).map(m => m.contOccId),
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });
  // Panel-tab list + default-tab pointer (names kept — panel wiring below and
  // the return value consume them).
  const wellnessPageOccList = [routinesPageOccId];
  const toolkitPageOccId = routinesPageOccId;

  // ── Tasks page (2026-07-25) — 9 EMPTY dimension containers ────────────────
  const tasksPageModId = uid(); const tasksPageOccId = uid();
  await new Module({ id: tasksPageModId, userId, gridId, role: "page", kind: "board", label: "Tasks" }).save();
  await mkOcc({
    id: tasksPageOccId, moduleId: tasksPageModId,
    parentId: tasksFolderId, sortOrder: 1,
    occurrences: Object.values(taskContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  // ── Trackers page (2026-07-25) — ALL goal containers + the account
  // containers on ONE page (replaces the Goals AND Accounts pages). Keeps the
  // Goals page's date-cascade behavior: the filter is configured but defaults
  // OFF (trackers show totals until the user opts into a period).
  const trackersPageModId = uid(); const trackersPageOccId = uid();
  await new Module({ id: trackersPageModId, userId, gridId, role: "page", kind: "board", label: "Trackers" }).save();
  await mkOcc({
    id: trackersPageOccId, moduleId: trackersPageModId,
    parentId: trackersFolderId, sortOrder: 0,
    occurrences: [...Object.values(goalContOccIds), ...Object.values(accountContOccIds)],
    iteration: { mode: "persistent" }, fields: {},
    filters: [
      {
        id: goalsFilterId, fieldId: dateFieldId, active: false, showNav: true,
        timeUnit: "day", defaultNavValue: null,
        units: ["day", "week", "month", "year"],
        condition: { operator: "OR", rules: [
          { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
          { left: "$field.value", comparator: "IS_EMPTY" },
        ]},
      },
    ],
  });
  // Op-scoping aliases: every tracker that ancestor-scoped to the Goals or
  // Accounts page now scopes to Trackers through the same variables.
  const goalsPageOccId = trackersPageOccId;
  const accountsPageOccId = trackersPageOccId;

  // Patch accountRef predicate now that the Accounts page exists. Any
  // amount-bearing task or bill instance with accountRef gets a dropdown
  // listing every instance parented under the Accounts page (Checking,
  // Savings, Mom's Account, etc.). late-bound predicate — read at render.
  await Field.findOneAndUpdate(
    { id: accountRefFieldId },
    { $set: {
        "meta.optionsSource.predicate": {
          conjunction: "AND",
          rules: [{ left: "$record._ancestors", comparator: "HAS_ANCESTOR", right: accountsPageOccId }],
        },
        "meta.optionsSource.addNew": { parentOccurrenceId: financeAccountContOccId },
    }},
  );

  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({
    id: schedPageOccId, moduleId: schedPageModId,
    parentId: interfacesFolderId, sortOrder: 0,
    occurrences: [], // EMPTY — Schedule: Build Day populates at runtime (Task 13)
    iteration: { mode: "persistent" }, fields: {},
    // Date filter + Time Slot filter (a <select> over the 48 slot labels).
    filters: buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels }),
    // Hide the plumbing fields on every Schedule descendant by default
    // (2026-07-11, per user): Date/Time Slot are stamped by the drop ops and
    // Last Seen by Stamp Date & Time — noise on the task rows. Uses the
    // fieldVisibility cascade (first non-null ancestor value wins), so any
    // descendant can still override with its own fieldVisibility.
    fieldVisibility: { mode: "hide", fieldIds: [dateFieldId, timeslotFieldId, lastSeenFieldId] },
  });

  // (Removed 2026-05-21) Standalone "Canvas" scratchpad page deleted
  // — user consolidated to a single canvas (Schedule Canvas) as the
  // canonical home for the mind-map demo. No consumers in
  // `liveSystemBuilders.js` reference the legacy variables, so the
  // null sentinels are gone too. If a future op needs a generic
  // canvas page, mint a new one — don't reintroduce the standalone.

  // Project kanban template + Project: Create op are wired in STEP 7b
  // (template manifest build). See `buildProjectTemplate` in
  // liveSystemBuilders.js. The Projects folder above starts EMPTY —
  // the user mints new project pages via the Project: Create op
  // (mirroring how Day Page: Build mints day pages per date).

  // Library page — pinned to manifest Library folder only; no grid panel (grid is 2×3 full).
  // filterOverride:{} so the library is always visible regardless of the active date filter.
  const libraryPageOccId = uid();
  await new Module({ id: libraryPageModId, userId, gridId, role: "page", kind: "board", label: "Library" }).save();
  await mkOcc({
    id: libraryPageOccId,
    moduleId: libraryPageModId,
    parentId: libraryFolderId,
    sortOrder: 0,
    occurrences: [libraryContOccId],
    iteration: { mode: "persistent" },
    fields: {},
    filterOverride: {},
    filterNavConfig: { filter_daily: { visible: false } },
  });

  // Schedule Template page is seeded earlier (STEP 7b) under
  // libraryTemplatesFolderId. The Schedule page above starts EMPTY;
  // "Schedule: Build Schedule" COPY_LINKs the Day container from the
  // template page into here per visible day in the active period.

  // Daily Journal Questions page — pinned in Library folder alongside the
  // main Library page. Lets the user manage the question pool the Rotator
  // op + 🎲 randomize button draw from, without scrolling past movies /
  // books / podcasts / courses.
  //
  // Shape: a board page with a single container "Reflection Questions"
  // whose `occurrences[]` lists the same question occurrence IDs that
  // already live under libraryContOccId. Occurrences support multi-parent
  // membership via the occurrences[] array (the canonical parentId stays
  // libraryContOccId), so the questions render here without being moved.
  // Editing a question's label / fields here updates it in the Library
  // too — they're the same physical occurrences.
  const questionsContModId  = uid();
  const questionsContOccId  = uid();
  await new Module({ id: questionsContModId, userId, gridId, role: "container", kind: "board", label: "Reflection Questions" }).save();
  await mkOcc({
    id: questionsContOccId,
    moduleId: questionsContModId,
    // No parentId — this container only renders as a child of the
    // Daily Journal Questions page (it's not in any other tree).
    occurrences: [...phQuestionOccIds],
    filterOverride: {},
  });
  const journalQuestionsPageModId = uid();
  const journalQuestionsPageOccId = uid();
  await new Module({ id: journalQuestionsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Journal Questions" }).save();
  await mkOcc({
    id: journalQuestionsPageOccId,
    moduleId: journalQuestionsPageModId,
    parentId: libraryFolderId,
    sortOrder: 1,
    occurrences: [questionsContOccId],
    iteration: { mode: "persistent" },
    fields: {},
    filterOverride: {},
    filterNavConfig: { filter_daily: { visible: false } },
  });

  // ── Bills page (B3 — under Library folder, sortOrder 2) ─────────────────────
  // Hosts the 5 bill-type containers (Subscriptions/Utilities/Insurance/Loans/
  // Other). Sits in the Library folder per user spec ("a subscription page in
  // a bills page (where library is)"). Bill instances pre-seeded in the bill
  // mappings loop above carry amount + accountRef + cadence/day/anchor +
  // billNextDue field values.
  const billsPageModId = uid();
  const billsPageOccId = uid();
  await new Module({ id: billsPageModId, userId, gridId, role: "page", kind: "board", label: "Bills" }).save();
  await mkOcc({
    id: billsPageOccId,
    moduleId: billsPageModId,
    parentId: libraryFolderId,
    sortOrder: 2,
    occurrences: [
      billSubscriptionsContOccId,
      billUtilitiesContOccId,
      billInsuranceContOccId,
      billLoansContOccId,
      billOtherContOccId,
    ],
    iteration: { mode: "persistent" },
    fields: {},
    filterOverride: {},
    filterNavConfig: { filter_daily: { visible: false } },
  });

  // (People page + People Table + profile-card page removed 2026-07-25 —
  // People renders as a plain BOARD in the Boards folder; person
  // occurrences live under the People board container.)

  // Month View / Week View pages REMOVED (2026-05-24). Schedule page's
  // own filter (week/month unit) drives multi-day rendering via the
  // existing `Schedule: Build Schedule` op (Phase 4b/4c). No separate
  // page modules needed.

  // Patch accountRef predicate to resolve against instances under the
  // Accounts page (so the bill instances' Account dropdown lists Checking,
  // Savings, Mom's Account, etc.). accountsPageOccId is created further below
  // in STEP 8 — at this point in flow the page doesn't exist yet, but the
  // predicate is read at runtime by the client's optionsResolver against
  // $allInstances by ancestor — late binding is fine. Mirrors libraryFieldId.
  // We'll do the predicate write AFTER the accounts page block (it's the
  // same Field.findOneAndUpdate dance), so this comment is a placeholder.

  // Patch billRef / subscriptionRef predicates so the dropdowns resolve
  // against bill instances in the Bills page (billRef = any bill, subscription
  // Ref = only Subscriptions container). Mirrors how libraryFieldId's optionsSource
  // gets patched against libraryContOccId post-seed.
  await Field.findOneAndUpdate(
    { id: billRefFieldId },
    { $set: {
        "meta.optionsSource.predicate": {
          conjunction: "AND",
          rules: [{ left: "$record._ancestors", comparator: "HAS_ANCESTOR", right: billsPageOccId }],
        },
        "meta.optionsSource.addNew": { parentOccurrenceId: billOtherContOccId },
    }},
  );
  await Field.findOneAndUpdate(
    { id: subscriptionRefFieldId },
    { $set: {
        "meta.optionsSource.predicate": {
          conjunction: "AND",
          rules: [{ left: "$record._ancestors", comparator: "HAS_ANCESTOR", right: billSubscriptionsContOccId }],
        },
        "meta.optionsSource.addNew": { parentOccurrenceId: billSubscriptionsContOccId },
    }},
  );

  // ── Schedule Table page (kind:"table", standalone in Interfaces tree) ──────
  // A live mirror of the Schedule built by the "Schedule Table: Build" op.
  // Columns are seeded here (stable ids); the op writes cells + rowCount.
  //   col0 "Task" — full embed, date+timeslot HIDDEN via fieldVisibility
  //   col1 "Date" — same occ, projected to the date field
  //   col2 "Time" — same occ, projected to the timeslot field
  //   col3 "Goal" — the goal instance this row rolls up to (copy-linked)
  // filterOverride:{} so the table is always visible regardless of date nav
  // (its rows already represent a specific built day).
  const STBL_COLS = {
    task: "tcol_task", date: "tcol_date", time: "tcol_time",
  };
  const schedTablePageModId = uid(); const schedTablePageOccId = uid();
  await new Module({ id: schedTablePageModId, userId, gridId, role: "page", kind: "table", label: "Schedule Table" }).save();
  await mkOcc({
    id: schedTablePageOccId, moduleId: schedTablePageModId,
    parentId: interfacesFolderId, sortOrder: 2,
    occurrences: [],
    iteration: { mode: "persistent" }, fields: {},
    // Inherits the date cascade (was filterOverride:{} when the Table: Build
    // OP owned date scoping) — the FEED below materializes exactly the
    // active period's tasks and re-syncs on date navigation.
    filterOverride: null, filterNavConfig: { filter_daily: { visible: false } },
    // FEED (2026-07-07, replaces Table: Build): every instance under the
    // Schedule page → copy-linked child row. helpers/feedSync.js mints/sweeps.
    feed: {
      enabled: true,
      conditions: [],
      roles: ["instance"],
      scope: schedPageOccId,
      sort: { fieldId: timeslotFieldId, dir: "asc" },
      limit: 100,
    },
    meta: {
      table: {
        columns: [
          // Task: full embed (label + every field except date/timeslot which
          // have their own columns). hideLabel false — we want to see the
          // task name in this column.
          { id: STBL_COLS.task, title: "Task", width: 240, displayFieldId: null, sort: null, filter: null,
            fieldVisibility: null, hideLabel: false }, // TEMP: was {mode:"hide", fieldIds:[date,timeslot]} — flipped for stamp-debug visibility
          // Date / Time: render the FULL ModuleInstance for the copy, but
          // filter to a single field via fieldVisibility "show" mode, and
          // hide the label (the row's task name is already in the Task col).
          // ModuleInstance now synthesizes a binding for "show"-mode fieldIds
          // that aren't in the module's fieldBindings (schedule task modules
          // don't formally bind date/timeslot — those are stamped as values
          // by Build Day's defaultFields).
          { id: STBL_COLS.date, title: "Date", width: 200, displayFieldId: null, sort: null, filter: null,
            fieldVisibility: { mode: "show", fieldIds: [dateFieldId]    }, hideLabel: true },
          { id: STBL_COLS.time, title: "Time", width: 200, displayFieldId: null, sort: null, filter: null,
            fieldVisibility: { mode: "show", fieldIds: [timeslotFieldId] }, hideLabel: true },
          // (The old "Goal" column embedded a DIFFERENT occurrence per row —
          // the goal copy the Table: Build op minted. Feed rows render ONE
          // occurrence across all columns, so that column is gone.)
        ],
        rowCount: 0,
        cells: {},
        // Table-level sort: ascending by Time column so rows land in timeslot
        // order regardless of the order rows were appended by Schedule Table:
        // Build (which appends per-task as it walks $allInstances). Per-column
        // sort remains independent — table.sort is the primary, columns[i].sort
        // are additional layers (merged in ContainerTable's `sorting` useMemo).
        sort: { colId: STBL_COLS.time, dir: "asc" },
      },
    },
  });

  // ── Schedule Canvas page (kind:"canvas", standalone in Interfaces tree) ────
  // Mirror of the Schedule into a canvas layout. Each task on the active day
  // gets ONE copy-linked occurrence parented under this canvas page with
  // meta.x/y stamped by Schedule Canvas: Build so the cards land in a tidy
  // column. filterOverride:{} so the canvas is always visible regardless of
  // date navigation (its rows represent a specific built day, and the
  // canvas page is intentionally outside the daily date cascade).
  const schedCanvasPageModId = uid(); const schedCanvasPageOccId = uid();
  await new Module({ id: schedCanvasPageModId, userId, gridId, role: "page", kind: "canvas", label: "Schedule Canvas" }).save();
  await mkOcc({
    id: schedCanvasPageOccId, moduleId: schedCanvasPageModId,
    parentId: interfacesFolderId, sortOrder: 3,
    occurrences: [], // the FEED below populates at runtime (feedSync engine)
    iteration: { mode: "persistent" }, fields: {},
    // Inherits the date cascade (see Schedule Table above).
    filterOverride: null, filterNavConfig: { filter_daily: { visible: false } },
    // FEED (2026-07-07, replaces Canvas: Build): active-period Schedule tasks
    // as copy-linked canvas cards; drag positions live on the copies' meta.x/y.
    feed: {
      enabled: true,
      conditions: [],
      roles: ["instance"],
      scope: schedPageOccId,
      sort: { fieldId: timeslotFieldId, dir: "asc" },
      limit: 100,
    },
  });

  // ── Folder-page defaults (card-grid landing tabs) ──────────────────────────
  // Each hub panel opens to a folder-page (role:"page" kind:"folder") that
  // renders a PreviewNode card grid of every sibling occurrence parented in
  // the same folder (PageFolder filters `occurrencesById` by parentId ===
  // folder-page.parentId, excludes self/templates/other folder-pages).
  // ManifestTree's FolderNode also resolves these on click — pre-creating
  // them gives us stable IDs to pin + a deterministic seed instead of the
  // lazy on-demand mint.
  const toolkitFolderPageModId  = uid();
  const toolkitFolderPageOccId  = uid();
  await new Module({ id: toolkitFolderPageModId,  userId, gridId, role: "page", kind: "folder", label: "Daily Toolkit" }).save();
  await mkOcc({
    id: toolkitFolderPageOccId, moduleId: toolkitFolderPageModId,
    parentId: dailyToolkitFolderId, sortOrder: -1,
    occurrences: [],
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  const notebookFolderPageModId = uid();
  const notebookFolderPageOccId = uid();
  await new Module({ id: notebookFolderPageModId, userId, gridId, role: "page", kind: "folder", label: "Interfaces" }).save();
  await mkOcc({
    id: notebookFolderPageOccId, moduleId: notebookFolderPageModId,
    parentId: interfacesFolderId, sortOrder: -1,
    occurrences: [],
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  // ── Examples: sample image / video / pdf artifacts ────────────────────────
  // Lives in the Examples folder; pinned to the Notebook hub panel as a tab
  // so the artifact viewer + ArtifactCard rendering are visible end-to-end
  // on a fresh re-seed without the user having to drop any files. fileRefs
  // are absolute URLs (Wikimedia / GCS / W3C) — resolveFileRef passes those
  // through unchanged, so no upload is needed.
  const SAMPLE_ARTIFACTS = [
    { name: "Earthrise (Apollo 8).jpg", kind: "image", mime: "image/jpeg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/NASA-Apollo8-Dec24-Earthrise.jpg/1280px-NASA-Apollo8-Dec24-Earthrise.jpg" },
    { name: "Pillars of Creation.jpg", kind: "image", mime: "image/jpeg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg/1280px-Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg" },
    { name: "Blue Marble (Apollo 17).jpg", kind: "image", mime: "image/jpeg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1280px-The_Earth_seen_from_Apollo_17.jpg" },
    { name: "Big Buck Bunny (sample).mp4", kind: "video", mime: "video/mp4",
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
    { name: "W3C dummy.pdf", kind: "pdf", mime: "application/pdf",
      url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
  ];

  const sampleArtifactOccIds = [];
  for (const spec of SAMPLE_ARTIFACTS) {
    const artModId = uid();
    const artViewId = uid();
    const artOccId = uid();
    await new Module({
      id: artModId, userId, gridId,
      role: "artifact", kind: spec.kind,
      label: spec.name, fileRef: spec.url, defaultDragMode: "copy",
      meta: {
        mimeType: spec.mime, originalName: spec.name,
        uploadStatus: "ready", folderId: examplesFolderId,
        external: true, // marks absolute-URL artifacts (no local file on disk)
      },
    }).save();
    await new View({ id: artViewId, userId, gridId, viewType: "display", artifactType: spec.kind, layout: {} }).save();
    await mkOcc({
      id: artOccId, moduleId: artModId,
      parentId: examplesFolderId, viewId: artViewId,
      sortOrder: sampleArtifactOccIds.length,
    });
    sampleArtifactOccIds.push(artOccId);
  }

  // Container that surfaces the artifacts in a board view.
  const examplesContModId = uid();
  const examplesContOccId = uid();
  await new Module({ id: examplesContModId, userId, gridId, role: "container", kind: "board", label: "Sample Files" }).save();
  await mkOcc({
    id: examplesContOccId, moduleId: examplesContModId,
    parentId: null, // only renders as a child of the Examples page below
    occurrences: sampleArtifactOccIds,
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {},
  });

  // Page that hosts the container. Pinned to the Notebook panel below so the
  // user lands on a working artifact gallery on a fresh seed.
  const examplesPageModId = uid();
  const examplesPageOccId = uid();
  await new Module({ id: examplesPageModId, userId, gridId, role: "page", kind: "board", label: "Examples" }).save();
  await mkOcc({
    id: examplesPageOccId, moduleId: examplesPageModId,
    parentId: examplesFolderId, sortOrder: 0,
    occurrences: [examplesContOccId],
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  // ── Brand: Viafluere "about" page (top-middle cell) ──────────────────────
  // Generated through the SAME markdown importer the Wikipedia import uses, so it
  // reads like a wiki article: ONE doc container, markdown-header sections, the
  // logo as a wrapped lead image (text flows around it). Content from
  // docs/original-vision.md + docs/NEWOVERVIEW.md. The fileRef /viafluere_sideways.png
  // is the brand lockup served from the client build's public assets.
  const viafluereMd = [
    "# viafluere",
    "",
    "![](/viafluere_new_logo_sideways.png)",
    "",
    "**Viafluere** is a workspace you build out of blocks. Pages, boards, documents, canvases, tables, files — you drag them wherever you want, connect them however you like, and attach numbers to anything worth measuring. It isn't a planner, a notes app, or a tracker: it's the material those things are made of, in one place, under your control.",
    "",
    "## What it is",
    "",
    "Most apps decide in advance what your things are — a \"task\", a \"note\", an \"event\" — and lock each kind in its own app. Viafluere has one kind of thing: an *item* you place wherever it's useful. The same item can sit in a board column, be mentioned inside a document, appear as a card on a mind-map canvas, and show up as a row in a table — all at once, all in sync. Move it, copy it, or link copies together so checking one checks them all.",
    "",
    "## Anything can be measured",
    "",
    "Any item can carry *fields* — typed blanks that collect real data: numbers, money, durations, ratings, dates, dropdowns, images. A note can stay a note forever; the moment you care about \"how much\" or \"how many\", you attach a field and it becomes a measurement:",
    "",
    "- Ran ✅ for 25 minutes",
    "- Ate ✅ 42g protein",
    "- Saved ✅ $20",
    "- Read ✅ 30 pages",
    "",
    "## Rules you can read",
    "",
    "*Operations* are small, visible pipelines that watch your items and act on them — count, sum, track streaks, move balances, build pages, ring alarms at a time you set. They aggregate by what an item is, the values in its fields, the time window (today / this week / month / year), and any category filter. Explicit math, no black-box scores: open any operation and see exactly which items it counted and why — then change the rules when your life changes.",
    "",
    "## One example: a daily command center",
    "",
    "Nothing above knows what a \"schedule\" is — and that's the point. The grid you're looking at is one *use case* assembled from those blocks: a column of time slots (just containers), tasks you drag into them (just items with fields), and trackers that light up as you complete things (just operations). The same blocks could be a project kanban, a reading log, a household budget, a people directory, a research wiki — the Library, Projects, and People pages here are more examples living in the same workspace.",
    "",
    "## Build it your way",
    "",
    "- **Panels and pages** — the big regions of your screen. Split them, stack them, resize them, swap what's inside.",
    "- **Boards, documents, canvases, tables, and files** — different lenses on the same items, freely mixed on one grid.",
    "- **Time and category filters** — one switch shows today, this week, or just \"work stuff\"; everything on screen follows, cascading from the grid down to each item.",
    "- **Alarms & reminders** — set a time, get a ring and a notification; each one is just another visible, editable operation.",
    "- **An in-app assistant** that can build pages, import articles, and wire up rules for you when you'd rather describe than drag.",
    "",
    "Everything updates instantly as you work, syncs in real time across devices, and keeps a full history — so you can always ask not just *what* changed, but *when* and *by how much*.",
  ].join("\n");

  const viafluereImport = await markdownToModuli({ gridId, userId, markdown: viafluereMd, dryRun: false });
  const logoRootOccId = viafluereImport.rootOccurrenceId;

  // Doc page wrapping the imported article (same shape the Wikipedia import wrap
  // uses) so the panel renders it as a tab.
  const logoPageModId = uid();
  const logoPageOccId = uid();
  await new Module({ id: logoPageModId, userId, gridId, role: "page", kind: "doc", label: "Viafluere" }).save();
  await mkOcc({
    id: logoPageOccId, moduleId: logoPageModId,
    parentId: null, sortOrder: 0,
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
    textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: logoRootOccId } }] },
  });

  // Notebook hub View — the middle column is ONE full-height panel now
  // (2026-07-03, per user: "make the top middle panel extend to the bottom
  // middle … start it off as the description site image page"). The Viafluere
  // description/logo page is the default active tab; Schedule / Interfaces
  // folder-page / Canvas / Schedule Table / Schedule Canvas stay pinned.
  const notebookHubViewId = uid();
  await new View({ id: notebookHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: logoPageOccId }).save();

  // Daily Toolkit View — folder-page (card grid of all 11 wellness pages) is
  // the default active tab; per-wellness pages remain pinned as tabs.
  const toolkitHubViewId = uid();
  await new View({ id: toolkitHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: toolkitFolderPageOccId }).save();

  // ── STEP 9: Panel modules + panel occurrences (grid placements) ─────────────
  // Layout (2 rows × 3 cols per buildGridDoc):
  //   [0,0] Daily Toolkit   [0,1 h=2] Notebook hub   [0,2] Daily Goals
  //   [1,0] Todo List                                [1,2] Accounts
  const panelLayout = (name) => ({ name, display: "flex", flow: "column", wrap: "nowrap", gapPx: 4, scrollY: "auto", padding: "sm" });

  const toolkitPanelId  = uid();
  const todoPanelId     = uid();
  const notebookPanelId = uid();
  const goalsPanelId    = uid();
  const accountsPanelId = uid();

  await Module.insertMany([
    { id: toolkitPanelId,  userId, gridId, role: "panel", kind: "board", label: "Panel A", defaultDragMode: "copy", layout: panelLayout("Panel A") },
    { id: todoPanelId,     userId, gridId, role: "panel", kind: "board", label: "Panel B", defaultDragMode: "move", layout: { ...panelLayout("Panel B"), gapPx: 8 } },
    { id: notebookPanelId, userId, gridId, role: "panel", kind: "board", label: "Panel C", defaultDragMode: "move", layout: panelLayout("Panel C") },
    { id: goalsPanelId,    userId, gridId, role: "panel", kind: "board", label: "Panel D", defaultDragMode: "move", layout: panelLayout("Panel D") },
    { id: accountsPanelId, userId, gridId, role: "panel", kind: "board", label: "Panel E", defaultDragMode: "move", layout: panelLayout("Panel E") },
  ]);

  const panelOccIds = {};
  const panelModuleIds = {
    toolkit:  toolkitPanelId,
    todo:     todoPanelId,
    notebook: notebookPanelId,
    goals:    goalsPanelId,
    accounts: accountsPanelId,
  };
  // Middle column is ONE full-height hub panel (height 2 spans both rows).
  // The Viafluere description/logo page is its active tab (see the View
  // above); Schedule and the rest stay pinned as tabs.
  const placements = [
    { key: "toolkit",  panelId: toolkitPanelId,  row: 0, col: 0, width: 1, height: 1, viewId: toolkitHubViewId  },
    { key: "todo",     panelId: todoPanelId,     row: 1, col: 0, width: 1, height: 1, viewId: null              },
    { key: "notebook", panelId: notebookPanelId, row: 0, col: 1, width: 1, height: 2, viewId: notebookHubViewId },
    { key: "goals",    panelId: goalsPanelId,    row: 0, col: 2, width: 1, height: 1, viewId: null              },
    { key: "accounts", panelId: accountsPanelId, row: 1, col: 2, width: 1, height: 1, viewId: null              },
  ];

  const gridOccIds = [];
  for (const p of placements) {
    const occId = await mkOcc({
      moduleId: p.panelId,
      placement: { row: p.row, col: p.col, width: p.width, height: p.height },
      ...(p.viewId && { viewId: p.viewId }),
      meta: { autohide: true },
    });
    panelOccIds[p.key] = occId;
    gridOccIds.push(occId);
  }

  // ── STEP 10: Wire page occurrences into panel occurrences ───────────────────
  // Notebook hub pins Schedule + Canvas. The Day Page tab is NOT pinned here —
  // Day Page: Build adds it via ADD_CHILD at runtime (Task 13). Notebook DOC
  // pages (Task 11) are NOT pinned — they live only under notesFolderId.
  await Occurrence.findOneAndUpdate({ id: panelOccIds.toolkit },  { $set: { occurrences: [toolkitFolderPageOccId, ...wellnessPageOccList] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.todo },     { $set: { occurrences: [tasksPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.notebook }, { $set: { occurrences: [logoPageOccId, schedPageOccId, notebookFolderPageOccId, schedCanvasPageOccId, examplesPageOccId].filter(Boolean) } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.goals },    { $set: { occurrences: [goalsPageOccId] } });
  // The Accounts page is folded into Trackers — the freed panel opens the
  // Boards drill-down (Boards → life area → board).
  await Occurrence.findOneAndUpdate({ id: panelOccIds.accounts }, { $set: { occurrences: [boardsFolderPageOccId] } });

  // ── STEP 11: Finalize grid ──────────────────────────────────────────────────
  // Open the seeded grid in BSP "mosaic" layout (opt-in per grid — see
  // client/src/helpers/bspTree.js). Mirrors the rows×cols placement above:
  // col0 = toolkit over todo, col1 = the full-height Viafluere/Notebook hub,
  // col2 = goals over accounts. Side columns ~20% thinner than the middle
  // (2026-07-03, per user). The user re-tunes pane sizes by dragging the
  // splitter bars.
  const mosaicLayoutTree = {
    id: "mosaic-root", dir: "v", ratio: [0.8, 1, 0.8],
    children: [
      { id: "mosaic-col0", dir: "h", ratio: [1, 1], children: [
        { id: "mosaic-leaf-toolkit", panelOccId: panelOccIds.toolkit },
        { id: "mosaic-leaf-todo",    panelOccId: panelOccIds.todo },
      ] },
      // Middle: ONE full-height hub pane (Viafluere description page active).
      { id: "mosaic-leaf-notebook", panelOccId: panelOccIds.notebook },
      { id: "mosaic-col2", dir: "h", ratio: [1, 1], children: [
        { id: "mosaic-leaf-goals",    panelOccId: panelOccIds.goals },
        { id: "mosaic-leaf-accounts", panelOccId: panelOccIds.accounts },
      ] },
    ],
  };
  // Fresh seed marker every run — the assistant drawer compares this to the one
  // it last saw (localStorage) and clears its chat history when it changes, so a
  // reseed starts the Jonah conversation fresh (see client AssistantDrawer).
  // colSizes mirrors the mosaic ratio for the rows×cols fallback path.
  // meta.defaultGrid: the server's full_state fallback prefers this grid when
  // the client has no / a stale gridId — so the site loads the seeded grid by
  // default. Cleared on the user's other grids first so exactly one is default.
  await Grid.updateMany({ userId }, { $unset: { "meta.defaultGrid": "" } });
  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccIds, colSizes: [0.8, 1, 0.8], "meta.layoutTree": mosaicLayoutTree, "meta.assistantSeedId": uid(), "meta.defaultGrid": true, "meta.scheduleFieldIds": { dateFieldId, timeslotFieldId, scheduleFormatFieldId } } });

  // ── STEP 12: Operations ─────────────────────────────────────────────────────
  //
  // NO LEGACY. Every aggregation that createDefaultUserData STEP 1b expressed as
  // a makeLoop*/makeNetBalanceOp/makeCompletionRateOp is converted 1:1 here to a
  // makeTrackerOp (new conversion engine). Zero AGGREGATE / legacy makeLoop
  // pipelines exist in this grid — the only ops are the 4 shared schedule/day-
  // page ops + the converted trackers below.
  //
  // goalLabel = the EXACT label of the goalInstances/accountInstances display
  // instance that binds the target display field (makeTrackerOp does
  // `FIND $allInstances label IS <goalLabel>` then UPDATEs
  // `$goalItem.fields.<goalFieldId>.value`). Derived from the seed defs above
  // (lines ~1508-1658), not guessed. Where several instances bind the same
  // target field, the canonical first/most-aligned owner is chosen (mirrors
  // createTestGrid's "Physical Wellness" owning totalWater).
  //
  // scopeLabel "Schedule" for ALL trackers: Build Day sweeps tasks (incl.
  // expenses/income/workouts) under the Schedule page, so every aggregation —
  // daily AND lifetime — reads its source data from there (same data path as
  // createTestGrid, whose trackers are all Schedule-scoped).
  //
  // NOT converted (intentionally — not aggregations, not in the Task 13 map):
  //   "Daily Question Cycle"   (CYCLE_FIELD_VALUE)
  //   "Days Until Due"         (DATE_DIFF, per-occurrence)
  //   "Overdue Tasks Count"    (COUNT_DATE_OVERDUE)
  //   "Due This Week"          (COUNT_DATE_UPCOMING)
  // These are countdown/cycle ops with no makeLoop/AGGREGATE shape, out of
  // scope for the conversion engine; the live grid simply omits them.
  //
  // SKIPPED (no owning display instance — see concerns):
  //   "Task Count Today"  → fields.taskCount  : NOT bound role:"display" by any
  //                          goal/account instance (also true in legacy seed).
  //   "Calories Today"    → fields.calories   : bound only as role:"input"; no
  //                          goal instance shows it (legacy: same — nutritionGoal
  //                          binds protein/carbs/fats, never calories).
  //   A makeTrackerOp for either would FIND nothing and silently never update,
  //   which the task rules forbid. Their display fields are not surfaced
  //   anywhere in the live grid, so no UI value is lost.

  // scopePageOccId: picker-direct Schedule-page reference for every tracker's
  // HAS_ANCESTOR scope — replaces the FIND-by-label `label IS "Schedule"` inside
  // makeTrackerOp (no label check; the seed has the id here at wiring time).
  const trackerArgs = { userId, gridId, dateFieldId, completedFieldId, folderId: opCategoryIds.trackers, scopePageOccId: schedPageOccId };

  // ── DAILY TASK / WELLNESS ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Completed",
    goalLabel: "Completed", goalOccurrenceId: goalOccIds.physicalCompleted, goalFieldId: fields.totalCompleted.id,
    agg: "countTrue", timeFilter: "daily",
    // Paired with Task Countdown on the same per-metric occurrence: this
    // counts UP as tasks complete. Target rules carry the met/notMet
    // signal when a target is set on totalCompleted; value-fallback covers
    // untargeted days. ArrowUp throughout (more done = good direction).
    displayRules: {
      "Completed": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();

  // ── Tracker: Task Countdown ────────────────────────────────────────────────
  // Same loop as "Tracker: Completed" (countTrue completed tasks under
  // Schedule for the active day) but writes (10 - count) into the
  // taskCountdown display field on the Completed per-metric occurrence.
  // Pairs with Tracker: Completed: completing a task fires both —
  // totalCompleted goes +1, taskCountdown goes -1. Custom pipeline
  // (makeTrackerOp can't write a derived value to a different goalFieldId).
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Task Countdown",
    description: "Count completed tasks under Schedule for the active day; write (10 - count) to the Completed per-metric occurrence's taskCountdown display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field", targetId: completedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // $displayRules — countdown semantic: any positive value reads as
        // "still work to do" (red), zero reads as "complete" (green +
        // checkmark). Null = goal not yet evaluated (blue). Keyed by the
        // per-metric "Completed" label since taskCountdown lives on that
        // occurrence — sibling Water/Steps/Streak trackers run their own
        // $displayRules in their own pipeline frames, so this rule only
        // decorates writes from THIS op.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify({
          "Completed": [
            { when: { value: "null" },     color: "rgb(96,165,250)" },
            { when: { value: "zero" },     color: "rgb(134,239,172)", icon: "Check" },
            { when: { value: "positive" }, color: "rgb(252,165,165)", icon: "ArrowDown", suffix: "left" },
          ],
        })}` } },
        // 1. Picker-style direct binding to Completed per-metric occurrence.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",   expr: `$allItemsById.${goalOccIds.physicalCompleted}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId", expr: "$goalItem.id" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // 2. Picker-style direct binding to the Schedule page (HAS_ANCESTOR scope).
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
            // 3. Resolve goal-period date.
            { id: uid(), type: "action", config: {
              type: "INIT_VAR", name: "$goalPeriod",
              expr: `$goalItem._effectiveFilter.${dateFieldId}`,
              fallback: "$trigger.date", fallback2: "$today",
            } },
            // 4. Init countdown at 10 (the target / starting value).
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$countdown", value: 10 } },
            // 5. Loop completed tasks today under Schedule; decrement $countdown each.
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: `$item.fields.${completedFieldId}.value`, comparator: "IS", right: true },
                    { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                  ] },
                  then: [
                    { id: uid(), type: "action", config: { type: "DECREMENT_VAR", name: "$countdown", by: 1 } },
                  ],
                  else: [],
                },
              ],
            },
            // 6. Write countdown value to taskCountdown field on the Completed per-metric occurrence.
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.taskCountdown.id}.value`, value: "$countdown" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Days Until Due ─────────────────────────────────────────────────────────
  // Per-occurrence DATE_DIFF: for every occurrence carrying a `Due` date value,
  // write (dueDate - today) in days into its `Days Until Due` display field.
  // Todo-list instances bind this field as a display; without this op nothing
  // computed it, so it always read empty. Fires when a Due date changes, on
  // load, and on filter nav (so "today" advancing re-derives the countdown).
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Days Until Due",
    description: "For each occurrence with a Due date, write (dueDate − today) in days to its Days Until Due display field.",
    triggerTypes: ["onChange", "onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: dueFieldId, priority: 4 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "",         priority: 4 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "",         priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: {
          type: "DATE_DIFF",
          dateFieldId: dueFieldId,
          targetFieldId: fields.daysUntilDue.id,
          perOccurrence: true,
        } },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // Tracker: Today's Moods — replaces the prior "Latest Mood" agg:"last".
  // Builds an array of {mood, date} rows for every mood-bearing occurrence
  // in $goalPeriod (day/week/month/year — broader windows return multiple
  // rows). Writes into the per-metric "Mood" occurrence under Emotional.
  // Trigger surface matches makeTrackerOp's so onLoad / Nav / onChange /
  // onAdd / onDelete all re-aggregate.
  await new Operation({
    id: uid(), userId, gridId, priority: 3, folderId: opCategoryIds.trackers,
    name: "Moods",
    description: "Build a [{mood, date}] row list for every mood-bearing item in the goal's selected period and write it to the Mood per-metric occurrence under Emotional.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.mood.id, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // 1. Picker-direct binding to the Mood per-metric occurrence under
        //    Emotional (was FIND-by-label "Emotional Balance" — replaced
        //    when the umbrella summary was split Stage 3).
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem", expr: `$allItemsById.${goalOccIds.emotionalMood}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Resolve $goalPeriod from the goal item's effective filter (full
        // {value, unit} object form — DATE_IN_PERIOD reads both shapes).
        { type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 3. Find the Schedule page (for HAS_ANCESTOR scoping).
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22 per "don't check by label ever").
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 4. Init the rows array + the single-value "last mood" sink.
        { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$lastMoodSingle", value: "" } },
        // 5. Loop $allInstances — match every occurrence in $goalPeriod under
        // Schedule that has a non-empty mood field value, and push the row.
        // Also overwrite $lastMoodSingle each iteration — at loop end it
        // holds the last-iterated occurrence's mood (task #29 — paired
        // single-value with the array).
        {
          type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            {
              type: "if",
              condition: {
                conjunction: "AND",
                rules: [
                  { left: `$inst.fields.${fields.mood.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  { left: `$inst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                  { left: "$inst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                ],
              },
              then: [
                {
                  type: "action", action: "PUSH_TO_ARRAY",
                  cfg: {
                    name: "$rows",
                    // task #29 — added timeslot + date to row shape. timeslot
                    // is what the user actually anchors moods to (per "most
                    // recent by timeslot, not creation time"); date is shown
                    // when a multiday filter is active.
                    value: {
                      mood:     `$inst.fields.${fields.mood.id}.value`,
                      timeslot: `$inst.fields.${timeslotFieldId}.value`,
                      date:     `$inst.fields.${dateFieldId}.value`,
                    },
                  },
                },
                // Per-iteration overwrite — last match wins, becomes the
                // single-value "last mood" sink.
                { type: "action", action: "SET_VAR", cfg: { name: "$lastMoodSingle", expr: `$inst.fields.${fields.mood.id}.value` } },
              ],
              else: [],
            },
          ],
        },
        // 6. Write the rows array to the goal item's lastMood display field.
        { type: "action", action: "UPDATE",
          cfg: { path: `$goalItem.fields.${fields.lastMood.id}.value`, value: "$rows" },
        },
        // 7. Write $lastMoodSingle to mostRecentMood (task #29 — paired
        // single-value with the array; iteration order = timeslot order on
        // $allInstances, so last assignment = most-recent mood).
        { type: "action", action: "UPDATE",
          cfg: { path: `$goalItem.fields.${fields.mostRecentMood.id}.value`, value: "$lastMoodSingle" },
        },
      ],
    },
  }).save();

  // ── Tracker: Phone Calls (task #46 extension 2026-05-23) ─────────────────
  // Mirrors the Moods tracker shape. Builds an array of {name, timeslot, date}
  // rows for every completed Call-Person task in $goalPeriod, plus a scalar
  // counter for the "Call 2 people" progress target. The `peopleAssigned`
  // multi-select on the task module is an array of person occurrence ids;
  // the inner LOOP iterates that array and resolves each id to a name.
  await new Operation({
    id: uid(), userId, gridId, priority: 3, folderId: opCategoryIds.trackers,
    name: "Phone Calls",
    description: "Build a [{name, timeslot, date}] row list of completed Call-Person tasks for the goal's selected period and write to the Phone Calls per-metric occurrence under Social. Also writes a scalar count for the 2-person target.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: peopleAssignedFieldId, priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId,      priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // 1. Picker-direct binding to the Phone Calls per-metric occurrence
        //    under Social (was FIND-by-label "Social Connection" — replaced
        //    when the umbrella was split Stage 3).
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem", expr: `$allItemsById.${goalOccIds.socialPhoneCalls}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Resolve $goalPeriod from the goal item's effective filter.
        { type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 3. Schedule page anchor for HAS_ANCESTOR scoping.
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 4. Init rows + counter.
        { type: "action", action: "INIT_VAR", cfg: { name: "$rows",  value: [] } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$count", value: 0 } },
        // 5. Outer LOOP over every Call-Person task occurrence in $goalPeriod.
        {
          type: "loop", overExpr: "$allInstances", as: "$call",
          body: [
            {
              type: "if",
              condition: {
                conjunction: "AND",
                rules: [
                  // Call task — label match scopes to "Call a Friend" copies.
                  { left: "$call.templateId",                         comparator: "IS",             right: actionInstances.call.id },
                  { left: `$call.fields.${dateFieldId}.value`,        comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                  { left: "$call._ancestors",                         comparator: "HAS_ANCESTOR",   right: "$schedPageId" },
                  { left: "$call.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                  { left: `$call.fields.${completedFieldId}.value`,   comparator: "IS",             right: true },
                  { left: `$call.fields.${peopleAssignedFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                ],
              },
              then: [
                // Inner LOOP — peopleAssigned is an array of person occ ids;
                // resolve each via $allItemsById and push one row per call.
                {
                  type: "loop", overExpr: `$call.fields.${peopleAssignedFieldId}.value`, as: "$personId",
                  body: [
                    { type: "action", action: "INIT_VAR", cfg: { name: "$person", expr: `$allItemsById.\${$personId}` } },
                    { type: "action", action: "PUSH_TO_ARRAY",
                      cfg: {
                        name: "$rows",
                        value: {
                          name:     `$person.fields.${personNameFieldId}.value`,
                          timeslot: `$call.fields.${timeslotFieldId}.value`,
                          date:     `$call.fields.${dateFieldId}.value`,
                        },
                      },
                    },
                    { type: "action", action: "INCREMENT_VAR", cfg: { name: "$count", by: 1 } },
                  ],
                },
              ],
              else: [],
            },
          ],
        },
        // 6. Write rows + count to the goal item.
        { type: "action", action: "UPDATE",
          cfg: { path: `$goalItem.fields.${phoneCallsFieldId}.value`, value: "$rows" },
        },
        { type: "action", action: "UPDATE",
          cfg: { path: `$goalItem.fields.${totalPhoneCallsFieldId}.value`, value: "$count" },
        },
      ],
    },
  }).save();

  // ── DAILY ACTIVITY ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Steps",
    goalLabel: "Steps", goalOccurrenceId: goalOccIds.physicalSteps, goalFieldId: fields.totalSteps.id,
    sourceFieldId: fields.steps.id, agg: "sum", timeFilter: "daily",
    // Target rules win when a target is set on the display field; the
    // value-fallback rules catch the no-target case (or any day with no
    // step entries). Same pattern Time Spent / Pages use.
    displayRules: {
      "Steps": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Water",
    goalLabel: "Water", goalOccurrenceId: goalOccIds.physicalWater, goalFieldId: fields.totalWater.id,
    sourceFieldId: fields.water.id, agg: "sum", timeFilter: "daily",
    // Goal-with-target rules: green ArrowUp when hitting target, red
    // ArrowUp when not. The arrow direction is the SAME (up = good for
    // water) — color carries the met/notMet signal. Keyed off the
    // per-metric Water occurrence label since that's where the totalWater
    // display field now lives.
    displayRules: {
      "Water": [
        { when: { target: "met" },    color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" }, color: "rgb(252,165,165)", icon: "ArrowUp" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Time Spent",
    goalLabel: "Reading Time", goalOccurrenceId: goalOccIds.intellectualReadingTime, goalFieldId: fields.totalDuration.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "daily",
    // Pages-style neutral counter — more is good but less isn't bad.
    displayRules: {
      "Reading Time": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Pages",
    goalLabel: "Pages Read", goalOccurrenceId: goalOccIds.intellectualPagesRead, goalFieldId: fields.totalPages.id,
    sourceFieldId: fields.pages.id, agg: "sum", timeFilter: "daily",
    // Untargeted counter rule (no positive/negative connotation per
    // user spec): blue at 0/null, green when filled. No icon — pages
    // read has no "good direction" because not reading is neutral.
    displayRules: {
      "Pages Read": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  // Pomodoro daily aggregations — count + minutes + lastPomodoro + history
  // all write into the SAME per-metric "Pomodoros" occurrence under
  // Intellectual. Source data: Pomodoro session occurrences COPY_LINKed into
  // Schedule slots by Pomodoro: Start (then marked completed by Pomodoro:
  // Complete). Pomodoro History is a row-builder (custom pipeline) and lives
  // further down with the other PUSH_TO_ARRAY trackers.
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Pomodoros Today",
    goalLabel: "Pomodoros", goalOccurrenceId: goalOccIds.intellectualPomodoros, goalFieldId: fields.pomoCount.id,
    agg: "countTrue", timeFilter: "daily", presenceFieldId: fields.pomodoroNumber.id,
    // Pomodoros has a daily target (3) on its display field — apply
    // the Water pattern: green ArrowUp on met, red ArrowUp on notMet.
    displayRules: {
      "Pomodoros": [
        { when: { target: "met" },    color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" }, color: "rgb(252,165,165)", icon: "ArrowUp" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Pomodoro Time",
    goalLabel: "Pomodoros", goalOccurrenceId: goalOccIds.intellectualPomodoros, goalFieldId: fields.pomoTime.id,
    sourceFieldId: fields.pomodoroMinutes.id, agg: "sum", timeFilter: "daily",
    // Pages-style neutral counter — no target. (The docket's
    // state-based rule scheme — red on "paused" / green on "running"
    // — requires a sibling `state` field that doesn't exist; the
    // Pomodoro instance has `pomodoroPhase` with "work"/"break"
    // values, not a running/paused state. Switching to neutral rule
    // until / unless that shape is added.)
    displayRules: {
      "Pomodoros": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();

  // ── DAILY FINANCE ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Spent",
    goalLabel: "Spent", goalOccurrenceId: goalOccIds.financialSpent, goalFieldId: fields.totalSpent.id,
    sourceFieldId: fields.amount.id, agg: "sum", flow: "out", timeFilter: "daily", // finance gate OFF by default (container opts out)
    // Money OUT — "negative connotation" per user spec: any positive
    // amount spent reads red regardless of sign. 0/null is blue.
    displayRules: {
      "Spent": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(252,165,165)", icon: "ArrowDown" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Earned",
    goalLabel: "Income", goalOccurrenceId: goalOccIds.financialIncome, goalFieldId: fields.totalIncome.id,
    sourceFieldId: fields.income.id, agg: "sum", flow: "in", timeFilter: "daily", // finance gate OFF by default (container opts out)
    // Money IN — positive complement to Spent. null/zero blue (no
    // income, no signal), positive green with ArrowUp ("money flowing
    // in is good"). Mirrors Spent's structure (red + ArrowDown) so the two
    // per-metric tiles (Spent + Income) on the Financial goal read as a
    // paired signal.
    displayRules: {
      "Income": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)", icon: "ArrowUp" },
      ],
    },
  })).save();

  // ── DAILY NUTRITION ──
  // All three macros share the same target-based rule shape (Water pattern):
  // hitting your macro target reads green ArrowUp, falling short reads red
  // ArrowUp — same direction (more = good), color carries the met signal.
  // null/zero blue as a no-signal fallback when the day's intake is empty.
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Protein",
    goalLabel: "Protein", goalOccurrenceId: goalOccIds.nutritionProtein, goalFieldId: fields.totalProtein.id,
    sourceFieldId: fields.protein.id, agg: "sum", timeFilter: "daily",
    displayRules: {
      "Protein": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Carbs",
    goalLabel: "Carbs", goalOccurrenceId: goalOccIds.nutritionCarbs, goalFieldId: fields.totalCarbs.id,
    sourceFieldId: fields.carbs.id, agg: "sum", timeFilter: "daily",
    displayRules: {
      "Carbs": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Fats",
    goalLabel: "Fats", goalOccurrenceId: goalOccIds.nutritionFats, goalFieldId: fields.totalFats.id,
    sourceFieldId: fields.fats.id, agg: "sum", timeFilter: "daily",
    displayRules: {
      "Fats": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();

  // ── DAILY WORKOUT (multi-source roll-up) ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Total Reps",
    goalLabel: "Reps", goalOccurrenceId: goalOccIds.workoutReps, goalFieldId: fields.totalRepsToday.id,
    sourceFieldIds: [fields.set1Reps.id, fields.set2Reps.id, fields.set3Reps.id],
    agg: "multiSum", timeFilter: "daily",
    requireCompleted: true, // reps only count once the workout is completed (2026-07-09)
    // Steps-style: target rules + value-fallback. The per-muscle Volume
    // trackers below run their own custom pipelines so this only
    // decorates writes to the top-level Workout goal.
    displayRules: {
      "Reps": [
        { when: { target: "met" },     color: "rgb(134,239,172)", icon: "ArrowUp" },
        { when: { target: "notMet" },  color: "rgb(252,165,165)", icon: "ArrowUp" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();

  // ── PER-MUSCLE VOLUME (B7 Deep) ─────────────────────────────────────────────
  // One tracker per muscle group: sums set1+set2+set3 reps across workouts
  // whose `muscleGroup` field matches, scoped to today. Writes the sum into
  // the muscle-specific goal instance's `totalRepsToday` display field.
  // Custom pipeline (makeTrackerOp doesn't take a muscle-filter param).
  const MUSCLE_GROUPS = [
    { key: "chest",     goalLabel: "Chest Volume",     occId: goalOccIds.chestVolumeGoal },
    { key: "back",      goalLabel: "Back Volume",      occId: goalOccIds.backVolumeGoal },
    { key: "legs",      goalLabel: "Legs Volume",      occId: goalOccIds.legsVolumeGoal },
    { key: "shoulders", goalLabel: "Shoulders Volume", occId: goalOccIds.shouldersVolumeGoal },
    { key: "arms",      goalLabel: "Arms Volume",      occId: goalOccIds.armsVolumeGoal },
    { key: "cardio",    goalLabel: "Cardio Volume",    occId: goalOccIds.cardioVolumeGoal },
  ];
  for (const { key, goalLabel, occId } of MUSCLE_GROUPS) {
    await new Operation({
      id: uid(), userId, gridId, priority: 3,
      name: goalLabel,
      description: `Sum set1+set2+set3 reps across workouts with muscleGroup="${key}" on the active day; write to the "${goalLabel}" goal's totalRepsToday.`,
      triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
      triggerObjects: [
        { eventType: "onChange",       subjectType: "field", targetId: fields.set1Reps.id,    priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.set2Reps.id,    priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.set3Reps.id,    priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.muscleGroup.id, priority: 3 },
        { eventType: "onAdd",          subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
        { eventType: "onDelete",       subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
        { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
        { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 3 },
      ],
      pipeline: {
        sources: [],
        steps: [
          // 1. Picker-style direct binding to the per-muscle goal instance.
          // Replaces the prior FIND-by-label (rename-fragile).
          { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",   expr: `$allItemsById.${occId}` } },
          { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId", expr: "$goalItem.id" } },
          // 2. Bail if goal missing.
          { id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
            then: [
              // 3. Resolve the active goal-period date (matches other trackers).
              { id: uid(), type: "action", config: {
                type: "INIT_VAR", name: "$goalPeriod",
                expr: `$goalItem._effectiveFilter.${dateFieldId}`,
                fallback: "$trigger.date", fallback2: "$today",
              } },
              // 4. Init accumulator.
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$acc", value: 0 } },
              // 5. Loop workouts; for each matching muscle + date, add reps.
              { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
                body: [
                  { id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: `$item.fields.${fields.muscleGroup.id}.value`, comparator: "IS", right: key },
                      { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      // Scope + feed guard (2026-07-09) — match the stock Total Reps tracker:
                      // only SCHEDULE items count, and feed copies (Schedule Table / Canvas
                      // mirrors, meta.feedSourceId) never aggregate — they triple-counted
                      // every scheduled workout (user saw 90 for one 30-rep workout).
                      { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: schedPageOccId },
                      { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      // Completion gate (2026-07-09) — volume only counts a workout the
                      // user actually COMPLETED (an uncompleted set is intent, not fact —
                      // same rule as Steps/Water/Protein). User: "it added the total weight
                      // volume even though i didnt complete the workout."
                      { id: uid(), left: `$item.fields.${fields.completed.id}.value`, comparator: "IS", right: true },
                    ] },
                    then: [
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.set1Reps.id}.value` } },
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.set2Reps.id}.value` } },
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.set3Reps.id}.value` } },
                    ],
                    else: [],
                  },
                ],
              },
              // 6. Write total to the goal's totalRepsToday display.
              { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.totalRepsToday.id}.value`, value: "$acc" } },
            ],
            else: [],
          },
        ],
      },
      folderId: opCategoryIds.trackers,
      enabled: true,
    }).save();
  }

  // ── PER-MEAL NUTRITION (B7 Deep) ────────────────────────────────────────────
  // One tracker per meal category. Sums ALL FOUR macros (calories / protein /
  // carbs / fats — was protein-only until 2026-07-14) across nutrition
  // instances whose `mealCategory` matches, scoped to today. Writes the sums
  // into the per-meal goal's macro displays.
  const MEAL_CATEGORIES = [
    { key: "Breakfast", goalLabel: "Breakfast Nutrition", occId: goalOccIds.breakfastNutritionGoal },
    { key: "Lunch",     goalLabel: "Lunch Nutrition",     occId: goalOccIds.lunchNutritionGoal },
    { key: "Dinner",    goalLabel: "Dinner Nutrition",    occId: goalOccIds.dinnerNutritionGoal },
    { key: "Snack",     goalLabel: "Snack Nutrition",     occId: goalOccIds.snackNutritionGoal },
  ];
  for (const { key, goalLabel, occId } of MEAL_CATEGORIES) {
    await new Operation({
      id: uid(), userId, gridId, priority: 3,
      name: goalLabel,
      description: `Sum calories/protein/carbs/fats across nutrition instances with mealCategory="${key}" on the active day; write to the "${goalLabel}" goal's macro displays.`,
      triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
      triggerObjects: [
        { eventType: "onChange",       subjectType: "field", targetId: fields.protein.id,       priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.calories.id,      priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.carbs.id,         priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.fats.id,          priority: 3 },
        { eventType: "onChange",       subjectType: "field", targetId: fields.mealCategory.id,  priority: 3 },
        { eventType: "onAdd",          subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
        { eventType: "onDelete",       subjectType: "module", subjectRole: "instance", targetId: "", priority: 3 },
        { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
        { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 3 },
      ],
      pipeline: {
        sources: [],
        steps: [
          // 1. Picker-style direct binding to the per-meal goal instance.
          { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",   expr: `$allItemsById.${occId}` } },
          { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId", expr: "$goalItem.id" } },
          { id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
            then: [
              { id: uid(), type: "action", config: {
                type: "INIT_VAR", name: "$goalPeriod",
                expr: `$goalItem._effectiveFilter.${dateFieldId}`,
                fallback: "$trigger.date", fallback2: "$today",
              } },
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$acc",   value: 0 } },
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$cal",  value: 0 } },
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$carb", value: 0 } },
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$fat",  value: 0 } },
              { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
                body: [
                  { id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: `$item.fields.${fields.mealCategory.id}.value`, comparator: "IS", right: key },
                      { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      // Scope + feed guard (2026-07-09) — see the muscle-volume note above.
                      { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: schedPageOccId },
                      { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      // Completion gate (2026-07-09) — a meal's macros only count once the
                      // meal task is completed (matches Protein/Carbs/Fats totals).
                      { id: uid(), left: `$item.fields.${fields.completed.id}.value`, comparator: "IS", right: true },
                    ] },
                    then: [
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc",  expr: `$item.fields.${fields.protein.id}.value` } },
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$cal",  expr: `$item.fields.${fields.calories.id}.value` } },
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$carb", expr: `$item.fields.${fields.carbs.id}.value` } },
                      { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$fat",  expr: `$item.fields.${fields.fats.id}.value` } },
                    ],
                    else: [],
                  },
                ],
              },
              // totalProtein FIRST — the behavioral harness's trackerValue()
              // reads the op's first goal-field write as its canonical value.
              { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.totalProtein.id}.value`,  value: "$acc" } },
              { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.totalCalories.id}.value`, value: "$cal" } },
              { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.totalCarbs.id}.value`,    value: "$carb" } },
              { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.totalFats.id}.value`,     value: "$fat" } },
            ],
            else: [],
          },
        ],
      },
      folderId: opCategoryIds.trackers,
      enabled: true,
    }).save();
  }

  // ── ALL-TIME / ACCOUNT AGGREGATIONS ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Checking Balance",
    goalLabel: "Checking Account", goalOccurrenceId: accountOccIds.bankAccount, goalFieldId: fields.checkingBalance.id,
    incomeFieldId: fields.income.id, spentFieldId: fields.amount.id,
    // FINANCE keeps the date gate but it's OFF by default: the financeAccount
    // container opts out of the date cascade (DATE_FILTER_OFF_BY_DEFAULT), so
    // $goalPeriod resolves empty → the period-all policy's "empty → do-all" makes
    // the balance CUMULATIVE (running total of ALL transactions). Activating the
    // date filter on the container narrows it to the picked day / span.
    agg: "net", timeFilter: "daily",
    // accountRef narrows to items pointing at Checking; the Schedule scope
    // ALSO applies (2026-07-11) — a transaction counts only once it's in
    // the Schedule and completed. supportsReplace honors the "Set Account
    // Balance" task's flow:"replace" amount as a balance reset.
    accountRefFieldId: accountRefFieldId, accountOccurrenceId: accountOccIds.bankAccount,
    supportsReplace: true,
    // Account balance can swing positive OR negative — mirrors Net Worth
    // (in the goals docket). Negative reads red w/ ArrowDown ("in the
    // hole"), positive reads green w/ ArrowUp, zero/null blue (no
    // signal). Same rule applies to Mom's Account below.
    displayRules: {
      "Checking Account": [
        { when: { value: "negative" }, color: "rgb(252,165,165)", icon: "ArrowDown" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)", icon: "ArrowUp" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Mom's Account Balance",
    goalLabel: "Mom's Account", goalOccurrenceId: accountOccIds.momsAccount, goalFieldId: fields.momsAccountBalance.id,
    sourceFieldId: fields.amount.id, agg: "sum", timeFilter: "daily", // finance gate OFF by default (container opts out) → cumulative until activated
    // accountRef narrows to items tagged Mom's; the Schedule scope ALSO
    // applies (2026-07-11) — in-schedule + completed to count. supportsReplace
    // honors "Set Account Balance" resets pointed at this account.
    accountRefFieldId: accountRefFieldId, accountOccurrenceId: accountOccIds.momsAccount,
    supportsReplace: true,
    // Same negative/zero/positive pattern as the main Checking Account.
    displayRules: {
      "Mom's Account": [
        { when: { value: "negative" }, color: "rgb(252,165,165)", icon: "ArrowDown" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)", icon: "ArrowUp" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Cash Balance",
    goalLabel: "Cash", goalOccurrenceId: accountOccIds.cashAccount, goalFieldId: fields.cashBalance.id,
    sourceFieldId: fields.amount.id, agg: "sum", timeFilter: "daily", // finance gate OFF by default (container opts out) → cumulative until activated
    // Same policy as Mom's: accountRef narrows to items tagged Cash; the
    // Schedule scope + completion gate apply; "Set Account Balance" resets
    // pointed at Cash land via supportsReplace.
    accountRefFieldId: accountRefFieldId, accountOccurrenceId: accountOccIds.cashAccount,
    supportsReplace: true,
    displayRules: {
      "Cash": [
        { when: { value: "negative" }, color: "rgb(252,165,165)", icon: "ArrowDown" },
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)", icon: "ArrowUp" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Total Workouts",
    goalLabel: "Fitness Stats", goalOccurrenceId: accountOccIds.fitnessAccount, goalFieldId: fields.totalWorkouts.id,
    agg: "countTrue", timeFilter: "daily",
    // Only items that carry a muscleGroup value are workouts — without this
    // gate every completed Schedule item (water logs, mood checks) counted
    // as a workout (caught by the 2026-07-07 behavioral probe).
    presenceFieldId: fields.muscleGroup.id,
    // All-time accumulating counter — Pages pattern. Blue at 0/null, green
    // once filled. No target on the display field, so no target-based rules.
    displayRules: {
      "Fitness Stats": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Total Reading Time",
    goalLabel: "Reading Stats", goalOccurrenceId: accountOccIds.readingAccount, goalFieldId: fields.totalReadingTime.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "daily",
    // All-time accumulator, Pages pattern — neutral counter (more is
    // good but absence isn't bad).
    displayRules: {
      "Reading Stats": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Completion Rate",
    goalLabel: "Productivity", goalOccurrenceId: accountOccIds.productivityAccount, goalFieldId: fields.completionRate.id,
    agg: "completionRate", timeFilter: "daily",
    // Percentage without a configured target — single catch-all per the
    // docket's "percentages without targets" entry. Blue throughout
    // (no signal direction means avoid implying green/red).
    displayRules: {
      "Productivity": [
        { when: {}, color: "rgb(96,165,250)" },
      ],
    },
  })).save();

  // ── WEEKLY SUMMARY ──
  // Legacy "Time Spent This Week" reused the totalDuration display field. In the
  // live port totalDuration is bound by both "Reading Time" (daily per-metric,
  // above) and "Productivity" (productivityAccount order 1). Targeting
  // "Productivity" here keeps the weekly value off the daily "Reading Time"
  // tile so the two don't clobber each other. KNOWN LIMITATION (Task 13 rule 4):
  // makeTrackerOp's weekly loop gate uses real SAME_WEEK, but the per-event
  // trigger date sub-rule stays SAME_DAY — onLoad/Nav bulk triggers self-heal.
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Time Spent This Week",
    goalLabel: "Productivity", goalOccurrenceId: accountOccIds.productivityAccount, goalFieldId: fields.totalDuration.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "weekly",
    // Pages-style neutral counter (no target on the weekly field).
    displayRules: {
      "Productivity": [
        { when: { value: "null" },     color: "rgb(96,165,250)" },
        { when: { value: "zero" },     color: "rgb(96,165,250)" },
        { when: { value: "positive" }, color: "rgb(134,239,172)" },
      ],
    },
  })).save();

  // ── Tracker: Movies Watched ────────────────────────────────────────────────
  // Custom string-building pipeline (not makeTrackerOp — that's numeric only).
  // Trigger surface mirrors Water Today + Tasks Completed Today for parity,
  // including the trigger gate IF block (same OR rules as makeTrackerOp:
  // onLoad / NavigationOp always pass; item events pass only when the trigger
  // item's date matches $goalDate; MeasureOp gated on moviesWatchedFieldId).
  // Pipeline: FIND "Movies Watched" goal instance → resolve $goalDate → FIND
  // Schedule page → [trigger gate] → LOOP $allInstances for Watch Movie occs
  // dated $goalDate → inner LOOP over moviesWatched array → resolve each movie
  // label → concat to $output → UPDATE display field on the goal item.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Movies Watched",
    description: "Build a label list of movies watched today and update the Movies Watched goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: moviesWatchedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Picker-direct binding to the Movies per-type occurrence under Media
        //    (was FIND-by-label "Movies Watched" — replaced when the standalone
        //    goal folded into the Media container, Stage 3).
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem",   expr: `$allItemsById.${goalOccIds.mediaMovies}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalPeriod from the goal item's effective filter — full
        // {value, unit} object (DATE_IN_PERIOD reads both bare-string + object).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 5. Trigger gate (mirrors makeTrackerOp's triggerGateRules OR block).
        // Per-event sub-rules use DATE_IN_PERIOD $goalPeriod so weekly/monthly
        // views retrigger on any in-period item change, not just same-day.
        {
          type: "if",
          condition: { operator: "OR", rules: [
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "onLoad" }] },
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "NavigationOp" }] },
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator + count + last-title scalars.
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
            { type: "action", action: "INIT_VAR", cfg: { name: "$lastTitle", value: "" } },
            // 5b. Loop over Watch Movie occurrences in $goalPeriod under Schedule
            {
              type: "loop",
              overExpr: "$allInstances",
              as: "$watchInst",
              body: [
                {
                  type: "if",
                  condition: {
                    conjunction: "AND",
                    rules: [
                      { left: `$watchInst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      { left: "$watchInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { left: "$watchInst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      { left: "$watchInst.templateId", comparator: "IS", right: actionInstances.watch.id },
                    ],
                  },
                  then: [
                    // Inner loop: iterate the moviesWatched array (array of occurrence IDs)
                    {
                      type: "loop",
                      overExpr: `$watchInst.fields.${moviesWatchedFieldId}.value`,
                      as: "$movieOccId",
                      body: [
                        // Resolve the movie occurrence from $allInstances
                        {
                          type: "action", action: "FIND",
                          cfg: {
                            over: "$allInstances",
                            predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: "$movieOccId" }] },
                            itemVar: "$movie", itemIdVar: "$movieId",
                          },
                        },
                        // Push {label, date} when the movie resolved
                        {
                          type: "if",
                          condition: { conjunction: "AND", rules: [{ left: "$movieId", comparator: "IS_NOT_EMPTY", right: "" }] },
                          then: [
                            {
                              type: "action", action: "PUSH_TO_ARRAY",
                              cfg: {
                                name: "$rows",
                                value: {
                                  poster:   { kind: "media", id: "$movie.id", fieldId: posterUrlFieldId },
                                  label:    { kind: "occurrence", id: "$movie.id" },
                                  timeslot: `$watchInst.fields.${timeslotFieldId}.value`,
                                  date:     `$watchInst.fields.${dateFieldId}.value`,
                                },
                              },
                            },
                            { type: "action", action: "SET_VAR", cfg: { name: "$lastTitle", expr: "$movie.label" } },
                          ],
                          else: [],
                        },
                      ],
                    },
                  ],
                  else: [],
                },
              ],
            },
            // 5c. Write history rows + last-title to the Movies occ.
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$goalItem.fields.${moviesWatchedDisplayFieldId}.value`, value: "$rows" },
            },
            { type: "action", action: "UPDATE", cfg: { path: `$goalItem.fields.${lastMovieFieldId}.value`, value: "$lastTitle" } },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Books Read ────────────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for books.
  // Trigger gate added to match makeTrackerOp surface.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Books Read",
    description: "Build a label list of books read today and update the Books Read goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: booksReadFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Picker-direct binding to the Books per-type occurrence under Media
        //    (was FIND-by-label "Books Read" — folded into Media, Stage 3).
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem",   expr: `$allItemsById.${goalOccIds.mediaBooks}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 5. Trigger gate — mirrors makeTrackerOp's triggerGateRules OR block.
        {
          type: "if",
          condition: { operator: "OR", rules: [
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "onLoad" }] },
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "NavigationOp" }] },
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator + count + last-title scalars.
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
            { type: "action", action: "INIT_VAR", cfg: { name: "$lastTitle", value: "" } },
            // 5b. Loop over Reading occurrences in $goalPeriod under Schedule
            {
              type: "loop",
              overExpr: "$allInstances",
              as: "$readInst",
              body: [
                {
                  type: "if",
                  condition: {
                    conjunction: "AND",
                    rules: [
                      { left: `$readInst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      { left: "$readInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { left: "$readInst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      { left: "$readInst.templateId", comparator: "IS", right: actionInstances.read.id },
                    ],
                  },
                  then: [
                    // Inner loop: iterate the booksRead array (array of occurrence IDs)
                    {
                      type: "loop",
                      overExpr: `$readInst.fields.${booksReadFieldId}.value`,
                      as: "$bookOccId",
                      body: [
                        // Resolve the book occurrence from $allInstances
                        {
                          type: "action", action: "FIND",
                          cfg: {
                            over: "$allInstances",
                            predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: "$bookOccId" }] },
                            itemVar: "$book", itemIdVar: "$bookId",
                          },
                        },
                        // Push a row { label, pages, date } when found
                        {
                          type: "if",
                          condition: { conjunction: "AND", rules: [{ left: "$bookId", comparator: "IS_NOT_EMPTY", right: "" }] },
                          then: [
                            {
                              type: "action", action: "PUSH_TO_ARRAY",
                              cfg: {
                                name: "$rows",
                                value: {
                                  poster:   { kind: "media", id: "$book.id", fieldId: posterUrlFieldId },
                                  label:    { kind: "occurrence", id: "$book.id" },
                                  pages:    `$book.fields.${pagesFieldId}.value`,
                                  timeslot: `$readInst.fields.${timeslotFieldId}.value`,
                                  date:     `$readInst.fields.${dateFieldId}.value`,
                                },
                              },
                            },
                            { type: "action", action: "SET_VAR", cfg: { name: "$lastTitle", expr: "$book.label" } },
                          ],
                          else: [],
                        },
                      ],
                    },
                  ],
                  else: [],
                },
              ],
            },
            // 5c. Write history rows + last-title to the Books occ.
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$goalItem.fields.${booksReadDisplayFieldId}.value`, value: "$rows" },
            },
            { type: "action", action: "UPDATE", cfg: { path: `$goalItem.fields.${lastBookFieldId}.value`, value: "$lastTitle" } },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Podcasts Listened ─────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for podcasts.
  // Trigger gate added to match makeTrackerOp surface.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Podcasts Listened",
    description: "Build a label list of podcasts listened today and update the Podcasts Listened goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: podcastsListenedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Podcasts Listened goal instance
        {
          type: "action", action: "INIT_VAR", cfg: { name: "$goalItem", expr: `$allItemsById.${goalOccIds.mediaPodcasts}` },
        },
        // (Picker-direct binding to the Podcasts per-type occurrence under Media
        //  — was FIND-by-label "Podcasts Listened" — folded into Media, Stage 3.)
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 5. Trigger gate — mirrors makeTrackerOp's triggerGateRules OR block.
        {
          type: "if",
          condition: { operator: "OR", rules: [
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "onLoad" }] },
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "NavigationOp" }] },
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator + count + last-title scalars.
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
            { type: "action", action: "INIT_VAR", cfg: { name: "$lastTitle", value: "" } },
            // 5b. Loop over Listen to Podcast occurrences in $goalPeriod under Schedule
            {
              type: "loop",
              overExpr: "$allInstances",
              as: "$podcastInst",
              body: [
                {
                  type: "if",
                  condition: {
                    conjunction: "AND",
                    rules: [
                      { left: `$podcastInst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      { left: "$podcastInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { left: "$podcastInst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      { left: "$podcastInst.templateId", comparator: "IS", right: actionInstances.listen.id },
                    ],
                  },
                  then: [
                    // Inner loop: iterate the podcastsListened array (array of occurrence IDs)
                    {
                      type: "loop",
                      overExpr: `$podcastInst.fields.${podcastsListenedFieldId}.value`,
                      as: "$podcastOccId",
                      body: [
                        // Resolve the podcast occurrence from $allInstances
                        {
                          type: "action", action: "FIND",
                          cfg: {
                            over: "$allInstances",
                            predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: "$podcastOccId" }] },
                            itemVar: "$podcast", itemIdVar: "$podcastId",
                          },
                        },
                        // Push {label, date} when the podcast resolved
                        {
                          type: "if",
                          condition: { conjunction: "AND", rules: [{ left: "$podcastId", comparator: "IS_NOT_EMPTY", right: "" }] },
                          then: [
                            {
                              type: "action", action: "PUSH_TO_ARRAY",
                              cfg: {
                                name: "$rows",
                                value: {
                                  label:    { kind: "occurrence", id: "$podcast.id" },
                                  timeslot: `$podcastInst.fields.${timeslotFieldId}.value`,
                                  date:     `$podcastInst.fields.${dateFieldId}.value`,
                                },
                              },
                            },
                            { type: "action", action: "SET_VAR", cfg: { name: "$lastTitle", expr: "$podcast.label" } },
                          ],
                          else: [],
                        },
                      ],
                    },
                  ],
                  else: [],
                },
              ],
            },
            // 5c. Write history rows + last-title to the Podcasts occ.
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$goalItem.fields.${podcastsListenedDisplayFieldId}.value`, value: "$rows" },
            },
            { type: "action", action: "UPDATE", cfg: { path: `$goalItem.fields.${lastPodcastFieldId}.value`, value: "$lastTitle" } },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Courses Taken ─────────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for courses. Writes
  // into the per-metric "Courses" occurrence under Intellectual (moved from
  // the standalone Courses Taken container when Stage 3 split the goals
  // occurrence-wise).
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Courses Taken",
    description: "Build a label list of courses taken today and update the Courses per-metric occurrence's display field under Intellectual.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: coursesTakenFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", ancestorLabel: "Schedule", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Picker-direct binding to the Courses per-metric occurrence
        //    under Intellectual (was FIND-by-label "Courses Taken").
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItem", expr: `$allItemsById.${goalOccIds.intellectualCourses}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$goalItemId", expr: "$goalItem.id" } },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 5. Trigger gate — mirrors makeTrackerOp's triggerGateRules OR block.
        {
          type: "if",
          condition: { operator: "OR", rules: [
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "onLoad" }] },
            { operator: "AND", rules: [{ left: "$trigger.type", comparator: "IS", right: "NavigationOp" }] },
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "OccurrenceDeleteOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
            { operator: "AND", rules: [
              { left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
            // 5b. Loop over Online Course occurrences in $goalPeriod under Schedule
            {
              type: "loop",
              overExpr: "$allInstances",
              as: "$courseInst",
              body: [
                {
                  type: "if",
                  condition: {
                    conjunction: "AND",
                    rules: [
                      { left: `$courseInst.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
                      { left: "$courseInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                      { left: "$courseInst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                      { left: "$courseInst.templateId", comparator: "IS", right: actionInstances.study.id },
                    ],
                  },
                  then: [
                    // Inner loop: iterate the coursesTaken array (array of occurrence IDs)
                    {
                      type: "loop",
                      overExpr: `$courseInst.fields.${coursesTakenFieldId}.value`,
                      as: "$courseOccId",
                      body: [
                        // Resolve the course occurrence from $allInstances
                        {
                          type: "action", action: "FIND",
                          cfg: {
                            over: "$allInstances",
                            predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: "$courseOccId" }] },
                            itemVar: "$course", itemIdVar: "$courseId",
                          },
                        },
                        // Push {label, date} when the course resolved
                        {
                          type: "if",
                          condition: { conjunction: "AND", rules: [{ left: "$courseId", comparator: "IS_NOT_EMPTY", right: "" }] },
                          then: [
                            {
                              type: "action", action: "PUSH_TO_ARRAY",
                              cfg: {
                                name: "$rows",
                                value: {
                                  label:    "$course.label",
                                  timeslot: `$courseInst.fields.${timeslotFieldId}.value`,
                                  date:     `$courseInst.fields.${dateFieldId}.value`,
                                },
                              },
                            },
                          ],
                          else: [],
                        },
                      ],
                    },
                  ],
                  else: [],
                },
              ],
            },
            // 5c. Write the rows array to the multi-column display field.
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$goalItem.fields.${coursesTakenDisplayFieldId}.value`, value: "$rows" },
            },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Daily Question Rotator ────────────────────────────────────────────────
  // Picks the first reflection question from the library (stable by label sort
  // from FIND — deterministic v1 placeholder; true day-rotation can be wired
  // later via a MOD primitive or CYCLE_FIELD_VALUE on a dedicated select field).
  //
  // Pipeline:
  //   1. FIND $schedPage (needed for HAS_ANCESTOR)
  //   2. INIT_VAR $today
  //   3. FIND $firstQuestion (library "question" type, first match)
  //   4. FIND $journalingInst (Daily Journal, under Schedule, dated $today)
  //   5. IF both found: UPDATE journalQuestion display value on $journalingInst
  //
  // Trigger surface: onLoad + onFilterChange (goal-scoped) + onAdd/onDelete
  // to mirror the tracker pattern and fire on Schedule date navigation.
  await new Operation({
    id: uid(), userId, gridId, priority: 3, folderId: opCategoryIds.daypage,
    name: "Daily Question Rotator",
    description: "Pick today's reflection question from the library and write it to the Daily Journal's journalQuestion display field.",
    triggerTypes: ["onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Intellectual", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule page (for HAS_ANCESTOR on journaling instance lookup)
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { type: "action", action: "INIT_VAR", cfg: { name: "$schedPageId", expr: "$schedPage.id" } },
        // 2. Resolve today's date from active filter
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$today", expr: `$schedPage._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 3. Find the first reflection question from the library (deterministic v1 picker)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: {
              conjunction: "AND",
              rules: [
                { left: `fields.${libraryFieldId}.value`, comparator: "IS", right: "question" },
              ],
            },
            itemVar: "$firstQuestion", itemIdVar: "$firstQuestionId",
          },
        },
        // 4. Bail if no question found in library
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$firstQuestionId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 5. Find the Daily Journal instance — anywhere in the grid (Daily
        // Toolkit's Intellectual category seeds it; Schedule may or may not
        // include it depending on the Daily Routine picks). Date-filter on
        // today when the instance carries a date field; instances without a
        // date binding (the persistent toolkit copy) match unconditionally.
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: {
              conjunction: "AND",
              rules: [
                { left: "templateId", comparator: "IS", right: actionInstances.journal.id },
              ],
            },
            itemVar: "$journalingInst", itemIdVar: "$journalingInstId",
          },
        },
        // 6. Write the question label to the journalQuestion display field
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$journalingInstId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$journalingInst.fields.${journalQuestionFieldId}.value`, value: "$firstQuestion.label" },
            },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Stamp Filter Date ─────────────────────────────────────────────
  // **Disabled 2026-05-21** — the Date field is no longer bound to goal /
  // account instances (see the loop removal earlier in the seed). Without
  // a binding to display the stamped value, this op is now dead weight on
  // every load + filter change. Kept seeded but disabled so the op record
  // exists if we ever re-bind the Date field; flip `enabled: true` to
  // resurrect.
  await new Operation({
    id: uid(), userId, gridId, priority: 2,
    name: "Stamp Filter Date",
    description: "DISABLED 2026-05-21 (commit 088b35a2). Originally stamped each goal/account instance's _effectiveFilter date into its dateFieldId. The date field was removed from goal/account instances entirely — the page-header date filter covers the same intent — so this op is now enabled:false and kept only for run-log archaeology / quick re-enable if the design reverses.",
    triggerTypes: ["onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers",    priority: 2 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 2 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 2 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 2 },
    ],
    pipeline: {
      sources: [],
      steps: [
        {
          id: uid(), type: "loop", overExpr: "$allInstances", as: "$goal",
          body: [
            {
              id: uid(), type: "if",
              condition: { operator: "OR", rules: [
                { id: uid(), left: "$goal._ancestors", comparator: "HAS_ANCESTOR", right: goalsPageOccId },
                { id: uid(), left: "$goal._ancestors", comparator: "HAS_ANCESTOR", right: accountsPageOccId },
              ] },
              then: [
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$gd", expr: `$goal._effectiveFilter.${dateFieldId}` } },
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$gd", comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [
                    { id: uid(), type: "action", config: { type: "UPDATE", path: `$goal.fields.${dateFieldId}.value`, value: "$gd" } },
                  ],
                  else: [],
                },
              ],
              else: [],
            },
          ],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: false,
  }).save();

  // ── Goals: Date-Prefix Labels ───────────────────────────────────────────────
  // Renames each goal/tracker tile under the Goals page to reflect the active
  // filter date — "Today's Water", "Yesterday's Water", "July 18th Water" — so
  // the tile name tells you which day's data you're looking at as you navigate.
  // 100% data-driven: writes occurrence.label (a per-placement override the
  // renderer prefers over the module label) via the UPDATE_ITEM_LABEL effect.
  // Reads $goal.moduleLabel (the STABLE template base) so it never re-prefixes
  // its own previous write, and $activeDatePossessive (resolved from THIS op's
  // targetOccurrenceId = the Goals page, so an on-page date switch relabels even
  // when the grid filter hasn't moved — same cascade the trackers use).
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Trackers: Date-Prefix Labels",
    description: "Sets each goal/tracker tile's label to '<active date>'s <name>' (Today's / Yesterday's / July 18th) so the tile reflects the day being viewed. Writes occurrence.label; reads moduleLabel as the stable base; date from the Goals page filter cascade.",
    triggerTypes: ["onFilterChange", "onLoad"],
    targetOccurrenceId: goalsPageOccId,
    triggerObjects: [
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 4 },
      { eventType: "onFilterChange", subjectType: "grid",      targetId: "", priority: 4 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        {
          id: uid(), type: "loop", overExpr: "$allInstances", as: "$goal",
          body: [
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$goal._ancestors", comparator: "HAS_ANCESTOR", right: goalsPageOccId },
                { id: uid(), left: "$goal.moduleLabel", comparator: "IS_NOT_EMPTY", right: "" },
              ] },
              then: [
                { id: uid(), type: "action", config: { type: "UPDATE", path: "$goal.label", value: "${$activeDatePossessive} ${$goal.moduleLabel}" } },
              ],
              else: [],
            },
          ],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Tracker: Net Worth ─────────────────────────────────────────────────────
  // Sum of Checking (checkingBalance) + Savings (savingsBalance) + Mom's
  // Account (momsAccountBalance) under the Accounts page. Net Worth itself
  // sits on the same page; the loop predicate selects each account by label
  // and reads ITS OWN balance field (no shared netBalance — account split
  // 2026-05-22). Net Worth occurrence writes the sum to its own netBalance
  // display field.
  await new Operation({
    id: uid(), userId, gridId, priority: 6,
    name: "Net Worth",
    description: "Sum Checking (checkingBalance) + Savings (savingsBalance) + Mom's Account (momsAccountBalance) into the Net Worth instance's netBalance display.",
    triggerTypes: ["onChange", "onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field", targetId: fields.checkingBalance.id,    priority: 6 },
      { eventType: "onChange",       subjectType: "field", targetId: fields.savingsBalance.id,     priority: 6 },
      { eventType: "onChange",       subjectType: "field", targetId: fields.momsAccountBalance.id, priority: 6 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 6 },
      { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 6 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // $displayRules — net worth is positive-connotation money. Green
        // ArrowUp when positive, red ArrowDown when negative (overdrawn),
        // blue at 0/null. Mirrors the Earned tracker's value-direction
        // semantics from the existing rule pool.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify({
          "Net Worth": [
            { when: { value: "negative" }, color: "rgb(252,165,165)", icon: "ArrowDown" },
            { when: { value: "null" },     color: "rgb(96,165,250)" },
            { when: { value: "zero" },     color: "rgb(96,165,250)" },
            { when: { value: "positive" }, color: "rgb(134,239,172)", icon: "ArrowUp" },
          ],
        })}` } },
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$goalItem", expr: `$allItemsById.${accountOccIds.netWorth}`,
        } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId", expr: "$goalItem.id" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$acc", value: 0 } },
            // Checking: read its own checkingBalance.
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: accountsPageOccId },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: "$item.templateId", comparator: "IS", right: accountInstances.bankAccount.id },
                    { id: uid(), left: `$item.fields.${fields.checkingBalance.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.checkingBalance.id}.value` } }],
                  else: [],
                },
              ],
            },
            // Savings: read its own savingsBalance.
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: accountsPageOccId },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: "$item.templateId", comparator: "IS", right: accountInstances.savingsAccount.id },
                    { id: uid(), left: `$item.fields.${fields.savingsBalance.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.savingsBalance.id}.value` } }],
                  else: [],
                },
              ],
            },
            // Mom's Account: read momsAccountBalance.
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: accountsPageOccId },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: "$item.templateId", comparator: "IS", right: accountInstances.momsAccount.id },
                    { id: uid(), left: `$item.fields.${fields.momsAccountBalance.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.momsAccountBalance.id}.value` } }],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.netBalance.id}.value`, value: "$acc" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Tracker: Total Subscriptions ───────────────────────────────────────────
  // Sum of `amount` across every bill under the Subscriptions container.
  // Writes to the Total Subscriptions account's amount display field.
  await new Operation({
    id: uid(), userId, gridId, priority: 6,
    name: "Total Subscriptions",
    description: "Sum the amount field of every bill under the Subscriptions container into the Total Subscriptions account display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field", targetId: fields.amount.id, priority: 6 },
      { eventType: "onAdd",          subjectType: "module", subjectRole: "instance", targetId: "", priority: 6 },
      { eventType: "onDelete",       subjectType: "module", subjectRole: "instance", targetId: "", priority: 6 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 6 },
      { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 6 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // $displayRules — subscriptions are recurring expenses (negative
        // money). Same shape as Monthly Bills: red on any positive,
        // neutral blue at 0/null.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify({
          "Total Subscriptions": [
            { when: { value: "null" },     color: "rgb(96,165,250)" },
            { when: { value: "zero" },     color: "rgb(96,165,250)" },
            { when: { value: "positive" }, color: "rgb(252,165,165)" },
          ],
        })}` } },
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [{ id: uid(), left: "templateId", comparator: "IS", right: accountInstances.totalSubscriptions.id }] },
          itemVar: "$goalItem", itemIdVar: "$goalItemId",
        } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$acc", value: 0 } },
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: billSubscriptionsContOccId },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: `$item.fields.${fields.amount.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.amount.id}.value` } }],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.amount.id}.value`, value: "$acc" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Tracker: Monthly Bills ─────────────────────────────────────────────────
  // Sum of `amount` across every bill under the Bills page with cadence
  // "monthly". Writes to Monthly Bills account display field.
  await new Operation({
    id: uid(), userId, gridId, priority: 6,
    name: "Monthly Bills",
    description: "Sum the amount field of every monthly-cadence bill under the Bills page into the Monthly Bills account display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field", targetId: fields.amount.id,         priority: 6 },
      { eventType: "onChange",       subjectType: "field", targetId: billCadenceFieldId,       priority: 6 },
      { eventType: "onAdd",          subjectType: "module", subjectRole: "instance", targetId: "", priority: 6 },
      { eventType: "onDelete",       subjectType: "module", subjectRole: "instance", targetId: "", priority: 6 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 6 },
      { eventType: "onLoad",         subjectType: "grid", targetId: "", priority: 6 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // $displayRules — bills are owed money, so any positive value is a
        // bad signal (red). Zero/null reads neutral (blue). No icon — the
        // value itself is the indicator. Targets the "Monthly Bills"
        // occurrence label since that's where the amount display lives.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify({
          "Monthly Bills": [
            { when: { value: "null" },     color: "rgb(96,165,250)" },
            { when: { value: "zero" },     color: "rgb(96,165,250)" },
            { when: { value: "positive" }, color: "rgb(252,165,165)" },
          ],
        })}` } },
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [{ id: uid(), left: "templateId", comparator: "IS", right: accountInstances.monthlyBills.id }] },
          itemVar: "$goalItem", itemIdVar: "$goalItemId",
        } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalItemId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$acc", value: 0 } },
            { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: billsPageOccId },
                    { id: uid(), left: "$item.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: `$item.fields.${billCadenceFieldId}.value`, comparator: "IS", right: "monthly" },
                    { id: uid(), left: `$item.fields.${fields.amount.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                  ] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$acc", expr: `$item.fields.${fields.amount.id}.value` } }],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.amount.id}.value`, value: "$acc" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Bill: Compute Next Due ─────────────────────────────────────────────────
  // For each bill in the Bills page, derive the next due date from its cadence
  // shape and write it to billNextDue. Mirrors the JS-side seed computeNextDue
  // but runs as a live pipeline so user edits to cadence/day/anchor (or
  // marking a Pay Bill task complete + rolling the cycle) recompute the field.
  //
  // Cadence map (uses DATE_ADD with advanceUntil:$today):
  //   monthly      → base:$today,  setDay:billDay,        unit:month, amount:1, advanceUntil:$today
  //   quarterly    → base:$today,  setDay:billDay,        unit:month, amount:3, advanceUntil:$today
  //   yearly       → base:$today,  setDay:billDay,        unit:year,  amount:1, advanceUntil:$today
  //   weekly       → base:$today,  setDay:billDay (1-7),  unit:week,  amount:1, advanceUntil:$today
  //   biweekly     → base:$today,  setDay:billDay (1-7),  unit:week,  amount:2, advanceUntil:$today
  //   every-n-days → base:billAnchor, amount:billCadenceN, unit:day,             advanceUntil:$today
  //
  // Gate: only recompute when billNextDue is empty OR already past, OR the
  // trigger names a bill-cadence field change. Keeps the op idle on most
  // re-renders. LOOPs over $allInstances scoped by HAS_ANCESTOR billsPageOccId
  // so only bill instances are visited.
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Compute Next Due",
    description: "Derive the next due date for each bill from its cadence shape and write it to the billNextDue field.",
    triggerTypes: ["onChange", "onAdd", "onLoad", "onFilterChange"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: billCadenceFieldId,  priority: 4 },
      { eventType: "onChange",       subjectType: "field",     targetId: billDayFieldId,      priority: 4 },
      { eventType: "onChange",       subjectType: "field",     targetId: billCadenceNFieldId, priority: 4 },
      { eventType: "onChange",       subjectType: "field",     targetId: billAnchorFieldId,   priority: 4 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",       targetId: "", priority: 4 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Bills", priority: 4 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        {
          id: uid(), type: "loop", overExpr: "$allInstances", as: "$bill",
          body: [
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$bill._ancestors", comparator: "HAS_ANCESTOR", right: billsPageOccId },
                { id: uid(), left: `$bill.fields.${billCadenceFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" },
              ] },
              then: [
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$cadence",    expr: `$bill.fields.${billCadenceFieldId}.value` } },
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$existingDue", expr: `$bill.fields.${billNextDueFieldId}.value` } },
                // Recompute gate: empty / past existing due OR trigger is a
                // cadence-shape MeasureOp / OccurrenceCreateOp. Skip on
                // unrelated onLoad fires when billNextDue is still future.
                {
                  id: uid(), type: "if",
                  condition: { operator: "OR", rules: [
                    { id: uid(), left: "$existingDue", comparator: "IS_EMPTY", right: "" },
                    { id: uid(), left: "$existingDue", comparator: "DATE_BEFORE_TODAY", right: "" },
                    { id: uid(), left: "$trigger.type", comparator: "IS", right: "MeasureOp" },
                    { id: uid(), left: "$trigger.type", comparator: "IS", right: "OccurrenceCreateOp" },
                  ] },
                  then: [
                    // monthly
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "monthly" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: "$today", setDay: `$bill.fields.${billDayFieldId}.value`,
                        unit: "month", amount: 1, advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                    // quarterly
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "quarterly" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: "$today", setDay: `$bill.fields.${billDayFieldId}.value`,
                        unit: "month", amount: 3, advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                    // yearly
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "yearly" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: "$today", setDay: `$bill.fields.${billDayFieldId}.value`,
                        unit: "year", amount: 1, advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                    // weekly
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "weekly" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: "$today", setDay: `$bill.fields.${billDayFieldId}.value`,
                        unit: "week", amount: 1, advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                    // biweekly
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "biweekly" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: "$today", setDay: `$bill.fields.${billDayFieldId}.value`,
                        unit: "week", amount: 2, advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                    // every-n-days
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$cadence", comparator: "IS", right: "every-n-days" }] },
                      then: [{ id: uid(), type: "action", config: {
                        type: "DATE_ADD",
                        base: `$bill.fields.${billAnchorFieldId}.value`,
                        amount: `$bill.fields.${billCadenceNFieldId}.value`,
                        unit: "day", advanceUntil: "$today",
                        targetFieldId: billNextDueFieldId, targetOccurrenceIdExpr: "$bill.id",
                      } }],
                      else: [],
                    },
                  ],
                  else: [],
                },
              ],
              else: [],
            },
          ],
        },
      ],
    },
    folderId: opCategoryIds.bills,
    enabled: true,
  }).save();

  // ── Schedule Due: Seed ─────────────────────────────────────────────────────
  // For every bill whose billNextDue lands on the active Schedule date,
  // COPY_LINK the canonical "Pay Bill" task into Schedule's Due container so
  // the user sees a "Pay Bill (Netflix)" / "Pay Bill (Rent)" row dated to the
  // bill. linkedGroupId from the source Pay Bill carries through, so completing
  // any copy bubbles to siblings via the server's update_occurrence fan-out.
  //
  // Idempotency: dedup-FIND existing copy with the same templateId AND billRef
  // value AND scheduled for the same day under Due — skip if present.
  await new Operation({
    id: uid(), userId, gridId, priority: 5,
    name: "Due: Seed",
    description: "Copy-link the Pay Bill task into Schedule's Due container for every bill whose billNextDue lands on the active Schedule date.",
    triggerTypes: ["onChange", "onAdd", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: billNextDueFieldId,  priority: 5 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",       targetId: "", priority: 5 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule", priority: 5 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 5 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule page (HAS_ANCESTOR scope + filter date source).
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        // 2. Resolve the active schedule date — trigger → page filter → today.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$trigger.date" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: `$schedPage._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedDate", expr: "$today" } }],
          else: [],
        },
        // 3. Find the canonical Pay Bill source (lives in Financial wellness).
        //    COPY_LINKs reuse this occurrence's moduleId / templateId.
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [{ id: uid(), left: "templateId", comparator: "IS", right: todoInstances.payBills.id }] },
          itemVar: "$payBillSrc", itemIdVar: "$payBillSrcId",
        } },
        // 4. Find the Due container for $schedDate under the Schedule page.
        //    Schedule: Build Day mints this per-day; if Build Day hasn't run
        //    yet for this date, bail (rebuilding it here would race with p1).
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "label", comparator: "IS", right: "Due" },
            { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
          ] },
          itemVar: "$due", itemIdVar: "$dueId",
        } },
        // 5. Proceed only when both Pay Bill source AND Due container exist.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$payBillSrcId", comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "$dueId",        comparator: "IS_NOT_EMPTY", right: "" },
          ] },
          then: [
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$payBillTpl", expr: "$payBillSrc.templateId" } },
            // 6. Loop bills under the Bills page; seed a Pay Bill copy for
            //    each whose billNextDue lands on $schedDate (no copy yet).
            {
              id: uid(), type: "loop", overExpr: "$allInstances", as: "$bill",
              body: [
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$bill._ancestors", comparator: "HAS_ANCESTOR", right: billsPageOccId },
                    { id: uid(), left: `$bill.fields.${billNextDueFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                    { id: uid(), left: "$bill.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                  ] },
                  then: [
                    // Dedup: existing copy with templateId IS $payBillTpl AND
                    // billRef IS $bill.id AND _ancestors HAS_ANCESTOR $dueId.
                    { id: uid(), type: "action", config: {
                      type: "FIND",
                      over: "$allInstances",
                      predicate: { operator: "AND", rules: [
                        { id: uid(), left: "templateId", comparator: "IS", right: "$payBillTpl" },
                        { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dueId" },
                        { id: uid(), left: `fields.${billRefFieldId}.value`, comparator: "IS", right: "$bill.id" },
                      ] },
                      itemIdVar: "$existingCopy",
                    } },
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [{ id: uid(), left: "$existingCopy", comparator: "IS_EMPTY", right: "" }] },
                      then: [
                        // COPY_LINK with stamped billRef + accountRef + amount + date.
                        // copyFields default true brings completed=false; the
                        // stamped values override.
                        { id: uid(), type: "action", config: {
                          type: "COPY_LINK",
                          sourceId: "$payBillSrcId",
                          parent: "$dueId",
                          fields: {
                            [billRefFieldId]:     "$bill.id",
                            [dateFieldId]:        "$schedDate",
                            [accountRefFieldId]:  `$bill.fields.${accountRefFieldId}.value`,
                            [fields.amount.id]:   `$bill.fields.${fields.amount.id}.value`,
                          },
                          fieldHidden: { [dateFieldId]: false },
                        } },
                      ],
                      else: [],
                    },
                  ],
                  else: [],
                },
              ],
            },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.bills,
    enabled: true,
  }).save();

  // ── Mark Passed Timeslots (time-based / scheduled) ─────────────────────────
  // Every 30 min, walks Schedule slot containers and stamps a red bg on
  // any whose timeslot is in the past. Writes to `occurrence.ownStyle.bg`
  // — the SAME field the occurrence settings menu writes to. The IF guard
  // inside the loop keeps each fire to ~1 write (only the slot that
  // crossed since last fire); ownStyle.bg is checked so already-stamped
  // slots are skipped. UI reads occurrence.ownStyle via the standard
  // resolveContainerStyle cascade — no CSS rule, no data-attribute hack.
  const PASSED_TIMESLOT_BG = "rgba(248, 113, 113, 0.12)";
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Mark Passed Timeslots",
    description: "Every 30 min: walk Schedule slot containers; for each whose timeslot has passed AND isn't already tinted, write a red bg onto occurrence.ownStyle.bg. Same path the occurrence settings menu writes to.",
    triggerTypes: [],
    triggerObjects: [],
    schedule: {
      kind: "interval",
      every: 30,
      unit: "minute",
      suppressNotifications: true,
      lastFiredAt: null,
    },
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule page (HAS_ANCESTOR scope).
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // 2. Loop slot containers under Schedule. Predicate guards:
            //    (a) is a slot (scheduleFormat field = "slot"),
            //    (b) timeslot < $now,
            //    (c) NOT already tinted — keeps each fire to only the
            //        slots that newly crossed.
            { id: uid(), type: "loop", overExpr: "$allContainers", as: "$slot",
              body: [
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    { id: uid(), left: "$slot._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                    { id: uid(), left: `$slot.fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" },
                    { id: uid(), left: `$slot.fields.${timeslotFieldId}.value`, comparator: "DATE_BEFORE_TODAY", right: "" },
                    { id: uid(), left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: PASSED_TIMESLOT_BG },
                  ] },
                  then: [
                    { id: uid(), type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: PASSED_TIMESLOT_BG } },
                  ],
                  else: [],
                },
              ],
            },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── Hourly chime (DISABLED — was firing every second) ──────────────────────
  // The lastFiredAt sync between scheduler and Redux isn't holding up under
  // a fresh seed; op fires on every 1s tick because op.schedule.lastFiredAt
  // stays null in local state until the server echo arrives, then the
  // inFlight 2s timeout clears and it re-fires. Disabling until the scheduler
  // sync race is investigated separately.
  await new Operation({
    id: uid(), userId, gridId, priority: 5,
    name: "Hourly chime",
    description: "DISABLED — was firing every second due to lastFiredAt sync race. Re-enable after scheduler debug.",
    triggerTypes: [],
    triggerObjects: [],
    schedule: {
      kind: "interval",
      every: 1,
      unit: "hour",
      suppressNotifications: false,
      lastFiredAt: null,
    },
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "NOTIFY", message: "🕒 It's the top of the hour." } },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: false,
  }).save();

  // ── Seeded alarms (Alarms tab) — op shape derived by makeAlarmOp, the server
  // twin of client helpers/alarmOps.js buildAlarmOperation (can't drift).
  // sched: each fired alarm also drops an instance onto today's Schedule (like
  // Pomodoro: Start) — resolves today's day-col + the matching slot by timeslot.
  const alarmSched = { dateFieldId, timeslotFieldId, scheduleFormatFieldId };
  await new Operation(makeAlarmOp({ userId, gridId, folderId: opCategoryIds.alarms, label: "5 PM", time: "17:00", sched: alarmSched })).save();
  await new Operation(makeAlarmOp({ userId, gridId, folderId: opCategoryIds.alarms, label: "6:30 AM", time: "06:30", sched: alarmSched })).save();

  // ── POMODORO: Start ─────────────────────────────────────────────────────────
  // Fired by PomodoroTimer.jsx on each new WORK phase. Trigger payload:
  //   { slotLabel: "9:00am", minutes: 25, pomoNumber: 1-4, phase: "work" }
  // Finds today's Schedule slot whose meta.slotLabel matches, then COPY_LINKs
  // the "Pomodoro" template instance into it, stamping date/timeslot/minutes/
  // number/phase. If no matching slot exists (Schedule not built, or user
  // starts outside the schedule's hours), the op no-ops — the timer still
  // runs locally; only the persisted session is skipped.
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Pomodoro: Start",
    description: "On each work phase start, COPY_LINK the Pomodoro template into the current Schedule slot (matched by $trigger.slotLabel) and stamp today's date + minutes + phase + pomo number.",
    triggerTypes: ["onPomoStart"],
    triggerObjects: [
      { eventType: "onPomoStart", subjectType: "grid", targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find Schedule page (scope).
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        // 2. The Pomodoro template instance (the COPY_LINK source) —
        //    picker-direct. FIND-by-label broke the SECOND start of a day:
        //    session copies inherit the module label "Pomodoro", so the FIND
        //    matched template + open sessions → array → broken create.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$pomoSrc",   expr: `$allItemsById.${pomodoroTemplateOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$pomoSrcId", expr: "$pomoSrc.id" } },
        // 3a. When the user has picked a specific destination in the
        //     PomodoroTimer dropdown, route there directly.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$slotId", expr: "$trigger.targetContainerId" } },
        // 3b. Otherwise fall back to the slot FIND — scoped to TODAY's day-col.
        //     A bare label match ("12:00am" under Schedule) has no day
        //     discrimination: started at 12:02am on 2026-07-14 it matched the
        //     PREVIOUS day's slot copy (day-col slots are per-day copies), so
        //     the session landed in a slot the new-day rebuild was about to
        //     sweep — created, invisible, then orphaned (prod repro 2026-07-14).
        //     Day-cols carry the date; resolve today's day-col first and only
        //     accept a slot inside it. No day-col for today → no-op (the
        //     documented contract), never a wrong-day write.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$slotId", comparator: "IS_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: {
              type: "FIND",
              over: "$allContainers",
              predicate: { operator: "AND", rules: [
                { id: uid(), left: "_ancestors",                                   comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: `fields.${scheduleFormatFieldId}.value`,        comparator: "IS",           right: "day-col" },
                { id: uid(), left: `fields.${dateFieldId}.value`,                  comparator: "SAME_DAY",     right: "$today" },
              ] },
              itemIdVar: "$dayColId",
            } },
            { id: uid(), type: "action", config: {
              type: "FIND",
              over: "$allContainers",
              predicate: { operator: "AND", rules: [
                { id: uid(), left: "_ancestors",                                   comparator: "HAS_ANCESTOR", right: "$dayColId" },
                { id: uid(), left: `fields.${scheduleFormatFieldId}.value`,        comparator: "IS",           right: "slot" },
                { id: uid(), left: `fields.${timeslotFieldId}.value`,              comparator: "IS",           right: "$trigger.slotLabel" },
              ] },
              itemIdVar: "$slotId",
            } },
          ],
          else: [],
        },
        // 4. Guard: only COPY_LINK if all three resolved.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$pomoSrcId", comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "$slotId",    comparator: "IS_NOT_EMPTY", right: "" },
          ] },
          then: [
            { id: uid(), type: "action", config: {
              type: "COPY_LINK",
              sourceId: "$pomoSrcId",
              parent: "$slotId",
              fields: {
                [dateFieldId]:             "$today",
                [timeslotFieldId]:         "$trigger.slotLabel",
                [fields.pomodoroMinutes.id]: "$trigger.minutes",
                [fields.pomodoroNumber.id]:  "$trigger.pomoNumber",
                [fields.pomodoroPhase.id]:   "$trigger.phase",
                [completedFieldId]:        false,
              },
              fieldHidden: { [dateFieldId]: false, [timeslotFieldId]: false },
            } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── POMODORO: Complete ──────────────────────────────────────────────────────
  // Fired by PomodoroTimer.jsx when a work phase reaches 00:00. Finds the
  // latest open Pomodoro copy under Schedule today (completed:false) and
  // marks it completed. The MeasureOp from completed→true fans out to the
  // Pomodoros Today / Pomodoro Time / Pomodoro History trackers.
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Pomodoro: Complete",
    description: "Find the latest open Pomodoro copy under Schedule for today and mark it completed. Fires the standard MeasureOp burst so trackers re-aggregate.",
    triggerTypes: ["onPomoComplete"],
    triggerObjects: [
      { eventType: "onPomoComplete", subjectType: "grid", targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [
            // Presence discriminator, NOT label (2026-07-10) — a COPY_LINK'd session
            // has no per-occurrence label, and a bare `label` rule doesn't resolve to
            // the module label here, so the open-session FIND never matched → the op
            // never stamped Completed → the trackers zeroed on reload. pomodoroNumber
            // is present on every session (same gate Pomodoros Today uses).
            { id: uid(), left: `fields.${fields.pomodoroNumber.id}.value`,       comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "_ancestors",                                     comparator: "HAS_ANCESTOR", right: "$schedPageId" },
            { id: uid(), left: `fields.${dateFieldId}.value`,                    comparator: "SAME_DAY",     right: "$today" },
            { id: uid(), left: `fields.${completedFieldId}.value`,               comparator: "IS_NOT",       right: true },
          ] },
          itemVar: "$openPomo", itemIdVar: "$openPomoId",
        } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$openPomoId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            // Time ran out → the session's minutes settle at the full phase
            // length ($trigger.minutes; the running ticks tracked partial
            // elapsed time until now).
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$openPomo.fields.${fields.pomodoroMinutes.id}.value`, value: "$trigger.minutes" } },
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$openPomo.fields.${completedFieldId}.value`, value: true } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── POMODORO: Update Time ───────────────────────────────────────────────────
  // Fired by PomodoroTimer.jsx each RUNNING minute of a work phase and on
  // pause, carrying the elapsed minutes. The session's time is its running
  // time (starts at 0, ticks up) — so completing it EARLY (its Completed
  // checkbox) counts a shorter pomodoro, while the natural timeout path
  // (Pomodoro: Complete above) settles at the full phase length.
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Pomodoro: Update Time",
    description: "Each running minute (and on pause) write the elapsed minutes onto the open Pomodoro session under Schedule for today.",
    triggerTypes: ["onPomoTick"],
    triggerObjects: [
      { eventType: "onPomoTick", subjectType: "grid", targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        // Same open-session FIND as Pomodoro: Complete (presence
        // discriminator + today + not completed).
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: `fields.${fields.pomodoroNumber.id}.value`,       comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "_ancestors",                                     comparator: "HAS_ANCESTOR", right: "$schedPageId" },
            { id: uid(), left: `fields.${dateFieldId}.value`,                    comparator: "SAME_DAY",     right: "$today" },
            { id: uid(), left: `fields.${completedFieldId}.value`,               comparator: "IS_NOT",       right: true },
          ] },
          itemVar: "$openPomo", itemIdVar: "$openPomoId",
        } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$openPomoId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "UPDATE", path: `$openPomo.fields.${fields.pomodoroMinutes.id}.value`, value: "$trigger.minutes" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── POMODORO: Stop ──────────────────────────────────────────────────────────
  // Fired by PomodoroTimer.jsx when the user resets/skips mid-work. Deletes
  // the open Pomodoro copy so it doesn't count toward today's totals.
  await new Operation({
    id: uid(), userId, gridId, priority: 4,
    name: "Pomodoro: Stop",
    description: "Find the latest open Pomodoro copy under Schedule for today and delete it (abandoned).",
    triggerTypes: ["onPomoStop"],
    triggerObjects: [
      { eventType: "onPomoStop", subjectType: "grid", targetId: "", priority: 4 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [
            // Presence discriminator, NOT label (2026-07-10) — a COPY_LINK'd session
            // has no per-occurrence label, and a bare `label` rule doesn't resolve to
            // the module label here, so the open-session FIND never matched → the op
            // never stamped Completed → the trackers zeroed on reload. pomodoroNumber
            // is present on every session (same gate Pomodoros Today uses).
            { id: uid(), left: `fields.${fields.pomodoroNumber.id}.value`,       comparator: "IS_NOT_EMPTY", right: "" },
            { id: uid(), left: "_ancestors",                                     comparator: "HAS_ANCESTOR", right: "$schedPageId" },
            { id: uid(), left: `fields.${dateFieldId}.value`,                    comparator: "SAME_DAY",     right: "$today" },
            { id: uid(), left: `fields.${completedFieldId}.value`,               comparator: "IS_NOT",       right: true },
          ] },
          itemIdVar: "$openPomoId",
        } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$openPomoId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: uid(), type: "action", config: { type: "DELETE", path: "$openPomoId" } },
          ],
          else: [],
        },
      ],
    },
    folderId: opCategoryIds.trackers,
    enabled: true,
  }).save();

  // ── POMODORO: History tracker ───────────────────────────────────────────────
  // Builds a [{when, minutes, label}] row list for every completed Pomodoro
  // under Schedule in the goal's selected period (D/W/M/Y) and writes it to
  // the Pomodoros per-metric occurrence's pomoHistory display. Custom because
  // makeTrackerOp is numeric — this is a row-builder (same shape as Today's
  // Moods).
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Pomodoro History",
    description: "Build a [{when, minutes, label}] row list for every completed Pomodoro under Schedule in the active period and write it to the Pomodoros per-metric occurrence's pomoHistory display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.pomodoroMinutes.id, priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId,         priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    folderId: opCategoryIds.trackers,
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$goalItem", expr: `$allItemsById.${goalOccIds.intellectualPomodoros}`,
        } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId", expr: "$goalItem.id" } },
        // Picker-direct binding (was FIND-by-label "Schedule" — replaced 2026-05-22).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$goalPeriod",
          expr: `$goalItem._effectiveFilter.${dateFieldId}`,
          fallback: "$trigger.date", fallback2: "$today",
        } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$rows", value: [] } },
        // task #29/#54 — paired single-value "last pomodoro" sink. Init
        // BEFORE the loop so the post-loop UPDATE doesn't fail when 0 matched.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$lastPomo", value: "" } },
        { id: uid(), type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                // Presence discriminator, NOT a bare `label` rule (2026-07-10) — in a
                // loop `as $inst`, bare `label` doesn't resolve to the item, and the
                // session has no per-occ label, so History never filled. Match the
                // pomodoroNumber field the session always carries (like Pomodoros Today).
                { id: uid(), left: `$inst.fields.${fields.pomodoroNumber.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: "$inst._ancestors",                         comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${completedFieldId}.value`,   comparator: "IS",           right: true },
                { id: uid(), left: `$inst.fields.${dateFieldId}.value`,        comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
              ] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "PUSH_TO_ARRAY",
                  name: "$rows",
                  value: {
                    when:    `$inst.fields.${timeslotFieldId}.value`,
                    minutes: `$inst.fields.${fields.pomodoroMinutes.id}.value`,
                    label:   `$inst.fields.${fields.pomodoroPhase.id}.value`,
                  },
                } },
                // Overwrite each iteration — last match wins, becomes the
                // single-value "last pomodoro" sink (timeslot label).
                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$lastPomo", expr: `$inst.fields.${timeslotFieldId}.value` } },
              ],
              else: [],
            },
          ],
        },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.pomoHistory.id}.value`, value: "$rows" } },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.lastPomodoro.id}.value`, value: "$lastPomo" } },
      ],
    },
  }).save();

  // ── Tracker: Current Streak (vision-vs-now persistent-streaks gap) ──────────
  // Walks back from $today counting consecutive days where at least one task
  // was completed under Schedule. Uses the new STREAK_VAR action (no while/
  // break primitive needed). Writes to the Streak per-metric occurrence's
  // currentStreak field.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Current Streak",
    description: "Count consecutive days backward from today where at least one task under Schedule was completed. Writes to the Streak per-metric occurrence's currentStreak display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    folderId: opCategoryIds.trackers,
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // Achievement-style display rules per milestone. Earlier rules in
        // an array win — so 30+ matches BEFORE 7+ BEFORE 1+. Each rule
        // changes the display color, prepends an icon, and appends a
        // celebratory suffix when the user crosses the threshold. Keyed
        // by the per-metric "Streak" occurrence label since both
        // currentStreak and longestStreak displays now live there.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$displayRules", expr: `json:${JSON.stringify({
          "Streak": [
            { when: { value: "zero" },                       color: "rgb(148,163,184)" },                                       // grey "0 day streak"
            { when: { value: { comp: "GTE", right: 100 } },  color: "rgb(255,215,0)",  icon: "Star",   suffix: " 🌟 LEGEND" },
            { when: { value: { comp: "GTE", right: 30 } },   color: "rgb(251,191,36)", icon: "Star",   suffix: " 🌟 30+ days!" },
            { when: { value: { comp: "GTE", right: 14 } },   color: "rgb(253,186,116)", icon: "Star",   suffix: " 🔥 2 weeks!" },
            { when: { value: { comp: "GTE", right: 7 } },    color: "rgb(252,165,165)", icon: "Star",  suffix: " 🔥 1 week!" },
            { when: { value: { comp: "GTE", right: 3 } },    color: "rgb(134,239,172)" },
            { when: { value: { comp: "GTE", right: 1 } },    color: "rgb(186,230,253)" },
          ],
        })}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",    expr: `$allItemsById.${goalOccIds.physicalStreak}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId",  expr: "$goalItem.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        // Build an array of {date} rows for every completed task under
        // Schedule (no period filter — streak walks ALL of history).
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$rows", value: [] } },
        { id: uid(), type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$inst._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${completedFieldId}.value`, comparator: "IS",            right: true },
                { id: uid(), left: `$inst.fields.${dateFieldId}.value`,      comparator: "IS_NOT_EMPTY",  right: "" },
              ] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "PUSH_TO_ARRAY", name: "$rows",
                  value: { date: `$inst.fields.${dateFieldId}.value` },
                } },
              ],
              else: [],
            },
          ],
        },
        // STREAK_VAR does the consecutive-days-backward walk and dedup.
        { id: uid(), type: "action", config: {
          type: "STREAK_VAR", name: "$rows", by: "date", to: "$streak",
        } },
        { id: uid(), type: "action", config: {
          type: "UPDATE", path: `$goalItem.fields.${fields.currentStreak.id}.value`, value: "$streak",
        } },
        // Personal best — MAX(stored, new) so it never decreases. Reads
        // the goal's existing longestStreak value; treats missing/null
        // as 0. MAX_VAR over a 2-element array is the simplest path
        // without a dedicated MAX primitive.
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$prevBest",
          expr: `$goalItem.fields.${fields.longestStreak.id}.value`,
          fallback: "literal:0",
        } },
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$candidates", arrayOf: ["$streak", "$prevBest"],
        } },
        { id: uid(), type: "action", config: {
          type: "MAX_VAR", name: "$candidates", to: "$newBest",
        } },
        { id: uid(), type: "action", config: {
          type: "UPDATE", path: `$goalItem.fields.${fields.longestStreak.id}.value`, value: "$newBest",
        } },
      ],
    },
  }).save();

  // ── Tracker: Workout History (task #29/#54) ─────────────────────────────────
  // Mirror of Today's Moods + Pomodoro History — builds {label, reps, weight,
  // timeslot, date} rows for every workout instance under Schedule in the
  // active goal period AND writes the timeslot-ordered last-workout label.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Workout History",
    description: "Build a [{label, s1, w1, s2, w2, s3, w3, timeslot, date}] row list for every workout instance under Schedule in the active period; write to Workout goal's workoutHistory + lastWorkout.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.set1Reps.id, priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: fields.set2Reps.id, priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: fields.set3Reps.id, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    folderId: opCategoryIds.trackers,
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",    expr: `$allItemsById.${goalOccIds.workoutLog}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId",  expr: "$goalItem.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod",
          expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$rows",     value: [] } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$lastW",    value: "" } },
        { id: uid(), type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$inst._ancestors",                         comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                // Presence discriminator = muscleGroup, the field the workout
                // EXERCISE instances (Bench Press, Squat, …) actually carry —
                // NOT workoutType, which only the generic "Morning Workout" task
                // binds. The old workoutType gate excluded every exercise, so the
                // Exercise/Reps/Wt history never filled (2026-07-14 repro).
                { id: uid(), left: `$inst.fields.${fields.muscleGroup.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${dateFieldId}.value`,        comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
              ] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "PUSH_TO_ARRAY", name: "$rows",
                  value: {
                    label:    "$inst.label",
                    // All three set counts + their per-set weights, one column
                    // each (2026-07-14: "only showing 1 of the rep counts" +
                    // "add 3 weights too").
                    s1:       `$inst.fields.${fields.set1Reps.id}.value`,
                    w1:       `$inst.fields.${fields.workoutWeight.id}.value`,
                    s2:       `$inst.fields.${fields.set2Reps.id}.value`,
                    w2:       `$inst.fields.${fields.workoutWeight2.id}.value`,
                    s3:       `$inst.fields.${fields.set3Reps.id}.value`,
                    w3:       `$inst.fields.${fields.workoutWeight3.id}.value`,
                    timeslot: `$inst.fields.${timeslotFieldId}.value`,
                    date:     `$inst.fields.${dateFieldId}.value`,
                  },
                } },
                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$lastW", expr: "$inst.label" } },
              ],
              else: [],
            },
          ],
        },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.workoutHistory.id}.value`, value: "$rows" } },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.lastWorkout.id}.value`, value: "$lastW" } },
      ],
    },
  }).save();

  // ── Tracker: Meal History (task #29/#54) ────────────────────────────────────
  // {label, kcal, protein, timeslot, date} rows for every nutrition instance.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Meal History",
    description: "Build a [{label, kcal, protein, timeslot, date}] row list for every nutrition instance under Schedule in the active period; write to Nutrition goal's mealHistory + lastMeal.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.protein.id,  priority: 3 },
      { eventType: "onChange",       subjectType: "field",     targetId: fields.calories.id, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    folderId: opCategoryIds.trackers,
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",    expr: `$allItemsById.${goalOccIds.nutritionLog}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId",  expr: "$goalItem.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod",
          expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$rows",     value: [] } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$lastM",    value: "" } },
        { id: uid(), type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$inst._ancestors",                                 comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${fields.mealCategory.id}.value`,     comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${dateFieldId}.value`,                comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
              ] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "PUSH_TO_ARRAY", name: "$rows",
                  value: {
                    label:    "$inst.label",
                    kcal:     `$inst.fields.${fields.calories.id}.value`,
                    protein:  `$inst.fields.${fields.protein.id}.value`,
                    timeslot: `$inst.fields.${timeslotFieldId}.value`,
                    date:     `$inst.fields.${dateFieldId}.value`,
                  },
                } },
                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$lastM", expr: "$inst.label" } },
              ],
              else: [],
            },
          ],
        },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.mealHistory.id}.value`, value: "$rows" } },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.lastMeal.id}.value`, value: "$lastM" } },
      ],
    },
  }).save();

  // ── Tracker: Purchase History (task #29/#54) ────────────────────────────────
  // {label, amount, timeslot, date} rows for every spending instance under
  // Schedule (any occurrence with an `amount` field value in the period).
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Purchase History",
    description: "Build a [{label, amount, timeslot, date}] row list for every spending instance under Schedule in the active period; write to the Spent per-metric occurrence's purchaseHistory + lastPurchase displays under Financial.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.amount.id, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Trackers", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    folderId: opCategoryIds.trackers,
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItem",    expr: `$allItemsById.${goalOccIds.financialSpent}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalItemId",  expr: "$goalItem.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage",   expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalPeriod",
          expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$rows",     value: [] } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$lastP",    value: "" } },
        { id: uid(), type: "loop", overExpr: "$allInstances", as: "$inst",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$inst._ancestors",                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: "$inst.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${fields.amount.id}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                { id: uid(), left: `$inst.fields.${dateFieldId}.value`,      comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
              ] },
              then: [
                { id: uid(), type: "action", config: {
                  type: "PUSH_TO_ARRAY", name: "$rows",
                  value: {
                    label:    "$inst.label",
                    amount:   `$inst.fields.${fields.amount.id}.value`,
                    timeslot: `$inst.fields.${timeslotFieldId}.value`,
                    date:     `$inst.fields.${dateFieldId}.value`,
                  },
                } },
                { id: uid(), type: "action", config: { type: "SET_VAR", name: "$lastP", expr: "$inst.label" } },
              ],
              else: [],
            },
          ],
        },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.purchaseHistory.id}.value`, value: "$rows" } },
        { id: uid(), type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${fields.lastPurchase.id}.value`, value: "$lastP" } },
      ],
    },
  }).save();

  // ── Shared schedule + day-page operations (delegated to liveSystemBuilders) ──
  // createLiveData seeds the trackers without a "Tracker:" prefix (just
  // "Completed" + "Water") — the Trackers folder gives them their category.
  // createTestGrid still uses the longer prefixed names. Pass the matching
  // names so Build Day's tail RUN_OPERATION resolves them.
  // dayContainerOccId is the Day container inside the Schedule Template
  // page (seeded above via buildScheduleTemplatePage). The op COPY_LINKs
  // it into the Schedule page per active day — picker-direct, no FIND.
  await new Operation(makeScheduleBuildScheduleOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId, scheduleFormatFieldId, completedTrackerName: "Completed", waterTrackerName: "Water", goalsPageOccId, schedulePageOccId: schedPageOccId, dayContainerOccId })).save();
  // Extend Stamp Date & Time Slot to also stamp lastSeen on every dropped occurrence.
  await new Operation(makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar: panelOccIds.notebook, goalsPageOccId, schedulePageOccId: schedPageOccId })).save();
  // Body-seeds the Tasks Completed container minted by buildDayPageTemplate.
  // Runs at priority 4 — after Build Day, Stamp, and trackers — so the
  // completion state and date stamps it reads are settled.
  await new Operation(makeDayPageBuildTasksCompletedOp({ userId, gridId, dateFieldId, completedFieldId, schedulePageOccId: schedPageOccId })).save();
  // Project: Create — APPLY_TEMPLATEs the Project Page template into
  // the Projects folder with {ProjectName} + {ProjectScope} replacements.
  // triggerType:"manual" so it only fires when the user explicitly runs
  // it (no spontaneous activity). Mirrors Day Page: Build's
  // idempotency-by-label pattern.
  await new Operation({ ...makeProjectCreateOp({ userId, gridId, projectsFolderId }), folderId: opCategoryIds.projects }).save();
  // Project: Status Router — onChange of statusFieldId moves the task between
  // kanban columns on the same project page. Idempotent + same-project-only
  // (anchored on the task's kanban board, not a global routing table).
  await new Operation({ ...makeProjectStatusRouterOp({ userId, gridId, statusFieldId }), folderId: opCategoryIds.projects }).save();
  // Project: Sync To Todo List — onChange of statusFieldId mirrors kanban
  // tasks into the Todo List page's Backburner / Docket containers via
  // COPY_LINK. Bidirectional field sync is automatic through the shared
  // linkedGroupId (server's update_occurrence fans out). When status
  // leaves Backburner/Docket, the Todo List copy is deleted so the view
  // stays focused on "what's not yet in motion". The kanban task itself
  // is untouched by this op (Status Router handles kanban moves).
  await new Operation({
    id: uid(), userId, gridId, priority: 5, folderId: opCategoryIds.projects,
    name: "Project: Sync To Todo List",
    description: "Mirror kanban tasks into Todo List Backburner/Docket containers via COPY_LINK when their status hits those values, and remove the mirror when status moves elsewhere. Field sync is automatic through linkedGroupId.",
    triggerTypes: ["onChange"],
    triggerObjects: [
      { eventType: "onChange", subjectType: "field", targetId: statusFieldId, priority: 5 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // Bind the task that changed.
        { id: uid(), type: "action", config: {
          type: "FIND",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" },
          ]},
          itemVar: "$task",
        }},
        // Read the task's linkedGroupId — if absent, the task isn't a
        // copylink yet; COPY_LINK below will mint one and stamp the
        // source. Treat undefined / null as "no group" so the find for
        // an existing mirror returns empty.
        { id: uid(), type: "action", config: {
          type: "INIT_VAR", name: "$lgId",
          expr: "$task.linkedGroupId",
        }},
        // Look for an existing Todo List mirror — any instance under
        // todoPage sharing the task's linkedGroupId. Skips itself
        // because the task lives on the kanban, not under todoPage.
        { id: uid(), type: "action", config: {
          type: "FIND",
          over: "$allInstances",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: "linkedGroupId", comparator: "IS", right: "$lgId" },
            { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: tasksPageOccId },
            { id: uid(), left: "$lgId", comparator: "IS_NOT_EMPTY", right: "" },
          ]},
          itemVar: "$mirror",
          itemIdVar: "$mirrorId",
        }},
        // Status went to Backburner → mirror in todoBackburner container.
        // MeasureOp carries `fields: { [fid]: { value, flow } }` (coalesced
        // shape), so the new status value lives at `$trigger.fields.<fid>.value`.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: `$trigger.fields.${statusFieldId}.value`, comparator: "IS", right: "Backburner" },
          ]},
          then: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$mirrorId", comparator: "IS_EMPTY", right: "" },
              ]},
              then: [
                // No mirror yet — mint a fresh COPY_LINK into Backburner.
                { id: uid(), type: "action", config: {
                  type: "COPY_LINK",
                  sourceId: "$task.id",
                  parent: taskContOccIds.taskOccupational,
                }},
              ],
              else: [
                // Mirror exists — make sure it's in Backburner. MOVE is a
                // no-op when it's already the right parent.
                { id: uid(), type: "action", config: {
                  type: "MOVE_OCCURRENCE",
                  occurrenceIdExpr: "$mirrorId",
                  toContainerId: taskContOccIds.taskOccupational,
                }},
              ],
            },
          ],
          else: [],
        },
        // Status went to Docket → mirror in todoDocket container.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: `$trigger.fields.${statusFieldId}.value`, comparator: "IS", right: "Docket" },
          ]},
          then: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$mirrorId", comparator: "IS_EMPTY", right: "" },
              ]},
              then: [
                { id: uid(), type: "action", config: {
                  type: "COPY_LINK",
                  sourceId: "$task.id",
                  parent: taskContOccIds.taskOccupational,
                }},
              ],
              else: [
                { id: uid(), type: "action", config: {
                  type: "MOVE_OCCURRENCE",
                  occurrenceIdExpr: "$mirrorId",
                  toContainerId: taskContOccIds.taskOccupational,
                }},
              ],
            },
          ],
          else: [],
        },
        // Status moved OUT of Backburner/Docket → drop the mirror. The
        // kanban task stays put (Status Router handles its column move);
        // we just clean up the Todo List view so it only shows pre-
        // active work.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: `$trigger.fields.${statusFieldId}.value`, comparator: "IS_NOT", right: "Backburner" },
            { id: uid(), left: `$trigger.fields.${statusFieldId}.value`, comparator: "IS_NOT", right: "Docket" },
            { id: uid(), left: "$mirrorId", comparator: "IS_NOT_EMPTY", right: "" },
          ]},
          then: [
            { id: uid(), type: "action", config: {
              type: "DELETE",
              itemIdExpr: "$mirrorId",
            }},
          ],
          else: [],
        },
      ],
    },
  }).save();
  await new Operation(makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, dateFieldId, lastSeenFieldId, hubPanelModuleId: panelModuleIds.notebook })).save();
  await new Operation(makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId, schedulePageOccId: schedPageOccId })).save();

  // ── Import from Wikipedia (manual; demonstrates GET_USER_INPUT chain) ─────
  // Pipeline:
  //   1. GET_USER_INPUT — Wikipedia article title or URL → $wikiQuery
  //   2. GET_USER_INPUT — select: create / append / replace → $importMode
  //   3. IF $importMode == "create":
  //      3a. GET_USER_INPUT — custom page name (blank = article title) → $customName
  //      3b. GET_USER_INPUT — select: parent folder → $targetFolderId
  //      3c. CALL_API   POST /api/research/wikipedia/import
  //      3d. SHOW_VALUE  the imported page's article title + root occurrence id
  //   ELSE (append / replace):
  //      pick a target occurrence → SHOW_VALUE a TODO note (full
  //      append/replace requires a markdown→textmap-merge server route
  //      that doesn't yet exist; the input flow is the deliverable).
  //
  // No API token needed — calls the new /api/research/wikipedia/import
  // route (same userId-in-body pattern as /api/artifacts/upload).
  await new Operation({
    id: uid(), userId, gridId,
    name: "Import from Wikipedia",
    description: "Manually-triggered. Asks for an article + destination, then imports it via the markdown importer.",
    enabled: true,
    priority: 5,
    triggerType: "manual",
    triggerTypes: ["manual"],
    triggerObjects: [],
    folderId: opCategoryIds.library,
    sortOrder: 9000,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: {
            type: "GET_USER_INPUT",
            title: "Import from Wikipedia",
            question: "Wikipedia article title or URL?",
            inputType: "text",
            defaultValue: "Pluto",
            resultVar: "$wikiQuery",
        }},
        { id: uid(), type: "action", config: {
            type: "GET_USER_INPUT",
            title: "Import from Wikipedia",
            question: "What should we do with the article?",
            inputType: "select",
            options: [
              { value: "create",  label: "Create new page" },
              { value: "append",  label: "Append to existing occurrence" },
              { value: "replace", label: "Replace content of existing occurrence" },
            ],
            defaultValue: "create",
            resultVar: "$importMode",
        }},
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$importMode", comparator: "IS", right: "create" },
          ]},
          then: [
            { id: uid(), type: "action", config: {
                type: "GET_USER_INPUT",
                title: "Create new page",
                question: "Custom page name? (Leave blank to use the article title)",
                inputType: "text",
                defaultValue: "",
                resultVar: "$customName",
            }},
            { id: uid(), type: "action", config: {
                type: "GET_USER_INPUT",
                title: "Create new page",
                question: "Where should the new page live?",
                inputType: "select",
                options: [
                  { value: notesFolderId,      label: "Notes" },
                  { value: examplesFolderId,   label: "Examples" },
                  { value: libraryFolderId,    label: "Library" },
                  { value: interfacesFolderId, label: "Interfaces" },
                  { value: projectsFolderId,   label: "Projects" },
                ],
                defaultValue: notesFolderId,
                resultVar: "$targetFolderId",
            }},
            { id: uid(), type: "action", config: {
                type: "CALL_API",
                url: "/api/research/wikipedia/import",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: {
                  userId, gridId,
                  parentId: "$targetFolderId",
                  query: "$wikiQuery",
                  title: "$customName",
                },
                responseVar: "$importResp",
                onError: "continue",
                errorVar: "$importErr",
            }},
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE",
                name: "$importedTitle",
                value: "$importResp.source.title",
            }},
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE",
                name: "$rootOccurrenceId",
                value: "$importResp.rootOccurrenceId",
            }},
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE",
                name: "$importError",
                value: "$importErr",
            }},
          ],
          else: [
            { id: uid(), type: "action", config: {
                type: "GET_USER_INPUT",
                title: "Pick target occurrence",
                question: "Paste the target occurrence id (TODO: drop-down picker once the executor supports occurrence selection)",
                inputType: "text",
                defaultValue: "",
                resultVar: "$targetOccId",
            }},
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE",
                name: "$mode",
                value: "$importMode",
            }},
            { id: uid(), type: "action", config: {
                type: "SHOW_VALUE",
                name: "$note",
                value: "literal:Append/Replace branch not yet wired — markdown fetch + textmap update TBD",
            }},
          ],
        },
      ],
    },
  }).save();

  // ── Schedule Table / Schedule Canvas mirrors (2026-07-07) ──────────────────
  // The `Table: Build` + `Canvas: Build` mirror OPS are gone — both pages now
  // carry an occurrence FEED (`occurrence.feed`, synced by the client's
  // generic helpers/feedSync.js engine): every instance under the Schedule
  // page passing the page's effective date filter is materialized as a
  // copy-linked child (meta.feedSourceId, drag-locked to copy). Same diff
  // semantics the ops had (mint missing / sweep stale / never touch
  // survivors), zero per-page pipeline code. See the page occ definitions
  // for the feed configs.

  // ── Schedule: Mark Passed Slots (time-based, 2026-06-03) ──────────────────
  // Tints schedule slots whose time is in the past. TIME-BASED op (uses the
  // `schedule` field + the useScheduler tick, NOT event triggers) so the tint
  // advances through the day on its own. Every 5 min (≥ the 60s persistent-
  // effect floor, since it writes occurrence style).
  //
  // Per-day-column correctness: day-col slot containers are PER-DAY COPY_LINK
  // copies parented under each day-col (Build Schedule clones them), so styling
  // one column's slot never touches another day. A slot counts as "passed"
  // when:
  //   • its day-col date is BEFORE today (whole past day → every slot), OR
  //   • its day-col date IS today AND its timeslot is TIME_BEFORE $currentTime.
  // Future day-cols are left untouched.
  //
  // The op holds ZERO schedule knowledge in any component — it writes the
  // generic `occurrence.ownStyle.bg` (which `resolveContainerStyle` already
  // overlays for any container), referencing the timeslot / scheduleFormat /
  // date fields BY ID. Dedup'd: a fire only writes a slot whose passed-state
  // actually flipped (compares the current ownStyle.bg before writing), so
  // steady-state fires emit ~zero socket writes.
  const passedSlotColor = "rgba(248,113,113,0.10)";   // dim red — a slot whose time has already passed
  const currentSlotColor = "rgba(74,222,128,0.16)";   // green — the one slot that is active right now
  await new Operation({
    id: uid(), userId, gridId, priority: 5,
    name: "Schedule: Mark Passed Slots",
    description: "Time-based (every 5 min). Colors today's schedule slots: GREEN on the current (active-now) slot, dim RED on slots whose time has already passed (and every slot in a past day-column); future days untouched. Writes the generic occurrence.ownStyle.bg the container already renders (no schedule knowledge in any component); references the timeslot/scheduleFormat/date fields by id; uses TIME_BEFORE/TIME_AFTER + DATE_BEFORE comparators. Two-pass: pass 1 finds the latest started slot (the current one), pass 2 paints. Dedup'd so a fire only writes slots whose color flipped.",
    triggerTypes: [],
    triggerObjects: [],
    enabled: true,
    schedule: { kind: "interval", every: 5, unit: "minute", lastFiredAt: null },
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${schedPageOccId}` } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
        {
          id: uid(), type: "loop", overExpr: "$allContainers", as: "$dayCol",
          body: [
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$dayCol._ancestors",                          comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                { id: uid(), left: `$dayCol.fields.${scheduleFormatFieldId}.value`, comparator: "IS",           right: "day-col" },
              ] },
              then: [
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$colDate", expr: `$dayCol.fields.${dateFieldId}.value` } },
                // Whole-day-passed (past day-col) + is-today flags.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayPast", expr: "literal:0" } },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$colDate", comparator: "DATE_BEFORE", right: "$today" }] },
                  then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$dayPast", expr: "literal:1" } }],
                  else: [],
                },
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dayIsToday", expr: "literal:0" } },
                { id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$colDate", comparator: "SAME_DAY", right: "$today" }] },
                  then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$dayIsToday", expr: "literal:1" } }],
                  else: [],
                },
                // PASS 1 (today only): find the CURRENT slot = the latest timeslot
                // that has already started. Recorded as $currentSlotTime so pass 2
                // can paint exactly that one slot green.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$currentSlotTime", expr: "literal:" } },
                {
                  id: uid(), type: "loop", overExpr: "$dayCol.occurrences", as: "$slotId",
                  body: [
                    { id: uid(), type: "action", config: { type: "SET_VAR", name: "$slot", expr: "$allItemsById.${$slotId}" } },
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$dayIsToday",                                 comparator: "IS",          right: 1 },
                        { id: uid(), left: `$slot.fields.${scheduleFormatFieldId}.value`, comparator: "IS",          right: "slot" },
                        { id: uid(), left: `$slot.fields.${timeslotFieldId}.value`,       comparator: "TIME_BEFORE", right: "$currentTime" },
                      ] },
                      then: [
                        { id: uid(), type: "if",
                          condition: { operator: "OR", rules: [
                            { id: uid(), left: "$currentSlotTime",                      comparator: "IS_EMPTY",   right: "" },
                            { id: uid(), left: `$slot.fields.${timeslotFieldId}.value`, comparator: "TIME_AFTER", right: "$currentSlotTime" },
                          ] },
                          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$currentSlotTime", expr: `$slot.fields.${timeslotFieldId}.value` } }],
                          else: [],
                        },
                      ],
                      else: [],
                    },
                  ],
                },
                // PASS 2: paint each slot — green for the current slot, red for
                // other passed slots, clear otherwise. Each write is dedup'd
                // against the slot's existing bg so steady-state fires no-op.
                {
                  id: uid(), type: "loop", overExpr: "$dayCol.occurrences", as: "$slotId",
                  body: [
                    { id: uid(), type: "action", config: { type: "SET_VAR", name: "$slot", expr: "$allItemsById.${$slotId}" } },
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: `$slot.fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" },
                      ] },
                      then: [
                        // passed? past day → yes; today → timeslot before now.
                        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$passed", expr: "literal:0" } },
                        { id: uid(), type: "if",
                          condition: { operator: "AND", rules: [{ id: uid(), left: "$dayPast", comparator: "IS", right: 1 }] },
                          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$passed", expr: "literal:1" } }],
                          else: [],
                        },
                        { id: uid(), type: "if",
                          condition: { operator: "AND", rules: [
                            { id: uid(), left: "$dayIsToday",                            comparator: "IS",          right: 1 },
                            { id: uid(), left: `$slot.fields.${timeslotFieldId}.value`,  comparator: "TIME_BEFORE", right: "$currentTime" },
                          ] },
                          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$passed", expr: "literal:1" } }],
                          else: [],
                        },
                        // current? today + this slot's timeslot equals the latest
                        // started slot found in pass 1.
                        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$isCurrent", expr: "literal:0" } },
                        { id: uid(), type: "if",
                          condition: { operator: "AND", rules: [
                            { id: uid(), left: "$dayIsToday",                            comparator: "IS",           right: 1 },
                            { id: uid(), left: "$currentSlotTime",                       comparator: "IS_NOT_EMPTY", right: "" },
                            { id: uid(), left: `$slot.fields.${timeslotFieldId}.value`,  comparator: "IS",           right: "$currentSlotTime" },
                          ] },
                          then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$isCurrent", expr: "literal:1" } }],
                          else: [],
                        },
                        // Paint with dedup. Priority: current (green) > passed (red) > clear.
                        { id: uid(), type: "if",
                          condition: { operator: "AND", rules: [{ id: uid(), left: "$isCurrent", comparator: "IS", right: 1 }] },
                          then: [
                            { id: uid(), type: "if",
                              condition: { operator: "AND", rules: [{ id: uid(), left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: currentSlotColor }] },
                              then: [{ id: uid(), type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: currentSlotColor } }],
                              else: [],
                            },
                          ],
                          else: [
                            { id: uid(), type: "if",
                              condition: { operator: "AND", rules: [{ id: uid(), left: "$passed", comparator: "IS", right: 1 }] },
                              then: [
                                { id: uid(), type: "if",
                                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: passedSlotColor }] },
                                  then: [{ id: uid(), type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: passedSlotColor } }],
                                  else: [],
                                },
                              ],
                              else: [
                                { id: uid(), type: "if",
                                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slot.ownStyle.bg", comparator: "IS_NOT_EMPTY", right: "" }] },
                                  then: [{ id: uid(), type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: "" } }],
                                  else: [],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                      else: [],
                    },
                  ],
                },
              ],
              else: [],
            },
          ],
        },
      ],
    },
  }).save();


  // ── Schedule: Route by Timeslot (task #5 follow-up, 2026-05-24) ───────────
  // Fires when a task's timeslot field changes. Routes the task into the
  // matching slot container of the Schedule page on the task's date. Lets
  // the user reassign a task by picking from the Time Slot dropdown — the
  // task moves into the matching 9:30am / 10:00am / etc. slot automatically.
  // Slot containers are identified data-driven: fields.scheduleFormat IS
  // "slot" AND fields.timeslot IS $trigger.value, scoped to the Schedule
  // page via _ancestors. Null timeslot ⇒ no routing (task stays where it
  // is; Schedule: Build Day handles parking it in Due on next fire).
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Schedule: Route by Timeslot",
    description: "When a task's Time Slot field changes, move the task into the matching slot container under the Schedule page for that task's date. Lets users pick a slot from the dropdown to assign a task without dragging.",
    triggerTypes: ["onChange"],
    triggerObjects: [
      { eventType: "onChange", subjectType: "field", targetId: timeslotFieldId, priority: 3 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // MeasureOp carries `fields: { [fid]: { value, flow } }` (coalesced
        // shape) — the new timeslot value lives at
        // `$trigger.fields.<timeslotFieldId>.value`.
        // Bail when the new value is empty/null — no slot to route to.
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: `$trigger.fields.${timeslotFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" },
          ]},
          then: [
            // FIND the slot container: live data identifies slots via
            // fields.scheduleFormat="slot" + fields.timeslot=<label>,
            // anchored under the Schedule page. Slot containers are
            // persistent (no per-day duplicates) — Schedule: Build
            // multi-parents them into per-day day-cols on the next fire.
            { id: uid(), type: "action", config: {
              type: "FIND",
              over: "$allContainers",
              predicate: { operator: "AND", rules: [
                { id: uid(), left: `fields.${scheduleFormatFieldId}.value`, comparator: "IS", right: "slot" },
                { id: uid(), left: `fields.${timeslotFieldId}.value`, comparator: "IS", right: `$trigger.fields.${timeslotFieldId}.value` },
                { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: schedPageOccId },
              ]},
              itemIdVar: "$targetSlotId",
            }},
            // Move the task into the matching slot. The default
            // occurrenceIdExpr ($trigger.occurrenceId) is the task that
            // just changed — exactly what we want to move.
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$targetSlotId", comparator: "IS_NOT_EMPTY", right: "" },
              ]},
              then: [
                { id: uid(), type: "action", config: {
                  type: "MOVE_OCCURRENCE",
                  toContainerIdExpr: "$targetSlotId",
                }},
              ],
              else: [],
            },
          ],
          else: [],
        },
      ],
    },
  }).save();

  // (People Table: Build + People: Show Profile ops removed 2026-07-25.)

  // ── Categorize operations (post-save bulk patch) ───────────────────────────
  // Same name-pattern routing as fields. Lets Operation records defined
  // inline above land in a sensible Command Center column without touching
  // every definition. Run AFTER every save above. Trackers route via
  // makeTrackerOp's folderId arg + inline folderId on the muscle/meal ops,
  // so they're not regex-routed here.
  await Operation.updateMany(
    { userId, gridId, name: /^Schedule(?: Table)?:/i, folderId: { $in: [null, undefined] } },
    { $set: { folderId: opCategoryIds.schedule } },
  );
  await Operation.updateMany(
    { userId, gridId, name: /^Day Page:/i, folderId: { $in: [null, undefined] } },
    { $set: { folderId: opCategoryIds.daypage } },
  );
  await Operation.updateMany(
    { userId, gridId, name: /^Bill:/i, folderId: { $in: [null, undefined] } },
    { $set: { folderId: opCategoryIds.bills } },
  );
  await Operation.updateMany(
    { userId, gridId, name: /Movie|Book|Podcast|Course/i, folderId: { $in: [null, undefined] } },
    { $set: { folderId: opCategoryIds.library } },
  );

  // Completion policy on the curated schedule row-builder / count trackers (Volume/
  // Reps/Nutrition carry the gate inline; this covers Moods, media, and the History
  // logs). Idempotent — skips ops already gated — so a reseed is self-contained (no
  // post-reseed patch script needed). See utils/completionGate.js.
  {
    const gatable = await Operation.find({ userId, gridId, name: { $in: [...GATE_TRACKER_NAMES] } }).lean();
    const changed = gateScheduleTrackers(gatable, { completedFieldId, scheduleOccId: schedPageOccId });
    for (const op of changed) await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
    if (changed.length) console.log(`   Completion gates: ${changed.length} schedule trackers`);
  }

  // Period-all policy: every tracker filters by the active period when the
  // goals/trackers page has a day selected, and aggregates ALL when it doesn't
  // (drops the $trigger.date/$today fallbacks, ORs each DATE_IN_PERIOD with
  // $goalPeriod IS_EMPTY). Idempotent. See utils/periodAllPolicy.js.
  {
    const trackers = await Operation.find({ userId, gridId }).lean();
    const changed = applyPeriodAllPolicy(trackers);
    for (const op of changed) await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
    if (changed.length) console.log(`   Period-all policy: ${changed.length} trackers`);
  }

  // Trackers-page scoping (2026-07-25): the Goals + Accounts pages are folded
  // into ONE "Trackers" page, but makeTrackerOp's on-page nav trigger scopes
  // by ancestor LABEL "Goals". Data-side rewrite (builders untouched per the
  // data-only rule): every trigger scoped to "Goals"/"Accounts" now scopes to
  // "Trackers". Idempotent.
  {
    const allOps = await Operation.find({ userId, gridId }).lean();
    let relabeled = 0;
    for (const op of allOps) {
      let dirty = false;
      for (const t of op.triggerObjects || []) {
        if (t.ancestorLabel === "Goals" || t.ancestorLabel === "Accounts") {
          t.ancestorLabel = "Trackers";
          dirty = true;
        }
      }
      if (dirty) {
        await Operation.updateOne({ _id: op._id }, { $set: { triggerObjects: op.triggerObjects } });
        relabeled++;
      }
    }
    if (relabeled) console.log(`   Trackers-page scoping: ${relabeled} ops re-labeled Goals/Accounts → Trackers`);
  }

  // Global-filter policy: every filter-driven op (Schedule builders + all
  // goal/account/tracker aggregations) must ALSO fire on the GLOBAL (toolbar)
  // filter change, not just its on-page nav — so changing the grid date updates
  // the Schedule, Goals AND Accounts. Idempotent. See utils/gridFilterTrigger.js.
  {
    const allOps = await Operation.find({ userId, gridId }).lean();
    const changed = ensureGridFilterTrigger(allOps);
    for (const op of changed) await Operation.updateOne({ _id: op._id }, { $set: { triggerObjects: op.triggerObjects, triggerTypes: op.triggerTypes } });
    if (changed.length) console.log(`   Global-filter triggers: ${changed.length} ops now respond to the grid filter`);
  }

  return {
    gridId,
    gridName,
    fields,
    instanceMods,
    containerMods,
    // Occurrence id maps — consumed by Tasks 10–13
    toolkitContOccIds,   // contModKey → containerOccId for toolkit containers
    taskContOccIds,      // dimension key → containerOccId for Tasks page containers
    goalContOccIds,      // contModKey → containerOccId for goal containers
    accountContOccIds,   // contModKey → containerOccId for account containers
    billContOccIds,      // contModKey → containerOccId for bill containers (B3)
    billsPageOccId,      // Bills page occurrence id (B3)
    // Folder ids — consumed by Tasks 11–13
    rootFolderId,
    tasksFolderId,
    trackersFolderId,
    interfacesFolderId,
    notesFolderId,
    dayPagesFolderId,
    // Templates manifest root folder — consumed by Tasks 12–13
    tplManifestRootFolderId,
    // Notebook doc occurrence ids — label → occurrenceId, all in notesFolderId
    notebookDocOccIds,
    // ── Pages + panels (Task 12) ────────────────────────────────────────────
    // Panel occurrence ids keyed toolkit/todo/notebook/goals/accounts. Task 13's
    // makeDayPageBuildOp needs panelOccIds.notebook (hub panel OCCURRENCE id for
    // its ADD_CHILD); makeStampDateTimeSlotOp needs panelModuleIds.notebook
    // (hub panel MODULE id).
    panelOccIds,
    panelModuleIds,
    // Page occurrence ids — consumed by Task 13 ops
    schedPageOccId,
    toolkitPageOccId,
    tasksPageOccId,
    goalsPageOccId,
    accountsPageOccId,
    // Folder-page default tabs (card-grid landing for each hub panel)
    toolkitFolderPageOccId,
    notebookFolderPageOccId,
    // Notebook hub View id (activeOccurrenceId = notebookFolderPageOccId)
    notebookHubViewId,
  };
}

async function main() {
  // Args (order-independent except --clear is a switch, not a value):
  //   node createLiveData.js [email] [--clear]
  const positionals = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter(a => a.startsWith("--")));
  const targetEmail = positionals[0] || DEFAULT_USER_EMAIL;
  const clearAll = flags.has("--clear");

  console.log(`🔄 Creating live data grid for ${targetEmail}${clearAll ? " (--clear: WIPING ALL USER GRIDS first)" : ""}...\n`);
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    // Ensure every schema-declared index exists on Atlas. Mongoose creates
    // missing indexes lazily on first model use, but doesn't backfill an
    // existing collection when a new index is added to a schema later.
    // `syncIndexes()` is idempotent + cheap when the indexes already exist
    // — Atlas just verifies and returns ms-fast. Slow path only runs when
    // a NEW index needs building (one-time cost per deploy).
    {
      const t0 = Date.now();
      const models = [
        ["Module", Module], ["Occurrence", Occurrence], ["View", View],
        ["Field", Field], ["Folder", Folder], ["Operation", Operation],
        ["Manifest", Manifest], ["Grid", Grid],
      ];
      for (const [name, model] of models) {
        try {
          await model.syncIndexes();
        } catch (err) {
          console.warn(`  ⚠️  ${name}.syncIndexes failed: ${err.message}`);
        }
      }
      console.log(`✅ Indexes synced (${Date.now() - t0}ms)\n`);
    }

    const user = await User.findOne({ email: targetEmail });
    if (!user) throw new Error(`User not found: ${targetEmail}`);
    const userId = user._id.toString();
    console.log(`✅ Found user: ${userId}\n`);

    if (clearAll) {
      const stats = await clearAllUserGrids(userId);
      console.log(`🔥 --clear wiped:`);
      console.log(`   Grids:        ${stats.grids}${stats.gridNames.length ? ` (${stats.gridNames.join(", ")})` : ""}`);
      console.log(`   Occurrences:  ${stats.occurrences}`);
      console.log(`   Modules:      ${stats.modules}`);
      console.log(`   Fields:       ${stats.fields}`);
      console.log(`   Operations:   ${stats.operations}`);
      console.log(`   Views:        ${stats.views}`);
      console.log(`   Folders:      ${stats.folders}`);
      console.log(`   Manifests:    ${stats.manifests}`);
      console.log(`   Transactions: ${stats.transactions}`);
      console.log(`   (User doc preserved)\n`);
    } else {
      const dropped = await dropExistingLiveGrid(userId);
      console.log(dropped
        ? `🗑️  Dropped existing "${DEFAULT_GRID_NAME}" + scoped data\n`
        : `🆕 No existing "${DEFAULT_GRID_NAME}" to drop\n`);
      const swept = await sweepStaleGrids(userId);
      if (swept.length) {
        console.log(`🧹 Swept ${swept.length} stale skeleton grid(s): ${swept.map(s => `${s.name} ${s.rows}×${s.cols} (${s.id})`).join(", ")}\n`);
      }
    }

    const result = await createLiveData(userId);

    const fieldCount     = Object.keys(result.fields || {}).length;
    const instanceCount  = Object.keys(result.instanceMods || {}).length;
    const containerCount = Object.keys(result.containerMods || {}).length;
    const tkContOccs     = Object.keys(result.toolkitContOccIds || {}).length;
    const tdContOccs     = Object.keys(result.taskContOccIds || {}).length;
    const glContOccs     = Object.keys(result.goalContOccIds || {}).length;
    const acContOccs     = Object.keys(result.accountContOccIds || {}).length;
    const blContOccs     = Object.keys(result.billContOccIds || {}).length;
    const totalContOccs  = tkContOccs + tdContOccs + glContOccs + acContOccs + blContOccs;
    const notebookCount  = Object.keys(result.notebookDocOccIds || {}).length;
    console.log("=".repeat(50));
    console.log("Poms grid created!");
    console.log(`   Grid ID:        ${result.gridId}`);
    console.log(`   Grid Name:      ${result.gridName}`);
    console.log(`   Fields:         ${fieldCount}`);
    console.log(`   Inst modules:   ${instanceCount}`);
    console.log(`   Cont modules:   ${containerCount} (no slot containers)`);
    console.log(`   Container occs: ${totalContOccs} (${tkContOccs} toolkit, ${tdContOccs} todo, ${glContOccs} goal, ${acContOccs} account, ${blContOccs} bills)`);
    console.log(`   Notebook docs:  ${notebookCount} (${Object.keys(result.notebookDocOccIds || {}).join(", ")})`);
    console.log(`   Folders:        Root + 5 children (Tasks/Trackers/Interfaces/Notes/Day Pages)`);
    console.log(`   Templates:      Daily Routine (6-pick) + Day Page under Templates manifest`);
    console.log(`   Operations:     26 (19 trackers + 1 daily question rotator + 4 schedule/day-page + Schedule Table: Build + Schedule Canvas: Build)`);
    console.log(`   Panels:         ${Object.keys(result.panelOccIds || {}).join(", ")}`);
    console.log(`   Pages:          Daily Toolkit folder (11 wellness pages: Physical, Phys-Fitness, Phys-Nutrition, Intellectual, Emotional, Social, Spiritual, Occupational, Financial, Environmental, Creative) + Todo List + Goals + Accounts + Schedule + Canvas + Schedule Table + Library + Daily Journal Questions + Bills`);
    console.log(`   Notebook hub:   View ${result.notebookHubViewId} active=Schedule (${result.schedPageOccId}); tabs=[Schedule, Interfaces, Canvas, Schedule Canvas]; logo board pinned above in the middle column`);
    console.log(`   Toolkit hub:    active=Daily Toolkit folder-page (${result.toolkitFolderPageOccId}); tabs=[Daily Toolkit, ...11 wellness pages]`);
    console.log("=".repeat(50));

    // Stable assistant (Jonah) API token — survives reseeds so the user pastes
    // it into the drawer once. Reseed deletes grid-scoped data, not ApiToken;
    // this keeps the *value* deterministic via server/.env (see utils/assistantToken).
    try {
      const { ensureAssistantApiToken } = await import("../utils/assistantToken.js");
      const { rawToken, source } = await ensureAssistantApiToken(userId);
      console.log(`\n🔑 Jonah assistant API token (${source === "env" ? "stable — from server/.env" : "NEW — appended to server/.env"}):`);
      console.log(`   ${rawToken}`);
      console.log("   Paste once into the assistant drawer (⚙ Settings). It persists across reseeds — no re-entry.\n");
    } catch (e) {
      console.warn("⚠️  Could not ensure a stable assistant API token:", e.message);
    }

    // ── Snapshot to server/seed/*.json (skipped with --no-export) ──
    // The on-disk seed acts as the canonical fixture for fast restores
    // via `reloadLiveData.js`. Default = always export so the JSON
    // stays in sync with the last successful create. Skip with
    // `--no-export` when iterating on the create script itself and
    // you don't want to overwrite the saved seed.
    if (!flags.has("--no-export")) {
      const seedDir = resolve(__dirname, "../seed");
      console.log(`\n📦 Exporting seed → ${seedDir}/`);
      const t0 = Date.now();
      const stats = await exportLiveSeedData(userId, seedDir, result.gridId);
      for (const [name, count] of Object.entries(stats)) {
        console.log(`   ${name.padEnd(12)} ${count} docs`);
      }
      console.log(`✅ Exported in ${Date.now() - t0}ms\n`);
    }
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected");
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isDirectRun) main();
