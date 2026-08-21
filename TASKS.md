# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

| # | Task | State |
|---|------|-------|
| 1 | **Set field VALUES in the add-item menu** — pick the fields *and* fill them in one step | 📋 queued |
| 2 | **Theme sweep over every dropdown and menu** — 16 hardcoded blues in 9 files, ~25 hardcoded black shadows in 20 files | 📋 queued, measured |
| 3 | **Merge templates as layers** — one Meals template + reusable workout sessions, matched by a multi-select `Weekday` | 📋 queued, measured |
| 4 | **`Time 1` / `Time 2` / `Time 3` on timed movements** — planks and side planks take seconds, not weight. Today they read `Set 1: 1 reps` because `0119` backfilled a counted prescription onto a timed movement | 📋 queued |
| 5 | **Hide the `Date` field on timeslots** | 📋 queued |
| 6 | **End-of-day move** — completed tasks/appointments → `Tasks > Completed` after the day rolls over | 🔎 measured; blocked on repairing 2 mis-parented rows first |
| 7 | **Verify the weekday feature in a browser** — nobody has picked a weekday and watched a copy land | ⏳ honest gap |

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
