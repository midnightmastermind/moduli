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
  //   journalQuestionPool   — pool source for journalQuestion only; no toolkit/todo use
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
  //   mealCategory, accountSelect, category, listType excluded, watchlist, readingList).
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
    watchlist: {
      id: uid(),
      name: "Watchlist",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        quickAdd: true,
        removeOnComplete: true,
        randomize: true,
        options: [
          { value: "inception",      label: "Inception" },
          { value: "interstellar",   label: "Interstellar" },
          { value: "the_matrix",     label: "The Matrix" },
          { value: "blade_runner",   label: "Blade Runner 2049" },
          { value: "dune",           label: "Dune" },
          { value: "the_godfather",  label: "The Godfather" },
          { value: "parasite",       label: "Parasite" },
          { value: "oppenheimer",    label: "Oppenheimer" },
        ],
      },
    },
    readingList: {
      id: uid(),
      name: "Reading List",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        quickAdd: true,
        removeOnComplete: true,
        randomize: true,
        options: [
          { value: "atomic_habits",        label: "Atomic Habits" },
          { value: "deep_work",            label: "Deep Work" },
          { value: "thinking_fast_slow",   label: "Thinking, Fast and Slow" },
          { value: "4_hour_workweek",      label: "The 4-Hour Workweek" },
          { value: "mans_search",          label: "Man's Search for Meaning" },
          { value: "meditations",          label: "Meditations" },
          { value: "sapiens",              label: "Sapiens" },
        ],
      },
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
    movieTitle: {
      id: uid(),
      name: "Movie",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Movie title..." },
    },
    bookTitle: {
      id: uid(),
      name: "Book",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Book title..." },
    },
    podcastTitle: {
      id: uid(),
      name: "Podcast",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Podcast name..." },
    },
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
    // siblingLinks not wired — journalQuestionPool excluded, no CYCLE_FIELD_VALUE op in live grid
    journalQuestion: {
      id: uid(),
      name: "Daily Question",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
    },
    journalAnswer: {
      id: uid(),
      name: "Answer",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Write your answer..." },
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
  //   wentWellQInstances    — journal Q&A question pool
  //   improvedQInstances    — same
  //   gratitudeQInstances   — same
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
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.readingList.id, role: "input", order: 1 },
        { fieldId: fields.duration.id, role: "input", order: 2 },
        { fieldId: fields.pages.id, role: "input", order: 3 },
      ],
    },
    podcast: {
      id: uid(), label: "Listen to Podcast", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.podcastTitle.id, role: "input", order: 1 },
        { fieldId: fields.duration.id, role: "input", order: 2 },
      ],
    },
    watchMovie: {
      id: uid(), label: "Watch Movie", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.watchlist.id, role: "input", order: 1 },
        { fieldId: fields.duration.id, role: "input", order: 2 },
      ],
    },
    onlineCourse: {
      id: uid(), label: "Online Course", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
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

  // ── Goal containers (8 dimensions + workout + nutrition + planning) ───────────
  const goalContainerMods = {
    physicalGoal:      { id: uid(), label: "Physical",      styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    intellectualGoal:  { id: uid(), label: "Intellectual",  styleMode: "own", ownStyle: { bg: "#1562b0" } },
    emotionalGoal:     { id: uid(), label: "Emotional",     styleMode: "own", ownStyle: { bg: "#a02158" } },
    socialGoal:        { id: uid(), label: "Social",        styleMode: "own", ownStyle: { bg: "#c49000" } },
    spiritualGoal:     { id: uid(), label: "Spiritual",     styleMode: "own", ownStyle: { bg: "#6427c5" } },
    occupationalGoal:  { id: uid(), label: "Occupational",  styleMode: "own", ownStyle: { bg: "#0d7a52" } },
    financialGoal:     { id: uid(), label: "Financial",     styleMode: "own", ownStyle: { bg: "#1d8a30" } },
    environmentalGoal: { id: uid(), label: "Environmental", styleMode: "own", ownStyle: { bg: "#0779a0" } },
    workoutGoal:    { id: uid(), label: "Workout" },
    nutritionGoal:  { id: uid(), label: "Nutrition" },
    planningGoal:   { id: uid(), label: "Planning" },
  };

  // ── Account containers (5 lifetime-aggregation categories) ───────────────────
  const accountContainerMods = {
    financeAccount:      { id: uid(), label: "Finances" },
    fitnessAccount:      { id: uid(), label: "Fitness" },
    learningAccount:     { id: uid(), label: "Learning" },
    productivityAccount: { id: uid(), label: "Productivity" },
    wellnessAccount:     { id: uid(), label: "Wellness" },
  };

  // ── Merge + persist container modules ────────────────────────────────────────
  const containerMods = {
    ...toolkitContainerMods,
    ...todoContainerMods,
    ...goalContainerMods,
    ...accountContainerMods,
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

  // ── Create toolkit instance occurrences + container occurrences ────────────
  const toolkitContOccIds = {}; // contModKey → containerOccId (exposed for later tasks)

  for (const [key, { contOccId, contModKey, instKeys }] of Object.entries(toolkitMappings)) {
    const childOccIds = [];
    for (let i = 0; i < instKeys.length; i++) {
      const instKey = instKeys[i];
      const inst = instanceMods[instKey];
      // Pre-fill default field values from instance meta (mirrors createDefaultUserData)
      const defaultFields = {};
      if (inst.meta?.defaultMuscleGroup) defaultFields[fields.muscleGroup.id] = fv(inst.meta.defaultMuscleGroup, "replace");
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
      // Pre-fill due date for planning instances
      const dueDatePreFill = planningDueDates[instKey]
        ? { [fields.due.id]: fv(planningDueDates[instKey].toISOString(), "replace") }
        : {};
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

  // ── STEP 7: Manifest + folder tree ──────────────────────────────────────────
  //
  // Structure (mirrors createTestGrid STEP 7):
  //   Root (normal)
  //   ├── Tasks      (normal, sortOrder: 0)  ← Daily Toolkit + Todo pages (Task 12)
  //   ├── Trackers   (normal, sortOrder: 1)  ← Daily Goals + Accounts pages (Task 12)
  //   ├── Interfaces (normal, sortOrder: 2)  ← Schedule + Canvas pages (Task 12)
  //   ├── Notes      (normal, sortOrder: 3)  ← Notebook docs (Task 11)
  //   └── Day Pages  (day-pages, sortOrder: 4) ← auto-created by Day Page: Build op (Task 13)
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
    console.log(`   Panels:         ${Object.keys(result.panelOccIds || {}).join(", ")}`);
    console.log(`   Pages:          Daily Toolkit, Todo List, Daily Goals, Accounts, Schedule (board) + Canvas`);
    console.log(`   Notebook hub:   View ${result.notebookHubViewId} active=Schedule (${result.schedPageOccId}); tabs=[Schedule, Canvas]`);
    console.log("=".repeat(50));
    console.log("Note: ops added in Tasks 13–14.");
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
