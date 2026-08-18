# Spec — public landing page + promo routes

**User, 2026-08-18:** *"create a one page landing page that shows off the logo and the site
and says what everything does (with tabs going to those pages) and anything needed to promote
a website. with a login button that sends you to the login page. this new landing page will be
the first thing a logged out user sees and then they navigate to login. make the landing page
really pop"* … *"react router dom to feature pages i mean and other pages we need to promote
the site"* … *"or at least specs to pass along to the next one, let them make the plan"*

This is a SPEC, not a plan. It records what was measured about the app as it stands so the
next session does not have to re-derive it, and states the decisions that are already made.
**Write the plan from this.**

---

## 1. What exists today (MEASURED, 2026-08-18 — do not re-derive)

| Fact | Value | Where |
|---|---|---|
| `react-router-dom` | **NOT a dependency** | `client/package.json` |
| Logged-out branch | `if (!state.userId) return <LoginScreen />;` | `client/src/App.jsx:914` |
| Login screen | `client/src/LoginScreen.jsx` | mounted directly, no route |
| SPA fallback | server sends `client/dist/index.html` for unmatched routes | `server/server.js:1220` |
| Logo (lockup) | `client/public/viafluere_lockup.svg` — pure vector, gradient double-knot + wordmark | used by the top-middle logo card |
| Logo (mark) | `client/public/viafluere_mark.png`, `viafluere_icon.png` | header / favicon |
| Product story | `docs/original-vision.md`, `NEWOVERVIEW.md` | the seeded logo card's description already paraphrases these |
| Theme tokens | `--surface-*`, `--text-*`, `--accent-*`, `--grid-line` per theme | `client/src/index.css` `[data-theme=…]` blocks |

**The SPA fallback already exists**, so client-side routes need no server work — an unmatched
path returns `index.html` and the router takes over. Verify this still holds before relying on it.

## 2. Decisions already made (by the user)

1. **A logged-out visitor lands on the landing page, not the login form.** Login becomes a
   destination they navigate to, via a button.
2. **Tabs on the landing page go to feature pages** — real routes, not in-page anchors.
3. **`react-router-dom`** is the routing mechanism.
4. **"Really pop"** — this is a promotional surface, not app chrome. It is allowed to look
   unlike the grid.

## 3. Constraints this codebase imposes

- **The app is ONE bundle and the grid is heavy.** A logged-out visitor must not pay for it.
  The landing routes should not pull `App.jsx` in — measure the entry chunk before/after and
  say the number. `React.lazy` is already used for `CommandCenter`; the same tool applies.
- **`index.html` is served `no-cache` while `assets/*` are immutable** (`server.js`). A new
  route needs no cache work, but a new PUBLIC asset does need a content hash or it will be
  cached forever.
- **Themes are data.** Anything hardcoding a colour will look wrong in four of the five themes.
  Either use the tokens or deliberately commit to one palette and say so in the file.
- **`MenuSurface` owns floating menus** (drawer on mobile). A nav dropdown must go through it.
- **Mobile is the user's primary device.** Verify at 390×844, and note the documented trap:
  at that width grid cells are translated by the mobile slider, so `getBoundingClientRect`
  can report a position while a different cell is painted there. Landing routes are outside
  the grid, so this should not apply — confirm rather than assume.

## 4. Content the pages need

The product's own framing, from `docs/original-vision.md` (use it, do not invent a new pitch):

- **The one-liner:** a drag-and-drop day timeline where every task can be a checkbox *or a
  measurement*, and the app sums, counts and tracks progress across any time window and
  category without needing separate trackers.
- **The four things to show off** (each a candidate feature page):
  1. **Schedule / day timeline** — drag tasks into time slots; the same slots are the plan *and*
     the log.
  2. **Anything you do can be measured** — "ran ✅ for 25 minutes", "ate ✅ 42g protein".
  3. **Trackers & goals** — totals, streaks, progress, computed by operations rather than
     hard-coded reports.
  4. **Build it your way** — panels, boards, docs, canvases, tables; occurrences placed
     anywhere.
- Screenshots: `screenshots/` already holds real captures of the wheel, the schedule and the
  grid. Prefer a real screenshot over a mockup.

## 5. Open questions for the user (ask BEFORE building, do not guess)

1. **Is signup public?** The landing page implies acquisition, but there is no public signup
   flow in evidence — `LoginScreen` is login-first. If signup is closed, the CTA should say
   what it actually does.
2. **Domain/marketing copy** — is "Viafluere" the product name to lead with, and is there
   wording the user wants verbatim?
3. **Which feature pages** — the four above are derived from the vision doc, not chosen by the
   user.

## 6. Standing rules that apply here

- Verify in a real browser and **look at it** — a landing page is a visual artifact, and this
  repo's record is full of numbers that agreed while the picture was wrong.
- Check the **served** bundle after deploying, with a control string, not just the local build.
- Do not pipe `deploy.sh` through `tail` — it masks a failed build, and that took prod down
  again on 2026-08-18.
