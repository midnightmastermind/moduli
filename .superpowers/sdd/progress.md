# SDD progress — plan docs/superpowers/plans/2026-08-18-landing-page-and-promo-routes.md
Branch: landing-page-promo-routes   Base: 56fcd7e7

(The previous ledger, for plan 2026-08-02-templates-folder, is archived alongside this file as
progress-2026-08-02-templates-folder.md — that work is merged and in git history.)

Pre-flight scan: clean, no task/constraint conflicts found.

Controller decisions (user answered 2026-08-18):
- DEPLOY: authorized once suites are green AND prod is verified the documented way
  (HEAD over SSH, served-chunk grep with a control string first). Do not pipe deploy.sh to tail.
- claude-grid (Task 11): a FRESH registered account, not the user's. Report credentials at the
  end; never commit them.
- Task 11 runs AGAINST PRODUCTION, so it must follow the deploy.

REVISED TASK ORDER (Task 9 moved after 11 on purpose):
  1-8  ->  10 (deploy v1, feature pages ship with shot:null)
        ->  11 (register on prod, build claude-grid through the UI)
        ->  9  (capture the promo screenshots FROM claude-grid - it holds no personal data,
                which makes it a better source than test grid 2; Task 9 Step 7 already says so)
        ->  10 again (redeploy with the shots wired in)

## Tasks
- [x] Task 1 — shared auth storage (commit 71b4cc09, 7 tests). Verified this session.
      Deviation: test lives at src/__tests__/authStorage.test.js, not src/helpers/__tests__/.
- [x] Task 2 — three-way entry split + isolation guard (commit 21ac6bc5).
      Plan defect found and fixed at the root: vitest `include` was src/__tests__ only,
      so every promo suite would have been silently never run. Widened to src/**/__tests__/.
      Entry chunk 4,056 B with react-router ABSENT; browser probe both arms discriminate.
- [x] Task 3 — content data + guard (1bceccce). All five public numbers re-measured
      from source: 114 / 24 / 11 / 7 / 4. Guard A/B'd against a real planted word.
- [x] Task 4 — promo shell (f19755e6). Plan defect fixed: the palette claimed the
      logo's gradient and used a different ramp; the mark's real stops are used now.
- [x] Task 5 — landing page (bbdd0189). THREE defects found by looking:
      the page could not scroll (index.css pins html/body/#root for the grid);
      the reveal was not jump-proof (11 of 18 stuck invisible); an orphan card
      left ~700px of void. All three fixed and measured.
- [x] Task 6 — feature + example pages (d933e7f1). 404 branch A/B'd, mutation verified.
- [x] Task 7 — /login (eaeba0c9). Login verified in a browser both arms; the socket
      is requested 0x on the landing page and 1x on /login.
      REGISTRATION IS SLOW, NOT BROKEN — measured 50.7s for createDefaultUserData.
      See the findings block below. Probe users and grids swept.
- [x] Task 8 — head, robots, sitemap (570cc8b7). Drift guard A/B'd.
- [ ] Task 4 — promo shell (layout, nav, footer, palette)
- [ ] Task 5 — the landing page
- [ ] Task 6 — feature and example pages
- [ ] Task 7 — the /login route
- [ ] Task 8 — metadata and assets
- [x] Task 10 — deployed (merge 758296fa). prod HEAD verified over SSH, served
      entry + PromoApp chunks sha256-identical to the local build, served-chunk
      grep discriminates in BOTH directions. Four routes x two widths walked on
      production, signed out, zero overflow and zero page errors.
      THE FIRST DEPLOY FAILED THE BUILD: client/dist/assets was owned root:root
      (53 files) from an earlier root-run build, so vite's emptyDir hit EACCES.
      `set -e` correctly stopped BEFORE the pm2 restart and prod stayed up on the
      old bundle. Fixed with chown -R deploy:deploy on the server, then redeployed.
- [x] Task 11 — BUILT. `claude-grid` on production holds 4 panels / 4 pages,
      6 containers across 4 kinds (board, doc, table, graph), 14 fields in 9 of
      the 11 types, 19 records with real values, 2 operations composed in the
      editor (a total and a count with a condition, both computing on screen),
      and a live bar chart fed from the session rows. checkGrid: 0 errors, 1
      warning (an address field created to prove the type is reachable and never
      bound to a row). Screenshots at 1440x900 and 390x844.
      SIX defects were found by building it, four of them fixed and deployed —
      see the findings below. The one thing NOT done is a dropped file/link
      landing as a record: the intake sheet was reached and offered its five
      shapes for a pasted link, but a synthetic paste has no real destination
      context and the chosen shape wrote nothing. CLAUDE.md already records that
      these gesture paths are not drivable synthetically, so that is a probe
      limit, not a proven defect.
      Original note:
      ONE-OFF (user, 2026-08-18: "it shouldnt build claude grid on a fresh account
      everytime" / "just this once"). Do not re-run it in a later session.
- [ ] Task 9 — capture promo screenshots FROM claude-grid
- [ ] Task 10 again — redeploy with the shots


## Findings that are NOT plan tasks (raised, not fixed)

1. REGISTRATION TAKES ~51 SECONDS. `socketHandlers/auth.js` awaits
   `createDefaultUserData` before emitting auth_success, and that seed writes
   ~1240 occurrences + ~1250 modules to Atlas one at a time. Measured directly:
   50.7s to resolve. The promo CTA is "Get started — it's free", so this is the
   first thing a stranger experiences. Nothing is broken — three probe
   registrations each ended up with a real grid — but the browser sits on the
   form for the better part of a minute. Options: emit auth_success FIRST and
   seed in the background, or bulk-insert the seed.
2. A FRESHLY SEEDED GRID HAS NO NAME. Every grid created by
   `createDefaultUserData` comes out with `name: undefined`.
3. `createDefaultUserData` is marked FROZEN 2026-04-27 in its own header: its
   operations use the legacy action vocabulary and "will not run after the
   unified-verbs migration". So a brand-new user's grid ships with ops that
   cannot fire. This wants checking before Task 11 builds on a fresh account.
4. index.html sets `user-scalable=no`, which blocks pinch-zoom on the public
   pages too. The grid wants it; a marketing page should not have it. Left
   alone because the meta tag is shared.


## Task 11 findings (2026-08-18) — the new-user path, measured

Everything below was found by driving the REAL UI on production as a brand-new
account, not by reading code. Code was consulted only to confirm a cause.

1. **"Add new grid" minted nothing.** FIXED and deployed (777ad9b6). There was
   no way for any user to create a second grid.

2. **The field editor offers 8 of the 11 field types.** `FieldsTab.jsx:332`
   hardcodes `["number","text","boolean","select","date","rating","duration",
   "occurrence"]`, while the Field schema enum allows eleven — `markdown`,
   `button` and `address` are missing. This matters beyond tidiness: the promo
   site now says "Eleven kinds of value … addresses … rich text, and buttons
   that run something" IN PUBLIC. Three of the eleven cannot be created by a
   user. Either the editor gains them or the claim gets softened; both are the
   user's call.

3. **A panel created through the UI is born with an integrity warning.**
   `checkGrid` on the fresh grid reports `[inert-kind] panel/board×1` — the
   add-panel path stamps `kind:"board"` on a `panel` role, which is exactly what
   migration `0003` swept from the seed on 2026-07-29 ("the icon resolver
   prefers kind over role, so these draw the wrong icon"). The seed was fixed;
   the live create path was not.

4. **`checkGrid` cannot see another user's grid without `--user`.** It defaults
   to josh@jpoms.com and reports "No grid matched" for a grid that plainly
   exists — a confusing failure. `--user <email>` works.

5. **Much of the build path is hover-revealed or drag-only.** "Add container"
   is not in the DOM at rest; it mounts transiently. More significantly, the
   Fields tab reads "drag fields here", and binding fields to modules, placing
   records and arranging panels are drag gestures. CLAUDE.md already records
   that these are NOT drivable synthetically — DragProvider resolves the hovered
   container from a `pointerRef` a synthetic drag never moves — so a headless
   agent cannot honestly complete "bring at least one thing in by dropping it".
   THIS IS THE STRUCTURAL LIMIT ON FINISHING TASK 11 HEADLESSLY, and it is worth
   stating as a product observation too: the core interaction needs a hand on
   the machine.

6. **An empty grid shows the full-screen wallpaper with one line of small
   italic text.** It reads as loud-with-nothing-in-it rather than as an
   invitation. First thing a new account sees.


## Task 11 findings, round 2 (2026-08-18) — building the grid by clicking

Each of these was found by USING the product on production, not by reading code.

7. **A container added through the UI VANISHED on reload.** FIXED (ad2f3cf4).
   `create_module` persisted the module with no gridId, so the grid-scoped
   full_state never sent it back and the occurrence was left module-less — the
   exact `module-less-occurrence` integrity error. Fixed on the SERVER, where
   the socket already knows the user and the grid, so every client call site
   that forgets is covered.

8. **The operations editor's header "Save" only CLOSED the editor.** FIXED
   (65965414). Its tooltip said "changes are auto-saved as you edit"; nothing
   auto-saves, and a websocket trace showed that button emitting nothing while
   the one beside Preview/Delete emitted `update_operation`. A renamed op with
   three pipeline steps came back untouched. This is silent data loss on the
   most obvious control in the panel.

9. **A graph container could not be MADE through the UI.** FIXED (65965414).
   Every container's header dropdown carries the whole GraphSection and reported
   "9 roots · 9 rows" for the feed I configured — into a container that drew a
   plain board, because only `kind: "graph"` renders a chart and no UI path sets
   it. `graph` is now one of the convertible kinds.

10. **Every row created by "+ Item" was born with an inert kind.** FIXED
    (f1209b77). 31 of 31 instance modules on a grid built by clicking carried
    `kind: "board"`, so they all drew the board icon — migration 0003's defect,
    still being minted by the live create path.

11. **`SET_FIELD_VALUE` is offered and does nothing.** NOT fixed. The action
    picker lists it, the builder has a full editor for it (occurrence, field,
    value, flow) and operationIntrospection analyses it — but the executor has
    no case for it, so the step is a silent no-op. I built a tracker on it and
    the tile stayed at 0. The same class, softer: ~40 actions in the picker
    (SUM_VAR, STREAK_VAR, the whole Aggregators and Collections groups) have no
    editor in OperationsBuilder, so picking one renders a step with no
    configurable fields.

12. **"Duplicate (new instance)" does nothing inside a table container.** NOT
    fixed. ContainerTable renders `<ModuleInstance>` without `containerId`, and
    the duplicate handler needs it; the menu item is offered and no row appears.

13. **A NESTED container could not take a single item — it THREW.** FIXED
    (dd83aebb). `ModuleContainer` renders child containers through another
    `<Container>` and never passed `addInstanceToContainer` down, so "+ Item"
    inside any nested container raised `TypeError: l is not a function` in
    production. Source-mapped from the minified prod chunk to
    ModuleContainer.jsx:334; threaded at both the nested and canvas-card render
    sites. Verified afterwards on prod: 0 page errors on load.

14. **Deleting through the UI leaves the MODULE behind.** NOT fixed. Measured on
    this grid after one sitting: **64 modules for 49 occurrences — 15 orphans**,
    every one of them a row or container I deleted or converted. Converting a
    container's kind is the same story from the other side: the two table
    containers still on screen have an orphaned pre-conversion module each. It
    is not an integrity error today (checkGrid does not look for it) and it costs
    nothing visible, but a grid used for a year accumulates junk on the most
    ordinary action there is. `sweepOrphans.js` exists and has an age floor;
    nothing calls it from the delete path.

## Task 11 findings — resolution (2026-08-19)

User: *"please fix the things you ran into and ask questions if needed."*

FIXED and deployed:
- **11 → SET_FIELD_VALUE now runs**, and the diff that found it also found a SECOND silent no-op
  nobody had reported: **LINK_OCCURRENCE_TO_PARENT**. Both are in the picker with no executor case.
- **11 (the softer half) → all 35 editor-less actions are configurable**, from a declared shape read
  off each executor case. A coverage test asserts the empty set both ways, plus that no declared key
  is one the executor never reads.
- **12 → "Duplicate (new instance)" works inside a table**; the child row now carries the containerId
  the handler needs (child rows only — a cell embed's parent is elsewhere).
- **14 → deleting through the UI removes the module**, via `planOrphanModules` unchanged. Verified
  against production: create 65/50 → delete 64/49, module gone.
- **The two-column table** was never duplicating the row — every column is a projection of the same
  record, and an UNCONFIGURED column shows the whole record. A new column now projects the next
  unclaimed field, stamped at creation time so no existing table changes.
- **A container added to a doc PAGE is embedded**, not merely listed, so the page draws it.
- **A tree doc row can be renamed** (double-click, the affordance folder rows always had), offered
  only when the doc has no heading — with one, the heading is the name and the rename would be inert.
- **First run**: the grid is named and an empty grid explains what a panel is. Verified by
  registering a fresh account on production.
- **The account menu shows the email**, not the raw userId.

RETRACTED: the report that a condition rule's path pickers write to the wrong side. Each side owns
its own onChange and the picker keeps state per instance; the probe was clicking the wrong one of
two identical buttons. Pinned as a test in both directions.

NOT DONE, and why: the positive branch of column auto-projection has not been exercised in a
browser (the only live table on claude-grid has no child rows, so the live click correctly produced
an unprojected column — the null branch); and the tree rename has not been double-clicked by a real
pointer. Deleting a doc row FROM the tree is still not offered — it needs a confirm surface the tree
does not have, and the row is deletable from its page.

Smaller things, none fixed: a table container with two columns renders the SAME
child in both cells; the tree's "+" on a folder mints an artifact/doc container
called "Untitled" that looks like a page card, cannot be renamed or deleted from
the tree, and needs its own panel to reach; a container added to a doc PAGE is
listed but never rendered (the documented listed-but-not-embedded class); a new
container is called "List 1" (the word this app deliberately does not use);
the mobile drawer prints the raw userId; and a brand-new account's first screen
is a full-bleed wallpaper with one line of small italic text.
