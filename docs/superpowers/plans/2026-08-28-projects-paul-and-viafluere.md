# Two real projects on the Project template — and the two ops that could never fire

**Ask** (2026-08-28, queued mid-turn):
> "could you set up a plan to use the Project template and make a project for Pauls Clown Website
> and Via Fluere. make sure to include the ops and adding the tasks to schedule (set up starter
> tasks). we have a trello board in the template"
> → "they should go in a Projects folder" → "in root"

Everything below is measured against live `poms grid` (`6a690f6fb8e785df961a9f3c`), not read off the
code. Probes: `server/_proj{3,4,5,6}.mjs` (deleted after the plan; reproduce from this file).

---

## What already exists

```
root FOLDER  "Projects"            GLUN-qYb4zVq          <- the ask's home, already there
board        "Projects"            BiM0seM1KdDP          feed on Board Category CONTAINS "project"
  rows: Moduli v1 Launch · Portfolio Site · Home Lab · Garden Build
template     "Project: {ProjectName}"  FZ-uqepntDle      page/doc, in Templates folder
  - "Kanban" container/board                 sig=project:Kanban
      Backburner · Docket · Working On · In Review · Test · Complete   (sig=kanbanCol:<key>)
  - "Project Scope" textblock/doc            sig=project:Project Scope
live project "Project: Moduli v1 Launch"  f1e49145-…    in GLUN-qYb4zVq, 6 columns, ALL EMPTY
field        "Status"   OWQdY4aV7o5v   select [Backburner, Docket, Working On, In Review, Test, Complete]
field        "Project"  gu7mm3QeEED4   occurrence, options = instances tagged Board Category "project"
```

**The `Project` field is already bound by seven Occupational/Social routine actions** — `Plan`,
`Build`, `Code`, `Design`, `Collaborate`, `Review`, `Prioritize` — and **0 occurrences carry a
value**. That is the existing, unused seam between a project and the schedule: a routine placed on a
day, tagged with which project it was for.

**And the Tasks page already carries a `Paul's Website` container** holding one task,
`Work on Paul's website` (one of the twelve `0273` restored this morning). So half of one of the two
projects exists already, in a different shape.

---

## FINDING 1 — `Project: Create` has been INERT since 2026-08-03, and the data says so exactly

Its template lookup is:

```
FIND over $allOccurrences  where meta.templateName IS "Project Page"  -> $projectTplId
IF $projectTplId IS_NOT_EMPTY -> APPLY_TEMPLATE …
```

```
occurrences carrying meta.templateName == "Project Page"      0
occurrences carrying ANY meta.templateName                    6   <- all "Day Page", on stale day columns
the project template root FZ-uqepntDle carries                meta.templateModule: true
```

`0035` **unset `meta.templateName`** on template roots (CLAUDE.md 2026-08-03 records it, and records
that two client surfaces still read the retired key). The FIND therefore binds nothing, the guard
fails, and `APPLY_TEMPLATE` never runs. The op is `onLoad`, enabled, priority 5 — it has fired on
every page load for 25 days and emitted nothing.

**This is the same class as the 2026-08-11 template selector**, and it takes the same remedy that
entry already paid for: **resolve the template picker-direct by id** (`$allItemsById.FZ-uqepntDle`),
not by a marker some migration is free to retire. A label match would be worse — `Project:
{ProjectName}` is one rename from wrong, and the FIND would also match every CLONE.

**Its onLoad branch hardcodes `Moduli v1 Launch`** (name + a paragraph of scope). Left as-is, fixing
the lookup makes a 25-day-dormant op start writing on the next load. The name-collision guard
(`FIND $allPages label IS $projectPageName`) means it would find the existing page and skip — so it
converges — but *that is luck, not design*. The onLoad seeding branch is a demo artifact; it goes.

---

## FINDING 2 — NOTHING binds `Status`, so BOTH routing ops are unfireable

```
modules binding Status (OWQdY4aV7o5v)     0
```

`Project: Status Router` and `Project: Sync To Todo List` both trigger on
`onChange · field · OWQdY4aV7o5v`. No occurrence on the grid can carry that field, so **neither op
has ever fired.** The kanban is six containers you can drag between; the routing behind it is
declared and dead.

That makes the binding the load-bearing piece of this work: **a starter task that does not bind
`Status` leaves the trello board a static list.** It is also why the ops must be verified by driving
the real executor rather than by reading them — they have no track record.

### What the two ops do once a task can carry Status

- **`Project: Status Router`** — generic and correct. Walks `$task.parentId` → that column's
  `parentId` (the Kanban board) → the sibling column whose `label IS $newStatus`, then
  `MOVE_OCCURRENCE`. Nothing in it is project-specific, so it serves both new projects unchanged.
- **`Project: Sync To Todo List`** — `Backburner` **and** `Docket` both `COPY_LINK` / `MOVE` the
  mirror into **one hardcoded container, `EOgH5hxjHkQ4` = `Occupational` on the Tasks page**; any
  other status `DELETE`s the mirror. The 2026-05 spec called for a Backburner container and a Docket
  container on the Todo List page — the Todo List page became the **Tasks** page (nine wellness
  dimensions), which has neither. So the op was retargeted at the nearest dimension and both arms
  collapsed onto it. **Pre-existing; called out, not silently redesigned** — see Q2.

---

## FINDING 3 — the date filter will not hide any of this, and that was worth checking

```
grid.activeFilterValues   { Date(Eh7oi4HKdbHB): "2026-08-28" }
project page / kanban columns   filterOverride {}   fields {}
```

A row carrying **no** `Date` passes the filter on every day (2026-08-28 (3)). Tasks-page tasks carry
`Due`, never `Date`, and render — so kanban tasks minted with `Due` only will render too. **A starter
task must therefore NOT be stamped with `Date`**, or it becomes invisible on all but one day of the
year — which is precisely the 1,467-bookmark defect of 2026-08-23 (3).

---

## How a task reaches the schedule

`Schedule: Place Dated Work` is `onLoad` + `onFilterChange` + `onChange` on Time Slot / `Due` /
Completed On. It loops `$activePeriodDates` and places, per day, into containers under the Schedule
page. **So "adding the tasks to schedule" is a `Due` value on the task** — phase 2 places due work
into the day's `Due` container and sweeps it when it stops being due. No new mechanism is needed, and
none should be invented.

---

## The work

### Task 1 — make `Project: Create` able to run (`0274`)
- Template resolved **picker-direct**: `INIT_VAR $projectTplId = $allItemsById.FZ-uqepntDle`,
  replacing the dead `meta.templateName` FIND.
- **Drop the onLoad demo branch** (the hardcoded `Moduli v1 Launch` name + scope) and its `onLoad`
  trigger, so the op is what its ELSE branch already is: a manual run that asks for name + scope.
  A/B: with the branch restored, the op writes on load — that is the test.
- Keep the `FIND $allPages label IS $projectPageName` collision guard; it is what makes a re-run a
  no-op.
- `rootParent` stays `GLUN-qYb4zVq` — the root `Projects` folder the ask names, already correct.

### Task 2 — a `Project Task` module that binds `Status` (`0274`)
Bindings, each with a reason:
```
Status         OWQdY4aV7o5v   the trigger both routing ops need — the whole point
Project        gu7mm3QeEED4   which project; already bound by 7 routine actions, so the seam exists
Completed      tZWiPDQUDP74   what the Completed feed and every tracker read
Completed On   11fb…5cb08     stamped by Schedule: Stamp Completed On
Due            GVKdfbbkUEwW   what Place Dated Work matches — this is "adding tasks to schedule"
Days Until Due ZogHj-qFiPNS   the countdown every other task row carries
```
**`Date` is deliberately NOT bound** (Finding 3). Field ids resolved by name AND type at run time —
this grid carries duplicate field names (two `Due` fields: a display number and the real date).

### Task 3 — the two projects (`0275`)
For each of `Paul's Clown Website` and `Via Fluere`:
1. an option row on the **Projects board** — minted by writing `Board Category: ["project"]`, **never
   by pushing into `BiM0seM1KdDP.occurrences[]`**: that board is a materialized feed and a manual
   push fights `feedSync` (2026-08-13). The row appears on the next client load.
2. a project page under `GLUN-qYb4zVq`, cloned from `FZ-uqepntDle` through the **same
   `APPLY_TEMPLATE` path the op uses** — so a project made by hand and one made by the op cannot
   drift.
3. `{ProjectName}` / `{ProjectScope}` replacements filled.

### Task 4 — starter tasks in the trello board (`0275`)
`Project Task` instances in `Backburner` / `Docket` / `Working On`, each carrying `Status` equal to
the column it sits in (or the Status Router will move it on the first change) and `Project` pointing
at its own board row. **A handful carry a `Due`** so the schedule half is exercised rather than
asserted.

### Task 5 — reconcile `Paul's Website`, do not duplicate it
The Tasks page already holds a `Paul's Website` container with `Work on Paul's website`. Two readings
→ different work, so this is Q3 below rather than a guess.

### Task 6 — verification
- Drive **the real executor** over live data for both routing ops: change a starter task's `Status`
  and assert the row moves column, and that the Backburner/Docket mirror appears in `Occupational`.
  Neither op has ever fired, so nothing about them may be believed from reading.
- Read back **out of Mongo**, not off the log: 2 pages under `GLUN-qYb4zVq`, 6 columns each, N tasks,
  every task binding `Status`, **0 tasks carrying a `Date`** (the Finding-3 control).
- A control that the probe can fail: a task whose `Status` already equals its column must **not** be
  moved, and the Status Router's `$targetColId IS_NOT $currentColId` guard is what does it.
- Forced re-run reports converged.

---

## Decisions — asked before anything was written

**Q1. Via Fluere vs `Moduli v1 Launch` → RENAME the existing project.**
One project for the product rather than two overlapping ones. Safe because it was
measured first: all six of its kanban columns are EMPTY, so there is nothing to lose. The
migration REFUSES the rename if any column holds a task — that guard is what makes this a
rename instead of a relabelling of somebody's work.

**Q2. The Todo mirror → ONE CONTAINER PER PROJECT** on the Tasks page, keyed by the
container's own `Project` value. Not by label (one rename from wrong) and not by a
per-project id baked into the pipeline (which needs editing for every new project). Falls
back to `Occupational` — the old hardcoded destination — when a task names no project.

**Q3. `Work on Paul's website` → COPY-LINKED into the kanban**, sharing `moduleId` and a
`lg-<sourceId>` group. The consequence, stated rather than buried: once its Status leaves
Backburner/Docket, `Sync To Todo List` deletes the Tasks-page half by design. The task is
not lost — it lives on in the kanban. It starts at `Docket`.

---

## What shipped

- **`0274`** — both op pipelines regenerated from the seed's own builders.
  `Project: Create` resolves its template picker-direct and is manual-only;
  `Project: Sync To Todo List` was **extracted from the seed into
  `makeProjectSyncToTodoOp`** so a migration can share it, and routes per project.
  `shapeOf` strips generated step ids so "already converged" means something.
- **`0275`** — the rename, `Paul's Clown Website` (board row + template clone + token
  replacement), a Tasks-page container per project, 11 starter tasks binding `Status`, and
  the copy-link.

**Two leftovers the REHEARSAL caught, which no test would have.** Applied for real against
`test grid 2` and read back out of Mongo: the renamed project page still carried
`meta.templateModule` — so a live project read as a template root, which is exactly what
`gridIntegrity` keys on — and its poster ARTIFACT was still labelled `Moduli v1 Launch`.
Both fixed, and the poster is found through the row's own media BINDING rather than by
matching the old name, which would also hit anything else called that.

*Applying a migration to a disposable grid and reading the result back is what found both.
A dry run prints what it intends; only the applied state shows what it left behind.*
