# Reset Data — What It Creates & What It Tests

**File**: `server/utils/createDefaultUserData.js`
**Run**: `cd server && node scripts/resetData.js`

---

## Overview

The reset script creates a complete 2x3 grid workspace showcasing all system capabilities. Every entity, field, and relationship is intentionally designed to test a specific feature path.

---

## Grid Layout

```
┌─────────────────┬──────────────────────┬─────────────────┐
│ Daily Toolkit    │ Schedule / Day Page  │ Daily Goals     │
│ (0,0)            │ (0,1) spans 2 rows   │ (0,2)           │
│ Copy mode        │ Stacked panels       │ Derived fields  │
├─────────────────┤                      ├─────────────────┤
│ Todo List        │                      │ Accounts        │
│ (1,0)            │                      │ (1,2)           │
│ Move mode        │                      │ Lifetime stats  │
└─────────────────┴──────────────────────┴─────────────────┘
```

---

## Panel Details

### 1. Daily Toolkit (copy mode)
**Tests**: Template drag-and-drop, copy mode, instance reuse across containers

8 wellness dimension containers, each with categorized instances:

| Container | Instances | Tests |
|-----------|-----------|-------|
| Physical | Morning Workout, Evening Run, Stretching, Drink Water, Take Vitamins, Sleep Log | Duration, Steps, Water, Calories, Energy rating, own style overrides |
| Intellectual | Reading, Listen to Podcast, Watch Movie, Online Course, Brain Games, Journaling | Select with quickAdd (book/movie lists), combined reading/watchlist fields |
| Emotional | Gratitude Practice, Meditation, Breathing Exercise, Mood Check-in, Self-Care | Multiselect mood (48 emotions), notes, own style (Meditation purple tint) |
| Social | Call a Friend, Family Time, Social Event, Help Someone | Duration, notes |
| Spiritual | Prayer/Reflection, Nature Walk, Spiritual Reading, Mindfulness | Duration, steps, pages |
| Occupational | Deep Work Session, Meeting, Email Block, Skill Development, Networking | Priority rating, notes |
| Financial | Budget Review, Track Expense, Purchase, Log Income, Check Investments, Savings Goal | Account select, amount with flow, income field |
| Environmental | Clean Desk, Declutter Space, Plant Care, Recycling, Eco-Friendly Action | Duration, notes |

**What this tests**:
- `defaultDragMode: "copy"` — dragging creates new occurrence, doesn't move original
- `iteration.mode: "persistent"` — toolkit items always visible regardless of date
- Field bindings with multiple fields per instance
- Flow values (in/out) on financial fields
- Select fields with quickAdd and removeOnComplete (reading list, watchlist)
- Multiselect (mood selector with 48 emotion options)
- Style overrides: Morning Workout (orange tint), Meditation (purple tint)

### 2. Todo List (move mode)
**Tests**: Categorized containers, untilDone persistence, task-oriented fields

4 categorized containers:

| Container | Instances | Tests |
|-----------|-----------|-------|
| Home & Errands | Buy groceries, Clean out garage, Fix leaky faucet, Return library books, Organize pantry | Due dates, duration, priority rating |
| Finance & Admin | Pay utility bills, Cancel subscription, Renew license, Dentist appointment, File insurance | Amount with $ prefix, due dates |
| Work Projects | Order supplies, Backup files, Update portfolio, Prep presentation | Priority, duration, amount |
| Personal / Fun | Call mom, Plan vacation, Birthday gift, Sign up for class | Notes, amount, due dates |

**What this tests**:
- `defaultDragMode: "move"` — dragging relocates the occurrence
- `iteration.mode: "untilDone"` — items visible until completed, then locked to completion date
- Multiple containers in a single panel
- Categorized task organization

### 3. Schedule (48 time slots)
**Tests**: Time-based container structure, daily-specific occurrences

48 containers labeled from 12:00am to 11:30pm (30-min increments). Empty by default — users drag from toolkit to schedule.

**What this tests**:
- Container-per-time-slot pattern
- `iteration.mode: "specific"` — dropped items belong to a specific day
- Large panel with many containers (performance)
- Cascading style: `childContainerStyle: { bg: "rgba(59,130,246,0.08)", borderRadius: "6px" }` (blue tint)

### 4. Day Page (artifact-viewer)
**Tests**: Rich text editor, pills, file system, tree sidebar

Notebook-style panel with:
- Tree sidebar (Manifest → Root folder → Day Pages folder + Documents folder)
- "Welcome to Moduli" sample doc
- "Daily Journal" day page with embedded pills
- "Stan — Eminem" lyrics doc with stanza instance pills

**Journal doc content tests**:
- H1/H2/H3 headings (with Obsidian live-preview — # shows only when cursor is on heading)
- Bullet lists
- Bold/italic text
- **FieldPill** (derived): `journalQuestion` — daily cycling question from pool
- **FieldPill** (input): `journalAnswer` — editable answer
- **FieldPill** Q&A pairs: "What went well?", "What could be improved?", "Gratitude:" — each with answer pills
- Inline field pill display (showLabel: false, showValue: true)

**Stan doc content tests**:
- Instance pills for each stanza (Intro, Chorus, Verse 1-4)
- Long text content alongside pills
- Document with many instance pill references

**File system tests**:
- Manifest model with rootFolderId
- Folder hierarchy (Root → Day Pages + Documents)
- Doc model with docType: "day-page" and "normal"
- View model with viewType: "notebook", activeDocId

### 5. Daily Goals (8 dimensions)
**Tests**: Derived field aggregation, targets, progress bars

8 containers matching toolkit dimensions. Each contains a summary instance with derived fields:

| Instance | Derived Fields | Tests |
|----------|---------------|-------|
| Physical Wellness | Completed (countTrue), Steps (sum, target: 10K), Water (sum, target: 64oz) | Multiple aggregation types, target progress |
| Intellectual Growth | Completed, Pages Read (sum, target: 30), Time Spent (sum, target: 480min) | Cross-panel aggregation |
| Emotional Balance | Completed, Latest Mood (last) | Non-numeric aggregation |
| Social Connection | Completed, Time Spent | Grid-scope sum |
| Spiritual Practice | Completed, Time Spent | Same derived fields, different context |
| Work Progress | Completed, Time Spent | Occupational tracking |
| Financial Health | Spent (sum, flowFilter: out), Earned (sum, flowFilter: in) | Flow-based aggregation |
| Environment Care | Completed | Simple countTrue |

**What this tests**:
- `mode: "derived"` fields with scope, timeFilter, allowedFields
- 6+ aggregation types (sum, count, countTrue, avg, last, first)
- Flow filtering (flowFilter: "in", "out", "any")
- Target values with period-based scaling
- Cascading style: `childContainerStyle: { bg: "rgba(34,197,94,0.08)", borderRadius: "8px" }` (green tint)

### 6. Accounts (lifetime stats)
**Tests**: All-time aggregation, financial tracking, derived fields without targets

5 containers with aggregate instances:

| Container | Instances | Tests |
|-----------|-----------|-------|
| Finances | Bank Account (net balance, weekly +/-), Mom's Account, Monthly Overview | All-time scope, weekly/monthly timeFilter, flowFilter |
| Fitness | Fitness Stats (total workouts, total steps) | Transaction-source aggregation |
| Learning | Reading Stats (total reading time, total pages) | Duration + number aggregation |
| Productivity | Productivity (completion rate %, time spent) | avg aggregation |
| Wellness | Wellness Score (latest mood, total water) | Mixed aggregation types |

**What this tests**:
- `timeFilter: "all"` — lifetime aggregation
- Multiple allowedFields per derived field (net balance = income.in - amount.out)
- Mom's Account conditional filtering (needs operations editor for full expression)
- Weekly/monthly scoped aggregation

---

## Fields Summary

### Input Fields (28)
| Field | Type | Tests |
|-------|------|-------|
| Completed | boolean | Checkbox variant, countTrue aggregation |
| Duration | duration | Hours + minutes input, sum aggregation |
| Priority | rating | 1-5 stars |
| Notes | text | Freeform text |
| Amount | number | $ prefix, flow: out, increment: 5 |
| Income | number | $ prefix, flow: in, increment: 10 |
| Calories | number | " cal" postfix, flow: in |
| Steps | number | " steps" postfix, flow: in |
| Water | number | " oz" postfix, flow: in |
| Mood | select | Multiselect, 48 emotion wheel options |
| Energy | rating | 1-5 stars |
| Pages | number | " pages" postfix, flow: in |
| Due | date | Date input |
| Category | select | work/personal/health/finance |
| Movie | text | Placeholder input |
| Book | text | Placeholder input |
| Podcast | text | Placeholder input |
| Workout | text | Placeholder input |
| Meal | text | Placeholder input |
| Activity | text | Placeholder input |
| Watchlist | select | quickAdd, removeOnComplete, 8 movie options |
| Reading List | select | quickAdd, removeOnComplete, 7 book options |
| Question Pool | select | 10 journal questions |
| Account | select | checking/savings/moms |
| Answer fields (4) | text | journalAnswer, wentWellAnswer, improvedAnswer, gratitudeAnswer |

### Derived Fields (22)
| Field | Aggregation | Scope | TimeFilter | Tests |
|-------|------------|-------|------------|-------|
| Completed | countTrue | grid | daily | Boolean counting |
| Time Spent | sum | grid | daily | Duration aggregation, target: 480 |
| Spent | sum | grid | daily | flowFilter: out |
| Earned | sum | grid | daily | flowFilter: in |
| Steps | sum | grid | daily | Target: 10000 |
| Water | sum | grid | daily | Target: 64 |
| Latest Mood | last | grid | daily | Non-numeric last value |
| Pages Read | sum | grid | daily | Target: 30 |
| Tasks | count | container | daily | Container-scoped |
| Net Balance | sum | grid | all | Multi-allowedFields (income.in + amount.out) |
| Weekly Income/Expenses | sum | grid | weekly | Weekly scope, flow filter |
| Monthly Income/Expenses | sum | grid | monthly | Monthly scope, flow filter |
| Mom's Account | sum | grid | all | Conditional filtering (needs operations) |
| Total Workouts | count | grid | all | Lifetime count |
| Reading Time | sum | grid | all | Lifetime duration |
| Completion Rate | avg | grid | weekly | Percentage metric |
| Daily Question | first | grid | daily | Sibling-linked to question pool |
| Q&A Questions (3) | first | grid | daily | Evening reflection questions |

---

## Other Entities

### Iterations (5)
- Daily, Weekly, Monthly — standard time filters
- Daily Work, Daily Personal — compound iterations (time + category)

### Category Dimensions
- Context: work, personal, health, finance

### Operations (1)
- "Count Completed Tasks" — block tree with countTrue aggregation (demonstrates operations model)

### Templates (1)
- "Morning Routine" — 6 toolkit instances (workout, stretching, water, vitamins, meditation, mood check)

### File Tree
- Root Folder → Day Pages (day-page type) + Documents (normal)
- 3 Docs: Welcome to Moduli, Daily Journal (day-page), Stan lyrics

### Views (1)
- Day Page View (notebook type, showTree: true, manifestId linked)

---

## Cascading Styles

| Entity | Style | Tests |
|--------|-------|-------|
| Schedule panel | childContainerStyle: blue tint (rgba(59,130,246,0.08)) | Panel → container style inheritance |
| Goals panel | childContainerStyle: green tint (rgba(34,197,94,0.08)) | Panel → container style inheritance |
| Morning Workout | ownStyle: orange bg + text (#fb923c) | Instance own style override |
| Meditation | ownStyle: purple bg + text (#c084fc) | Instance own style override |

---

## Sibling Links

| Field A | Field B | Purpose |
|---------|---------|---------|
| journalQuestion (derived) | journalQuestionPool (select) | Cycles through pool options by day |
| journalAnswer (input) | journalQuestion (derived) | Pairs answer with question |
