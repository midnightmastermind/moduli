# Schedule Auto-Build & Optimistic File Upload — Design

_Date: 2026-04-25_
_Status: Draft for review_

## Summary

Four related features:

1. **Optimistic file upload** — Render the artifact tile (with spinner) the moment a file is dropped; upload happens in the background and the spinner is replaced by real content when the response arrives.
2. **Per-day timeslot containers** — Schedule slot containers carry a date field on each per-day occurrence, so the existing date filter can show the right day's slots.
3. **Schedule Auto-Build operation** — On `onLoad` / `onFilterChange` for the active filter date: ensure 48 timeslot container occurrences exist for that date, ensure a "Due" container occurrence exists at the top, seed three preset items (Drink Water, Take Medication, Go to Gym), and sweep todo-list items with a matching `dueDate` into the Due container.
4. **Move-out clears date** — When an occurrence is *moved* out of the schedule, its date + timeslot fields are cleared. *Copy* keeps them.

---

## 1. Optimistic File Upload

### Current flow (the problem)

`handleFileDrop` in `client/src/helpers/dropHandlers.js` does:

```
fetch(/api/artifacts/upload) → wait → response.module + response.occurrence → dispatch + insert
```

The drop spot stays empty until upload completes. Big files = visible blank slot for seconds.

### New flow

```
drop → generate IDs client-side → dispatch placeholder Module + Occurrence
     → insert into container immediately (artifact tile renders, spinner overlay shown)
     → fetch upload (background) → on success: updateModule({ fileRef, meta.uploadStatus: "ready" })
                                  → on failure: updateModule({ meta.uploadStatus: "error" })
```

### Module shape

The placeholder Module is created with:

```js
{
  id: <client-generated UUID>,
  role: "artifact",
  kind: <derived from file.type/name via mimeToKind — same as server>,
  label: file.name,
  fileRef: null,                           // populated when upload completes
  meta: {
    uploadStatus: "pending",                // "pending" | "ready" | "error"
    uploadFilename: file.name,
    uploadSize: file.size,
  },
  userId, gridId,
}
```

`meta.uploadStatus` is the rendering signal — independent from `fileRef` (which can be null briefly even after success during socket round-trip).

### Server change

`POST /api/artifacts/upload` accepts an optional `moduleId` + `occurrenceId` in the body. When provided, the server:

- Reuses those IDs (no new module/occurrence creation).
- Updates the existing module with the real `fileRef` + clears `meta.uploadStatus` (sets it to `"ready"`).
- Returns `{ module, occurrence, fileRef, url }` shaped the same as today.
- Broadcasts `module_updated` to other windows so they replace their placeholders.

If no `moduleId` provided, behavior is unchanged (back-compat path for any non-drop callers).

### Client change

`handleFileDrop` (`client/src/helpers/dropHandlers.js`):

1. Compute `kind` from `file.type`/`file.name` using a new shared helper (`mimeToKind` extracted to `client/src/helpers/fileKind.js` so it matches the server).
2. Generate `moduleId` and `occurrenceId` client-side.
3. Build the placeholder module + occurrence and dispatch them via `createModuleAction` + `createOccurrenceAction`. Also `socket.emit("create_module", ...)` and `socket.emit("create_occurrence", ...)` so other windows see the placeholder.
4. Run the existing container/panel-view/grid-cell placement logic immediately (using the placeholder occurrence).
5. POST `/api/artifacts/upload` with `moduleId` + `occurrenceId` in the FormData.
6. On success: server already broadcast the updated module — no client-side update needed (reducer is idempotent).
7. On failure: `CommitHelpers.updateModule({ id: moduleId, meta: { uploadStatus: "error" } })`.

### Renderer change

`client/src/modules/ArtifactContent.jsx` (or wherever an artifact module renders):

- If `module.meta.uploadStatus === "pending"`: render a centered spinner (existing `<Spinner />` from `client/src/ui/`) + filename caption. Skip the file-load path entirely.
- If `module.meta.uploadStatus === "error"`: render a "Retry" button that re-POSTs the file. (Out of scope for v1 — show error icon + filename; retry button is a follow-up. The user can drag the file again.)
- Else: render normally (existing path).

The container/panel that holds the artifact occurrence renders the artifact card unchanged — only the inner content area swaps based on `uploadStatus`.

### Why this works

Existing `handleFileDrop` already dispatches `createModuleAction` + `createOccurrenceAction` *before* updating the container (per the Apr 25 changelog entry). The remaining latency is the upload itself. By moving the dispatch *before* the fetch and shipping a placeholder, the visible delay is eliminated.

---

## 2. Per-Day Timeslot Container Occurrences

### Current state

The 48 slot Modules each have ONE occurrence, created at seed time, with `dateFieldId = today` + `timeslotFieldId = "<label>"`. The Schedule page filter:

```
dateFieldId === $nav OR dateFieldId IS_EMPTY
```

…matches today's slots. Switching to tomorrow: nothing visible (today's slots fail `=== $nav`, no other slots exist).

### New state

Each slot Module gets per-day occurrences. On a fresh day, the Schedule Auto-Build operation creates 48 new occurrences (one per slot Module), each with `dateFieldId = $activeDate` + `timeslotFieldId = "<slot label>"`. The existing filter then matches them.

### Slot module identification

Add to each slot Module's `meta`:

```js
meta: {
  scheduleSlot: true,
  slotHour: <0-23>,
  slotMinute: <0 | 30>,
  slotLabel: "<7:00am>",   // redundant with module.label but explicit
}
```

Set in `server/scripts/createTestGrid.js` STEP 4 when each slot module is inserted.

The auto-build operation finds these by looping over `$allModules` and filtering on `$item.meta.scheduleSlot === true`.

### Seed-data changes

- `server/scripts/createTestGrid.js`:
  - Slot Modules get `meta: { scheduleSlot: true, slotHour, slotMinute, slotLabel }`.
  - **Remove** the per-slot occurrence creation loop (lines ~358-372) — auto-build handles it.
  - **Remove** the `SCHEDULE_PREFILL` loop (lines ~374-411) — preset routine is now handled by the auto-build operation. Schedule page seeds with `occurrences: []`.
  - The Water Today / Tasks Completed Today demo aggregations will read 0/0 on a fresh seed until the user marks items completed. Test fixtures that asserted `56oz / 6 tasks` need to be updated or marked as obsolete (see Testing section).

---

## 3. Schedule Auto-Build Operation

### Triggers

```js
triggerTypes: ["onLoad", "onFilterChange"],
triggerObjects: [
  { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
  { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
],
```

Same trigger shape as the existing "Water Today" op.

### Sources

```js
sources: [
  { variableName: "triggerType", entityType: "trigger", triggerProp: "type" },
],
```

### Pipeline (top to bottom)

#### Step group 1 — Locate schedule page

```
INIT_VAR $slotsCreated = 0
FIND_OCCURRENCE moduleLabelExpr="literal:Schedule" → $schedPage, $schedPageId
IF $schedPageId IS_EMPTY → END (early exit; user has no schedule page)
```

#### Step group 2 — Ensure Due container exists for active date

```
FIND_MODULE meta.scheduleDueContainer === true → $dueMod, $dueModId
IF $dueModId IS_EMPTY:
  CREATE_MODULE name="Due", role="container", kind="list",
                meta={ scheduleDueContainer: true, sortPriority: 0 }
                → $dueModId

FIND_OCCURRENCE targetId=$dueModId, dateFieldId, dateExpr=$activeDate
                → $dueOcc, $dueOccId
IF $dueOccId IS_EMPTY:
  CREATE_OCCURRENCE_FOR_MODULE
    moduleIdExpr=$dueModId
    parentIdExpr=$schedPageId
    dateFieldId, dateExpr=$activeDate
    insertAtIndex=0                                  ← NEW config
    → $dueOccId
  INCREMENT_VAR $created
```

#### Step group 3 — Ensure 48 slot occurrences exist for active date

```
LOOP overExpr="$allModules" as $slotMod:
  IF $slotMod.meta.scheduleSlot === true:
    FIND_OCCURRENCE targetId=$slotMod.id, dateFieldId, dateExpr=$activeDate
                    → $slotOcc, $slotOccId
    IF $slotOccId IS_EMPTY:
      CREATE_OCCURRENCE_FOR_MODULE
        moduleIdExpr=$slotMod.id
        parentIdExpr=$schedPageId
        dateFieldId, dateExpr=$activeDate
        → $newSlotId
      SET_FIELD_VALUE
        occurrenceIdExpr=$newSlotId
        fieldId=timeslotFieldId
        valueExpr=$slotMod.meta.slotLabel
      INCREMENT_VAR $slotsCreated
```

#### Step group 4 — Seed preset routine (only if slots were just created)

Wrapped in `IF $slotsCreated > 0` so existing days (no slots created this run) skip seeding. Using `$slotsCreated` (not a combined counter) avoids accidentally seeding presets when only the Due container was newly created.

```
// --- Drink Water → 7:00am ---
FIND_OCCURRENCE moduleLabelExpr="literal:Drink Water" → $waterSrc
FIND_OCCURRENCE meta.scheduleSlot=true, slotLabel="7:00am",
                dateFieldId, dateExpr=$activeDate
                → $slot7amOcc, $slot7amId
CREATE_OCCURRENCE_FOR_MODULE
  moduleIdExpr=$waterSrc.targetId
  parentIdExpr=$slot7amId
  dateFieldId, dateExpr=$activeDate
  → $newOccId
SET_FIELD_VALUE occurrenceIdExpr=$newOccId, fieldId=timeslotFieldId, value="7:00am"
SET_FIELD_VALUE occurrenceIdExpr=$newOccId, fieldId=completedFieldId, value=false

// --- Take Medication → 8:00am --- (same shape)
// --- Go to Gym → 9:00am --- (same shape)
```

The slot occurrence's ID (`$slot7amId`, etc.) is the parent. Server-side auto-push (see §5) handles inserting the new occurrence ID into the slot's `occurrences[]`.

#### Step group 5 — Sweep todo-list items with dueDate matching active date

```
FIND_OCCURRENCE
  moduleMetaKey="todoListContainer", moduleMetaValue=true
  → $todoCont, $todoContId
// (Todo container module is tagged with meta.todoListContainer = true at seed time —
//  see §5c. Tagging is more reliable than label-matching, which could collide.)

LOOP overExpr=$todoCont.occurrences as $todoChildId:
  // Resolve $todoChildId → $todoChildOcc via $allOccurrences
  INIT_VAR $todoChildOcc = $allOccurrences[$todoChildId]
  IF $todoChildOcc.fields[dueFieldId].value SAME_DAY $activeDate:
    MOVE_OCCURRENCE_TO_PARENT
      occurrenceIdExpr=$todoChildId
      toParentOccIdExpr=$dueOccId
    SET_FIELD_VALUE
      occurrenceIdExpr=$todoChildId
      fieldId=dateFieldId
      valueExpr=$activeDate
```

### Idempotency

Every `CREATE` is gated by `FIND_OCCURRENCE → IF empty`. Re-running on an already-built day creates nothing. Preset seeding only runs when `$created > 0` — so a partially-built day (e.g. user deleted one slot manually) won't get re-seeded with all three presets.

### Where to define

`server/scripts/createTestGrid.js` STEP 12 — appended after the existing "Tasks Completed Today" operation.

---

## 4. Move-Out Clears Date

### Replace existing op

`server/scripts/createTestGrid.js` "Schedule: Clear Date & Time Slot" (lines ~655-669) is replaced with:

```js
{
  name: "Schedule: Clear Date on Move-Out",
  triggerTypes: ["onMove"],
  triggerObjects: [
    { eventType: "onMove", subjectType: "occurrence", targetId: "" },
  ],
  enabled: true,
  pipeline: {
    sources: [
      { variableName: "self", entityType: "trigger", triggerProp: "occurrenceId" },
    ],
    steps: [
      FIND_OCCURRENCE moduleLabelExpr="literal:Schedule" → $schedPage, $schedPageId
      INIT_VAR $selfOcc = $allOccurrences[$self]
      IF $selfOcc.parentId IS_NOT HAS_ANCESTOR $schedPageId:
        SET_FIELD_VALUE occurrenceIdExpr=$self, fieldId=dateFieldId,     value=null
        SET_FIELD_VALUE occurrenceIdExpr=$self, fieldId=timeslotFieldId, value=null
    ],
  },
}
```

`onMove` only fires for `OccurrenceListOp` (same occurrence relocated). Copy creates a *new* occurrence with a *new* ID — `OccurrenceCreateOp` — and does NOT fire `onMove`. So copy semantics are preserved automatically: the new copy keeps its inherited fields, the original is untouched.

### Detection logic

`HAS_ANCESTOR` already exists as a comparator. The `_ancestors` array is built per-loop-item by `gatherLoopItems` — but here we're checking `$self` directly, not inside a loop. We need the executor to expose `$self._ancestors` (or compute the ancestor chain inline for `$self`).

**Implementation detail:** Either (a) extend the executor to populate `$selfOcc._ancestors` when `INIT_VAR` resolves an occurrence object, or (b) wrap the IF in a single-iteration `LOOP overExpr="[$self]"` so the loop machinery generates `_ancestors`. Pick (b) for v1 — zero executor changes needed.

---

## 5. Required Infrastructure Changes

### 5a. Server: `create_occurrence` auto-pushes to parent

`server/socketHandlers/crud.js` `socket.on("create_occurrence", ...)`:

After saving the new occurrence, if `parentId` is set:

```js
if (occurrenceData.parentId) {
  const parent = uc.occurrencesById[occurrenceData.parentId];
  if (parent) {
    const insertAt = occurrence.insertAtIndex;            // optional, undefined = append
    const next = [...(parent.occurrences || [])];
    if (typeof insertAt === "number") next.splice(insertAt, 0, id);
    else                              next.push(id);
    const updatedParent = { ...parent, occurrences: next };
    uc.occurrencesById[occurrenceData.parentId] = updatedParent;
    await Occurrence.findOneAndUpdate(
      { id: occurrenceData.parentId, userId },
      { $set: { occurrences: next } }
    );
    socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedParent });
    socket.emit("occurrence_updated", { occurrence: updatedParent });
  }
}
```

Idempotent guard: if `id` already in `parent.occurrences`, skip the push.

`CREATE_OCCURRENCE_FOR_MODULE` effect handler in `bindSocketToStore.js` passes through `effect.insertAtIndex` to the socket payload.

### 5b. Action type: `MOVE_OCCURRENCE_TO_PARENT`

New action in `client/src/helpers/operationActions.js`:

```js
case "MOVE_OCCURRENCE_TO_PARENT": {
  const occId         = resolveExpr(cfg.occurrenceIdExpr, $vars);
  const toParentOccId = resolveExpr(cfg.toParentOccIdExpr, $vars);
  if (occId && toParentOccId) {
    updates.push({
      _effect: "MOVE_OCCURRENCE_TO_PARENT",
      occurrenceId: occId,
      toParentOccurrenceId: toParentOccId,
    });
  }
  break;
}
```

Effect handler in `bindSocketToStore.js`:

```js
case "MOVE_OCCURRENCE_TO_PARENT": {
  const occ = state.occurrencesById?.[effect.occurrenceId];
  if (!occ) break;
  const fromParentId = occ.parentId;
  // 1. Remove from old parent's occurrences[]
  if (fromParentId) {
    const fromParent = state.occurrencesById[fromParentId];
    if (fromParent) {
      updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
        id: fromParentId,
        occurrences: (fromParent.occurrences || []).filter(x => x !== effect.occurrenceId),
      }});
    }
  }
  // 2. Update moved occurrence's parentId
  updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
    id: effect.occurrenceId,
    parentId: effect.toParentOccurrenceId,
  }});
  // 3. Append to new parent's occurrences[]
  const toParent = state.occurrencesById[effect.toParentOccurrenceId];
  if (toParent && !(toParent.occurrences || []).includes(effect.occurrenceId)) {
    updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
      id: effect.toParentOccurrenceId,
      occurrences: [...(toParent.occurrences || []), effect.occurrenceId],
    }});
  }
}
```

Existing `MOVE_OCCURRENCE` (which takes `toContainerId` = a container *Module* ID) is left in place untouched.

### 5c. Seed module changes

`server/scripts/createTestGrid.js` STEP 4 — tag the Todo List container module:

```js
{ id: todoGeneralContId, userId, gridId, role: "container", kind: "list",
  label: "General", defaultDragMode: "move",
  meta: { todoListContainer: true },     // ← NEW
}
```

STEP 3 adds two instance modules:

```js
{
  id: takeMedicationModId, userId, gridId, role: "instance", kind: "list",
  label: "Take Medication", defaultDragMode: "copy",
  fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
},
{
  id: goToGymModId, userId, gridId, role: "instance", kind: "list",
  label: "Go to Gym", defaultDragMode: "copy",
  fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
},
```

Both added to the Daily Toolkit's Physical container (`physContOccId.occurrences`) so the auto-build operation can `FIND_OCCURRENCE` them by label.

---

## 6. File Map

| File | Change |
|---|---|
| `server/scripts/createTestGrid.js` | Slot modules get `meta.scheduleSlot/slotHour/slotMinute/slotLabel`. Remove per-day occurrence pre-creation + SCHEDULE_PREFILL. Add `takeMedicationModId` + `goToGymModId` instance modules. Add Schedule Auto-Build operation. Replace Schedule Clear op. |
| `server/socketHandlers/crud.js` | `create_occurrence` auto-pushes to parent (idempotent, supports `insertAtIndex`). |
| `server/server.js` | `/api/artifacts/upload` accepts optional `moduleId`/`occurrenceId`; updates existing module instead of creating when provided. |
| `client/src/helpers/dropHandlers.js` | `handleFileDrop` generates IDs + dispatches placeholder before fetch. |
| `client/src/helpers/fileKind.js` | NEW — extracted `mimeToKind` shared with server (or duplicated; server is JS). |
| `client/src/helpers/operationActions.js` | New `MOVE_OCCURRENCE_TO_PARENT` action. |
| `client/src/state/bindSocketToStore.js` | New `MOVE_OCCURRENCE_TO_PARENT` effect. `CREATE_OCCURRENCE_FOR_MODULE` effect passes through `insertAtIndex`. |
| `client/src/modules/ArtifactContent.jsx` | Render spinner overlay when `module.meta.uploadStatus === "pending"`; error icon when `"error"`. |

---

## 7. Testing

### Server

Add to `server/__tests__/`:

- `createOccurrenceAutoPush.test.js` — verify `create_occurrence` with `parentId` pushes to parent's `occurrences[]`, respects `insertAtIndex`, idempotent on re-emit.
- `artifactUpload.test.js` — verify `/api/artifacts/upload` with `moduleId`/`occurrenceId` updates existing vs creates new.

### Operation behavior (manual / scripted)

`server/scripts/testScheduleAutoBuild.js` (NEW): Run after `createTestGrid`. Simulates:

1. Set active date = today → run op → assert: 48 slot occurrences + 1 Due occurrence + 3 preset instance occurrences.
2. Re-run on same date → assert: nothing created (idempotent).
3. Switch active date = tomorrow → run op → assert: 48 + 1 + 3 fresh occurrences for tomorrow's date.
4. Add a todo item with `dueDate = tomorrow`, switch back to tomorrow → assert: todo moved into Due container, has `dateFieldId = tomorrow`.
5. Drag a schedule occurrence out (simulate `OccurrenceListOp`) → assert: date + timeslot fields cleared.

### Client

- E2E happy-path in `tests/e2e/`:
  - Drop a file → spinner appears immediately → spinner replaced by content within ~2s.
  - Navigate to next day → schedule populates within one frame.
  - Drag a slot occurrence to a non-schedule container → date field cleared.

### Manual smoke

Test grid: `node --env-file=.env scripts/createTestGrid.js && npm run dev`. Verify in browser:
- Schedule shows today's slots on first load (op fires `onLoad`).
- Arrow to tomorrow → tomorrow's slots populate.
- Arrow back → today's slots still intact.
- Drop image into any container → spinner → image.

---

## 8. Resolved Decisions

1. **Todo container identification.** Tagged with `meta.todoListContainer = true`. `FIND_OCCURRENCE` extended to support `moduleMetaKey`/`moduleMetaValue` lookup (parallel to existing `moduleLabelExpr`). Implementation note for the plan: `FIND_MODULE` already supports `meta` filtering via existing patterns — verify and reuse before extending `FIND_OCCURRENCE`.

2. **Multiple todo items at the same dueDate.** All get moved to Due. Order: iteration order of the todo-list at sweep time. Acceptable for v1.

3. **Re-ordering Due to top of schedule.** `create_occurrence` with `insertAtIndex: 0` puts the Due occurrence at index 0 of `$schedPage.occurrences`. Slots created afterward are appended → Due stays first. User-reorder later is fine.

4. **`$activeDate` granularity.** Stored as ISO date string (`YYYY-MM-DD`) in `filterNavState`. Comparisons use `SAME_DAY`. User's local timezone is implicit.

5. **`$selfOcc._ancestors` for Move-Out op.** Implemented via single-iteration loop wrapper (`LOOP overExpr="[$self]"`) — zero executor changes needed. `_ancestors` populated by existing `gatherLoopItems`.

---

## 9. Out of Scope

- Templates (the user explicitly said templates will replace the hardcoded preset routine later).
- Retry button on upload failure (v1 ships error icon only; user re-drags to retry).
- Cleanup of old per-day slot occurrences (they accumulate; eventual GC is a separate spec).
- Changing slot count or slot interval (always 48 × 30min).
- Moving Due back to todo when user changes its dueDate (one-way move for v1).
