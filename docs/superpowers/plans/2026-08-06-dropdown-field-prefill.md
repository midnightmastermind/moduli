# Prefill From a Pick — a dropdown selection fills the fields it implies

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: NOT STARTED. The three questions in "Decisions the user still owns" must be answered
> before Task 3 — one of them (overwrite policy) changes the data shape.**

**User direction (2026-08-06):**
> "prefil fields if we have a dropdown field we are selecting thats pointed to another occurance. so
> for example, the ingrediants of food would have nutritional field and if i select that as the
> ingrediant, it would prefill the nutrition on eat. i need this chainable … like if i select meal,
> it would fill the ingrediants dropdown with all the ingrediants involved and the nutrition. this
> would be so i can set things that have similar fields. this is something that can be turned off (no
> prefill). i think we have a chaining thing that is similar to this with the dropdowns. i guess
> fitness ones wouldnt have this for now cause weight is dynamic everyday. but the setting should let
> me select what fields to prefill using that dropdown selection. also we need a way to be able to
> choose if we want a combine of fields. like if i have multiple ingrediants selected in a meal, i
> could prefill the nutrition info in that occurance, via adding up the nutrition value of each
> ingrediant. idk how to do this yet visually."

**Goal:** Picking an occurrence in a dropdown copies the values that pick implies onto the occurrence
you are editing — one hop or several, one source or summed across many — and every part of it is
per-field configuration, not code.

---

## What already exists (the "chaining thing" the user remembers)

The instinct is right; two pieces of this are built, and neither is quite it:

- **`helpers/addNewOption.js` — `buildStampFields`.** When you use "+ Add new" on an occurrence
  dropdown, the NEW option is stamped with the chosen parent's values for the dropdown's own
  predicate fields. **This is the same idea aimed the other way**: it copies DOWN to a thing being
  created, not ACROSS to the thing you are editing, and it only ever copies the fields that appear in
  the predicate. `collectPredicateFieldIds` (the walker that finds those field ids) is directly
  reusable.
- **`helpers/boundFieldSync.js` — `propagateBoundFieldWrite`.** Fans a write out to sibling
  occurrences that share a link-field value. Also a copy, but between siblings of one field, not
  from a picked occurrence to its picker.

And the SUMMING half already exists in op-land: the **Meal Nutrition** tracker loops a multi-select
pick array and accumulates macros across the picked occurrences (`makeTrackerOp`'s `multiSum`, and
the per-pick loops the 2026-07-25 retarget introduced). So "add up the nutrition of each ingredient"
is a solved computation — what is missing is doing it **at pick time, onto the occurrence you are
editing, as a stored value you can then hand-correct.**

**This plan therefore adds one new thing — a `prefill` config on a FIELD — and routes it through
existing machinery for everything else.**

## Architecture

**The config lives on the SOURCE dropdown field**, because that is what the user selects and what
knows where the values come from:

```js
field.meta.prefill = {
  enabled: true,
  // Which values to pull, and where they land. Both are field ids; `from` is read
  // on the PICKED occurrence, `to` is written on the occurrence being edited.
  // `to` defaults to `from` (the common case: the same field on both).
  map: [ { from: "<protein fid>", to: "<protein fid>", combine: "sum" }, … ],
  // How far a pick may keep filling: Meal -> Ingredients -> Nutrition is depth 2.
  chain: 2,
}
```

1. **One decision function, pure.** `helpers/prefillFromPick.js` exports
   `planPrefill({ field, picked, target, ctx, depth })` returning a list of
   `{ fieldId, value, sources }` — no writes, no React, fully unit-testable. This is where combine,
   chaining and the overwrite policy live.
2. **One commit point.** `Field.jsx`'s existing `handleChange` is the single place a pick is stored
   (single-select and multi-select both land there). After the pick commits, run the plan and write
   the results through `CommitHelpers.updateOccurrence` with a `triggerField` per write — so
   trackers and ops fire exactly as they do for a hand-typed value. **Do not add a second write
   path.**
3. **Chaining is recursion over the same function.** A prefilled value that lands in ANOTHER
   occurrence-dropdown field (Meal → Ingredients) re-enters `planPrefill` for that field, at
   `depth+1`, capped by `chain` and a visited-set. Precedent for both guards: `RUN_OPERATION`'s
   depth cap of 4 and `COPY_LINK`'s cycle Set.
4. **Combine is a reducer over the picked set.** `"replace"` (default, single pick), `"sum"`,
   `"avg"`, `"min"`, `"max"`, `"concat"`, `"union"` (for occurrence arrays — this is what fills the
   Ingredients dropdown from a Meal). Numeric reducers respect `{value, flow}` and skip
   non-numerics rather than coercing them to 0.
5. **Off is a first-class state**, at three levels: the field's `prefill.enabled`, a per-occurrence
   `meta.prefill: false` escape hatch, and a per-write undo (the write is one action, so Ctrl+Z
   reverts the pick and its fills together — `withAction` already groups them).

## Tech Stack

React 18, Vitest + @testing-library/react, Express + Socket.io, Mongoose.
Client tests `npm --prefix ./client run test`; server `npm --prefix ./server run test`.

## Global Constraints

- **`poms grid` is protected live data.** Field config changes go through `server/migrations/`.
- **No hardcoding.** Nothing in the code may know what "nutrition" or "ingredient" means — the
  config is data, exactly like `optionsSource`. (Standing rule, memory `feedback_no_hardcoding`.)
- **One user action = one trigger.** A pick fires its normal `MeasureOp`; the fills ride in the same
  action id so undo treats them as one step (memory `feedback_uniform_triggers`).
- **Unique field names** still hold — a "combine" that writes into a display twin must name the twin,
  not the input field.
- **Verify by diffing persisted state against a real database.** In-memory tests miss what Mongoose
  drops (`minimize` ate an empty `fields` object once already).

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/helpers/prefillFromPick.js` (new) | THE decision: `planPrefill`, the combine reducers, the chain walk, the overwrite policy. Pure. |
| `client/src/ui/Field.jsx` | After a pick commits, run the plan and apply it. The only commit point. |
| `client/src/ui/commandCenter/FieldsTab.jsx` | The prefill editor: enable, the `from → to` rows, combine per row, chain depth. Sits beside `SelectOptionsSourceEditor` (occurrence-type fields only). |
| `client/src/ui/FieldRenderer.jsx` | Renders the "prefilled" affordance on a value that came from a pick (see decision 2). |
| `server/models/Field.js` | Nothing — `meta` is already `Mixed`. **Confirm before assuming.** |
| `server/migrations/00NN-seed-prefill-configs.mjs` (new) | Configures the first real cases (Ingredient → macros; Meal → Ingredients + macros) on poms grid. |

---

## Decisions the user still owns

1. **What happens to a value you already typed?** Options:
   *(a)* **Fill only EMPTY fields** — safest, but a corrected pick never refreshes the numbers.
   *(b)* **Always overwrite** — predictable, but silently destroys a hand-correction.
   *(c)* **Tag prefilled values** (`fields[fid].prefilledFrom = <source field id>`) and overwrite only
   those; a hand-edit clears the tag and the value is then yours forever.
   **Recommend (c)** — it is the only one that answers "weight is dynamic every day" without a
   special case, and it is what makes the affordance in decision 2 possible. It adds a key to the
   field value shape, which is why it must be settled before Task 3.
2. **How does a prefilled value LOOK?** The user: *"idk how to do this yet visually."* Options, not
   exclusive: a small Σ/link glyph on the pill; a muted tint until touched; the contributing
   breakdown on hover ("12g protein = Chicken 8 + Rice 4"). **Recommend the glyph + hover
   breakdown** — the breakdown is the honest answer to "where did 12 come from", and the tint alone
   is easy to mistake for disabled.
3. **Does a pick fill fields the target module does not bind?** If Eat has no Carbs binding, does
   prefill create one? `ensureModuleBindingsForOccurrenceFields` already does exactly this for
   drops. **Recommend yes, binding hidden** — otherwise the value is stored and invisible, which is
   the failure mode this codebase has hit repeatedly.

---

### Task 1: `prefillFromPick.js` — the pure decision

**Files:** create `client/src/helpers/prefillFromPick.js`; test
`client/src/__tests__/prefillFromPick.test.js`.

- [ ] **Step 1: Failing tests**, written against the real shapes:
      - single pick, one mapped field → one write with the picked value
      - `to` omitted → defaults to `from`
      - multi pick + `combine: "sum"` → the sum, and non-numeric picks are SKIPPED not zeroed
      - `combine: "union"` on an occurrence-array field → the union of the picks' arrays (this is
        Meal → Ingredients)
      - `prefill.enabled: false` → empty plan
      - a mapped field whose picked value is empty → no write (do not overwrite with nothing)
      - overwrite policy per decision 1
- [ ] **Step 2: Implement.** `planPrefill` returns `{ writes: [{fieldId, value, flow, sources}] }`.
      Sources are kept so the UI can explain the number.
- [ ] **Step 3: Verify.** Tests green; A/B one guard (flip the enabled check) to prove they
      discriminate.

---

### Task 2: Chaining

**Files:** same two.

- [ ] **Step 1: Failing tests** — Meal → Ingredients (union) → macros (sum), asserting the macro
      total equals the sum over the ingredients the Meal named; `chain: 0` stops after the first hop;
      a cycle (A picks B, B picks A) terminates; depth cap honoured.
- [ ] **Step 2: Implement** the recursion with a visited Set keyed by `occurrenceId:fieldId` and the
      `chain` cap.
- [ ] **Step 3:** Property test — a chain can never write the same field twice with different values
      in one plan (first write wins, and the plan says which source it came from).

---

### Task 3: Wire it to the pick

**Blocked on decisions 1-3.**

**Files:** `Field.jsx`, `FieldRenderer.jsx`.

- [ ] **Step 1:** After the pick commits in `handleChange`, build the plan and apply each write via
      `CommitHelpers.updateOccurrence({ …, triggerField })`. All of it inside ONE action scope so
      undo reverts the pick and the fills together.
- [ ] **Step 2:** Render the prefilled affordance (decision 2).
- [ ] **Step 3:** jsdom test: picking an option writes the mapped fields; a second pick refreshes
      them; a hand-edit then a third pick leaves the hand-edited one alone (decision 1c).
- [ ] **Step 4:** Behavioral test in `liveOpsBehavioral` — the fills fire the normal trigger burst,
      so a prefilled Protein moves the day's Protein tracker exactly as typing it would. **This is
      the test that proves prefill did not invent a second write path.**

---

### Task 4: The editor

**Files:** `FieldsTab.jsx`.

- [ ] Enable toggle; `from → to` rows with a field picker on each side (reuse the picker the
      `chipDisplay` editor already uses); a combine select per row; chain-depth input.
- [ ] Only shown for `type: "occurrence"` fields — a select of strings has nothing to pull from.
- [ ] Live preview: "Picking *Chicken* would set Protein 31, Calories 165."

---

### Task 5: Configure the real cases + docs

- [ ] Migration configures Ingredient → macros and Meal → Ingredients + macros on poms grid. **Dry
      run and report before applying** — this changes how the user's own data behaves on the next
      pick.
- [ ] Fitness fields are deliberately NOT configured (weight is per-day, per the user).
- [ ] Seed mints the same config so a fresh grid matches.
- [ ] Folder CLAUDE.md updates; root session entry; deploy; verify prod HEAD.

---

## Risks

- **A pick that writes many fields writes many rows.** Batch into one `updateOccurrence` per target
  occurrence, not one per field, or a Meal pick becomes a burst of socket writes.
- **Chaining across occurrence arrays is quadratic** — a Meal with 20 ingredients each mapping 4
  macros is 80 reads per pick. Fine at these sizes; cap the plan (e.g. 200 writes) and log rather
  than silently truncating.
- **This overlaps trackers.** A tracker that SUMS ingredient macros across the day and a prefill that
  SUMS them onto the meal are different numbers with the same name. Keep prefill writing INPUT
  fields and trackers writing their display twins — the unique-name rule already forces the
  distinction, so do not undo it here.
- **The undo grouping is easy to get wrong.** The 2026-08-01 stack repair made one user action one
  step; a prefill that opens its own action scope would put the pick and the fills in separate undo
  steps and the user would undo half a change.
