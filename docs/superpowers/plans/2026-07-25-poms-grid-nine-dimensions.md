# Poms Grid — Nine Dimensions of Wellness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the current Live Grid to "test grid" (DB-only, nothing else touched), then create a NEW grid named **"Poms"** with the same machinery (Schedule, day pages, task system, goals/trackers, alarms, Library, Pomodoro) but with the routine layer replaced by the user's granular action types organized into the 9 dimensions of wellness — one **Routines** page (9 containers, populated), one **Tasks** page (same 9 containers, empty), one **Trackers** page (ALL goals + tracker displays), occurrence-dropdown fields sourced from new option **Boards**, plus two vintage color themes (**light vintage** + **dark vintage**) from `screenshots/489e33c0035b2c2481a08ff831b8afae.jpg` and `screenshots/360_F_475749391_6HwhwbLaTfkVqLZu0xtVdBAm0ENpgYiE.jpg`.

**Scope rule (per user):** this is a DATA project, not a code project. Everything ships as seed/DB data through `createLiveData.js`; the ONLY app-code change allowed is the two theme definitions (themes can only live in `client/src/index.css` + `client/src/helpers/useTheme.js`). No new components, no new executor features, no builder changes unless a seed call literally cannot express something — in which case stop and ask.

**Architecture:** All data work is seed surgery in `server/scripts/createLiveData.js` (the JS seed is the spec for the next seed; the DB is running state). The seed's grid name becomes **"Poms"** (`DEFAULT_GRID_NAME`), so `dropExistingLiveGrid` drops/rebuilds only "Poms" on reseed — the renamed "test grid" is permanently out of the seed's blast radius. Option dropdowns follow the existing Library pattern: occurrence-type fields with find-mode `optionsSource` filtered on a hidden tag field, `addNew.parentOccurrenceId` pointing at the board's container. Themes: `[data-theme="vintage-light"]` + `[data-theme="vintage-dark"]` blocks + two `SYSTEM_THEMES` entries.

**Tech Stack:** Node/Mongoose seed script, existing `liveSystemBuilders.js` op builders, React/CSS-variables theming, vitest client tests booting on the exported seed JSON.

## Global Constraints

- **Grid name is exactly `"Poms"`.** The seed's `DEFAULT_GRID_NAME` becomes "Poms"; the old grid becomes `"test grid"` (name change ONLY) and no task may write to it again.
- **Data-only project (per user).** Seed/DB work throughout; the two vintage themes (Task 2) are the single permitted app-code change. Anything else that seems to need app or builder code = stop and ask.
- **DB is shared dev=prod Atlas.** Running `createLiveData.js` IS a live-data operation. The rename script and every reseed act on production data. Verify with read-only inspection before and after every write step.
- **Field names are globally UNIQUE** (standing rule, `feedback-unique-field-names`). Verify zero duplicates after seed changes.
- **No hardcoding** (`feedback-no-hardcoding`): identity/config = data (fields, tags, picker-direct ids), never label-matching in new ops. Picker-direct = `$allItemsById.<occId>` captured at seed wiring.
- **No legacy/fallback paths** (`feedback-no-legacy`): the 11 wellness pages, Todo List page, and Goals page are REMOVED from the seed, not kept alongside.
- **No abbreviations** in user-visible labels (`feedback-no-abbreviations`).
- **`makeAlarmOp` (server) and `buildAlarmOperation` (client) are twins — keep in sync** if `scheduleFieldIds` wiring is touched.
- **Reseed required** after every seed change to see it live: `node --env-file=.env server/scripts/createLiveData.js` (exports `server/seed/*.json` used by client behavioral tests — do NOT pass `--no-export` during dev; `deploydata.sh` uses `--no-export`).
- Baseline test counts before this work: **1336 client / 245 server**. They must end green (counts will change as behavioral tests are updated to the new seed).
- Daily Routine convention: routine source instances carry a HIDDEN `dateFieldId` binding; slot instances stamp date + timeslot hidden (see `createLiveData.js:2241` comment). Preserve for the new action instances used in `routineBySlot`.

---

## Design Reference (locked decisions)

### The 9 dimensions and their action instances (verbatim from user)

| Dimension | Actions |
|---|---|
| Physical | Eat, Cook, Drink, Sleep, Nap, Exercise, Stretch, Walk, Run, Lift, Recover, Hygiene, Groom |
| Emotional | Journal, Reflect, Meditate, Check In, Express, Vent, Celebrate, Forgive, Relax, Decompress |
| Intellectual | Read, Study, Watch, Listen, Practice, Memorize, Research, Explore, Analyze, Teach |
| Social | Text, Call, Chat, Meet, Date, Visit, Host, Collaborate, Mentor, Volunteer |
| Spiritual | Pray, Meditate, Reflect, Worship, Read Scripture, Read Philosophy, Gratitude, Mindfulness, Nature, Serve |
| Occupational | Plan, Prioritize, Focus, Build, Code, Design, Write, Review, Email, Network |
| Financial | Budget, Save, Earn, Invest, Spend, Buy, Pay, Track, Reconcile, Donate, Review |
| Environmental | Clean, Declutter, Organize, Laundry, Dishes, Vacuum, Recycle, Repair, Maintain, Garden |
| Creative | Draw, Paint, Sketch, Write, Journal Creatively, Compose, Sing, Dance, Craft, Photograph, Film, Edit, Brainstorm, Prototype, Invent |

Duplicate instance labels across dimensions (Meditate, Reflect, Write, Review) are fine — they are separate modules; only FIELD names must be unique, and all op wiring is picker-direct.

Two actions added beyond the user's verbatim list, per follow-up direction ("cooking and buy should use the ingredients list too"): **Cook** (Physical) and **Buy** (Financial).

**Track is the money occurrence** (per user): pick an Account, enter an Amount, and the flow toggle (in / out / **replace**) decides whether it adds, subtracts, or SETS the balance — replace rides the existing `supportsReplace` balance-base logic, making Track the universal successor to the old Set Account Balance task.

### Option boards (new "Boards" folder; each = one `kind:"board"` page with one container of option instances)

| Board page | Tag value | Seed options | Dropdown field (type `occurrence`) | Used by |
|---|---|---|---|---|
| Meals | `meal` | Scrambled Eggs, Greek Salad with Chicken, Oatmeal with Berries, Protein Shake, Chicken and Rice, Salmon and Vegetables | **Meal** | Eat |
| Ingredients | `ingredient` | Chicken Breast, Eggs, Rice, Spinach, Greek Yogurt, Oats, Salmon, Olive Oil, Sweet Potatoes, Black Beans | **Ingredient** (multiSelect, queries Ingredients + Grocery List) | Eat, Cook |
| Grocery List | `grocery` | Milk, Bananas, Coffee Beans, Paper Towels, Chicken Thighs, Frozen Berries | **Purchase Item** (multiSelect, queries Grocery + Wish List + Ingredients + Supplements + Equipment + Plants) | Buy, Spend |
| Beverages | `beverage` | Water, Coffee, Green Tea, Electrolyte Drink, Smoothie | **Beverage** | Drink |
| Supplements | `supplement` | Creatine, Vitamin D, Fish Oil, Magnesium, Protein Powder, Multivitamin | **Supplement** (multiSelect) | Recover |
| Movements | `movement` | the 30 existing exercises (Bench Press … Burpees) + Hamstring Stretch, Hip Flexor Stretch, Shoulder Stretch | **Movement** | Exercise, Stretch, Lift |
| Routes | `route` | Neighborhood Loop, River Trail, Park Circuit, Hill Repeats, Forest Path | **Route** | Walk, Run, Nature |
| Readings | `reading` | reuse Library book entries + Meditations (Marcus Aurelius), Tao Te Ching, Book of Psalms | **Reading** | Read, Read Scripture, Read Philosophy |
| Media | `media` | The Daily (podcast), Planet Earth II, Lex Fridman Podcast, Veritasium, Kurzgesagt | **Media** | Watch, Listen |
| Practices | `practice` | Breathwork, Body Scan, Loving-Kindness, Gratitude List, Silent Prayer, Walking Meditation | **Practice** | Meditate ×2, Pray, Worship, Gratitude, Mindfulness, Check In |
| Prompts | `prompt` | "What went well today?", "What am I avoiding?", "What would make tomorrow great?", "Describe a place from memory", "Write a letter you will never send" | **Prompt** | Journal, Reflect ×2, Journal Creatively, Brainstorm |
| Leisure | `leisure` | Chess, Video Games, Hot Bath, Puzzle, Movie Night, Hammock Time | **Leisure Activity** | Relax, Decompress, Celebrate |
| Projects | `project` | Moduli v1 Launch, Portfolio Site, Home Lab, Garden Build | **Project Pick** (see note) | Plan, Prioritize, Focus, Build, Code, Design, Write, Review |
| Skills | `skill` | Guitar, Typing, Public Speaking, Spanish Conversation, Chess Openings, Sketching | **Skill** | Practice, Teach, Mentor, Prototype |
| Topics | `topic` | Spanish, Algorithms, Music Theory, World History, Machine Learning | **Topic** | Study, Memorize, Research, Explore, Analyze, Teach |
| Wish List | `wishlist` | Standing Desk, Espresso Machine, Noise-Canceling Headphones, Weighted Blanket, New Running Shoes | **Wish List Item** | Save, Spend, Budget |
| Charities | `charity` | Local Food Bank, Red Cross, Habitat for Humanity, Animal Shelter, Library Fund | **Charity** | Donate, Volunteer, Serve |
| Places | `place` | Coffee Shop, City Park, Gym, Mom's House, Downtown Library, Farmers Market | **Place** | Meet, Date, Visit, Host, Volunteer |
| Areas | `area` | Desk, Kitchen, Bedroom, Bathroom, Garage, Yard | **Area** | Clean, Declutter, Organize, Vacuum |
| Equipment | `equipment` | Car, Bike, Lawn Mower, Laptop, Coffee Machine, HVAC Filter | **Equipment** (see note) | Repair, Maintain |
| Plants | `plant` | Monstera, Tomatoes, Basil, Snake Plant, Rosemary | **Plant** | Garden |
| Mediums | `medium` | Pencil, Watercolor, Acrylic, Guitar, Piano, Camera, Clay | **Medium** | Draw, Paint, Sketch, Craft, Photograph, Film, Edit, Invent |
| Songs | `song` | Hallelujah, Blackbird, Clair de Lune, Take Five, Redbone | **Song** | Sing, Dance, Compose |
| People | `person` | the 10 existing person occurrences (profile fields + photos intact) | **People** (existing `peopleAssigned` field, multiSelect) | Text, Call, Chat, Meet, Date, Visit, Host, Collaborate, Mentor, Volunteer, Email, Network |
| Workout Programs | `program` | Push Day A, Pull Day B, Leg Day, Full Body 5x5, Couch to 5K | **Workout Program** | Exercise, Lift, Run |
| Courses | `course` | reuse the Library course entries | **Course** (reuse the existing course picker field if one exists — check before minting) | Study, Watch |
| Events | `event` | Game Night, Book Club, Birthday Dinner, Movie Night, Barbecue | **Event** | Host, Meet, Date, Celebrate |
| Gift Ideas | `gift` | Cookbook for Mom, Board Game, Concert Tickets, Handmade Mug | **Gift Idea** | Date, Visit (+ Buy via Purchase Item) |
| Verses | `verse` | Psalm 23, Sermon on the Mount, Ecclesiastes 3, Proverbs 3:5-6 | **Verse** | Read Scripture, Worship, Pray |
| Gratitude Log | `gratitude` | "Morning coffee on the porch", "Call with Dad", "Finished the 5K" | **Gratitude Entry** | Gratitude (this board IS the gratitude journal — see capture loops) |
| Wins | `win` | "Shipped the feature", "First pull-up", "Paid off the card" | **Win** | Celebrate (capture loop) |
| Ideas | `idea` | "Plant herb wall", "App for tracking loans to friends", "Photo series: doors" | **Idea** | Brainstorm, Prototype, Invent |
| Savings Goals | `savingsGoal` | Emergency Fund, Japan Trip, New Laptop, Down Payment | **Savings Goal** | Save, Budget, Invest |
| Creative Works | `creativeWork` | Sketchbook Vol. 3, Untitled Album, Short Film "Doors", Family Photo Book | **Creative Work** | every Creative action (the piece being worked on) |

> **People is a board (per user):** the 10 person occurrences move into a People board page in the Boards folder (they keep their profile fields, photos, and `library:"person"` tag so nothing else breaks). The standalone People page (table + profile card) is REMOVED — People renders as a plain board list. The `peopleAssigned` field keeps its existing find-mode optionsSource; only its `addNew.parentOccurrenceId` is repointed at the People board container.
> **Equipment field-name note:** grep existing field names before minting — if "Equipment" (or any other new name) collides with an existing field, suffix the board noun ("Equipment Item") rather than renaming the existing field. The zero-duplicates verification in Task 3 Step 4 is the net.
> Grocery List and Wish List double as standalone checklist boards (that is their main use); their dropdown fields exist so financial/errand actions can reference specific items.

Reused existing occurrence fields (do NOT mint new ones): **People** (`peopleAssigned`, now sourcing from the People board) for Text/Call/Chat/Meet/Date/Visit/Host/Collaborate/Mentor/Volunteer/Email/Network; **Account** (`accountRef`) for Budget/Save/Earn/Invest/Spend/Pay/Track/Reconcile/Donate/Review(Financial). Every other dropdown in the table is a NEW field.

> **Project Pick note:** the seed already has a `project` field (occurrence-ref scoped to `Project:` pages, from the kanban). Boards want a board-scoped picker instead. At implementation, if the existing `project` field's optionsSource can be repointed at the Projects BOARD without breaking the kanban Status Router, reuse it and keep the name "Project"; otherwise mint "Project Pick" — check name uniqueness either way.

Scoping mechanism: one new hidden select field **Board Category** (`boardCategoryFieldId`), stamped on every option instance. Each dropdown field's `meta.optionsSource` is find-mode over `$allInstances` with predicate `fields.<boardCategoryFieldId>.value IS "<tag>"`, plus `addNew: { parentOccurrenceId: <that board's container occ id> }` — byte-for-byte the Library `library:"person"` pattern (see `createLiveData.js:1121` area for the `peopleAssigned` reference shape).

**Multi-board dropdowns:** a dropdown can query SEVERAL boards at once with an OR-group predicate — same find-mode, just:

```js
predicate: { logic: "OR", rules: [
  { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: "literal:grocery" },
  { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: "literal:wishlist" },
  { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: "literal:ingredient" },
  // …one rule per tag
]},
```

Multi-board fields in this seed:

| Field | Boards queried | Why |
|---|---|---|
| **Purchase Item** (NEW, multiSelect) | Grocery List + Wish List + Ingredients + Supplements + Equipment + Plants + Gift Ideas | Buy/Spend can log ANY buyable thing — a grocery run, a wish-list splurge, recipe ingredients, a plant, a gift. `addNew` parents into Grocery List (the everyday case). |
| **Ingredient** (multiSelect) | Ingredients + Grocery List | Cook/Eat can pull from the pantry list OR something just bought off the grocery list. `addNew` → Ingredients. |
| **Media** | Media + Songs + Courses | Listen/Watch can pick a podcast, a show, a single song, or a course video. |
| **Skill** | Skills + Songs | Practice covers "practice guitar" AND "practice Blackbird". |
| **Reading** | Readings + Verses | Read/Read Scripture can pick a book or a single passage. |
| **Savings Goal** | Savings Goals + Wish List | Save can fund a named goal or save TOWARD a wish-list item. |
| **Creative Work** | Creative Works + Projects | a creative piece and a project are both "the thing I'm working on" — Edit/Film/Compose can pick either. |
| **Idea** | Ideas + Prompts | Prototype/Invent pull from the idea inbox or riff on a creative prompt. |

**Boards that reference boards (recipe pattern):** option instances can bind the other dropdown fields, so a board entry carries its own composition —
- each **Meal** binds Ingredient (multi): a meal IS a recipe; pick a meal on Cook and its ingredient list is one click away;
- each **Workout Program** binds Movement (multi): a program IS a workout recipe (Push Day A = Bench Press + Incline Press + …);
- each **Event** binds People (multi) + Place: Game Night knows who is invited and where;
- each **Gift Idea** binds People: the gift knows who it is for;
- each **Savings Goal** binds Amount: the goal carries its target;
- each **Creative Work** binds Medium: the album knows it is a Piano piece.

**Every dropdown can mint new options (per user):** EVERY board dropdown field carries `addNew: { parentOccurrenceId: <its board's container> }` — the picker's "+ Add" entry types a new option straight onto the board, for all 34 boards, not just the capture-loop ones. Multi-board fields pick ONE home board for their addNew (Purchase Item → Grocery List, Ingredient → Ingredients, Media → Media, Skill → Skills, Reading → Readings, Savings Goal → Savings Goals, Creative Work → Creative Works, Idea → Ideas); new entries land there tagged with that board's category so every querying dropdown sees them immediately.

**Capture loops (`addNew` as journaling):** on top of that baseline, some boards GROW primarily from completing actions instead of being pre-curated — the dropdown's "+ Add" is the journal entry point:
- **Gratitude** → typing into its Gratitude Entry dropdown mints onto the Gratitude Log board (the board IS the gratitude journal);
- **Celebrate** → new Wins land on the Wins board (a trophy shelf that accumulates);
- **Brainstorm** → new Ideas land on the Ideas board (idea inbox), where Prototype/Invent later pick them up;
- **Buy/Spend** → unknown items land on the Grocery List.

### Per-action input field bindings (all actions also bind hidden Date; `completed` bound everywhere unless noted)

| Action(s) | Extra input fields |
|---|---|
| Eat | Meal, Ingredient (multi), Calories, Protein, Carbs, Fats (existing macro input fields) |
| Cook | Meal, Ingredient (multi), Duration |
| Drink | Beverage, Water (oz) |
| Sleep, Nap, Focus | Duration |
| Recover | Supplement (multi), Duration |
| Relax, Decompress | Leisure Activity, Duration |
| Celebrate | Win, Event, Leisure Activity |
| Exercise, Lift | Workout Program, Movement, Set 1–3, Weight 1–3 |
| Stretch | Movement, Duration |
| Walk | Route, Steps, Duration |
| Run | Workout Program, Route, Steps, Duration |
| Hygiene, Groom, Laundry, Dishes, Recycle, Forgive | (completed only) |
| Journal | Prompt, Mood (emotion wheel field) |
| Check In, Express, Vent | Mood |
| Reflect (both) | Prompt, Duration |
| Meditate (both), Mindfulness | Practice, Duration |
| Pray, Worship | Practice, Verse, Duration |
| Gratitude | Gratitude Entry, Practice |
| Read, Read Philosophy | Reading, Pages, Duration |
| Read Scripture | Reading (queries Readings + Verses), Pages, Duration |
| Study | Topic, Course, Duration |
| Memorize, Research, Explore, Analyze | Topic, Duration |
| Teach | Topic, Skill, Duration |
| Practice (Intellectual) | Skill, Duration |
| Watch | Media (queries Media + Songs + Courses), Duration |
| Listen | Media (queries Media + Songs + Courses), Duration |
| Text, Call, Chat, Email, Network | People |
| Meet, Date | People, Place, Event, Duration |
| Visit | People, Place, Gift Idea, Duration |
| Host | People, Place, Event, Duration |
| Collaborate | People, Project, Duration |
| Mentor | People, Skill, Duration |
| Volunteer | People, Place, Charity, Duration |
| Plan, Prioritize, Build, Code, Design, Write (Occ.), Review (Occ.) | Project, Duration |
| Budget | Account, Savings Goal, Amount (with flow) |
| Save | Account, Savings Goal (queries Savings Goals + Wish List), Amount (with flow) |
| Spend, Buy | Account, Purchase Item (multi), Amount (with flow) |
| Invest | Account, Savings Goal, Amount (with flow) |
| Earn, Pay, Reconcile, Review (Fin.) | Account, Amount (with flow) |
| Track | Account, Amount (with flow — `field.meta.flowToggle` visible so in/out/replace is one tap; replace SETS the account balance via `supportsReplace`) |
| Donate | Account, Charity, Amount (with flow) |
| Clean, Declutter, Organize, Vacuum | Area, Duration |
| Repair, Maintain | Equipment, Duration |
| Garden | Plant, Duration |
| Nature | Route, Duration |
| Serve | Charity, Duration |
| Sing, Dance, Compose | Song, Medium, Creative Work, Duration |
| Brainstorm | Idea, Prompt, Duration |
| Prototype, Invent | Idea (queries Ideas + Prompts), Medium, Duration |
| Journal Creatively, Write (Creative) | Prompt, Medium, Creative Work, Duration |
| Draw, Paint, Sketch, Craft, Photograph, Film, Edit | Medium, Creative Work (queries Creative Works + Projects), Duration |

### Page restructure

- **Routines** page (`kind:"board"`): 9 containers (one per dimension), each holding that dimension's action instances. Replaces the Daily Toolkit folder's 11 wellness pages (`wellnessPages` at `createLiveData.js:3976`). The Daily Toolkit folder now holds just this page (+ Pomodoro stays parented in the Intellectual container as its template home).
- **Tasks** page (`kind:"board"`): the same 9 dimension containers, EMPTY. Replaces the Todo List page (`todoPageModId`, `createLiveData.js:5371`) and its Home/Finance/Work/Personal/Plan containers.
- **Trackers** page (`kind:"board"`): ALL goal-metric occurrences (`goalInstances`, `createLiveData.js:3224`) AND the account balance displays (`accountInstances`) under one page named "Trackers". Replaces the Goals page (`goalsPageModId`, line 5381) and the Accounts page (`accountsPageModId`, line 5405). Same goals — trackers retargeted to the new actions.
- Unchanged: Schedule (+ Table + Canvas + Due seeding + day-col build), Day Page template + folder, Library, Bills, Daily Journal Questions, notebook doc pages, alarms, Pomodoro system, feeds. (The People PAGE is not in this list — it is replaced by the People board, see the boards table.)

### Tracker retargeting (same goals, new sources)

| Goal metric (unchanged label) | New source |
|---|---|
| Water | `Drink` completions' Water field (field unchanged — predicate keeps `water IS_NOT_EMPTY` style presence, still generic) |
| Steps | `Walk`/`Run` Steps field |
| Completed / Task Countdown | unchanged (generic: in-Schedule + Completed) |
| Pages Read / Reading Time | `Read`/`Read Scripture`/`Read Philosophy` Pages/Duration |
| Pomodoros | unchanged (Pomodoro system) |
| Mood (last + history) | unchanged (generic on the Mood field — now written by Journal/Check In/Express/Vent) |
| Connection Time | Duration on instances carrying the People field (presenceFieldId = `peopleAssigned`) |
| Phone Calls | `Call` completions (People rows) — picker-direct on the Call template occ |
| Nutrition totals (Calories/Protein/Carbs/Fats) | `Eat` macro fields (replaces 4 per-meal trackers with one `Eat`-scoped tracker writing the same 4 goal fields) |
| Total Workouts / Workout History | `Exercise`+`Lift` (presence discriminator switches from `muscleGroup` to the Movement field: `movementFieldId IS_NOT_EMPTY`) |
| Financial (Spent/Earned/balances) | unchanged mechanics (generic on Amount+flow); `supportsReplace` balance trackers now anchor on **Track** replace entries (Track = the universal Set-Account-Balance, per user) |

`presenceFieldId` per tracker follows the existing `makeTrackerOp` param — no marker fields, no label matching.

### Vintage theme palettes (from the two screenshots)

Shared '70s stripe accents (both themes): teal `#3e8e7e`, blue-teal `#2a7f8a`, mustard `#e0a63f`, orange `#e07b2a`, red `#d94f30`, maroon `#7d3049`, plum `#4a3b52`, avocado `#6d7434`, rust `#b34f24`.

- **Light vintage** (`vintage-light`, `dark: false`): cream page `#ece3d0`, surfaces `#e2d7c2` / `#d8ccb4`, text dark brown `#2b211d`, muted `#6a5c4e`, borders `#b3a68f`. Primary action accent = rust `#b34f24`.
- **Dark vintage** (`vintage-dark`, `dark: true`): dark-brown page `#241a18`, surfaces `#2e2220` / `#3a2c28`, text cream `#ece3d0`, muted `#b3a68f`, borders `#4a3a34`. Primary action accent = mustard `#e0a63f` (rust reads muddy on dark brown; mustard is the poster-title color in the dark tiles).

Dimension container colors (seeded `ownStyle`/container bg, replacing the current per-dimension hexes like `CRE_BG` at `createLiveData.js:3702`) — all drawn from the two reference images, distinct in both themes:

| Dimension | Hex |
|---|---|
| Physical | `#b34f24` (rust) |
| Emotional | `#7d3049` (maroon) |
| Intellectual | `#4a3b52` (plum) |
| Social | `#e08b31` (orange) |
| Spiritual | `#e0a63f` (mustard) |
| Occupational | `#6d7434` (avocado) |
| Financial | `#3e8e7e` (teal) |
| Environmental | `#4a8c5c` (green) |
| Creative | `#d94f30` (red) |

---

### Task 1: One-off rename (Live Grid → "test grid") + seed targets "Poms"

**Files:**
- Create: `server/scripts/renameLiveGridToTestGrid.js` (one-off, deleted after run — do not leave a dead script)
- Modify: `server/scripts/createLiveData.js:71` (`DEFAULT_GRID_NAME = "Live Grid"` → `"Poms"`)

**Interfaces:**
- Produces: the Atlas DB has NO grid named "Live Grid"; the old grid (all data intact) is named "test grid"; every later reseed creates/rebuilds a grid named **"Poms"** and can never touch "test grid".

- [ ] **Step 1: Inspect current grids (read-only)**

Run:
```bash
cd /home/joshpoms/moduli && node --env-file=.env -e '
import("./server/models/Grid.js").then(async ({ default: Grid }) => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const grids = await Grid.find({}, { name: 1, userId: 1, occurrences: 1 }).lean();
  for (const g of grids) console.log(g.name, "| user:", g.userId, "| panels:", (g.occurrences||[]).length);
  process.exit(0);
});'
```
Expected: exactly one grid named `Live Grid` (5 panels) plus the 1×1 scratch grid. Record the Live Grid's `userId` — the update in Step 2 must scope to it. (Check the env var name used in `server/scripts/createLiveData.js`'s mongoose connect and mirror it.)

- [ ] **Step 2: Write and run the rename (name change ONLY)**

```js
// server/scripts/renameLiveGridToTestGrid.js — one-off; run once, then delete.
import mongoose from "mongoose";
import Grid from "../models/Grid.js";

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
await mongoose.connect(uri);
const res = await Grid.updateOne(
  { name: "Live Grid" },
  { $set: { name: "test grid" } }
);
console.log("matched:", res.matchedCount, "modified:", res.modifiedCount);
await mongoose.disconnect();
```

Run: `node --env-file=.env server/scripts/renameLiveGridToTestGrid.js`
Expected: `matched: 1 modified: 1`

- [ ] **Step 3: Point the seed at "Poms"**

In `server/scripts/createLiveData.js:71` change:

```js
const DEFAULT_GRID_NAME = "Poms";
```

Then grep the file (and `deploydata.sh`, comments included) for the string `"Live Grid"` and update every remaining literal/log line to "Poms" so `dropExistingLiveGrid` and the summary logs are consistent.

- [ ] **Step 4: Verify (read-only) + confirm no reseed side-effects are possible**

Re-run the Step 1 inspection. Expected: `test grid` present, NO `Live Grid`. Also read `server/scripts/createLiveData.js:74-160` (`dropExistingLiveGrid` + `sweepStaleGrids`) and confirm: the drop is name-scoped to the new `DEFAULT_GRID_NAME` ("Poms") and the sweep only removes dead SKELETON grids (no panels/content) — "test grid" has 5 panels so it is untouchable by both. If the sweep's criteria could ever match "test grid", STOP and fix the sweep guard first.

- [ ] **Step 5: Delete the one-off script and commit**

```bash
rm server/scripts/renameLiveGridToTestGrid.js
git checkout -b poms-grid-nine-dimensions
git add -A && git commit -m "chore(data): rename prod Live Grid -> 'test grid' (one-off) + seed now targets grid 'Poms'"
```

---

### Task 2: Vintage themes — light + dark (the ONLY app-code change in this plan)

**Files:**
- Modify: `client/src/index.css` (add `[data-theme="vintage-light"]` + `[data-theme="vintage-dark"]` blocks after the `midnight` block ~line 318; also mirror the `html[data-theme="moduli-light"]` companion rule at line 320 for `vintage-light` if that rule carries light-mode-only overrides)
- Modify: `client/src/helpers/useTheme.js` (add two SYSTEM_THEMES entries + make `vintage-dark` the default)

**Interfaces:**
- Produces: theme ids `"vintage-light"` and `"vintage-dark"`; `DEFAULT_THEME = "vintage-dark"` (localStorage still wins for users who already picked a theme).

- [ ] **Step 1: Add the two CSS blocks**

Duplicate the entire `[data-theme="moduli-light"]` block (`client/src/index.css:139-227`) as `[data-theme="vintage-light"]`, and the `[data-theme="moduli-dark"]` block (lines 49-137) as `[data-theme="vintage-dark"]`. Every variable present in the source block must be present in the copy; write the values below into the ACTUAL variable names those blocks define (`--surface-*`, `--foreground-*`, `--border`, `--text-muted`, etc. — HSL-triple vars get the HSL equivalent of the hex):

```css
[data-theme="vintage-light"] {
  /* '70s vintage light — cream page, dark-brown ink, rainbow-stripe accents */
  /* page/base:  #ece3d0   surfaces: #e2d7c2 / #d8ccb4 / #cfc2a8 */
  /* text:       #2b211d   muted: #6a5c4e     borders: #b3a68f   */
  --accent-blue: #b34f24;            /* rust = primary action color */
  --accent-blue-hover: #9c421c;
  --accent-blue-text: #8a3a16;
  --accent-blue-bg: rgba(179, 79, 36, 0.14);
  --accent-blue-border: rgba(179, 79, 36, 0.45);
  --accent-green-text: #3e6e46;      /* vintage green */
  --accent-green-bg: rgba(74, 140, 92, 0.14);
  --accent-green-border: rgba(74, 140, 92, 0.40);
  --accent-purple-text: #4a3b52;     /* plum */
  --accent-purple-bg: rgba(74, 59, 82, 0.12);
  --accent-purple-border: rgba(74, 59, 82, 0.35);
}

[data-theme="vintage-dark"] {
  /* '70s vintage dark — dark-brown page, cream ink, mustard/teal accents */
  /* page/base:  #241a18   surfaces: #2e2220 / #3a2c28 / #46362f */
  /* text:       #ece3d0   muted: #b3a68f     borders: #4a3a34   */
  --accent-blue: #e0a63f;            /* mustard = primary action color */
  --accent-blue-hover: #c98f2c;
  --accent-blue-text: #eec563;
  --accent-blue-bg: rgba(224, 166, 63, 0.16);
  --accent-blue-border: rgba(224, 166, 63, 0.45);
  --accent-green-text: #7fc0ae;      /* teal */
  --accent-green-bg: rgba(62, 142, 126, 0.18);
  --accent-green-border: rgba(62, 142, 126, 0.45);
  --accent-purple-text: #d9a0b0;     /* maroon-rose */
  --accent-purple-bg: rgba(125, 48, 73, 0.20);
  --accent-purple-border: rgba(125, 48, 73, 0.45);
}
```

- [ ] **Step 2: Register both themes + default**

In `client/src/helpers/useTheme.js`, append to `SYSTEM_THEMES`:

```js
{
  id: "vintage-light",
  label: "Light Vintage",
  dark: false,
  description: "'70s cream with rainbow-stripe accents",
  swatches: ["#ece3d0", "#b34f24", "#3e8e7e"],
},
{
  id: "vintage-dark",
  label: "Dark Vintage",
  dark: true,
  description: "'70s dark brown with mustard and teal accents",
  swatches: ["#241a18", "#e0a63f", "#3e8e7e"],
},
```

and change `const DEFAULT_THEME = "moduli-dark";` → `const DEFAULT_THEME = "vintage-dark";`

- [ ] **Step 3: Verify**

Run: `cd client && npx vitest run 2>&1 | tail -3` (suite must stay green) and `npm run build 2>&1 | tail -3` (clean). Then headless: load the dev app with localStorage cleared → confirm dark-vintage brown/cream/mustard; set `localStorage["moduli-theme"]="vintage-light"` → cream/rust. Screenshot BOTH and check text legibility on every surface (toolbar, panels, containers, dropdowns, toasts).

- [ ] **Step 4: Commit**

```bash
git add client/src/index.css client/src/helpers/useTheme.js
git commit -m "feat(theme): Light Vintage + Dark Vintage '70s themes; Dark Vintage default"
```

---

### Task 3: Seed — Board Category field, dropdown fields, option boards

**Files:**
- Modify: `server/scripts/createLiveData.js` STEP 2 (fields, ~line 619+), STEP 3/6 (option instance modules + occurrences), STEP 7/8 (Boards folder + board pages)

**Interfaces:**
- Produces (used by Tasks 4–6): `boardCategoryFieldId`; dropdown field ids `mealFieldId, ingredientFieldId, purchaseItemFieldId, beverageFieldId, supplementFieldId, movementFieldId, workoutProgramFieldId, routeFieldId, readingFieldId, mediaFieldId, courseFieldId, practiceFieldId, promptFieldId, leisureFieldId, skillFieldId, topicFieldId, wishListItemFieldId, savingsGoalFieldId, charityFieldId, placeFieldId, eventFieldId, giftIdeaFieldId, areaFieldId, equipmentFieldId, plantFieldId, mediumFieldId, songFieldId, verseFieldId, gratitudeEntryFieldId, winFieldId, ideaFieldId, creativeWorkFieldId` (+ resolved Project field per the note); multi-board fields (Purchase Item, Ingredient, Media, Skill, Reading, Savings Goal, Creative Work, Idea) use the OR-group predicate from the Design Reference; `boardContainerOccIds` keyed by every tag in the boardCategory enum — **34 boards total**.

- [ ] **Step 1: Add the tag field + 9 dropdown fields to STEP 2**

Follow the exact shape of the existing `peopleAssigned` field (`~line 1121`). One tag field:

```js
boardCategory: {
  id: uid(), name: "Board Category", type: "select", inputEnabled: true,
  meta: { optionsSource: { mode: "manual",
    options: ["meal","ingredient","grocery","beverage","supplement","movement","route","reading","media",
              "practice","prompt","leisure","project","skill","topic","wishlist","charity","place","area",
              "equipment","plant","medium","song","person","program","course","event","gift","verse",
              "gratitude","win","idea","savingsGoal","creativeWork"] } },
},
```

Then one occurrence-ref field per board (single-select except People which already exists). Template (repeat for each row of the Boards table, substituting name + tag; `addNew.parentOccurrenceId` is patched in Step 3 after container occs exist — same two-phase pattern as `createLiveData.js:4773-4776`):

```js
meal: {
  id: uid(), name: "Meal", type: "occurrence", inputEnabled: true,
  meta: { optionsSource: {
    mode: "find",
    find: {
      over: "$allInstances",
      predicate: { logic: "AND", rules: [
        { left: `fields.${boardCategoryFieldId}.value`, comparator: "IS", right: "literal:meal" },
      ]},
      valuePath: "id", labelPath: "label",
    },
    addNew: { parentOccurrenceId: null /* patched post-create */ },
  } },
},
```

Mint: Meal, Beverage, Movement, Reading, Media, Practice, Area, Medium, Topic (+ resolve the Project field per the "Project Pick note" in the design reference). File them under a new "Boards" field category folder (stamp `categoryKind: "field"` like the other 9 field categories).

- [ ] **Step 2: Seed option instance modules + occurrences**

For each board, mint `role:"instance"` modules with `fieldBindings: [{ fieldId: boardCategoryFieldId, role: "input", hidden: true }]` and occurrences stamped `fields: { [boardCategoryFieldId]: { value: "<tag>" } }`, parented under that board's container occurrence. Reuse rules: Movements board REUSES the existing 30 exercise modules (they already exist with muscleGroup/sets bindings — add the boardCategory stamp to their occurrences rather than duplicating modules) + 3 new stretch instances. Readings board: stamp the existing Library book occurrences with `boardCategory: "reading"` + add the 3 new philosophy/scripture entries into the Library container (tagged). People board: MOVE the 10 existing person occurrences (profile fields, photos, `library:"person"` tag intact) under the People board container — the standalone People page (table + profile card + its Build op) is removed; `peopleAssigned` keeps its find-mode optionsSource with `addNew.parentOccurrenceId` repointed here. Accounts need no board (account instances already back `accountRef`). All other 20 boards mint fresh option instances per the table's seed-options column.

- [ ] **Step 3: Boards folder + pages + addNew patch**

Create a manifest folder "Boards" (sortOrder after Library) holding one `role:"page" kind:"board"` page per board — all 34 from the boards table: Meals, Ingredients, Grocery List, Beverages, Supplements, Movements, Workout Programs, Routes, Readings, Verses, Media, Courses, Practices, Prompts, Leisure, Projects, Ideas, Skills, Topics, Wish List, Savings Goals, Charities, Places, Events, Gift Ideas, Areas, Equipment, Plants, Mediums, Songs, Creative Works, Gratitude Log, Wins, People — each with its single container. Consider sub-grouping the Boards folder's tree by life area (Food, Body, Mind, Money, Home, Social, Creative) if 34 flat pages read as noise — folders are cheap; the pages are what matter. Mirror the Bills-page wiring shape (`createLiveData.js:5539` + `4218`). After container occurrences exist, patch EVERY dropdown field's `meta.optionsSource.addNew.parentOccurrenceId` (mirror `createLiveData.js:4773-4776`) — all 34 boards take "+ Add" from their dropdowns (per user); a null addNew target on any field is a bug. The addNew mint must stamp the new occurrence's `boardCategory` with the home board's tag (the `addNew` config carries the initial fields, same as the peopleAssigned `library:"person"` addNew shape) so every dropdown querying that tag sees the new option immediately. Recipe-pattern option instances (Meals→Ingredient, Workout Programs→Movement, Events→People+Place, Gift Ideas→People, Savings Goals→Amount, Creative Works→Medium) bind those fields on their modules and stamp seed values.

- [ ] **Step 4: Verify**

Reseed: `node --env-file=.env server/scripts/createLiveData.js` — expect success log. Then a read-only probe: resolve each dropdown field's optionsSource via a node script over the exported `server/seed/*.json` (or DB) asserting each board tag yields ≥3 options and zero duplicate field names grid-wide:

```bash
node --env-file=.env -e '/* load Field collection, group by lowercase name, assert no group >1 */'
```
Expected: `0 duplicate field names`, every board tag ≥3 options, and every board dropdown field has a non-null `addNew.parentOccurrenceId` resolving to a real board container occurrence (assert all three in the probe). Then one interactive check: open a dropdown, use "+ Add" to type a new option → it appears on the board page AND in every other dropdown querying that tag.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createLiveData.js server/seed
git commit -m "feat(seed): option Boards (34 pages incl. People, capture-loop + recipe boards) + Board Category tag + occurrence dropdown fields"
```

---

### Task 4: Seed — Routines page (9 dimension containers + action instances), replacing the 11 wellness pages

**Files:**
- Modify: `server/scripts/createLiveData.js` — instance modules (STEP 3, `toolkitInstances` region ~2241+), container modules (STEP 4 ~3689-3800), container→instance map (~3930-3970), `wellnessPages` (~3976) and its page wiring (STEP 8 ~5348-5364)

**Interfaces:**
- Consumes: dropdown field ids from Task 3.
- Produces: `dimensionContainerOccIds = { physical, emotional, intellectual, social, spiritual, occupational, financial, environmental, creative }` (Routines page) and `actionOccIds.<dimension>.<actionKey>` (e.g. `actionOccIds.physical.drink`) — Tasks 5–6 bind trackers/templates picker-direct to these.

- [ ] **Step 1: Replace the toolkit instance catalog with the action catalog**

Delete the old toolkit instance definitions (drinkWater, morningWorkout, meal instances, todo items, etc. — everything the 11 wellness pages held EXCEPT: the Pomodoro Session template and Pay Bills/Cancel Subscription (billRef/subscriptionRef mechanics), which are re-homed as Intellectual/Financial actions' peers). Set Account Balance is NOT carried over — **Track** (Amount with visible flow toggle, replace = set balance) supersedes it; point the `supportsReplace` tracker wiring at Track instead. Add one `role:"instance"` module per action from the Design Reference table, with input `fieldBindings` exactly per the per-action bindings table + hidden Date on every action (the DAILY-ROUTINE CONVENTION at line 2241). Example (complete, for Drink):

```js
drink: {
  id: uid(), label: "Drink", kind: "board", defaultDragMode: "copy",
  fieldBindings: [
    { fieldId: fields.completed.id,    role: "input", order: 0 },
    { fieldId: beverageFieldId,        role: "input", order: 1 },
    { fieldId: fields.water.id,        role: "input", order: 2 },
    { fieldId: dateFieldId,            role: "input", order: 3, hidden: true },
  ],
},
```

- [ ] **Step 2: 9 dimension containers + mapping**

Replace the wellness sub-containers (physicalMovement/physicalHydration/meal*/…Exercises) with 9 containers labeled exactly: Physical, Emotional, Intellectual, Social, Spiritual, Occupational, Financial, Environmental, Creative — each `ownStyle` background from the dimension-color table. Container→instance map lists every action key for its dimension. Keep the Pomodoro template occurrence parented in Intellectual (preserve `pomodoroTemplateOccId` capture at ~4005).

- [ ] **Step 3: One Routines page**

Replace `wellnessPages` (11 entries) with a single Routines board page hosting the 9 containers; the Daily Toolkit folder + hub panel tab list now shows Routines (STEP 8 loop at 5348 collapses to one page). Grep for every use of `wellnessPages` / `wellnessPageOccs` / removed container ids and fix all references — the seed must run clean end-to-end.

- [ ] **Step 4: Reseed + verify**

Run the seed; then headless: open the grid, confirm the Routines page shows 9 colored containers with their actions, and an action's dropdown (e.g. Drink → Beverage) lists the board options and commits a pick.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createLiveData.js server/seed
git commit -m "feat(seed): Routines page — 9 wellness-dimension containers with granular action instances (replaces 11 wellness pages)"
```

---

### Task 5: Seed — Tasks page (empty dimension containers) + Trackers page (all goals + trackers)

**Files:**
- Modify: `server/scripts/createLiveData.js` — Todo List page block (~5371), Goals page block (~5381), Accounts page block (~5405), todo/goal container definitions (~3747, ~3839-3860, ~4139-4190)

**Interfaces:**
- Consumes: `goalInstances` (~3224) and `accountInstances` unchanged; `goalOccIds` map (~4174) unchanged so every `goalOccurrenceId:` tracker call site keeps working.
- Produces: page "Tasks" (9 empty dimension containers, `meta.todoListContainer` semantics preserved on them so drag-to-Schedule flows keep working); page "Trackers" hosting ALL goal containers + account displays.

- [ ] **Step 1: Tasks page**

Replace the Todo List page + its 5 containers with a "Tasks" board page holding 9 EMPTY containers (same labels/colors as Routines' dimensions, fresh container modules — do not multi-parent Routines' containers). Delete the seeded todo instances (renewLicense, dentistAppt, fileInsurance…) — the user supplies task data later. Carry over `filterOverride: {}` (todo containers ignore the date filter, per ~3837 comment).

- [ ] **Step 2: Trackers page**

Replace the Goals page AND the Accounts page with one "Trackers" board page. Its children: every existing goal container (physGoalContOccId etc. holding the `goalInstances` per-metric occurrences) plus the accounts container (accountInstances: Checking, Savings, Mom's, Cash, Net Worth). Keep the Goals-page date-cascade behavior (goal containers get NO filterOverride — ~3839) so `$goalPeriod` resolution is unchanged. Update every reference to `goalsPageModId`/`accountsPageModId` (grep) — including ops that FIND the Goals page ancestor scope, which must now scope to "Trackers".

- [ ] **Step 3: Reseed + verify**

Seed runs clean; headless: Tasks page shows 9 empty colored containers; Trackers page shows all metric tiles (Water, Steps, Completed, Streak, Now, Pages Read, Reading Time, Pomodoros, Courses, Mood, Connection Time, Phone Calls, financial balances…) rendering values (0/— until Task 6 wires sources).

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js server/seed
git commit -m "feat(seed): Tasks page (9 empty dimension containers) + single Trackers page (all goals + account trackers)"
```

---

### Task 6: Seed — retarget trackers, Daily Routine template, and dependent ops to the new actions

**Files:**
- Modify: `server/scripts/createLiveData.js` STEP 12 (ops, ~6060+), STEP 7b (Daily Routine `routineBySlot` ~4875), Schedule Due seeding, day-page ops
- Do NOT modify `server/utils/liveSystemBuilders.js` (data-only rule) — every retarget must be expressible through existing builder params (`presenceFieldId`, `goalOccurrenceId`, picker-direct source ids); if one is not, stop and ask the user.

**Interfaces:**
- Consumes: `actionOccIds` from Task 4, `goalOccIds` (unchanged), field ids from Task 3.
- Produces: all trackers firing off the new action instances; Daily Routine template cloning new actions into slots.

- [ ] **Step 1: routineBySlot → new actions**

Replace the 6 picks (~4875) with new-action equivalents, e.g.:

```js
const routineBySlot = {
  "6:00am":  [{ occId: actionOccIds.physical.drink,    label: "Drink" }],
  "7:00am":  [{ occId: actionOccIds.physical.hygiene,  label: "Hygiene" }],
  "8:00am":  [{ occId: actionOccIds.physical.eat,      label: "Eat" }],
  "12:00pm": [{ occId: actionOccIds.physical.walk,     label: "Walk" }],
  "5:00pm":  [{ occId: actionOccIds.physical.exercise, label: "Exercise" }],
  "9:00pm":  [{ occId: actionOccIds.emotional.journal, label: "Journal" }],
};
```
(match the existing structure at 4875 exactly — keys/shape may differ; the point is WHICH instances, picker-direct.)

- [ ] **Step 2: Tracker call-site sweep**

Walk every `makeTrackerOp` / custom tracker pipeline in STEP 12 and update per the retargeting table in the Design Reference: presence discriminators (`presenceFieldId`) switch to the new fields (Movement for workouts, People for connection/calls), the 4 per-meal Nutrition trackers collapse to one Eat-scoped 4-macro tracker (protein written FIRST — `trackerValue()` reads the first write), COPY_LINK sources and FINDs use `$allItemsById.<new occ id>`. Completion gating (in-Schedule AND Completed via `_boundFieldIds`) is builder-level — untouched. Keep `grid.meta.scheduleFieldIds` stamping and the seeded 5 PM / 6:30 AM alarms' `sched` wiring intact.

- [ ] **Step 3: Server tests**

Run: `cd server && npx vitest run 2>&1 | tail -3`
Expected: all green (fix any builder-shape assertions that referenced removed instances).

- [ ] **Step 4: Reseed + behavioral verify (headless)**

Reseed, then verify end-to-end on the live app: (a) picker range → day-cols build with the new routine clones in their slots; (b) complete a Drink with Water 16 → Trackers page Water bumps; (c) drag Run from Routines into a slot, complete with Steps → Steps bumps; (d) complete an Eat with macros → 4 nutrition tiles; (e) complete Exercise with Movement pick + sets → Total Workouts + Workout History row; (f) delete the completed item → tracker decrements.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createLiveData.js server/utils server/seed
git commit -m "feat(seed): trackers + Daily Routine retargeted to the 9-dimension action instances (same goals, new sources)"
```

---

### Task 7: Client behavioral tests updated to the new seed

**Files:**
- Modify: `client/src/__tests__/liveOpsBehavioral.test.js` (+ any other test importing `server/seed/*.json` — grep `server/seed`)

**Interfaces:**
- Consumes: the freshly exported `server/seed/*.json` from Task 6's reseed.

- [ ] **Step 1: Run the client suite to find breakage**

Run: `cd client && npx vitest run 2>&1 | tail -20`
Expected: failures ONLY in seed-dependent behavioral tests (old labels "Drink Water", "Morning Workout", Todo List/Goals page names).

- [ ] **Step 2: Update assertions to the new world**

Rewrite the failing cases against the new instances/pages (Drink/Walk/Eat/Exercise, Tasks/Trackers pages), preserving the BEHAVIORS each test locks (both drop/complete orders, delete decrement, replace-flow balance math, multi-day rebuild). Add 2 new cases: (a) a board dropdown resolves its options from the tagged board occurrences; (b) an action completed with a board pick lands the pick in the tracker row (e.g. Call → Phone Calls row carries the person name).

- [ ] **Step 3: Full suites green**

Run: `cd client && npx vitest run 2>&1 | tail -3` and `cd server && npx vitest run 2>&1 | tail -3`
Expected: PASS / PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/__tests__ && git commit -m "test: behavioral suite retargeted to nine-dimensions seed + board-dropdown coverage"
```

---

### Task 8: Final verification, docs, deploy

**Files:**
- Modify: `CLAUDE.md` (handoff), `CLAUDE_CHAT.md` (user-direction log), `server/CLAUDE.md` + `client/src/CLAUDE.md` (folder logs)

- [ ] **Step 1: Full headless pass on the reseeded grid**

Checklist: Routines (9 colored containers, dropdowns work) · Tasks (9 empty) · Trackers (all tiles live) · Schedule build + drag + autoscroll · day page · Pomodoro Start lands in today's slot · alarm dropdown fine · Boards pages render + "+ Add" from a dropdown mints into the right board · "test grid" still selectable from the grid switcher with ALL its old content intact and untouched.

- [ ] **Step 2: Confirm "test grid" untouched**

Read-only DB probe: the test grid's `updatedAt`/panel count/occurrence count unchanged since Task 1 (except the name). If anything moved, find what wrote to it before proceeding.

- [ ] **Step 3: Docs + commit**

Update the handoff blocks; commit.

- [ ] **Step 4: Deploy (client theme + any server changes)**

`./deploy.sh` then verify prod HEAD: `ssh … git log --oneline -1` (lesson from 2026-07-11: never trust script output). Prod reseed is already done (dev=prod Atlas — the reseeds above WERE live).

---

## Self-Review Notes

- Every user requirement maps: rename-only (T1), theme (T2), boards + dropdown fields (T3), one Routines page with 9 dimension containers (T4), empty Tasks page (T5), single Trackers page with same goals (T5+T6), fields adapted/new (T3+T4), everything else unchanged (scope guards in T4–T6).
- Deliberate deviations to confirm with user at execution: (a) Accounts page folded into Trackers (reading "all the goals and trackers under one page" broadly); (b) Dark Vintage made the DEFAULT theme (Light Vintage available in the picker); (c) Todo List replaced by the Tasks page; (d) Project/People/Account dropdowns reuse the existing FIELDS (People is a board per user direction — the field just sources from it; the standalone People page with table + profile card is removed).
- Scope-rule check: Tasks 1 and 3–8 touch only seed/data (+ tests/docs); Task 2 is the sole app-code task (the two themes, explicitly requested). Task 6 must NOT modify `server/utils/liveSystemBuilders.js` — if an existing builder param can't express a retarget, stop and ask instead.
- The seed is 9.8k lines — Tasks 3–6 give anchors + complete shapes rather than full-file listings; each ends with a reseed + observable verification so drift is caught per-task, not at the end.
