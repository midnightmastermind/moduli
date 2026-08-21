# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

| # | Task | State |
|---|------|-------|
| 1 | **Land the feed-scope widening — the churn is explained and was never a defect.** The other session's `__feedDiag` run: **39 feeds, two consecutive passes, byte-identical — 0 minted, 0 swept**, with `Completed` transitioning cleanly (`matches=1 → 3`) and then holding for four more passes. It flagged its own honest limit — *one headless client* — and that limit is now closed: the reverted run was prod with other clients, and **two clients on different scope semantics sweep each other's copies** (proven below). Two implementations exist: branch `feed-scope-multiparent` (extracted `reachableAncestors`, 10 unit tests) and the inline BFS in `resolveFeedItems`. **Pick one, delete the other**, then deploy into a single-client window | ✅ ready to land |
| 2 | **"What else is technically needed for the original vision"** — asked 2026-08-21, never answered | 📋 open ask |
| 3 | **Empty panel → root manifest folder in folder view** — asked, no commit found | ❓ unconfirmed |
| 4 | **Schedule apply ~1s** — `resolveOptions` predicate filter ~766ms, the residual after the index work | 📋 measured, not fixed |
| 5 | **Three external-data pipes** — Tasker profiles, ingest credentials, the four slow exports | 🚫 blocked on the user |

## Standing hazard — mixed client versions fight over a feed

Two clients running different code **fight over materialized feed copies**, and neither is
malfunctioning. Feed copies are shared persisted state and the sweep rule is *"delete any copy whose
source I no longer match"* — so a client on the OLD scope walk deletes exactly what a client on the
NEW one just minted, and the new one re-creates it. The result is a fresh id every pass and nothing
ever settling.

Two ways into it, and **both were live while this was being measured**: a browser tab left open
across a deploy runs the old bundle, and a local dev stack (`npm run dev` + `server/server.js`)
points at the **same Atlas database as production**.

Proven rather than argued — `feedMixedClientChurn.test.js` drives the real `syncFeed` with the
resolver giving two different answers: one client is idempotent with stable ids (the control), two
disagreeing clients churn a fresh id every pass, and **the copy they agree on is never disturbed** —
which is exactly what was seen live, one stable row beside two churning ones.

**The rule: deploy a feed-semantics change into a single-client window, and reload every tab.**

## Done — 2026-08-21 (merge of two sessions)

| Task | Where |
|------|-------|
| **Both sessions independently found the same cause** — `feed.scope` walked ONE ancestor chain from `buildParentMap` (last writer wins), so multi-parented rows resolved by document order | agreed |
| The other session verified its fix with a **local stack + `window.__feedDiag`**: three consecutive passes `matches=3 visible=3 existing=3 minted=0 swept=0` | their probe |
| This session measured **blast radius across every feed on every grid**, both code versions: 78 feeds, 262 → 264 rows, **77 of 78 byte-identical** | probe |
| **The parked churn item is CLOSED** — cross-version interference, not a defect in the change | `feedMixedClientChurn.test.js` |

## Done — 2026-08-21 (feed pass)

| Task | Where |
|------|-------|
| **A copy-link lost the source's occurrence label** — a row is `occurrence.label ?? module.label`, and the copy carried `fields` but not `label`, so `Completed` listed a row called **"Appointment"** where *"Psych appointment with Angela"* belonged. Verified on screen after deploy | `1b63f809` |
| The stale copy **repaired itself** — feedSync re-minted it with the name, so the migration written for it was deleted unwritten. 0 of 82 copies mis-named | measured |
| **`delete_occurrence` logged nothing** — creates log START/DONE, deletes logged nothing at all, so the server log could not tell "swept" from "never persisted". That gap cost a whole diagnosis today | `c3d6e999` |
| Feed-scope widening **measured across every feed on every grid** — 78 feeds, 262 → 264 rows, 77 of 78 byte-identical; the one change is exactly the two missing tasks | branch |
| Churn shown to be **specific to the change**, not pre-existing — the same copy is id-stable across a 75s live session on master | probe |

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
