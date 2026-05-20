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
  makeDayPageBuildTasksCompletedOp,
  makeStampDateTimeSlotOp,
  makeClearDateOnMoveOutOp,
  makeTrackerOp,
} from "../utils/liveSystemBuilders.js";
import fs from "fs";
import { parseSectionsWithInstances } from "../utils/mdParsers.js";
import { makeDocContent, buildMergedDocTextmap, inlineToTipTap } from "../utils/docBuilders.js";

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
  // isTask: hidden boolean marker on every task module. Tracker: Tasks
  // Completed filters on `isTask IS true` so non-task items in Schedule
  // (mood logs, water logs, etc.) don't pad the count.
  const isTaskFieldId    = uid();
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
    library:      uid(),
    refs:         uid(),
  };
  const opCategoryIds = {
    trackers: uid(),
    schedule: uid(),
    daypage:  uid(),
    bills:    uid(),
    library:  uid(),
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
      type: "text",
      inputEnabled: true,
      displayEnabled: false,
      folderId: fieldCategoryIds.scheduling,
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
    // isTask: hidden boolean marker. Pre-stamped true on every task module's
    // occurrence so trackers can filter `isTask IS true` to exclude non-task
    // schedule items from the count.
    isTask: {
      id: isTaskFieldId,
      name: "Is Task",
      type: "boolean",
      inputEnabled: true,
      displayEnabled: false,
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
      name: "Movies Watched",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Movie" },
          { path: "date",  header: "When" },
        ],
      },
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
      name: "Books Read",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Book" },
          { path: "pages", header: "Pages", width: 70 },
          { path: "date",  header: "When" },
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
      name: "Podcasts Listened",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Podcast" },
          { path: "date",  header: "When" },
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
      name: "Courses Taken",
      type: "text",
      inputEnabled: false,
      displayEnabled: true,
      meta: {},
      displayConfig: {
        columns: [
          { path: "label", header: "Course" },
          { path: "date",  header: "When" },
        ],
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
      meta: { prefix: "", postfix: " done" },
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
      // Tracker: Today's Moods pushes {mood, date} rows.
      displayConfig: {
        columns: [
          { path: "mood", header: "Mood" },
          { path: "date", header: "When" },
        ],
      },
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
      id: uid(), name: "Total Reps", type: "number", inputEnabled: false, displayEnabled: true,
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
      id: uid(), name: "Protein", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalCarbs: {
      id: uid(), name: "Carbs", type: "number", inputEnabled: false, displayEnabled: true,
      meta: { postfix: "g" }, displayConfig: {},
    },
    totalFats: {
      id: uid(), name: "Fats", type: "number", inputEnabled: false, displayEnabled: true,
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

    // "Answered Daily Question" — toolkit-side task counterpart to the
    // day-page Daily Question container. Same field set as journaling
    // (journalQuestion + journalAnswer) but with date binding so a
    // drag-to-Schedule stamp brings it into the same linked group as the
    // day-page container. When dragged onto Schedule, Schedule: Stamp Date
    // & Time Slot writes fields[dateFieldId]; the day-page container
    // already carries that date from Day Page: Build's defaultFields. Both
    // now share the link value — propagateBoundFieldWrite from BoundHeader
    // / BoundBody on the day-page side fans out writes to this occurrence.
    // (v1 note: edits made directly on this instance's field rows do NOT
    // auto-propagate back to the day-page side; only binding-driven writes
    // through the header dropdown / body editor fan out.)
    answeredDailyQuestion: {
      id: uid(), label: "Answered Daily Question", kind: "list",
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
      // accountSelect (legacy string-options) replaced by accountRef
      // (occurrence-pointer → instance under Accounts page) per B4. Every
      // amount-bearing task now uses accountRef.
      id: uid(), label: "Track Expense", kind: "list",
      defaultDragMode: "copy",
      styleMode: "own", ownStyle: { bg: "rgba(29,138,48,0.15)", textColor: "#4cba64" },
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
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
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
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
        { fieldId: fields.accountRef.id, role: "input", order: 1 },
        { fieldId: fields.amount.id, role: "input", order: 2 },
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

    // === CREATIVE (9th wellness — Make / Explore / Express) ===
    sketch: {
      id: uid(), label: "Sketch / Draw", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    writeCreative: {
      id: uid(), label: "Creative Writing", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },
    playMusic: {
      id: uid(), label: "Play Music", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
      ],
    },
    photograph: {
      id: uid(), label: "Photograph", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.notes.id, role: "input", order: 1 },
      ],
    },
    craftMake: {
      id: uid(), label: "Craft / Make", kind: "list",
      defaultDragMode: "copy",
      fieldBindings: [
        { fieldId: fields.completed.id, role: "input", order: 0 },
        { fieldId: fields.duration.id, role: "input", order: 1 },
        { fieldId: fields.notes.id, role: "input", order: 2 },
      ],
    },

    // === BILLS (Bills page — under Library folder; B3 from carry-over plan) ===
    // Every bill instance carries the FULL bill-schedule field set (cadence /
    // day / cadenceN / anchor / amount / account + the op-computed billNextDue).
    // Bill: Compute Next Due reads cadence+day+anchor to write billNextDue;
    // Schedule Due: Seed COPY_LINKs a Pay Bill task into Schedule Due when
    // billNextDue falls in the active window. Cancel Subscription targets the
    // Subscriptions container via subscriptionRef.
    netflixSub: {
      id: uid(), label: "Netflix", kind: "list",
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
      id: uid(), label: "Spotify", kind: "list",
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
      id: uid(), label: "iCloud+", kind: "list",
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
      id: uid(), label: "Electric", kind: "list",
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
      id: uid(), label: "Water", kind: "list",
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
      id: uid(), label: "Internet", kind: "list",
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
      id: uid(), label: "Phone", kind: "list",
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
      id: uid(), label: "Car Insurance", kind: "list",
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
      id: uid(), label: "Renter Insurance", kind: "list",
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
      id: uid(), label: "Student Loan", kind: "list",
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
      id: uid(), label: "Rent / Mortgage", kind: "list",
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
      // Generic Pay Bill task. The user picks which bill via the billRef
      // dropdown; Schedule Due: Seed copies this task into the Schedule Due
      // container for each bill whose billNextDue falls in the active window
      // (B3+C2 — Bills page + ops). amount + account default to whatever's
      // on the selected bill but stay user-editable per instance.
      id: uid(), label: "Pay Bill", kind: "list",
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
      id: uid(), label: "Cancel Subscription", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.completed.id,       role: "input", order: 0 },
        { fieldId: fields.subscriptionRef.id, role: "input", order: 1 },
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
        { fieldId: fields.accountRef.id, role: "input", order: 0 },
        { fieldId: fields.amount.id,     role: "input", order: 1 },
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
        { fieldId: fields.accountRef.id, role: "input", order: 0 },
        { fieldId: fields.amount.id, role: "input", order: 1 },
        { fieldId: fields.due.id, role: "input", order: 2 },
        { fieldId: fields.daysUntilDue.id, role: "display", order: 3 },
      ],
    },
    signUpClass: {
      id: uid(), label: "Sign up for cooking class", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.accountRef.id, role: "input", order: 0 },
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
    // carInsurance (Car Insurance Renewal) intentionally removed per B9 —
    // recurring renewals now live as a bill in the Bills page
    // (carInsuranceBill, every-180-days cadence). The Pay Bill task in the
    // Financial wellness page picks it up via billRef; Schedule Due: Seed
    // (C2 follow-up) copies it into Schedule Due when billNextDue lands.

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
    creativeSummary: {
      // New — pairs with the 9th wellness (Creative). Mirrors other
      // wellness-summary instances: completed + total duration aggregate
      // sketch / writeCreative / playMusic / photograph / craftMake.
      id: uid(), label: "Creative Expression", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalCompleted.id, role: "display", order: 0 },
        { fieldId: fields.totalDuration.id, role: "display", order: 1 },
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
      id: uid(), label: "Workout", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.totalRepsToday.id, role: "display", order: 0 },
        { fieldId: fields.totalSteps.id, role: "display", order: 1 },
      ],
    },
    nutritionGoal: {
      id: uid(), label: "Nutrition", kind: "list",
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
    // B8 — granular accounts. Net Worth + bill aggregations alongside the
    // existing checking/savings/etc. Display fields reused; aggregator ops
    // can be wired later to feed them (TBD follow-up).
    netWorth: {
      id: uid(), label: "Net Worth", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.netBalance.id, role: "display", order: 0 },
      ],
    },
    totalSubscriptions: {
      id: uid(), label: "Total Subscriptions", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "display", order: 0 },
      ],
    },
    monthlyBills: {
      id: uid(), label: "Monthly Bills", kind: "list",
      defaultDragMode: "move",
      fieldBindings: [
        { fieldId: fields.amount.id, role: "display", order: 0 },
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

  // ── Toolkit containers ───────────────────────────────────────────────────────
  // Daily Toolkit is now a FOLDER with 11 wellness pages inside; the containers
  // below are sub-groupings WITHIN each wellness page (not top-level dimensions
  // anymore). Physical splits into 4 daily-habit groups; Physical-Fitness into
  // 6 muscle groups; Physical-Nutrition into 5 meal types; the rest are single
  // containers per page until the user wants finer breakdown.
  const PHYS_BG  = "#b44a1a";
  const INTEL_BG = "#1562b0";
  const EMO_BG   = "#a02158";
  const SOC_BG   = "#c49000";
  const SPIR_BG  = "#6427c5";
  const OCC_BG   = "#0d7a52";
  const FIN_BG   = "#1d8a30";
  const ENV_BG   = "#0779a0";
  const CRE_BG   = "#c2399a"; // magenta — Creative wellness (NEW)
  const toolkitContainerMods = {
    // Physical (general daily habits) — 4 sub-containers
    physicalMovement:  { id: uid(), label: "Movement",  styleMode: "own", ownStyle: { bg: PHYS_BG } },
    physicalHydration: { id: uid(), label: "Hydration", styleMode: "own", ownStyle: { bg: PHYS_BG } },
    physicalMeds:      { id: uid(), label: "Medication",styleMode: "own", ownStyle: { bg: PHYS_BG } },
    physicalSleep:     { id: uid(), label: "Sleep",     styleMode: "own", ownStyle: { bg: PHYS_BG } },

    // Physical-Fitness — 6 muscle-group containers
    chestExercises:     { id: uid(), label: "Chest",     styleMode: "own", ownStyle: { bg: PHYS_BG } },
    backExercises:      { id: uid(), label: "Back",      styleMode: "own", ownStyle: { bg: PHYS_BG } },
    legsExercises:      { id: uid(), label: "Legs",      styleMode: "own", ownStyle: { bg: PHYS_BG } },
    shouldersExercises: { id: uid(), label: "Shoulders", styleMode: "own", ownStyle: { bg: PHYS_BG } },
    armsExercises:      { id: uid(), label: "Arms",      styleMode: "own", ownStyle: { bg: PHYS_BG } },
    cardioExercises:    { id: uid(), label: "Cardio",    styleMode: "own", ownStyle: { bg: PHYS_BG } },

    // Physical-Nutrition — 5 meal-type containers
    mealBreakfast:   { id: uid(), label: "Breakfast",   styleMode: "own", ownStyle: { bg: PHYS_BG } },
    mealLunch:       { id: uid(), label: "Lunch",       styleMode: "own", ownStyle: { bg: PHYS_BG } },
    mealSnack:       { id: uid(), label: "Snack",       styleMode: "own", ownStyle: { bg: PHYS_BG } },
    mealDinner:      { id: uid(), label: "Dinner",      styleMode: "own", ownStyle: { bg: PHYS_BG } },
    mealIngredients: { id: uid(), label: "Ingredients", styleMode: "own", ownStyle: { bg: PHYS_BG } },

    // Single container per remaining wellness page
    intellectual:  { id: uid(), label: "Intellectual",   styleMode: "own", ownStyle: { bg: INTEL_BG } },
    emotional:     { id: uid(), label: "Emotional",      styleMode: "own", ownStyle: { bg: EMO_BG  } },
    social:        { id: uid(), label: "Social",         styleMode: "own", ownStyle: { bg: SOC_BG  } },
    spiritual:     { id: uid(), label: "Spiritual",      styleMode: "own", ownStyle: { bg: SPIR_BG } },
    occupational:  { id: uid(), label: "Occupational",   styleMode: "own", ownStyle: { bg: OCC_BG  } },
    financial:     { id: uid(), label: "Financial",      styleMode: "own", ownStyle: { bg: FIN_BG  } },
    environmental: { id: uid(), label: "Environmental",  styleMode: "own", ownStyle: { bg: ENV_BG  } },
    creative:      { id: uid(), label: "Creative",       styleMode: "own", ownStyle: { bg: CRE_BG  } }, // NEW
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
    creativeGoal:      { id: uid(), label: "Creative",      styleMode: "own", ownStyle: { bg: "#c2399a" } },
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
    ...todoContainerMods,
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
  // Toolkit containers — now grouped by wellness PAGE (folder-based Daily Toolkit).
  // Physical (general) splits into 4 daily-habit groups. Physical-Fitness splits
  // into 6 muscle groups. Physical-Nutrition splits into 5 meal types. Other
  // wellness pages keep a single container until the user wants finer breakdown.
  const physMovementContOccId  = uid();
  const physHydrationContOccId = uid();
  const physMedsContOccId      = uid();
  const physSleepContOccId     = uid();
  const chestExContOccId      = uid();
  const backExContOccId       = uid();
  const legsExContOccId       = uid();
  const shouldersExContOccId  = uid();
  const armsExContOccId       = uid();
  const cardioExContOccId     = uid();
  const mealBreakfastContOccId   = uid();
  const mealLunchContOccId       = uid();
  const mealSnackContOccId       = uid();
  const mealDinnerContOccId      = uid();
  const mealIngredientsContOccId = uid();
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

  // Movies Watched / Books Read / Podcasts Listened / Courses Taken goal containers
  const moviesWatchedGoalContOccId  = uid();
  const booksReadGoalContOccId      = uid();
  const podcastsListenedGoalContOccId = uid();
  const coursesTakenGoalContOccId   = uid();

  // ── Container→instance mappings (now grouped by wellness sub-container) ────
  // Each key is a CONTAINER (matches toolkitContainerMods key). instKeys lists
  // the instance modules that live in that container. The wellness PAGE
  // structure (which containers belong to which page) is defined separately
  // in `wellnessPages` below.
  const toolkitMappings = {
    // Physical (general) — split daily habits into 4 sub-containers
    physicalMovement:  { contOccId: physMovementContOccId,  contModKey: "physicalMovement",  instKeys: ["morningWorkout", "eveningRun", "stretching"] },
    physicalHydration: { contOccId: physHydrationContOccId, contModKey: "physicalHydration", instKeys: ["drinkWater"] },
    physicalMeds:      { contOccId: physMedsContOccId,      contModKey: "physicalMeds",      instKeys: ["takeMeds"] },
    physicalSleep:     { contOccId: physSleepContOccId,     contModKey: "physicalSleep",     instKeys: ["sleepLog"] },

    // Physical-Fitness — split 30 exercises across 6 muscle groups
    chestExercises:     { contOccId: chestExContOccId,     contModKey: "chestExercises",     instKeys: ["benchPress", "inclinePress", "chestFly", "pushUps", "cableCrossover"] },
    backExercises:      { contOccId: backExContOccId,      contModKey: "backExercises",      instKeys: ["deadlift", "pullUps", "bentRow", "latPulldown", "seatedRow"] },
    legsExercises:      { contOccId: legsExContOccId,      contModKey: "legsExercises",      instKeys: ["squat", "legPress", "lunges", "legCurl", "calfRaise"] },
    shouldersExercises: { contOccId: shouldersExContOccId, contModKey: "shouldersExercises", instKeys: ["overheadPress", "lateralRaise", "frontRaise", "facePull", "shrugs"] },
    armsExercises:      { contOccId: armsExContOccId,      contModKey: "armsExercises",      instKeys: ["bicepCurl", "hammerCurl", "tricepDip", "skullCrusher", "tricepPushdown"] },
    cardioExercises:    { contOccId: cardioExContOccId,    contModKey: "cardioExercises",    instKeys: ["running", "cycling", "jumpRope", "rowMachine", "burpees"] },

    // Physical-Nutrition — meal types
    mealBreakfast:    { contOccId: mealBreakfastContOccId,   contModKey: "mealBreakfast",   instKeys: ["greekYogurtBowl", "scrambledEggs", "oatmealBerries", "avocadoToast", "smoothieBowl"] },
    mealLunch:        { contOccId: mealLunchContOccId,       contModKey: "mealLunch",       instKeys: ["greekSaladChicken", "tunaWrap", "lentilSoup", "quinoaBowl", "hummusPita"] },
    mealSnack:        { contOccId: mealSnackContOccId,       contModKey: "mealSnack",       instKeys: ["almonds", "olivesHummus", "cheeseCrackers", "mixedBerries", "proteinBar"] },
    mealDinner:       { contOccId: mealDinnerContOccId,      contModKey: "mealDinner",      instKeys: ["grilledSalmon", "chickenSouvlaki", "lambKofta", "pastaMarinara", "stuffedPeppers"] },
    mealIngredients:  { contOccId: mealIngredientsContOccId, contModKey: "mealIngredients", instKeys: ["oliveOil", "chickpeas", "lemonGarlic", "wholeGrainBread", "greekOlives"] },

    // Remaining wellness pages — single container each
    intellectual:  { contOccId: intellectualContOccId, contModKey: "intellectual",  instKeys: ["reading", "podcast", "watchMovie", "onlineCourse", "brainGames", "journaling", "answeredDailyQuestion"] },
    emotional:     { contOccId: emotionalContOccId,    contModKey: "emotional",     instKeys: ["gratitude", "meditation", "breathing", "moodCheck", "selfCare"] },
    social:        { contOccId: socialContOccId,       contModKey: "social",        instKeys: ["callFriend", "familyTime", "socialEvent", "helpSomeone"] },
    spiritual:     { contOccId: spiritualContOccId,    contModKey: "spiritual",     instKeys: ["prayer", "natureWalk", "spiritualReading", "mindfulness"] },
    occupational:  { contOccId: occupationalContOccId, contModKey: "occupational",  instKeys: ["deepWork", "meeting", "emailBlock", "skillDev", "networking"] },
    // Financial wellness — daily finance habits + Pay Bill + Cancel Sub
    // (moved here from Todo List per user spec; Pay Bill drags into Schedule
    // via the upcoming Schedule Due: Seed op, Cancel Subscription targets
    // the Bills page's Subscriptions container via subscriptionRef).
    financial:     { contOccId: financialContOccId,    contModKey: "financial",     instKeys: ["budgetReview", "trackExpense", "purchase", "logIncome", "investmentCheck", "savingsGoal", "payBills", "cancelSub"] },
    environmental: { contOccId: environmentalContOccId,contModKey: "environmental", instKeys: ["cleanDesk", "declutter", "plantCare", "recycling", "ecoAction"] },
    creative:      { contOccId: creativeContOccId,     contModKey: "creative",      instKeys: ["sketch", "writeCreative", "playMusic", "photograph", "craftMake"] },
  };

  // Wellness PAGE → containers (used in Task 12 to wire 11 wellness pages
  // under the Daily Toolkit folder). The grid panel at [0,0] hosts ALL of
  // these pages as tabs; the manifest tree shows them under the Daily Toolkit
  // folder so the user can navigate them by name.
  const wellnessPages = [
    { key: "physical",         label: "Physical",          containers: ["physicalMovement", "physicalHydration", "physicalMeds", "physicalSleep"] },
    { key: "physicalFitness",  label: "Physical - Fitness",containers: ["chestExercises", "backExercises", "legsExercises", "shouldersExercises", "armsExercises", "cardioExercises"] },
    { key: "physicalNutrition",label: "Physical - Nutrition", containers: ["mealBreakfast", "mealLunch", "mealSnack", "mealDinner", "mealIngredients"] },
    { key: "intellectual",     label: "Intellectual",      containers: ["intellectual"] },
    { key: "emotional",        label: "Emotional",         containers: ["emotional"] },
    { key: "social",           label: "Social",            containers: ["social"] },
    { key: "spiritual",        label: "Spiritual",         containers: ["spiritual"] },
    { key: "occupational",     label: "Occupational",      containers: ["occupational"] },
    { key: "financial",        label: "Financial",         containers: ["financial"] },
    { key: "environmental",    label: "Environmental",     containers: ["environmental"] },
    { key: "creative",         label: "Creative",          containers: ["creative"] },
  ];

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
      // Pre-fill a sensible default amount on toolkit instances that bind fields.amount
      // so "Spent Today" / "Net Balance" trackers show non-zero values on first run.
      const toolkitDefaultAmounts = {
        trackExpense: 35,  // generic tracked expense (~coffee + lunch)
        purchase:     22,  // small purchase
        savingsGoal:  50,  // contribution toward a savings target
        payBills:     85,  // generic pay-bill default until user picks billRef
        cancelSub:    15,  // subscription cancellation fee / last charge
      };
      if (toolkitDefaultAmounts[instKey] !== undefined) {
        defaultFields[fields.amount.id] = fv(toolkitDefaultAmounts[instKey], "out");
      }
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
    fileTaxes:       daysFromNow(38),
    quarterlyReview: daysFromNow(21),
  };

  const todoMappings = {
    todoHome:     { contOccId: todoHomeContOccId,     contModKey: "todoHome",     instKeys: ["buyGroceries", "cleanGarage", "fixLeakyFaucet", "returnBooks", "organizePantry"] },
    // todoFinance — Pay Bill + Cancel Subscription moved to Daily Toolkit's
    // Financial wellness page (recurring finance tasks belong with the rest
    // of the financial daily habits, not with Todo List one-offs).
    todoFinance:  { contOccId: todoFinanceContOccId,  contModKey: "todoFinance",  instKeys: ["renewLicense", "dentistAppt", "fileInsurance"] },
    todoWork:     { contOccId: todoWorkContOccId,     contModKey: "todoWork",     instKeys: ["orderSupplies", "backupComputer", "updatePortfolio", "prepPresentation"] },
    todoPersonal: { contOccId: todoPersonalContOccId, contModKey: "todoPersonal", instKeys: ["callMom", "planVacation", "birthdayGift", "signUpClass"] },
    todoPlan:     { contOccId: todoPlanContOccId,     contModKey: "todoPlan",     instKeys: ["moduliLaunch", "doctorCheckup", "fileTaxes", "quarterlyReview"] },
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
      // Pre-fill amount values on todo + planning instances that bind fields.amount
      // so "Spent Today" / "Net Balance" trackers show non-zero values after the
      // first Schedule: Build Day sweep.  Flow is "out" (expense) for all.
      const todoDefaultAmounts = {
        // payBills / cancelSub moved to Financial wellness toolkit page (no
        // longer in todo list). carInsurance removed entirely — recurring
        // renewal now handled by Pay Bill against carInsuranceBill in the
        // Bills page (every-180-days cadence).
        orderSupplies: 45,  // office supplies order
        birthdayGift:  55,  // birthday gift for Sarah
        signUpClass:   75,  // cooking class enrollment
      };
      if (todoDefaultAmounts[instKey] !== undefined) {
        dueDatePreFill[fields.amount.id] = fv(todoDefaultAmounts[instKey], "out");
      }
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
    creativeGoal:      { contOccId: creativeGoalContOccId,      contModKey: "creativeGoal",      instKeys: ["creativeSummary"] },
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
    financeAccount:      { contOccId: financeAccountContOccId,      contModKey: "financeAccount",      instKeys: ["bankAccount", "savingsAccount", "momsAccount", "netWorth", "totalSubscriptions", "monthlyBills"] },
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
    { id: movieInceptionModId,       userId, gridId, role: "instance", kind: "list", label: "Inception",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieMatrixModId,          userId, gridId, role: "instance", kind: "list", label: "The Matrix",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieArrivalModId,         userId, gridId, role: "instance", kind: "list", label: "Arrival",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieDuneModId,            userId, gridId, role: "instance", kind: "list", label: "Dune",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieInterstellarModId,    userId, gridId, role: "instance", kind: "list", label: "Interstellar",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieBladeRunner2049ModId, userId, gridId, role: "instance", kind: "list", label: "Blade Runner 2049",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: moviePrestigeModId,        userId, gridId, role: "instance", kind: "list", label: "The Prestige",
      defaultDragMode: "move", fieldBindings: movieFieldBindings },
    { id: movieTenetModId,           userId, gridId, role: "instance", kind: "list", label: "Tenet",
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
    { id: podcastTimFerrissModId,      userId, gridId, role: "instance", kind: "list", label: "The Tim Ferriss Show",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastLexFridmanModId,      userId, gridId, role: "instance", kind: "list", label: "Lex Fridman Podcast",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastHardcoreHistoryModId, userId, gridId, role: "instance", kind: "list", label: "Hardcore History",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastHubermanLabModId,     userId, gridId, role: "instance", kind: "list", label: "Huberman Lab",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
    { id: podcastConvosTylerModId,     userId, gridId, role: "instance", kind: "list", label: "Conversations with Tyler",
      defaultDragMode: "move", fieldBindings: podcastFieldBindings },
  ]);

  // 4 course modules
  await Module.insertMany([
    { id: courseAlgorithmsModId,      userId, gridId, role: "instance", kind: "list", label: "Algorithms (Coursera)",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseMLSpecModId,          userId, gridId, role: "instance", kind: "list", label: "Machine Learning Specialization",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseSystemDesignModId,    userId, gridId, role: "instance", kind: "list", label: "System Design Primer",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
    { id: courseIntroPhilosophyModId, userId, gridId, role: "instance", kind: "list", label: "Introduction to Philosophy",
      defaultDragMode: "move", fieldBindings: courseFieldBindings },
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
      role: "instance", kind: "list",
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

  // Helper for book fields (adds pages alongside library+poster).
  const bookFields = (title, pages) => ({ ...libFields("book", title, bookPosters), [pagesFieldId]: fv(pages) });

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

  // 4 course occurrences (library field = "course")
  const courseAlgorithmsOccId      = await mkOcc({ moduleId: courseAlgorithmsModId,      parentId: libraryContOccId, fields: libFields("course", "Algorithms (Coursera)",           coursePosters) });
  const courseMLSpecOccId          = await mkOcc({ moduleId: courseMLSpecModId,          parentId: libraryContOccId, fields: libFields("course", "Machine Learning Specialization", coursePosters) });
  const courseSystemDesignOccId    = await mkOcc({ moduleId: courseSystemDesignModId,    parentId: libraryContOccId, fields: libFields("course", "System Design Primer",            coursePosters) });
  const courseIntroPhilosophyOccId = await mkOcc({ moduleId: courseIntroPhilosophyModId, parentId: libraryContOccId, fields: libFields("course", "Introduction to Philosophy",     coursePosters) });

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
      // books
      bookAtomicHabitsOccId, bookDeepWorkOccId, bookSapiensOccId, bookThinkingFastSlowOccId,
      bookMeditationsOccId, bookMansSearchOccId, book4HourWorkweekOccId,
      // podcasts
      podcastTimFerrissOccId, podcastLexFridmanOccId, podcastHardcoreHistoryOccId,
      podcastHubermanLabOccId, podcastConvosTylerOccId,
      // courses
      courseAlgorithmsOccId, courseMLSpecOccId, courseSystemDesignOccId, courseIntroPhilosophyOccId,
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

  await new Manifest({ id: manifestId, userId, gridId, manifestType: "user", rootFolderId }).save();
  await new Folder({ id: rootFolderId,         userId, gridId, name: "Root",          parentId: null,            folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: tasksFolderId,        userId, gridId, name: "Tasks",         parentId: rootFolderId,    folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: dailyToolkitFolderId, userId, gridId, name: "Daily Toolkit", parentId: tasksFolderId,   folderType: "normal",    sortOrder: 0, isExpanded: true }).save();
  await new Folder({ id: trackersFolderId,   userId, gridId, name: "Trackers",   parentId: rootFolderId, folderType: "normal",    sortOrder: 1, isExpanded: true }).save();
  await new Folder({ id: interfacesFolderId, userId, gridId, name: "Interfaces", parentId: rootFolderId, folderType: "normal",    sortOrder: 2, isExpanded: true }).save();
  await new Folder({ id: notesFolderId,      userId, gridId, name: "Notes",      parentId: rootFolderId, folderType: "normal",    sortOrder: 3, isExpanded: true }).save();
  await new Folder({ id: dayPagesFolderId,   userId, gridId, name: "Day Pages",  parentId: rootFolderId, folderType: "day-pages", sortOrder: 4, isExpanded: true }).save();
  await new Folder({ id: libraryFolderId,    userId, gridId, name: "Library",    parentId: rootFolderId, folderType: "normal",    sortOrder: 5, isExpanded: true }).save();

  // ── Category folders (Command Center: Fields + Operations grouping) ────────
  // folderType: "category" is the marker FieldsTab + OperationsTab read off of
  // to render category columns. Field/op records reference these by folderId.
  // IDs were pre-generated at the top so field/op definitions can carry
  // their folderId inline.
  await Promise.all([
    new Folder({ id: fieldCategoryIds.scheduling,   userId, gridId, name: "Scheduling",    parentId: rootFolderId, folderType: "category", sortOrder: 100, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.workouts,     userId, gridId, name: "Workouts",      parentId: rootFolderId, folderType: "category", sortOrder: 101, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.nutrition,    userId, gridId, name: "Nutrition",     parentId: rootFolderId, folderType: "category", sortOrder: 102, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.finance,      userId, gridId, name: "Finance",       parentId: rootFolderId, folderType: "category", sortOrder: 103, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.wellness,     userId, gridId, name: "Wellness",      parentId: rootFolderId, folderType: "category", sortOrder: 104, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.intellectual, userId, gridId, name: "Intellectual",  parentId: rootFolderId, folderType: "category", sortOrder: 105, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.bills,        userId, gridId, name: "Bills",         parentId: rootFolderId, folderType: "category", sortOrder: 106, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.display,      userId, gridId, name: "Display",       parentId: rootFolderId, folderType: "category", sortOrder: 107, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.library,      userId, gridId, name: "Library",       parentId: rootFolderId, folderType: "category", sortOrder: 108, isExpanded: false }).save(),
    new Folder({ id: fieldCategoryIds.refs,         userId, gridId, name: "References",    parentId: rootFolderId, folderType: "category", sortOrder: 109, isExpanded: false }).save(),
  ]);

  await Promise.all([
    new Folder({ id: opCategoryIds.trackers, userId, gridId, name: "Trackers",       parentId: rootFolderId, folderType: "category", sortOrder: 200, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.schedule, userId, gridId, name: "Schedule Ops",   parentId: rootFolderId, folderType: "category", sortOrder: 201, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.daypage,  userId, gridId, name: "Day Page Ops",   parentId: rootFolderId, folderType: "category", sortOrder: 202, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.bills,    userId, gridId, name: "Bill Ops",       parentId: rootFolderId, folderType: "category", sortOrder: 203, isExpanded: false }).save(),
    new Folder({ id: opCategoryIds.library,  userId, gridId, name: "Library Ops",    parentId: rootFolderId, folderType: "category", sortOrder: 204, isExpanded: false }).save(),
  ]);

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

  // ── 8. Gospel of Thomas (Text) ── gospelthomas.md (flat, 80 lines) ──
  {
    const lines = readRawLines(join(ROOT_DIR_MD, "gospelthomas.md"), 80);
    const modId = uid(); const occId = uid();
    const textmap = await seedTextblocksFromLines("Gospel of Thomas (Text)", lines, occId);
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
  const wellnessPageOccs = {}; // wellnessPage.key → page occurrence id
  const wellnessPageMods = {}; // wellnessPage.key → page module id
  for (let i = 0; i < wellnessPages.length; i++) {
    const wp = wellnessPages[i];
    const pageModId = uid();
    const pageOccId = uid();
    wellnessPageMods[wp.key] = pageModId;
    wellnessPageOccs[wp.key] = pageOccId;
    await new Module({ id: pageModId, userId, gridId, role: "page", kind: "board", label: wp.label }).save();
    await mkOcc({
      id: pageOccId, moduleId: pageModId,
      parentId: dailyToolkitFolderId, sortOrder: i,
      occurrences: wp.containers.map(ck => toolkitContOccIds[ck]).filter(Boolean),
      iteration: { mode: "persistent" }, fields: {},
      filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
    });
  }
  // Used by panel wiring + return value (the grid panel pins all 11 in order).
  const wellnessPageOccList = wellnessPages.map(wp => wellnessPageOccs[wp.key]);
  // Convenience pointer to the FIRST wellness page (Physical) — kept on the
  // return value for back-compat with any consumer that expected a single
  // "Daily Toolkit" page (and as the default active tab on the panel).
  const toolkitPageOccId = wellnessPageOccs.physical;

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
  await new Module({ id: goalsPageModId, userId, gridId, role: "page", kind: "board", label: "Goals" }).save();
  await mkOcc({
    id: goalsPageOccId, moduleId: goalsPageModId,
    parentId: trackersFolderId, sortOrder: 0,
    occurrences: Object.values(goalContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    // Daily date filter with a visible LocalFilterNav so the user can browse
    // goals for different dates from the Trackers page without touching the
    // global toolbar.  Condition mirrors Schedule's filter (DATE_EQUALS OR empty)
    // so persistent goal display items always show regardless of date.
    filters: [
      {
        id: goalsFilterId, fieldId: dateFieldId, active: true, showNav: true,
        timeUnit: "day", defaultNavValue: "today",
        // D/W/M/Y unit toggle on the Daily Goals LocalFilterNav — trackers
        // re-aggregate over the full selected period via DATE_IN_PERIOD.
        units: ["day", "week", "month", "year"],
        condition: { operator: "OR", rules: [
          { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
          { left: "$field.value", comparator: "IS_EMPTY" },
        ]},
      },
    ],
  });

  const accountsPageModId = uid(); const accountsPageOccId = uid();
  await new Module({ id: accountsPageModId, userId, gridId, role: "page", kind: "board", label: "Accounts" }).save();
  await mkOcc({
    id: accountsPageOccId, moduleId: accountsPageModId,
    parentId: trackersFolderId, sortOrder: 1,
    occurrences: Object.values(accountContOccIds),
    iteration: { mode: "persistent" }, fields: {},
    // D/W/M/Y filter (mirrors Daily Goals) so account aggregations can be
    // viewed over different periods. Condition matches goals/schedule:
    // DATE_EQUALS OR IS_EMPTY so all-time aggregation rows (no date) still
    // appear regardless of the active period.
    filters: [
      {
        id: accountsFilterId, fieldId: dateFieldId, active: true, showNav: true,
        timeUnit: "day", defaultNavValue: "today",
        units: ["day", "week", "month", "year"],
        condition: { operator: "OR", rules: [
          { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
          { left: "$field.value", comparator: "IS_EMPTY" },
        ]},
      },
    ],
  });

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
  await new Module({ id: questionsContModId, userId, gridId, role: "container", kind: "list", label: "Reflection Questions" }).save();
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
    task: "tcol_task", date: "tcol_date", time: "tcol_time", goal: "tcol_goal",
  };
  const schedTablePageModId = uid(); const schedTablePageOccId = uid();
  await new Module({ id: schedTablePageModId, userId, gridId, role: "page", kind: "table", label: "Schedule Table" }).save();
  await mkOcc({
    id: schedTablePageOccId, moduleId: schedTablePageModId,
    parentId: interfacesFolderId, sortOrder: 2,
    occurrences: [],
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
    meta: {
      table: {
        columns: [
          // Task: full embed (label + every field except date/timeslot which
          // have their own columns). hideLabel false — we want to see the
          // task name in this column.
          { id: STBL_COLS.task, title: "Task", width: 240, displayFieldId: null, sort: null, filter: null,
            fieldVisibility: { mode: "hide", fieldIds: [dateFieldId, timeslotFieldId] }, hideLabel: false },
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
          // Goal: full embed (Physical Wellness has 3 field pills). Trimmed so
          // the Date/Time projection columns get more of the row width — the
          // responsive scaler preserves these ratios when filling the panel.
          { id: STBL_COLS.goal, title: "Goal", width: 230, displayFieldId: null, sort: null, filter: null,
            fieldVisibility: null, hideLabel: false },
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
    occurrences: [], // Schedule Canvas: Build populates at runtime
    iteration: { mode: "persistent" }, fields: {},
    filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
  });

  // Notebook hub View — Schedule is the default active tab.
  const notebookHubViewId = uid();
  await new View({ id: notebookHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: schedPageOccId }).save();

  // Daily Toolkit View — Physical is the default active tab (first wellness page).
  const toolkitHubViewId = uid();
  await new View({ id: toolkitHubViewId, userId, gridId, viewType: "board", activeOccurrenceId: wellnessPageOccs.physical }).save();

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
  await Occurrence.findOneAndUpdate({ id: panelOccIds.toolkit },  { $set: { occurrences: wellnessPageOccList } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.todo },     { $set: { occurrences: [todoPageOccId] } });
  await Occurrence.findOneAndUpdate({ id: panelOccIds.notebook }, { $set: { occurrences: [schedPageOccId, canvasPageOccId, schedCanvasPageOccId] } });
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
    ...trackerArgs, name: "Tracker: Completed",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalCompleted.id,
    agg: "countTrue", timeFilter: "daily",
  })).save();
  // Tracker: Today's Moods — replaces the prior "Latest Mood" agg:"last".
  // Builds an array of {mood, date} rows for every mood-bearing occurrence
  // in $goalPeriod (day/week/month/year — broader windows return multiple
  // rows). Trigger surface matches makeTrackerOp's surface so onLoad / Nav /
  // onChange / onAdd / onDelete all re-aggregate.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Moods",
    description: "Build a [{mood, date}] row list for every mood-bearing item in the goal's selected period and write it to Emotional Balance's Moods display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: fields.mood.id, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 3 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Emotional Balance goal instance (Latest Mood's host).
        { type: "action", action: "FIND",
          cfg: {
            over: "$allInstances",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Emotional Balance" }] },
            itemVar: "$goalItem", itemIdVar: "$goalItemId",
          },
        },
        // 2. Resolve $goalPeriod from the goal item's effective filter (full
        // {value, unit} object form — DATE_IN_PERIOD reads both shapes).
        { type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 3. Find the Schedule page (for HAS_ANCESTOR scoping).
        { type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
        // 4. Init the rows array.
        { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
        // 5. Loop $allInstances — match every occurrence in $goalPeriod under
        // Schedule that has a non-empty mood field value, and push {mood, date}.
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
                ],
              },
              then: [
                {
                  type: "action", action: "PUSH_TO_ARRAY",
                  cfg: {
                    name: "$rows",
                    value: {
                      mood: `$inst.fields.${fields.mood.id}.value`,
                      date: `$inst.fields.${dateFieldId}.value`,
                    },
                  },
                },
              ],
              else: [],
            },
          ],
        },
        // 6. Write the rows array to the goal item's lastMood display field.
        { type: "action", action: "UPDATE",
          cfg: { path: `$goalItem.fields.${fields.lastMood.id}.value`, value: "$rows" },
        },
      ],
    },
  }).save();

  // ── DAILY ACTIVITY ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Steps",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalSteps.id,
    sourceFieldId: fields.steps.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Water",
    goalLabel: "Physical Wellness", goalFieldId: fields.totalWater.id,
    sourceFieldId: fields.water.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Time Spent",
    goalLabel: "Intellectual Growth", goalFieldId: fields.totalDuration.id,
    sourceFieldId: fields.duration.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Pages",
    goalLabel: "Intellectual Growth", goalFieldId: fields.totalPages.id,
    sourceFieldId: fields.pages.id, agg: "sum", timeFilter: "daily",
  })).save();

  // ── DAILY FINANCE ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Spent",
    goalLabel: "Financial Health", goalFieldId: fields.totalSpent.id,
    sourceFieldId: fields.amount.id, agg: "sum", flow: "out", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Earned",
    goalLabel: "Financial Health", goalFieldId: fields.totalIncome.id,
    sourceFieldId: fields.income.id, agg: "sum", flow: "in", timeFilter: "daily",
  })).save();

  // ── DAILY NUTRITION ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Protein",
    goalLabel: "Nutrition", goalFieldId: fields.totalProtein.id,
    sourceFieldId: fields.protein.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Carbs",
    goalLabel: "Nutrition", goalFieldId: fields.totalCarbs.id,
    sourceFieldId: fields.carbs.id, agg: "sum", timeFilter: "daily",
  })).save();
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Fats",
    goalLabel: "Nutrition", goalFieldId: fields.totalFats.id,
    sourceFieldId: fields.fats.id, agg: "sum", timeFilter: "daily",
  })).save();

  // ── DAILY WORKOUT (multi-source roll-up) ──
  await new Operation(makeTrackerOp({
    ...trackerArgs, name: "Tracker: Total Reps",
    goalLabel: "Workout", goalFieldId: fields.totalRepsToday.id,
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
    name: "Tracker: Movies Watched",
    description: "Build a label list of movies watched today and update the Movies Watched goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: moviesWatchedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
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
        // 3. Resolve $goalPeriod from the goal item's effective filter — full
        // {value, unit} object (DATE_IN_PERIOD reads both bare-string + object).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
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
              { left: "$trigger.fieldId", comparator: "IS", right: moviesWatchedFieldId },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
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
                      { left: "$watchInst.label", comparator: "IS", right: "Watch Movie" },
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
                                  label: "$movie.label",
                                  date: `$watchInst.fields.${dateFieldId}.value`,
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
              cfg: { path: `$goalItemId.fields.${moviesWatchedDisplayFieldId}.value`, value: "$rows" },
            },
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
    name: "Tracker: Books Read",
    description: "Build a label list of books read today and update the Books Read goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: booksReadFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
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
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
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
              { left: "$trigger.fieldId", comparator: "IS", right: booksReadFieldId },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init output accumulator as an empty array (rows for the multi-dim display)
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
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
                      { left: "$readInst.label", comparator: "IS", right: "Reading" },
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
                                  label: "$book.label",
                                  pages: `$book.fields.${pagesFieldId}.value`,
                                  date: `$readInst.fields.${dateFieldId}.value`,
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
            // 5c. Write the array of rows to the display field on the goal item.
            {
              type: "action", action: "UPDATE",
              cfg: { path: `$goalItemId.fields.${booksReadDisplayFieldId}.value`, value: "$rows" },
            },
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
    name: "Tracker: Podcasts Listened",
    description: "Build a label list of podcasts listened today and update the Podcasts Listened goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: podcastsListenedFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
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
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
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
              { left: "$trigger.fieldId", comparator: "IS", right: podcastsListenedFieldId },
              { left: `$trigger.occurrence.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
            ]},
          ]},
          then: [
            // 5a. Init rows accumulator
            { type: "action", action: "INIT_VAR", cfg: { name: "$rows", value: [] } },
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
                      { left: "$podcastInst.label", comparator: "IS", right: "Listen to Podcast" },
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
                                  label: "$podcast.label",
                                  date: `$podcastInst.fields.${dateFieldId}.value`,
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
              cfg: { path: `$goalItemId.fields.${podcastsListenedDisplayFieldId}.value`, value: "$rows" },
            },
          ],
          else: [],
        },
      ],
    },
    enabled: true,
  }).save();

  // ── Tracker: Courses Taken ─────────────────────────────────────────────────
  // Same pipeline shape as Tracker: Movies Watched but for courses.
  // Trigger gate added to match makeTrackerOp surface.
  await new Operation({
    id: uid(), userId, gridId, priority: 3,
    name: "Tracker: Courses Taken",
    description: "Build a label list of courses taken today and update the Courses Taken goal display.",
    triggerTypes: ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: coursesTakenFieldId, priority: 3 },
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Goals", priority: 3 },
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
        // 3. Resolve $goalPeriod — full {value, unit} object (DATE_IN_PERIOD-ready).
        {
          type: "action", action: "INIT_VAR",
          cfg: { name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${dateFieldId}`, fallback: "$trigger.date", fallback2: "$today" },
        },
        // 4. Find the Schedule page (needed for HAS_ANCESTOR; outside trigger gate like makeTrackerOp)
        {
          type: "action", action: "FIND",
          cfg: {
            over: "$allPages",
            predicate: { conjunction: "AND", rules: [{ left: "label", comparator: "IS", right: "Schedule" }] },
            itemVar: "$schedPage", itemIdVar: "$schedPageId",
          },
        },
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
              { left: "$trigger.fieldId", comparator: "IS", right: coursesTakenFieldId },
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
                      { left: "$courseInst.label", comparator: "IS", right: "Online Course" },
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
                                  label: "$course.label",
                                  date: `$courseInst.fields.${dateFieldId}.value`,
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
              cfg: { path: `$goalItemId.fields.${coursesTakenDisplayFieldId}.value`, value: "$rows" },
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
    id: uid(), userId, gridId, priority: 3,
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
                { left: "label", comparator: "IS", right: "Daily Journal" },
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
  // createLiveData seeds the trackers as "Tracker: Completed Today" (not the
  // longer "Tracker: Tasks Completed Today" used by createTestGrid). Pass the
  // matching name so Build Day's tail RUN_OPERATION resolves it.
  await new Operation(makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId, completedTrackerName: "Tracker: Completed" })).save();
  // Extend Stamp Date & Time Slot to also stamp lastSeen on every dropped occurrence.
  await new Operation(makeDayPageBuildOp({ userId, gridId, dateFieldId, dayPagesFolderId, hubPanelOccIdVar: panelOccIds.notebook })).save();
  // Body-seeds the Tasks Completed container minted by buildDayPageTemplate.
  // Runs at priority 4 — after Build Day, Stamp, and trackers — so the
  // completion state and date stamps it reads are settled.
  await new Operation(makeDayPageBuildTasksCompletedOp({ userId, gridId, dateFieldId, completedFieldId, isTaskFieldId })).save();
  await new Operation(makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId, lastSeenFieldId, hubPanelModuleId: panelModuleIds.notebook })).save();
  await new Operation(makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId, timeslotFieldId })).save();

  // ── Schedule Table: Build ───────────────────────────────────────────────────
  // Mirrors the Schedule into the kind:"table" "Schedule Table" page. For every
  // schedule task on the active day it COPY_LINKs the task occurrence into 3
  // cells (col0 full embed w/ date+timeslot hidden via the column's
  // fieldVisibility, col1 date projection, col2 timeslot projection) plus a
  // COPY_LINK of the "Physical Wellness" goal it rolls up to (col3). The
  // copies share linkedGroupId with the source so editing either side fans
  // out (server update_occurrence linked-group propagation).
  //
  // FINDs its OWN target by label "Schedule Table" and reads source data from
  // "Schedule" — the Schedule trackers/Build-Day FIND `label IS "Schedule"`
  // (exact), so they never cross-fire on this page.
  //
  // Idempotent the SAME way Schedule: Build Day is — module-based COPY_LINK
  // (copies reuse the Schedule task's moduleId, like every copy in this
  // system) parented under the Schedule Table page, with row-level
  // existence dedup using Build Day's exact predicate scoped to the table:
  // `templateId IS <task> AND _ancestors HAS_ANCESTOR <tbl> AND
  // fields.<date> SAME_DAY <schedDate>`. Row already present → skip (its
  // cells persist); absent → create THREE copy-linked task occurrences
  // (col0 main, col1 date-only, col2 timeslot-only — the column
  // displayFieldId/fieldVisibility projections render the three views) plus
  // the shared goal copy for col3. $r is append-only from the table's
  // current rowCount, so re-running adds nothing and a new day appends —
  // exactly how Build Day leaves prior Due copies untouched. No flags, no
  // stamped markers. Priority 8 so it runs AFTER Schedule: Build Day (p1)
  // within an onLoad batch and sees its created tasks via the in-batch
  // liveOccs overlay (same path the trackers rely on).
  const stCellDoc = (occVar) => ({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: occVar } }] });
  await new Operation({
    id: uid(), userId, gridId, priority: 8,
    name: "Schedule Table: Build",
    description: "Mirror the Schedule into the Schedule Table page. Per task on the active day: 3 copy-linked occurrences parented under the table (col0 main w/ date+timeslot hidden via the column's fieldVisibility, col1 date-only projection, col2 timeslot-only projection) + a shared copy-linked Physical Wellness goal (col3, all fields). Row-level existence dedup using Schedule: Build Day's exact predicate (templateId IS task AND _ancestors HAS_ANCESTOR table AND fields.<date> SAME_DAY schedDate) — row present → skip, absent → create. $r appends from the table's current rowCount. Idempotent + per-date + self-healing, no flags, no stamped markers.",
    triggerTypes: ["onAdd", "onDelete", "onChange", "onFilterChange", "onLoad"],
    triggerObjects: [
      // Container add/delete (e.g. slot or page-level edits).
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "container", targetId: "", priority: 8 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "container", targetId: "", priority: 8 },
      // Instance add/delete — drag a task into / out of a Schedule slot.
      // Without these, dragging a task into Schedule didn't refire the table
      // build, so the new task never appeared in the Schedule Table mirror
      // until a full reload.
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 8 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 8 },
      // Date field change — Schedule: Stamp Date & Time Slot writes
      // dateFieldId immediately after the drop, so subscribing to that field
      // catches both new drops AND date-edits on existing tasks.
      { eventType: "onChange",       subjectType: "field",     targetId: dateFieldId,    priority: 8 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule", priority: 8 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 8 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule Table page (our write target).
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [{ id: uid(), left: "label", comparator: "IS", right: "Schedule Table" }] },
            itemVar: "$tbl", itemIdVar: "$tblId",
        }},
        // 2. Proceed only when the table page exists (FIND bound $tbl).
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$tblId", comparator: "IS_NOT_EMPTY", right: "" },
          ] },
          then: [
            // 3. Find the Schedule page (source data + HAS_ANCESTOR scope).
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allPages",
                predicate: { operator: "AND", rules: [{ id: uid(), left: "label", comparator: "IS", right: "Schedule" }] },
                itemVar: "$schedPage", itemIdVar: "$schedPageId",
            }},
            // 4. Resolve the active schedule date: $trigger.date →
            //    Schedule page effective filter → today.
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
            // 5. Find the goal these tasks roll up to (col3 source). Every
            //    completed schedule task increments Physical Wellness via
            //    Tracker: Completed Today, so it's the canonical per-row goal.
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allInstances",
                predicate: { operator: "AND", rules: [{ id: uid(), left: "label", comparator: "IS", right: "Physical Wellness" }] },
                itemVar: "$goalItem", itemIdVar: "$goalOccId",
            }},
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalTpl", expr: "$goalItem.templateId" } },
            // 6. Goal copy — ONE copy-link of the goal, parented under the
            //    Schedule Table page (its occurrences[]), reused by every
            //    row's col3 (all fields shown). Same existence dedup
            //    Schedule: Build Day uses for its swept Due copy:
            //    `templateId IS … AND _ancestors HAS_ANCESTOR <container>`.
            //    The Schedule-side source goal lives under Daily Goals (not
            //    $tbl) so it never matches — only the table's own copy does.
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allInstances",
                predicate: { operator: "AND", rules: [
                  { id: uid(), left: "templateId", comparator: "IS", right: "$goalTpl" },
                  { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$tblId" },
                ] },
                itemIdVar: "$cg",
            }},
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [{ id: uid(), left: "$cg", comparator: "IS_EMPTY", right: "" }] },
              then: [{ id: uid(), type: "action", config: { type: "COPY_LINK", sourceId: "$goalOccId", parent: "$tblId", itemIdVar: "$cg" } }],
              else: [],
            },
            // 7. CHEAP IDEMPOTENCY GUARD. The full clean+rebuild emits ~50
            //    effects per fire (18 CREATE_ITEM + 6 linkedGroup UPDATEs +
            //    25 cell UPDATEs + 1 final rowCount). Each effect is a Redux
            //    dispatch + socket emit that triggers a React re-render of
            //    the table — with 24 TipTap editors mounted in cells, this
            //    pegs the browser every time the op fires (which is on
            //    onLoad, onFilterChange, onAdd container, onDelete container).
            //    Skip the whole rebuild ONLY when the table already has rows
            //    AND there's NO explicit trigger (i.e. the bulk onLoad case
            //    that fires once per `full_state`). Any explicit trigger event
            //    — NavigationOp (filter change), OccurrenceCreateOp (drag a
            //    task into Schedule), OccurrenceDeleteOp (remove a task),
            //    MeasureOp (field write) — always rebuilds so the table mirror
            //    catches the new/removed task.
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$existingRowCount", expr: "$tbl.meta.table.rowCount" } },
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$triggerType",      expr: "$trigger.type" } },
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$existingRowCount", comparator: "GREATER_THAN", right: 0 },
                { id: uid(), left: "$triggerType",      comparator: "IS_EMPTY",     right: ""             },
              ] },
              then: [
                // Already built + not a date nav → no-op, leave existing rows + cells alone.
              ],
              else: [
                // Step 7a: delete every task copy parented under $tbl
                // (everything except the goal copy, which is dedup'd above).
                {
                  id: uid(), type: "loop", overExpr: "$allInstances", as: "$orphan",
                  body: [
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$orphan._ancestors", comparator: "HAS_ANCESTOR", right: "$tblId" },
                        { id: uid(), left: "$orphan.id",         comparator: "IS_NOT",       right: "$cg"    },
                      ] },
                      then: [
                        { id: uid(), type: "action", config: { type: "DELETE", itemIdExpr: "$orphan.id" } },
                      ],
                      else: [],
                    },
                  ],
                },
                // Step 7b: reset cells and rowCount.
                { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.cells",    value: {} } },
                { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.rowCount", value: 0  } },
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$r", expr: "literal:0" } },

                // 8. One row per schedule task on $schedDate under the Schedule
                //    page. No dedup (handled by step 7's wipe) — every matching
                //    task gets 3 fresh copy-linked occurrences + cells + goal.
                {
                  id: uid(), type: "loop", overExpr: "$allInstances", as: "$task",
                  body: [
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$task._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                        { id: uid(), left: `$task.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                        { id: uid(), left: "$task.label", comparator: "IS_NOT_EMPTY", right: "" },
                      ] },
                      then: [
                        // 3 task copies parented under $tbl (Build Day pattern:
                        // COPY_LINK with `parent`). copyFields default true so
                        // the cells render the task's current field values.
                        { id: uid(), type: "action", config: { type: "COPY_LINK", sourceId: "$task.id", parent: "$tblId", itemIdVar: "$c0" } },
                        { id: uid(), type: "action", config: { type: "COPY_LINK", sourceId: "$task.id", parent: "$tblId", itemIdVar: "$c1" } },
                        { id: uid(), type: "action", config: { type: "COPY_LINK", sourceId: "$task.id", parent: "$tblId", itemIdVar: "$c2" } },
                        // Position the row's 4 cells ($var leaves deep-resolved).
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.cells.${$r}:0", value: stCellDoc("$c0") } },
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.cells.${$r}:1", value: stCellDoc("$c1") } },
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.cells.${$r}:2", value: stCellDoc("$c2") } },
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.cells.${$r}:3", value: stCellDoc("$cg") } },
                        { id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$r" } },
                      ],
                      else: [],
                    },
                  ],
                },
                // 9. Publish the row count.
                { id: uid(), type: "action", config: { type: "UPDATE", path: "$tbl.meta.table.rowCount", value: "$r" } },
              ],
            },
          ],
          else: [],
        },
      ],
    },
  }).save();

  // ── Schedule Canvas: Build ─────────────────────────────────────────────────
  // Mirror of the Schedule into the kind:"canvas" "Schedule Canvas" page. Per
  // schedule task on the active day, COPY_LINKs the task occurrence ONCE,
  // parents it under the canvas page, and stamps meta.x/y so cards land in
  // a tidy vertical column ordered by walk position. Same idempotency model
  // as Schedule Table: Build — full clean+rebuild on any explicit trigger,
  // skip when canvas already populated + no explicit trigger (onLoad bulk).
  await new Operation({
    id: uid(), userId, gridId, priority: 8,
    name: "Schedule Canvas: Build",
    description: "Mirror Schedule tasks for the active day onto the Schedule Canvas page. Each task → one copy-linked occurrence stamped with meta.x/y so cards stack vertically on the canvas. Idempotent + per-date + self-healing.",
    triggerTypes: ["onAdd", "onDelete", "onChange", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onAdd",          subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 8 },
      { eventType: "onDelete",       subjectType: "module",    subjectRole: "instance",  targetId: "", priority: 8 },
      { eventType: "onChange",       subjectType: "field",     targetId: dateFieldId,    priority: 8 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Schedule", priority: 8 },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "", priority: 8 },
    ],
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        // 1. Find the Schedule Canvas page (write target).
        { id: uid(), type: "action", config: {
            type: "FIND",
            over: "$allPages",
            predicate: { operator: "AND", rules: [{ id: uid(), left: "label", comparator: "IS", right: "Schedule Canvas" }] },
            itemVar: "$canvas", itemIdVar: "$canvasId",
        }},
        {
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$canvasId", comparator: "IS_NOT_EMPTY", right: "" },
          ] },
          then: [
            // 2. Find the Schedule page (source data + HAS_ANCESTOR scope).
            { id: uid(), type: "action", config: {
                type: "FIND",
                over: "$allPages",
                predicate: { operator: "AND", rules: [{ id: uid(), left: "label", comparator: "IS", right: "Schedule" }] },
                itemVar: "$schedPage", itemIdVar: "$schedPageId",
            }},
            // 3. Resolve active schedule date (same chain as Schedule Table: Build).
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
            // 4. Idempotency guard — only rebuild on explicit triggers OR when canvas is empty.
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$existingChildCount", expr: "$canvas.occurrences.length" } },
            { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$triggerType",        expr: "$trigger.type" } },
            { id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$existingChildCount", comparator: "GREATER_THAN", right: 0 },
                { id: uid(), left: "$triggerType",        comparator: "IS_EMPTY",     right: ""  },
              ] },
              then: [
                // Already built + bulk onLoad → no-op.
              ],
              else: [
                // 5a. Clean: delete every existing copy parented under $canvas.
                {
                  id: uid(), type: "loop", overExpr: "$allInstances", as: "$orphan",
                  body: [
                    { id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$orphan._ancestors", comparator: "HAS_ANCESTOR", right: "$canvasId" },
                      ] },
                      then: [
                        { id: uid(), type: "action", config: { type: "DELETE", itemIdExpr: "$orphan.id" } },
                      ],
                      else: [],
                    },
                  ],
                },
                // 5b. Reset row counter.
                { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$r", expr: "literal:0" } },
                // 6. One copy per schedule task on $schedDate under the Schedule page.
                //    Stamp meta.x/y so cards stack vertically (60px column + 80px row stride).
                {
                  id: uid(), type: "loop", overExpr: "$allInstances", as: "$task",
                  body: [
                    {
                      id: uid(), type: "if",
                      condition: { operator: "AND", rules: [
                        { id: uid(), left: "$task._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                        { id: uid(), left: `$task.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" },
                        { id: uid(), left: "$task.label", comparator: "IS_NOT_EMPTY", right: "" },
                      ] },
                      then: [
                        { id: uid(), type: "action", config: { type: "COPY_LINK", sourceId: "$task.id", parent: "$canvasId", itemVar: "$copy", itemIdVar: "$copyId" } },
                        // Compute y = $r * 80 + 60 via INIT_VAR + MULTIPLY_VAR + ADD_TO_VAR.
                        { id: uid(), type: "action", config: { type: "INIT_VAR",     name: "$y", expr: "$r" } },
                        { id: uid(), type: "action", config: { type: "MULTIPLY_VAR", name: "$y", by: 80 } },
                        { id: uid(), type: "action", config: { type: "ADD_TO_VAR",   name: "$y", expr: "literal:60" } },
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$copy.meta.x", value: 60 } },
                        { id: uid(), type: "action", config: { type: "UPDATE", path: "$copy.meta.y", value: "$y" } },
                        { id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$r" } },
                      ],
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
  }).save();

  // ── Categorize operations (post-save bulk patch) ───────────────────────────
  // Same name-pattern routing as fields. Lets the existing 28 Operation
  // records (each defined inline above) land in a sensible Command Center
  // column without touching every definition. Run AFTER every save above.
  await Operation.updateMany(
    { userId, gridId, name: /^Tracker:/i, folderId: { $in: [null, undefined] } },
    { $set: { folderId: opCategoryIds.trackers } },
  );
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
    const blContOccs     = Object.keys(result.billContOccIds || {}).length;
    const totalContOccs  = tkContOccs + tdContOccs + glContOccs + acContOccs + blContOccs;
    const notebookCount  = Object.keys(result.notebookDocOccIds || {}).length;
    console.log("=".repeat(50));
    console.log("Live Grid created!");
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
