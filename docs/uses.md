# Moduli — Use Cases & User Scenarios

**What I want to use it for** — raw use cases driving design decisions.

---

## Core Use Cases

### Daily Planning
- Build a day schedule by dragging tasks into time slots
- Each slot is a container; each item is an instance with fields (duration, completed, notes)
- Drag "Morning Workout" from Toolkit → drop into 7:00am → creates occurrence for today
- At end of day: review which slots completed, how much time logged

### Habit Tracking
- Persistent instances (always visible) as habit templates in a Toolkit panel
- Copy to schedule each day; mark completed + log values (duration, reps, pages read)
- Daily Goals panel shows aggregate: total minutes, steps, pages across all completed habits
- Accounts panel shows lifetime totals (all-time workouts, total books read)

### Task Management (To-Do)
- `untilDone` occurrences: tasks appear until checked off, then lock to completion date
- Categorized containers: Home & Errands, Finance & Admin, Work Projects, Personal/Fun
- Priority field, due date field on each task
- Drag tasks between categories to reorganize

### Financial Tracking
- Instances for expense categories (groceries, utilities, subscriptions, restaurants)
- `amount` field (flow: out) + `income` field (flow: in) on each instance
- Daily Goals shows: Spent today / Earned today
- Accounts panel shows: Weekly income/expenses, monthly totals, net balance
- Budget Alert pipeline operation: notifies when daily spending exceeds threshold

### Health & Nutrition
- Calories, steps, water fields on physical instances
- Meal instances with `mealDescription` and `calories` fields
- Workout instances with `workoutType` and `duration` fields
- Weekly aggregation shows: average calories, total steps, total workout minutes

### Reading & Learning
- Reading instance: pick book from curated list (removeOnComplete removes once finished)
- Pages read field + duration → aggregates to "Pages this week", "Hours of reading"
- Podcast: name + duration → listening habit tracker
- Online Course: duration tracking for learning time

### Journaling & Reflection
- Day Page panel: daily rich text doc with field pills embedded
- Morning intentions, task section with instance pills, evening reflection Q&A
- Q&A field pairs: daily question (auto-cycles from pool) + answer field
- Evening: "What went well?", "What could be improved?", "Gratitude" pill pairs
- Focused instance view: drill into any instance to see its full doc + linked Q&A + history

### Watchlist / Reading List
- Select fields with `quickAdd: true` (type custom item if not in list) + `removeOnComplete`
- Movie watchlist: pick Inception/Interstellar/etc. → mark watched → disappears from list
- Book reading list: same pattern, with randomize button for surprise pick
- `randomize: true` on select field → shuffle button to suggest random pick

### Project Tracking
- Work instances per project with priority, due date, duration fields
- Occupational toolkit containers: Deep Work, Meeting, Email Block, Skill Dev
- Copy project instances from toolkit → schedule in time slots for the day
- Weekly aggregation: total focus hours, meeting time, skill dev time

---

## The Sibling Relationship ("If This Then That")

The `siblingLinks` system connects instances for conditional logic:
- "Pick leg workout" → another instance with dropdown of leg exercises appears → picking an exercise opens rep/set fields
- Q&A pairs: journalQuestion instance linked to journalAnswer instance (showing both in focused view)
- Future (Phase 6 Operations): sibling links + pipeline conditions = "if completed → show reward panel"

---

## Document Use Cases

### Day Page
Rich text doc pinned to today's date. Contains:
- Morning intentions (freeform text)
- Instance pills for today's habits (Physical, Intellectual, Mindfulness sections)
- Field pills for live data (Daily Question, Your Answer, Evening Reflection)
- Daily Stats hint for @ field inserts

### Stan Lyrics Example
Demonstrates **block pill** instances inside a doc:
- Each stanza is an instance with `notes` field
- The doc contains `instancePill` nodes with `pillDisplay: "block"` (not inline)
- Block pill shows header + full stanza text — drag stanzas to reorder

### Profile Notebook
8 interest category docs (Health, Finance, Technology, Music, Film, Reading, Personal Growth, Spirituality).
Quick Notes folder with 6 root-level markdown/text files from real note files.

### Doc Containers (kind: "doc")
A container that renders a TipTap rich text editor instead of an instance list.
- Used for daily journal in schedule panel
- Doc content stored on the occurrence (different content per day)
- Drag instances from panels → inserts instance pill at drop position

---

## Connection Use Cases (Phase 9)

### Bangle.js Watch
- See today's next 3 scheduled items on watch face
- Button press → marks current instance as done in Moduli
- Heart rate / step count pulled to field values

### Raindrop.io
- All saved bookmarks sync as instances in a "Reading Queue" container
- Tags from Raindrop → category field → iteration filtering
- Add URL field to instance from Moduli → saves as Raindrop bookmark

### Plex / Media Server
- Movie library → instances in Watchlist container
- Watch status (watched %, last watched) as field values
- Radarr: add movie from Moduli → triggers automatic search + download

### Email Inbox
- Starred emails → instances with subject (label), sender (tag), body (doc content)
- Archive email from Moduli → removes from inbox
- Reply draft → text field on occurrence

### Phone Share Sheet
- Highlight text in any app → Share → Moduli → note instance in Inbox
- Photo → Share → Moduli → OCR → note or scan overlay
- Link → Share → Moduli → instance with URL field

### Spotify
- Now-playing widget panel: current track, album art, play/skip controls
- Curated playlist button on container → plays matching playlist
- Mood-based playlist: select mood field value → auto-queues matching playlist

---

## Compound Iteration Use Cases

### Daily Work Filter
- Grid on "Daily" iteration + "Work" context filter
- Only work-tagged instances appear in all panels
- Perfect for "work mode" — hide personal tasks

### Weekly Personal Review
- Panel with own iteration: "Weekly" + "Personal" category
- Shows all personal goal instances for the full week
- Even while grid is on daily view

### Monthly Finance Overview
- Accounts panel with "Monthly" iteration (own mode)
- Shows total monthly income, expenses, net — even while rest of grid shows today's view

---

## Operations Use Cases

### Count Completed Tasks
Block tree operation: `countTrue(completed field, scope: grid, timeFilter: daily)` → writes to `totalCompleted` display field

### Budget Alert Pipeline
Pipeline operation (manual trigger):
- Source: grid entity as `$summary`
- Condition: `$summary.totalSpent > 50`
- Action 1: NOTIFY → "Daily spending exceeds $50"
- Action 2: SHOW_VALUE → write `totalSpent` to display field

### Future Operations
- Daily steps goal: if steps ≥ 10,000 → notify "Goal reached!"
- Weekly income tracker: auto-sum all income occurrences → show in Accounts
- Mood trend: last 7 days' mood selections → show most common mood

---

## Design Philosophy

The doc stuff vision (from user notes):
> "Like the Stan lyrics, with the title and text inside — that can be a container (container pill). Inside that container can be instances (smaller pills) and markdown text and media. Surrounding the container is still the document and it acts the same way with text wrapping. Except when we drag it off, it's a container now and not an instance. Instance pills can also be dragged inside the container or outside of it inside the doc. So we have markdown text, container pills, and 2 sizes of instance pills (one for container and one for the doc), inside the doc."

This vision drives the pill system in TipTap: FieldPill, InstancePill (inline/block), DocLink.

The system vision (from user):
> "Clean cut and make sense. Modularized like a spacecraft. Everything in its right place and no overhanging or special hardcoded places."

This is the Pragmatic Programmer applied to Moduli's architecture.
