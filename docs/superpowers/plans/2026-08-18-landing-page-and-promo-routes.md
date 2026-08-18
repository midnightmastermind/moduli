# Landing Page + Promo Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-out visitor to viafluere.com lands on a dark-cinematic promotional page that explains what the product does, navigates to real feature/example routes, and reaches the login form by choice — without downloading the grid application.

**Architecture:** `main.jsx` gains a three-way entry split (preview app / promo app / grid app) decided synchronously from `localStorage`. The promo surface is an isolated `client/src/promo/` tree behind `React.lazy` that imports **nothing** from the app — no store, no socket, no grid component. Feature and example pages are ONE component each driven by a content data file, so adding a page is a data edit. The socket is pulled in only when `/login` is visited.

**Tech Stack:** React 19, `react-router-dom` v7, Vite (manualChunks already splits `socketio` and `react`), Vitest + @testing-library/react.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-08-18-landing-page.md`) and from the user's answers on 2026-08-18. Every task's requirements implicitly include this section.

- **The product name is Viafluere.** Lead with it everywhere on the promo surface. "Moduli" is an internal codename and MUST NOT appear in any user-visible promo string.
- **The promo site does not know what a "Schedule" or a "Day Page" is.** User, verbatim: *"we can include schedule and daypage and trackers and goals in an examples page (details for them) but the main site doesnt know that schedule and daypage are a thing."* Capability pages describe generic capabilities; concrete builds live only in `content/examples.js`. This is enforced by a guard test in Task 3, mirroring `client/src/__tests__/noDomainKnowledge.test.js`.
- **Look: dark cinematic.** Deep midnight ground, the logo's own gradient as the accent, large type, motion on scroll. The promo surface commits to ONE palette and does not follow the app's five themes — say so in `promo.css`.
- **A logged-out visitor must not download the grid.** `client/src/promo/**` may not import from `client/src/App.jsx`, `client/src/state/**`, `client/src/modules/**`, or `client/src/socket.js` (except lazily, inside the `/login` route). Enforced by a test in Task 2.
- **Visuals are fresh captures.** Everything in `screenshots/` that looks like a product capture is dated April 2026 and predates the instance-bodies, spread-viewer and wallpaper work of 2026-08-16/17. Do not ship them. Task 9 captures new ones.
- **Verify in a real browser and LOOK at it.** A landing page is a visual artifact; this repo's record is full of numbers that agreed while the picture was wrong.
- **Mobile is the primary device.** Verify at 390x844.
- **Do not pipe `deploy.sh` through `tail`** — it masks a failed build and took prod down on 2026-08-18.
- **Check the SERVED bundle after deploying, with a control string**, not just the local build.

## Measured facts (2026-08-18, verified this session — do not re-derive)

| Fact | Value |
|---|---|
| `react-router-dom` | NOT a dependency (`client/package.json`) |
| React / react-dom | `^19.2.3` — use `react-router-dom@^7` |
| Logged-out branch | `if (!state.userId) return <LoginScreen />;` — `client/src/App.jsx:914` |
| Auth token key | `localStorage["moduli-token"]` |
| **Token is written ONLY by** | `client/src/state/bindSocketToStore.js:725`, bound from `App.jsx:484` |
| `main.jsx` already lazy-loads `App` | `React.lazy(() => import("./App"))` |
| SPA fallback | `app.get("/{*splat}")` → `index.html`, `server/server.js:1220` |
| `socket.io-client` chunk | already split as `socketio` in `client/vite.config.js` |
| `MenuSurface` imports | React + `createPortal` only — zero app deps, safe for promo |
| Signup | **public** — `socket.emit("register")` → `server/socketHandlers/auth.js:6` creates the user and seeds a grid, no invite gate |
| Pipeline verbs + comparators | **114** (`client/src/helpers/operationActions.js`) |
| Field types | **11** — number, text, boolean, select, date, rating, duration, occurrence, markdown, button, address |
| Intake shapes | **24** (`client/src/helpers/intake.js`) |
| Container kinds | **4** — board, doc, table, canvas |
| Chart kinds | area, bar, line, pie, radar, sunburst, treemap |
| Themes | **5** |

### THE TRAP THIS PLAN EXISTS TO AVOID

`bindSocketToStore.js:725` is the **only** writer of `moduli-token`, and it is bound from inside `App.jsx`. A promo route that renders `LoginScreen` without `App` mounted would authenticate successfully, receive `auth_success`, **never store the token**, and drop the user back on the login form forever. Task 1 fixes this at the root by extracting a shared writer, BEFORE any route exists that could hit it.

---

## File Structure

**Create:**
- `client/src/helpers/authStorage.js` — the single source of truth for which localStorage keys hold auth, and how they are written and cleared.
- `client/src/promo/promoPaths.js` — the public path list, alone in a leaf module so `main.jsx` can test a path without importing the router.
- `client/src/promo/PromoApp.jsx` — router; owns the route table.
- `client/src/promo/PromoLayout.jsx` — nav + `<Outlet/>` + footer; scroll-to-top on navigation.
- `client/src/promo/PromoNav.jsx` — logo, feature links, "Log in" button; drawer on mobile.
- `client/src/promo/PromoFooter.jsx`
- `client/src/promo/pages/LandingPage.jsx` — `/`
- `client/src/promo/pages/FeaturePage.jsx` — `/features/:slug`
- `client/src/promo/pages/ExamplesPage.jsx` — `/examples`
- `client/src/promo/pages/LoginRoute.jsx` — `/login`; lazily pulls the socket.
- `client/src/promo/pages/NotFoundPage.jsx` — `*`
- `client/src/promo/content/features.js` — the five capability records.
- `client/src/promo/content/examples.js` — the four concrete-build records.
- `client/src/promo/promo.css` — the dark cinematic palette, scoped under `.promo`.
- `client/src/promo/__tests__/promoContent.test.js`
- `client/src/promo/__tests__/promoIsolation.test.js`
- `client/src/promo/__tests__/noProductDomainKnowledge.test.js`
- `client/src/promo/__tests__/promoRouting.test.jsx`
- `client/src/promo/__tests__/PromoNav.test.jsx`
- `client/src/promo/__tests__/LoginRoute.test.jsx`
- `client/src/helpers/__tests__/authStorage.test.js`

**Modify:**
- `client/src/state/bindSocketToStore.js:722-762` — call the shared writer instead of hand-writing keys.
- `client/src/main.jsx:23-45` — the three-way entry split.
- `client/package.json` — add `react-router-dom`.
- `client/index.html` — real `<title>` and `<meta name="description">`.

---

### Task 1: Shared auth storage (the login-loop fix)

The token writer must be callable from a surface that has no store. Extract it first; nothing else can safely exist until it does.

**Files:**
- Create: `client/src/helpers/authStorage.js`
- Create: `client/src/helpers/__tests__/authStorage.test.js`
- Modify: `client/src/state/bindSocketToStore.js:722-762`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `persistAuth({ token, userId }) => void` — writes `moduli-token` / `moduli-userId`; ignores falsy members individually.
  - `clearAuth() => void` — removes `moduli-token`, `moduli-userId`, `moduli-gridId`.
  - `readToken() => string | null`
  - `hasSession() => boolean`
  - `AUTH_KEYS` — `{ token: "moduli-token", userId: "moduli-userId", gridId: "moduli-gridId" }`

- [x] **Step 1: Write the failing test**

Create `client/src/helpers/__tests__/authStorage.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { persistAuth, clearAuth, readToken, hasSession, AUTH_KEYS } from "../authStorage.js";

beforeEach(() => localStorage.clear());

describe("authStorage", () => {
  it("persists token and userId", () => {
    persistAuth({ token: "t1", userId: "u1" });
    expect(localStorage.getItem(AUTH_KEYS.token)).toBe("t1");
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBe("u1");
  });

  // A login response carrying only a token must still leave a usable session.
  it("writes each member independently", () => {
    persistAuth({ token: "t1" });
    expect(readToken()).toBe("t1");
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBeNull();
  });

  it("ignores an empty payload rather than writing nulls", () => {
    persistAuth({});
    expect(readToken()).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.token)).toBeNull();
  });

  it("is safe with no argument", () => {
    expect(() => persistAuth()).not.toThrow();
    expect(readToken()).toBeNull();
  });

  // clearAuth must take gridId too: a stale gridId outlives the user it
  // belonged to and makes the next login request someone else's grid.
  it("clears every auth key including gridId", () => {
    persistAuth({ token: "t1", userId: "u1" });
    localStorage.setItem(AUTH_KEYS.gridId, "g1");
    clearAuth();
    expect(readToken()).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.userId)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.gridId)).toBeNull();
  });

  it("hasSession reflects the token only", () => {
    expect(hasSession()).toBe(false);
    persistAuth({ token: "t1" });
    expect(hasSession()).toBe(true);
  });

  // The promo entry split reads this before React mounts. If localStorage
  // throws (Safari private mode, disabled storage), the visitor must get the
  // landing page rather than a white screen.
  it("hasSession returns false when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(hasSession()).toBe(false);
    spy.mockRestore();
  });
});
```


- [x] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/helpers/__tests__/authStorage.test.js`
Expected: FAIL — `Failed to resolve import "../authStorage.js"`

- [x] **Step 3: Write the implementation**

Create `client/src/helpers/authStorage.js`:

```js
// helpers/authStorage.js
//
// The ONE place that knows which localStorage keys hold a session.
//
// This exists because `bindSocketToStore` was the only writer of the token and
// it is bound from inside App.jsx — so any surface that renders the login form
// WITHOUT the app mounted (the promo /login route) would authenticate, receive
// auth_success, and never store the result. Extracting the writer is the fix;
// a second copy in the promo route would be the bug wearing a new hat.
//
// Every accessor is try/caught: the promo entry split calls hasSession() before
// React mounts, and a browser with storage denied must fall through to the
// landing page rather than throw on the first line of the app.

export const AUTH_KEYS = {
  token: "moduli-token",
  userId: "moduli-userId",
  gridId: "moduli-gridId",
};

export function persistAuth({ token, userId } = {}) {
  try {
    if (token) localStorage.setItem(AUTH_KEYS.token, token);
    if (userId) localStorage.setItem(AUTH_KEYS.userId, userId);
  } catch {}
}

export function clearAuth() {
  try {
    localStorage.removeItem(AUTH_KEYS.token);
    localStorage.removeItem(AUTH_KEYS.userId);
    // The gridId is scoped to the user who was signed in. Leaving it behind
    // makes the next login request a grid that is not theirs.
    localStorage.removeItem(AUTH_KEYS.gridId);
  } catch {}
}

export function readToken() {
  try {
    return localStorage.getItem(AUTH_KEYS.token);
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(readToken());
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/helpers/__tests__/authStorage.test.js`
Expected: PASS, 7 tests.

- [x] **Step 5: Route bindSocketToStore through it**

In `client/src/state/bindSocketToStore.js`, add to the imports at the top of the file:

```js
import { persistAuth, clearAuth } from "../helpers/authStorage.js";
```

Replace the two key-writing bodies. In `onAuthSuccess` (around line 725), replace:

```js
    if (token) localStorage.setItem("moduli-token", token);
    if (userId) localStorage.setItem("moduli-userId", userId);
```

with:

```js
    persistAuth({ token, userId });
```

In `onAuthError` (around line 751), replace:

```js
    localStorage.removeItem("moduli-token");
    localStorage.removeItem("moduli-userId");
    localStorage.removeItem("moduli-gridId");
```

with:

```js
    clearAuth();
```

Then find the third removal site around line 762 (inside `onConnectError`) and replace the same three `localStorage.removeItem` calls with `clearAuth();`.

- [x] **Step 6: Verify nothing regressed**

Run: `cd client && npx vitest run src/__tests__/bindSocketToStore.test.js`
Expected: PASS.

Run: `cd client && grep -n 'localStorage.setItem("moduli-token"' src/state/bindSocketToStore.js`
Expected: no output — the hand-written writer is gone.

- [x] **Step 7: Full client suite**

Run: `cd client && npm test 2>&1 | tail -20`
Expected: the documented baseline (2461+ passing; the 3 pre-existing `liveOpsBehavioral` failures are known — confirm the count did not GROW, per the 2026-08-09 (6) lesson about reading the failure count rather than "roughly the same").

- [x] **Step 8: Commit**

```bash
git add client/src/helpers/authStorage.js client/src/helpers/__tests__/authStorage.test.js client/src/state/bindSocketToStore.js
git commit -m "refactor(auth): one writer for the session keys, so a login form without the app can still store a token

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The entry split + isolation guard

Install the router and split the entry, with a placeholder landing page. This proves the split before any design work rests on it.

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/main.jsx:23-45`
- Create: `client/src/promo/PromoApp.jsx`
- Create: `client/src/promo/pages/LandingPage.jsx` (placeholder, replaced in Task 5)
- Create: `client/src/promo/__tests__/promoIsolation.test.js`

**Interfaces:**
- Consumes: `hasSession()` from Task 1.
- Produces:
  - `PromoApp` — default export, a `<BrowserRouter>` owning the route table.
  - `PROMO_PATHS` — exported from `PromoApp.jsx`: `["/features", "/examples", "/login", "/about"]`. Any path starting with one of these is a promo path even when a session exists.

- [x] **Step 1: Install the router**

Run: `cd client && npm install react-router-dom@^7`
Expected: `react-router-dom` appears in `client/package.json` dependencies.

- [x] **Step 2: Write the failing isolation test**

Create `client/src/promo/__tests__/promoIsolation.test.js`:

```js
// The promo surface must not drag the grid into a logged-out visitor's
// download. This is a STATIC import check: it reads the source rather than
// bundling, so it fails at the moment someone types the import.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROMO = join(process.cwd(), "src", "promo");

// Each entry is [pattern, why it is banned]. Add to this list, never weaken it.
const BANNED = [
  [/from\s+["'].*\/App(\.jsx)?["']/, "the grid application"],
  [/from\s+["'].*\/state\//, "the app store"],
  [/from\s+["'].*\/modules\//, "grid renderers"],
  [/from\s+["'].*\/helpers\/CommitHelpers/, "the app write layer"],
];

// The socket is allowed ONLY as a lazy import inside the login route: a
// visitor reading the landing page must not open a websocket.
const SOCKET_STATIC = /^\s*import\s+[^;]*from\s+["'].*\/socket(\.js)?["']/m;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("promo isolation", () => {
  const files = walk(PROMO);

  it("finds promo source to check", () => {
    // A guard that scans nothing passes vacuously. Prove it has input.
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports nothing from the grid application", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const [re, what] of BANNED) {
        if (re.test(src)) offenders.push(`${f}: imports ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never imports the socket statically", () => {
    const offenders = files.filter((f) => SOCKET_STATIC.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `cd client && npx vitest run src/promo/__tests__/promoIsolation.test.js`
Expected: FAIL — `ENOENT` on the `src/promo` directory (it does not exist yet).

- [x] **Step 4: Create the placeholder landing page**

Create `client/src/promo/pages/LandingPage.jsx`:

```jsx
import React from "react";

export default function LandingPage() {
  return (
    <main className="promo-landing">
      <h1>Viafluere</h1>
    </main>
  );
}
```

- [x] **Step 5: Create the router**

Create `client/src/promo/PromoApp.jsx`:

```jsx
// promo/PromoApp.jsx — the public surface.
//
// This tree imports NOTHING from the application. A logged-out visitor
// downloads this chunk and react-router; the grid stays on disk until they
// sign in. `promoIsolation.test.js` enforces that.
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage.jsx";

// Paths that belong to the promo surface even for a signed-in visitor —
// following a "Features" link while logged in must not boot the grid.
export const PROMO_PATHS = ["/features", "/examples", "/login", "/about"];

export default function PromoApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [x] **Step 6: Run the isolation test**

Run: `cd client && npx vitest run src/promo/__tests__/promoIsolation.test.js`
Expected: PASS, 3 tests.

- [x] **Step 7: Split the entry**

In `client/src/main.jsx`, add near the top with the other imports:

```js
import { hasSession } from "./helpers/authStorage.js";
```

Replace the whole `if (previewOcc) { … } else { … }` block (lines ~28-45) with:

```js
// Which of the three apps is this?
//
//   previewOcc      the iframe thumbnail renderer (unchanged)
//   promo           the public site — no session, or an explicitly public path
//   App             the grid
//
// The decision is SYNCHRONOUS and reads only localStorage, so a visitor with no
// session never begins downloading the grid chunk. A path under PROMO_PATHS
// wins even with a session: a signed-in user clicking "Features" should read
// the feature page, not be bounced into the app.
const isPromoPath = (p) =>
  PROMO_PATHS.some((base) => p === base || p.startsWith(base + "/"));

if (previewOcc) {
  // Lightweight preview app — only loads the occurrence subtree
  import("./PagePreviewApp.jsx").then(({ default: PagePreviewApp }) => {
    root.render(<PagePreviewApp occurrenceId={previewOcc} />);
  });
} else if (!hasSession() || isPromoPath(window.location.pathname)) {
  const PromoApp = React.lazy(() => import("./promo/PromoApp.jsx"));
  root.render(
    <React.Suspense fallback={null}>
      <PromoApp />
    </React.Suspense>
  );
} else {
  // Full app
  const App = React.lazy(() => import("./App"));
  root.render(
    <React.Suspense fallback={null}>
      <App />
    </React.Suspense>
  );
}
```

`PROMO_PATHS` must be a static import, since the path test runs before anything is lazily loaded. **Do not import it from `PromoApp.jsx`** — that would pull the router into the entry chunk for every signed-in user, which is the opposite of the point. It gets its own leaf module.

Create `client/src/promo/promoPaths.js`:

```js
// The public path list, in its own module so main.jsx can test a path without
// importing the router. Importing PromoApp.jsx here would pull react-router
// into the entry chunk for every signed-in user — the opposite of the point.
export const PROMO_PATHS = ["/features", "/examples", "/login", "/about"];
```

Add to the imports at the top of `main.jsx`:

```js
import { PROMO_PATHS } from "./promo/promoPaths.js";
```

And in `PromoApp.jsx` replace the local `export const PROMO_PATHS = …` line with a re-export, so there is still exactly one definition:

```js
export { PROMO_PATHS } from "./promoPaths.js";
```

- [x] **Step 8: Build and measure the chunks**

Run: `cd client && npm run build 2>&1 | tail -30`
Expected: build succeeds. Record the byte sizes of `dist/assets/PromoApp-*.js`, `dist/assets/index-*.js` (the entry) and `dist/assets/App-*.js`.

Run:
```bash
cd client && ls -la dist/assets/*.js | awk '{print $5, $9}' | sort -rn | head -12
```

Write the three numbers into the commit message. **The number that matters is the entry chunk: it must not have grown by the size of react-router.** If it did, `promoPaths.js` is being tree-shaken incorrectly — check that nothing else re-exports `PromoApp` from it.

- [x] **Step 9: Prove the logged-out visitor does not fetch the App chunk**

Run the app locally (`npm run dev` from the repo root) and, in a fresh browser profile with no `moduli-token`, load `http://localhost:5173/` with the Network tab open.

Expected: `App-*.js` is **absent** from the request list; `PromoApp-*.js` is present.
Then set a token (`localStorage.setItem("moduli-token","x")`), reload, and confirm `App-*.js` IS requested. **Both arms are required** — a zero on the first arm alone is a claim about the probe, not a measurement (the 2026-08-11 (5) control lesson).

- [x] **Step 10: Commit**

```bash
git add client/package.json client/package-lock.json client/src/main.jsx client/src/promo/
git commit -m "feat(promo): three-way entry split — a visitor with no session never downloads the grid

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Content data + the no-domain-knowledge guard

The pages are data. Write the data and the rule that keeps the marketing site honest about what it knows.

**Files:**
- Create: `client/src/promo/content/features.js`
- Create: `client/src/promo/content/examples.js`
- Create: `client/src/promo/__tests__/promoContent.test.js`
- Create: `client/src/promo/__tests__/noProductDomainKnowledge.test.js`

**Interfaces:**
- Produces:
  - `FEATURES` — array of `{ slug, nav, title, tagline, body, points: [{ heading, text }], stat: { value, label }, shot }`.
    `shot` is a filename under `client/public/promo/` or `null` until Task 9 fills it.
  - `featureBySlug(slug) => Feature | undefined`
  - `EXAMPLES` — array of `{ id, name, blurb, detail, built: [string] }` where `built` names the generic capabilities the example is assembled from.

- [x] **Step 1: Write the content**

Create `client/src/promo/content/features.js`:

```js
// promo/content/features.js
//
// The capability pages. ONE record per page; FeaturePage.jsx renders whichever
// the route names, so adding a page is a data edit and never a new component.
//
// RULE: nothing here may name a thing a USER built. The concrete builds are
// examples of what this product assembles — they live in examples.js, the one
// file exempt from __tests__/noProductDomainKnowledge.test.js. That guard
// scans COMMENTS too, so do not name one here to explain the rule.
// Every number below was measured from the source on 2026-08-18; re-measure
// any you change.

export const FEATURES = [
  {
    slug: "measure",
    nav: "Measure anything",
    title: "Every task is a checkbox — or a measurement",
    tagline:
      "Ticking something off tells you it happened. It should also be able to tell you how much.",
    body:
      "Most tools make you choose: a to-do list that knows you did the thing, or a spreadsheet that knows the number. Viafluere is one surface for both. Anything you record can carry values alongside its tick, and those values are real data the moment you enter them — not a note you will have to read back later.",
    points: [
      {
        heading: "Eleven kinds of value",
        text: "Numbers, text, yes/no, dates, durations, ratings, single and multiple choice, addresses, references to other things you have recorded, rich text, and buttons that run something.",
      },
      {
        heading: "Direction, not just size",
        text: "A value knows whether it came in, went out, or replaced what was there. One amount field serves earnings and spending without a second field or a minus sign to remember.",
      },
      {
        heading: "Recorded where it happened",
        text: "Values live on the placement, not the template. The same thing recorded in two places keeps two independent readings, so a repeated activity has a history rather than one number that keeps getting overwritten.",
      },
    ],
    stat: { value: "11", label: "kinds of value a record can carry" },
    shot: null,
  },
  {
    slug: "build",
    nav: "Build it your way",
    title: "Panels, boards, documents, canvases, tables",
    tagline: "The shape of the workspace is yours. Nothing here is a fixed screen.",
    body:
      "There is no built-in layout you have to work around, because there is no built-in layout. You place panels on a grid, fill them with containers, and choose how each one renders. Anything you record can go anywhere — inside a document, on a board, pinned to a canvas, or as a row in a table.",
    points: [
      {
        heading: "Four ways to render the same contents",
        text: "A board of cards, a document you write in, a table of rows and columns, or a canvas you can draw on and connect. Switch between them without moving anything.",
      },
      {
        heading: "One thing, many places",
        text: "The same record can sit in several places at once. Tick it anywhere and it is ticked everywhere, because it is one thing rather than a copy that has to be kept in sync.",
      },
      {
        heading: "Style and layout cascade",
        text: "Set a rule once high up and everything beneath inherits it, or override it exactly where you need to. Five themes ship, and every colour is a token you can change.",
      },
    ],
    stat: { value: "4", label: "ways to render any container" },
    shot: null,
  },
  {
    slug: "operations",
    nav: "Operations",
    title: "The maths is yours, and you can read it",
    tagline:
      "Totals, streaks and progress are not features someone built for you. They are pipelines you compose.",
    body:
      "An operation is a readable top-down pipeline: find some things, loop over them, test a condition, add something up, write the answer somewhere. No black-box report, no aggregation you cannot open. If you want a number this product has never heard of, you build it out of the same pieces everything else is built from.",
    points: [
      {
        heading: "114 verbs and comparators",
        text: "Find, loop, branch, sum, average, count, streak, group, sort, slice, join, compare dates and times, create, move, link, apply a template, call an API, ask the user a question.",
      },
      {
        heading: "It runs when something happens",
        text: "Operations fire when a value changes, when something is added, moved or deleted, when you navigate to a different date, on load, or at times you set.",
      },
      {
        heading: "You can see why it did that",
        text: "Every run keeps its log — which candidates were found, which branch was taken, what was written. When a number looks wrong you can read the reason rather than guess at it.",
      },
    ],
    stat: { value: "114", label: "verbs and comparators to compose with" },
    shot: null,
  },
  {
    slug: "intake",
    nav: "Bring anything in",
    title: "Drop it in, then say what it should become",
    tagline: "The same file can become four different things. You decide which, every time.",
    body:
      "Drag in a file, a link, a photo or a block of text and you are asked what you want out of it — never guessed at, never silently defaulted. A document can arrive as a browsable tree of sections. A spreadsheet can arrive as a real table. A photograph of a handwritten list can arrive as a list you can tick off.",
    points: [
      {
        heading: "24 outcomes, offered by what fits",
        text: "Only the shapes that make sense where you dropped it are offered, so the choice stays short even though the catalogue is long.",
      },
      {
        heading: "Documents keep their structure",
        text: "Headings become sections you can open and close, prose becomes text you can edit, tables stay tables, and links stay clickable — and a linked page can be brought in with it.",
      },
      {
        heading: "Text out of pictures",
        text: "A photo of a page becomes readable text; a photo of a list becomes one item per line. The picture is kept either way — it is the evidence.",
      },
    ],
    stat: { value: "24", label: "things a dropped item can become" },
    shot: null,
  },
  {
    slug: "visualize",
    nav: "See it",
    title: "Charts fed by your own records",
    tagline: "Not a dashboard someone designed. A chart pointed at whatever you are keeping.",
    body:
      "A chart is another kind of container: you point it at some of your records, say how to group them, and pick a shape. Because it reads the same data everything else reads, it is never out of date and there is nothing to export or refresh.",
    points: [
      {
        heading: "Seven shapes",
        text: "Bar, line, area, pie, radar, treemap and sunburst — including nested rings for things that have a hierarchy.",
      },
      {
        heading: "It answers clicks",
        text: "Selecting part of a chart can record something, filter what is on screen, or drill into what it is made of. A chart is a control, not a picture.",
      },
      {
        heading: "Scoped by time and category",
        text: "The same chart reads today, this week, this month or a range you pick, without being rebuilt.",
      },
    ],
    stat: { value: "7", label: "chart shapes, fed live" },
    shot: null,
  },
];

export function featureBySlug(slug) {
  return FEATURES.find((f) => f.slug === slug);
}
```

Create `client/src/promo/content/examples.js`:

```js
// promo/content/examples.js
//
// THE ONLY FILE ON THE PROMO SURFACE THAT MAY NAME A CONCRETE BUILD.
//
// User, 2026-08-18: "we can include schedule and daypage and trackers and goals
// in an examples page (details for them) but the main site doesnt know that
// schedule and daypage are a thing."
//
// These are things assembled FROM the capabilities in features.js — the same
// relationship the application itself keeps, where no renderer knows what a
// schedule is and the seed authors one as data. Each record names the generic
// capabilities it is built from, so the page can show the join.

export const EXAMPLES = [
  {
    id: "day-timeline",
    name: "A day on a timeline",
    blurb: "Drag what you plan to do into the hours of the day. The same rows are the plan and the record of what happened.",
    detail:
      "Half-hour slots down a column, each one a container you can drop into. Because a placed row carries its own values, ticking it off and writing down how long it took are the same action — there is no separate log to reconcile at the end of the day. Move a row to another hour and it keeps everything it was carrying.",
    built: ["build", "measure", "operations"],
  },
  {
    id: "day-page",
    name: "A page per day",
    blurb: "A journal, a question to answer, notes, and what you finished — rebuilt for each new day from a template you control.",
    detail:
      "One column per day, each holding the sections you decided a day should have. A template supplies the shape; edit the template and days that already exist are topped up with what it gained, without touching anything you wrote. Yesterday stays exactly as you left it.",
    built: ["build", "intake", "operations"],
  },
  {
    id: "trackers",
    name: "Trackers",
    blurb: "Totals that keep themselves up to date — how much, how many, how long, how often.",
    detail:
      "A tracker is an operation with somewhere to put its answer. It finds the records that qualify, adds up the part you care about, and writes the total where you can see it. Because you wrote the rule, you can change what qualifies — this week only, one category, only the ones you finished.",
    built: ["measure", "operations", "visualize"],
  },
  {
    id: "goals",
    name: "Goals and streaks",
    blurb: "A target, the distance to it, and how many days in a row you have got there.",
    detail:
      "The same machinery as a tracker with a target beside it, so progress is a comparison rather than a number you have to interpret. Targets scale to the window you are looking at, and a streak is one of the verbs — nothing had to be special-cased to count consecutive days.",
    built: ["measure", "operations", "visualize"],
  },
];
```

- [x] **Step 2: Write the content test**

Create `client/src/promo/__tests__/promoContent.test.js`:

```js
import { describe, it, expect } from "vitest";
import { FEATURES, featureBySlug } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

describe("promo content", () => {
  it("every feature has the fields FeaturePage renders", () => {
    for (const f of FEATURES) {
      expect(f.slug, "slug").toBeTruthy();
      expect(f.nav, `${f.slug} nav`).toBeTruthy();
      expect(f.title, `${f.slug} title`).toBeTruthy();
      expect(f.tagline, `${f.slug} tagline`).toBeTruthy();
      expect(f.body, `${f.slug} body`).toBeTruthy();
      expect(f.points.length, `${f.slug} points`).toBeGreaterThan(0);
      for (const p of f.points) {
        expect(p.heading, `${f.slug} point heading`).toBeTruthy();
        expect(p.text, `${f.slug} point text`).toBeTruthy();
      }
      expect(f.stat.value, `${f.slug} stat`).toBeTruthy();
      expect(f.stat.label, `${f.slug} stat label`).toBeTruthy();
    }
  });

  it("slugs are unique and url-safe", () => {
    const slugs = FEATURES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("featureBySlug finds and misses correctly", () => {
    expect(featureBySlug("operations")?.slug).toBe("operations");
    expect(featureBySlug("nope")).toBeUndefined();
  });

  // An example claiming a capability that does not exist would render a dead
  // link on the examples page.
  it("every example is built from real capability slugs", () => {
    const slugs = new Set(FEATURES.map((f) => f.slug));
    for (const e of EXAMPLES) {
      expect(e.built.length, `${e.id} built`).toBeGreaterThan(0);
      for (const b of e.built) {
        expect(slugs.has(b), `${e.id} names unknown capability "${b}"`).toBe(true);
      }
    }
  });

  it("examples have the fields ExamplesPage renders", () => {
    for (const e of EXAMPLES) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.blurb).toBeTruthy();
      expect(e.detail).toBeTruthy();
    }
  });
});
```

- [x] **Step 3: Write the domain-knowledge guard**

Create `client/src/promo/__tests__/noProductDomainKnowledge.test.js`:

```js
// The promotional site sells a GENERIC product. It does not know that a
// "Schedule" or a "Day Page" is a thing — those are examples of what someone
// assembled with it, and they live in content/examples.js.
//
// User, 2026-08-18, verbatim: "we can include schedule and daypage and trackers
// and goals in an examples page (details for them) but the main site doesnt
// know that schedule and daypage are a thing."
//
// This is the promo twin of __tests__/noDomainKnowledge.test.js, which keeps
// the same rule inside the renderer. Patterns are plain case-insensitive
// SUBSTRINGS, deliberately not \b-anchored: a word boundary does not fire
// inside an identifier, which is exactly how EMOTION_RINGS slipped past the
// renderer's guard on 2026-08-06.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PROMO = join(process.cwd(), "src", "promo");

// The one file allowed to name concrete builds, and the test files that
// necessarily quote the banned words in order to check for them.
const EXEMPT = [
  join("content", "examples.js"),
  join("__tests__", "noProductDomainKnowledge.test.js"),
  join("__tests__", "promoContent.test.js"),
];

const BANNED = ["schedule", "day page", "daypage", "tracker", "timeslot", "time slot"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the promo site has no product domain knowledge", () => {
  const files = walk(PROMO).filter(
    (f) => !EXEMPT.some((e) => relative(PROMO, f) === e)
  );

  it("has files to check", () => {
    // A guard that scans nothing passes vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  it("names no concrete build outside content/examples.js", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8").toLowerCase();
      for (const word of BANNED) {
        if (src.includes(word)) {
          offenders.push(`${relative(PROMO, f)} says "${word}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Prove the guard can FAIL. An assertion of absence proves nothing until you
  // have proven the thing can be present (2026-08-01 (16)).
  it("would catch a banned word", () => {
    const planted = 'const label = "Schedule";'.toLowerCase();
    expect(BANNED.some((w) => planted.includes(w))).toBe(true);
  });

  // "Moduli" is the internal codename. The product is Viafluere.
  it("never says Moduli in promo source", () => {
    const offenders = files.filter((f) =>
      /moduli/i.test(
        readFileSync(f, "utf8").replace(/moduli-(token|userId|gridId)/g, "")
      )
    );
    expect(offenders.map((f) => relative(PROMO, f))).toEqual([]);
  });
});
```

- [x] **Step 4: Run all three suites**

Run: `cd client && npx vitest run src/promo/__tests__/`
Expected: PASS. If the domain-knowledge guard fails, the fix is to reword the content — never to add to `EXEMPT`.

- [x] **Step 5: Commit**

```bash
git add client/src/promo/content client/src/promo/__tests__
git commit -m "feat(promo): capability content as data, with the rule that keeps the site generic

The promo pages describe capabilities; concrete builds live only in
examples.js, guarded the way the renderer is guarded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The promo shell — layout, nav, footer, palette

**Files:**
- Create: `client/src/promo/promo.css`
- Create: `client/src/promo/PromoLayout.jsx`
- Create: `client/src/promo/PromoNav.jsx`
- Create: `client/src/promo/PromoFooter.jsx`
- Create: `client/src/promo/__tests__/PromoNav.test.jsx`
- Modify: `client/src/promo/PromoApp.jsx`

**Interfaces:**
- Consumes: `FEATURES` (Task 3), `PROMO_PATHS` (Task 2).
- Produces: `PromoLayout` (default), `PromoNav` (default), `PromoFooter` (default). All CSS lives under a `.promo` root class so nothing leaks into the app when both are in one bundle.

- [x] **Step 1: Write the palette**

Create `client/src/promo/promo.css`:

```css
/* promo/promo.css — the public surface.
 *
 * This DELIBERATELY commits to one palette rather than following the app's five
 * themes. It is a promotional surface, not app chrome, and the user asked for
 * dark cinematic. Every rule is scoped under .promo so nothing here can reach
 * the grid when both are in one bundle.
 *
 * The accent gradient is taken from viafluere_lockup.svg's own double-knot.
 */

.promo {
  --p-bg:        #070b14;
  --p-bg-raised: #0d1424;
  --p-bg-card:   #111a2e;
  --p-line:      rgba(255, 255, 255, 0.09);
  --p-text:      #eef2fb;
  --p-text-dim:  #9aa7c2;
  --p-accent:    #5eead4;
  --p-accent-2:  #7c9cff;
  --p-grad:      linear-gradient(115deg, #5eead4 0%, #7c9cff 55%, #a78bfa 100%);

  --p-max: 1140px;
  --p-pad: clamp(20px, 5vw, 48px);

  background: var(--p-bg);
  color: var(--p-text);
  min-height: 100vh;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.promo * { box-sizing: border-box; }

.promo-shell { max-width: var(--p-max); margin: 0 auto; padding: 0 var(--p-pad); }

/* ── Nav ─────────────────────────────────────────────────────────── */
.promo-nav {
  position: sticky; top: 0; z-index: 40;
  background: rgba(7, 11, 20, 0.78);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--p-line);
}
.promo-nav-inner {
  max-width: var(--p-max); margin: 0 auto; padding: 0 var(--p-pad);
  height: 66px; display: flex; align-items: center; gap: 28px;
}
.promo-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.promo-logo img { height: 30px; width: auto; display: block; }
.promo-nav-links { display: flex; gap: 22px; margin-left: auto; }
.promo-nav-link {
  color: var(--p-text-dim); text-decoration: none; font-size: 14px;
  font-weight: 500; padding: 6px 0; position: relative; white-space: nowrap;
  transition: color 140ms ease;
}
.promo-nav-link:hover, .promo-nav-link[aria-current="page"] { color: var(--p-text); }
.promo-nav-link[aria-current="page"]::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0;
  height: 2px; background: var(--p-grad); border-radius: 2px;
}
.promo-nav-cta { margin-left: 6px; }
.promo-nav-toggle {
  display: none; margin-left: auto; background: none; border: 0;
  color: var(--p-text); font-size: 15px; padding: 10px 12px; cursor: pointer;
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.promo-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px; padding: 12px 22px; border-radius: 999px;
  font-size: 15px; font-weight: 600; text-decoration: none;
  border: 1px solid transparent; cursor: pointer; white-space: nowrap;
  transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.promo-btn--primary { background: var(--p-grad); color: #07121a; }
.promo-btn--primary:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(94, 234, 212, 0.25); }
.promo-btn--ghost { border-color: var(--p-line); color: var(--p-text); background: transparent; }
.promo-btn--ghost:hover { background: var(--p-bg-card); }

/* ── Sections / cards ────────────────────────────────────────────── */
.promo-section { padding: clamp(56px, 9vw, 108px) 0; }
.promo-eyebrow {
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--p-accent); font-weight: 700; margin: 0 0 14px;
}
.promo-h2 { font-size: clamp(28px, 4.2vw, 44px); line-height: 1.12; margin: 0 0 16px; letter-spacing: -0.02em; }
.promo-lede { font-size: clamp(16px, 1.9vw, 19px); line-height: 1.6; color: var(--p-text-dim); max-width: 62ch; margin: 0 0 28px; }

.promo-card {
  background: var(--p-bg-card); border: 1px solid var(--p-line);
  border-radius: 16px; padding: 26px; text-decoration: none; color: inherit;
  display: block; transition: transform 160ms ease, border-color 160ms ease;
}
.promo-card:hover { transform: translateY(-3px); border-color: rgba(94, 234, 212, 0.35); }
.promo-card h3 { margin: 0 0 8px; font-size: 19px; letter-spacing: -0.01em; }
.promo-card p { margin: 0; color: var(--p-text-dim); font-size: 15px; line-height: 1.55; }

.promo-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(268px, 1fr)); }

.promo-stat { font-size: clamp(38px, 6vw, 60px); font-weight: 800; letter-spacing: -0.03em;
  background: var(--p-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }

/* ── Footer ──────────────────────────────────────────────────────── */
.promo-footer { border-top: 1px solid var(--p-line); padding: 40px 0; color: var(--p-text-dim); font-size: 14px; }
.promo-footer-inner { max-width: var(--p-max); margin: 0 auto; padding: 0 var(--p-pad);
  display: flex; flex-wrap: wrap; gap: 18px; align-items: center; justify-content: space-between; }
.promo-footer a { color: var(--p-text-dim); text-decoration: none; }
.promo-footer a:hover { color: var(--p-text); }

/* ── Reveal on scroll ────────────────────────────────────────────── */
.promo-reveal { opacity: 0; transform: translateY(18px); transition: opacity 620ms ease, transform 620ms ease; }
.promo-reveal.is-in { opacity: 1; transform: none; }

/* ── Mobile ──────────────────────────────────────────────────────── */
@media (max-width: 820px) {
  .promo-nav-links { display: none; }
  .promo-nav-toggle { display: block; }
  .promo-nav-links.is-open {
    display: flex; flex-direction: column; gap: 4px;
    position: absolute; left: 0; right: 0; top: 66px;
    background: var(--p-bg-raised); border-bottom: 1px solid var(--p-line);
    padding: 12px var(--p-pad) 20px; margin: 0;
  }
  .promo-nav-links.is-open .promo-nav-link { padding: 13px 0; font-size: 16px; }
}

/* Motion is decoration here; never make it a barrier. */
@media (prefers-reduced-motion: reduce) {
  .promo * { animation: none !important; transition: none !important; }
  .promo-reveal { opacity: 1; transform: none; }
}
```

- [x] **Step 2: Write the nav test first**

Create `client/src/promo/__tests__/PromoNav.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PromoNav from "../PromoNav.jsx";
import { FEATURES } from "../content/features.js";

const mount = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PromoNav />
    </MemoryRouter>
  );

describe("PromoNav", () => {
  it("links to every capability page", () => {
    mount();
    for (const f of FEATURES) {
      const link = screen.getByRole("link", { name: f.nav });
      expect(link.getAttribute("href")).toBe(`/features/${f.slug}`);
    }
  });

  it("offers a way to log in", () => {
    mount();
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe("/login");
  });

  it("marks the current page", () => {
    mount("/features/operations");
    const current = screen.getByRole("link", { name: "Operations" });
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("the mobile toggle opens and closes the links", () => {
    mount();
    const toggle = screen.getByRole("button", { name: /menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  // Tapping a link on a phone must close the drawer, or the destination is
  // rendered underneath an open menu.
  it("closes the drawer when a link is followed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("link", { name: FEATURES[0].nav }));
    expect(screen.getByRole("button", { name: /menu/i }).getAttribute("aria-expanded")).toBe("false");
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `cd client && npx vitest run src/promo/__tests__/PromoNav.test.jsx`
Expected: FAIL — cannot resolve `../PromoNav.jsx`.

- [x] **Step 4: Write the nav**

Create `client/src/promo/PromoNav.jsx`:

```jsx
import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { FEATURES } from "./content/features.js";

export default function PromoNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="promo-nav">
      <nav className="promo-nav-inner" aria-label="Main">
        <Link to="/" className="promo-logo" onClick={close}>
          <img src="/viafluere_lockup.svg" alt="Viafluere" />
        </Link>

        <button
          type="button"
          className="promo-nav-toggle"
          aria-expanded={open ? "true" : "false"}
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>

        <div className={`promo-nav-links${open ? " is-open" : ""}`}>
          {FEATURES.map((f) => (
            <NavLink
              key={f.slug}
              to={`/features/${f.slug}`}
              className="promo-nav-link"
              onClick={close}
            >
              {f.nav}
            </NavLink>
          ))}
          <NavLink to="/examples" className="promo-nav-link" onClick={close}>
            Examples
          </NavLink>
          <Link to="/login" className="promo-btn promo-btn--ghost promo-nav-cta" onClick={close}>
            Log in
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

`NavLink` sets `aria-current="page"` on the active route by default, which is what the third test asserts.

- [x] **Step 5: Write the footer**

Create `client/src/promo/PromoFooter.jsx`:

```jsx
import React from "react";
import { Link } from "react-router-dom";

export default function PromoFooter() {
  return (
    <footer className="promo-footer">
      <div className="promo-footer-inner">
        <span>© {new Date().getFullYear()} Viafluere</span>
        <span style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Link to="/examples">Examples</Link>
          <Link to="/login">Log in</Link>
        </span>
      </div>
    </footer>
  );
}
```

- [x] **Step 6: Write the layout**

Create `client/src/promo/PromoLayout.jsx`:

```jsx
import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import PromoNav from "./PromoNav.jsx";
import PromoFooter from "./PromoFooter.jsx";
import "./promo.css";

export default function PromoLayout() {
  const { pathname } = useLocation();

  // A client-side route change does not reset scroll. Without this, following a
  // nav link from halfway down the landing page lands you halfway down the
  // next one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="promo">
      <PromoNav />
      <Outlet />
      <PromoFooter />
    </div>
  );
}
```

- [x] **Step 7: Wire the layout into the router**

Replace the `<Routes>` block in `client/src/promo/PromoApp.jsx`:

```jsx
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "./PromoLayout.jsx";
import LandingPage from "./pages/LandingPage.jsx";

export { PROMO_PATHS } from "./promoPaths.js";

export default function PromoApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<LandingPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [x] **Step 8: Run the tests**

Run: `cd client && npx vitest run src/promo/__tests__/`
Expected: PASS — including the domain-knowledge guard over the new CSS and components.

- [x] **Step 9: Commit**

```bash
git add client/src/promo/
git commit -m "feat(promo): dark cinematic shell — nav, footer, layout, palette

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The landing page

**Files:**
- Modify: `client/src/promo/pages/LandingPage.jsx` (replaces the Task 2 placeholder)

**Interfaces:**
- Consumes: `FEATURES`, `EXAMPLES`.
- Produces: `LandingPage` default export. Also `useReveal()` — a local hook in the same file, not exported.

- [x] **Step 1: Write the page**

Replace `client/src/promo/pages/LandingPage.jsx` entirely:

```jsx
import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { FEATURES } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

// Reveal on scroll via IntersectionObserver rather than a scroll listener: the
// observer fires off the main thread's critical path, and elements already in
// view on load are revealed immediately rather than waiting for a scroll that
// may never come on a short screen.
function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const els = root.current?.querySelectorAll(".promo-reveal");
    if (!els?.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return root;
}

export default function LandingPage() {
  const root = useReveal();

  return (
    <main ref={root}>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="promo-section promo-hero">
        <div className="promo-shell">
          <img
            src="/viafluere_lockup.svg"
            alt="Viafluere"
            className="promo-hero-mark"
            width="260"
          />
          <h1 className="promo-hero-title">
            Every task is a checkbox.
            <br />
            <span className="promo-hero-em">Or a measurement.</span>
          </h1>
          <p className="promo-lede promo-hero-lede">
            Drag what you do into a day, and record how much of it you did. Viafluere adds it
            up, counts it, and tracks it across any window of time you choose — without a
            separate tool for every question you want answered.
          </p>
          <div className="promo-hero-actions">
            <Link to="/login" className="promo-btn promo-btn--primary">
              Get started — it&rsquo;s free
            </Link>
            <Link to="/examples" className="promo-btn promo-btn--ghost">
              See what people build
            </Link>
          </div>
        </div>
      </section>

      {/* ── Capabilities ───────────────────────────────────────── */}
      <section className="promo-section">
        <div className="promo-shell">
          <p className="promo-eyebrow promo-reveal">What it does</p>
          <h2 className="promo-h2 promo-reveal">
            A workspace you assemble, not a screen you are handed
          </h2>
          <p className="promo-lede promo-reveal">
            There is no built-in planner to work around. You build the thing you need out of
            pieces that all speak the same language.
          </p>
          <div className="promo-grid">
            {FEATURES.map((f) => (
              <Link
                key={f.slug}
                to={`/features/${f.slug}`}
                className="promo-card promo-reveal"
              >
                <div className="promo-card-stat">{f.stat.value}</div>
                <h3>{f.nav}</h3>
                <p>{f.tagline}</p>
                <span className="promo-card-more">Read more →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Examples ───────────────────────────────────────────── */}
      <section className="promo-section promo-section--raised">
        <div className="promo-shell">
          <p className="promo-eyebrow promo-reveal">Built with it</p>
          <h2 className="promo-h2 promo-reveal">
            None of these are features. They are things people assembled.
          </h2>
          <p className="promo-lede promo-reveal">
            Each one is the same handful of capabilities put together a different way — which
            means you can change any of them, or build something they never anticipated.
          </p>
          <div className="promo-grid">
            {EXAMPLES.map((e) => (
              <article key={e.id} className="promo-card promo-reveal">
                <h3>{e.name}</h3>
                <p>{e.blurb}</p>
              </article>
            ))}
          </div>
          <p style={{ marginTop: 28 }}>
            <Link to="/examples" className="promo-btn promo-btn--ghost">
              Look at these in detail
            </Link>
          </p>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────────── */}
      <section className="promo-section">
        <div className="promo-shell promo-cta">
          <h2 className="promo-h2 promo-reveal">Start with an empty grid</h2>
          <p className="promo-lede promo-reveal" style={{ marginInline: "auto" }}>
            Signing up creates your workspace immediately. There is nothing to install and no
            card to enter.
          </p>
          <Link to="/login" className="promo-btn promo-btn--primary promo-reveal">
            Create your workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
```

- [x] **Step 2: Add the landing-specific CSS**

Append to `client/src/promo/promo.css`:

```css
/* ── Landing ─────────────────────────────────────────────────────── */
.promo-hero { padding-top: clamp(48px, 8vw, 96px); position: relative; overflow: hidden; }
/* A single soft light behind the hero. One gradient, no image to load. */
.promo-hero::before {
  content: ""; position: absolute; inset: -40% 0 auto 50%;
  width: min(1100px, 130vw); aspect-ratio: 1; transform: translateX(-50%);
  background: radial-gradient(circle, rgba(94,234,212,0.16) 0%, rgba(124,156,255,0.10) 38%, transparent 66%);
  pointer-events: none;
}
.promo-hero > * { position: relative; }
.promo-hero-mark { max-width: min(260px, 62vw); height: auto; margin-bottom: 30px; }
.promo-hero-title {
  font-size: clamp(38px, 7.4vw, 78px); line-height: 1.03;
  letter-spacing: -0.035em; margin: 0 0 22px; font-weight: 800; max-width: 15ch;
}
.promo-hero-em { background: var(--p-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.promo-hero-lede { font-size: clamp(17px, 2.1vw, 21px); }
.promo-hero-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 34px; }

.promo-section--raised { background: var(--p-bg-raised); border-block: 1px solid var(--p-line); }

.promo-card-stat {
  font-size: 30px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 10px;
  background: var(--p-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.promo-card-more { display: inline-block; margin-top: 14px; font-size: 14px; font-weight: 600; color: var(--p-accent); }

.promo-cta { text-align: center; }
.promo-cta .promo-lede { max-width: 52ch; }

/* Stagger the reveal across a row so cards arrive in sequence. */
.promo-grid .promo-reveal:nth-child(2) { transition-delay: 70ms; }
.promo-grid .promo-reveal:nth-child(3) { transition-delay: 140ms; }
.promo-grid .promo-reveal:nth-child(4) { transition-delay: 210ms; }
.promo-grid .promo-reveal:nth-child(5) { transition-delay: 280ms; }
```

- [x] **Step 3: Verify tests still pass**

Run: `cd client && npx vitest run src/promo/__tests__/`
Expected: PASS. In particular the domain-knowledge guard must still be green — if the hero copy accidentally used the word "schedule", it fails here.

- [x] **Step 4: Look at it**

Run the dev server and open `http://localhost:5173/` in a browser with no session.

Confirm by eye, and say so explicitly in the commit:
- the logo is legible against the dark ground and is not clipped;
- the hero headline does not wrap awkwardly at 1440px, 1024px, or 390px;
- cards reveal as you scroll, and are all visible (not stuck invisible) if you jump to the bottom;
- with `prefers-reduced-motion` forced on, everything is visible immediately.

Take a screenshot at 1440x900 and at 390x844 and look at both.

- [x] **Step 5: Commit**

```bash
git add client/src/promo/
git commit -m "feat(promo): the landing page — hero, capabilities, examples, CTA

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Feature and example pages

**Files:**
- Create: `client/src/promo/pages/FeaturePage.jsx`
- Create: `client/src/promo/pages/ExamplesPage.jsx`
- Create: `client/src/promo/pages/NotFoundPage.jsx`
- Create: `client/src/promo/__tests__/promoRouting.test.jsx`
- Modify: `client/src/promo/PromoApp.jsx`

**Interfaces:**
- Consumes: `featureBySlug`, `FEATURES`, `EXAMPLES`.
- Produces: `FeaturePage`, `ExamplesPage`, `NotFoundPage` default exports.

- [x] **Step 1: Write the routing test first**

Create `client/src/promo/__tests__/promoRouting.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "../PromoLayout.jsx";
import LandingPage from "../pages/LandingPage.jsx";
import FeaturePage from "../pages/FeaturePage.jsx";
import ExamplesPage from "../pages/ExamplesPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
import { FEATURES } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

// Mirrors PromoApp's table without BrowserRouter, so a path can be forced.
function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features/:slug" element={<FeaturePage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("promo routing", () => {
  it("renders every capability page from its slug", () => {
    for (const f of FEATURES) {
      const { unmount } = mount(`/features/${f.slug}`);
      expect(screen.getByRole("heading", { level: 1, name: f.title })).toBeTruthy();
      // The measured figure is the claim; it must reach the page.
      expect(screen.getAllByText(f.stat.value).length).toBeGreaterThan(0);
      for (const p of f.points) expect(screen.getByText(p.heading)).toBeTruthy();
      unmount();
    }
  });

  // An unknown slug must not render an empty shell that looks like a working
  // page — it is a 404.
  it("an unknown slug is not found", () => {
    mount("/features/does-not-exist");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/not found/i);
  });

  it("the examples page lists every example with its detail", () => {
    mount("/examples");
    for (const e of EXAMPLES) {
      expect(screen.getByRole("heading", { level: 2, name: e.name })).toBeTruthy();
      expect(screen.getByText(e.detail)).toBeTruthy();
    }
  });

  // The join between an example and the generic capabilities it is made of is
  // the whole argument of the page.
  //
  // SCOPED TO THE ARTICLE ON PURPOSE. The nav in PromoLayout renders a link to
  // /features/<slug> with the SAME accessible name as the chip, so a
  // screen-wide query passes on the nav link and never looks at the chip at
  // all — green while the feature is missing. Query within the example.
  it("each example links to the capabilities it is built from", () => {
    const { container } = mount("/examples");
    for (const e of EXAMPLES) {
      const article = [...container.querySelectorAll(".promo-example")].find(
        (el) => el.querySelector("h2")?.textContent === e.name
      );
      expect(article, `no article for ${e.id}`).toBeTruthy();
      const chips = within(article).getAllByRole("link");
      const hrefs = chips.map((c) => c.getAttribute("href"));
      for (const slug of e.built) {
        expect(hrefs, `${e.id} does not link to ${slug}`).toContain(`/features/${slug}`);
      }
    }
  });

  it("an unknown path is not found", () => {
    mount("/nonsense");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/not found/i);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/promo/__tests__/promoRouting.test.jsx`
Expected: FAIL — cannot resolve `../pages/FeaturePage.jsx`.

- [x] **Step 3: Write FeaturePage**

Create `client/src/promo/pages/FeaturePage.jsx`:

```jsx
import React from "react";
import { useParams, Link } from "react-router-dom";
import { featureBySlug, FEATURES } from "../content/features.js";
import NotFoundPage from "./NotFoundPage.jsx";

export default function FeaturePage() {
  const { slug } = useParams();
  const feature = featureBySlug(slug);

  // An unknown slug renders the 404 rather than an empty template. A page
  // whose content is missing but whose chrome renders reads as working.
  if (!feature) return <NotFoundPage />;

  const others = FEATURES.filter((f) => f.slug !== feature.slug);

  return (
    <main>
      <section className="promo-section promo-feature-head">
        <div className="promo-shell">
          <p className="promo-eyebrow">{feature.nav}</p>
          <h1 className="promo-hero-title promo-feature-title">{feature.title}</h1>
          <p className="promo-lede">{feature.tagline}</p>
          <div className="promo-feature-stat">
            <span className="promo-stat">{feature.stat.value}</span>
            <span className="promo-feature-stat-label">{feature.stat.label}</span>
          </div>
        </div>
      </section>

      <section className="promo-section promo-section--raised">
        <div className="promo-shell">
          <p className="promo-feature-body">{feature.body}</p>

          {feature.shot ? (
            <figure className="promo-shot">
              <img src={`/promo/${feature.shot}`} alt={`${feature.nav} in Viafluere`} loading="lazy" />
            </figure>
          ) : null}

          <div className="promo-grid" style={{ marginTop: 40 }}>
            {feature.points.map((p) => (
              <article key={p.heading} className="promo-card">
                <h3>{p.heading}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="promo-section">
        <div className="promo-shell">
          <p className="promo-eyebrow">Keep reading</p>
          <div className="promo-grid">
            {others.map((f) => (
              <Link key={f.slug} to={`/features/${f.slug}`} className="promo-card">
                <h3>{f.nav}</h3>
                <p>{f.tagline}</p>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 34 }}>
            <Link to="/login" className="promo-btn promo-btn--primary">
              Get started — it&rsquo;s free
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
```

- [x] **Step 4: Write ExamplesPage**

Create `client/src/promo/pages/ExamplesPage.jsx`:

```jsx
import React from "react";
import { Link } from "react-router-dom";
import { EXAMPLES } from "../content/examples.js";
import { featureBySlug } from "../content/features.js";

export default function ExamplesPage() {
  return (
    <main>
      <section className="promo-section promo-feature-head">
        <div className="promo-shell">
          <p className="promo-eyebrow">Examples</p>
          <h1 className="promo-hero-title promo-feature-title">
            Things people have assembled
          </h1>
          <p className="promo-lede">
            Viafluere does not ship any of these. Each one is the same capabilities put
            together a particular way — which is why you can change every part of them, or
            build something else entirely.
          </p>
        </div>
      </section>

      <section className="promo-section promo-section--raised">
        <div className="promo-shell promo-examples">
          {EXAMPLES.map((e) => (
            <article key={e.id} className="promo-example">
              <h2 className="promo-h2">{e.name}</h2>
              <p className="promo-lede">{e.blurb}</p>
              <p className="promo-feature-body">{e.detail}</p>
              <p className="promo-example-built">
                <span className="promo-example-built-label">Built from</span>
                {e.built.map((slug) => {
                  const f = featureBySlug(slug);
                  return (
                    <Link key={slug} to={`/features/${slug}`} className="promo-chip">
                      {f.nav}
                    </Link>
                  );
                })}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="promo-section">
        <div className="promo-shell promo-cta">
          <h2 className="promo-h2">Build your own version of any of these</h2>
          <Link to="/login" className="promo-btn promo-btn--primary">
            Create your workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
```

- [x] **Step 5: Write NotFoundPage**

Create `client/src/promo/pages/NotFoundPage.jsx`:

```jsx
import React from "react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="promo-section">
      <div className="promo-shell">
        <p className="promo-eyebrow">404</p>
        <h1 className="promo-hero-title promo-feature-title">Page not found</h1>
        <p className="promo-lede">
          That address does not exist. The links below do.
        </p>
        <div className="promo-hero-actions">
          <Link to="/" className="promo-btn promo-btn--primary">Home</Link>
          <Link to="/examples" className="promo-btn promo-btn--ghost">Examples</Link>
        </div>
      </div>
    </main>
  );
}
```

- [x] **Step 6: Add the routes**

Replace the `<Routes>` block in `client/src/promo/PromoApp.jsx`:

```jsx
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "./PromoLayout.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import FeaturePage from "./pages/FeaturePage.jsx";
import ExamplesPage from "./pages/ExamplesPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

export { PROMO_PATHS } from "./promoPaths.js";

export default function PromoApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features/:slug" element={<FeaturePage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [x] **Step 7: Add the page CSS**

Append to `client/src/promo/promo.css`:

```css
/* ── Feature / examples pages ────────────────────────────────────── */
.promo-feature-head { padding-bottom: clamp(30px, 5vw, 56px); }
.promo-feature-title { font-size: clamp(32px, 5.6vw, 60px); max-width: 20ch; }
.promo-feature-stat { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-top: 18px; }
.promo-feature-stat-label { color: var(--p-text-dim); font-size: 15px; }
.promo-feature-body { font-size: clamp(16px, 1.85vw, 18px); line-height: 1.7; color: var(--p-text); max-width: 68ch; margin: 0 0 20px; }

.promo-shot { margin: 34px 0 0; }
.promo-shot img {
  width: 100%; height: auto; display: block; border-radius: 14px;
  border: 1px solid var(--p-line); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
}

.promo-examples { display: flex; flex-direction: column; gap: clamp(44px, 7vw, 76px); }
.promo-example { border-left: 2px solid transparent; border-image: var(--p-grad) 1; padding-left: clamp(16px, 3vw, 30px); }
.promo-example-built { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 18px 0 0; }
.promo-example-built-label { color: var(--p-text-dim); font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; }
.promo-chip {
  display: inline-block; padding: 6px 13px; border-radius: 999px;
  border: 1px solid var(--p-line); background: var(--p-bg-card);
  color: var(--p-text); font-size: 13px; font-weight: 600; text-decoration: none;
  transition: border-color 140ms ease;
}
.promo-chip:hover { border-color: var(--p-accent); }
```

- [x] **Step 8: Run the tests**

Run: `cd client && npx vitest run src/promo/__tests__/`
Expected: PASS, all suites.

- [x] **Step 9: A/B the 404 branch**

Temporarily change `FeaturePage.jsx`'s guard to `if (false) return <NotFoundPage />;` and re-run.
Expected: the "an unknown slug is not found" test FAILS. Restore the guard and confirm it passes again. **An A/B is a probe — confirm the mutation actually landed before believing the result** (2026-08-09 (4)).

- [x] **Step 10: Commit**

```bash
git add client/src/promo/
git commit -m "feat(promo): capability pages and the examples page, one component each

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The /login route

The only promo route that touches the socket, and the one that would have looped forever without Task 1.

**Files:**
- Create: `client/src/promo/pages/LoginRoute.jsx`
- Create: `client/src/promo/__tests__/LoginRoute.test.jsx`
- Modify: `client/src/promo/PromoApp.jsx`

**Interfaces:**
- Consumes: `persistAuth` (Task 1).
- Produces: `LoginRoute` default export. On `auth_success` it persists the session and performs a **full-page** navigation to `/`.

- [x] **Step 1: Write the test first**

Create `client/src/promo/__tests__/LoginRoute.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A tiny fake socket standing in for the real one, so no connection is opened.
const handlers = {};
const emitted = [];
const fakeSocket = {
  on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
  off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
  emit: (ev, payload) => emitted.push([ev, payload]),
};
const fire = (ev, payload) => (handlers[ev] || []).forEach((f) => f(payload));

vi.mock("../../socket.js", () => ({ socket: fakeSocket, emit: fakeSocket.emit }));

import LoginRoute from "../pages/LoginRoute.jsx";
import { readToken } from "../../helpers/authStorage.js";

const assign = vi.fn();

beforeEach(() => {
  localStorage.clear();
  emitted.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/login" });
});

const mount = () =>
  render(<MemoryRouter initialEntries={["/login"]}><LoginRoute /></MemoryRouter>);

const fill = async () => {
  await waitFor(() => screen.getByLabelText(/email/i));
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.c" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
};

describe("LoginRoute", () => {
  it("emits login with the credentials", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    expect(emitted).toContainEqual(["login", { email: "a@b.c", password: "pw" }]);
  });

  it("emits register when creating an account", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(emitted).toContainEqual(["register", { email: "a@b.c", password: "pw" }]);
  });

  // THE REGRESSION THIS ROUTE EXISTS TO AVOID. bindSocketToStore is the only
  // other writer of the token and it is bound from App.jsx, which is NOT
  // mounted here. Without this, a successful login stores nothing and the user
  // is returned to this same form forever.
  it("stores the session on auth_success", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_success", { token: "tok-1", userId: "u-1" });
    expect(readToken()).toBe("tok-1");
  });

  it("navigates to the app on auth_success", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_success", { token: "tok-1", userId: "u-1" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("shows the server's error and stores nothing", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_error", "Invalid email or password");
    await waitFor(() => screen.getByText("Invalid email or password"));
    expect(readToken()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("refuses to submit with an empty field", async () => {
    mount();
    await waitFor(() => screen.getByLabelText(/email/i));
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    expect(emitted).toEqual([]);
    expect(screen.getByText(/required/i)).toBeTruthy();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/promo/__tests__/LoginRoute.test.jsx`
Expected: FAIL — cannot resolve `../pages/LoginRoute.jsx`.

- [x] **Step 3: Write the route**

Create `client/src/promo/pages/LoginRoute.jsx`:

```jsx
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { persistAuth } from "../../helpers/authStorage.js";

// The socket is pulled in LAZILY and only here. A visitor reading the landing
// page must not open a websocket, and socket.io-client is its own chunk — a
// static import at the top of this file would put it in the promo bundle for
// everyone. `promoIsolation.test.js` enforces the lazy form.
function useSocket() {
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../../socket.js").then((m) => {
      if (alive) setSocket(m.socket);
    });
    return () => { alive = false; };
  }, []);
  return socket;
}

export default function LoginRoute() {
  const socket = useSocket();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onSuccess = (payload) => {
      // This route owns persistence because bindSocketToStore — the only other
      // writer — lives inside the app, which is not mounted on this route.
      persistAuth(payload || {});
      // A FULL navigation rather than a client-side one: the entry split in
      // main.jsx reads the token synchronously at startup, so reloading is what
      // hands the visitor to the grid. Swapping the app in underneath the
      // router would need the whole store bootstrapped here.
      window.location.assign("/");
    };
    const onError = (msg) => {
      setError(msg || "Login failed");
      setBusy(false);
    };
    socket.on("auth_success", onSuccess);
    socket.on("auth_error", onError);
    return () => {
      socket.off("auth_success", onSuccess);
      socket.off("auth_error", onError);
    };
  }, [socket]);

  const submit = (event) => {
    if (!email || !password) { setError("Email and password required"); return; }
    if (!socket) { setError("Still connecting — try again in a moment"); return; }
    setError("");
    setBusy(true);
    socket.emit(event, { email, password });
  };

  return (
    <main className="promo-section promo-login">
      <div className="promo-shell promo-login-inner">
        <Link to="/" className="promo-login-mark">
          <img src="/viafluere_lockup.svg" alt="Viafluere" width="200" />
        </Link>

        <h1 className="promo-h2">Welcome back</h1>
        <p className="promo-lede">
          Signing up creates your workspace straight away — there is nothing to install.
        </p>

        <form
          className="promo-login-form"
          onSubmit={(e) => { e.preventDefault(); submit("login"); }}
        >
          <label className="promo-field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="promo-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? <p className="promo-login-error" role="alert">{error}</p> : null}

          <div className="promo-login-actions">
            <button type="submit" className="promo-btn promo-btn--primary" disabled={busy}>
              {busy ? "Working…" : "Log in"}
            </button>
            <button
              type="button"
              className="promo-btn promo-btn--ghost"
              disabled={busy}
              onClick={() => submit("register")}
            >
              Create account
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
```

- [x] **Step 4: Add the route**

In `client/src/promo/PromoApp.jsx` add the import and the route:

```jsx
import LoginRoute from "./pages/LoginRoute.jsx";
```

and, inside `<Route element={<PromoLayout />}>`, before the `*` route:

```jsx
        <Route path="/login" element={<LoginRoute />} />
```

- [x] **Step 5: Add the login CSS**

Append to `client/src/promo/promo.css`:

```css
/* ── Login ───────────────────────────────────────────────────────── */
.promo-login { min-height: calc(100vh - 66px); display: flex; align-items: center; }
.promo-login-inner { max-width: 460px; }
.promo-login-mark { display: inline-block; margin-bottom: 26px; }
.promo-login-mark img { max-width: min(200px, 56vw); height: auto; display: block; }
.promo-login-form { display: flex; flex-direction: column; gap: 16px; margin-top: 26px; }
.promo-field { display: flex; flex-direction: column; gap: 7px; }
.promo-field span { font-size: 13px; color: var(--p-text-dim); font-weight: 600; }
.promo-field input {
  background: var(--p-bg-card); border: 1px solid var(--p-line); border-radius: 10px;
  padding: 13px 14px; color: var(--p-text); font-size: 16px; /* 16px: iOS zooms below it */
  outline: none; transition: border-color 140ms ease;
}
.promo-field input:focus { border-color: var(--p-accent); }
.promo-login-error { color: #ff8f8f; font-size: 14px; margin: 0; }
.promo-login-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.promo-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
```

- [x] **Step 6: Run the tests**

Run: `cd client && npx vitest run src/promo/__tests__/`
Expected: PASS, all suites including isolation (the socket import is lazy, so `SOCKET_STATIC` does not match).

- [x] **Step 7: A/B the token write — the regression that motivated Task 1**

Comment out the `persistAuth(payload || {});` line in `LoginRoute.jsx` and re-run:

Run: `cd client && npx vitest run src/promo/__tests__/LoginRoute.test.jsx`
Expected: the "stores the session on auth_success" test FAILS and no other. Restore the line and confirm green. Verify the mutation actually landed (the file really changed) before believing the result.

- [x] **Step 8: Verify end to end in a browser**

With the dev server running and NO session:
1. Load `/`, click "Log in" → the form renders at `/login`.
2. Register a brand-new email → the page reloads and the **grid** appears.
3. Reload → still signed in, still the grid at `/`.
4. Navigate to `/features/operations` while signed in → the feature page renders (not the grid).
5. Sign out from the app → `/` returns to the landing page.

Step 2 is the one that would have failed before Task 1. Confirm the token is in `localStorage` immediately after `auth_success`, before the reload.

- [x] **Step 9: Commit**

```bash
git add client/src/promo/
git commit -m "feat(promo): /login — the socket arrives lazily, and the route persists its own session

bindSocketToStore is the only other writer of the token and it lives inside
App, which this route does not mount. A/B'd: dropping the persist call fails
exactly the test written for it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Metadata, and the assets a promoted site needs

**Files:**
- Modify: `client/index.html`
- Create: `client/public/robots.txt` (overwrite the existing stub)
- Create: `client/public/promo/` (directory for Task 9's captures)

- [x] **Step 1: Write the document head**

In `client/index.html`, replace the `<title>` line (add one if absent) and the description meta:

```html
  <title>Viafluere — every task is a checkbox, or a measurement</title>
  <meta name="description" content="Drag what you do into a day and record how much of it you did. Viafluere adds it up, counts it, and tracks it across any window of time — without a separate tool for every question." />
  <meta name="theme-color" content="#070b14" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Viafluere" />
  <meta property="og:title" content="Viafluere — every task is a checkbox, or a measurement" />
  <meta property="og:description" content="A workspace you assemble, not a screen you are handed. Measure anything, build it your way, and compose the maths yourself." />
  <meta property="og:image" content="https://viafluere.com/promo/og-card.png" />
  <meta property="og:url" content="https://viafluere.com/" />
  <meta name="twitter:card" content="summary_large_image" />
```

**Note the cache rule:** `index.html` is served `no-cache` but `og-card.png` sits under `/promo/`, which is NOT `assets/`, so it is also `no-cache` — no content hash needed. Confirm by reading `server/server.js:1210-1220`: only `assets/` gets `immutable`.

- [x] **Step 2: Write robots.txt**

Overwrite `client/public/robots.txt`:

```
User-agent: *
Allow: /
Disallow: /login

Sitemap: https://viafluere.com/sitemap.xml
```

- [x] **Step 3: Add a sitemap**

Create `client/public/sitemap.xml` listing `/`, `/examples`, and one entry per feature slug:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://viafluere.com/</loc><priority>1.0</priority></url>
  <url><loc>https://viafluere.com/examples</loc><priority>0.8</priority></url>
  <url><loc>https://viafluere.com/features/measure</loc><priority>0.7</priority></url>
  <url><loc>https://viafluere.com/features/build</loc><priority>0.7</priority></url>
  <url><loc>https://viafluere.com/features/operations</loc><priority>0.7</priority></url>
  <url><loc>https://viafluere.com/features/intake</loc><priority>0.7</priority></url>
  <url><loc>https://viafluere.com/features/visualize</loc><priority>0.7</priority></url>
</urlset>
```

The namespace host is `sitemaps.org`, plural — a singular `sitemap.org` is a common typo that makes the file invalid.

- [x] **Step 4: Guard the sitemap against drift**

Append to `client/src/promo/__tests__/promoContent.test.js`:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("the sitemap lists every capability page", () => {
  const xml = readFileSync(join(process.cwd(), "public", "sitemap.xml"), "utf8");
  for (const f of FEATURES) {
    expect(xml, `sitemap is missing ${f.slug}`).toContain(`/features/${f.slug}`);
  }
});
```

- [x] **Step 5: Run and commit**

Run: `cd client && npx vitest run src/promo/__tests__/promoContent.test.js`
Expected: PASS.

```bash
mkdir -p client/public/promo && touch client/public/promo/.gitkeep
git add client/index.html client/public/robots.txt client/public/sitemap.xml client/public/promo/.gitkeep client/src/promo/__tests__/promoContent.test.js
git commit -m "feat(promo): document head, robots, sitemap — with a test that the sitemap cannot drift

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Fresh product captures

The existing `screenshots/` product shots are dated April 2026 and predate the instance-bodies, spread-viewer and wallpaper work. Shipping them would promote an app that no longer exists.

**Files:**
- Create: `client/public/promo/*.png` (one per capability page + one OG card)
- Modify: `client/src/promo/content/features.js` (fill each `shot`)

- [ ] **Step 1: Decide what each shot must show**

One capture per capability, each showing the capability rather than a pretty screen:

| slug | the shot must show |
|---|---|
| `measure` | a row with several different value types filled in beside its tick |
| `build` | a panel holding containers in two different render modes at once |
| `operations` | the operation editor with a real pipeline open |
| `intake` | the intake sheet open, offering its shapes for a dropped item |
| `visualize` | a chart container with real data in it |

- [ ] **Step 2: Capture against a real grid**

Use `test grid 2` — never `poms grid`, which is protected live data (`server/utils/protectedGrids.js`).

Drive a headless browser at **1600x1000** with `deviceScaleFactor: 2`, sign in, navigate to each surface, and capture the element rather than the whole viewport where possible, so the shot is the feature and not the chrome around it.

Write the probe to `/tmp/claude-1000/.../scratchpad/` — **not** the repo root. `deploy.sh` runs `git add -A`, and repo-root probe scripts have been swept into deploy commits twice (`.gitignore` has `/_*.mjs`, which is anchored and does not cover other names).

- [ ] **Step 3: LOOK at every capture before using it**

Open each PNG and confirm it shows what the table above says it shows. A capture that resolved to the wrong scroll position, an empty container, or a loading skeleton is the failure mode here, and no automated check will catch it. This repo's record has several cases where the numbers agreed and the picture was wrong.

Also confirm no real personal data is legible — this is a public marketing asset. If test grid 2 carries anything identifiable, change it before capturing.

- [ ] **Step 4: Compress**

Each shot should be under ~250KB. They are `loading="lazy"` and below the fold, but they are on a `no-cache` path.

Run: `ls -la client/public/promo/` and record the sizes.

- [ ] **Step 5: Wire them into the content**

Set each `shot` in `features.js` to its filename, e.g. `shot: "operations.png"`.

- [ ] **Step 6: Add a coverage test**

Append to `client/src/promo/__tests__/promoContent.test.js`:

```js
import { existsSync } from "node:fs";

// A shot named but absent renders a broken image on a marketing page.
it("every named screenshot exists on disk", () => {
  for (const f of FEATURES) {
    if (!f.shot) continue;
    const p = join(process.cwd(), "public", "promo", f.shot);
    expect(existsSync(p), `${f.slug} names a missing shot: ${f.shot}`).toBe(true);
  }
});
```

- [ ] **Step 7: Look at the pages with the shots in place**

Load each `/features/<slug>` in a browser at 1440x900 and 390x844. Confirm the shot is legible at phone width — a dense screenshot scaled to 350px wide is decoration, not evidence. If one is unreadable, crop it to the part that matters rather than shipping it small.

- [ ] **Step 8: Commit**

```bash
git add client/public/promo client/src/promo/content/features.js client/src/promo/__tests__/promoContent.test.js
git commit -m "feat(promo): fresh product captures — the April screenshots predate this month's UI

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification and deploy

- [x] **Step 1: Full suites**

Run: `cd client && npm test 2>&1 | tail -20`
Expected: the documented baseline plus the new promo tests. **Read the failure COUNT** — the 3 pre-existing `liveOpsBehavioral` failures are known; a fourth is a regression (the 2026-08-09 (6) lesson).

Run: `cd server && npm test 2>&1 | tail -10`
Expected: 865 passing, unchanged — no server file was touched.

- [x] **Step 2: Build and record the chunks**

Run: `cd client && npm run build 2>&1 | tail -30`
Expected: succeeds, no new chunk-size warnings beyond the documented ones.

Run: `cd client && ls -la dist/assets/*.js | awk '{print $5, $9}' | sort -rn | head -14`

Record: the entry chunk, `PromoApp-*`, `App-*`. State the promo chunk size in the commit.

- [x] **Step 3: Verify the isolation claim against the BUILT output**

The static test proves the source has no bad imports; this proves the bundler agreed.

```bash
cd client
PROMO=$(ls dist/assets/PromoApp-*.js)
echo "promo chunk: $PROMO"
# Control FIRST: a string that MUST be present, or a zero below means nothing.
grep -c "Viafluere" "$PROMO"          # expect > 0
grep -c "promo-hero-title" "$PROMO"   # expect > 0
# The claims:
grep -c "socket.io" "$PROMO"          # expect 0
grep -c "CommitHelpers" "$PROMO"      # expect 0
```

**Run the controls first and confirm they are non-zero.** A zero on a control is the tell that the probe is reading the wrong chunk — exactly the trap recorded on 2026-08-08 (4) and 2026-08-11 (5).

- [x] **Step 4: Look at every route in a real browser**

At 1440x900 and 390x844, with no session, walk: `/` → each of the five `/features/<slug>` → `/examples` → `/login` → a deliberate 404. Confirm at each stop that the page renders, the nav marks the right link, and nothing overflows horizontally.

Then with a session: confirm `/` is the grid and `/features/build` is still the feature page.

- [x] **Step 5: Deploy**

Run: `./deploy.sh`

**Do not pipe it through `tail`** — that masks a failed build and took prod down on 2026-08-18.

- [x] **Step 6: Verify the SERVED site, not the script output**

```bash
ssh <prod> 'cd <repo> && git log --oneline -1'          # HEAD matches local
curl -sI https://viafluere.com/ | head -1                # 200
curl -sI https://viafluere.com/features/operations | head -1   # 200 via the SPA fallback
curl -sI https://viafluere.com/examples | head -1        # 200
```

Then fetch the served promo chunk and grep it with the same control-first discipline as Step 3.

A 502 immediately after deploy is the documented pm2 restart window — bundle 200 + index 502 is the tell. Retry once, check pm2 uptime and the error log's **timestamp** before believing it is yours.

- [x] **Step 7: Look at production**

Load `https://viafluere.com/` in a real browser, signed out, at desktop and phone width. **Look at it.** Then sign in and confirm the grid still loads normally.

- [x] **Step 8: Update CLAUDE.md**

Add a dated entry recording: the entry-split design, the measured chunk numbers, the `bindSocketToStore` token-writer trap and why `authStorage.js` exists, and the no-domain-knowledge rule for the promo surface with the user's verbatim quote. State plainly anything left unverified.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: landing page and promo routes — as built

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Register from scratch and build `claude-grid` through the UI

**User, 2026-08-18:** *"put in a thing to create a grid after from your own imagination of the site. register, create a grid from scratch, and try to add things via the ui, and just come up with your own grid called claude-grid. this way i can test how the site works from scratch and see what you come up with, knowing all the features of the site"*

This is a real from-scratch pass, not a fixture: a brand-new account, a grid built by clicking, so the user can open it and judge both the product's new-user path and the design. It doubles as the most honest end-to-end test of Tasks 2-7 — the landing page is only proven when someone reaches a working workspace through it.

**RUN THIS ONLY AFTER TASK 7.** The register button on the promo `/login` route is the entry point, and exercising it is half the point.

**THIS IS A ONE-OFF.** User, 2026-08-18: *"it shouldnt build claude grid on a fresh account everytime btw"* / *"just this once"*. `claude-grid` is built once, on one fresh account, so the user can look at it. It is NOT a fixture to be rebuilt, NOT something a later session should re-run, and NOT a step to automate. Once this task is done it is done — a future session finding it unticked should ask before repeating it.

#### Ground rules

- **Never touch `poms grid`.** It is protected live data (`server/utils/protectedGrids.js`). This task creates a NEW user, so it cannot reach it — verify that assumption once rather than assuming it.
- **Everything through the UI.** No direct Mongo writes, no seed scripts, no migrations. The value of this task is that it exercises the paths a real person uses; a grid assembled by writing to the database proves nothing about them.
- **dev and prod share one Atlas database** (CLAUDE.md 2026-07-14). A grid created against a local dev server is therefore visible on the deployed site, which is what lets the user open it. Confirm this before promising it.
- **Report the credentials** to the user at the end — the grid is under a new account and is unreachable without them.

- [ ] **Step 1: Register through the promo login route**

Drive a real browser to the running site with no session. Land on `/`, click "Log in", and use **Create account** with:

```
email:    claude-grid@viafluere.test
password: <generate one, record it in the final report>
```

Confirm: the token is stored, the page navigates to `/`, and a workspace renders. Note what the brand-new user is given by `createDefaultUserData` — that is the real first-run experience and worth describing honestly.

- [ ] **Step 2: Create the grid**

Create a new grid named exactly `claude-grid` and switch to it. Do not rename or reuse the seeded default grid — the ask is a grid built from scratch.

- [ ] **Step 3: Build it — the concept**

**Concept: a workshop log for learning a craft.** Deliberately NOT the wellness framing `poms grid` uses, so the grid demonstrates that the product is generic rather than reproducing the one build it already has.

The theme is yours to execute, but the grid MUST exercise each capability the promo site claims, because the site is now making these claims in public:

| Claim on the promo site | Must appear in `claude-grid` |
|---|---|
| 11 kinds of value | at least six distinct field types on real records, including a duration, a number, a rating, a date, a choice, and a reference to another occurrence |
| 4 ways to render a container | one board, one doc, one table, one canvas |
| values carry direction | at least one amount field used both in and out |
| 114 verbs — the maths is yours | at least two operations you compose: one total, and one that is not a plain sum (a streak, a count with a condition, or a difference) |
| 7 chart shapes, fed live | one graph container reading records you entered |
| 24 things a dropped item can become | bring at least one thing in by dropping it — a link or a file — and choose a shape deliberately |
| build it your way | more than one panel, arranged |

- [ ] **Step 4: Put real data in it**

A grid with empty containers demonstrates nothing. Enter enough records that the trackers show non-zero numbers and the chart has shape — several days' worth, not one row.

- [ ] **Step 5: Write down what fought you**

**This is the most valuable output of the task.** Keep a running note of every place the UI was confusing, slow, broken, or surprising for a first-time user, with what you expected and what happened. Do not fix anything — record it. A from-scratch pass by someone who knows the feature set is the closest thing to a usability study this project has had, and the friction list is worth more than the grid.

- [ ] **Step 6: Verify by reading it back**

Run `node --env-file=.env server/scripts/checkGrid.js` (or the documented equivalent) scoped to the new grid.
Expected: **0 integrity errors.** If the grid a person can build by clicking has integrity errors, that is a finding — report it rather than repairing it by hand.

- [ ] **Step 7: Capture it**

Screenshot the finished grid at 1440x900 and 390x844, and **look at both**. These are also candidates for Task 9's promo captures — a grid with no personal data in it is exactly what a marketing screenshot needs, which is a reason to prefer it over `test grid 2`.

- [ ] **Step 8: Report**

Deliver to the user: the credentials, the grid name, what was built and why, the capability coverage table with each row ticked or explained, the friction list from Step 5, the integrity result, and the screenshots.

Do NOT commit the credentials to the repository.

---

## Deviations from the spec, stated rather than buried

**The mobile nav does NOT go through `MenuSurface`.** The spec says *"`MenuSurface` owns floating menus (drawer on mobile). A nav dropdown must go through it."* Measured: `MenuSurface` imports only React and `createPortal`, so using it would not have broken promo isolation — the reason is behavioural, not structural. Its mobile presentation is a sheet pinned to the **bottom** edge, which is right for a menu opened by a thumb somewhere in a grid and wrong for a nav opened from a sticky header at the **top** of the page: the links would fly to the opposite end of the screen from the control that opened them. The promo nav is therefore a full-width disclosure that opens directly beneath the header bar it belongs to.

The rule the spec was protecting still holds inside the app, where every floating menu is still `MenuSurface`'s. If a later promo surface needs a genuine anchored floating menu, use `MenuSurface` for it.

## Open items deliberately NOT in this plan

- **Analytics.** Nothing measures whether the landing page converts. Adding a third-party script is a privacy decision and a new external dependency; it needs the user's call.
- **A public signup gate.** Registration is open today and this plan advertises it. If the user later wants invite-only, the CTA copy in `LandingPage.jsx` and `LoginRoute.jsx` must change with it, or the page will promise something the server refuses.
- **Following the app's five themes.** Explicitly rejected — the user chose dark cinematic, and `promo.css` commits to one palette and says so.
- **An `/about` page.** `PROMO_PATHS` reserves the path so a later session can add it without touching `main.jsx`, but no route renders it yet; until one does, `/about` falls to the 404 page, which is correct.
