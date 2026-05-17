// scripts/createLiveData.js
// ============================================================
// Creates (or recreates) the "Live Grid" for a user. Intended as the
// production-quality grid that replaces createTestGrid's fixture data.
//
// Runnable standalone via:
//
//   node --env-file=.env scripts/createLiveData.js                 # default user (josh)
//   node --env-file=.env scripts/createLiveData.js test@moduli.test
//
// Standalone runs drop the existing "Live Grid" + its scoped data first so
// re-running is idempotent. Other grids on the user are left UNTOUCHED.
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
import User from "../models/User.js";
import { generateTimeSlots } from "../utils/operationBuilders.js";
import {
  buildGridDoc,
  buildScheduleFilters,
  buildTemplatesManifest,
  buildDailyRoutineTemplate,
  buildDayPageTemplate,
  makeScheduleBuildDayOp,
  makeDayPageBuildOp,
  makeStampDateTimeSlotOp,
  makeClearDateOnMoveOutOp,
  makeTrackerOp,
} from "../utils/liveSystemBuilders.js";
import fs from "fs";
import { parseSectionsWithInstances } from "../utils/mdParsers.js";
import { makeDocContent, buildMergedDocTextmap } from "../utils/docBuilders.js";

// Markdown source files live at moduli/docs/ (same resolution as createDefaultUserData)
const __liveDataDirname = dirname(__filename);
const ROOT_DIR_MD = join(__liveDataDirname, "../../docs/");

const DEFAULT_USER_EMAIL = "josh@jpoms.com";
const DEFAULT_GRID_NAME = "Live Grid";
const uid = () => nanoid(12);

// Drop the existing "Live Grid" for this userId and all its gridId-scoped child docs.
// Scoping is DUAL — both userId AND the literal grid name "Live Grid" — so this
// can NEVER delete a different user's data or a grid with a different name
// (e.g. "Test Grid" is completely safe).
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
  ]);
  await Grid.deleteOne({ _id: existing._id });
  return true;
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
  const manifestId       = uid();
  const schedFilterId    = uid();
  const timeslotFilterId = uid();

  // Library / Movies Watched fields (matches createTestGrid naming exactly)
  const libraryFieldId              = uid();
  const moviesWatchedFieldId        = uid();
  const moviesWatchedDisplayFieldId = uid();

  // Books Read fields
  const booksReadFieldId           = uid();
  const booksReadDisplayFieldId    = uid();
  const pagesFieldId               = uid(); // pages per book (used by Books Read tracker)

  // Podcasts Listened fields
  const podcastsListenedFieldId           = uid();
  const podcastsListenedDisplayFieldId    = uid();

  // Courses Taken fields
  const coursesTakenFieldId           = uid();
  const coursesTakenDisplayFieldId    = uid();

  // Library page + container IDs (need before occurrences are created)
  const libraryPageModId  = uid();
  const libraryContModId  = uid();
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

  // Library folder ID
  const libraryFolderId = uid();

  // Journal Q&A field IDs — pre-generated so siblingLinks can reference them at definition time
  const journalQuestionFieldId = uid();
  const journalAnswerFieldId   = uid();

  // 7 reflection question module IDs (library "question" type)
  const qWentWellModId          = uid();
  const qLearnedModId           = uid();
  const qChallengingModId       = uid();
  const qGratefulModId          = uid();
  const qDifferentlyModId       = uid();
  const qImproveTomorrowModId   = uid();
  const qSurprisedModId         = uid();

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
  //   journalQuestionPool   — WIRED (Feature C): 7 reflection question instances seeded
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
  //   journalQuestion       — also bound to toolkitInstances.journaling (kept)
  //   journalAnswer         — also bound to toolkitInstances.journaling (kept)
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

  const fields = {
    // ── SCHEDULE CONTROL (4 canonical fields; ids from scaffold pre-gen) ─────
    // These shapes mirror createTestGrid STEP 2 exactly.
    completed: {
      id: completedFieldId,
      name: "Completed",
      type: "boolean",
      inputEnabled: true,
      displayEnabled: false,
      meta: { variant: "switch", defaultValue: false },
    },
    date: {
      id: dateFieldId,
      name: "Date",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
    },
    timeslot: {
      id: timeslotFieldId,
      name: "Time Slot",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
    },
    due: {
      id: dueFieldId,
      name: "Due",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
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
      meta: { prefix: "$", postfix: "", increment: 5, flow: "out" },
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
      meta: { options: ["movie", "book", "tv show", "podcast", "course", "question"], multiSelect: false },
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
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "movie", flow: "in" } },
          },
        },
      },
    },
    moviesWatchedDisplay: {
      id: moviesWatchedDisplayFieldId,
      name: "Movies Watched Today",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
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
          addNew: {
            parentOccurrenceId: null, // patched to libraryContOccId after occurrences are created
            stampFields: { [libraryFieldId]: { value: "book", flow: "in" } },
          },
        },
      },
    },
    booksReadDisplay: {
      id: booksReadDisplayFieldId,
      name: "Books Read Today",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Book" },
          { path: "pages", header: "Pages", width: 70 },
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
      name: "Podcasts Listened Today",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
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
      name: "Courses Taken Today",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
    },
    accountSelect: {
      id: uid(),
      name: "Account",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        options: [
          { value: "checking", label: "Checking" },
          { value: "savings",  label: "Savings" },
          { value: "moms",     label: "Mom's Account" },
        ],
      },
    },

    // ── TEXT INPUT FIELDS ─────────────────────────────────────────────────────
    workoutType: {
      id: uid(),
      name: "Workout",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Workout type..." },
    },
    mealDescription: {
      id: uid(),
      name: "Meal",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "What did you eat..." },
    },
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
      meta: {},
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
      meta: { prefix: "", postfix: " done" },
      displayConfig: {},
    },
    totalDuration: {
      id: uid(),
      name: "Time Spent Today",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " min" },
      displayConfig: {},
    },
    totalSpent: {
      id: uid(),
      name: "Spent Today",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    totalIncome: {
      id: uid(),
      name: "Earned Today",
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
      name: "Latest Mood",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {},
    },
    totalPages: {
      id: uid(),
      name: "Pages Read Today",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " pages" },
      displayConfig: {},
    },
    taskCount: {
      id: uid(),
      name: "Task Count Today",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "", postfix: " tasks" },
      displayConfig: {},
    },

    // ── ACCOUNT DISPLAY FIELDS (all-time aggregations) ────────────────────────
    netBalance: {
      id: uid(),
      name: "Net Balance",
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
    totalWorkouts: {
      id: uid(),
      name: "Workouts",
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
    workoutWeight: {
      id: uid(), name: "Weight", type: "number", inputEnabled: true, displayEnabled: false,
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
      id: uid(), name: "Total Reps Today", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: " reps" },
      displayConfig: { showArrows: true, targetValue: 150, targetPeriod: "daily" },
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
      id: uid(), name: "Protein Today", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalCarbs: {
      id: uid(), name: "Carbs Today", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalFats: {
      id: uid(), name: "Fats Today", type: "number", inputEnabled: false, displayEnabled: true,
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

  await Field.insertMany(
    Object.values(fields).map(f => ({ ...f, userId, gridId }))
  );

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
  // KEPT sets: toolkitInstances, workoutInstances, nutritionInstances,
  //            todoInstances, planningInstances, goalInstances, accountInstances.
  //
  // FIELD MAP NOTE: createDefaultUserData uses `fields.dueDate`; createLiveData uses
  //   `fields.due` (same field, different map key). All `dueDate` refs → `fields.due.id`.
  //
  // DAILY-ROUTINE CONVENTION: The 6 Daily Routine source instances must have a
  //   hidden `dateFieldId` binding (createTestGrid convention, Task 13 op-wiring).
  //   Labels match EXACTLY: "Drink Water", "Take Vitamins", "Morning Run",
  //   "Scrambled Eggs + Veg", "Greek Salad + Chicken", "Read a chapter".
  //   NOTE: "Morning Run" is its own module (not the same as "Morning Workout").
  //   "Read a chapter" is added here as a minimal todo-style schedulable instance.
  //
  // CATEGORY FIELD: createDefaultUserData injects a hidden category binding on every
  //   instance (line ~1991). Replicated here via the post-loop category injection.

  // Helper — add hidden dateFieldId binding if not already present.
  function ensureDateBinding(bindings) {
    if (bindings.some(b => b.fieldId === dateFieldId)) return bindings;
    const maxOrder = bindings.reduce((m, b) => Math.max(m, b.order ?? 0), 0);
    return [...bindings, { fieldId: dateFieldId, role: "input", order: maxOrder + 1, hidden: true }];
  }

  // ── Toolkit instances (keep all from createDefaultUserData.toolkitInstances) ──
  const toolkitInstances = {
    // === PHYSICAL ===
    morningWorkout: {
      id: uid(), label: "Morning Workout", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own",
      ownStyle: { bg: "rgba(180,74,26,0.15)", textColor: "#e06a3a" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.workoutType.id, role: "input", order: 1 },
        { fieldId: fields.duration.id, role: "input", order: 2 },
        { fieldId: fields.calories.id, role: "input", order: 3 },
      ],
    },
    eveningRun: {
      id: uid(), label: "Evening Run", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.steps.id, role: "input", order: 2 },
      ],
    },
    stretching: {
      id: uid(), label: "Stretching", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    drinkWater: {
      id: uid(), label: "Drink Water", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.water.id, role: "input", order: 1 },
        { fieldId: dateFieldId, role: "input", order: 2, hidden: true }, // Daily Routine source
      ],
    },
    takeMeds: {
      id: uid(), label: "Take Vitamins", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true }, // Daily Routine source
      ],
    },
    sleepLog: {
      id: uid(), label: "Sleep Log", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.energy.id, role: "input", order: 2 },
      ],
    },

    // === INTELLECTUAL ===
    reading: {
      id: uid(), label: "Reading", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(21,98,176,0.15)", textColor: "#4a9fe0" },
      fieldBindings: [
        { fieldId: booksReadFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,      role: "input", order: 1, hidden: true },
      ],
    },
    podcast: {
      id: uid(), label: "Listen to Podcast", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: podcastsListenedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,             role: "input", order: 1, hidden: true },
      ],
    },
    watchMovie: {
      id: uid(), label: "Watch Movie", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: moviesWatchedFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,          role: "input", order: 1, hidden: true },
      ],
    },
    onlineCourse: {
      id: uid(), label: "Online Course", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: coursesTakenFieldId, role: "input", order: 0 },
        { fieldId: dateFieldId,         role: "input", order: 1, hidden: true },
      ],
    },
    brainGames: {
      id: uid(), label: "Brain Games", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    journaling: {
      id: uid(), label: "Daily Journal", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.journalQuestion.id, role: "display", order: 1 },
        { fieldId: fields.journalAnswer.id, role: "input", order: 2 },
        { fieldId: fields.duration.id, role: "input", order: 3 },
      ],
    },

    // === EMOTIONAL ===
    gratitude: {
      id: uid(), label: "Gratitude Practice", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.mood.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    meditation: {
      id: uid(), label: "Meditation", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own",
      ownStyle: { bg: "rgba(160,33,88,0.15)", textColor: "#d94080" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.mood.id, role: "input", order: 2 },
      ],
    },
    breathing: {
      id: uid(), label: "Breathing Exercise", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    moodCheck: {
      id: uid(), label: "Mood Check-in", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.mood.id, role: "input", order: 0 },
        { fieldId: fields.energy.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    selfCare: {
      id: uid(), label: "Self-Care Activity", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },

    // === SOCIAL ===
    callFriend: {
      id: uid(), label: "Call a Friend", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(196,144,0,0.15)", textColor: "#e8c030" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    familyTime: {
      id: uid(), label: "Family Time", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    socialEvent: {
      id: uid(), label: "Social Event", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    helpSomeone: {
      id: uid(), label: "Help Someone", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },

    // === SPIRITUAL ===
    prayer: {
      id: uid(), label: "Prayer/Reflection", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(100,39,197,0.15)", textColor: "#9b6eee" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    natureWalk: {
      id: uid(), label: "Nature Walk", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.steps.id, role: "input", order: 2 },
      ],
    },
    spiritualReading: {
      id: uid(), label: "Spiritual Reading", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.pages.id, role: "input", order: 2 },
      ],
    },
    mindfulness: {
      id: uid(), label: "Mindfulness", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },

    // === OCCUPATIONAL ===
    deepWork: {
      id: uid(), label: "Deep Work Session", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(13,122,82,0.15)", textColor: "#29b87e" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.priority.id, role: "input", order: 2 },
        { fieldId: fields.notes.id, role: "input", order: 3 },
      ],
    },
    meeting: {
      id: uid(), label: "Meeting", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    emailBlock: {
      id: uid(), label: "Email Block", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    skillDev: {
      id: uid(), label: "Skill Development", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    networking: {
      id: uid(), label: "Networking", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },

    // === FINANCIAL ===
    budgetReview: {
      id: uid(), label: "Budget Review", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    trackExpense: {
      id: uid(), label: "Track Expense", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(29,138,48,0.15)", textColor: "#4cba64" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.accountSelect.id, role: "input", order: 1 },
        { fieldId: fields.amount.id, role: "input", order: 2 },
        { fieldId: fields.category.id, role: "input", order: 3 },
        { fieldId: fields.notes.id, role: "input", order: 4 },
      ],
    },
    purchase: {
      id: uid(), label: "Purchase", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.accountSelect.id, role: "input", order: 1 },
        { fieldId: fields.amount.id, role: "input", order: 2 },
      ],
    },
    logIncome: {
      id: uid(), label: "Log Income", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.income.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    investmentCheck: {
      id: uid(), label: "Check Investments", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.income.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    savingsGoal: {
      id: uid(), label: "Savings Goal", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },

    // === ENVIRONMENTAL ===
    cleanDesk: {
      id: uid(), label: "Clean Desk", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(7,121,160,0.15)", textColor: "#32b4e0" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    declutter: {
      id: uid(), label: "Declutter Space", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    plantCare: {
      id: uid(), label: "Plant Care", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
      ],
    },
    recycling: {
      id: uid(), label: "Recycling", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
      ],
    },
    ecoAction: {
      id: uid(), label: "Eco-Friendly Action", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },

    // === DAILY ROUTINE SOURCE MODULES (schedulable — hidden dateFieldId binding required) ===
    // These 6 land in the Daily Routine template; the hidden date binding enables
    // the seed's SAME_DAY dedup-FIND and per-copy date stamp (createTestGrid convention).
    morningRun: {
      id: uid(), label: "Morning Run", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    readAChapter: {
      id: uid(), label: "Read a chapter", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: dateFieldId, role: "input", order: 1, hidden: true },
      ],
    },
    // NOTE: scrambledEggs + greekSaladChicken are in nutritionInstances below and
    //       also get the hidden dateFieldId ensured via ensureDateBinding().
  };

  // ── Workout instances (5 per muscle group × 6 groups = 30) ──────────────────
  function makeWorkout(label, group) {
    return {
      id: uid(), label, kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.set1Reps.id, role: "input", order: 1 },
        { fieldId: fields.set2Reps.id, role: "input", order: 2 },
        { fieldId: fields.set3Reps.id, role: "input", order: 3 },
        { fieldId: fields.workoutWeight.id, role: "input", order: 4 },
        { fieldId: fields.muscleGroup.id, role: "input", order: 5 },
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

  // ── Nutrition instances (Mediterranean diet, 34yr lean male 5'11") ──────────
  // Daily Routine sources: scrambledEggs + greekSaladChicken get hidden dateFieldId.
  function makeNutrition(label, mealType, cal, prot, c, fat) {
    return {
      id: uid(), label, kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.mealCategory.id, role: "input", order: 1 },
        { fieldId: fields.calories.id, role: "input", order: 2 },
        { fieldId: fields.protein.id, role: "input", order: 3 },
        { fieldId: fields.carbs.id, role: "input", order: 4 },
        { fieldId: fields.fats.id, role: "input", order: 5 },
      ],
      meta: { defaultMealType: mealType, defaultCal: cal, defaultProtein: prot, defaultCarbs: c, defaultFats: fat },
    };
  }
  const nutritionInstances = {
    greekYogurtBowl:   makeNutrition("Greek Yogurt Bowl",         "Breakfast", 380, 28, 42, 8),
    scrambledEggs:     makeNutrition("Scrambled Eggs + Veg",      "Breakfast", 320, 24, 18, 16),
    oatmealBerries:    makeNutrition("Oatmeal + Berries",         "Breakfast", 350, 12, 62, 7),
    avocadoToast:      makeNutrition("Avocado Toast",             "Breakfast", 420, 14, 38, 22),
    smoothieBowl:      makeNutrition("Smoothie Bowl",             "Breakfast", 390, 18, 58, 10),
    greekSaladChicken: makeNutrition("Greek Salad + Chicken",     "Lunch",     520, 48, 22, 24),
    tunaWrap:          makeNutrition("Tuna Wrap",                 "Lunch",     460, 38, 42, 14),
    lentilSoup:        makeNutrition("Lentil Soup",               "Lunch",     340, 20, 52, 6),
    quinoaBowl:        makeNutrition("Quinoa Bowl",               "Lunch",     480, 22, 68, 12),
    hummusPita:        makeNutrition("Hummus + Whole Grain Pita", "Lunch",     380, 14, 52, 14),
    almonds:           makeNutrition("Almonds (1oz)",             "Snack",     160, 6,  6,  14),
    olivesHummus:      makeNutrition("Olives + Hummus",           "Snack",     140, 4,  10, 10),
    cheeseCrackers:    makeNutrition("Cheese + Crackers",         "Snack",     180, 8,  16, 9),
    mixedBerries:      makeNutrition("Mixed Berries",             "Snack",     80,  1,  20, 0),
    proteinBar:        makeNutrition("Protein Bar",               "Snack",     220, 20, 24, 6),
    grilledSalmon:     makeNutrition("Grilled Salmon",            "Dinner",    520, 52, 12, 28),
    chickenSouvlaki:   makeNutrition("Chicken Souvlaki",          "Dinner",    560, 56, 30, 22),
    lambKofta:         makeNutrition("Lamb Kofta",                "Dinner",    580, 44, 28, 32),
    pastaMarinara:     makeNutrition("Pasta Marinara",            "Dinner",    520, 22, 78, 12),
    stuffedPeppers:    makeNutrition("Stuffed Peppers",           "Dinner",    440, 30, 48, 14),
    oliveOil:          makeNutrition("Olive Oil (1 tbsp)",        "Ingredient",120, 0,  0,  14),
    chickpeas:         makeNutrition("Chickpeas (1/2 cup)",       "Ingredient",135, 7,  22, 2),
    lemonGarlic:       makeNutrition("Lemon + Garlic base",       "Ingredient",20,  1,  4,  0),
    wholeGrainBread:   makeNutrition("Whole Grain Bread (2sl)",   "Ingredient",180, 8,  32, 3),
    greekOlives:       makeNutrition("Greek Olives (10pc)",       "Ingredient",50,  0,  2,  5),
  };
  // Ensure Daily Routine nutrition sources have hidden dateFieldId binding
  nutritionInstances.scrambledEggs.fieldBindings = ensureDateBinding(nutritionInstances.scrambledEggs.fieldBindings);
  nutritionInstances.greekSaladChicken.fieldBindings = ensureDateBinding(nutritionInstances.greekSaladChicken.fieldBindings);

  // ── Todo instances ───────────────────────────────────────────────────────────
  // Note: fields.dueDate in createDefaultUserData → fields.due.id here (same field, renamed key)
  const todoInstances = {
    buyGroceries: {
      id: uid(), label: "Buy groceries", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    cleanGarage: {
      id: uid(), label: "Clean out garage", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    fixLeakyFaucet: {
      id: uid(), label: "Fix leaky faucet", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.priority.id, role: "input", order: 1 },
      ],
    },
    returnBooks: {
      id: uid(), label: "Return library books", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    organizePantry: {
      id: uid(), label: "Organize pantry", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    payBills: {
      id: uid(), label: "Pay utility bills", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    cancelSub: {
      id: uid(), label: "Cancel unused subscription", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
    renewLicense: {
      id: uid(), label: "Renew driver's license", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    dentistAppt: {
      id: uid(), label: "Schedule dentist appointment", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    fileInsurance: {
      id: uid(), label: "File insurance claim", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    orderSupplies: {
      id: uid(), label: "Order office supplies", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
    backupComputer: {
      id: uid(), label: "Backup computer files", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [],
    },
    updatePortfolio: {
      id: uid(), label: "Update portfolio site", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    prepPresentation: {
      id: uid(), label: "Prep client presentation", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.priority.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    callMom: {
      id: uid(), label: "Call mom", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [],
    },
    planVacation: {
      id: uid(), label: "Plan summer vacation", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },
    birthdayGift: {
      id: uid(), label: "Buy birthday gift for Sarah", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    signUpClass: {
      id: uid(), label: "Sign up for cooking class", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
  };

  // ── Planning instances ───────────────────────────────────────────────────────
  const planningInstances = {
    moduliLaunch: {
      id: uid(), label: "Moduli MVP Launch", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.priority.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
        { fieldId: fields.notes.id, role: "input", order: 4 },
      ],
    },
    doctorCheckup: {
      id: uid(), label: "Annual Doctor Checkup", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    carInsurance: {
      id: uid(), label: "Car Insurance Renewal", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    fileTaxes: {
      id: uid(), label: "File Taxes", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
        { fieldId: fields.notes.id, role: "input", order: 3 },
      ],
    },
    quarterlyReview: {
      id: uid(), label: "Quarterly Financial Review", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.due.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
  };

  // ── Goal display instances ───────────────────────────────────────────────────
  // NB: workoutGoal/nutritionGoal keys also exist in goalContainerMods (instance vs container
  //     — different docs). fitnessAccount/productivityAccount/wellnessAccount/readingAccount
  //     keys also exist in accountContainerMods. Same for accountInstances.bankAccount etc.
  const goalInstances = {
    physicalSummary: {
      id: uid(), label: "Physical Wellness", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
        { fieldId: fields.totalWater.id, role: "display", order: 2 },
      ],
    },
    intellectualSummary: {
      id: uid(), label: "Intellectual Growth", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalPages.id, role: "display", order: 1 },
        { fieldId: fields.totalDuration.id, role: "display", order: 2 },
      ],
    },
    emotionalSummary: {
      id: uid(), label: "Emotional Balance", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.lastMood.id, role: "display", order: 1 },
      ],
    },
    socialSummary: {
      id: uid(), label: "Social Connection", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    spiritualSummary: {
      id: uid(), label: "Spiritual Practice", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    occupationalSummary: {
      id: uid(), label: "Work Progress", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    financialSummary: {
      id: uid(), label: "Financial Health", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalSpent.id, role: "display", order: 0 },
        { fieldId: fields.totalIncome.id, role: "display", order: 1 },
      ],
    },
    environmentalSummary: {
      id: uid(), label: "Environment Care", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
      ],
    },
    planningSummary: {
      id: uid(), label: "Planning Overview", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.overdueTasks.id, role: "display", order: 0 },
        { fieldId: fields.upcomingThisWeek.id, role: "display", order: 1 },
      ],
    },
    workoutGoal: {
      id: uid(), label: "Workout Today", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalRepsToday.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
      ],
    },
    nutritionGoal: {
      id: uid(), label: "Nutrition Today", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalProtein.id, role: "display", order: 0 },
        { fieldId: fields.totalCarbs.id, role: "display", order: 1 },
        { fieldId: fields.totalFats.id, role: "display", order: 2 },
      ],
    },
    moviesWatchedGoal: {
      id: uid(), label: "Movies Watched", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: moviesWatchedDisplayFieldId, role: "display", order: 0 },
      ],
    },
    booksReadGoal: {
      id: uid(), label: "Books Read", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: booksReadDisplayFieldId, role: "display", order: 0 },
      ],
    },
    podcastsListenedGoal: {
      id: uid(), label: "Podcasts Listened", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: podcastsListenedDisplayFieldId, role: "display", order: 0 },
      ],
    },
    coursesTakenGoal: {
      id: uid(), label: "Courses Taken", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: coursesTakenDisplayFieldId, role: "display", order: 0 },
      ],
    },
  };

  // ── Account aggregation instances ────────────────────────────────────────────
  const accountInstances = {
    bankAccount: {
      id: uid(), label: "Checking Account", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
        { fieldId: fields.totalSpent.id, role: "display", order: 1 },
        { fieldId: fields.totalIncome.id, role: "display", order: 2 },
      ],
    },
    savingsAccount: {
      id: uid(), label: "Savings Account", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
      ],
    },
    momsAccount: {
      id: uid(), label: "Mom's Account", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.momsAccountBalance.id, role: "display", order: 0 },
      ],
    },
    fitnessAccount: {
      id: uid(), label: "Fitness Stats", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalWorkouts.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
      ],
    },
    readingAccount: {
      id: uid(), label: "Reading Stats", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalReadingTime.id, role: "display", order: 0 },
        { fieldId: fields.totalPages.id, role: "display", order: 1 },
      ],
    },
    productivityAccount: {
      id: uid(), label: "Productivity", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completionRate.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    wellnessAccount: {
      id: uid(), label: "Wellness Score", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.lastMood.id, role: "display", order: 0 },
        { fieldId: fields.totalWater.id, role: "display", order: 1 },
      ],
    },
  };

  // ── Merge all kept instance sets ─────────────────────────────────────────────
  const allInstances = {
    ...toolkitInstances,
    ...workoutInstances,
    ...nutritionInstances,
    ...todoInstances,
    ...planningInstances,
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

  // ── Toolkit containers (dimensions + fitness + meal categories) ───────────────
  const toolkitContainerMods = {
    physical:      { id: uid(), label: "Physical",          styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    intellectual:  { id: uid(), label: "Intellectual",      styleMode: "own", ownStyle: { bg: "#1562b0" } },
    emotional:     { id: uid(), label: "Emotional",         styleMode: "own", ownStyle: { bg: "#a02158" } },
    social:        { id: uid(), label: "Social",            styleMode: "own", ownStyle: { bg: "#c49000" } },
    spiritual:     { id: uid(), label: "Spiritual",         styleMode: "own", ownStyle: { bg: "#6427c5" } },
    occupational:  { id: uid(), label: "Occupational",      styleMode: "own", ownStyle: { bg: "#0d7a52" } },
    financial:     { id: uid(), label: "Financial",         styleMode: "own", ownStyle: { bg: "#1d8a30" } },
    environmental: { id: uid(), label: "Environmental",     styleMode: "own", ownStyle: { bg: "#0779a0" } },
    workoutAll:    { id: uid(), label: "Physical - Fitness" },
    mealBreakfast:   { id: uid(), label: "Breakfast" },
    mealLunch:       { id: uid(), label: "Lunch" },
    mealSnack:       { id: uid(), label: "Snack" },
    mealDinner:      { id: uid(), label: "Dinner" },
    mealIngredients: { id: uid(), label: "Ingredients" },
  };

  // ── Todo containers (5 categories) ───────────────────────────────────────────
  const todoContainerMods = {
    todoHome:     { id: uid(), label: "Home & Errands",       meta: { todoListContainer: true } },
    todoFinance:  { id: uid(), label: "Finance & Admin",      meta: { todoListContainer: true } },
    todoWork:     { id: uid(), label: "Work Projects",        meta: { todoListContainer: true } },
    todoPersonal: { id: uid(), label: "Personal / Fun",       meta: { todoListContainer: true } },
    todoPlan:     { id: uid(), label: "Planning & Deadlines", meta: { todoListContainer: true } },
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
    workoutGoal:      { id: uid(), label: "Workout" },
    nutritionGoal:    { id: uid(), label: "Nutrition" },
    planningGoal:     { id: uid(), label: "Planning" },
    moviesWatchedGoal:    { id: uid(), label: "Entertainment" },
    booksReadGoal:        { id: uid(), label: "Books Read" },
    podcastsListenedGoal: { id: uid(), label: "Podcasts Listened" },
    coursesTakenGoal:     { id: uid(), label: "Courses Taken" },
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

  // ── Merge + persist container modules ────────────────────────────────────────
  const containerMods = {
    ...toolkitContainerMods,
    ...todoContainerMods,
    ...goalContainerMods,
    ...accountContainerMods,
    ...libraryContainerMods,
  };

  const containerDocs = Object.values(containerMods).map(c => ({
    id: c.id,
    label: c.label,
    userId,
    gridId,
    role: "container",
    kind: "list",
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
  // Toolkit containers
  const physContOccId         = uid();
  const intellectualContOccId = uid();
  const emotionalContOccId    = uid();
  const socialContOccId       = uid();
  const spiritualContOccId    = uid();
  const occupationalContOccId = uid();
  const financialContOccId    = uid();
  const environmentalContOccId = uid();
  const workoutAllContOccId   = uid();
  const mealBreakfastContOccId  = uid();
  const mealLunchContOccId      = uid();
  const mealSnackContOccId      = uid();
  const mealDinnerContOccId     = uid();
  const mealIngredientsContOccId = uid();

  // Todo containers
  const todoHomeContOccId     = uid();
  const todoFinanceContOccId  = uid();
  const todoWorkContOccId     = uid();
  const todoPersonalContOccId = uid();
  const todoPlanContOccId     = uid();

  // Goal containers
  const physicalGoalContOccId      = uid();
  const intellectualGoalContOccId  = uid();
  const emotionalGoalContOccId     = uid();
  const socialGoalContOccId        = uid();
  const spiritualGoalContOccId     = uid();
  const occupationalGoalContOccId  = uid();
  const financialGoalContOccId     = uid();
  const environmentalGoalContOccId = uid();
  const workoutGoalContOccId       = uid();
  const nutritionGoalContOccId     = uid();
  const planningGoalContOccId      = uid();

  // Account containers
  const financeAccountContOccId      = uid();
  const fitnessAccountContOccId      = uid();
  const learningAccountContOccId     = uid();
  const productivityAccountContOccId = uid();
  const wellnessAccountContOccId     = uid();

  // Movies Watched / Books Read / Podcasts Listened / Courses Taken goal containers
  const moviesWatchedGoalContOccId  = uid();
  const booksReadGoalContOccId      = uid();
  const podcastsListenedGoalContOccId = uid();
  const coursesTakenGoalContOccId   = uid();

  // ── Container→instance mappings (ported from createDefaultUserData) ────────
  const toolkitMappings = {
    physical:      { contOccId: physContOccId,         contModKey: "physical",      instKeys: ["morningWorkout", "eveningRun", "stretching", "drinkWater", "takeMeds", "sleepLog"] },
    intellectual:  { contOccId: intellectualContOccId, contModKey: "intellectual",  instKeys: ["reading", "podcast", "watchMovie", "onlineCourse", "brainGames", "journaling"] },
    emotional:     { contOccId: emotionalContOccId,    contModKey: "emotional",     instKeys: ["gratitude", "meditation", "breathing", "moodCheck", "selfCare"] },
    social:        { contOccId: socialContOccId,       contModKey: "social",        instKeys: ["callFriend", "familyTime", "socialEvent", "helpSomeone"] },
    spiritual:     { contOccId: spiritualContOccId,    contModKey: "spiritual",     instKeys: ["prayer", "natureWalk", "spiritualReading", "mindfulness"] },
    occupational:  { contOccId: occupationalContOccId, contModKey: "occupational",  instKeys: ["deepWork", "meeting", "emailBlock", "skillDev", "networking"] },
    financial:     { contOccId: financialContOccId,    contModKey: "financial",     instKeys: ["budgetReview", "trackExpense", "purchase", "logIncome", "investmentCheck", "savingsGoal"] },
    environmental: { contOccId: environmentalContOccId,contModKey: "environmental", instKeys: ["cleanDesk", "declutter", "plantCare", "recycling", "ecoAction"] },
    workoutAll:    { contOccId: workoutAllContOccId,   contModKey: "workoutAll",    instKeys: [
      "benchPress", "inclinePress", "chestFly", "pushUps", "cableCrossover",
      "deadlift", "pullUps", "bentRow", "latPulldown", "seatedRow",
      "squat", "legPress", "lunges", "legCurl", "calfRaise",
      "overheadPress", "lateralRaise", "frontRaise", "facePull", "shrugs",
      "bicepCurl", "hammerCurl", "tricepDip", "skullCrusher", "tricepPushdown",
      "running", "cycling", "jumpRope", "rowMachine", "burpees",
    ] },
    mealBreakfast:    { contOccId: mealBreakfastContOccId,   contModKey: "mealBreakfast",   instKeys: ["greekYogurtBowl", "scrambledEggs", "oatmealBerries", "avocadoToast", "smoothieBowl"] },
    mealLunch:        { contOccId: mealLunchContOccId,       contModKey: "mealLunch",       instKeys: ["greekSaladChicken", "tunaWrap", "lentilSoup", "quinoaBowl", "hummusPita"] },
    mealSnack:        { contOccId: mealSnackContOccId,       contModKey: "mealSnack",       instKeys: ["almonds", "olivesHummus", "cheeseCrackers", "mixedBerries", "proteinBar"] },
    mealDinner:       { contOccId: mealDinnerContOccId,      contModKey: "mealDinner",      instKeys: ["grilledSalmon", "chickenSouvlaki", "lambKofta", "pastaMarinara", "stuffedPeppers"] },
    mealIngredients:  { contOccId: mealIngredientsContOccId, contModKey: "mealIngredients", instKeys: ["oliveOil", "chickpeas", "lemonGarlic", "wholeGrainBread", "greekOlives"] },
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

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(toolkitMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      // Pre-fill default field values from instance meta (mirrors createDefaultUserData)
      const defaultFields = {};
      if (inst.meta?.defaultMuscleGroup) {
        defaultFields[fields.muscleGroup.id] = fv(inst.meta.defaultMuscleGroup, "replace");
        // Workout starting state: a descending rep pyramid (12/10/8) at the
        // exercise's progressive-overload weight, so each exercise opens
        // showing "where I'm at" instead of empty inputs.
        defaultFields[fields.set1Reps.id]     = fv(12, "replace");
        defaultFields[fields.set2Reps.id]     = fv(10, "replace");
        defaultFields[fields.set3Reps.id]     = fv(8,  "replace");
        defaultFields[fields.workoutWeight.id] = fv(workoutStartWeights[instKey] ?? 20, "replace");
      }
      if (inst.meta?.defaultMealType)    defaultFields[fields.mealCategory.id] = fv(inst.meta.defaultMealType, "replace");
      if (inst.meta?.defaultCal)         defaultFields[fields.calories.id]     = fv(inst.meta.defaultCal, "replace");
      if (inst.meta?.defaultProtein)     defaultFields[fields.protein.id]      = fv(inst.meta.defaultProtein, "replace");
      if (inst.meta?.defaultCarbs)       defaultFields[fields.carbs.id]        = fv(inst.meta.defaultCarbs, "replace");
      if (inst.meta?.defaultFats)        defaultFields[fields.fats.id]         = fv(inst.meta.defaultFats, "replace");
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: defaultFields });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds, filterOverride: {} });
    toolkitContOccIds[contModKey] = contOccId;
  }

  // Extra mood check-in pre-seeded in emotional container (mirrors createDefaultUserData
  // moodTodayOccId — demonstrates mood wheel UI on first load)
  const moodTodayOccId = await mkOcc({
    moduleId: instanceMods.moodCheck.id,
    parentId: emotionalContOccId,
    sortOrder: 99, // append after the regular instances
    fields: {
      [fields.mood.id]:   fv("focused", "in"),
      [fields.energy.id]: fv(4, "in"),
    },
  });
  // Append to the emotional container's occurrences[]
  await Occurrence.findOneAndUpdate({ id: emotionalContOccId }, { $push: { occurrences: moodTodayOccId } });

  // ── Todo containers ────────────────────────────────────────────────────────
  // Due date pre-fills for planning instances (matches createDefaultUserData planningDueDates)
  const planningDueDates = {
    moduliLaunch:    daysFromNow(45),
    doctorCheckup:   daysFromNow(90),
    carInsurance:    daysFromNow(12),
    fileTaxes:       daysFromNow(38),
    quarterlyReview: daysFromNow(21),
  };

  const todoMappings = {
    todoHome:     { contOccId: todoHomeContOccId,     contModKey: "todoHome",     instKeys: ["buyGroceries", "cleanGarage", "fixLeakyFaucet", "returnBooks", "organizePantry"] },
    todoFinance:  { contOccId: todoFinanceContOccId,  contModKey: "todoFinance",  instKeys: ["payBills", "cancelSub", "renewLicense", "dentistAppt", "fileInsurance"] },
    todoWork:     { contOccId: todoWorkContOccId,     contModKey: "todoWork",     instKeys: ["orderSupplies", "backupComputer", "updatePortfolio", "prepPresentation"] },
    todoPersonal: { contOccId: todoPersonalContOccId, contModKey: "todoPersonal", instKeys: ["callMom", "planVacation", "birthdayGift", "signUpClass"] },
    todoPlan:     { contOccId: todoPlanContOccId,     contModKey: "todoPlan",     instKeys: ["moduliLaunch", "doctorCheckup", "carInsurance", "fileTaxes", "quarterlyReview"] },
  };

  const todoContOccIds = {};

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(todoMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      // Every todo gets a Due date stamped on its occurrence (createTestGrid
      // parity: createTestGrid pre-filled each todo occ with
      // `fields[dueFieldId] = { value: <date ISO>, flow: "in", ... }` — without
      // it the Todo List renders the bound Due field with no value).
      // Planning instances keep their specific real deadlines; every other
      // todo gets a randomized due date 1–14 days out so the list has varied,
      // schedule-sweepable dates (Schedule: Build Day matches
      // `fields.<dueFieldId>.value SAME_DAY $schedDate`).
      const dueDate = planningDueDates[instKey]
        || daysFromNow(1 + Math.floor(Math.random() * 14));
      const dueDatePreFill = { [fields.due.id]: fv(dueDate.toISOString()) };
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: dueDatePreFill });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds, filterOverride: {} });
    todoContOccIds[contModKey] = contOccId;
  }

  // ── Goal containers ────────────────────────────────────────────────────────
  // Goal containers do NOT get filterOverride: {} — date cascade from the
  // Goals page is intentional (matches createTestGrid physGoalContOccId convention).
  const goalMappings = {
    physicalGoal:      { contOccId: physicalGoalContOccId,      contModKey: "physicalGoal",      instKeys: ["physicalSummary"] },
    intellectualGoal:  { contOccId: intellectualGoalContOccId,  contModKey: "intellectualGoal",  instKeys: ["intellectualSummary"] },
    emotionalGoal:     { contOccId: emotionalGoalContOccId,     contModKey: "emotionalGoal",     instKeys: ["emotionalSummary"] },
    socialGoal:        { contOccId: socialGoalContOccId,        contModKey: "socialGoal",        instKeys: ["socialSummary"] },
    spiritualGoal:     { contOccId: spiritualGoalContOccId,     contModKey: "spiritualGoal",     instKeys: ["spiritualSummary"] },
    occupationalGoal:  { contOccId: occupationalGoalContOccId,  contModKey: "occupationalGoal",  instKeys: ["occupationalSummary"] },
    financialGoal:     { contOccId: financialGoalContOccId,     contModKey: "financialGoal",     instKeys: ["financialSummary"] },
    environmentalGoal: { contOccId: environmentalGoalContOccId, contModKey: "environmentalGoal", instKeys: ["environmentalSummary"] },
    workoutGoal:       { contOccId: workoutGoalContOccId,       contModKey: "workoutGoal",       instKeys: ["workoutGoal"] },
    nutritionGoal:     { contOccId: nutritionGoalContOccId,     contModKey: "nutritionGoal",     instKeys: ["nutritionGoal"] },
    planningGoal:      { contOccId: planningGoalContOccId,      contModKey: "planningGoal",      instKeys: ["planningSummary"] },
    moviesWatchedGoal:    { contOccId: moviesWatchedGoalContOccId,    contModKey: "moviesWatchedGoal",    instKeys: ["moviesWatchedGoal"] },
    booksReadGoal:        { contOccId: booksReadGoalContOccId,        contModKey: "booksReadGoal",        instKeys: ["booksReadGoal"] },
    podcastsListenedGoal: { contOccId: podcastsListenedGoalContOccId, contModKey: "podcastsListenedGoal", instKeys: ["podcastsListenedGoal"] },
    coursesTakenGoal:     { contOccId: coursesTakenGoalContOccId,     contModKey: "coursesTakenGoal",     instKeys: ["coursesTakenGoal"] },
  };

  const goalContOccIds = {};

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(goalMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: {} });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds });
    goalContOccIds[contModKey] = contOccId;
  }

  // ── Account containers ─────────────────────────────────────────────────────
  // Account containers are all-time aggregations — no filterOverride needed.
  const accountMappings = {
    financeAccount:      { contOccId: financeAccountContOccId,      contModKey: "financeAccount",      instKeys: ["bankAccount", "savingsAccount", "momsAccount"] },
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
      const childId = await mkOcc({ moduleId: inst.id, parentId: contOccId, sortOrder: i, fields: {} });
      childOccIds.push(childId);
    }
    await mkOcc({ id: contOccId, moduleId: containerMods[contModKey].id, occurrences: childOccIds });
    accountContOccIds[contModKey] = contOccId;
  }

  // ── Library: movies + books + podcasts + courses modules + container + page + field patches ──
  //
  // Mirrors createTestGrid STEP 3 (movie modules), STEP 4 (libraryContModId already
  // added to containerDocs above), STEP 6 (library occurrences), STEP 8 (library page).
  // All done here so libraryContOccId exists before STEP 7 folder tree references it.
  // filterOverride:{} on both container and page — always visible, no date filter.

  // 8 movie modules (role:"instance", hidden library binding)
  await Module.insertMany([
    { id: movieInceptionModId,       userId, gridId, role: "instance", kind: "list", label: "Inception",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieMatrixModId,          userId, gridId, role: "instance", kind: "list", label: "The Matrix",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieArrivalModId,         userId, gridId, role: "instance", kind: "list", label: "Arrival",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieDuneModId,            userId, gridId, role: "instance", kind: "list", label: "Dune",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieInterstellarModId,    userId, gridId, role: "instance", kind: "list", label: "Interstellar",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieBladeRunner2049ModId, userId, gridId, role: "instance", kind: "list", label: "Blade Runner 2049",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: moviePrestigeModId,        userId, gridId, role: "instance", kind: "list", label: "The Prestige",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: movieTenetModId,           userId, gridId, role: "instance", kind: "list", label: "Tenet",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
  ]);

  // 7 book modules — fieldBindings include libraryFieldId (type) and pagesFieldId (page count), both hidden
  const bookFieldBindings = [
    { fieldId: libraryFieldId, role: "input", order: 0, hidden: true },
    { fieldId: pagesFieldId,   role: "input", order: 1, hidden: true },
  ];
  await Module.insertMany([
    { id: bookAtomicHabitsModId,     userId, gridId, role: "instance", kind: "list", label: "Atomic Habits",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookDeepWorkModId,         userId, gridId, role: "instance", kind: "list", label: "Deep Work",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookSapiensModId,          userId, gridId, role: "instance", kind: "list", label: "Sapiens",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookThinkingFastSlowModId, userId, gridId, role: "instance", kind: "list", label: "Thinking, Fast and Slow",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookMeditationsModId,      userId, gridId, role: "instance", kind: "list", label: "Meditations",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: bookMansSearchModId,       userId, gridId, role: "instance", kind: "list", label: "Man's Search for Meaning",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
    { id: book4HourWorkweekModId,    userId, gridId, role: "instance", kind: "list", label: "The 4-Hour Workweek",
      defaultDragMode: "move", fieldBindings: bookFieldBindings },
  ]);

  // 5 podcast modules
  await Module.insertMany([
    { id: podcastTimFerrissModId,      userId, gridId, role: "instance", kind: "list", label: "The Tim Ferriss Show",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: podcastLexFridmanModId,      userId, gridId, role: "instance", kind: "list", label: "Lex Fridman Podcast",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: podcastHardcoreHistoryModId, userId, gridId, role: "instance", kind: "list", label: "Hardcore History",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: podcastHubermanLabModId,     userId, gridId, role: "instance", kind: "list", label: "Huberman Lab",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: podcastConvosTylerModId,     userId, gridId, role: "instance", kind: "list", label: "Conversations with Tyler",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
  ]);

  // 4 course modules
  await Module.insertMany([
    { id: courseAlgorithmsModId,      userId, gridId, role: "instance", kind: "list", label: "Algorithms (Coursera)",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: courseMLSpecModId,          userId, gridId, role: "instance", kind: "list", label: "Machine Learning Specialization",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: courseSystemDesignModId,    userId, gridId, role: "instance", kind: "list", label: "System Design Primer",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: courseIntroPhilosophyModId, userId, gridId, role: "instance", kind: "list", label: "Introduction to Philosophy",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
  ]);

  // 7 reflection question modules (library type "question")
  // Labels are the question text — Daily Question Rotator picks one by day-of-year.
  await Module.insertMany([
    { id: qWentWellModId,        userId, gridId, role: "instance", kind: "list", label: "What went well today?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qLearnedModId,         userId, gridId, role: "instance", kind: "list", label: "What did you learn?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qChallengingModId,     userId, gridId, role: "instance", kind: "list", label: "What was challenging?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qGratefulModId,        userId, gridId, role: "instance", kind: "list", label: "What are you grateful for?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qDifferentlyModId,     userId, gridId, role: "instance", kind: "list", label: "What would you do differently?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qImproveTomorrowModId, userId, gridId, role: "instance", kind: "list", label: "What's one thing you can improve tomorrow?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
    { id: qSurprisedModId,       userId, gridId, role: "instance", kind: "list", label: "What surprised you today?",
      defaultDragMode: "move", fieldBindings: [{ fieldId: libraryFieldId, role: "input", order: 0, hidden: true }] },
  ]);

  // 8 movie occurrences (parentId = libraryContOccId, library field = "movie")
  const movieInceptionOccId       = await mkOcc({ moduleId: movieInceptionModId,       parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieMatrixOccId          = await mkOcc({ moduleId: movieMatrixModId,          parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieArrivalOccId         = await mkOcc({ moduleId: movieArrivalModId,         parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieDuneOccId            = await mkOcc({ moduleId: movieDuneModId,            parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieInterstellarOccId    = await mkOcc({ moduleId: movieInterstellarModId,    parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieBladeRunner2049OccId = await mkOcc({ moduleId: movieBladeRunner2049ModId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const moviePrestigeOccId        = await mkOcc({ moduleId: moviePrestigeModId,        parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });
  const movieTenetOccId           = await mkOcc({ moduleId: movieTenetModId,           parentId: libraryContOccId, fields: { [libraryFieldId]: fv("movie") } });

  // 7 book occurrences (library field = "book")
  const bookAtomicHabitsOccId     = await mkOcc({ moduleId: bookAtomicHabitsModId,     parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(320) } });
  const bookDeepWorkOccId         = await mkOcc({ moduleId: bookDeepWorkModId,         parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(304) } });
  const bookSapiensOccId          = await mkOcc({ moduleId: bookSapiensModId,          parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(464) } });
  const bookThinkingFastSlowOccId = await mkOcc({ moduleId: bookThinkingFastSlowModId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(499) } });
  const bookMeditationsOccId      = await mkOcc({ moduleId: bookMeditationsModId,      parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(304) } });
  const bookMansSearchOccId       = await mkOcc({ moduleId: bookMansSearchModId,       parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(165) } });
  const book4HourWorkweekOccId    = await mkOcc({ moduleId: book4HourWorkweekModId,    parentId: libraryContOccId, fields: { [libraryFieldId]: fv("book"), [pagesFieldId]: fv(320) } });

  // 5 podcast occurrences (library field = "podcast")
  const podcastTimFerrissOccId      = await mkOcc({ moduleId: podcastTimFerrissModId,      parentId: libraryContOccId, fields: { [libraryFieldId]: fv("podcast") } });
  const podcastLexFridmanOccId      = await mkOcc({ moduleId: podcastLexFridmanModId,      parentId: libraryContOccId, fields: { [libraryFieldId]: fv("podcast") } });
  const podcastHardcoreHistoryOccId = await mkOcc({ moduleId: podcastHardcoreHistoryModId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("podcast") } });
  const podcastHubermanLabOccId     = await mkOcc({ moduleId: podcastHubermanLabModId,     parentId: libraryContOccId, fields: { [libraryFieldId]: fv("podcast") } });
  const podcastConvosTylerOccId     = await mkOcc({ moduleId: podcastConvosTylerModId,     parentId: libraryContOccId, fields: { [libraryFieldId]: fv("podcast") } });

  // 4 course occurrences (library field = "course")
  const courseAlgorithmsOccId      = await mkOcc({ moduleId: courseAlgorithmsModId,      parentId: libraryContOccId, fields: { [libraryFieldId]: fv("course") } });
  const courseMLSpecOccId          = await mkOcc({ moduleId: courseMLSpecModId,          parentId: libraryContOccId, fields: { [libraryFieldId]: fv("course") } });
  const courseSystemDesignOccId    = await mkOcc({ moduleId: courseSystemDesignModId,    parentId: libraryContOccId, fields: { [libraryFieldId]: fv("course") } });
  const courseIntroPhilosophyOccId = await mkOcc({ moduleId: courseIntroPhilosophyModId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("course") } });

  // 7 reflection question occurrences (library field = "question")
  const qWentWellOccId        = await mkOcc({ moduleId: qWentWellModId,        parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qLearnedOccId         = await mkOcc({ moduleId: qLearnedModId,         parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qChallengingOccId     = await mkOcc({ moduleId: qChallengingModId,     parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qGratefulOccId        = await mkOcc({ moduleId: qGratefulModId,        parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qDifferentlyOccId     = await mkOcc({ moduleId: qDifferentlyModId,     parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qImproveTomorrowOccId = await mkOcc({ moduleId: qImproveTomorrowModId, parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });
  const qSurprisedOccId       = await mkOcc({ moduleId: qSurprisedModId,       parentId: libraryContOccId, fields: { [libraryFieldId]: fv("question") } });

  // Library container occurrence (libraryContOccId pre-generated at top)
  await mkOcc({
    id: libraryContOccId,
    moduleId: libraryContModId,
    occurrences: [
      // movies
      movieInceptionOccId, movieMatrixOccId, movieArrivalOccId, movieDuneOccId,
      movieInterstellarOccId, movieBladeRunner2049OccId, moviePrestigeOccId, movieTenetOccId,
      // books
      bookAtomicHabitsOccId, bookDeepWorkOccId, bookSapiensOccId, bookThinkingFastSlowOccId,
      bookMeditationsOccId, bookMansSearchOccId, book4HourWorkweekOccId,
      // podcasts
      podcastTimFerrissOccId, podcastLexFridmanOccId, podcastHardcoreHistoryOccId,
      podcastHubermanLabOccId, podcastConvosTylerOccId,
      // courses
      courseAlgorithmsOccId, courseMLSpecOccId, courseSystemDesignOccId, courseIntroPhilosophyOccId,
      // questions
      qWentWellOccId, qLearnedOccId, qChallengingOccId, qGratefulOccId,
      qDifferentlyOccId, qImproveTomorrowOccId, qSurprisedOccId,
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

  const rootFolderId       = uid();
  const tasksFolderId      = uid();
  const trackersFolderId   = uid();
  const interfacesFolderId = uid();
  const notesFolderId      = uid();
  const dayPagesFolderId   = uid();

  await new Manifest({ id: manifestId, userId, gridId, manifestType: "user", rootFolderId }).save();
  await new Folder({ id: rootFolderId,       userId, gridId, name: "Root",       parentId: null,       folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: tasksFolderId,      userId, gridId, name: "Tasks",      parentId: rootFolderId, folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: trackersFolderId,   userId, gridId, name: "Trackers",   parentId: rootFolderId, folderType: "normal",    sortOrder: 1, isExpanded: true }).save();
  await new Folder({ id: interfacesFolderId, userId, gridId, name: "Interfaces", parentId: rootFolderId, folderType: "normal",    sortOrder: 2, isExpanded: true }).save();
  await new Folder({ id: notesFolderId,      userId, gridId, name: "Notes",      parentId: rootFolderId, folderType: "normal",    sortOrder: 3, isExpanded: true }).save();
  await new Folder({ id: dayPagesFolderId,   userId, gridId, name: "Day Pages",  parentId: rootFolderId, folderType: "day-pages", sortOrder: 4, isExpanded: true }).save();
  await new Folder({ id: libraryFolderId,    userId, gridId, name: "Library",    parentId: rootFolderId, folderType: "normal",    sortOrder: 5, isExpanded: true }).save();

  // ── STEP 7b: Templates manifest + Daily Routine + Day Page templates ────────
  // Separate manifest from the user manifest (createTestGrid pattern).
  // buildTemplatesManifest mints the Templates folder + manifest and returns
  // the root folder id that both template subtrees parent to.
  const { tplManifestRootFolderId } = await buildTemplatesManifest({ userId, gridId, Folder, Manifest });

  // Per-slot routine picks (6 items, no completed/water pre-fills).
  // Slot-label keys are EXACTLY the strings generateTimeSlots() emits:
  //   `${h}:${m}${ampm}` where h has no leading zero, m is "00"/"30", ampm is lowercase.
  const routineBySlot = {
    "6:00am": [
      { sourceModId: instanceMods.drinkWater.id,        label: "Drink Water" },
      { sourceModId: instanceMods.takeMeds.id,          label: "Take Vitamins" },
    ],
    "7:00am": [{ sourceModId: instanceMods.morningRun.id,        label: "Morning Run" }],
    "8:00am": [{ sourceModId: instanceMods.scrambledEggs.id,     label: "Scrambled Eggs + Veg" }],
    "12:00pm": [{ sourceModId: instanceMods.greekSaladChicken.id, label: "Greek Salad + Chicken" }],
    "6:00pm": [{ sourceModId: instanceMods.readAChapter.id,      label: "Read a chapter" }],
  };

  await buildDailyRoutineTemplate({
    userId, gridId, timeSlots, timeslotFieldId, routineBySlot,
    tplManifestRootFolderId, mkOcc, Module,
    findModule: (q) => Module.findOne(q).lean(),
  });

  await buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module });

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

  // ── 1. Philosopher's Stone ── morenotes.md + philosopherstone.md merged ──
  {
    const moreNotesSections = parseSectionsWithInstances(join(ROOT_DIR_MD, "morenotes.md"), 1, 2, 8);
    const philSections      = parseSectionsWithInstances(join(ROOT_DIR_MD, "philosopherstone.md"), 1, 2, 8);
    const mergeInput = [
      ...sectionsToMergeInput(moreNotesSections, 2),
      ...sectionsToMergeInput(philSections, 2),
    ];
    const textmap = buildFlatDocTextmap("Philosopher’s Stone", mergeInput);
    const modId = uid(); const occId = uid();
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
    const textmap = buildFlatDocTextmap("Gospel of Thomas (Notes)", mergeInput);
    const modId = uid(); const occId = uid();
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
    const textmap = buildFlatDocTextmap("Uses", mergeInput);
    const modId = uid(); const occId = uid();
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
    const textmap = buildFlatDocTextmap("Pragmatic", mergeInput);
    const modId = uid(); const occId = uid();
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
    const textmap = buildFlatDocTextmap("AI Specs", mergeInput);
    const modId = uid(); const occId = uid();
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
    const textmap = buildFlatDocTextmap("Bangle Specs", mergeInput);
    const modId = uid(); const occId = uid();
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Bangle Specs" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 5,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Bangle Specs"] = occId;
  }

  // ── 7. Comparative Religion ── comparitive_religion.md (flat) ──
  {
    const lines = readRawLines(join(ROOT_DIR_MD, "comparitive_religion.md"), 120);
    const textmap = buildFlatLinesTextmap("Comparative Religion", lines);
    const modId = uid(); const occId = uid();
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: "Comparative Religion" }).save();
    await mkOcc({ id: occId, moduleId: modId, parentId: notesFolderId, sortOrder: 6,
      iteration: { mode: "persistent" }, fields: {}, textmap,
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } } });
    notebookDocOccIds["Comparative Religion"] = occId;
  }

  // ── 8. Gospel of Thomas (Text) ── gospelthomas.md (flat, 80 lines) ──
  {
    const lines = readRawLines(join(ROOT_DIR_MD, "gospelthomas.md"), 80);
    const textmap = buildFlatLinesTextmap("Gospel of Thomas (Text)", lines);
    const modId = uid(); const occId = uid();
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

  const toolkitPageModId = uid(); const toolkitPageOccId = uid();
  await new Module({ id: toolkitPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Toolkit" }).save();
  await mkOcc({
    id: toolkitPageOccId, moduleId: toolkitPageModId,
    parentId: tasksFolderId, sortOrder: 0,
    occurrences: Object.values(toolkitContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  const todoPageModId = uid(); const todoPageOccId = uid();
  await new Module({ id: todoPageModId, userId, gridId, role: "page", kind: "board", label: "Todo List" }).save();
  await mkOcc({
    id: todoPageOccId, moduleId: todoPageModId,
    parentId: tasksFolderId, sortOrder: 1,
    occurrences: Object.values(todoContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  const goalsPageModId = uid(); const goalsPageOccId = uid();
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Daily Goals" }).save();
  await mkOcc({
    id: goalsPageOccId, moduleId: goalsPageModId,
    parentId: trackersFolderId, sortOrder: 0,
    occurrences: Object.values(goalContOccIds),
    iteration: { mode: "persistent" }, fields: {},
  });

  const accountsPageModId = uid(); const accountsPageOccId = uid();
  await new Module({ id: accountsPageModId, userId, gridId, role: "page", kind: "board", label: "Accounts" }).save();
  await mkOcc({
    id: accountsPageOccId, moduleId: accountsPageModId,
    parentId: trackersFolderId, sortOrder: 1,
    occurrences: Object.values(accountContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  const schedPageModId = uid(); const schedPageOccId = uid();
  await new Module({ id: schedPageModId, userId, gridId, role: "page", kind: "board", label: "Schedule" }).save();
  await mkOcc({
    id: schedPageOccId, moduleId: schedPageModId,
    parentId: interfacesFolderId, sortOrder: 0,
    occurrences: [], // EMPTY — Schedule: Build Day populates at runtime (Task 13)
    iteration: { mode: "persistent" }, fields: {},
    // Date filter + Time Slot filter (a <select> over the 48 slot labels).
    filters: buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels }),
  });

  const canvasPageModId = uid(); const canvasPageOccId = uid();
  await new Module({ id: canvasPageModId, userId, gridId, role: "page", kind: "canvas", label: "Canvas" }).save();
  await mkOcc({
    id: canvasPageOccId, moduleId: canvasPageModId,
    parentId: interfacesFolderId, sortOrder: 1,
    occurrences: [], // empty scratchpad — drag-to-canvas drop zone
    iteration: { mode: "persistent" }, fields: {},
    // Canvas is a scratchpad — explicit `{}` override blocks the grid's daily
    // date filter cascade so dragged-in notes don't vanish on date nav.
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

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

  // Notebook hub View — Schedule is the default active tab.
  const notebookHubViewId = uid();
  await new View({ id: notebookHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: schedPageOccId }).save();

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
  const placements = [
    { key: "toolkit",  panelId: toolkitPanelId,  row: 0, col: 0, width: 1, height: 1, viewId: null              },
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
    });
    panelOccIds[p.key] = occId;
    gridOccIds.push(occId);
  }

  // ── STEP 10: Wire page occurrences into panel occurrences ───────────────────
  // Notebook hub pins Schedule + Canvas. The Day Page tab is NOT pinned here —
  // Day Page: Build adds it via ADD_CHILD at runtime (Task 13). Notebook DOC
  // pages (Task 11) are NOT pinned — they live only under notesFolderId.
  await Occurrence.findOneAndUpdate({ id: panelOccIds.toolkit },  { $set: { occurrences: [toolkitPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.todo },     { $set: { occurrences: [todoPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.notebook }, { $set: { occurrences: [schedPageOccId, canvasPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.goals },    { $set: { occurrences: [goalsPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.accounts }, { $set: { occurrences: [accountsPageOccId] } });

  // ── STEP 11: Finalize grid ──────────────────────────────────────────────────
  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccIds } });

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

  const trackerArgs = { userId, gridId, dateFieldId, completedFieldId };

  // ── DAILY TASK / WELLNESS ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Completed Today",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalCompleted.id,
    agg: "countTrue", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Latest Mood",
    goalLabel: "Emotional Balance", goalFieldId: fields.lastMood.id,
    sourceFieldId: fields.mood.id, agg: "last", timeFilter: "daily",
  })).save();

  // ── DAILY ACTIVITY ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Steps Today",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalSteps.id,
    sourceFieldId: fields.steps.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Water Today",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalWater.id,
    sourceFieldId: fields.water.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Time Spent Today",
    goalLabel: "Intellectual Growth", goalFieldId: fields.totalDuration.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Pages Today",
    goalLabel: "Intellectual Growth", goalFieldId: fields.totalPages.id,
    sourceFieldId: fields.pages.id, agg: "sum", timeFilter: "daily",
  })).save();

  // ── DAILY FINANCE ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Spent Today",
    goalLabel: "Financial Health", goalFieldId: fields.totalSpent.id,
    sourceFieldId: fields.amount.id, agg: "sum", flow: "out", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Earned Today",
    goalLabel: "Financial Health", goalFieldId: fields.totalIncome.id,
    sourceFieldId: fields.income.id, agg: "sum", flow: "in", timeFilter: "daily",
  })).save();

  // ── DAILY NUTRITION ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Protein Today",
    goalLabel: "Nutrition Today", goalFieldId: fields.totalProtein.id,
    sourceFieldId: fields.protein.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Carbs Today",
    goalLabel: "Nutrition Today", goalFieldId: fields.totalCarbs.id,
    sourceFieldId: fields.carbs.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Fats Today",
    goalLabel: "Nutrition Today", goalFieldId: fields.totalFats.id,
    sourceFieldId: fields.fats.id, agg: "sum", timeFilter: "daily",
  })).save();

  // ── DAILY WORKOUT (multi-source roll-up) ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Total Reps Today",
    goalLabel: "Workout Today", goalFieldId: fields.totalRepsToday.id,
    sourceFieldIds: [fields.set1Reps.id, fields.set2Reps.id, fields.set3Reps.id],
    agg: "multiSum", timeFilter: "daily",
  })).save();

  // ── ALL-TIME / ACCOUNT AGGREGATIONS ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Net Balance",
    goalLabel: "Checking Account", goalFieldId: fields.netBalance.id,
    incomeFieldId: fields.income.id, spentFieldId: fields.amount.id,
    agg: "net", timeFilter: "all",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Mom's Account Balance",
    goalLabel: "Mom's Account", goalFieldId: fields.momsAccountBalance.id,
    sourceFieldId: fields.amount.id, agg: "sum", timeFilter: "all",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Total Workouts",
    goalLabel: "Fitness Stats", goalFieldId: fields.totalWorkouts.id,
    agg: "countTrue", timeFilter: "all",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Total Reading Time",
    goalLabel: "Reading Stats", goalFieldId: fields.totalReadingTime.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "all",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Completion Rate",
    goalLabel: "Productivity", goalFieldId: fields.completionRate.id,
    agg: "completionRate", timeFilter: "all",
  })).save();

  // ── WEEKLY SUMMARY ──
  // Legacy "Time Spent This Week" reused the totalDuration display field. In the
  // live port totalDuration is bound by both "Intellectual Growth" (daily, above)
  // and "Productivity" (productivityAccount order 1). Targeting "Productivity"
  // here keeps the weekly value off the daily "Intellectual Growth" tile so the
  // two don't clobber each other. KNOWN LIMITATION (Task 13 rule 4):
  // makeTrackerOp's weekly loop gate uses real SAME_WEEK, but the per-event
  // trigger date sub-rule stays SAME_DAY — onLoad/Nav bulk triggers self-heal.
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Time Spent This Week",
    goalLabel: "Productivity", goalFieldId: fields.totalDuration.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "weekly",
  })).save();

  // ── Tracker: Movies Watched ────────────────────────────────────────────────
  // Custom string-building pipeline (not makeTrackerOp — that's numeric only).
  // Trigger surface mirrors Water Today + Tasks Completed Today for parity.
  // Pipeline: FIND "Movies Watched" goal instance → resolve $goalDate → FIND
  // Schedule page → LOOP $allInstances for Watch Movie occs dated $goalDate →
  // inner LOOP over moviesWatched array (occurrence IDs) → resolve each movie
  // label → concat to $output → UPDATE display field on the goal item.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Movies Watched",
    description: "Build a label list of movies watched today and update the Movies Watched goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: moviesWatchedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Movies Watched goal instance
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Movies Watched" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalDate from the goal item's effective filter
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Init output accumulator
        { type: "action", action: "INIT_VAR", cfg: { name: "$output", expr: "literal:" } },
        // 5. Find the Schedule page (needed for HAS_ANCESTOR)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 6. Loop over Watch Movie occurrences dated to $goalDate and under the Schedule page
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
                  { left: `$watchInst.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                  { left: "$watchInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$watchInst.label", comparator: "IS", right: "Watch Movie" },
                ],
              },
              then: [
                // 6a. Inner loop: iterate the moviesWatched array (array of occurrence IDs)
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
                    // Append label to $output when found
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: "$movieId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "SET_VAR",
                          cfg: { name: "$output", expr: "${$output}${$movie.label}, " },
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
        // 7. Write the joined label string to the text display field on the goal item.
        // NOTE: $output accumulates as "Inception, The Matrix, " — trailing ", " is acceptable for v1.
        {
          type: "action", action: "UPDATE",
          cfg: { path: `$goalItemId.fields.${moviesWatchedDisplayFieldId}.value`, value: "$output" },
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Books Read ────────────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for books.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Books Read",
    description: "Build a label list of books read today and update the Books Read goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: booksReadFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Books Read goal instance
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Books Read" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalDate from the goal item's effective filter
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Init output accumulator as an empty array (rows for the multi-dim display)
        { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
        // 5. Find the Schedule page (needed for HAS_ANCESTOR)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 6. Loop over Reading occurrences dated to $goalDate and under the Schedule page
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
                  { left: `$readInst.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                  { left: "$readInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$readInst.label", comparator: "IS", right: "Reading" },
                ],
              },
              then: [
                // 6a. Inner loop: iterate the booksRead array (array of occurrence IDs)
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
                    // Push a row { label, pages } when found
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: "$bookId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "PUSH_TO_ARRAY",
                          cfg: {
                            name: "$rows",
                            value: {
                              label: "$book.label",
                              pages: `$book.fields.${pagesFieldId}.value`,
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
        // 7. Write the array of rows to the display field on the goal item.
        {
          type: "action", action: "UPDATE",
          cfg: { path: `$goalItemId.fields.${booksReadDisplayFieldId}.value`, value: "$rows" },
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Podcasts Listened ─────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for podcasts.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Podcasts Listened",
    description: "Build a label list of podcasts listened today and update the Podcasts Listened goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: podcastsListenedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Podcasts Listened goal instance
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Podcasts Listened" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalDate from the goal item's effective filter
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Init output accumulator
        { type: "action", action: "INIT_VAR", cfg: { name: "$output", expr: "literal:" } },
        // 5. Find the Schedule page (needed for HAS_ANCESTOR)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 6. Loop over Listen to Podcast occurrences dated to $goalDate and under the Schedule page
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
                  { left: `$podcastInst.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                  { left: "$podcastInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$podcastInst.label", comparator: "IS", right: "Listen to Podcast" },
                ],
              },
              then: [
                // 6a. Inner loop: iterate the podcastsListened array (array of occurrence IDs)
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
                    // Append label to $output when found
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: "$podcastId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "SET_VAR",
                          cfg: { name: "$output", expr: "${$output}${$podcast.label}, " },
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
        // 7. Write the joined label string to the text display field on the goal item.
        {
          type: "action", action: "UPDATE",
          cfg: { path: `$goalItemId.fields.${podcastsListenedDisplayFieldId}.value`, value: "$output" },
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Courses Taken ─────────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for courses.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Courses Taken",
    description: "Build a label list of courses taken today and update the Courses Taken goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: coursesTakenFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Courses Taken goal instance
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Courses Taken" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Bail if goal not found
        {
          type: "if",
          condition: { conjunction: "AND", rules: [{ left: "$goalItemId", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "INIT_VAR", cfg: { name: "$earlyExit", expr: "true" } }],
          else: [],
        },
        // 3. Resolve $goalDate from the goal item's effective filter
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Init output accumulator
        { type: "action", action: "INIT_VAR", cfg: { name: "$output", expr: "literal:" } },
        // 5. Find the Schedule page (needed for HAS_ANCESTOR)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 6. Loop over Online Course occurrences dated to $goalDate and under the Schedule page
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
                  { left: `$courseInst.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$goalDate" },
                  { left: "$courseInst._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                  { left: "$courseInst.label", comparator: "IS", right: "Online Course" },
                ],
              },
              then: [
                // 6a. Inner loop: iterate the coursesTaken array (array of occurrence IDs)
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
                    // Append label to $output when found
                    {
                      type: "if",
                      condition: { conjunction: "AND", rules: [{ left: "$courseId", comparator: "IS_NOT_EMPTY", right: "" }] },
                      then: [
                        {
                          type: "action", action: "SET_VAR",
                          cfg: { name: "$output", expr: "${$output}${$course.label}, " },
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
        // 7. Write the joined label string to the text display field on the goal item.
        {
          type: "action", action: "UPDATE",
          cfg: { path: `$goalItemId.fields.${coursesTakenDisplayFieldId}.value`, value: "$output" },
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
    id: uid(), userId, gridId, priority: 3,
    name: "Daily Question Rotator",
    description: "Pick today's reflection question from the library and write it to the Daily Journal's journalQuestion display field.",
    triggerTypes: ["onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Toolkit", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule page (for HAS_ANCESTOR on journaling instance lookup)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
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
        // 5. Find the Daily Journal instance dated to today under Schedule
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: {
              conjunction: "AND",
              rules: [
                { left: "label", comparator: "IS", right: "Daily Journal" },
                { left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$today" },
                { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
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

  // ── Shared schedule + day-page operations (delegated to liveSystemBuilders) ──
  await new Operation(makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId })).save();
  await new Operation(makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar: panelOccIds.notebook })).save();
  await new Operation(makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, hubPanelModuleId: panelModuleIds.notebook })).save();
  await new Operation(makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId })).save();

  return {
    gridId,
    gridName,
    fields,
    instanceMods,
    containerMods,
    // Occurrence id maps — consumed by Tasks 10–13
    toolkitContOccIds,   // contModKey → containerOccId for toolkit containers
    todoContOccIds,      // contModKey → containerOccId for todo containers
    goalContOccIds,      // contModKey → containerOccId for goal containers
    accountContOccIds,   // contModKey → containerOccId for account containers
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
    canvasPageOccId,
    toolkitPageOccId,
    todoPageOccId,
    goalsPageOccId,
    accountsPageOccId,
    // Notebook hub View id (activeOccurrenceId = schedPageOccId)
    notebookHubViewId,
  };
}

async function main() {
  const targetEmail = process.argv[2] || DEFAULT_USER_EMAIL;
  console.log(`🔄 Creating live data grid for ${targetEmail}...\n`);
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected\n");

    const user = await User.findOne({ email: targetEmail });
    if (!user) throw new Error(`User not found: ${targetEmail}`);
    const userId = user._id.toString();
    console.log(`✅ Found user: ${userId}\n`);

    const dropped = await dropExistingLiveGrid(userId);
    console.log(dropped
      ? `🗑️  Dropped existing "${DEFAULT_GRID_NAME}" + scoped data\n`
      : `🆕 No existing "${DEFAULT_GRID_NAME}" to drop\n`);

    const result = await createLiveData(userId);

    const fieldCount     = Object.keys(result.fields || {}).length;
    const instanceCount  = Object.keys(result.instanceMods || {}).length;
    const containerCount = Object.keys(result.containerMods || {}).length;
    const tkContOccs     = Object.keys(result.toolkitContOccIds || {}).length;
    const tdContOccs     = Object.keys(result.todoContOccIds || {}).length;
    const glContOccs     = Object.keys(result.goalContOccIds || {}).length;
    const acContOccs     = Object.keys(result.accountContOccIds || {}).length;
    const totalContOccs  = tkContOccs + tdContOccs + glContOccs + acContOccs;
    const notebookCount  = Object.keys(result.notebookDocOccIds || {}).length;
    console.log("=".repeat(50));
    console.log("Live Grid created!");
    console.log(`   Grid ID:        ${result.gridId}`);
    console.log(`   Grid Name:      ${result.gridName}`);
    console.log(`   Fields:         ${fieldCount}`);
    console.log(`   Inst modules:   ${instanceCount}`);
    console.log(`   Cont modules:   ${containerCount} (no slot containers)`);
    console.log(`   Container occs: ${totalContOccs} (${tkContOccs} toolkit, ${tdContOccs} todo, ${glContOccs} goal, ${acContOccs} account)`);
    console.log(`   Notebook docs:  ${notebookCount} (${Object.keys(result.notebookDocOccIds || {}).join(", ")})`);
    console.log(`   Folders:        Root + 5 children (Tasks/Trackers/Interfaces/Notes/Day Pages)`);
    console.log(`   Templates:      Daily Routine (6-pick) + Day Page under Templates manifest`);
    console.log(`   Operations:     24 (19 trackers + 1 daily question rotator + 4 schedule/day-page)`);
    console.log(`   Panels:         ${Object.keys(result.panelOccIds || {}).join(", ")}`);
    console.log(`   Pages:          Daily Toolkit, Todo List, Daily Goals, Accounts, Schedule (board) + Canvas`);
    console.log(`   Notebook hub:   View ${result.notebookHubViewId} active=Schedule (${result.schedPageOccId}); tabs=[Schedule, Canvas]`);
    console.log("=".repeat(50));
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
