// utils/createDefaultUserData.js
// ============================================================
// FROZEN 2026-04-27 — Operations in this file reference the legacy action
// vocabulary (FIND_OCCURRENCE, FIND_MODULE, CREATE_OCCURRENCE_FOR_MODULE,
// CREATE_MODULE, MOVE_OCCURRENCE_TO_PARENT, LINK_OCCURRENCE_TO_PARENT,
// SET_FIELD_VALUE, SHOW_VALUE, COMPUTE_TEXTMAP_FROM_TEMPLATE,
// FILL_FROM_TEMPLATE) and will not run after the unified-verbs migration.
// Kept for future reference / data shape only. Re-activating requires
// rewriting all operations to FIND / CREATE / UPDATE / DELETE and
// passing `itemId` to every operationBuilders helper that emits a
// display write (now `UPDATE { path: "$display.<fieldId>.<itemId>" }`).
// ============================================================
// Creates comprehensive default grid showcasing all field capabilities
//
// LAYOUT (3x2 grid):
// | Daily Toolkit | Schedule/Notebook/Freepad | Daily Goals |
// | Todo List     | Schedule/Notebook/Freepad | Accounts    |
//
// Panels:
// 1. Daily Toolkit - 8 wellness dimensions with copy-mode instances
// 2. Todo List - One-off tasks with move-mode instances
// 3. Schedule - 48 time slots (30 min increments)
// 4. Daily Goals - 8 dimensions with derived/aggregate fields (daily targets)
// 5. Accounts - Lifetime aggregations using transactions (no targets)
// 6. Notebook - Notebook panel with daily journal (shares cell with Schedule)
// ============================================================

import { createProfileData } from "./createProfileData.js";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseSections, parseSectionsWithInstances } from "./mdParsers.js";
import { inlineToTipTap, makeDocContent, buildMergedDocTextmap, parseStanSections, makeNotebookContainerDocContent, wrapTextInBlocks } from "./docBuilders.js";
import { uid, makeLoopSumOp, makeLoopCountOp, makeLoopCountTrueOp, makeLoopLastOp, makeLoopMultiSumOp, makeNetBalanceOp, makeCompletionRateOp, makeLiteralOp, generateTimeSlots } from "./operationBuilders.js";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";
import Folder from "../models/Folder.js";
import Operation from "../models/Operation.js";

const __mdFilename = fileURLToPath(import.meta.url);
const __mdDirname = dirname(__mdFilename);
const ROOT_DIR_MD = join(__mdDirname, "../../docs/"); // moduli/docs/ — source markdown files

/**
 * Creates a complete default grid with 4 panels showcasing all capabilities
 */
export async function createDefaultUserData(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  // ===================================================================
  // STEP 0: Create Grid FIRST (to get gridId for all entities)
  // ===================================================================

  // Pre-generate date field ID so we can reference it in named filters before fields are saved
  const dateFieldId = uid();

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const grid = new Grid({
    userId,
    rows: 2,
    cols: 3,
    namedFilters: [
      {
        id: "filter_daily",
        name: "Daily",
        conditions: [{ fieldId: dateFieldId, comparator: "SAME_DAY", isNav: true }],
        timeScale: "daily",
        timeUnit: "day",
      },
      {
        id: "filter_weekly",
        name: "Weekly",
        conditions: [{ fieldId: dateFieldId, comparator: "SAME_WEEK", isNav: true }],
        timeScale: "weekly",
        timeUnit: "week",
      },
      {
        id: "filter_all",
        name: "All",
        conditions: [],
        timeScale: null,
        timeUnit: "day",
      },
    ],
    activeFilterId: "filter_daily",
    activeFilterValues: { [dateFieldId]: today.toISOString().slice(0, 10) },
    templates: [],
    occurrences: [],
  });

  await grid.save();
  const gridId = grid._id.toString();

  // ===================================================================
  // STEP 0b: Create User Manifest for pages
  // Global folder = page library (all page modules live here).
  // Panel-local pages are just occurrences in panelOcc.occurrences[].
  // ===================================================================
  const userManifestRootFolderId = uid();
  const userManifestId = uid();
  // Pre-generate centerHub view ID + first page occ ID so they can be referenced before creation
  const centerHubViewId = uid();
  const schedPageOccId = uid();

  // Sub-folder IDs for the user manifest (organize pages into folders)
  const dayPagesFolderId = uid();
  const trackingFolderId = uid();  // "Trackers" folder (was Tracking)
  const drawingFolderId = uid();   // "Drawing" folder (new, replaces Tasks)

  await new Folder({ id: userManifestRootFolderId, userId, gridId, parentId: null, name: "Root", folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: dayPagesFolderId, userId, gridId, parentId: userManifestRootFolderId, name: "Day Pages", folderType: "day-pages", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: trackingFolderId, userId, gridId, parentId: userManifestRootFolderId, name: "Trackers", folderType: "normal", sortOrder: 1, isExpanded: false }).save();
  await new Folder({ id: drawingFolderId, userId, gridId, parentId: userManifestRootFolderId, name: "Drawing", folderType: "normal", sortOrder: 2, isExpanded: false }).save();
  await new Manifest({ id: userManifestId, userId, name: "Pages", manifestType: "user", rootFolderId: userManifestRootFolderId }).save();
  await Grid.findByIdAndUpdate(grid._id, { $set: { manifestId: userManifestId } });

  // ===================================================================
  // Category folder IDs — generated here so they can be referenced in field
  // definitions below. Actual Folder records are saved in STEP 6.
  // ===================================================================
  const fitnessFolderId = uid();
  const nutritionFolderId = uid();

  // Pre-generated pool container IDs — needed before fields so field meta can reference them
  const moviePoolId      = uid();
  const tvShowPoolId     = uid();
  const booksPoolId      = uid();
  const musicPoolId      = uid();
  const podcastsPoolId   = uid();
  const gamesPoolId      = uid();
  const activitiesPoolId = uid();
  const roomsPoolId      = uid();
  const cbtPoolId        = uid();
  const bookmarksPoolId  = uid();
  // Pre-generated question pool IDs — needed before fields so field meta can reference them
  const wentWellQPoolId  = uid();
  const improvedQPoolId  = uid();
  const gratitudeQPoolId = uid();
  // Pre-generate ID for special doc containers that need stable references
  const macroRefId     = uid(); // locked nutrition table doc

  // ===================================================================
  // STEP 1: Create Fields (now with gridId)
  // ===================================================================
  const fields = {
    // === INPUT FIELDS ===
    completed: {
      id: uid(),
      name: "Completed",
      type: "boolean",
      inputEnabled: true,
      displayEnabled: false,
      meta: { variant: "switch", defaultValue: false },
    },
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
          { value: "joyful", label: "Joyful" },
          { value: "happy", label: "Happy" },
          { value: "content", label: "Content" },
          { value: "cheerful", label: "Cheerful" },
          { value: "proud", label: "Proud" },
          { value: "optimistic", label: "Optimistic" },
          { value: "playful", label: "Playful" },
          { value: "excited", label: "Excited" },
          // Trust family
          { value: "trusting", label: "Trusting" },
          { value: "accepting", label: "Accepting" },
          { value: "peaceful", label: "Peaceful" },
          { value: "serene", label: "Serene" },
          { value: "grateful", label: "Grateful" },
          // Fear family
          { value: "anxious", label: "Anxious" },
          { value: "scared", label: "Scared" },
          { value: "worried", label: "Worried" },
          { value: "nervous", label: "Nervous" },
          { value: "insecure", label: "Insecure" },
          // Surprise family
          { value: "surprised", label: "Surprised" },
          { value: "amazed", label: "Amazed" },
          { value: "confused", label: "Confused" },
          { value: "stunned", label: "Stunned" },
          // Sadness family
          { value: "sad", label: "Sad" },
          { value: "lonely", label: "Lonely" },
          { value: "disappointed", label: "Disappointed" },
          { value: "depressed", label: "Depressed" },
          { value: "hopeless", label: "Hopeless" },
          { value: "guilty", label: "Guilty" },
          // Disgust family
          { value: "disgusted", label: "Disgusted" },
          { value: "disapproving", label: "Disapproving" },
          { value: "bored", label: "Bored" },
          // Anger family
          { value: "angry", label: "Angry" },
          { value: "frustrated", label: "Frustrated" },
          { value: "irritated", label: "Irritated" },
          { value: "annoyed", label: "Annoyed" },
          { value: "resentful", label: "Resentful" },
          { value: "jealous", label: "Jealous" },
          // Anticipation family
          { value: "anticipating", label: "Anticipating" },
          { value: "interested", label: "Interested" },
          { value: "curious", label: "Curious" },
          { value: "eager", label: "Eager" },
          // Neutral/Other
          { value: "neutral", label: "Neutral" },
          { value: "tired", label: "Tired" },
          { value: "stressed", label: "Stressed" },
          { value: "overwhelmed", label: "Overwhelmed" },
          { value: "calm", label: "Calm" },
          { value: "focused", label: "Focused" },
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
    dueDate: {
      id: uid(),
      name: "Due",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
      meta: {},
    },
    date: {
      id: dateFieldId,
      name: "Date",
      type: "date",
      inputEnabled: true,
      displayEnabled: false,
    },
    timeslot: {
      id: uid(),
      name: "Time Slot",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
    },
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
    listType: {
      id: uid(),
      name: "List",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        options: [
          { value: "movies",     label: "Movies" },
          { value: "tvshows",    label: "TV Shows" },
          { value: "books",      label: "Books" },
          { value: "music",      label: "Music" },
          { value: "podcasts",   label: "Podcasts" },
          { value: "games",      label: "Games" },
          { value: "activities", label: "Activities" },
          { value: "rooms",      label: "Rooms" },
          { value: "cbt",        label: "CBT Skills" },
          { value: "bookmarks",  label: "Bookmarks" },
        ],
      },
    },
    watchItem: {
      id: uid(),
      name: "Title",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerIds: [moviePoolId, tvShowPoolId] },
    },
    readItem: {
      id: uid(),
      name: "Title",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerId: booksPoolId },
    },
    listenItem: {
      id: uid(),
      name: "Title",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerIds: [musicPoolId, podcastsPoolId] },
    },
    playItem: {
      id: uid(),
      name: "Title",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerIds: [gamesPoolId, activitiesPoolId] },
    },
    roomItem: {
      id: uid(),
      name: "Room",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerId: roomsPoolId },
    },
    cbtItem: {
      id: uid(),
      name: "Skill",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerId: cbtPoolId },
    },
    bookmarkItem: {
      id: uid(),
      name: "Link",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: { multiSelect: true, sourceType: "pool", poolContainerId: bookmarksPoolId },
    },

    // === TEXT INPUT FIELDS (for specific tracking) ===
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

    // === SELECT FIELDS (lists with removeOnComplete) ===
    watchlist: {
      id: uid(),
      name: "Watchlist",          // was "Movie" — distinct from movieTitle text field "Movie"
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        quickAdd: true,  // Allows typing a custom movie not in the list
        removeOnComplete: true,
        randomize: true,
        options: [
          { value: "inception", label: "Inception" },
          { value: "interstellar", label: "Interstellar" },
          { value: "the_matrix", label: "The Matrix" },
          { value: "blade_runner", label: "Blade Runner 2049" },
          { value: "dune", label: "Dune" },
          { value: "the_godfather", label: "The Godfather" },
          { value: "parasite", label: "Parasite" },
          { value: "oppenheimer", label: "Oppenheimer" },
        ],
      },
    },
    readingList: {
      id: uid(),
      name: "Reading List",       // was "Book" — distinct from bookTitle text field "Book"
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        multiSelect: true,
        quickAdd: true,  // Allows typing a custom book not in the list
        removeOnComplete: true,
        randomize: true,
        options: [
          { value: "atomic_habits", label: "Atomic Habits" },
          { value: "deep_work", label: "Deep Work" },
          { value: "thinking_fast_slow", label: "Thinking, Fast and Slow" },
          { value: "4_hour_workweek", label: "The 4-Hour Workweek" },
          { value: "mans_search", label: "Man's Search for Meaning" },
          { value: "meditations", label: "Meditations" },
          { value: "sapiens", label: "Sapiens" },
        ],
      },
    },

    // === JOURNAL Q&A FIELDS ===
    // journalQuestionPool is the select field holding all possible questions.
    // journalQuestion is a derived field that auto-cycles through the pool
    // based on the current iteration date (one question per day).
    journalQuestionPool: {
      id: uid(),
      name: "Question Pool",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        options: [
          { value: "q1", label: "What are you most grateful for today?" },
          { value: "q2", label: "What's one thing you want to accomplish?" },
          { value: "q3", label: "What's been on your mind lately?" },
          { value: "q4", label: "What made you smile today?" },
          { value: "q5", label: "What lesson did you learn recently?" },
          { value: "q6", label: "Who do you want to connect with this week?" },
          { value: "q7", label: "What habit are you trying to build?" },
          { value: "q8", label: "What would make today great?" },
          { value: "q9", label: "What are you avoiding that you should face?" },
          { value: "q10", label: "What's one kind thing you can do for yourself?" },
        ],
      },
    },
    journalQuestion: {
      id: uid(),
      name: "Daily Question",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      siblingLinks: [], // Will be linked to journalQuestionPool after creation
    },
    journalAnswer: {
      id: uid(),
      name: "Answer",
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Write your answer..." },
      siblingLinks: [], // Will be linked to journalQuestion after creation
    },

    // === EVENING REFLECTION Q&A FIELDS (markdown — attached to container header/body) ===
    // question fields are attached to the container header, answer fields to the body.
    // Pool containers (wentWellQPool etc.) hold question instances; operations pick one randomly onLoad each day.
    wentWellQuestion: {
      id: uid(),
      name: "Question",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Type your question..." },
    },
    wentWellAnswer: {
      id: uid(),
      name: "Answer",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "What went well today?", rows: 4 },
    },
    improvedQuestion: {
      id: uid(),
      name: "Question",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Type your question..." },
    },
    improvedAnswer: {
      id: uid(),
      name: "Answer",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "What could be improved?", rows: 4 },
    },
    gratitudeQuestion: {
      id: uid(),
      name: "Question",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "Type your question..." },
    },
    gratitudeAnswer: {
      id: uid(),
      name: "Answer",
      type: "markdown",
      inputEnabled: true,
      displayEnabled: false,
      meta: { placeholder: "What are you grateful for?", rows: 4 },
    },
    // === FINANCIAL: Account select field ===
    accountSelect: {
      id: uid(),
      name: "Account",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,
      meta: {
        options: [
          { value: "checking", label: "Checking" },
          { value: "savings", label: "Savings" },
          { value: "moms", label: "Mom's Account" },
        ],
      },
    },

    // === DISPLAY FIELDS (for Daily Goals — written by operations) ===
    totalCompleted: {
      id: uid(),
      name: "Tasks Completed",    // was "Completed" — distinct from input boolean "Completed"
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
      name: "Daily Steps",        // was "Steps" — distinct from input "Steps"
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { postfix: " steps" },
      displayConfig: {},
    },
    totalWater: {
      id: uid(),
      name: "Daily Water",        // was "Water" — distinct from input "Water"
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
      name: "Pages Read Today",   // was "Pages Read" — distinct from input "Pages"
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

    // === ACCOUNT DISPLAY FIELDS (all-time aggregations) ===
    netBalance: {
      id: uid(),
      name: "Net Balance",
      type: "number",
      inputEnabled: false,
      displayEnabled: true,
      meta: { prefix: "$", postfix: "" },
      displayConfig: {},
    },
    // Mom's Account — will use conditional operation in Operations builder
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

    // === DUE DATE DISPLAY FIELDS ===
    daysUntilDue: {
      id: uid(), name: "Days Until Due", type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " days" },
      displayConfig: { showArrows: false },
    },
    overdueTasks: {
      id: uid(), name: "Overdue Tasks", type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " overdue" },
      displayConfig: {},
    },
    upcomingThisWeek: {
      id: uid(), name: "Due This Week", type: "number",
      inputEnabled: false, displayEnabled: true,
      meta: { postfix: " tasks" },
      displayConfig: {},
    },

    // === WORKOUT FIELDS ===
    // Tracks 3 sets of reps per exercise (e.g. Bench Press: 12/10/8)
    set1Reps: {
      id: uid(), name: "Set 1", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: fitnessFolderId,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    set2Reps: {
      id: uid(), name: "Set 2", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: fitnessFolderId,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    set3Reps: {
      id: uid(), name: "Set 3", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: fitnessFolderId,
      meta: { postfix: " reps", increment: 1, flow: "in" },
    },
    workoutWeight: {
      id: uid(), name: "Weight", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: fitnessFolderId,
      meta: { postfix: " lbs", increment: 5, flow: "in" },
    },
    muscleGroup: {
      id: uid(), name: "Muscle Group", type: "select", inputEnabled: true, displayEnabled: false,
      folderId: fitnessFolderId,
      meta: { options: [
        { value: "chest", label: "Chest" },
        { value: "back", label: "Back" },
        { value: "legs", label: "Legs" },
        { value: "shoulders", label: "Shoulders" },
        { value: "arms", label: "Arms" },
        { value: "cardio", label: "Cardio" },
        { value: "core", label: "Core" },
      ], multiple: false },
    },
    // Display field written by operation — total reps across all sets today
    totalRepsToday: {
      id: uid(), name: "Total Reps Today", type: "number", inputEnabled: false, displayEnabled: true,
      folderId: fitnessFolderId,
      meta: { postfix: " reps" },
      displayConfig: { showArrows: true, targetValue: 150, targetPeriod: "daily" },
    },

    // === NUTRITION FIELDS (Mediterranean diet, 34yr lean male 5'11") ===
    protein: {
      id: uid(), name: "Protein", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: nutritionFolderId,
      meta: { postfix: "g", increment: 5, flow: "in" },
    },
    carbs: {
      id: uid(), name: "Carbs", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: nutritionFolderId,
      meta: { postfix: "g", increment: 5, flow: "in" },
    },
    fats: {
      id: uid(), name: "Fats", type: "number", inputEnabled: true, displayEnabled: false,
      folderId: nutritionFolderId,
      meta: { postfix: "g", increment: 2, flow: "in" },
    },
    mealCategory: {
      id: uid(), name: "Meal Type", type: "select", inputEnabled: true, displayEnabled: false,
      folderId: nutritionFolderId,
      meta: { options: [
        { value: "Breakfast", label: "Breakfast" },
        { value: "Lunch", label: "Lunch" },
        { value: "Snack", label: "Snack" },
        { value: "Dinner", label: "Dinner" },
        { value: "Ingredient", label: "Ingredient" },
      ], multiple: false },
    },
    totalProtein: { id: uid(), name: "Protein Today", type: "number", inputEnabled: false, displayEnabled: true, folderId: nutritionFolderId, meta: { postfix: "g" }, displayConfig: {} },
    totalCarbs:   { id: uid(), name: "Carbs Today",   type: "number", inputEnabled: false, displayEnabled: true, folderId: nutritionFolderId, meta: { postfix: "g" }, displayConfig: {} },
    totalFats:    { id: uid(), name: "Fats Today",    type: "number", inputEnabled: false, displayEnabled: true, folderId: nutritionFolderId, meta: { postfix: "g" }, displayConfig: {} },

    // Category — hidden field used for iteration filtering
    category: {
      id: uid(),
      name: "Category",
      type: "select",
      inputEnabled: true,
      displayEnabled: false,  // Hidden — not shown in instance UI
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

    // Day Date — date field on day page occurrences; the operation queries this to find today's page
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

  // Save fields (with gridId)
  for (const key in fields) {
    const field = new Field({
      ...fields[key],
      userId,
      gridId,
    });
    await field.save();
  }

  // Register all field IDs on the grid
  const allFieldIds = Object.values(fields).map(f => f.id);
  await Grid.findByIdAndUpdate(grid._id, { $set: { fieldIds: allFieldIds } });

  // Wire Q&A siblingLinks
  await Field.findOneAndUpdate(
    { id: fields.journalQuestion.id },
    { $set: { siblingLinks: [fields.journalQuestionPool.id] } }
  );
  await Field.findOneAndUpdate(
    { id: fields.journalAnswer.id },
    { $set: { siblingLinks: [fields.journalQuestion.id] } }
  );

  // ===================================================================
  // STEP 1b: Create Operations for display fields
  // ===================================================================
  /** Create a per-occurrence date countdown operation (days until dueDate field value). */
  function makeCountdownOp({ name, dateFieldId, targetFieldId, folderId = null }) {
    return {
      id: uid(), userId, gridId,
      name,
      description: `Computes days until due date — writes per-occurrence to display field`,
      folderId,
      triggerType: "onNavigation",
      triggerTypes: ["onNavigation", "onChange", "onLoad"],
      triggerConfig: {
        onChange: { allowedFields: [dateFieldId] },
      },
      enabled: true,
      pipeline: {
        sources: [],
        steps: [{ id: uid(), type: "action", config: { type: "DATE_DIFF", dateFieldId, targetFieldId, perOccurrence: true } }],
      },
    };
  }

  const opArgs = { userId, gridId };
  const displayOperations = [
    // ── DAILY TASK / WELLNESS ──
    makeLoopCountTrueOp({ name: "Completed Today", targetFieldId: fields.totalCompleted.id, fieldId: fields.completed.id, timeFilter: "daily", ...opArgs }),
    makeLoopCountOp({ name: "Task Count Today", targetFieldId: fields.taskCount.id, fieldId: fields.completed.id, timeFilter: "daily", ...opArgs }),
    makeLoopLastOp({ name: "Latest Mood", targetFieldId: fields.lastMood.id, fieldId: fields.mood.id, timeFilter: "daily", ...opArgs }),

    // ── DAILY ACTIVITY ──
    makeLoopSumOp({ name: "Steps Today", targetFieldId: fields.totalSteps.id, fieldId: fields.steps.id, timeFilter: "daily", flowFilter: "any", targetValue: 10000, targetPeriod: "daily", ...opArgs }),
    makeLoopSumOp({ name: "Water Today", targetFieldId: fields.totalWater.id, fieldId: fields.water.id, timeFilter: "daily", flowFilter: "any", targetValue: 64, targetPeriod: "daily", ...opArgs }),
    makeLoopSumOp({ name: "Time Spent Today", targetFieldId: fields.totalDuration.id, fieldId: fields.duration.id, timeFilter: "daily", flowFilter: "any", targetValue: 120, targetPeriod: "daily", ...opArgs }),
    makeLoopSumOp({ name: "Pages Today", targetFieldId: fields.totalPages.id, fieldId: fields.pages.id, timeFilter: "daily", flowFilter: "any", targetValue: 30, targetPeriod: "daily", ...opArgs }),

    // ── DAILY FINANCE ──
    makeLoopSumOp({ name: "Spent Today", targetFieldId: fields.totalSpent.id, fieldId: fields.amount.id, timeFilter: "daily", flowFilter: "out", ...opArgs }),
    makeLoopSumOp({ name: "Earned Today", targetFieldId: fields.totalIncome.id, fieldId: fields.income.id, timeFilter: "daily", flowFilter: "in", ...opArgs }),

    // ── DAILY NUTRITION ──
    makeLoopSumOp({ name: "Calories Today", targetFieldId: fields.calories.id, fieldId: fields.calories.id, timeFilter: "daily", flowFilter: "any", targetValue: 2500, targetPeriod: "daily", folderId: nutritionFolderId, ...opArgs }),
    makeLoopSumOp({ name: "Protein Today", targetFieldId: fields.totalProtein.id, fieldId: fields.protein.id, timeFilter: "daily", flowFilter: "any", targetValue: 180, targetPeriod: "daily", folderId: nutritionFolderId, ...opArgs }),
    makeLoopSumOp({ name: "Carbs Today", targetFieldId: fields.totalCarbs.id, fieldId: fields.carbs.id, timeFilter: "daily", flowFilter: "any", targetValue: 280, targetPeriod: "daily", folderId: nutritionFolderId, ...opArgs }),
    makeLoopSumOp({ name: "Fats Today", targetFieldId: fields.totalFats.id, fieldId: fields.fats.id, timeFilter: "daily", flowFilter: "any", targetValue: 80, targetPeriod: "daily", folderId: nutritionFolderId, ...opArgs }),

    // ── DAILY WORKOUT (multi-source loop) ──
    makeLoopMultiSumOp({ name: "Total Reps Today", targetFieldId: fields.totalRepsToday.id, fieldIds: [fields.set1Reps.id, fields.set2Reps.id, fields.set3Reps.id], timeFilter: "daily", targetValue: 150, targetPeriod: "daily", folderId: fitnessFolderId, ...opArgs }),

    // ── ALL-TIME AGGREGATIONS ──
    makeNetBalanceOp({ name: "Net Balance", targetFieldId: fields.netBalance.id, incomeFieldId: fields.income.id, spentFieldId: fields.amount.id, ...opArgs }),
    makeLoopSumOp({ name: "Mom's Account Balance", targetFieldId: fields.momsAccountBalance.id, fieldId: fields.amount.id, timeFilter: "all", flowFilter: "any", ...opArgs }),
    makeLoopCountTrueOp({ name: "Total Workouts", targetFieldId: fields.totalWorkouts.id, fieldId: fields.completed.id, timeFilter: "all", ...opArgs }),
    makeLoopSumOp({ name: "Total Reading Time", targetFieldId: fields.totalReadingTime.id, fieldId: fields.duration.id, timeFilter: "all", flowFilter: "any", ...opArgs }),
    makeCompletionRateOp({ name: "Completion Rate", targetFieldId: fields.completionRate.id, fieldId: fields.completed.id, timeFilter: "all", ...opArgs }),

    // ── STATIC / LABEL ──
    // D5: Question cycling — rotate through journalQuestionPool options by day-of-year
    { id: uid(), userId, gridId, name: "Daily Question Cycle",
      description: "Cycles journalQuestion through the question pool based on day-of-year",
      triggerType: "onNavigation", triggerTypes: ["onNavigation", "onLoad"], triggerConfig: {}, enabled: true,
      pipeline: { sources: [], steps: [{ id: uid(), type: "action", config: { type: "CYCLE_FIELD_VALUE", sourceFieldId: fields.journalQuestionPool.id, targetFieldId: fields.journalQuestion.id } }] },
    },

    // ── DUE DATE / COUNTDOWN ──
    makeCountdownOp({ name: "Days Until Due", dateFieldId: fields.dueDate.id, targetFieldId: fields.daysUntilDue.id }),
    { id: uid(), userId, gridId, name: "Overdue Tasks Count",
      description: "Counts tasks with a dueDate that has already passed",
      triggerType: "onNavigation", triggerTypes: ["onNavigation", "onLoad"], triggerConfig: {}, enabled: true,
      pipeline: { sources: [], steps: [{ id: uid(), type: "action", config: { type: "COUNT_DATE_OVERDUE", dateFieldId: fields.dueDate.id, targetFieldId: fields.overdueTasks.id } }] },
    },
    { id: uid(), userId, gridId, name: "Due This Week",
      description: "Counts tasks with a dueDate within the next 7 days",
      triggerType: "onNavigation", triggerTypes: ["onNavigation", "onLoad"], triggerConfig: {}, enabled: true,
      pipeline: { sources: [], steps: [{ id: uid(), type: "action", config: { type: "COUNT_DATE_UPCOMING", dateFieldId: fields.dueDate.id, targetFieldId: fields.upcomingThisWeek.id, withinDays: 7 } }] },
    },

    // ── WEEKLY SUMMARIES (separate display fields so they don't overwrite daily values) ──
    makeLoopSumOp({ name: "Time Spent This Week", targetFieldId: fields.totalDuration.id, fieldId: fields.duration.id, timeFilter: "weekly", flowFilter: "any", targetValue: 840, targetPeriod: "weekly", ...opArgs }),
  ];

  for (const opData of displayOperations) {
    const op = new Operation(opData);
    await op.save();
  }

  // ── RECURRING TASK RESET OPERATIONS ──
  // Fires on onComplete (when "completed" field goes true) for recurring planning instances.
  // Resets completed = false and advances dueDate by recurrenceDays.
  const makeRecurringResetOp = ({ name, completionFieldId, dueDateFieldId, recurrenceDays }) => ({
    id: uid(), userId, gridId,
    name,
    description: `Auto-reset "${name}": clears completed and advances dueDate by ${recurrenceDays} days`,
    triggerType: "onComplete",
    triggerTypes: ["onComplete"],
    triggerConfig: { onComplete: { fieldId: completionFieldId } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [{
        id: uid(), type: "action",
        config: {
          type: "RESET_RECURRING_TASK",
          completionFieldId,
          dueDateFieldId,
          recurrenceDays,
        },
      }],
    },
  });

  const recurringResetOps = [
    makeRecurringResetOp({ name: "Doctor Checkup Reset", completionFieldId: fields.completed.id, dueDateFieldId: fields.dueDate.id, recurrenceDays: 365 }),
    makeRecurringResetOp({ name: "Car Insurance Renewal Reset", completionFieldId: fields.completed.id, dueDateFieldId: fields.dueDate.id, recurrenceDays: 365 }),
    makeRecurringResetOp({ name: "File Taxes Reset", completionFieldId: fields.completed.id, dueDateFieldId: fields.dueDate.id, recurrenceDays: 365 }),
    makeRecurringResetOp({ name: "Quarterly Review Reset", completionFieldId: fields.completed.id, dueDateFieldId: fields.dueDate.id, recurrenceDays: 90 }),
  ];

  for (const opData of recurringResetOps) {
    const op = new Operation(opData);
    await op.save();
  }

  // ===================================================================
  // STEP 2: Create Instances for Daily Toolkit (8 Dimensions)
  // ===================================================================
  const toolkitInstances = {
    // === PHYSICAL ===
    morningWorkout: {
      id: uid(), label: "Morning Workout", kind: "list",
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
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.steps.id, role: "input", order: 2 },
      ],
    },
    stretching: {
      id: uid(), label: "Stretching", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    drinkWater: {
      id: uid(), label: "Drink Water", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.water.id, role: "input", order: 1 },
      ],
    },
    takeMeds: {
      id: uid(), label: "Take Vitamins", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
      ],
    },
    sleepLog: {
      id: uid(), label: "Sleep Log", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.energy.id, role: "input", order: 2 },
      ],
    },

    // === INTELLECTUAL ===
    reading: {
      id: uid(), label: "Reading", kind: "list",
      styleMode: "own", ownStyle: { bg: "rgba(21,98,176,0.15)", textColor: "#4a9fe0" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.readingList.id, role: "input", order: 1 },  // Pick from list OR type custom
        { fieldId: fields.duration.id, role: "input", order: 2 },
        { fieldId: fields.pages.id, role: "input", order: 3 },
      ],
    },
    podcast: {
      id: uid(), label: "Listen to Podcast", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.podcastTitle.id, role: "input", order: 1 },
        { fieldId: fields.duration.id, role: "input", order: 2 },
      ],
    },
    watchMovie: {
      id: uid(), label: "Watch Movie", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.watchlist.id, role: "input", order: 1 },  // Pick from list OR type custom
        { fieldId: fields.duration.id, role: "input", order: 2 },
      ],
    },
    onlineCourse: {
      id: uid(), label: "Online Course", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    brainGames: {
      id: uid(), label: "Brain Games", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    journaling: {
      id: uid(), label: "Daily Journal", kind: "list",
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
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.mood.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    meditation: {
      id: uid(), label: "Meditation", kind: "list",
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
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    moodCheck: {
      id: uid(), label: "Mood Check-in", kind: "list",
      fieldBindings: [
        { fieldId: fields.mood.id, role: "input", order: 0 },
        { fieldId: fields.energy.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    selfCare: {
      id: uid(), label: "Self-Care Activity", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },

    // === SOCIAL ===
    callFriend: {
      id: uid(), label: "Call a Friend", kind: "list",
      styleMode: "own", ownStyle: { bg: "rgba(196,144,0,0.15)", textColor: "#e8c030" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    familyTime: {
      id: uid(), label: "Family Time", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    socialEvent: {
      id: uid(), label: "Social Event", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    helpSomeone: {
      id: uid(), label: "Help Someone", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },

    // === SPIRITUAL ===
    prayer: {
      id: uid(), label: "Prayer/Reflection", kind: "list",
      styleMode: "own", ownStyle: { bg: "rgba(100,39,197,0.15)", textColor: "#9b6eee" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    natureWalk: {
      id: uid(), label: "Nature Walk", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.steps.id, role: "input", order: 2 },
      ],
    },
    spiritualReading: {
      id: uid(), label: "Spiritual Reading", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.pages.id, role: "input", order: 2 },
      ],
    },
    mindfulness: {
      id: uid(), label: "Mindfulness", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },

    // === OCCUPATIONAL ===
    deepWork: {
      id: uid(), label: "Deep Work Session", kind: "list",
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
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    emailBlock: {
      id: uid(), label: "Email Block", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    skillDev: {
      id: uid(), label: "Skill Development", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    networking: {
      id: uid(), label: "Networking", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },

    // === FINANCIAL ===
    budgetReview: {
      id: uid(), label: "Budget Review", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    trackExpense: {
      id: uid(), label: "Track Expense", kind: "list",
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
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.accountSelect.id, role: "input", order: 1 },
        { fieldId: fields.amount.id, role: "input", order: 2 },
      ],
    },
    logIncome: {
      id: uid(), label: "Log Income", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.income.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    investmentCheck: {
      id: uid(), label: "Check Investments", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.income.id, role: "input", order: 1 },  // Track gains/losses
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    savingsGoal: {
      id: uid(), label: "Savings Goal", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },

    // === ENVIRONMENTAL ===
    cleanDesk: {
      id: uid(), label: "Clean Desk", kind: "list",
      styleMode: "own", ownStyle: { bg: "rgba(7,121,160,0.15)", textColor: "#32b4e0" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    declutter: {
      id: uid(), label: "Declutter Space", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    plantCare: {
      id: uid(), label: "Plant Care", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
      ],
    },
    recycling: {
      id: uid(), label: "Recycling", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
      ],
    },
    ecoAction: {
      id: uid(), label: "Eco-Friendly Action", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },
  };

  // === WORKOUT INSTANCES — 5 per muscle group × 6 groups = 30 ===
  function makeWorkout(label, group) {
    return {
      id: uid(), label, kind: "list",
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
    // Chest (target: 45 min/day)
    benchPress:     makeWorkout("Bench Press",        "Chest"),
    inclinePress:   makeWorkout("Incline Press",      "Chest"),
    chestFly:       makeWorkout("Chest Fly",          "Chest"),
    pushUps:        makeWorkout("Push-ups",           "Chest"),
    cableCrossover: makeWorkout("Cable Crossover",    "Chest"),
    // Back (target: 45 min/day)
    deadlift:       makeWorkout("Deadlift",           "Back"),
    pullUps:        makeWorkout("Pull-ups",           "Back"),
    bentRow:        makeWorkout("Bent-over Row",      "Back"),
    latPulldown:    makeWorkout("Lat Pulldown",       "Back"),
    seatedRow:      makeWorkout("Seated Cable Row",   "Back"),
    // Legs (target: 60 min/day)
    squat:          makeWorkout("Squat",              "Legs"),
    legPress:       makeWorkout("Leg Press",          "Legs"),
    lunges:         makeWorkout("Lunges",             "Legs"),
    legCurl:        makeWorkout("Leg Curl",           "Legs"),
    calfRaise:      makeWorkout("Calf Raise",         "Legs"),
    // Shoulders (target: 30 min/day)
    overheadPress:  makeWorkout("Overhead Press",     "Shoulders"),
    lateralRaise:   makeWorkout("Lateral Raise",      "Shoulders"),
    frontRaise:     makeWorkout("Front Raise",        "Shoulders"),
    facePull:       makeWorkout("Face Pull",          "Shoulders"),
    shrugs:         makeWorkout("Shrugs",             "Shoulders"),
    // Arms (target: 30 min/day)
    bicepCurl:      makeWorkout("Bicep Curl",         "Arms"),
    hammerCurl:     makeWorkout("Hammer Curl",        "Arms"),
    tricepDip:      makeWorkout("Tricep Dip",         "Arms"),
    skullCrusher:   makeWorkout("Skull Crusher",      "Arms"),
    tricepPushdown: makeWorkout("Tricep Pushdown",    "Arms"),
    // Cardio (target: 40 min/day)
    running:        makeWorkout("Running",            "Cardio"),
    cycling:        makeWorkout("Cycling",            "Cardio"),
    jumpRope:       makeWorkout("Jump Rope",          "Cardio"),
    rowMachine:     makeWorkout("Row Machine",        "Cardio"),
    burpees:        makeWorkout("Burpees",            "Cardio"),
  };

  // === NUTRITION INSTANCES — Mediterranean diet (34yr lean male 5'11") ===
  // Daily targets: 2500 cal, 180g protein, 280g carbs, 80g fats
  function makeNutrition(label, mealType, cal, prot, c, fat) {
    return {
      id: uid(), label, kind: "list",
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
    // Breakfast
    greekYogurtBowl:  makeNutrition("Greek Yogurt Bowl",       "Breakfast", 380, 28, 42, 8),
    scrambledEggs:    makeNutrition("Scrambled Eggs + Veg",    "Breakfast", 320, 24, 18, 16),
    oatmealBerries:   makeNutrition("Oatmeal + Berries",       "Breakfast", 350, 12, 62, 7),
    avocadoToast:     makeNutrition("Avocado Toast",           "Breakfast", 420, 14, 38, 22),
    smoothieBowl:     makeNutrition("Smoothie Bowl",           "Breakfast", 390, 18, 58, 10),
    // Lunch
    greekSaladChicken: makeNutrition("Greek Salad + Chicken",  "Lunch", 520, 48, 22, 24),
    tunaWrap:         makeNutrition("Tuna Wrap",               "Lunch", 460, 38, 42, 14),
    lentilSoup:       makeNutrition("Lentil Soup",             "Lunch", 340, 20, 52, 6),
    quinoaBowl:       makeNutrition("Quinoa Bowl",             "Lunch", 480, 22, 68, 12),
    hummusPita:       makeNutrition("Hummus + Whole Grain Pita", "Lunch", 380, 14, 52, 14),
    // Snacks
    almonds:          makeNutrition("Almonds (1oz)",           "Snack", 160, 6, 6, 14),
    olivesHummus:     makeNutrition("Olives + Hummus",         "Snack", 140, 4, 10, 10),
    cheeseCrackers:   makeNutrition("Cheese + Crackers",       "Snack", 180, 8, 16, 9),
    mixedBerries:     makeNutrition("Mixed Berries",           "Snack", 80, 1, 20, 0),
    proteinBar:       makeNutrition("Protein Bar",             "Snack", 220, 20, 24, 6),
    // Dinner
    grilledSalmon:    makeNutrition("Grilled Salmon",          "Dinner", 520, 52, 12, 28),
    chickenSouvlaki:  makeNutrition("Chicken Souvlaki",        "Dinner", 560, 56, 30, 22),
    lambKofta:        makeNutrition("Lamb Kofta",              "Dinner", 580, 44, 28, 32),
    pastaMarinara:    makeNutrition("Pasta Marinara",          "Dinner", 520, 22, 78, 12),
    stuffedPeppers:   makeNutrition("Stuffed Peppers",         "Dinner", 440, 30, 48, 14),
    // Ingredients
    oliveOil:         makeNutrition("Olive Oil (1 tbsp)",      "Ingredient", 120, 0, 0, 14),
    chickpeas:        makeNutrition("Chickpeas (1/2 cup)",     "Ingredient", 135, 7, 22, 2),
    lemonGarlic:      makeNutrition("Lemon + Garlic base",     "Ingredient", 20, 1, 4, 0),
    wholeGrainBread:  makeNutrition("Whole Grain Bread (2sl)", "Ingredient", 180, 8, 32, 3),
    greekOlives:      makeNutrition("Greek Olives (10pc)",     "Ingredient", 50, 0, 2, 5),
  };

  // === TODO LIST INSTANCES (organized by project/category) ===
  const todoInstances = {
    // --- Home & Errands ---
    buyGroceries: {
      id: uid(), label: "Buy groceries", kind: "list",
      fieldBindings: [
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    cleanGarage: {
      id: uid(), label: "Clean out garage", kind: "list",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    fixLeakyFaucet: {
      id: uid(), label: "Fix leaky faucet", kind: "list",
      fieldBindings: [
        { fieldId: fields.priority.id, role: "input", order: 1 },
      ],
    },
    returnBooks: {
      id: uid(), label: "Return library books", kind: "list",
      fieldBindings: [
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    organizePantry: {
      id: uid(), label: "Organize pantry", kind: "list",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    // --- Finance & Admin ---
    payBills: {
      id: uid(), label: "Pay utility bills", kind: "list",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.dueDate.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    cancelSub: {
      id: uid(), label: "Cancel unused subscription", kind: "list",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
    renewLicense: {
      id: uid(), label: "Renew driver's license", kind: "list",
      fieldBindings: [
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    dentistAppt: {
      id: uid(), label: "Schedule dentist appointment", kind: "list",
      fieldBindings: [
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    fileInsurance: {
      id: uid(), label: "File insurance claim", kind: "list",
      fieldBindings: [
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    // --- Work Projects ---
    orderSupplies: {
      id: uid(), label: "Order office supplies", kind: "list",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
    backupComputer: {
      id: uid(), label: "Backup computer files", kind: "list",
      fieldBindings: [
      ],
    },
    updatePortfolio: {
      id: uid(), label: "Update portfolio site", kind: "list",
      fieldBindings: [
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    prepPresentation: {
      id: uid(), label: "Prep client presentation", kind: "list",
      fieldBindings: [
        { fieldId: fields.priority.id, role: "input", order: 1 },
        { fieldId: fields.dueDate.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    // --- Personal / Fun ---
    callMom: {
      id: uid(), label: "Call mom", kind: "list",
      fieldBindings: [
      ],
    },
    planVacation: {
      id: uid(), label: "Plan summer vacation", kind: "list",
      fieldBindings: [
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },
    birthdayGift: {
      id: uid(), label: "Buy birthday gift for Sarah", kind: "list",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.dueDate.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    signUpClass: {
      id: uid(), label: "Sign up for cooking class", kind: "list",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "input", order: 1 },
      ],
    },
  };

  // === PROJECT & DEADLINE PLANNING INSTANCES ===
  // These live in the "Planning & Deadlines" todo container and show countdown timers
  const planningInstances = {
    moduiLaunch: {
      id: uid(), label: "Moduli MVP Launch", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.priority.id, role: "input", order: 1 },
        { fieldId: fields.dueDate.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
        { fieldId: fields.notes.id, role: "input", order: 4 },
      ],
    },
    doctorCheckup: {
      id: uid(), label: "Annual Doctor Checkup", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
    carInsurance: {
      id: uid(), label: "Car Insurance Renewal", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.dueDate.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    fileTaxes: {
      id: uid(), label: "File Taxes", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
        { fieldId: fields.notes.id, role: "input", order: 3 },
      ],
    },
    quarterlyReview: {
      id: uid(), label: "Quarterly Financial Review", kind: "list",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.dueDate.id, role: "input", order: 1 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 2 },
      ],
    },
  };

  // === DAILY GOALS SUMMARY INSTANCES ===
  const goalInstances = {
    physicalSummary: {
      id: uid(), label: "Physical Wellness", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
        { fieldId: fields.totalWater.id, role: "display", order: 2 },
      ],
    },
    intellectualSummary: {
      id: uid(), label: "Intellectual Growth", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalPages.id, role: "display", order: 1 },
        { fieldId: fields.totalDuration.id, role: "display", order: 2 },
      ],
    },
    emotionalSummary: {
      id: uid(), label: "Emotional Balance", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.lastMood.id, role: "display", order: 1 },
      ],
    },
    socialSummary: {
      id: uid(), label: "Social Connection", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    spiritualSummary: {
      id: uid(), label: "Spiritual Practice", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    occupationalSummary: {
      id: uid(), label: "Work Progress", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    financialSummary: {
      id: uid(), label: "Financial Health", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalSpent.id, role: "display", order: 0 },
        { fieldId: fields.totalIncome.id, role: "display", order: 1 },
      ],
    },
    environmentalSummary: {
      id: uid(), label: "Environment Care", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
      ],
    },
    planningSummary: {
      id: uid(), label: "Planning Overview", kind: "list",
      fieldBindings: [
        { fieldId: fields.overdueTasks.id, role: "display", order: 0 },
        { fieldId: fields.upcomingThisWeek.id, role: "display", order: 1 },
      ],
    },
  };

  // === ACCOUNT AGGREGATION INSTANCES (no targets - lifetime stats) ===
  const accountInstances = {
    bankAccount: {
      id: uid(), label: "Checking Account", kind: "list",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
        { fieldId: fields.totalSpent.id, role: "display", order: 1 },
        { fieldId: fields.totalIncome.id, role: "display", order: 2 },
      ],
    },
    savingsAccount: {
      id: uid(), label: "Savings Account", kind: "list",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
      ],
    },
    momsAccount: {
      id: uid(), label: "Mom's Account", kind: "list",
      fieldBindings: [
        { fieldId: fields.momsAccountBalance.id, role: "display", order: 0 },
      ],
    },
    fitnessAccount: {
      id: uid(), label: "Fitness Stats", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalWorkouts.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
      ],
    },
    readingAccount: {
      id: uid(), label: "Reading Stats", kind: "list",
      fieldBindings: [
        { fieldId: fields.totalReadingTime.id, role: "display", order: 0 },
        { fieldId: fields.totalPages.id, role: "display", order: 1 },
      ],
    },
    productivityAccount: {
      id: uid(), label: "Productivity", kind: "list",
      fieldBindings: [
        { fieldId: fields.completionRate.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
      ],
    },
    wellnessAccount: {
      id: uid(), label: "Wellness Score", kind: "list",
      fieldBindings: [
        { fieldId: fields.lastMood.id, role: "display", order: 0 },
        { fieldId: fields.totalWater.id, role: "display", order: 1 },
      ],
    },
  };

  // === WORKOUT + NUTRITION GOAL SUMMARY INSTANCES ===
  const workoutGoalInstance = {
    id: uid(), label: "Workout Today", kind: "list",
    fieldBindings: [
      { fieldId: fields.totalRepsToday.id, role: "display", order: 0 },
      { fieldId: fields.totalSteps.id, role: "display", order: 1 },
    ],
  };
  const nutritionGoalInstance = {
    id: uid(), label: "Nutrition Today", kind: "list",
    fieldBindings: [
      { fieldId: fields.totalProtein.id, role: "display", order: 0 },
      { fieldId: fields.totalCarbs.id, role: "display", order: 1 },
      { fieldId: fields.totalFats.id, role: "display", order: 2 },
    ],
  };

  // === NOTEBOOK NOTE INSTANCES (from morenotes.md + gospelofthomasnotes.md) ===
  // Each H1 (morenotes) or H2 (gospel) heading → kind:"doc" container.
  // H2 (morenotes) or H3 (gospel) sub-headings within → doc instance occurrences embedded as instancePills.
  // Current files don't have sub-headings, so instances arrays will be empty — containers show rich text content.
  const _moreNotesSections    = parseSectionsWithInstances(join(ROOT_DIR_MD, "morenotes.md"), 1, 2, 8);
  const _gospelNotesSections  = parseSectionsWithInstances(join(ROOT_DIR_MD, "gospelofthomasnotes.md"), 2, 3, 8);
  const _philSections         = parseSectionsWithInstances(join(ROOT_DIR_MD, "philosopherstone.md"), 1, 2, 8);
  const _stanSections         = parseStanSections(join(ROOT_DIR_MD, "stan.txt"));

  // Flat notes — each file may use different heading levels
  // secLevel: which heading level creates containers (1=#, 2=##)
  // instLevel: which heading level creates instances within containers
  const _flatNotesDefs = [
    { file: "uses.md",        label: "Uses",          bg: "#3a8fc0", key: "uses",        secLevel: 2, instLevel: 3 },
    { file: "PRAGMATIC.md",   label: "Pragmatic",     bg: "#8b5cf6", key: "pragmatic",   secLevel: 2, instLevel: 3 },
    { file: "aispecs.md",     label: "AI Specs",      bg: "#16a34a", key: "aispecs",     secLevel: 1, instLevel: 3 },
    { file: "banglespecs.md", label: "Bangle Specs",  bg: "#d97706", key: "banglespecs", secLevel: 1, instLevel: 2 },
  ];
  const _flatNotesSections = _flatNotesDefs.map(def => ({
    ...def,
    sections: parseSectionsWithInstances(join(ROOT_DIR_MD, def.file), def.secLevel, def.instLevel, 12),
  }));

  // Simple flat content for docs without structured headings
  function readRawLines(filePath, maxLines = 120) {
    try { return fs.readFileSync(filePath, "utf-8").split("\n").slice(0, maxLines); } catch { return []; }
  }
  const _compRelLines  = readRawLines(join(ROOT_DIR_MD, "comparitive_religion.md"));
  const _gospelTextLines = readRawLines(join(ROOT_DIR_MD, "gospelthomas.md"), 80);

  // Strip inline markdown marks for instance labels
  function stripInlineMarks(text) {
    return text.replace(/\*{3}([^*]+)\*{3}/g, '$1').replace(/\*{2}([^*]+)\*{2}/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();
  }

  // notesBySectionKey: sectionKey → { heading, extraLines, instances: [{heading, lines}] }
  const notesBySectionKey = {};
  for (const [i, section] of _moreNotesSections.entries()) {
    const instances = section.instances.map(inst => ({ id: uid(), label: stripInlineMarks(inst.heading), lines: inst.lines }));
    notesBySectionKey[`notebookMore_${i}`] = { heading: section.heading, extraLines: section.extraLines, instances };
  }
  for (const [i, section] of _gospelNotesSections.entries()) {
    const instances = section.instances.map(inst => ({ id: uid(), label: stripInlineMarks(inst.heading), lines: inst.lines }));
    notesBySectionKey[`notebookGospel_${i}`] = { heading: section.heading, extraLines: section.extraLines, instances };
  }
  for (const [i, section] of _philSections.entries()) {
    const instances = section.instances.map(inst => ({ id: uid(), label: stripInlineMarks(inst.heading), lines: inst.lines }));
    notesBySectionKey[`notebookPhil_${i}`] = { heading: section.heading, extraLines: section.extraLines, instances };
  }
  for (const def of _flatNotesSections) {
    for (const [i, section] of def.sections.entries()) {
      const instances = section.instances.map(inst => ({ id: uid(), label: stripInlineMarks(inst.heading), lines: inst.lines }));
      notesBySectionKey[`${def.key}_${i}`] = { heading: section.heading, extraLines: section.extraLines, instances };
    }
  }

  // Flat map of all notebook sub-heading instances for inclusion in allInstances save loop
  // (covers notebookMore_*, notebookGospel_*, notebookPhil_*)
  const notebookNoteInstancesFlat = {};
  for (const [sKey, entry] of Object.entries(notesBySectionKey)) {
    for (const [idx, inst] of entry.instances.entries()) {
      notebookNoteInstancesFlat[`${sKey}_${idx}`] = { id: inst.id, label: inst.label, kind: "list" };
    }
  }

  // Journal answer docInstances (one per Q&A section)
  const journalDocInstances = {
    wentWellDocInst:  { id: uid(), label: "What Went Well?",          kind: "list", fieldBindings: [{ fieldId: fields.wentWellAnswer.id,  role: "input", order: 0 }] },
    improvedDocInst:  { id: uid(), label: "What Could Be Improved?",  kind: "list", fieldBindings: [{ fieldId: fields.improvedAnswer.id,   role: "input", order: 0 }] },
    gratitudeDocInst: { id: uid(), label: "Gratitude",                kind: "list", fieldBindings: [{ fieldId: fields.gratitudeAnswer.id,  role: "input", order: 0 }] },
  };

  // Movie pool instances — library items for the Movies pool container
  const movieRatingBinding = { fieldId: fields.movieRating.id, order: 0 };
  const lastWatchedBinding = { fieldId: fields.lastWatched.id, order: 1 };
  const moviePoolInstances = {
    movieMatrix:    { id: uid(), label: "The Matrix",                  kind: "list", defaultDragMode: "copy", fieldBindings: [movieRatingBinding, lastWatchedBinding] },
    movieParasite:  { id: uid(), label: "Parasite",                    kind: "list", defaultDragMode: "copy", fieldBindings: [movieRatingBinding, lastWatchedBinding] },
    movieEEAO:      { id: uid(), label: "Everything Everywhere All At Once", kind: "list", defaultDragMode: "copy", fieldBindings: [movieRatingBinding, lastWatchedBinding] },
    movieArrival:   { id: uid(), label: "Arrival",                     kind: "list", defaultDragMode: "copy", fieldBindings: [movieRatingBinding, lastWatchedBinding] },
    movieDune:      { id: uid(), label: "Dune",                        kind: "list", defaultDragMode: "copy", fieldBindings: [movieRatingBinding, lastWatchedBinding] },
  };

  const tvShowPoolInstances = {
    tvBreakingBad: { id: uid(), label: "Breaking Bad",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    tvTheWire:     { id: uid(), label: "The Wire",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    tvSeverance:   { id: uid(), label: "Severance",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    tvDark:        { id: uid(), label: "Dark",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    tvShogun:      { id: uid(), label: "Shogun",         kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const booksPoolInstances = {
    bookMeditations:  { id: uid(), label: "Meditations — Marcus Aurelius", kind: "list", defaultDragMode: "copy", fieldBindings: [{ fieldId: fields.movieRating.id, order: 0 }, { fieldId: fields.lastWatched.id, order: 1 }] },
    bookAtomicHabits: { id: uid(), label: "Atomic Habits",                  kind: "list", defaultDragMode: "copy", fieldBindings: [{ fieldId: fields.movieRating.id, order: 0 }] },
    bookSapiens:      { id: uid(), label: "Sapiens",                        kind: "list", defaultDragMode: "copy", fieldBindings: [{ fieldId: fields.movieRating.id, order: 0 }] },
    bookMansSearch:   { id: uid(), label: "Man's Search for Meaning",       kind: "list", defaultDragMode: "copy", fieldBindings: [{ fieldId: fields.movieRating.id, order: 0 }] },
    bookPowerOfNow:   { id: uid(), label: "The Power of Now",               kind: "list", defaultDragMode: "copy", fieldBindings: [{ fieldId: fields.movieRating.id, order: 0 }] },
  };
  const musicPoolInstances = {
    musicKindOfBlue: { id: uid(), label: "Kind of Blue — Miles Davis",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    musicOKComputer: { id: uid(), label: "OK Computer — Radiohead",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    musicBlue:       { id: uid(), label: "Blue — Joni Mitchell",        kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    musicPurpleRain: { id: uid(), label: "Purple Rain — Prince",        kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    musicBlonde:     { id: uid(), label: "Blonde — Frank Ocean",        kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const podcastsPoolInstances = {
    podcastLex:        { id: uid(), label: "Lex Fridman Podcast",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    podcast99PI:       { id: uid(), label: "99% Invisible",         kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    podcastHuberman:   { id: uid(), label: "Huberman Lab",          kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    podcastHiddenBrain:{ id: uid(), label: "Hidden Brain",          kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    podcastAcquired:   { id: uid(), label: "Acquired",              kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const gamesPoolInstances = {
    gameChess:     { id: uid(), label: "Chess",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gameZelda:     { id: uid(), label: "Zelda: BotW",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gameEldenRing: { id: uid(), label: "Elden Ring",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gameMinecraft: { id: uid(), label: "Minecraft",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gameStardew:   { id: uid(), label: "Stardew Valley",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const activitiesPoolInstances = {
    actHiking:      { id: uid(), label: "Hiking",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actSwimming:    { id: uid(), label: "Swimming",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actCooking:     { id: uid(), label: "Cooking",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actPhotography: { id: uid(), label: "Photography",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actYoga:        { id: uid(), label: "Yoga",         kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actGardening:   { id: uid(), label: "Gardening",    kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    actDrawing:     { id: uid(), label: "Drawing",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const roomsPoolInstances = {
    roomLivingRoom: { id: uid(), label: "Living Room",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomKitchen:    { id: uid(), label: "Kitchen",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomBedroom:    { id: uid(), label: "Bedroom",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomBathroom:   { id: uid(), label: "Bathroom",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomOffice:     { id: uid(), label: "Office",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomGarage:     { id: uid(), label: "Garage",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    roomBackyard:   { id: uid(), label: "Backyard",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const cbtPoolInstances = {
    cbtRestructuring: { id: uid(), label: "Cognitive Restructuring",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtActivation:    { id: uid(), label: "Behavioral Activation",         kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtThoughtRecord: { id: uid(), label: "Thought Records",               kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtGrounding:     { id: uid(), label: "Grounding 5-4-3-2-1",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtMindfulness:   { id: uid(), label: "Mindfulness",                   kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtExposure:      { id: uid(), label: "Exposure Exercise",             kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtWorryTime:     { id: uid(), label: "Worry Time",                    kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    cbtPMR:           { id: uid(), label: "Progressive Muscle Relaxation", kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const bookmarksPoolInstances = {
    bookmarkGTD:     { id: uid(), label: "Getting Things Done",     kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    bookmarkOld:     { id: uid(), label: "Old Articles to Review",  kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    bookmarkRecipes: { id: uid(), label: "Recipe Collection",       kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    bookmarkHealth:  { id: uid(), label: "Health Research",         kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  // Journal question pool instances — each pool feeds a Q/A select dropdown
  const wentWellQInstances = {
    wwq1: { id: uid(), label: "What went well today?",              kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    wwq2: { id: uid(), label: "What made you smile?",               kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    wwq3: { id: uid(), label: "What progress did you make?",        kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    wwq4: { id: uid(), label: "What are you proud of?",             kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    wwq5: { id: uid(), label: "What positive interaction did you have?", kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const improvedQInstances = {
    iq1: { id: uid(), label: "What could be improved?",             kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    iq2: { id: uid(), label: "What challenged you today?",          kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    iq3: { id: uid(), label: "What would you do differently?",      kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    iq4: { id: uid(), label: "Where did you feel stuck?",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    iq5: { id: uid(), label: "What drained your energy?",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };
  const gratitudeQInstances = {
    gq1: { id: uid(), label: "What are you grateful for?",          kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gq2: { id: uid(), label: "Who made a difference today?",        kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gq3: { id: uid(), label: "What simple pleasure did you enjoy?", kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gq4: { id: uid(), label: "What opportunity are you thankful for?", kind: "list", defaultDragMode: "copy", fieldBindings: [] },
    gq5: { id: uid(), label: "What did you learn today?",           kind: "list", defaultDragMode: "copy", fieldBindings: [] },
  };

  const listTypeBinding = { fieldId: fields.listType.id, order: 0 };
  const enrichmentInstances = {
    actWatch:    { id: uid(), label: "Watch",            kind: "list", defaultDragMode: "copy",
      fieldBindings: [listTypeBinding, { fieldId: fields.watchItem.id,    order: 1 }] },
    actRead:     { id: uid(), label: "Read",             kind: "list", defaultDragMode: "copy",
      fieldBindings: [listTypeBinding, { fieldId: fields.readItem.id,     order: 1 }] },
    actListen:   { id: uid(), label: "Listen",           kind: "list", defaultDragMode: "copy",
      fieldBindings: [listTypeBinding, { fieldId: fields.listenItem.id,   order: 1 }] },
    actPlay:     { id: uid(), label: "Play",             kind: "list", defaultDragMode: "copy",
      fieldBindings: [listTypeBinding, { fieldId: fields.playItem.id,     order: 1 }] },
    actDoRoom:   { id: uid(), label: "Tidy Room",        kind: "list", defaultDragMode: "copy",
      fieldBindings: [{ fieldId: fields.roomItem.id,    order: 0 }] },
    actCBT:      { id: uid(), label: "CBT Skill",        kind: "list", defaultDragMode: "copy",
      fieldBindings: [{ fieldId: fields.cbtItem.id,     order: 0 }] },
    actBookmark: { id: uid(), label: "Review Bookmark",  kind: "list", defaultDragMode: "copy",
      fieldBindings: [{ fieldId: fields.bookmarkItem.id, order: 0 }] },
  };

  // Save all instances (with gridId)
  const allInstances = { ...toolkitInstances, ...workoutInstances, ...nutritionInstances, ...todoInstances, ...planningInstances, ...goalInstances, ...accountInstances, workoutGoal: workoutGoalInstance, nutritionGoal: nutritionGoalInstance, ...journalDocInstances, ...notebookNoteInstancesFlat, ...moviePoolInstances, ...tvShowPoolInstances, ...booksPoolInstances, ...musicPoolInstances, ...podcastsPoolInstances, ...gamesPoolInstances, ...activitiesPoolInstances, ...roomsPoolInstances, ...cbtPoolInstances, ...bookmarksPoolInstances, ...wentWellQInstances, ...improvedQInstances, ...gratitudeQInstances, ...enrichmentInstances };

  // Inject hidden category field into every instance
  for (const key in allInstances) {
    if (!allInstances[key].fieldBindings) allInstances[key].fieldBindings = [];
    const maxOrder = allInstances[key].fieldBindings.reduce((m, b) => Math.max(m, b.order || 0), 0);
    allInstances[key].fieldBindings.push({ fieldId: fields.category.id, hidden: true, order: maxOrder + 1 });
  }

  for (const key in allInstances) {
    // Toolkit/workout/nutrition/pool instances default to copy mode (they're templates)
    const isToolkitInstance = Object.keys(toolkitInstances).includes(key)
      || Object.keys(workoutInstances).includes(key)
      || Object.keys(nutritionInstances).includes(key)
      || Object.keys(moviePoolInstances).includes(key)
      || Object.keys(tvShowPoolInstances).includes(key)
      || Object.keys(booksPoolInstances).includes(key)
      || Object.keys(musicPoolInstances).includes(key)
      || Object.keys(podcastsPoolInstances).includes(key)
      || Object.keys(gamesPoolInstances).includes(key)
      || Object.keys(activitiesPoolInstances).includes(key)
      || Object.keys(roomsPoolInstances).includes(key)
      || Object.keys(cbtPoolInstances).includes(key)
      || Object.keys(bookmarksPoolInstances).includes(key)
      || Object.keys(wentWellQInstances).includes(key)
      || Object.keys(improvedQInstances).includes(key)
      || Object.keys(gratitudeQInstances).includes(key)
      || Object.keys(enrichmentInstances).includes(key);
    const instData = allInstances[key];
    // Ensure every instance has date in its fieldBindings so the date filter works
    const existingBindings = instData.fieldBindings || [];
    const hasScheduledDate = existingBindings.some(b => b.fieldId === dateFieldId);
    const finalBindings = hasScheduledDate
      ? existingBindings
      : [...existingBindings, { fieldId: dateFieldId, role: "input", order: existingBindings.length, hidden: true }];
    const instance = new Module({
      ...instData,
      fieldBindings: finalBindings,
      userId,
      gridId,
      role: "instance",
      defaultDragMode: isToolkitInstance ? "copy" : "move",
    });
    await instance.save();
  }

  // ===================================================================
  // STEP 3: Create Containers
  // ===================================================================

  // Daily Toolkit Containers (8 dimensions + workout groups + meal categories)
  const toolkitContainers = {
    physical:      { id: uid(), label: "Physical",      occurrences: [], styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    intellectual:  { id: uid(), label: "Intellectual",  occurrences: [], styleMode: "own", ownStyle: { bg: "#1562b0" } },
    emotional:     { id: uid(), label: "Emotional",     occurrences: [], styleMode: "own", ownStyle: { bg: "#a02158" } },
    social:        { id: uid(), label: "Social",        occurrences: [], styleMode: "own", ownStyle: { bg: "#c49000" } },
    spiritual:     { id: uid(), label: "Spiritual",     occurrences: [], styleMode: "own", ownStyle: { bg: "#6427c5" } },
    occupational:  { id: uid(), label: "Occupational",  occurrences: [], styleMode: "own", ownStyle: { bg: "#0d7a52" } },
    financial:     { id: uid(), label: "Financial",     occurrences: [], styleMode: "own", ownStyle: { bg: "#1d8a30" } },
    environmental: { id: uid(), label: "Environmental", occurrences: [], styleMode: "own", ownStyle: { bg: "#0779a0" } },
    // All workout exercises in one container — muscle group selected per exercise
    workoutAll: { id: uid(), label: "Physical - Fitness", occurrences: [] },
    // Meal categories
    mealBreakfast:    { id: uid(), label: "Breakfast",  occurrences: [] },
    mealLunch:        { id: uid(), label: "Lunch",      occurrences: [] },
    mealSnack:        { id: uid(), label: "Snack",      occurrences: [] },
    mealDinner:       { id: uid(), label: "Dinner",     occurrences: [] },
    mealIngredients:  { id: uid(), label: "Ingredients", occurrences: [] },
    // Pool containers — draggable pill libraries
    moviePool:      { id: moviePoolId,      label: "Movies",      _viewId: uid(), occurrences: [] },
    tvShowPool:     { id: tvShowPoolId,     label: "TV Shows",    _viewId: uid(), occurrences: [] },
    booksPool:      { id: booksPoolId,      label: "Books",       _viewId: uid(), occurrences: [] },
    musicPool:      { id: musicPoolId,      label: "Music",       _viewId: uid(), occurrences: [] },
    podcastsPool:   { id: podcastsPoolId,   label: "Podcasts",    _viewId: uid(), occurrences: [] },
    gamesPool:      { id: gamesPoolId,      label: "Games",       _viewId: uid(), occurrences: [] },
    activitiesPool: { id: activitiesPoolId, label: "Activities",  _viewId: uid(), occurrences: [] },
    roomsPool:      { id: roomsPoolId,      label: "Rooms",       _viewId: uid(), occurrences: [] },
    cbtPool:        { id: cbtPoolId,        label: "CBT Skills",  _viewId: uid(), occurrences: [] },
    bookmarksPool:  { id: bookmarksPoolId,  label: "Bookmarks",   _viewId: uid(), occurrences: [] },
    // Journal question pools — operations pick a random question onLoad each day
    wentWellQPool:  { id: wentWellQPoolId,  label: "Went Well Questions",  _viewId: uid(), occurrences: [] },
    improvedQPool:  { id: improvedQPoolId,  label: "Improvement Questions", _viewId: uid(), occurrences: [] },
    gratitudeQPool: { id: gratitudeQPoolId, label: "Gratitude Questions",   _viewId: uid(), occurrences: [] },
    // Enrichment use-case container
    enrichment:     { id: uid(),            label: "Enrichment",  occurrences: [] },
    // Macro Reference — locked doc with nutrition table (demonstrates table + lock features)
    macroRef:       { id: macroRefId,       label: "Macro Reference", _viewId: uid(), occurrences: [] },
  };

  // Todo List Containers (categorized by project)
  const todoContainers = {
    todoHome: { id: uid(), label: "Home & Errands", occurrences: [] },
    todoFinance: { id: uid(), label: "Finance & Admin", occurrences: [] },
    todoWork: { id: uid(), label: "Work Projects", occurrences: [] },
    todoPersonal: { id: uid(), label: "Personal / Fun", occurrences: [] },
    todoPlan: { id: uid(), label: "Planning & Deadlines", occurrences: [] },
  };

  // Schedule Containers (48 time slots)
  const timeSlots = generateTimeSlots();
  const scheduleContainers = {};
  for (const slot of timeSlots) {
    const key = `slot_${slot.hour}_${slot.minute}`;
    scheduleContainers[key] = {
      id: uid(),
      label: slot.label,
      occurrences: [],
    };
  }

  // Daily Goals Containers (8 dimensions + fitness + nutrition)
  const goalContainers = {
    physicalGoal:      { id: uid(), label: "Physical",      occurrences: [], styleMode: "own", ownStyle: { bg: "#b44a1a" } },
    intellectualGoal:  { id: uid(), label: "Intellectual",  occurrences: [], styleMode: "own", ownStyle: { bg: "#1562b0" } },
    emotionalGoal:     { id: uid(), label: "Emotional",     occurrences: [], styleMode: "own", ownStyle: { bg: "#a02158" } },
    socialGoal:        { id: uid(), label: "Social",        occurrences: [], styleMode: "own", ownStyle: { bg: "#c49000" } },
    spiritualGoal:     { id: uid(), label: "Spiritual",     occurrences: [], styleMode: "own", ownStyle: { bg: "#6427c5" } },
    occupationalGoal:  { id: uid(), label: "Occupational",  occurrences: [], styleMode: "own", ownStyle: { bg: "#0d7a52" } },
    financialGoal:     { id: uid(), label: "Financial",     occurrences: [], styleMode: "own", ownStyle: { bg: "#1d8a30" } },
    environmentalGoal: { id: uid(), label: "Environmental", occurrences: [], styleMode: "own", ownStyle: { bg: "#0779a0" } },
    workoutGoal: { id: uid(), label: "Workout", occurrences: [] },
    nutritionGoal: { id: uid(), label: "Nutrition", occurrences: [] },
    planningGoal: { id: uid(), label: "Planning", occurrences: [] },
  };

  // Account Containers (for Accounts panel - lifetime aggregations)
  const accountContainers = {
    financeAccount: { id: uid(), label: "Finances", occurrences: [] },
    fitnessAccount: { id: uid(), label: "Fitness", occurrences: [] },
    learningAccount: { id: uid(), label: "Learning", occurrences: [] },
    productivityAccount: { id: uid(), label: "Productivity", occurrences: [] },
    wellnessAccount: { id: uid(), label: "Wellness", occurrences: [] },
  };

  // Notebook Containers — 3 journal Q&A sections, Stan stanzas, morenotes, gospel sections
  const notebookDocContainers = {};

  // 3 Journal Q&A containers — question attached to header, answer attached to body
  const journalQADefs = [
    { key: "journalQA_wentWell",  label: "What Went Well?",          questionFieldKey: "wentWellQuestion",  answerFieldKey: "wentWellAnswer",  seedQuestion: "What went well today?"         },
    { key: "journalQA_improved",  label: "What Could Be Improved?",  questionFieldKey: "improvedQuestion",  answerFieldKey: "improvedAnswer",  seedQuestion: "What could be improved?"       },
    { key: "journalQA_gratitude", label: "Gratitude",                questionFieldKey: "gratitudeQuestion", answerFieldKey: "gratitudeAnswer", seedQuestion: "What are you grateful for?"    },
  ];
  for (const def of journalQADefs) {
    const qFieldId = fields[def.questionFieldKey].id;
    const aFieldId = fields[def.answerFieldKey].id;
    notebookDocContainers[def.key] = {
      id: uid(), label: def.label, _viewId: uid(), occurrences: [],
      ownStyle: { bg: "#b56800" }, styleMode: "own",
      fieldBindings: [],
      attachedFields: { header: [qFieldId], body: [aFieldId] },
    };
  }

  // Stan stanza containers (lyrics directly in body textmap — no instances)
  for (const [i, section] of _stanSections.entries()) {
    notebookDocContainers[`stan_${i}`] = { id: uid(), label: section.heading, _viewId: uid(), occurrences: [], ownStyle: { bg: "#1ac47a" }, styleMode: "own" };
  }

  // Section containers from morenotes.md
  for (const [i, section] of _moreNotesSections.entries()) {
    notebookDocContainers[`notebookMore_${i}`] = { id: uid(), label: section.heading, _viewId: uid(), occurrences: [], ownStyle: { bg: "#2a90e8" }, styleMode: "own" };
  }
  // Section containers from gospelofthomasnotes.md — each section may also split at "Why this"
  for (const [i, section] of _gospelNotesSections.entries()) {
    notebookDocContainers[`notebookGospel_${i}`] = { id: uid(), label: section.heading, _viewId: uid(), occurrences: [], ownStyle: { bg: "#9b4de0" }, styleMode: "own" };
    const splitIdx = section.extraLines.findIndex(l => l.toLowerCase().includes("why this"));
    if (splitIdx >= 0) {
      const whyLabel = section.extraLines[splitIdx].replace(/^#+\s*/, "").trim() || "Why This Matters";
      notebookDocContainers[`notebookGospel_${i}_why`] = { id: uid(), label: whyLabel, _viewId: uid(), occurrences: [], ownStyle: { bg: "#7040c0" }, styleMode: "own" };
    }
  }
  // Section containers from philosopherstone.md — H1 headings
  for (const [i, section] of _philSections.entries()) {
    notebookDocContainers[`notebookPhil_${i}`] = { id: uid(), label: section.heading, _viewId: uid(), occurrences: [], ownStyle: { bg: "#d4a010" }, styleMode: "own" };
  }
  // Section containers from flat notes (uses.md, PRAGMATIC.md, aispecs.md, banglespecs.md)
  for (const def of _flatNotesSections) {
    for (const [i, section] of def.sections.entries()) {
      notebookDocContainers[`${def.key}_${i}`] = { id: uid(), label: section.heading, _viewId: uid(), occurrences: [], ownStyle: { bg: def.bg }, styleMode: "own" };
    }
  }

  // Weekly Review — doc that embeds Q&A containers using moduleEmbed (demonstrates embed feature)
  notebookDocContainers.weeklyReview = { id: uid(), label: "Weekly Review", _viewId: uid(), occurrences: [], ownStyle: { bg: "#1e4060" }, styleMode: "own" };

  // Day page section containers — each section of the day page is a doc container embedded via moduleEmbed
  notebookDocContainers.dpMorningIntentions = { id: uid(), label: "Morning Intentions", _viewId: uid(), occurrences: [], ownStyle: { bg: "#1a3a20" }, styleMode: "own" };
  notebookDocContainers.dpDailyLog         = { id: uid(), label: "Daily Log",           _viewId: uid(), occurrences: [], ownStyle: { bg: "#1a2a3a" }, styleMode: "own" };
  notebookDocContainers.dpBrainDump        = { id: uid(), label: "Brain Dump",           _viewId: uid(), occurrences: [], ownStyle: { bg: "#2a1a3a" }, styleMode: "own" };

  // Save all containers (with gridId)
  const allContainers = { ...toolkitContainers, ...todoContainers, ...scheduleContainers, ...goalContainers, ...accountContainers, ...notebookDocContainers };

  // Create View records for all doc/pool containers (_viewId marks which need one)
  // pool containers → viewType: "pool"; doc containers → viewType: "doc"
  // Pool containers are in toolkitContainers; doc containers are in notebookDocContainers + macroRef
  const poolContainerKeys = new Set(["moviePool", "tvShowPool", "booksPool", "musicPool", "podcastsPool", "gamesPool", "activitiesPool", "roomsPool", "cbtPool", "bookmarksPool", "wentWellQPool", "improvedQPool", "gratitudeQPool"]);
  const docContainerViewRecords = [];
  for (const key in allContainers) {
    const c = allContainers[key];
    if (!c._viewId) continue;
    const isPool = poolContainerKeys.has(key);
    docContainerViewRecords.push(new View({ id: c._viewId, userId, gridId: gridId || null, viewType: isPool ? "pool" : "doc", layout: {} }).save());
  }
  await Promise.all(docContainerViewRecords);

  for (const key in allContainers) {
    const { _viewId, occurrences: _occurrences, ...containerData } = allContainers[key];
    const container = new Module({
      ...containerData,
      userId,
      gridId,
      role: "container",
    });
    await container.save();
  }

  // ===================================================================
  // STEP 4: Create Panels
  // ===================================================================
  const panels = {
    dailyToolkit: {
      id: uid(),
      label: "Panel A",
      kind: "board",
      defaultDragMode: "copy", // Toolkit items are templates - copy by default
      layout: {
        name: "Panel A",
        display: "flex",
        flow: "column",
        wrap: "nowrap",
        gapPx: 4,
        scrollY: "auto",
        padding: "sm",
      },
      occurrences: [],
    },
    todoList: {
      id: uid(),
      label: "Panel B",
      kind: "board",
      defaultDragMode: "move", // Todo items are one-off - move by default
      layout: {
        name: "Panel B",
        display: "flex",
        flow: "column",
        wrap: "nowrap",
        gapPx: 8,
        scrollY: "auto",
        padding: "sm",
      },
      occurrences: [],
    },
    centerHub: {
      id: uid(),
      label: "Panel C",
      kind: "board",
      defaultDragMode: "move",
      layout: {
        name: "Panel C",
        display: "flex",
        flow: "column",
        wrap: "nowrap",
        gapPx: 4,
        scrollY: "auto",
        padding: "sm",
      },
      occurrences: [],
    },
    dailyGoals: {
      id: uid(),
      label: "Panel D",
      kind: "board",
      defaultDragMode: "move",
      layout: {
        name: "Panel D",
        display: "flex",
        flow: "column",
        wrap: "nowrap",
        gapPx: 8,
        scrollY: "auto",
        padding: "sm",
      },
      // Cascading style: containers get a green tint
      childContainerStyle: { bg: "rgba(34,197,94,0.08)", borderRadius: "8px" },
      childInstanceStyle: null,
      occurrences: [],
    },
    accounts: {
      id: uid(),
      label: "Panel E",
      kind: "board",
      defaultDragMode: "move",
      layout: {
        name: "Panel E",
        display: "flex",
        flow: "column",
        wrap: "nowrap",
        gapPx: 8,
        scrollY: "auto",
        padding: "sm",
      },
      occurrences: [],
    },
  };

  for (const key in panels) {
    const panel = new Module({
      ...panels[key],
      userId,
      gridId,
      role: "panel",
      label: panels[key].name || panels[key].label || "",
    });
    await panel.save();
  }

  // ===================================================================
  // STEP 5: Create Occurrences and wire everything together
  // ===================================================================

  // Helper: create a field value entry for pre-filling occurrences
  // Usage: fv(42, "in") → { value: 42, flow: "in", timestamp: now }
  function fv(value, flow = "in") {
    return { value, flow, timestamp: new Date() };
  }

  // Helper: get a Date N days ago from today (midnight local)
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0); // noon so it's clearly "that day"
    return d;
  }

  async function createOccurrence({ targetType, targetId, meta = {}, placement = null, linkedGroupId = null, fields = {}, date = null, viewId = null, filterOverride = null }) {
    const occId = uid();
    const occ = new Occurrence({
      id: occId,
      userId,
      targetType,
      targetId,
      gridId,
      timestamp: new Date(),
      fields: date
        ? { ...fields, [dateFieldId]: { value: date, flow: "in", timestamp: new Date() } }
        : fields,
      meta,
      filterOverride,
      hidden: false,
      ...(placement && { placement }),
      ...(linkedGroupId && { linkedGroupId }),
      ...(viewId && { viewId }),
    });
    await occ.save();
    return occId;
  }

  // Deferred wiring: collect containerModuleId → [instanceOccIds] to apply after ALL occurrences are created
  const containerInstOccs = {};

  // Wire instances to Toolkit containers
  const toolkitMappings = {
    physical: ["morningWorkout", "eveningRun", "stretching", "drinkWater", "takeMeds", "sleepLog"],
    intellectual: ["reading", "podcast", "watchMovie", "onlineCourse", "brainGames", "journaling"],
    emotional: ["gratitude", "meditation", "breathing", "moodCheck", "selfCare"],
    social: ["callFriend", "familyTime", "socialEvent", "helpSomeone"],
    spiritual: ["prayer", "natureWalk", "spiritualReading", "mindfulness"],
    occupational: ["deepWork", "meeting", "emailBlock", "skillDev", "networking"],
    financial: ["budgetReview", "trackExpense", "purchase", "logIncome", "investmentCheck", "savingsGoal"],
    environmental: ["cleanDesk", "declutter", "plantCare", "recycling", "ecoAction"],
    // All workout exercises in one container — muscle group selected per exercise
    workoutAll: [
      "benchPress", "inclinePress", "chestFly", "pushUps", "cableCrossover",
      "deadlift", "pullUps", "bentRow", "latPulldown", "seatedRow",
      "squat", "legPress", "lunges", "legCurl", "calfRaise",
      "overheadPress", "lateralRaise", "frontRaise", "facePull", "shrugs",
      "bicepCurl", "hammerCurl", "tricepDip", "skullCrusher", "tricepPushdown",
      "running", "cycling", "jumpRope", "rowMachine", "burpees",
    ],
    // Meal categories
    mealBreakfast:    ["greekYogurtBowl", "scrambledEggs", "oatmealBerries", "avocadoToast", "smoothieBowl"],
    mealLunch:        ["greekSaladChicken", "tunaWrap", "lentilSoup", "quinoaBowl", "hummusPita"],
    mealSnack:        ["almonds", "olivesHummus", "cheeseCrackers", "mixedBerries", "proteinBar"],
    mealDinner:       ["grilledSalmon", "chickenSouvlaki", "lambKofta", "pastaMarinara", "stuffedPeppers"],
    mealIngredients:  ["oliveOil", "chickpeas", "lemonGarlic", "wholeGrainBread", "greekOlives"],
  };

  for (const [containerKey, instanceKeys] of Object.entries(toolkitMappings)) {
    const occIds = [];
    for (const instKey of instanceKeys) {
      const inst = allInstances[instKey];
      if (!inst) { console.warn(`toolkitMapping: unknown instKey "${instKey}"`); continue; }
      // Pre-fill default field values from instance meta (muscle group, meal type, macros)
      const defaultFields = {};
      if (inst.meta?.defaultMuscleGroup) defaultFields[fields.muscleGroup.id] = fv(inst.meta.defaultMuscleGroup, "replace");
      if (inst.meta?.defaultMealType)    defaultFields[fields.mealCategory.id] = fv(inst.meta.defaultMealType, "replace");
      if (inst.meta?.defaultCal)         defaultFields[fields.calories.id] = fv(inst.meta.defaultCal, "replace");
      if (inst.meta?.defaultProtein)     defaultFields[fields.protein.id] = fv(inst.meta.defaultProtein, "replace");
      if (inst.meta?.defaultCarbs)       defaultFields[fields.carbs.id] = fv(inst.meta.defaultCarbs, "replace");
      if (inst.meta?.defaultFats)        defaultFields[fields.fats.id] = fv(inst.meta.defaultFats, "replace");
      const occId = await createOccurrence({
        targetType: "module",
        targetId: inst.id,
        meta: { containerId: toolkitContainers[containerKey].id },
        fields: defaultFields,
        date: today.toISOString(),
      });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers[containerKey].id] = occIds;
  }

  // Wire movie instances into the Movies pool container
  {
    const movieOccIds = [];
    for (const instKey of Object.keys(moviePoolInstances)) {
      const inst = moviePoolInstances[instKey];
      const occId = await createOccurrence({
        targetType: "module",
        targetId: inst.id,
        meta: { containerId: toolkitContainers.moviePool.id },
      });
      movieOccIds.push(occId);
    }
    containerInstOccs[toolkitContainers.moviePool.id] = movieOccIds;
  }

  // Wire TV Shows pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(tvShowPoolInstances)) {
      const inst = tvShowPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.tvShowPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.tvShowPool.id] = occIds;
  }

  // Wire Books pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(booksPoolInstances)) {
      const inst = booksPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.booksPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.booksPool.id] = occIds;
  }

  // Wire Music pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(musicPoolInstances)) {
      const inst = musicPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.musicPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.musicPool.id] = occIds;
  }

  // Wire Podcasts pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(podcastsPoolInstances)) {
      const inst = podcastsPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.podcastsPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.podcastsPool.id] = occIds;
  }

  // Wire Games pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(gamesPoolInstances)) {
      const inst = gamesPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.gamesPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.gamesPool.id] = occIds;
  }

  // Wire Activities pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(activitiesPoolInstances)) {
      const inst = activitiesPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.activitiesPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.activitiesPool.id] = occIds;
  }

  // Wire Rooms pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(roomsPoolInstances)) {
      const inst = roomsPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.roomsPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.roomsPool.id] = occIds;
  }

  // Wire CBT pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(cbtPoolInstances)) {
      const inst = cbtPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.cbtPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.cbtPool.id] = occIds;
  }

  // Wire Bookmarks pool instances
  {
    const occIds = [];
    for (const instKey of Object.keys(bookmarksPoolInstances)) {
      const inst = bookmarksPoolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.bookmarksPool.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.bookmarksPool.id] = occIds;
  }

  // Wire Journal Question pool instances
  for (const [poolInstances, poolContainer] of [
    [wentWellQInstances, toolkitContainers.wentWellQPool],
    [improvedQInstances, toolkitContainers.improvedQPool],
    [gratitudeQInstances, toolkitContainers.gratitudeQPool],
  ]) {
    const occIds = [];
    for (const instKey of Object.keys(poolInstances)) {
      const inst = poolInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: poolContainer.id } });
      occIds.push(occId);
    }
    containerInstOccs[poolContainer.id] = occIds;
  }

  // Wire enrichment instances
  {
    const occIds = [];
    for (const instKey of Object.keys(enrichmentInstances)) {
      const inst = enrichmentInstances[instKey];
      const occId = await createOccurrence({ targetType: "module", targetId: inst.id, meta: { containerId: toolkitContainers.enrichment.id } });
      occIds.push(occId);
    }
    containerInstOccs[toolkitContainers.enrichment.id] = occIds;
  }

  // Wire instances to categorized Todo containers
  const todoMappings = {
    todoHome: ["buyGroceries", "cleanGarage", "fixLeakyFaucet", "returnBooks", "organizePantry"],
    todoFinance: ["payBills", "cancelSub", "renewLicense", "dentistAppt", "fileInsurance"],
    todoWork: ["orderSupplies", "backupComputer", "updatePortfolio", "prepPresentation"],
    todoPersonal: ["callMom", "planVacation", "birthdayGift", "signUpClass"],
    todoPlan: ["moduiLaunch", "doctorCheckup", "carInsurance", "fileTaxes", "quarterlyReview"],
  };

  // Helper: get a Date N days from now (future due dates for planning instances)
  function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // Pre-fill due dates for planning instances so countdowns are immediately visible
  const planningDueDates = {
    moduiLaunch:     daysFromNow(45),
    doctorCheckup:   daysFromNow(90),
    carInsurance:    daysFromNow(12),
    fileTaxes:       daysFromNow(38),
    quarterlyReview: daysFromNow(21),
  };

  for (const [containerKey, instanceKeys] of Object.entries(todoMappings)) {
    const occIds = [];
    for (const instKey of instanceKeys) {
      // Pick the right instance source (todoInstances or planningInstances)
      const inst = todoInstances[instKey] || planningInstances[instKey];
      const dueDatePreFill = planningDueDates[instKey] ? { [fields.dueDate.id]: fv(planningDueDates[instKey].toISOString(), "replace") } : {};
      const occId = await createOccurrence({
        targetType: "module",
        targetId: inst.id,
        meta: { containerId: todoContainers[containerKey].id },
        fields: dueDatePreFill,
        date: today.toISOString(),
      });
      occIds.push(occId);
    }
    containerInstOccs[todoContainers[containerKey].id] = occIds;
  }

  // Wire summary instances to Goal containers
  const goalMappings = {
    physicalGoal: ["physicalSummary"],
    intellectualGoal: ["intellectualSummary"],
    emotionalGoal: ["emotionalSummary"],
    socialGoal: ["socialSummary"],
    spiritualGoal: ["spiritualSummary"],
    occupationalGoal: ["occupationalSummary"],
    financialGoal: ["financialSummary"],
    environmentalGoal: ["environmentalSummary"],
    workoutGoal: ["workoutGoal"],
    nutritionGoal: ["nutritionGoal"],
    planningGoal: ["planningSummary"],
  };

  for (const [containerKey, instanceKeys] of Object.entries(goalMappings)) {
    const occIds = [];
    for (const instKey of instanceKeys) {
      const inst = allInstances[instKey];
      if (!inst) { console.warn(`goalMapping: unknown instKey "${instKey}"`); continue; }
      const occId = await createOccurrence({
        targetType: "module",
        targetId: inst.id,
        meta: { containerId: goalContainers[containerKey].id },
        date: today.toISOString(),
      });
      occIds.push(occId);
    }
    containerInstOccs[goalContainers[containerKey].id] = occIds;
  }

  // Wire account instances to Account containers
  const accountMappings = {
    financeAccount: ["bankAccount", "savingsAccount", "momsAccount"],
    fitnessAccount: ["fitnessAccount"],  // Uses fitnessAccount instance
    learningAccount: ["readingAccount"],
    productivityAccount: ["productivityAccount"],
    wellnessAccount: ["wellnessAccount"],
  };

  for (const [containerKey, instanceKeys] of Object.entries(accountMappings)) {
    const occIds = [];
    for (const instKey of instanceKeys) {
      const occId = await createOccurrence({
        targetType: "module",
        targetId: accountInstances[instKey].id,
        meta: { containerId: accountContainers[containerKey].id },
      });
      occIds.push(occId);
    }
    containerInstOccs[accountContainers[containerKey].id] = occIds;
  }

  // Wire toolkit containers to Daily Toolkit panel
  const toolkitPanelOccIds = [];
  for (const containerKey of Object.keys(toolkitContainers)) {
    const tc = toolkitContainers[containerKey];
    const occId = await createOccurrence({
      targetType: "module",
      targetId: tc.id,
      meta: { panelId: panels.dailyToolkit.id },
      viewId: tc._viewId || null,
    });
    toolkitPanelOccIds.push(occId);
  }

  // Macro Reference — update occurrence with table textmap + locked=true
  // Demonstrates: D7 (table), R3 (lock document)
  {
    const makeCell = (text, type = "tableCell") => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
    });
    const makeRow = (cells, isHeader = false) => ({
      type: "tableRow",
      content: cells.map(c => makeCell(c, isHeader ? "tableHeader" : "tableCell")),
    });
    const macroRows = [
      ["Breakfast",  "35", "45", "15", "455"],
      ["Lunch",      "45", "55", "20", "580"],
      ["Dinner",     "50", "50", "25", "625"],
      ["Snack",      "20", "25", "10", "270"],
      ["Daily Total","150","175","70", "1930"],
    ];
    const macroTableTextmap = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Daily Macro Targets" }] },
        { type: "paragraph", content: [{ type: "text", text: "Reference targets for balanced nutrition. This doc is locked — click the lock icon to edit." }] },
        {
          type: "table",
          content: [
            makeRow(["Meal", "Protein (g)", "Carbs (g)", "Fat (g)", "Calories"], true),
            ...macroRows.map(r => makeRow(r, false)),
          ],
        },
        { type: "paragraph" },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Weekly Habit Targets" }] },
        {
          type: "table",
          content: [
            makeRow(["Habit", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], true),
            makeRow(["Exercise 30min", "✓", "✓", "✓", "✓", "✓", "", ""], false),
            makeRow(["8 glasses water", "✓", "✓", "✓", "✓", "✓", "✓", "✓"], false),
            makeRow(["Read 20min",     "✓", "",  "✓", "",  "✓", "",  "✓"], false),
            makeRow(["Meditate",       "✓", "✓", "",  "✓", "✓", "",  ""], false),
            makeRow(["Journal",        "",  "",  "✓", "",  "",  "✓", ""], false),
          ],
        },
      ],
    };
    await Occurrence.findOneAndUpdate(
      { targetId: toolkitContainers.macroRef.id, gridId },
      { $set: { textmap: macroTableTextmap, locked: true } }
    );
  }

  // Wire todo containers to Todo panel
  const todoPanelOccIds = [];
  for (const containerKey of Object.keys(todoContainers)) {
    const occId = await createOccurrence({
      targetType: "module",
      targetId: todoContainers[containerKey].id,
      meta: { panelId: panels.todoList.id },
    });
    todoPanelOccIds.push(occId);
  }
  // Wire time slot containers to Schedule panel — each gets date + timeslot
  // so the container is the source of truth for iteration context
  const scheduleOccIds = [];
  for (const slot of timeSlots) {
    const key = `slot_${slot.hour}_${slot.minute}`;
    const occId = await createOccurrence({
      targetType: "module",
      targetId: scheduleContainers[key].id,
      meta: { panelId: panels.centerHub.id },
      date: today.toISOString(),
      fields: {
        [fields.timeslot.id]: { value: slot.label, flow: "in" },
      },
    });
    scheduleOccIds.push(occId);
  }
  // Wire sample habits into schedule time slots with linkedGroupIds
  // These create copylinks between schedule occurrences and day page pills
  const scheduleHabitMappings = [
    { instKey: "morningWorkout", slotKey: "slot_7_0",  label: "Morning Workout" },
    { instKey: "stretching",    slotKey: "slot_7_30",  label: "Stretching" },
    { instKey: "reading",       slotKey: "slot_9_0",   label: "Reading" },
    { instKey: "meditation",    slotKey: "slot_12_0",  label: "Meditation" },
    { instKey: "deepWork",      slotKey: "slot_14_0",  label: "Deep Work" },
    { instKey: "drinkWater",    slotKey: "slot_17_0",  label: "Drink Water" },
    { instKey: "eveningRun",    slotKey: "slot_18_30", label: "Evening Run" },
  ];

  // Today's pre-filled values for schedule habits (demonstrates field tracking working)
  const todayPreFills = {
    morningWorkout: {
      [fields.completed.id]: fv(true, "in"),
      [fields.set1Reps.id]: fv(12, "in"),
      [fields.set2Reps.id]: fv(10, "in"),
      [fields.set3Reps.id]: fv(8, "in"),
    },
    stretching: {
      [fields.completed.id]: fv(true, "in"),
      [fields.duration.id]: fv(15, "in"),
    },
    reading: {
      [fields.completed.id]: fv(true, "in"),
      [fields.duration.id]: fv(30, "in"),
      [fields.pages.id]: fv(22, "in"),
    },
    meditation: {
      [fields.completed.id]: fv(false, "in"),
      [fields.duration.id]: fv(0, "in"),
    },
    deepWork: {
      [fields.completed.id]: fv(true, "in"),
      [fields.duration.id]: fv(90, "in"),
    },
    drinkWater: {
      [fields.completed.id]: fv(true, "in"),
      [fields.water.id]: fv(48, "in"),
    },
    eveningRun: {
      [fields.completed.id]: fv(false, "in"),
      [fields.steps.id]: fv(0, "in"),
      [fields.duration.id]: fv(0, "in"),
    },
  };

  // Also pre-fill today's mood check-in and water tracking
  const moodTodayOccId = await createOccurrence({
    targetType: "module",
    targetId: toolkitInstances.moodCheck.id,
    meta: { containerId: toolkitContainers.emotional.id },
    date: today.toISOString(),
    fields: {
      [fields.mood.id]: fv("focused", "in"),
      [fields.energy.id]: fv(4, "in"),
    },
  });
  // Append today's mood check-in to emotional container's deferred wiring
  if (!containerInstOccs[toolkitContainers.emotional.id]) containerInstOccs[toolkitContainers.emotional.id] = [];
  containerInstOccs[toolkitContainers.emotional.id].push(moodTodayOccId);

  const scheduleLinkedGroups = {}; // instKey -> linkedGroupId
  for (const { instKey, slotKey } of scheduleHabitMappings) {
    const linkedGroupId = uid();
    scheduleLinkedGroups[instKey] = linkedGroupId;
    const preFilledFields = todayPreFills[instKey] || {};
    const occId = await createOccurrence({
      targetType: "module",
      targetId: toolkitInstances[instKey].id,
      meta: { containerId: scheduleContainers[slotKey].id },
      date: today.toISOString(),
      linkedGroupId,
      fields: {
        ...preFilledFields,
        [fields.timeslot.id]: { value: scheduleContainers[slotKey].label, flow: "in" },
      },
    });
    // Collect into deferred wiring for this time slot container
    if (!containerInstOccs[scheduleContainers[slotKey].id]) containerInstOccs[scheduleContainers[slotKey].id] = [];
    containerInstOccs[scheduleContainers[slotKey].id].push(occId);
  }

  // Wire goal containers to Daily Goals panel
  const goalPanelOccIds = [];
  for (const containerKey of Object.keys(goalContainers)) {
    const occId = await createOccurrence({
      targetType: "module",
      targetId: goalContainers[containerKey].id,
      meta: { panelId: panels.dailyGoals.id },
    });
    goalPanelOccIds.push(occId);
  }
  // Wire account containers to Accounts panel
  const accountPanelOccIds = [];
  for (const containerKey of Object.keys(accountContainers)) {
    const occId = await createOccurrence({
      targetType: "module",
      targetId: accountContainers[containerKey].id,
      meta: { panelId: panels.accounts.id },
    });
    accountPanelOccIds.push(occId);
  }
  // Pre-generate Q&A container occurrence IDs (needed before sampleJournalContent for moduleEmbed refs)
  const qaContainerOccIds = {
    journalQA_wentWell:  uid(),
    journalQA_improved:  uid(),
    journalQA_gratitude: uid(),
  };

  // Pre-generate dayPageDocOccId early — needed for day-page textblock parentId (also used below for Q&A containers)
  const dayPageDocOccId = uid();

  // Pre-generate section container occurrence IDs (embedded as moduleEmbed in the day page)
  const dpSectionOccIds = {
    morningIntentions: uid(),
    dailyLog:          uid(),
    brainDump:         uid(),
  };

  // Pre-generate list textblock occurrence IDs for Daily Log sub-sections
  // (each list becomes one textblock whose textmap contains mini-textblocks)
  const dpListTBOccIds = {
    physical: uid(),
    mindSoul:  uid(),
    nutrition: uid(),
  };

  // Batch arrays for day page textblocks — saved in STEP 5 batch
  const _dpTbMods = [];
  const _dpTbOccs = [];
  // Helper: create a textblock instancePill block node
  // parentOccId defaults to dayPageDocOccId but can be set to a section/list container occurrence ID
  function dpTextblock(paragraphContent, parentOccId) {
    const modId = uid(); const occId = uid();
    _dpTbMods.push({ id: modId, userId, gridId, role: "instance", kind: "doc", label: "" });
    _dpTbOccs.push({
      id: occId, userId, gridId, targetId: modId, targetType: "module",
      parentId: parentOccId || dayPageDocOccId, iteration: { mode: "persistent" },
      textmap: { type: "doc", content: paragraphContent },
      fields: {},
    });
    return { type: "instancePill", attrs: { instanceId: modId, instanceLabel: "", occurrenceId: occId, showIcon: false, pillDisplay: "block" } };
  }

  // Wire day journal container to Day Page panel (with sample textmap)
  const todayFmt = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // Helper: instance pill node
  const ip = (instanceId, instanceLabel) => ({
    type: "instancePill",
    attrs: { instanceId, instanceLabel, occurrenceId: undefined, showIcon: true, pillDisplay: "inline" },
  });

  // ── Build section container textmaps ──────────────────────────────────────────────────
  // Each major day page section is a doc container embedded via moduleEmbed.
  // Textblocks inside each section container use the section's occurrence ID as parentId.

  // Morning Intentions textblocks
  const dpMorningIntentionsTB1 = dpTextblock([{ type: "paragraph", content: [{ type: "text", text: "Complete morning workout and stretching" }] }], dpSectionOccIds.morningIntentions);
  const dpMorningIntentionsTB2 = dpTextblock([{ type: "paragraph", content: [{ type: "text", text: "Review weekly goals and prioritize top 3 tasks" }] }], dpSectionOccIds.morningIntentions);
  const dpMorningIntentionsTB3 = dpTextblock([{ type: "paragraph", content: [{ type: "text", text: "Deep work session (2h uninterrupted) before lunch" }] }], dpSectionOccIds.morningIntentions);
  const dpMorningIntentionsTB4 = dpTextblock([{ type: "paragraph", content: [{ type: "text", text: "Evening reading + wind-down routine" }] }], dpSectionOccIds.morningIntentions);

  // Physical mini-textblocks (parented to the Physical list textblock)
  const dpPhysTB_morningWorkout = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.morningWorkout.id, "Morning Workout")] }], dpListTBOccIds.physical);
  const dpPhysTB_stretching     = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.stretching.id, "Stretching")] }], dpListTBOccIds.physical);
  const dpPhysTB_eveningRun     = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.eveningRun.id, "Evening Run")] }], dpListTBOccIds.physical);
  const dpPhysTB_drinkWater     = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.drinkWater.id, "Drink Water")] }], dpListTBOccIds.physical);
  const dpPhysTB_sleepLog       = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.sleepLog.id, "Sleep Log")] }], dpListTBOccIds.physical);

  // Mind & Soul mini-textblocks (parented to the Mind & Soul list textblock)
  const dpMindTB_meditation  = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.meditation.id, "Meditation")] }], dpListTBOccIds.mindSoul);
  const dpMindTB_reading     = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.reading.id, "Reading")] }], dpListTBOccIds.mindSoul);
  const dpMindTB_journaling  = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.journaling.id, "Daily Journal")] }], dpListTBOccIds.mindSoul);
  const dpMindTB_gratitude   = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.gratitude.id, "Gratitude Practice")] }], dpListTBOccIds.mindSoul);
  const dpMindTB_breathing   = dpTextblock([{ type: "paragraph", content: [ip(toolkitInstances.breathing.id, "Breathing")] }], dpListTBOccIds.mindSoul);

  // Nutrition mini-textblocks (parented to the Nutrition list textblock)
  const dpNutriTB_yogurt  = dpTextblock([{ type: "paragraph", content: [ip(nutritionInstances.greekYogurtBowl.id, "Greek Yogurt Bowl")] }], dpListTBOccIds.nutrition);
  const dpNutriTB_salad   = dpTextblock([{ type: "paragraph", content: [ip(nutritionInstances.greekSaladChicken.id, "Greek Salad + Chicken")] }], dpListTBOccIds.nutrition);
  const dpNutriTB_salmon  = dpTextblock([{ type: "paragraph", content: [ip(nutritionInstances.grilledSalmon.id, "Grilled Salmon")] }], dpListTBOccIds.nutrition);

  // Physical list textblock — H3 + mini-textblock pills (parented to Daily Log section)
  const dpPhysicalListTBMod = uid();
  _dpTbMods.push({ id: dpPhysicalListTBMod, userId, gridId, role: "instance", kind: "doc", label: "Physical" });
  _dpTbOccs.push({
    id: dpListTBOccIds.physical, userId, gridId, targetId: dpPhysicalListTBMod, targetType: "module",
    parentId: dpSectionOccIds.dailyLog, iteration: { mode: "persistent" }, fields: {},
    textmap: { type: "doc", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Physical" }] },
      dpPhysTB_morningWorkout, dpPhysTB_stretching, dpPhysTB_eveningRun, dpPhysTB_drinkWater, dpPhysTB_sleepLog,
    ]},
  });
  const dpPhysicalListPill = { type: "instancePill", attrs: { instanceId: dpPhysicalListTBMod, instanceLabel: "Physical", occurrenceId: dpListTBOccIds.physical, showIcon: false, pillDisplay: "block" } };

  // Mind & Soul list textblock — H3 + mini-textblock pills (parented to Daily Log section)
  const dpMindSoulListTBMod = uid();
  _dpTbMods.push({ id: dpMindSoulListTBMod, userId, gridId, role: "instance", kind: "doc", label: "Mind & Soul" });
  _dpTbOccs.push({
    id: dpListTBOccIds.mindSoul, userId, gridId, targetId: dpMindSoulListTBMod, targetType: "module",
    parentId: dpSectionOccIds.dailyLog, iteration: { mode: "persistent" }, fields: {},
    textmap: { type: "doc", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Mind & Soul" }] },
      dpMindTB_meditation, dpMindTB_reading, dpMindTB_journaling, dpMindTB_gratitude, dpMindTB_breathing,
    ]},
  });
  const dpMindSoulListPill = { type: "instancePill", attrs: { instanceId: dpMindSoulListTBMod, instanceLabel: "Mind & Soul", occurrenceId: dpListTBOccIds.mindSoul, showIcon: false, pillDisplay: "block" } };

  // Nutrition list textblock — H3 + mini-textblock pills (parented to Daily Log section)
  const dpNutritionListTBMod = uid();
  _dpTbMods.push({ id: dpNutritionListTBMod, userId, gridId, role: "instance", kind: "doc", label: "Nutrition" });
  _dpTbOccs.push({
    id: dpListTBOccIds.nutrition, userId, gridId, targetId: dpNutritionListTBMod, targetType: "module",
    parentId: dpSectionOccIds.dailyLog, iteration: { mode: "persistent" }, fields: {},
    textmap: { type: "doc", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Nutrition" }] },
      dpNutriTB_yogurt, dpNutriTB_salad, dpNutriTB_salmon,
    ]},
  });
  const dpNutritionListPill = { type: "instancePill", attrs: { instanceId: dpNutritionListTBMod, instanceLabel: "Nutrition", occurrenceId: dpListTBOccIds.nutrition, showIcon: false, pillDisplay: "block" } };

  // Brain Dump textblocks (parented to Brain Dump section)
  const dpBrainDumpTB1 = dpTextblock([{ type: "paragraph", content: [{ type: "text", marks: [{ type: "italic" }], text: "Dump anything on your mind — ideas, observations, snippets, things to follow up on." }] }], dpSectionOccIds.brainDump);
  const dpBrainDumpTB2 = dpTextblock([{ type: "paragraph" }], dpSectionOccIds.brainDump);

  // Section container textmaps (built from the pills above)
  const dpMorningIntentionsTextmap = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Morning Intentions" }] },
    { type: "paragraph", content: [
      { type: "text", text: "Today I want to focus on: " },
      { type: "text", marks: [{ type: "italic" }], text: "(what matters most today?)" },
    ]},
    dpMorningIntentionsTB1, dpMorningIntentionsTB2, dpMorningIntentionsTB3, dpMorningIntentionsTB4,
  ]};

  const dpDailyLogTextmap = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Daily Log" }] },
    { type: "paragraph", content: [{ type: "text", text: "Activities completed today:" }] },
    dpPhysicalListPill, dpMindSoulListPill, dpNutritionListPill,
  ]};

  const dpBrainDumpTextmap = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Brain Dump" }] },
    dpBrainDumpTB1, dpBrainDumpTB2,
  ]};

  const sampleJournalContent = {
    type: "doc",
    content: [
      // ── Header ────────────────────────────────────
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: todayFmt }] },

      // ── Morning Intentions — embedded section container ──
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.morningIntentions } },
      { type: "paragraph" },

      // ── Daily Log — embedded section container ──
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.dailyLog } },
      { type: "paragraph" },

      // ── Evening Reflection — Q&A embedded cards ──
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Evening Reflection" }] },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_wentWell } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_improved } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_gratitude } },
      { type: "paragraph" },

      // ── Brain Dump — embedded section container ──
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.brainDump } },
      { type: "paragraph" },
    ],
  };

  // Reuse user manifest folder IDs — one unified tree, not two separate manifests.
  // "Documents" and "Notes" are new subfolders under the user manifest root.
  const rootFolderIdForManifest = userManifestRootFolderId;
  const dayPagesFolderIdForManifest = dayPagesFolderId; // reuse existing Day Pages folder under Docs
  const docsFolderIdForManifest = uid();   // Documents folder (Stan, Gospel, profile docs) — created in STEP 6
  const notesFolderIdForManifest = uid(); // Notes folder holds multiple docs — created in STEP 6
  // dayPageDocOccId was pre-generated earlier (before sampleJournalContent) for textblock parentId
  // Parent doc IDs: Stan + Gospel + Philosopher's Stone (Notes merged into Philosophers Stone)
  const stanParentModId = uid();  const stanParentOccId = uid();
  const gospelParentModId = uid(); const gospelParentOccId = uid();
  const philParentModId = uid();  const philParentOccId = uid();

  // Pre-generate section occurrence IDs before parent doc creation (chicken-and-egg)
  const stanSectionOccIds  = _stanSections.map(() => uid());
  const notesSectionOccIds = _moreNotesSections.map(() => uid());

  // Pre-generate Gospel section occurrence IDs — split at "why this" line
  const gospelSectionData = _gospelNotesSections.map((section, i) => {
    const splitIdx = section.extraLines.findIndex(l => l.toLowerCase().includes("why this"));
    const mainExtraLines = splitIdx >= 0 ? section.extraLines.slice(0, splitIdx) : section.extraLines;
    const whyLines = splitIdx >= 0 ? section.extraLines.slice(splitIdx) : null;
    return { section, mainOccId: uid(), whyOccId: whyLines ? uid() : null, mainExtraLines, whyLines };
  });

  // Pre-generate Phil section occurrence IDs
  const philSectionOccIds = _philSections.map(() => uid());

  // Pre-generate flat notes parent doc IDs + section occurrence IDs
  const flatNotesParentIds = _flatNotesDefs.map(() => ({ modId: uid(), occId: uid() }));
  const flatNotesSectionOccIds = _flatNotesSections.map(def => def.sections.map(() => uid()));

  // Wire notebook doc containers to Day Page panel
  const notebookPanelOccIds = [];
  const notebookTreeOccIds = []; // track all tree occurrence IDs (for activeOccurrenceId default)

  // Helper: build textmap content array with H1 + paragraph + moduleEmbed blocks
  const makeParentDocTextmap = (label, occIds) => ({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: label }] },
      { type: "paragraph" },
      ...occIds.flatMap(occId => [
        { type: "moduleEmbed", attrs: { occurrenceId: occId } },
        { type: "paragraph" },
      ]),
    ],
  });

  // Parent docs in Literature folder: Stan + Gospel
  await new Module({ id: stanParentModId, userId, gridId, role: "page", kind: "doc", label: "Stan \u2014 Eminem", ownStyle: { bg: "#0d7a4a" }, styleMode: "own" }).save();
  await new Occurrence({
    id: stanParentOccId, userId, gridId, targetId: stanParentModId, targetType: "module",
    parentId: docsFolderIdForManifest, sortOrder: 0, iteration: { mode: "persistent" },
    occurrences: stanSectionOccIds,
    textmap: makeParentDocTextmap("Stan \u2014 Eminem", stanSectionOccIds),
  }).save();

  const gospelEmbedOccIds = gospelSectionData.flatMap(d => d.whyOccId ? [d.mainOccId, d.whyOccId] : [d.mainOccId]);
  await new Module({ id: gospelParentModId, userId, gridId, role: "page", kind: "doc", label: "Gospel of Thomas", ownStyle: { bg: "#5c1fa0" }, styleMode: "own" }).save();
  await new Occurrence({
    id: gospelParentOccId, userId, gridId, targetId: gospelParentModId, targetType: "module",
    parentId: docsFolderIdForManifest, sortOrder: 1, iteration: { mode: "persistent" },
    occurrences: gospelEmbedOccIds,
    textmap: makeParentDocTextmap("Gospel of Thomas", gospelEmbedOccIds),
  }).save();

  // Philosopher's Stone — ONE parent doc for ALL notes sections (morenotes + philosopherstone)
  await new Module({ id: philParentModId, userId, gridId, role: "page", kind: "doc", label: "Philosopher\u2019s Stone", ownStyle: { bg: "#9a7000" }, styleMode: "own" }).save();
  await new Occurrence({
    id: philParentOccId, userId, gridId, targetId: philParentModId, targetType: "module",
    parentId: notesFolderIdForManifest, sortOrder: 0, iteration: { mode: "persistent" },
    occurrences: [...notesSectionOccIds, ...philSectionOccIds],
    textmap: makeParentDocTextmap("Philosopher\u2019s Stone", [...notesSectionOccIds, ...philSectionOccIds]),
  }).save();

  // Flat notes parent docs in Notes folder (uses.md, PRAGMATIC.md, aispecs.md, banglespecs.md)
  for (const [fi, def] of _flatNotesDefs.entries()) {
    const { modId, occId } = flatNotesParentIds[fi];
    const sectionOccIds = flatNotesSectionOccIds[fi];
    await new Module({ id: modId, userId, gridId, role: "page", kind: "doc", label: def.label, ownStyle: { bg: def.bg }, styleMode: "own" }).save();
    await new Occurrence({
      id: occId, userId, gridId, targetId: modId, targetType: "module",
      parentId: notesFolderIdForManifest, sortOrder: 1 + fi, iteration: { mode: "persistent" },
      occurrences: sectionOccIds,
      textmap: makeParentDocTextmap(def.label, sectionOccIds),
    }).save();
  }

  // Journal Q&A containers: header = question markdown field, body = answer markdown field
  for (const def of journalQADefs) {
    const container = notebookDocContainers[def.key];
    const qFieldId  = fields[def.questionFieldKey].id;
    const aFieldId  = fields[def.answerFieldKey].id;
    const contOccId = qaContainerOccIds[def.key];

    // Seed the question text into the header-attached field value
    await new Occurrence({
      id: contOccId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: dayPageDocOccId,
      iteration: { mode: "persistent" },
      fields: {
        [qFieldId]: { value: def.seedQuestion, flow: "in" },
        [aFieldId]: { value: "",                flow: "in" },
      },
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(contOccId);
    notebookTreeOccIds.push(contOccId);
  }

  // Day page section containers — Morning Intentions, Daily Log, Brain Dump
  // These are embedded in the day page textmap via moduleEmbed nodes.
  // parentId = dayPageDocOccId so they appear as child occurrences of the day page.
  const dpSectionDefs = [
    { key: "morningIntentions", occId: dpSectionOccIds.morningIntentions, textmap: dpMorningIntentionsTextmap },
    { key: "dailyLog",          occId: dpSectionOccIds.dailyLog,          textmap: dpDailyLogTextmap },
    { key: "brainDump",         occId: dpSectionOccIds.brainDump,         textmap: dpBrainDumpTextmap },
  ];
  for (const def of dpSectionDefs) {
    const container = notebookDocContainers[`dp${def.key.charAt(0).toUpperCase()}${def.key.slice(1)}`];
    await new Occurrence({
      id: def.occId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: dayPageDocOccId,
      iteration: { mode: "persistent" },
      fields: {}, textmap: def.textmap,
    }).save();
  }

  // Weekly Review — doc container with moduleEmbed nodes (demonstrates D2 embed feature)
  // Embeds the three Q&A reflection containers inline so they all appear in one scroll.
  {
    const weeklyReviewTextmap = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Weekly Review" }] },
        { type: "paragraph", content: [{ type: "text", text: "A single view of your daily reflections. Each block below is a live embedded container — changes there reflect here. Embed any container with " }, { type: "text", marks: [{ type: "code" }], text: "@:" }, { type: "text", text: " in a doc editor." }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Evening Reflection" }] },
        { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_wentWell } },
        { type: "paragraph" },
        { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_improved } },
        { type: "paragraph" },
        { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_gratitude } },
        { type: "paragraph" },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Notes" }] },
        { type: "paragraph" },
      ],
    };
    const contOccId = uid();
    await new Occurrence({
      id: contOccId, userId, targetType: "module", targetId: notebookDocContainers.weeklyReview.id, gridId,
      viewId: notebookDocContainers.weeklyReview._viewId || null,
      parentId: dayPageDocOccId,
      iteration: { mode: "persistent" },
      fields: {}, textmap: weeklyReviewTextmap,
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(contOccId);
    notebookTreeOccIds.push(contOccId);
  }

  // Helper: creates a textblock creator function that queues module+occurrence records for batch save.
  // parentOccId = the container occurrence that owns these textblock instances.
  const _textblockModules = [];
  const _textblockOccurrences = [];
  function makeTextblockCreator(parentOccId) {
    return (paragraphNodes, subCreatorFn) => {
      const modId = uid();
      const occId = uid();
      let content;
      if (typeof subCreatorFn === "function") {
        const nestedCreator = makeTextblockCreator(occId);
        content = subCreatorFn(nestedCreator);
      } else {
        content = paragraphNodes;
      }
      _textblockModules.push({ id: modId, userId, gridId, role: "instance", kind: "doc", label: "" });
      _textblockOccurrences.push({
        id: occId, userId, gridId,
        targetId: modId, targetType: "module",
        parentId: parentOccId,
        iteration: { mode: "persistent" },
        textmap: { type: "doc", content },
        fields: {},
      });
      return { moduleId: modId, occurrenceId: occId };
    };
  }

  // Stan containers — lyrics wrapped in textblocks.
  for (const [i, section] of _stanSections.entries()) {
    const container = notebookDocContainers[`stan_${i}`];
    if (!container) continue;
    const contOccId = stanSectionOccIds[i];
    const rawContent = makeDocContent(section.lines).content;
    const wrappedContent = wrapTextInBlocks(rawContent, makeTextblockCreator(contOccId));
    await new Occurrence({
      id: contOccId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: stanParentOccId,
      sortOrder: i,
      iteration: { mode: "persistent" },
      fields: {}, textmap: { type: "doc", content: wrappedContent },
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(contOccId);
    notebookTreeOccIds.push(contOccId);
  }

  // Notes sections (morenotes.md) — all sections now under philParentOccId (Philosopher's Stone)
  for (const [i, section] of _moreNotesSections.entries()) {
    const sKey = `notebookMore_${i}`;
    const entry = notesBySectionKey[sKey];
    const container = notebookDocContainers[sKey];
    if (!container || !entry) continue;

    // Build body: instancePill blocks for actual sub-heading instances; plain markdown for extraLines
    let bodyContent;
    const contOccId = notesSectionOccIds[i];
    if ((entry.instances || []).length > 0) {
      const instOccPairs = [];
      for (const [j, inst] of entry.instances.entries()) {
        const instOccId = uid();
        const rawInstNodes = makeDocContent(inst.lines || []).content;
        const wrappedInstNodes = wrapTextInBlocks(rawInstNodes, makeTextblockCreator(instOccId));
        await new Occurrence({
          id: instOccId, userId, targetType: "module", targetId: inst.id, gridId,
          parentId: contOccId,
          sortOrder: j,
          iteration: { mode: "persistent" },
          fields: {}, textmap: { type: "doc", content: wrappedInstNodes },
          meta: { containerId: container.id },
        }).save();
        instOccPairs.push({ inst, instOccId });
      }
      containerInstOccs[container.id] = instOccPairs.map(p => p.instOccId);
      bodyContent = { type: "doc", content: instOccPairs.map(({ inst, instOccId }) => ({
        type: "paragraph",
        content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label, occurrenceId: instOccId, showIcon: false, pillDisplay: "block" } }],
      })) };
    } else {
      // Wrap plain markdown paragraphs in textblocks
      const rawNodes = makeDocContent(entry.extraLines || []).content;
      bodyContent = { type: "doc", content: wrapTextInBlocks(rawNodes, makeTextblockCreator(contOccId)) };
    }

    await new Occurrence({
      id: contOccId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: philParentOccId,
      sortOrder: i,
      iteration: { mode: "persistent" },
      fields: {}, textmap: bodyContent,
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(contOccId);
    notebookTreeOccIds.push(contOccId);
  }

  // Philosopher's Stone sections — sortOrder continues after notesSectionOccIds
  for (const [i] of _philSections.entries()) {
    const sKey = `notebookPhil_${i}`;
    const entry = notesBySectionKey[sKey];
    const container = notebookDocContainers[sKey];
    if (!container || !entry) continue;

    let bodyContent;
    const contOccId = philSectionOccIds[i];
    if ((entry.instances || []).length > 0) {
      const instOccPairs = [];
      for (const [j, inst] of entry.instances.entries()) {
        const instOccId = uid();
        const rawInstNodes = makeDocContent(inst.lines || []).content;
        const wrappedInstNodes = wrapTextInBlocks(rawInstNodes, makeTextblockCreator(instOccId));
        await new Occurrence({
          id: instOccId, userId, targetType: "module", targetId: inst.id, gridId,
          parentId: contOccId,
          sortOrder: j,
          iteration: { mode: "persistent" },
          fields: {}, textmap: { type: "doc", content: wrappedInstNodes },
          meta: { containerId: container.id },
        }).save();
        instOccPairs.push({ inst, instOccId });
      }
      containerInstOccs[container.id] = instOccPairs.map(p => p.instOccId);
      bodyContent = { type: "doc", content: instOccPairs.map(({ inst, instOccId }) => ({
        type: "paragraph",
        content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label, occurrenceId: instOccId, showIcon: false, pillDisplay: "block" } }],
      })) };
    } else {
      const rawNodes = makeDocContent(entry.extraLines || []).content;
      bodyContent = { type: "doc", content: wrapTextInBlocks(rawNodes, makeTextblockCreator(contOccId)) };
    }

    await new Occurrence({
      id: contOccId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: philParentOccId,
      sortOrder: notesSectionOccIds.length + i,
      iteration: { mode: "persistent" },
      fields: {}, textmap: bodyContent,
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(contOccId);
    notebookTreeOccIds.push(contOccId);
  }

  // Flat notes sections — wire section containers under their parent docs
  for (const [fi, def] of _flatNotesSections.entries()) {
    const parentOccId = flatNotesParentIds[fi].occId;
    const sectionOccIds = flatNotesSectionOccIds[fi];
    for (const [i, section] of def.sections.entries()) {
      const sKey = `${def.key}_${i}`;
      const entry = notesBySectionKey[sKey];
      const container = notebookDocContainers[sKey];
      if (!container || !entry) continue;

      const contOccId = sectionOccIds[i];
      let bodyContent;
      if ((entry.instances || []).length > 0) {
        const instOccPairs = [];
        for (const [j, inst] of entry.instances.entries()) {
          const instOccId = uid();
          const rawInstNodes = makeDocContent(inst.lines || []).content;
          const wrappedInstNodes = wrapTextInBlocks(rawInstNodes, makeTextblockCreator(instOccId));
          await new Occurrence({
            id: instOccId, userId, targetType: "module", targetId: inst.id, gridId,
            parentId: contOccId, sortOrder: j, iteration: { mode: "persistent" },
            fields: {}, textmap: { type: "doc", content: wrappedInstNodes },
            meta: { containerId: container.id },
          }).save();
          instOccPairs.push({ inst, instOccId });
        }
        containerInstOccs[container.id] = instOccPairs.map(p => p.instOccId);
        bodyContent = { type: "doc", content: instOccPairs.map(({ inst, instOccId }) => ({
          type: "paragraph",
          content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label, occurrenceId: instOccId, showIcon: false, pillDisplay: "block" } }],
        })) };
      } else {
        const rawNodes = makeDocContent(entry.extraLines || []).content;
        bodyContent = { type: "doc", content: wrapTextInBlocks(rawNodes, makeTextblockCreator(contOccId)) };
      }

      await new Occurrence({
        id: contOccId, userId, targetType: "module", targetId: container.id, gridId,
        viewId: container._viewId || null,
        parentId: parentOccId, sortOrder: i, iteration: { mode: "persistent" },
        fields: {}, textmap: bodyContent,
        meta: { panelId: panels.centerHub.id },
      }).save();
      notebookPanelOccIds.push(contOccId);
      notebookTreeOccIds.push(contOccId);
    }
  }

  const compRelModId = uid();
  const compRelOccId = uid();
  const compRelRawNodes = makeDocContent(_compRelLines.slice(0, 80)).content;
  const compRelWrapped = wrapTextInBlocks(compRelRawNodes, makeTextblockCreator(compRelOccId));
  await new Module({ id: compRelModId, userId, gridId, role: "page", kind: "doc", label: "Comparative Religion", ownStyle: { bg: "#3a58d0" }, styleMode: "own" }).save();
  await new Occurrence({
    id: compRelOccId, userId, gridId, targetId: compRelModId, targetType: "module",
    parentId: notesFolderIdForManifest, sortOrder: 5, iteration: { mode: "persistent" },
    textmap: { type: "doc", content: compRelWrapped },
  }).save();

  // Sample Grid — TipTap doc with inline table (no separate View needed)
  const sampleGridModId = uid();
  const sampleGridOccId = uid();
  const _gridCols = ["Habit", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const _gridRows = [
    ["Morning Workout", "", "", "", "", "", "", ""],
    ["Read 30 min", "", "", "", "", "", "", ""],
    ["Meditate", "", "", "", "", "", "", ""],
    ["Drink Water", "", "", "", "", "", "", ""],
    ["Journal", "", "", "", "", "", "", ""],
  ];
  const _makeCell = (text, isHeader) => ({
    type: isHeader ? "tableHeader" : "tableCell",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });
  const sampleGridTextmap = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Weekly Habit Tracker" }] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: _gridCols.map(c => _makeCell(c, true)) },
          ..._gridRows.map(row => ({ type: "tableRow", content: row.map(c => _makeCell(c, false)) })),
        ],
      },
      { type: "paragraph" },
    ],
  };
  await new Module({ id: sampleGridModId, userId, gridId, role: "page", kind: "doc", label: "Sample Grid", ownStyle: { bg: "#2a5050" }, styleMode: "own" }).save();
  await new Occurrence({
    id: sampleGridOccId, userId, gridId, targetId: sampleGridModId, targetType: "module",
    parentId: notesFolderIdForManifest, sortOrder: 8, iteration: { mode: "persistent" },
    textmap: sampleGridTextmap,
  }).save();

  const gospelTextModId = uid();
  const gospelTextOccId = uid();
  const gospelTextRawNodes = makeDocContent(_gospelTextLines).content;
  const gospelTextWrapped = wrapTextInBlocks(gospelTextRawNodes, makeTextblockCreator(gospelTextOccId));
  await new Module({ id: gospelTextModId, userId, gridId, role: "page", kind: "doc", label: "Gospel of Thomas (Text)", ownStyle: { bg: "#189070" }, styleMode: "own" }).save();
  await new Occurrence({
    id: gospelTextOccId, userId, gridId, targetId: gospelTextModId, targetType: "module",
    parentId: notesFolderIdForManifest, sortOrder: 6, iteration: { mode: "persistent" },
    textmap: { type: "doc", content: gospelTextWrapped },
  }).save();

  // Gospel sections — embedded in Gospel parent doc, split at "Why this" line
  let gospelEmbedSortOrder = 0;
  for (const [gi, gd] of gospelSectionData.entries()) {
    const container = notebookDocContainers[`notebookGospel_${gi}`];
    if (!container) continue;

    // Create instance occurrences for sub-headings (H3 within each H2 section)
    const instOccPairs = [];
    for (const inst of (gd.section.instances || [])) {
      const instOccId = uid();
      await new Occurrence({
        id: instOccId, userId, targetType: "module", targetId: inst.id, gridId,
        iteration: { mode: "persistent" },
        fields: {}, textmap: makeDocContent(inst.lines || []),
        meta: { containerId: container.id },
      }).save();
      instOccPairs.push({ inst, instOccId });
    }
    if (instOccPairs.length > 0) {
      containerInstOccs[container.id] = instOccPairs.map(p => p.instOccId);
    }

    const extraContentNodes = makeDocContent(gd.mainExtraLines || [])
      .content.filter(n => n.type !== "paragraph" || n.content?.some(c => c.text?.trim()));
    const wrappedExtra = wrapTextInBlocks(extraContentNodes, makeTextblockCreator(gd.mainOccId));
    const mainBodyNodes = [
      ...instOccPairs.map(({ inst, instOccId }) => ({
        type: "paragraph",
        content: [{ type: "instancePill", attrs: { instanceId: inst.id, instanceLabel: inst.label, occurrenceId: instOccId, showIcon: true, pillDisplay: "block" } }],
      })),
      ...wrappedExtra,
    ];

    // Main section container
    await new Occurrence({
      id: gd.mainOccId, userId, targetType: "module", targetId: container.id, gridId,
      viewId: container._viewId || null,
      parentId: gospelParentOccId,
      sortOrder: gospelEmbedSortOrder++,
      iteration: { mode: "persistent" },
      fields: {}, textmap: { type: "doc", content: mainBodyNodes.length > 0 ? mainBodyNodes : [{ type: "paragraph" }] },
      meta: { panelId: panels.centerHub.id },
    }).save();
    notebookPanelOccIds.push(gd.mainOccId);
    notebookTreeOccIds.push(gd.mainOccId);

    // "Why This Matters" container (if split found)
    if (gd.whyOccId && gd.whyLines) {
      const whyKey = `notebookGospel_${gi}_why`;
      const whyContainer = notebookDocContainers[whyKey];
      if (whyContainer) {
        const whyRawNodes = makeDocContent(gd.whyLines).content
          .filter(n => n.type !== "paragraph" || n.content?.some(c => c.text?.trim()));
        const whyWrapped = wrapTextInBlocks(whyRawNodes, makeTextblockCreator(gd.whyOccId));
        await new Occurrence({
          id: gd.whyOccId, userId, targetType: "module", targetId: whyContainer.id, gridId,
          viewId: whyContainer._viewId || null,
          parentId: gospelParentOccId,
          sortOrder: gospelEmbedSortOrder++,
          iteration: { mode: "persistent" },
          fields: {}, textmap: { type: "doc", content: whyWrapped.length > 0 ? whyWrapped : [{ type: "paragraph" }] },
          meta: { panelId: panels.centerHub.id },
        }).save();
        notebookPanelOccIds.push(gd.whyOccId);
        notebookTreeOccIds.push(gd.whyOccId);
      }
    }
  }

  // Note: notebook container ordering is tracked via occurrence.occurrences (child occ ids),
  // not on the module. Module is a template — it has no occurrences array in new architecture.

  // Batch-save day page textblocks (generated before sampleJournalContent above)
  if (_dpTbMods.length > 0) {
    await Module.insertMany(_dpTbMods);
    await Occurrence.insertMany(_dpTbOccs);
  }

  // Batch-save all notebook section textblock modules + occurrences generated above
  if (_textblockModules.length > 0) {
    await Module.insertMany(_textblockModules);
  }
  if (_textblockOccurrences.length > 0) {
    await Occurrence.insertMany(_textblockOccurrences);
  }

  // ===================================================================
  // STEP 6: Create Manifest, Folders, Docs, and View for Day Page panel
  // ===================================================================

  // Unified tree — root folder is the user manifest root (created in STEP 0).
  // No separate "files" root folder — everything lives under the user manifest.
  const rootFolderId = rootFolderIdForManifest; // = userManifestRootFolderId

  // Category folders (for field/operation organization in CommandCenter)
  await new Folder({ id: fitnessFolderId, userId, gridId, parentId: null, name: "Fitness", folderType: "category", sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: nutritionFolderId, userId, gridId, parentId: null, name: "Nutrition", folderType: "category", sortOrder: 1, isExpanded: true }).save();

  // Day Pages folder — reuses dayPagesFolderId (already under Docs from STEP 0)
  const filesDayPagesFolderId = dayPagesFolderIdForManifest;

  // Documents folder (Stan, Gospel, profile docs) — new subfolder under user manifest root
  const docsFolderId = docsFolderIdForManifest;
  await new Folder({ id: docsFolderId, userId, gridId, parentId: rootFolderId, name: "Documents", folderType: "normal", sortOrder: 3, isExpanded: true }).save();

  // Notes folder at root level (Philosopher's Stone + flat notes)
  const notesFolderId = notesFolderIdForManifest;
  await new Folder({ id: notesFolderId, userId, gridId, parentId: rootFolderId, name: "Notes", folderType: "normal", sortOrder: 4, isExpanded: true }).save();

  // Folder page modules — one for each non-root folder so clicking a folder in the tree opens a page
  const folderPageDefs = [
    { folderId: rootFolderId, name: "Root" },
    { folderId: dayPagesFolderId, name: "Day Pages" },
    { folderId: docsFolderId, name: "Documents" },
    { folderId: notesFolderId, name: "Notes" },
    { folderId: trackingFolderId, name: "Trackers" },
    { folderId: drawingFolderId, name: "Drawing" },
  ];
  for (const fpDef of folderPageDefs) {
    const fpModId = uid();
    await new Module({ id: fpModId, userId, gridId, role: "page", kind: "folder", label: fpDef.name }).save();
    await new Occurrence({
      id: uid(), userId, gridId,
      targetId: fpModId, targetType: "module",
      parentId: fpDef.folderId,
      sortOrder: -1, // before other content
      iteration: { mode: "persistent" },
      fields: {}, meta: {},
    }).save();
  }

  // Welcome artifact module + occurrence (replaces legacy Doc model)
  const welcomeModuleId = uid();
  const welcomeModule = new Module({
    id: welcomeModuleId, userId, gridId,
    role: "container", kind: "artifact",
    label: "Welcome to Moduli",
    meta: { folderId: rootFolderId },
  });
  await welcomeModule.save();

  const welcomeOccId = uid();
  const welcomeTextmap = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Welcome to Moduli" }] },
      { type: "paragraph", content: [{ type: "text", text: "This is a sample document. Edit it, add fields with @, or drag instances from your panels." }] },
    ],
  };
  await new Occurrence({
    id: welcomeOccId, userId, gridId,
    targetId: welcomeModuleId, targetType: "module",
    parentId: rootFolderId, sortOrder: 3,
    iteration: { mode: "persistent" },
    textmap: welcomeTextmap,
  }).save();

  // ── DAY PAGE TEMPLATE MODULE (one module, reused for all day pages) ──────────────────
  // All day pages are OCCURRENCES of this single module.
  // The operation finds them by targetId + dayDate field value matching the active date.
  const dayPageTemplateModuleId = uid();
  await new Module({
    id: dayPageTemplateModuleId, userId, gridId,
    role: "page", kind: "doc",
    label: "Day Page",
    fieldBindings: [{ fieldId: fields.dayDate.id }],
    meta: { folderId: filesDayPagesFolderId, isDayPageTemplate: true },
  }).save();

  // ── TEMPLATE OCCURRENCE — the archetype used by COMPUTE_TEXTMAP_FROM_TEMPLATE ──
  // NOT shown as a real page (meta.isTemplate skips it in FIND_OCCURRENCE queries).
  // Contains [Date] and [DayOfWeek] tokens that get substituted when filling new pages.
  const dayPageTemplateOccId = uid();
  // Template textmap — same section structure as the sample day page.
  // New day pages created by the operation use COMPUTE_TEXTMAP_FROM_TEMPLATE which copies this.
  // Sections are embedded as moduleEmbed nodes pointing to the SAME section containers as the sample day page
  // (they're persistent containers, not per-day — the user edits them fresh each day).
  const templateTextmap = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "[Date]" }] },
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.morningIntentions } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.dailyLog } },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Evening Reflection" }] },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_wentWell } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_improved } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: qaContainerOccIds.journalQA_gratitude } },
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: dpSectionOccIds.brainDump } },
      { type: "paragraph" },
    ],
  };
  await new Occurrence({
    id: dayPageTemplateOccId, userId, gridId,
    targetId: dayPageTemplateModuleId, targetType: "module",
    parentId: filesDayPagesFolderId,
    sortOrder: 999,
    iteration: { mode: "persistent" },
    meta: { isTemplate: true },
    textmap: templateTextmap,
  }).save();

  // ── YESTERDAY'S DAY PAGE — pre-seeded with full journal content ───────────────────
  const yesterdayDate = daysAgo(1);
  const dayPageLabel = yesterdayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  await new Occurrence({
    id: dayPageDocOccId, userId, gridId,
    targetId: dayPageTemplateModuleId, targetType: "module",
    parentId: filesDayPagesFolderId,
    sortOrder: 0,
    iteration: { mode: "specific", timeValue: yesterdayDate.toISOString(), timeFilter: "daily" },
    fields: { [fields.dayDate.id]: { value: yesterdayDate.toISOString(), flow: "in" } },
    textmap: sampleJournalContent,
  }).save();

  // Manifest — root tree for this grid
  // Reuse the user manifest — unified tree for all content
  const manifestId = userManifestId;

  // View for the Day Page (Notebook page) — artifact view with tree sidebar
  const dayPageViewId = uid();
  const dayPageView = new View({
    id: dayPageViewId,
    userId,
    gridId,
    viewType: "display",
    hasTree: true,
    manifestId,
    layout: { sidebarWidth: 192 },
    activeOccurrenceId: dayPageDocOccId,
  });
  await dayPageView.save();

  // View for the centerHub page panel — tracks which page tab is active.
  // IMPORTANT: hasTree:false + no manifestId — adding hasTree would cause the panel to render
  // as a TreePanelContent (notebook branch) instead of the hasPages branch.
  // activeOccurrenceId will be updated to notebookPageOccId after page occurrences are created.
  await new View({
    id: centerHubViewId,
    userId,
    gridId,
    viewType: "board",
    hasTree: false,
    activeOccurrenceId: schedPageOccId,
    layout: {},
  }).save();

  // ── DAY PAGE AUTO-CREATE OPERATION ──
  // Dynamic page creation via generic pipeline actions (no hardcoded day page logic).
  // Triggers on load + navigation. Checks if a module with today's page name exists,
  // creates it if not, and updates the view to show it.
  // ── Day Page Auto-Create Operation ───────────────────────────────────────────────────
  // Lego pipeline: each step does exactly one thing.
  //   1. Find occurrence of dayPageTemplateModule where dayDate field = active date
  //   2. If missing: compute filled textmap from template, then create the occurrence
  //   3. Update the centerHub view to show the found/created day page
  // Template occurrence (dayPageTemplateOccId) is skipped in FIND_OCCURRENCE because meta.isTemplate=true.
  const dayPageAutoCreateOp = new Operation({
    id: uid(), userId, gridId,
    name: "Day Page Auto-Create",
    description: "Find or create today's day page. Lego pipeline: FIND → IF missing: COMPUTE_TEXTMAP + CREATE → UPDATE_VIEW.",
    triggerType: "onNavigation",
    triggerTypes: ["onNavigation"],
    triggerConfig: {},
    enabled: true,
    pipeline: {
      sources: [{ type: "grid" }],
      steps: [
        // Step 1 — find existing day page occurrence for the active date
        {
          id: uid(), type: "action",
          config: {
            type: "FIND_OCCURRENCE",
            targetIdExpr: `literal:${dayPageTemplateModuleId}`,
            dateFieldId: fields.dayDate.id,
            dateExpr: "$activeDate",
            resultVar: "$dayPage",
            resultIdVar: "$dayPageId",
          },
        },
        // Step 2 — if not found, build the page from template and create it
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ left: "$dayPageId", comparator: "IS_EMPTY" }] },
          then: [
            // 2a: Clone template textmap, substituting [Date] and [DayOfWeek] tokens
            {
              id: uid(), type: "action",
              config: {
                type: "COMPUTE_TEXTMAP_FROM_TEMPLATE",
                templateOccIdExpr: `literal:${dayPageTemplateOccId}`,
                tokens: [
                  { token: "[Date]",      valueExpr: "$activeDateLabel" },
                  { token: "[DayOfWeek]", valueExpr: "$activeDayOfWeek" },
                ],
                resultVar: "$dayPageTextmap",
              },
            },
            // 2b: Create new occurrence with the filled textmap and today's date field
            {
              id: uid(), type: "action",
              config: {
                type: "CREATE_OCCURRENCE_FOR_MODULE",
                moduleIdExpr: `literal:${dayPageTemplateModuleId}`,
                dateFieldId: fields.dayDate.id,
                dateExpr: "$activeDate",
                textmapVar: "$dayPageTextmap",
                parentId: dayPagesFolderIdForManifest,
                resultIdVar: "$dayPageId",
              },
            },
          ],
          else: [],
        },
        // Step 3 — show the found/created page in the centerHub view
        {
          id: uid(), type: "action",
          config: { type: "UPDATE_VIEW", viewId: dayPageViewId, activeOccurrenceId: "$dayPageId" },
        },
      ],
    },
  });
  await dayPageAutoCreateOp.save();

  // Textmap files: write uploads/md/{occurrenceId}.md for each doc container occurrence.
  // These are written by the server on every textmap update — this seeds them on first reset.
  const uploadsDir = join(__mdDirname, "../uploads");
  const mdFilesDir = join(uploadsDir, "md");
  fs.mkdirSync(mdFilesDir, { recursive: true });
  // Notebook doc container occurrences are written below by the wiring loop (notebookPanelOccIds).
  // Source markdown files (morenotes.md, gospelofthomasnotes.md) remain in the repo root for parsing.

  // Stan is now in the notebook panel as doc containers (see STEP 5 notebook wiring above)

  // ===================================================================
  // STEP 7: Create Operation models
  // ===================================================================

  // Sample Operation — count completed tasks today using explicit LOOP steps
  const sampleOperationId = uid();
  const sampleOperation = new Operation({
    id: sampleOperationId,
    userId,
    gridId,
    name: "Count Completed Tasks",
    description: "Loops all occurrences today, counts those with completed = true",
    targetFieldId: fields.totalCompleted.id,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onNavigation"],
    triggerConfig: { onChange: { allowedFields: [fields.completed.id] }, onNavigation: {} },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId: fields.completed.id, timeFilter: "daily", flowFilter: "any", as: "$item",
          body: [
            {
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$item.value", comparator: "IS", right: "true" }] },
              then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
              else: [],
            },
          ],
        },
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId: fields.totalCompleted.id, sourceExpr: "$count" } },
      ],
    },
    sortOrder: 0,
  });
  await sampleOperation.save();

  // Sample Pipeline Operation — notify when spending exceeds budget threshold
  const budgetAlertOpId = uid();
  const budgetAlertOp = new Operation({
    id: budgetAlertOpId,
    userId,
    gridId,
    name: "Budget Alert",
    description: "Notifies when daily spending exceeds $50",
    triggerType: "manual",
    enabled: true,
    pipeline: {
      sources: [
        {
          id: uid(),
          variableName: "summary",
          entityType: "grid",
          entityId: gridId,
        },
      ],
      steps: [
        {
          id: uid(),
          type: "if",
          condition: {
            operator: "AND",
            rules: [
              {
                id: uid(),
                left: `$summary.${fields.totalSpent.id}`,
                comparator: "GREATER",
                right: "50",
              },
            ],
          },
          then: [
            {
              id: uid(),
              type: "action",
              config: { type: "NOTIFY", message: "Daily spending exceeds $50 — check your budget!" },
            },
            {
              id: uid(),
              type: "action",
              config: { type: "SHOW_VALUE", targetFieldId: fields.totalSpent.id, sourceExpr: `$summary.${fields.totalSpent.id}` },
            },
          ],
          else: [],
        },
      ],
    },
    sortOrder: 1,
  });
  await budgetAlertOp.save();

  // Schedule Completion Tracker — fires on completed change or drop into schedule
  // Uses explicit LOOP steps (not AGGREGATE black box)
  const scheduleCompletionOpId = uid();
  const scheduleCompletionOp = new Operation({
    id: scheduleCompletionOpId,
    userId,
    gridId,
    name: "Schedule: Completion Tracker",
    description: "Recalculates tasks completed and time spent when completed is checked or an item is dropped into the schedule",
    triggerType: "onChange",
    triggerTypes: ["onChange", "onDrop"],
    triggerConfig: {
      onChange: { allowedFields: [fields.completed.id] },
      onDrop: { targetPanelId: panels.centerHub.id },
    },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        {
          id: uid(), type: "if",
          condition: {
            operator: "OR",
            rules: [
              { id: uid(), left: "$trigger.value", comparator: "IS", right: "true" },
              { id: uid(), left: "$trigger.toContainerId", comparator: "IS_NOT_EMPTY", right: "" },
            ],
          },
          then: [
            // Count completed tasks
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$done", value: 0 } },
            {
              id: uid(), type: "loop",
              over: "field_occurrences", fieldId: fields.completed.id, timeFilter: "daily", flowFilter: "any", as: "$item",
              body: [
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$item.value", comparator: "IS", right: "true" }] },
                  then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$done", by: 1 } }],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId: fields.totalCompleted.id, sourceExpr: "$done" } },
            // Sum time spent
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$mins", value: 0 } },
            {
              id: uid(), type: "loop",
              over: "field_occurrences", fieldId: fields.duration.id, timeFilter: "daily", flowFilter: "any", as: "$item",
              body: [
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$item.value", comparator: "IS_NOT_EMPTY", right: "" }] },
                  then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$mins", expr: "$item.value" } }],
                  else: [],
                },
              ],
            },
            { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId: fields.totalDuration.id, sourceExpr: "$mins", targetValue: 480, targetPeriod: "daily" } },
            { id: uid(), type: "action", config: { type: "NOTIFY", message: "Schedule updated" } },
          ],
          else: [],
        },
      ],
    },
    sortOrder: 2,
  });
  await scheduleCompletionOp.save();

  // ---- Schedule: Set Date & Time Slot (onCreate) ----
  // When any occurrence is dropped into the schedule panel, stamp the active filter
  // date onto its date field and the container label onto its timeslot field.
  const scheduleDropOp = new Operation({
    id: uid(),
    userId, gridId,
    name: "Schedule: Stamp Date & Time Slot",
    description: "When dropped into the schedule, sets date = active filter date and timeslot = container label",
    triggerType: "onCreate",
    triggerTypes: ["onCreate"],
    triggerConfig: { onCreate: { panelId: panels.centerHub.id } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: fields.date.id, valueExpr: "$parentFilter.date" } },
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: fields.timeslot.id, valueExpr: "$trigger.containerLabel" } },
      ],
    },
    sortOrder: 3,
  });
  await scheduleDropOp.save();

  // ---- Schedule: Clear Date & Time Slot (onMove out) ----
  // When an occurrence is moved OUT of the schedule panel, clear date and timeslot.
  const scheduleMoveOutOp = new Operation({
    id: uid(),
    userId, gridId,
    name: "Schedule: Clear Date & Time Slot",
    description: "When moved out of the schedule panel, clears date and timeslot fields",
    triggerType: "onMove",
    triggerTypes: ["onMove"],
    triggerConfig: { onMove: { fromPanelId: panels.centerHub.id } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: fields.date.id, value: null } },
        { id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: fields.timeslot.id, value: null } },
      ],
    },
    sortOrder: 4,
  });
  await scheduleMoveOutOp.save();

  // Daily Question Randomizer operations — one per Q&A container.
  // Fires onLoad; checks if the question was already picked today before randomizing.
  const journalQAOpDefs = [
    {
      name: "Daily Question: What Went Well",
      poolContainerId: wentWellQPoolId,
      questionFieldId: fields.wentWellQuestion.id,
      occurrenceId: qaContainerOccIds.journalQA_wentWell,
    },
    {
      name: "Daily Question: Improvement",
      poolContainerId: improvedQPoolId,
      questionFieldId: fields.improvedQuestion.id,
      occurrenceId: qaContainerOccIds.journalQA_improved,
    },
    {
      name: "Daily Question: Gratitude",
      poolContainerId: gratitudeQPoolId,
      questionFieldId: fields.gratitudeQuestion.id,
      occurrenceId: qaContainerOccIds.journalQA_gratitude,
    },
  ];

  for (const def of journalQAOpDefs) {
    const op = new Operation({
      id: uid(),
      userId, gridId,
      name: def.name,
      description: "Picks a random question from the pool unless one was already set today.",
      triggerType: "onLoad",
      triggerTypes: ["onLoad", "onNavigation"],
      enabled: true,
      pipeline: {
        sources: [],
        steps: [
          // Check if question was already randomized for the active nav date
          {
            id: uid(), type: "if",
            condition: {
              operator: "AND",
              rules: [{
                left: `occ:${def.occurrenceId}.${dateFieldId}.value`,
                comparator: "IS",
                right: "$activeDate",
              }],
            },
            then: [],  // Already set for this date — skip
            else: [
              // Pick a random question label from the pool
              {
                id: uid(), type: "action",
                config: {
                  type: "PICK_RANDOM_FROM_POOL",
                  poolId: def.poolContainerId,
                  varName: "$question",
                },
              },
              // Write it to the question field on the Q&A container occurrence
              {
                id: uid(), type: "action",
                config: {
                  type: "SET_FIELD_VALUE",
                  occurrenceIdExpr: `literal:${def.occurrenceId}`,
                  fieldId: def.questionFieldId,
                  valueExpr: "$question",
                  flow: "replace",
                },
              },
              // Stamp date = $activeDate so we don't re-randomize when navigating back
              {
                id: uid(), type: "action",
                config: {
                  type: "SET_FIELD_VALUE",
                  occurrenceIdExpr: `literal:${def.occurrenceId}`,
                  fieldId: dateFieldId,
                  valueExpr: "$activeDate",
                  flow: "replace",
                },
              },
            ],
          },
        ],
      },
    });
    await op.save();
  }

  // ===================================================================
  // STEP 8: Save a sample template (Morning Routine bundle)
  // ===================================================================
  const morningRoutineTemplate = {
    id: uid(),
    name: "Morning Routine",
    items: [
      { instanceId: toolkitInstances.morningWorkout.id, fieldDefaults: {} },
      { instanceId: toolkitInstances.stretching.id, fieldDefaults: {} },
      { instanceId: toolkitInstances.drinkWater.id, fieldDefaults: {} },
      { instanceId: toolkitInstances.takeMeds.id, fieldDefaults: {} },
      { instanceId: toolkitInstances.meditation.id, fieldDefaults: {} },
      { instanceId: toolkitInstances.moodCheck.id, fieldDefaults: {} },
    ],
    createdAt: new Date(),
  };

  await Grid.findByIdAndUpdate(grid._id, { $push: { templates: morningRoutineTemplate } });

  // ===================================================================
  // STEP 6c: Profile Data — containers+instances appended to Notebook panel
  // Profile categories added AFTER the journal/notes sections already wired in STEP 5
  // Uses $push so it appends, not replaces
  await createProfileData({
    userId,
    gridId,
    notebookPanelId: panels.centerHub.id,
  });

  // ===================================================================
  // STEP 9: Seed 30 days of historical occurrence data
  // (so weekly/monthly aggregations show real numbers, not 0)
  // ===================================================================
  const historicalDays = [
    { n: 1,  steps: 8200,  duration: 75,  water: 56, calories: 280, pages: 18, spent: 32,  income: 0    },
    { n: 2,  steps: 11500, duration: 95,  water: 64, calories: 410, pages: 35, spent: 65,  income: 200  },
    { n: 3,  steps: 6800,  duration: 45,  water: 40, calories: 180, pages: 12, spent: 28,  income: 0    },
    { n: 4,  steps: 9100,  duration: 80,  water: 72, calories: 320, pages: 28, spent: 45,  income: 0    },
    { n: 5,  steps: 10300, duration: 110, water: 68, calories: 450, pages: 42, spent: 89,  income: 500  },
    { n: 6,  steps: 7600,  duration: 60,  water: 52, calories: 220, pages: 15, spent: 22,  income: 0    },
    { n: 7,  steps: 9800,  duration: 85,  water: 60, calories: 360, pages: 24, spent: 55,  income: 0    },
    { n: 8,  steps: 12100, duration: 100, water: 76, calories: 430, pages: 38, spent: 120, income: 1500 },
    { n: 9,  steps: 5400,  duration: 30,  water: 36, calories: 140, pages: 8,  spent: 18,  income: 0    },
    { n: 10, steps: 8700,  duration: 70,  water: 64, calories: 300, pages: 20, spent: 42,  income: 0    },
    { n: 11, steps: 10500, duration: 90,  water: 68, calories: 390, pages: 32, spent: 67,  income: 0    },
    { n: 12, steps: 7200,  duration: 55,  water: 48, calories: 210, pages: 16, spent: 35,  income: 200  },
    { n: 13, steps: 9400,  duration: 80,  water: 72, calories: 340, pages: 26, spent: 48,  income: 0    },
    { n: 14, steps: 11000, duration: 105, water: 80, calories: 470, pages: 45, spent: 95,  income: 1500 },
    { n: 15, steps: 6500,  duration: 40,  water: 44, calories: 160, pages: 10, spent: 25,  income: 0    },
    { n: 16, steps: 8900,  duration: 75,  water: 60, calories: 310, pages: 22, spent: 38,  income: 0    },
    { n: 17, steps: 10800, duration: 95,  water: 72, calories: 400, pages: 36, spent: 72,  income: 0    },
    { n: 18, steps: 7800,  duration: 65,  water: 56, calories: 250, pages: 18, spent: 44,  income: 200  },
    { n: 19, steps: 9200,  duration: 80,  water: 68, calories: 330, pages: 28, spent: 53,  income: 0    },
    { n: 20, steps: 11300, duration: 110, water: 76, calories: 460, pages: 40, spent: 88,  income: 500  },
    { n: 21, steps: 6100,  duration: 35,  water: 40, calories: 150, pages: 9,  spent: 20,  income: 0    },
    { n: 22, steps: 8400,  duration: 70,  water: 64, calories: 290, pages: 21, spent: 41,  income: 0    },
    { n: 23, steps: 10200, duration: 88,  water: 68, calories: 370, pages: 30, spent: 63,  income: 1500 },
    { n: 24, steps: 7400,  duration: 58,  water: 52, calories: 230, pages: 14, spent: 31,  income: 0    },
    { n: 25, steps: 9600,  duration: 82,  water: 72, calories: 350, pages: 27, spent: 50,  income: 0    },
    { n: 26, steps: 11800, duration: 108, water: 80, calories: 440, pages: 43, spent: 92,  income: 200  },
    { n: 27, steps: 5900,  duration: 32,  water: 36, calories: 145, pages: 7,  spent: 17,  income: 0    },
    { n: 28, steps: 8600,  duration: 72,  water: 60, calories: 305, pages: 19, spent: 40,  income: 0    },
    { n: 29, steps: 10700, duration: 92,  water: 76, calories: 415, pages: 34, spent: 78,  income: 500  },
    { n: 30, steps: 7100,  duration: 50,  water: 48, calories: 200, pages: 13, spent: 27,  income: 0    },
  ];

  for (const day of historicalDays) {
    const date = daysAgo(day.n);

    // Physical activity (workout + steps)
    await createOccurrence({
      targetType: "module",
      targetId: toolkitInstances.morningWorkout.id,
      meta: { containerId: scheduleContainers["slot_7_0"].id, historicalSeed: true },
      date: date.toISOString(),
      fields: {
        [fields.completed.id]: fv(true, "in"),
        [fields.duration.id]: fv(day.duration, "in"),
        [fields.calories.id]: fv(day.calories, "in"),
        [fields.timeslot.id]: { value: "7:00am", flow: "in" },
      },
    });

    // Evening run (steps tracking)
    await createOccurrence({
      targetType: "module",
      targetId: toolkitInstances.eveningRun.id,
      meta: { containerId: scheduleContainers["slot_18_30"].id, historicalSeed: true },
      date: date.toISOString(),
      fields: {
        [fields.completed.id]: fv(day.steps > 9000, "in"),
        [fields.steps.id]: fv(day.steps, "in"),
        [fields.duration.id]: fv(Math.round(day.duration * 0.4), "in"),
        [fields.timeslot.id]: { value: "6:30pm", flow: "in" },
      },
    });

    // Water intake
    await createOccurrence({
      targetType: "module",
      targetId: toolkitInstances.drinkWater.id,
      meta: { containerId: scheduleContainers["slot_17_0"].id, historicalSeed: true },
      date: date.toISOString(),
      fields: {
        [fields.completed.id]: fv(day.water >= 64, "in"),
        [fields.water.id]: fv(day.water, "in"),
        [fields.timeslot.id]: { value: "5:00pm", flow: "in" },
      },
    });

    // Reading
    if (day.pages > 0) {
      await createOccurrence({
        targetType: "module",
        targetId: toolkitInstances.reading.id,
        meta: { containerId: scheduleContainers["slot_9_0"].id, historicalSeed: true },
        date: date.toISOString(),
        fields: {
          [fields.completed.id]: fv(true, "in"),
          [fields.pages.id]: fv(day.pages, "in"),
          [fields.duration.id]: fv(Math.round(day.pages * 1.5), "in"),
          [fields.timeslot.id]: { value: "9:00am", flow: "in" },
        },
      });
    }

    // Financial: expense
    if (day.spent > 0) {
      await createOccurrence({
        targetType: "module",
        targetId: toolkitInstances.trackExpense.id,
        meta: { containerId: toolkitContainers.financial.id, historicalSeed: true },
        date: date.toISOString(),
        fields: {
          [fields.completed.id]: fv(true, "in"),
          [fields.amount.id]: fv(day.spent, "out"),
        },
      });
    }

    // Financial: income (only on days with income)
    if (day.income > 0) {
      await createOccurrence({
        targetType: "module",
        targetId: toolkitInstances.logIncome.id,
        meta: { containerId: toolkitContainers.financial.id, historicalSeed: true },
        date: date.toISOString(),
        fields: {
          [fields.completed.id]: fv(true, "in"),
          [fields.income.id]: fv(day.income, "in"),
        },
      });
    }
  }

  // Wire panels to grid with placement
  // Layout:
  // | Toolkit(0,0) | CenterHub(0,1 h=2) | Goals(0,2)    |
  // | Todo(1,0)    | CenterHub cont.    | Accounts(1,2) |
  // CenterHub is a page panel with 3 tabs: Schedule / Notebook / Freepad
  const panelPlacements = [
    { key: "dailyToolkit", row: 0, col: 0, width: 1, height: 1 },
    { key: "todoList", row: 1, col: 0, width: 1, height: 1 },
    { key: "centerHub", row: 0, col: 1, width: 1, height: 2, viewId: centerHubViewId, filterOverride: { [dateFieldId]: today.toISOString() } },
    { key: "dailyGoals", row: 0, col: 2, width: 1, height: 1 },
    { key: "accounts", row: 1, col: 2, width: 1, height: 1 },
  ];

  const gridOccs = [];
  for (const { key, row, col, width, height, viewId: panelViewId, filterOverride: panelFilterOverride } of panelPlacements) {
    const occId = await createOccurrence({
      targetType: "module",
      targetId: panels[key].id,
      meta: {},
      placement: { row, col, width, height },
      viewId: panelViewId || null,
      filterOverride: panelFilterOverride !== undefined ? panelFilterOverride : null,
    });
    gridOccs.push(occId);
  }

  await Grid.findByIdAndUpdate(grid._id, { $set: { occurrences: gridOccs } });

  // Panel-local pages are tracked via panelOcc.occurrences[] — no per-panel folders needed.
  // The Global folder in the user manifest serves as the page library.

  // ===================================================================
  // DEFERRED WIRING: Apply all occurrence ordering now that ALL occurrences exist
  // Panel occurrences (created above in panelPlacements loop) can now be found by targetId.
  // Container occurrences (created throughout STEP 5) can now be found by targetId.
  // ===================================================================

  // Wire container occurrences: set instance occurrence ordering
  for (const [containerModuleId, instOccIds] of Object.entries(containerInstOccs)) {
    if (instOccIds.length > 0) {
      await Occurrence.findOneAndUpdate(
        { targetId: containerModuleId, gridId },
        { $set: { occurrences: instOccIds } }
      );
    }
  }

  // Wire panel occurrences via page modules (Panel → Page → Containers)
  // Each board panel (Toolkit, Todo, Goals, Accounts) gets a single page module.
  // centerHub is handled separately below (3 pages: Schedule, Notebook, Freepad).
  const pageWiring = [
    { panelKey: "dailyToolkit", pageLabel: "Daily Toolkit", containerOccIds: toolkitPanelOccIds, folderId: trackingFolderId },
    { panelKey: "todoList", pageLabel: "Todo List", containerOccIds: todoPanelOccIds, folderId: trackingFolderId },
    { panelKey: "dailyGoals", pageLabel: "Daily Goals", containerOccIds: goalPanelOccIds, folderId: trackingFolderId },
    { panelKey: "accounts", pageLabel: "Accounts", containerOccIds: accountPanelOccIds, folderId: trackingFolderId },
  ];

  for (const [pi, { panelKey, pageLabel, containerOccIds, folderId }] of pageWiring.entries()) {
    const pageModId = uid();
    await new Module({ id: pageModId, userId, gridId, role: "page", kind: "board", label: pageLabel }).save();
    const pageOccId = uid();
    await new Occurrence({
      id: pageOccId, userId, gridId,
      targetId: pageModId, targetType: "module",
      parentId: folderId,
      sortOrder: pi,
      occurrences: containerOccIds,
      iteration: { mode: "persistent" },
      fields: {}, meta: {},
    }).save();
    await Occurrence.findOneAndUpdate(
      { targetId: panels[panelKey].id, gridId },
      { $set: { occurrences: [pageOccId] } }
    );
  }

  // ── centerHub: 3-page panel (Schedule / Notebook / Freepad) ──
  // Freepad canvas manifest (tree sidebar for canvas pages)
  const freepadRootFolderId = uid();
  await new Folder({ id: freepadRootFolderId, userId, gridId, parentId: null, name: "Canvas Root", folderType: "normal", sortOrder: 0, isExpanded: true }).save();
  const freepadManifestId = uid();
  await new Manifest({ id: freepadManifestId, userId, name: "Canvas", manifestType: "files", rootFolderId: freepadRootFolderId }).save();

  // Canvas pages — each is a canvas container module; occurrence has parentId = rootFolder (shows in tree)
  const canvasPageDefs = [
    {
      label: "Ideas Board",
      cards: [
        { label: "Brainstorm",    x: 24,  y: 32  },
        { label: "Inspiration",   x: 210, y: 28  },
        { label: "Projects",      x: 390, y: 30  },
        { label: "Quick Notes",   x: 24,  y: 180 },
        { label: "Research",      x: 210, y: 185 },
        { label: "Experiments",   x: 390, y: 178 },
        { label: "Side Projects", x: 24,  y: 330 },
        { label: "Archive",       x: 210, y: 335 },
      ],
    },
    {
      label: "Task Map",
      cards: [
        { label: "Backlog",     x: 24,  y: 32  },
        { label: "In Progress", x: 200, y: 28  },
        { label: "Done",        x: 380, y: 30  },
        { label: "Fix login bug",      x: 24,  y: 180 },
        { label: "Add dark mode",      x: 24,  y: 270 },
        { label: "Write tests",        x: 200, y: 178 },
        { label: "Update docs",        x: 200, y: 268 },
        { label: "Deploy v1.0",        x: 380, y: 178 },
        { label: "Code review",        x: 380, y: 268 },
      ],
    },
    {
      label: "Mind Map",
      cards: [
        { label: "Core Goal",    x: 210, y: 140 },
        { label: "Health",       x: 24,  y: 32  },
        { label: "Work",         x: 390, y: 32  },
        { label: "Learning",     x: 24,  y: 240 },
        { label: "Relationships",x: 390, y: 240 },
        { label: "Exercise",     x: 24,  y: 150 },
        { label: "Nutrition",    x: 24,  y: 330 },
        { label: "Deep Work",    x: 390, y: 150 },
        { label: "Side Projects",x: 390, y: 330 },
      ],
    },
  ];

  let freepadFirstPageOccId = null;
  for (let pi = 0; pi < canvasPageDefs.length; pi++) {
    const pageDef = canvasPageDefs[pi];
    const pageMod = new Module({ id: uid(), userId, gridId, role: "container", kind: "canvas", label: pageDef.label, defaultDragMode: "move" });
    await pageMod.save();
    // Page occurrence lives in the tree folder (parentId = freepadRootFolderId)
    const pageOccId = uid();
    const cardOccIds = [];
    for (const card of pageDef.cards) {
      const cardMod = new Module({ id: uid(), userId, gridId, role: "instance", kind: "list", label: card.label, fieldBindings: [] });
      await cardMod.save();
      const cardOccId = await createOccurrence({ targetType: "module", targetId: cardMod.id, meta: { x: card.x, y: card.y, containerId: pageMod.id } });
      cardOccIds.push(cardOccId);
    }
    await new Occurrence({ id: pageOccId, userId, targetType: "module", targetId: pageMod.id, gridId, parentId: freepadRootFolderId, sortOrder: pi, occurrences: cardOccIds, iteration: { mode: "persistent" }, fields: {}, meta: {} }).save();
    if (pi === 0) freepadFirstPageOccId = pageOccId;
  }

  // Canvas view for Freepad page — tracks active canvas sub-page
  const freepadViewId = uid();
  await new View({ id: freepadViewId, userId, gridId, viewType: "canvas", hasTree: true, manifestId: freepadManifestId, activeOccurrenceId: freepadFirstPageOccId, layout: {} }).save();

  // Create page modules for centerHub: Schedule + Journal (day page viewer) + Freepad
  const schedPageMod = new Module({ id: uid(), userId, gridId, role: "page", kind: "board", label: "Schedule" });
  await schedPageMod.save();
  // Journal: stable tab whose content is controlled by dayPageViewId.activeOccurrenceId.
  // The operation updates this view when navigating dates — which doc to show changes, the tab stays.
  const journalPageMod = new Module({ id: uid(), userId, gridId, role: "page", kind: "doc", label: "Day Page" });
  await journalPageMod.save();
  const freepadPageMod = new Module({ id: uid(), userId, gridId, role: "page", kind: "canvas", label: "Freepad" });
  await freepadPageMod.save();

  // Schedule page occurrence (uses pre-generated ID so centerHubView can reference it)
  await new Occurrence({
    id: schedPageOccId, userId, gridId,
    targetId: schedPageMod.id, targetType: "module",
    parentId: trackingFolderId,
    sortOrder: 0,
    occurrences: scheduleOccIds,
    iteration: { mode: "persistent" },
    fields: {}, meta: {},
  }).save();

  // Journal page occurrence — stable panel tab with viewId → dayPageView (hasTree:true)
  // parentId: null — this is a panel navigation tab, not a user content page. Keeps it out of the tree.
  const journalPageOccId = uid();
  await new Occurrence({
    id: journalPageOccId, userId, gridId,
    targetId: journalPageMod.id, targetType: "module",
    parentId: null,
    viewId: dayPageViewId,
    sortOrder: -3, // before template (999) and yesterday's page (0)
    occurrences: [],
    iteration: { mode: "persistent" },
    fields: {}, meta: {},
  }).save();

  // Freepad page occurrence (canvas view handles sub-page navigation)
  const freepadPageOccId = uid();
  await new Occurrence({
    id: freepadPageOccId, userId, gridId,
    targetId: freepadPageMod.id, targetType: "module",
    parentId: drawingFolderId,
    sortOrder: 0,
    viewId: freepadViewId,
    occurrences: [],
    iteration: { mode: "persistent" },
    fields: {}, meta: {},
  }).save();

  // Parent docs (Stan, Gospel, Phil, flat notes) are now role:"page" kind:"doc" directly —
  // no per-section page wrappers needed. They live in Documents/Notes folders and can be
  // opened from the tree on demand via openPage (which pins + navigates).

  // Wire centerHub panel occurrence: Schedule + Journal (stable day page tab) + Freepad
  // journalPageOccId has viewId→dayPageView (hasTree:true) — the operation updates activeOccurrenceId
  // in that view to navigate to today's day page content. dayPageDocOccId stays in the Day Pages folder.
  await Occurrence.findOneAndUpdate(
    { targetId: panels.centerHub.id, gridId },
    { $set: { occurrences: [schedPageOccId, journalPageOccId, freepadPageOccId] } }
  );

  // Update centerHub view to default to Schedule on first load
  // (today's day page will be created by the auto-create operation)
  await View.findOneAndUpdate(
    { id: centerHubViewId },
    { $set: { activeOccurrenceId: schedPageOccId } }
  );

  // Return summary
  return {
    gridId,
    summary: {
      fields: Object.keys(fields).length,
      instances: Object.keys(allInstances).length,
      containers: Object.keys(allContainers).length,
      panels: Object.keys(panels).length,
      manifests: 2,  // existing + user manifest
      views: 1,
      folders: "dynamic",  // Root, DayPages, Documents, Profile, QuickNotes, Fitness, Nutrition, user manifest root/global/grid + panel folders
      textmapDocs: "dynamic",  // 1 welcome + 1 sample journal + 3 journal Q&A containers + stan sections + morenotes sections (8) + gospel sections (8). Each written to uploads/md/{occurrenceId}.md
      namedFilters: 3,
      operations: displayOperations.length + 3,  // display ops + sampleOperation + budgetAlertOp + scheduleCompletionOp
      templates: 1,
      historicalDays: 30,  // 30 days of seeded occurrence history
    },
  };
}

/**
 * Checks if a user already has data
 */
export async function userHasData(userId) {
  const gridCount = await Grid.countDocuments({ userId });
  return gridCount > 0;
}

export default createDefaultUserData;
