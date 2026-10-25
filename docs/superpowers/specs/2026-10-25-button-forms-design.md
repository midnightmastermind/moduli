# Buttons and forms — design

User, 2026-10-25: *"make sure that button field inputs work, its refined, and it works with operations and i can
place them on any occurance. the operation should be able to take in the occurance and fields. … we need a form
builder that asks for user prompts, that we can hook up to buttons. so lets say i want add new movie to the movies
board. I could put a button on the board called new movie, and it would open up a window asking for information on
the movie then take it and add the movie to the movie board (through an operation)"* · *"make sure forms can work in
any part of the operation"* · asked to skip questions: *"use your best judgement"*.

## Intent

A button is the user's way to run one operation on one occurrence. A form is the operation's way to ask the user
several things at once. Together they make "New movie" on the Movies board: press, fill a window, a movie appears.
Everything stays an operation — nothing about movies or boards is written into the app.

## What exists (measured 2026-10-25)

- **Button field** (`field.type === "button"`, `meta.operationId`, `meta.buttonLabel`): `ui/Field.jsx` fires a
  `ButtonOp` transaction `{ operationId, occurrenceId, instanceId, fieldId }` and applies the results through
  `helpers/manualOpRun`. `matchesTrigger` runs exactly the named operation (2026-09-21). A second run path, the row's
  "Run" widget (`ModuleInstance.handleRunOperation`), builds its own transaction. `instanceId` is set to the
  OCCURRENCE id in Field.jsx (wrong — it is the module id elsewhere).
- **`$trigger.occurrence`** (executor enrichment): `{ id, moduleId, parentId, fields, _ancestors }` — no label, role,
  kind or children.
- **Where fields render:** instance rows, containers, pages, and file / textblock ROWS on boards and canvases (under
  the card, `ModuleInstance` with `renderBody`). NOT textblocks embedded in a doc (`InstanceTextblockNode` draws only
  the text), NOT panels.
- **Ask the user** (`GET_USER_INPUT`): one question per modal, `ui/UserInputModal.jsx` via
  `operationsBridge.requestUserInput`. Cancelling stops the rest.
- **Pausing only works at the top level of a pipeline.** `executeSteps` captures a continuation only for the
  top-level step list; a pause inside an IF or a LOOP is pushed into the parent's results and ignored — the steps
  after it in that block are silently dropped (the executor's own comment calls it the "MVP limitation"). A pause
  inside a called operation (`RUN_OPERATION`) is handled by the callee alone, so the caller carries on before the
  user answers. The same applies to every pausing action (CALL_API, READ_FILE, IMPORT_*), not only questions.

## Goals

1. A button works on ANY occurrence: instance, container, page, file row, textblock row (on a board AND in a doc),
   panel.
2. The operation a button runs receives the pressed occurrence and its fields: `$trigger.occurrence` with id,
   moduleId, parentId, label, role, kind, children ids, fields, ancestors; plus `$trigger.fieldId` (the button).
3. Refined button: one runner for both run paths; it cannot be double-pressed while its operation runs (including
   while a form is open); a run that fails or finds no operation says so.
4. A **form** is a pipeline step ("Ask with a form") that opens one window with several inputs and pauses the
   operation until submit; cancel stops the operation. Its answers are `$form.values.<key>` and
   `$form.fields.<fieldId>` (the second is ready to feed a Create step).
5. Forms (and every other pause) work **anywhere in an operation**: top level, inside IF/else, inside loops (a form
   per iteration), inside a called operation (the caller waits).
6. A **form builder**: the form step's editor — add an input bound to a grid field (it uses that field's real input:
   select, occurrence picker, date, rating…) or a free question (text, long text, number, yes/no, date, choice);
   label, help text, required, default (an expression, e.g. a field of `$trigger.occurrence`); reorder with ↑/↓;
   preview.
7. **"Add a form button"** on a container: one gesture makes a "New <X>" button field, an operation "New <X>" whose
   form asks for the fields the container's rows use and whose Create step adds a row to the container the button
   was pressed on, and binds the button to the container. Everything it makes is editable afterwards.

## Non-goals

- Reusable form records shared across operations (a form lives in its step; steps can already be copied/pasted).
- Forms in operations the SERVER runs (share rules): nobody is there to answer; the step refuses there with a log line.
- Conditional questions inside one form (use an IF between two form steps — goal 5 makes that work).
- Changing how GET_USER_INPUT looks.

## Anti-goals

- Hardcoding movies, boards, Board Category or any field name. The generator reads the container's own rows.
- A second way to run an operation from a click. Both button surfaces go through one runner.
- A pause that silently drops steps. After this work no pausing action may lose the steps after it.

## Decisions (my calls — the user delegated them)

- The form is a pipeline step, not a separate record. "Hook a form to a button" = the button's operation starts with
  a form step. The generator builds that shape.
- The generated operation MATCHES THE BOARD and shows every part as a step (user, 2026-10-25: *"match the boards but
  that should be built out via the operation (new occurance, what fields get added with what data, and putting focus
  on that new occurance after)"*): the form, then a Create that places the board's shared module when its rows share
  one (Movies → a new movie card named by the form) or else makes a row of the same role/kind as its siblings, with
  each form field and each value every existing row agrees on (e.g. Board Category = movie) listed in the step, then
  a "scroll to" step that focuses the new occurrence. Its parent is `$trigger.occurrenceId` — the container placement
  the button was pressed on. Create gains two keys for this: `module` (place an existing module) and `label` (the new
  occurrence's own name).
- The name of the new row is the form's first text item when its key is `name` (the generator always adds a required
  "Name" item first).
- Panels show their own bound fields in the panel header (like containers do under their label).
- A textblock embedded in a doc shows only its BUTTON bindings, as a small strip under its text — its text stays its
  body (a doc paragraph growing pills would be noise).
- Nested pauses are implemented by bubbling the continuation up through IF / LOOP / RUN_OPERATION, so existing
  pipelines with a nested CALL_API or READ_FILE start waiting correctly. A census of live operations with nested
  pausing actions is taken before shipping (Task 3).
