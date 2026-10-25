# Buttons and Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button field that works on any occurrence and hands its operation the pressed occurrence; a form step
("Ask with a form") that pauses an operation anywhere in it; a form builder; and a one-gesture "Add a form button"
that makes "New movie" on a Movies board.

**Architecture:** One button runner (`helpers/buttonRun.js`) for both click surfaces. The executor learns to carry a
pause (any `_suspend` action) up through IF, LOOP and RUN_OPERATION, so a form can sit anywhere. The form is a new
pipeline action `ASK_FORM` that suspends with a form request; the existing user-input queue in `App.jsx` shows a new
`ui/FormModal.jsx` for it. The builder is the action's config editor. The generator (`helpers/formButton.js`) is a
pure planner plus one `withAction` that writes a field, an operation and a binding.

**Tech Stack:** React 19, Vitest (client `src/__tests__`, jsdom for `.jsx`), Playwright probes against prod
(`_build.mjs` harness, test grid 2 `6a9f14ad13d9a41198f43266`).

**Spec:** `docs/superpowers/specs/2026-10-25-button-forms-design.md`

## Global Constraints

- Nothing names movies, boards, Board Category or any field: the generator reads the container's own rows.
- Every write goes through CommitHelpers / `safeEmit` (never a raw `socket.emit` in a component).
- A press, a form submit and the generator are each ONE undo step (`withAction`).
- No pausing action may drop the steps after it — top level, IF, LOOP or a called operation.
- Probes write only to test grid 2; poms grid is changed only by the user in the app.
- Say "instances", not "rows", in anything the user reads.
- Client tests: `cd client && npx vitest run <file>`; the two pre-existing failures (`bookReaderHeadOneRow`,
  `operationExecutor` DATE_DIFF across the clock change) are not this plan's.

## Review Focus

1. **Cancelling a form inside a loop** — stops the whole operation; nothing after the form runs, nothing from later
   iterations runs; effects from earlier iterations stay (they were applied). Test in Task 3/4.
2. **Two presses of one button** before the first form is answered — the second press does nothing (busy), and the
   busy state clears on submit, on cancel, and when the operation finishes without pausing. Test in Task 1.
3. **A form opened in a headset reader window or a preview** (no `App` mounted, so no input host) — the operation
   stops with a console warning instead of hanging the button in "busy" forever. Test in Task 1 (no host → resolves).
4. **A form item bound to a field that was deleted** — the modal skips it and says so in the run log; the Create
   step gets no value for it. Test in Task 4.
5. **The generator on a container with no rows yet** — the form has only "Name"; the Create still works and binds
   nothing else. Test in Task 9.

---

### Task 1: One button runner, busy state, and the pressed occurrence's module id

**Files:**
- Create: `client/src/helpers/buttonRun.js`
- Modify: `client/src/ui/Field.jsx:1717-1765` (button branch), `client/src/modules/ModuleInstance.jsx:625-640`
  (`handleRunOperation`)
- Test: `client/src/__tests__/buttonRun.test.js`

**Interfaces:**
- Produces: `buttonTransaction({ op, hostOccurrence, fieldId }) -> { type:"ButtonOp", operationId, occurrenceId,
  instanceId, fieldId }` (instanceId = `hostOccurrence.moduleId`, never the occurrence id);
  `runButtonOperation({ op, hostOccurrence, fieldId, ctx:{ state, fieldsById, operationsById, occurrencesById,
  dispatch } }) -> Promise<{ ran:boolean, reason?:string }>` — resolves when the pipeline is DONE (after every
  pause), via the executor's `_onPipelineDone`; `useButtonRunner() -> { busy:boolean, run(args) }` (React hook,
  same file) that ignores `run` while busy.

- [ ] **Step 1: Write the failing tests**

```js
it("names the pressed occurrence and its MODULE", () => {
  const t = buttonTransaction({ op: { id: "op1" }, hostOccurrence: { id: "occ1", moduleId: "mod1" }, fieldId: "f" });
  expect(t).toEqual({ type: "ButtonOp", operationId: "op1", occurrenceId: "occ1", instanceId: "mod1", fieldId: "f" });
});
it("resolves only after a paused pipeline finishes", async () => { /* GET_USER_INPUT op; bridge resolves later;
  promise pending until then; then { ran: true } */ });
it("resolves { ran:false, reason:'no operation' } for a missing op", async () => {});
it("resolves (does not hang) when no input host is mounted", async () => { /* requestUserInput = null */ });
it("useButtonRunner ignores a second run while the first is pending", async () => { /* renderHook */ });
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/buttonRun.test.js` — FAIL (module missing).
- [ ] **Step 3: Implement** `buttonRun.js`: build the transaction, call `runMatchingOperations([op], "ButtonOp", t,
  { ...ctx, _onPipelineDone })` (pass ONLY the named op — `matchesTrigger` would pick it anyway), apply the returned
  updates with `applyManualOpUpdates` inside `withAction("Pressed <label>")`, resolve on `_onPipelineDone` (or
  immediately when the result has no trailing `_suspend`). Swap both click sites to it; Field.jsx's button shows
  `busy` (disabled + spinner icon) while pending.
- [ ] **Step 4: Run** the test file — PASS. Also `npx vitest run src/__tests__/buttonOpNamesOperation.test.js`.
- [ ] **Step 5: Commit** `feat(buttons): one runner for both click paths; busy until the operation finishes`.

### Task 2: `$trigger.occurrence` carries label, role, kind and children

**Files:**
- Modify: `client/src/helpers/operationExecutor.js:2136-2160` (enrichment), `client/src/helpers/triggerTypes.js:179`
  (`getTriggerVars`), `client/src/ui/DrilldownPicker.jsx` (`trigger` shape: `occurrence` drills into the
  occurrence shape)
- Test: `client/src/__tests__/triggerOccurrenceEnriched.test.js`

**Interfaces:**
- Produces: `$trigger.occurrence = { id, moduleId, parentId, label, role, kind, occurrences:string[], fields,
  _ancestors }` — label = `occurrenceDisplayLabel(occ, module)`; role/kind from the module.
  `getTriggerVars("onButton", subject)` includes `$trigger.occurrenceId`, `$trigger.occurrence`, `$trigger.fieldId`.

- [ ] **Step 1: Failing test** — run a one-step pipeline (`SHOW_VALUE` of `$trigger.occurrence.label`, `.role`,
  `.kind`, `.occurrences`) for a ButtonOp on a container occurrence; expect its label, `"container"`, `"board"`, its
  child ids. Second case: a deleted occurrence's snapshot still yields label/role (from `_occurrenceSnapshot` +
  module).
- [ ] **Step 2: Run** — FAIL (undefined).
- [ ] **Step 3: Implement** the four keys in the enrichment (modulesById is on the context); add the onButton vars.
- [ ] **Step 4: Run** the new test + `src/__tests__/operationExecutor.test.js` — PASS (bar the known DATE_DIFF case).
- [ ] **Step 5: Commit** `feat(ops): $trigger.occurrence names its label, role, kind and children`.

### Task 3: A pause works inside IF, LOOP and a called operation

**Files:**
- Modify: `client/src/helpers/operationExecutor.js` — `executeSteps` (2586+), `resumeContinuation` (2552),
  `executePipeline` (option `_deferSuspend`); `client/src/helpers/operationActions.js` RUN_OPERATION (~4395)
- Test: `client/src/__tests__/nestedPause.test.js`

**Interfaces:**
- Produces: a continuation may carry `next` — `{ remainingSteps, $vars, context, transaction, next? }`.
  `resumeContinuation` runs `remainingSteps`; if that finishes without pausing and `next` exists, it continues with
  `next` (the outer frame, with ITS `$vars`). A synthetic step `{ type: "loopRest", as, items, body }` resumes a
  loop's remaining iterations. `executePipeline(op, context)` with `context._deferSuspend === true` returns the raw
  result (trailing `_suspend` sentinel included) instead of handling it.

- [ ] **Step 1: Failing tests** (each pipeline asks with GET_USER_INPUT through a fake `requestUserInput` that
  answers "a", then writes `SHOW_VALUE` markers):
  - `if → then: [ask, mark "after-ask"]`, then top-level `mark "after-if"` → both marks, in that order.
  - loop over `[1,2,3]` with body `[ask, mark "$item:$userInput"]`, then `mark "done"` → `1:a 2:a 3:a done`; the loop
    var is gone afterwards.
  - cancel on the 2nd iteration (bridge rejects) → marks `1:a` only; no `done`.
  - caller `[RUN_OPERATION callee, mark "caller-after"]`, callee `[ask, mark "callee-after"]` → `callee-after` before
    `caller-after`, and `caller-after` sees caller vars, not callee vars.
  - existing top-level pause unchanged (`[ask, mark]` → mark).
- [ ] **Step 2: Run** `npx vitest run src/__tests__/nestedPause.test.js` — the nested cases FAIL (steps dropped).
- [ ] **Step 3: Implement** — in `executeSteps`, after each nested `executeSteps` (IF branches, loop body): if the
  returned list ends with a `_suspend`, return immediately with its continuation's `remainingSteps` extended:
  IF → `[...inner.remainingSteps, ...stepsArr.slice(stepIdx + 1)]`; LOOP → `[...inner.remainingSteps,
  { type:"loopRest", as, items: items.slice(i + 1), body }, ...stepsArr.slice(stepIdx + 1)]` (the current `$item`
  stays bound). Handle `loopRest` like a loop over its frozen `items`. RUN_OPERATION calls the callee with
  `_deferSuspend`; a trailing callee suspend becomes the caller's suspend with
  `continuation = { ...calleeCont, next: { remainingSteps: rest-of-caller, $vars, context, transaction } }`.
- [ ] **Step 4: Census before shipping** — `server/_nestedpause.mjs` (gitignored, read-only): count live operations
  on every grid with GET_USER_INPUT / CALL_API / READ_FILE / IMPORT_* inside an IF/LOOP body or a called op. Record
  the number and the op names in the commit message; each now WAITS where it used to drop steps.
- [ ] **Step 5: Run** the new test + `operationExecutor.test.js` + `dayPageReadings.test.js` — PASS.
- [ ] **Step 6: Commit** `fix(ops): a pause inside IF, a loop or a called operation waits instead of dropping steps`.

### Task 4: `ASK_FORM` — the form step and its window

**Files:**
- Modify: `client/src/helpers/operationActions.js` (new case beside GET_USER_INPUT, ~2664),
  `client/src/helpers/operationExecutor.js` `_handleSuspend` (the GET_USER_INPUT branch passes the request through
  unchanged — a form request rides the same bridge), `client/src/App.jsx:524-545` (queue head → `FormModal` when
  `request.form`), `client/src/ui/actionTree.js` (picker entry "Ask with a form" under the same group as Ask the
  user), `server/utils/serverExecutor.js` (ASK_FORM: log "a form needs someone in the app" and stop the pipeline)
- Create: `client/src/ui/FormModal.jsx`, `client/src/helpers/formItems.js`
- Test: `client/src/__tests__/askForm.test.js`, `client/src/__tests__/FormModal.test.jsx`

**Interfaces:**
- Consumes: Task 3 (a form inside IF/LOOP/called op).
- Produces: config `{ title, submitLabel, items: FormItem[], resultVar = "$form" }`;
  `FormItem = { key, label, fieldId?: string, type?: "text"|"longtext"|"number"|"boolean"|"date"|"select",
  options?: [{value,label}], required?: boolean, default?: expr, help?: string }`.
  Suspend request `{ form: true, title, submitLabel, items: [...items with `default` RESOLVED against $vars and
  `field` attached for fieldId items] }`. Resume value
  `{ values: { [key]: v }, fields: { [fieldId]: v } }` bound at `resultVar`.
  `formItems.js`: `itemKey(label, taken) -> string` (slug, unique), `missingRequired(items, values) -> key[]`,
  `answersToResult(items, values) -> { values, fields }`.
- `FormModal({ request, onSubmit(values), onCancel })`: one input per item — a fieldId item renders `ui/Field.jsx`
  controlled (`value` / `onChange` / `onCommit` on a local draft, `field = fieldsById[fieldId]`); a free item renders
  the matching plain input. Submit disabled while `missingRequired` is non-empty (the missing labels are named).
  Enter submits (not inside a long-text box), Escape cancels. `MenuSurface`-style drawer on a phone layout.

- [ ] **Step 1: Failing tests** — `askForm.test.js`: a pipeline `[ASK_FORM {items: name (required) + a number field
  item with default "$trigger.occurrence.fields.f1.value"}, SHOW_VALUE "$form.fields.f1"]`: the request carries the
  resolved default; answering `{name:"Dune", f1: 7}` shows 7; cancel shows nothing; an item whose fieldId is not in
  fieldsById is dropped from the request and logged. `FormModal.test.jsx`: renders one control per item; Submit is
  disabled until Name is filled and then calls `onSubmit({ name:"Dune", ... })`; Escape calls `onCancel`.
  `formItems` unit cases for slug uniqueness and `answersToResult`.
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement** the action, the helpers, the modal and the App routing.
- [ ] **Step 4: Run** both files + `actionEditorCoverage.test.js` — PASS (the coverage test fails until Task 5 adds
  the schema entry; add a minimal `ASK_FORM` schema now: `title`, `submitLabel`, `items` kind `formItems`,
  `resultVar` var defaulting to `$form`).
- [ ] **Step 5: Commit** `feat(ops): "Ask with a form" — one window, several answers, $form.values / $form.fields`.

### Task 5: The form builder (the step's editor)

**Files:**
- Create: `client/src/blocks/FormItemsEditor.jsx`
- Modify: `client/src/blocks/actionConfigSchema.js` (kind `formItems`), the config renderer that dispatches kinds
  (where `fieldMap` / `options` are rendered), `client/src/blocks/OperationsBuilder.jsx` `collectLocalVars` (ASK_FORM
  contributes `resultVar` with keys `values.<key>` and `fields.<fieldId>`), `client/src/ui/DrilldownPicker.jsx`
  (a local var may carry `keys`)
- Test: `client/src/__tests__/FormItemsEditor.test.jsx`

**Interfaces:**
- Consumes: Task 4 `FormItem`, `itemKey`, `FormModal`.
- Produces: `FormItemsEditor({ value: FormItem[], onChange(items), fieldsById })`: "+ Field input" (FieldSelect →
  item with that field's name as label, key from `itemKey`), "+ Question" (type select), per item: label, help,
  required checkbox, default (the existing expression box), ↑/↓, ×; "Preview" opens `FormModal` with the items
  (defaults shown as their expression text) and discards the answers.

- [ ] **Step 1: Failing test** — add a field input and a question, rename, mark required, move the question up,
  remove one; assert `onChange` receives the expected arrays (keys stay stable when a label changes). Preview opens a
  dialog with both inputs.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; wire `collectLocalVars` so a later step's picker offers `$form › fields › <field
  name>` and `$form › values › <label>`.
- [ ] **Step 4: Run** the test + `actionEditorCoverage.test.js` + `localVarsFromSchema.test.js` — PASS.
- [ ] **Step 5: Commit** `feat(ops): the form builder — field inputs and questions, required, defaults, preview`.

### Task 6: Buttons on panels and on textblocks inside docs

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (panel header: `<OccurrenceFields>` for the panel occurrence, after
  the page name, same props shape ModulePage passes), `client/src/docs/pills/InstanceTextblockNode.jsx` (a strip of
  the module's `type:"button"` bindings under the text, each a `Field` with `hostOccurrence`)
- Test: `client/src/__tests__/buttonsEverywhere.test.jsx`

**Interfaces:**
- Consumes: Task 1 (`Field`'s button branch uses `runButtonOperation`).
- Produces: `buttonBindings(module, fieldsById) -> binding[]` (exported from `InstanceTextblockNode.jsx`'s helper
  module `client/src/helpers/buttonBindings.js`): visible bindings whose field type is `button`, in binding order.

- [ ] **Step 1: Failing tests** — `buttonBindings` returns only button bindings, skips hidden ones; a source guard
  that ModulePanel renders OccurrenceFields for the panel occurrence and InstanceTextblockNode renders the strip
  (with a control that the textblock body is still rendered).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(buttons): buttons on panels and on textblocks inside docs`.

### Task 7: The button field's editor makes its operation

**Files:**
- Modify: `client/src/ui/commandCenter/FieldsTab.jsx` (button section near `buttonOperations`, line ~299)
- Test: `client/src/__tests__/buttonFieldEditor.test.jsx`

**Interfaces:**
- Produces: a "New operation for this button" button: creates an operation `{ name: <button label or field name>,
  triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: field.id }], pipeline: { steps: [] } }`
  through `CommitHelpers.createOperation`, writes `meta.operationId`, and opens it in the Operations tab (the tab's
  existing "select op" path). The operation picker lists button operations first, then the rest under "Other".

- [ ] **Step 1: Failing test** — clicking it calls createOperation with an onButton trigger on this field and then
  updates the field's `meta.operationId` to the new id, in one action.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(buttons): a button's settings can make its operation`.

### Task 7b: Create can place an existing module and name the new occurrence

**Files:**
- Modify: `client/src/helpers/operationActions.js` CREATE (~1848-2120), `client/src/blocks/actionConfigSchema.js`
  CREATE entry (two new keys in its "more" section), `server/utils/serverExecutor.js` CREATE (same two keys)
- Test: `client/src/__tests__/createPlacesModule.test.js`

**Interfaces:**
- Produces: CREATE `module` (expr → an existing module id; when it resolves to a module that exists, the new
  occurrence PLACES it — no module is minted, `role`/`kind`/`name` lookup are skipped) and `label` (expr → the new
  occurrence's own `label`, its placement name). Both optional; absent = today's behaviour exactly.

- [ ] **Step 1: Failing tests** — CREATE `{ module: "movieMod", label: "$form.values.name", parent: "c1", fields:
  {f1: "7"} }` emits one CREATE_ITEM whose occurrence has `moduleId: "movieMod"`, `label: "Dune"`, fields f1=7, and NO
  CREATE_MODULE effect; a `module` that does not exist falls back to the name path; without the keys the emitted
  effects are byte-identical to before (snapshot of an existing CREATE config).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (client + server executor). **Step 4: Run** — PASS, plus
  `src/__tests__/operationExecutor.test.js`. **Step 5: Commit** `feat(ops): Create can place an existing module and
  name the new occurrence`.

### Task 8: "Add a form button" on a container

**Files:**
- Create: `client/src/helpers/formButton.js`
- Modify: `client/src/modules/ModuleContainer.jsx` (radial menu item "Add a form button…" in the container's items,
  all three header variants share the items list). The noun ("movie") is asked with a one-item form through the same
  `operationsBridge.requestUserInput` queue Task 4 adds — never `window.prompt`, which a headset panel never shows.
- Test: `client/src/__tests__/formButton.test.js`

**Interfaces:**
- Consumes: Task 4 `FormItem` / `itemKey`; `helpers/siblingFieldBindings.siblingFieldBindings`.
- Produces: `planFormButton({ container, containerModule, noun, occurrencesById, modulesById, fieldsById, gridId,
  userId }) -> { field, operation, binding }` (pure):
  - `field` = `{ name: "New <noun>", type: "button", meta: { buttonLabel: "New <noun>", operationId: operation.id } }`
    (name made unique against `fieldsById`);
  - `operation.pipeline.steps` — every part visible and editable in the operation (user, 2026-10-25: *"built out
    via the operation (new occurance, what fields get added with what data, and putting focus on that new occurance
    after)"*):
    1. `ASK_FORM { title: "New <noun>", items: [Name (key "name", required), one item per INPUT-role, non-hidden,
       non-button field the container's rows bind (sibling bindings)] }`
    2. `CREATE` MATCHING THE BOARD: when at least half the container's rows share one module (the Movies board's
       shared "Movie" module), `{ module: "<that module id>", label: "$form.values.name", parent:
       "$trigger.occurrenceId", itemIdVar: "$newId", fields: {...} }` — a new placement of the same module, named by
       the form; otherwise `{ role: <the rows' role>, kind: <their kind>, name: "$form.values.name", parent:
       "$trigger.occurrenceId", itemIdVar: "$newId", fields: {...} }`. `fields` = one entry per form field
       (`"$form.fields.<fid>"`) plus the agreed values as literals.
    3. `SCROLL_TO { itemIdExpr: "$newId" }` — the new occurrence is scrolled to and flashed.
  - agreed values = fields every row of the container holds with the SAME value (`agreedValues(rows, fieldIds)`,
    exported) — written as fixed values, not asked;
  - `binding` = a visible `{ fieldId, role:"input" }` added to `containerModule.fieldBindings`.
  `addFormButton(args)` runs it in one `withAction("Added form button")` via `createField`, `createOperation`,
  `updateModule`.

- [ ] **Step 1: Failing tests** — a container with two rows binding Title(text), Year(number), Board
  Category(select, both "movie"), Poster(media) and a hidden field: the form asks Name, Title, Year (not Board
  Category, not Poster, not the hidden one); the CREATE writes Board Category "movie" as a literal and Title/Year from
  `$form.fields`; parent is `$trigger.occurrenceId`; when both rows share module "movieMod" the CREATE carries
  `module: "movieMod"` and `label: "$form.values.name"`, and when they do not it carries their role/kind and
  `name`; the last step is SCROLL_TO `$newId`. Empty container → form is just Name and CREATE uses role instance. A
  second "New movie" field name gets a unique name.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(buttons): "Add a form button" builds New <X> from the container's own instances`.

### Task 9: Watched end to end, and the record

**Files:**
- Create (gitignored probes): `_formbutton.mjs`
- Modify: `CLAUDE.md` (new dated entry), `client/src/helpers/CLAUDE.md`, `client/src/ui/CLAUDE.md`

- [ ] **Step 1: Deploy** (`./deploy.sh`, untracked `_*.sh` moved aside first).
- [ ] **Step 2: Probe on test grid 2, by clicking:** a board with movie-like instances → radial "Add a form button…"
  → noun "movie" → the "New movie" button shows on the container → press → the window asks Name/Title/Year → fill →
  Submit → a new instance in that container with those values and the agreed Board Category, read back from Mongo;
  Ctrl+Z removes it. Press again → Cancel → nothing written.
- [ ] **Step 3: Probe a form inside a loop** (an operation built in the editor: loop over two items, a form per
  item, a SHOW_VALUE after the loop) — both forms appear in turn, the value after the loop shows.
- [ ] **Step 4: Probe buttons on a page, a panel, a file row and a doc textblock** — each runs its op and the op
  sees `$trigger.occurrence.label` of the place pressed (shown via SHOW_VALUE / a field write).
- [ ] **Step 5: Remove probe debris** through the app (`delete_occurrence`, `delete_operation`, `delete_field`).
- [ ] **Step 6: Commit** the CLAUDE.md entries.
