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
- [~] Task 11 — IN PROGRESS. Registered on production, `claude-grid` created and
      renamed through the UI, 2x2, one panel added. 0 integrity ERRORS.
      Built so far: grid + 1 panel + 1 field. NOT yet: containers, records,
      operations, chart, dropped item.
      Blocked on structure, not effort — see "Task 11 findings" below.
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
