# Prefill From a Pick — a dropdown selection fills the fields it implies

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: NOT STARTED. All open questions were answered 2026-08-06 — see "Decisions (settled)".
> Nothing is blocked.**

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
   `{ fieldId, value, sources }` — no writes, no React, fully unit-testable. This is where combine
   and chaining live. **There is no overwrite policy to encode: a pick always writes** (settled
   below), so nothing has to be remembered about where a value came from — which is what keeps the
   stored field shape `{value, flow}` exactly as it is today.
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
   reverts the pick and its fills together — `withAction` already groups them). Undo matters more
   than usual here: with always-overwrite it is the only way back to a hand-corrected value that a
   re-pick just replaced.
6. **Only fields that are BOTH mapped and already bound on the target are written** (settled below).
   Prefill never attaches a field to an occurrence — a pick fills what is there, it does not change
   what the thing IS.

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
| `server/models/Field.js` | Nothing — `meta` is already `Mixed`. **Confirm before assuming.** |
| `server/migrations/00NN-seed-prefill-configs.mjs` (new) | Configures the first real cases (Ingredient → macros; Meal → Ingredients + macros) on poms grid. |

---

## Decisions (settled 2026-08-06)

1. **A pick always overwrites.** User: *"it overwrites, i can edit it, if i change it and select it
   again, it overwrites it. so i can overwrite it but it will be overwritten if i make the selection
   again."* You can hand-correct any prefilled value; re-picking that dropdown replaces it. The
   rejected alternatives were fill-only-empty (a corrected pick would leave stale numbers behind) and
   tagging prefilled values so a hand-edit wins permanently (would have added a key to every stored
   field value). **This is the simplifying decision of the plan** — no provenance to store, no
   special cases, and re-picking is a deliberate act so nothing is lost silently by accident.
2. **No visual marker.** A prefilled value looks exactly like a typed one. Considered and declined:
   a glyph with a hover breakdown, a muted tint, an inline source line. **Known cost, accepted:**
   after a re-pick you cannot tell from the row that a number you had corrected has been replaced.
   The FieldsTab preview (Task 4) is where the arithmetic stays visible.
3. **Only fields that are already bound on the target get filled.** User: *"only fill fields it has,
   and selected as a prefill."* Two conditions, both required: the field appears in the prefill
   `map`, AND the target module already binds it. Prefill never adds a field to an occurrence —
   unlike a drop, which does. So configuring the map is not enough on its own; the receiving module
   must carry the field, which keeps "what this thing is" under your control.

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
      - **a mapped field the TARGET MODULE does not bind → skipped** (decision 3)
      - **a field the target already has a value in → written anyway** (decision 1: a pick wins)
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

**Files:** `Field.jsx`.

- [ ] **Step 1:** After the pick commits in `handleChange`, build the plan and apply each write via
      `CommitHelpers.updateOccurrence({ …, triggerField })`. All of it inside ONE action scope so
      undo reverts the pick and the fills together.
- [ ] **Step 2:** Nothing to render (decision 2) — the value is an ordinary value. Confirm no
      `FieldRenderer` change is needed rather than assuming it.
- [ ] **Step 3:** jsdom test: picking an option writes the mapped fields; hand-editing one then
      re-picking OVERWRITES it (decision 1); a mapped field the module does not bind is untouched.
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

### Task 6: DECIDE whether `sum` should apply FLOW (opened 2026-08-06, NOT started)

**User asked: "is [the prefilled adding-up] based on the fields flow right"** — read the shipped
code, and the honest answer is **no. Flow is CARRIED, not APPLIED.**

- `COMBINERS.sum` is a plain arithmetic sum of the raw values:
  `n.reduce((a, b) => a + b, 0)`. **Flow is never consulted in the arithmetic.**
- Flow is then stamped on the RESULT, taken from the first contributor that has one:
  `flow: flowSlot?.flow || "in"` (its comment says "so an 'out' amount stays an out" — which is
  true of the label it writes, not of the sum it wrote).

**Why that is inconsistent with the rest of the app.** Operation aggregation treats flow as
DIRECTION — `"out"` values are NEGATED, which is the whole reason one `amount` field can serve both
income and expenses (root `CLAUDE.md`, "Field Values and Flow"). Prefill sums magnitudes instead.
Concretely: sources at `+10 (in)` and `10 (out)` prefill **20**, not 0, and the write inherits
`"in"` purely because it came first.

**It does not bite today**, which is why it was never caught: the configured case is macros, and
macros are all `"in"`. It goes wrong the first time a prefilled field has mixed-flow sources —
money being the obvious one.

- [ ] **Decide (user's call — (a) is not backward-compatible):**
      **(a)** make `sum` flow-aware (negate `"out"`), matching operation aggregation — the
      consistent answer, but it silently changes the meaning of any future mixed-flow config;
      **(b)** leave `sum` alone and add a `sumSigned` combine, so existing config keeps its meaning
      and money opts in explicitly — the safe answer;
      **(c)** leave as-is and document that prefill sums MAGNITUDES, so a mixed-flow map is a
      configuration mistake rather than a code bug.
- [ ] Whichever is chosen, add a test with MIXED-FLOW sources — there is currently none, which is
      exactly why the gap survived review.
- [ ] If the behaviour changes, re-check migration `0042`'s configured maps (Ingredient → macros,
      Meal → Ingredients) — all `"in"` today, so no data moves, but assert that rather than assume.

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
  steps and the user would undo half a change. With always-overwrite and no visual marker, undo is
  also the ONLY recovery path for a hand-corrected value a re-pick replaced — so this is not
  cosmetic.
