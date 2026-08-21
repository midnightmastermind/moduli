# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

| # | Task | State |
|---|------|-------|
| 1 | **The `Completed` feed reaches only 1 of 3 ticked tasks** — its `scope` is an ancestor test through `buildParentMap` (child → ONE parent, *last writer wins*), so a task that is ALSO on the schedule falls out of Tasks-page scope arbitrarily. This is the real end-of-day defect | 🔎 measured; wants its own pass (shared resolver, render path) |
| 2 | **"What else is technically needed for the original vision"** — asked 2026-08-21, never answered | 📋 open ask |
| 3 | **Empty panel → root manifest folder in folder view** — asked, no commit found | ❓ unconfirmed |
| 4 | **Schedule apply ~1s** — `resolveOptions` predicate filter ~766ms, the residual after the index work | 📋 measured, not fixed |
| 5 | **Three external-data pipes** — Tasker profiles, ingest credentials, the four slow exports | 🚫 blocked on the user |

## Done — 2026-08-21 (end-of-day pass)

| Task | Where |
|------|-------|
| **RETRACTED — the end-of-day move.** `Tasks › Completed` is a **materialized feed** (`0060`), not a folder. `0179` built an op to move rows into it; that was a second mechanism beside the one that already existed | `0180` |
| Damage undone and **verified byte-identical to the pre-`0179` snapshot** — three rows back in `Emotional`/`Financial` at their original list positions, `meta.filedFrom` unset, op deleted | `0180` |
| The swept feed copy **re-minted itself** on the next load — verified in a browser, 0 page errors | probe |
| **`DATE_BEFORE_TODAY` / `DATE_IS_TODAY` / `DATE_AFTER_TODAY` were wrong west of UTC** — a bare `YYYY-MM-DD` parsed as UTC midnight, so *today* read as past. `DATE_BEFORE`, one `case` above, had already been fixed and says so. `Compute Next Due` had been treating a bill due TODAY as overdue | `dayKeyOf` |
| **`applyEffectsToLiveOccs` disagreed with the persisting handler twice** — `UPDATE_ITEM_PARENT` set `parentId` and neither parent's `occurrences[]`; `UPDATE_ITEM_META` read only the legacy `metaPatch` while `applyUpdate` emits `metaPath`, so every `meta.*` write was invisible to the rest of the sweep | `operationExecutor` |
| **Four rows whose `parentId` named a container that did not list them** — repaired by a structural sibling test. The shared Emotions Wheel contradicts the same way and is correctly DECLINED | `0178` |

## Done — 2026-08-21 (later)

| Task | Where |
|------|-------|
| **Theme sweep over every dropdown and menu** — 82 literal colours → tokens across 20 floating surfaces | `0e090a6b`, deployed |
| Theme tokens **verified resolving** on the live grid under Stardew — `--menu-shadow-1/2/3` brown (`rgba(52,31,14,…)`) not black, `--scrim` brown, `--signal-warn` darkened | browser probe |
| **Weekday feature VERIFIED IN A BROWSER** — the 2026-08-21 honest gap, closed | probe |
| **Merge templates as layers** — 7 day-templates → 6 reusable layers; `Place Weekday` merges every template whose `Weekday` contains the day. 56 duplicated meal rows → 8; stored rows 84 → 43 | `0177` |
| Today's column needed **no clear** — `0112` signs template rows by CONTENT (`cycle:<pick>`), so consolidating changes nothing a column matches on. Both ticked rows kept | measured |

## Done — 2026-08-21

| Task | Where |
|------|-------|
| Sidebar: Pinned and Root read as two sections | `6cabeeba` |
| Sidebar: Pinned stopped re-drawing the whole manifest (`Root` folder page) | `6cabeeba` |
| The day column's `Todo` had lost its identity marker — **due placement had been a silent no-op** | `0172` |
| `Weekday` on a task → a fresh copy on that weekday, every week | `0173` |
| Due placement yields to a weekday | `0173` |
| New occurrences inherit their siblings' fields, roles included | `12299b4f` |
| Field picker splits Display / Input into sections | `12299b4f` |
| Two inert `kind`s fixed at call sites the 2026-07-29 fix never reached | `12299b4f` |
| `--on-accent` / `--menu-shadow` tokens; the add menu reads the theme | `12299b4f` |
| Schedule snapped back to today (Aug 20 → Aug 21) so today's column rebuilds | data |
| **Both meal trackers were structurally dead** — macros and Meal Log | `0174` |
| `Time 1/2/3` (seconds) replace `Weight N` on planks and side planks; the bogus `1 reps` cleared | `0175` |
| `Date` hidden on timeslots — it was inherited-visible from the Schedule page's list | `0176` |
| Add-menu **value step** — the real field controls, every input type, not a hand-rolled subset | `49267930` |
| Ticked fields sort to the top of the field picker | `49267930` |
| `+ Item` was born with no date — it wrote `fields: {}` where the sibling path stamps the filter | `49267930` |
