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
import { dirname, resolve } from "path";

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
import { buildGridDoc, buildScheduleFilters } from "../utils/liveSystemBuilders.js";

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
  //   dueFieldId       ← fields.dueDate ("Due", date)      [createDefaultUserData uid()→ override to dueFieldId]
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

  // ── (Future steps go here — Tasks 8–14 add modules, occurrences,
  //    manifest + folders, templates, pages, operations, and finalize the grid)

  return {
    gridId,
    gridName,
    fields,
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

    const fieldCount = Object.keys(result.fields || {}).length;
    console.log("=".repeat(50));
    console.log("✅ Live Grid created!");
    console.log(`   Grid ID:   ${result.gridId}`);
    console.log(`   Grid Name: ${result.gridName}`);
    console.log(`   Fields:    ${fieldCount}`);
    console.log("=".repeat(50));
    console.log("Note: instances/pages/ops added in Tasks 8–14.");
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
