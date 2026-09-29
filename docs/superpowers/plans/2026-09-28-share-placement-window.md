# Share Placement Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clipping something from the browser (or sharing from a phone) can open a window where you choose the grid, and either let the share rules run or place the thing yourself — picking a destination, a shape, and field values — before anything is written.

**Architecture:** The window is a Moduli page (`/share-place`), not extension HTML, so it reuses the app's session, `FieldSelect` and `OptionSearchList`. The clip reaches it through a short-lived *stage* on the server, addressed by a one-time key. A manual placement is written by building a synthetic one-step `CREATE` pipeline and running it through `runOperationServerSide` — the same writer the share rules already use — so there is exactly one definition of what a clip becomes.

**Tech Stack:** Express + Mongoose (server), React 18 + Vite (client), vitest everywhere, Playwright for the end-to-end check. MV3 WebExtension (Firefox) for the companion.

**Spec:** `docs/superpowers/specs/2026-09-28-share-placement-window-design.md`

## Global Constraints

- **One definition of what a clip becomes.** The manual path builds a `CREATE` step and calls `runOperationServerSide`; it must not mint occurrences itself. (Spec §7.)
- **Nothing is written until Clip is pressed.** Staging writes no grid data.
- **The stage key authorizes exactly two calls on exactly one payload** — read it and commit it — for 10 minutes, and the commit consumes it. It cannot read a grid, list occurrences, or write anything else. (Spec §6.)
- **Every field picker is `ui/FieldSelect`.** `client/src/__tests__/fieldSelectEverywhere.test.js` walks for native `<select>`s over a field list and will fail a new one.
- **Kind labels come from `QuickAddMenu.KIND_TILE`**, never retyped.
- **A value edited in the window applies to that clip only** and never mutates the preset it came from.
- **Server code changes require `./deploy.sh` with a restart**; client-only changes must not restart (the script decides — do not force it).
- Existing suites must stay green: `cd server && ./node_modules/.bin/vitest run` (2,784) and `cd client && ./node_modules/.bin/vitest run` (5,245 — the single `accountBalances` timeout in a full run is pre-existing and passes alone).

## File Structure

| file | responsibility |
|---|---|
| `client/src/helpers/shareMapping.js` **(new)** | Pure. The source table, the transform table, and `resolveMappings`. No React, no fetch. |
| `client/src/helpers/sharePlacement.js` **(new)** | Pure. Turn form state into the `placement` payload `/share` accepts; derive a shape from a destination's rows. |
| `client/src/ui/SharePlace.jsx` **(new)** | The window. Mode radios, grid picker, the three panes. Owns fetches and form state, delegates every decision to the two helpers. |
| `client/src/main.jsx:63` | Add `/share-place` to the share-path array. |
| `server/models/ShareStage.js` **(new)** | The staged payload + its key, with a TTL index. |
| `server/services/shareStage.js` **(new)** | `createStage` / `readStage` / `consumeStage`. All key checking lives here. |
| `server/services/manualPlacement.js` **(new)** | Build the synthetic `CREATE` op and run it through `runOperationServerSide`. |
| `server/services/destinationSearch.js` **(new)** | Label search over containers and pages, with crumbs. |
| `server/routes/apiV1.js` | Mount `/share/stage`, `/share/stage/:id`, `/share/stage/:id/preview`, `/destinations`; teach `/share` `mode: "manual"`. |
| `extension/background.js` | Second context-menu item; stage-then-open-window. |
| `extension/clip.js` | The second menu id per context. |
| `client/src/ui/SharePending.jsx` | Stage and redirect to the window instead of posting straight to `/share`. |

---

### Task 1: The mapping helper — sources, transforms, resolution

**Files:**
- Create: `client/src/helpers/shareMapping.js`
- Test: `client/src/__tests__/shareMapping.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SHARE_SOURCES: Array<{value,label,read(clip)}>`, `SHARE_TRANSFORMS: Array<{value,label,apply(string)=>string}>`, `resolveMapping(clip, mapping) => string`, `resolveMappings(clip, mappings) => Record<fieldId,string>`. A `mapping` is `{ source: string, transform?: string, value?: string, override?: string }`.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/shareMapping.test.js
//
// The failure this guards: a mapping that silently resolves to empty. The
// window shows every resolved value in an editable box precisely because that
// failure is invisible otherwise — these tests are the same claim, offline.
import { describe, it, expect } from "vitest";
import { SHARE_SOURCES, SHARE_TRANSFORMS, resolveMapping, resolveMappings } from "../helpers/shareMapping";

// The real clip the feature was designed against (spec §1).
const CLIP = {
  title: "A Guide to Recognizing Your Saints (2006) IMDb",
  url: "https://www.imdb.com/title/tt0473488/",
  linkUrl: "https://www.imdb.com/title/tt0473488/",
  selection: "",
  imageUrl: "https://m.media-amazon.com/images/M/poster.jpg",
  siteName: "IMDb",
  description: "A coming-of-age story set in Astoria, Queens.",
};

describe("sources", () => {
  it("reads every declared source off a clip without throwing", () => {
    for (const s of SHARE_SOURCES) expect(() => s.read(CLIP)).not.toThrow();
  });

  it("returns an empty string for a source the clip does not carry", () => {
    // Not undefined: the box is a controlled input, and undefined makes React
    // flip it to uncontrolled mid-edit.
    const sel = SHARE_SOURCES.find((s) => s.value === "selection");
    expect(sel.read(CLIP)).toBe("");
    expect(sel.read({})).toBe("");
  });

  it("offers today's date as an ISO day", () => {
    const today = SHARE_SOURCES.find((s) => s.value === "today");
    expect(today.read(CLIP)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("transforms", () => {
  const apply = (v, input) => SHARE_TRANSFORMS.find((t) => t.value === v).apply(input);

  it("extracts a year", () => {
    expect(apply("year", CLIP.title)).toBe("2006");
  });

  it("returns an empty string when there is no year, rather than the input", () => {
    // A transform that silently passes the input through would write
    // "A Guide to Recognizing Your Saints" into a Year field.
    expect(apply("year", "A Guide to Recognizing Your Saints")).toBe("");
  });

  it("takes the FIRST year when a title carries two", () => {
    expect(apply("year", "Blade Runner (1982) vs 2049 (2017)")).toBe("1982");
  });

  it("strips a trailing site suffix", () => {
    expect(apply("stripSuffix", "A Guide to Recognizing Your Saints (2006) IMDb"))
      .toBe("A Guide to Recognizing Your Saints (2006)");
    expect(apply("stripSuffix", "Some Page – Wikipedia")).toBe("Some Page");
    expect(apply("stripSuffix", "Some Page | IMDb")).toBe("Some Page");
  });

  it("leaves a title with no suffix alone", () => {
    expect(apply("stripSuffix", "A Guide to Recognizing Your Saints")).toBe("A Guide to Recognizing Your Saints");
  });

  it("takes the text inside parentheses", () => {
    expect(apply("parens", "Movie Night (2006)")).toBe("2006");
    expect(apply("parens", "no parens here")).toBe("");
  });

  it("extracts a number, including a decimal", () => {
    expect(apply("number", "42.7 GB")).toBe("42.7");
    expect(apply("number", "no digits")).toBe("");
  });

  it("trims and lowercases", () => {
    expect(apply("trim", "  spaced  ")).toBe("spaced");
    expect(apply("lower", "IMDb")).toBe("imdb");
  });

  it("every transform survives an empty input", () => {
    for (const t of SHARE_TRANSFORMS) expect(t.apply("")).toBe("");
  });
});

describe("resolveMapping", () => {
  it("applies the source then the transform", () => {
    expect(resolveMapping(CLIP, { source: "title", transform: "year" })).toBe("2006");
  });

  it("a literal source returns its own value, untransformed by default", () => {
    expect(resolveMapping(CLIP, { source: "literal", value: "movie" })).toBe("movie");
  });

  it("an override wins over everything — the edited box", () => {
    expect(resolveMapping(CLIP, { source: "title", transform: "year", override: "1999" })).toBe("1999");
  });

  it("an empty-string override is respected, not treated as absent", () => {
    // Clearing the box means "write nothing here", and must not silently
    // re-resolve the source.
    expect(resolveMapping(CLIP, { source: "title", override: "" })).toBe("");
  });

  it("an unknown source or transform resolves to empty rather than throwing", () => {
    expect(resolveMapping(CLIP, { source: "nope" })).toBe("");
    expect(resolveMapping(CLIP, { source: "title", transform: "nope" })).toBe(CLIP.title);
  });

  it("source 'none' is empty — the unmapped row", () => {
    expect(resolveMapping(CLIP, { source: "none" })).toBe("");
  });
});

describe("resolveMappings", () => {
  it("resolves a whole table and DROPS the empty ones", () => {
    // An empty value must not be written: CREATE skips empties anyway, and a
    // row of "" in the payload reads as an intended blank.
    const out = resolveMappings(CLIP, {
      "f-title": { source: "title", transform: "stripSuffix" },
      "f-year": { source: "title", transform: "year" },
      "f-rating": { source: "none" },
    });
    expect(out).toEqual({
      "f-title": "A Guide to Recognizing Your Saints (2006)",
      "f-year": "2006",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/shareMapping.test.js`
Expected: FAIL — `Failed to resolve import "../helpers/shareMapping"`.

- [ ] **Step 3: Write the implementation**

```js
// client/src/helpers/shareMapping.js
//
// WHAT A CLIPPED THING BECOMES, one field at a time.
//
// Two tables and one resolver, all pure. The window shows the RESOLVED VALUE
// of every row in an editable box, because a mapping that quietly resolves to
// empty is this screen's whole failure mode — the user's own example is IMDb's
// page title, "A Guide to Recognizing Your Saints (2006) IMDb", which is
// nobody's idea of a movie title.
//
// Resolution is CLIENT-ONLY on purpose. The window sends the server the values
// it displayed, so what you saw is what gets written; a second resolver on the
// server could disagree with the box in front of you.

const str = (v) => (v == null ? "" : String(v));

/** Where a value can come from. `read` must never throw and never return undefined. */
export const SHARE_SOURCES = [
  { value: "none",        label: "—",                read: () => "" },
  { value: "title",       label: "page title",       read: (c) => str(c?.title) },
  { value: "url",         label: "page URL",         read: (c) => str(c?.url) },
  { value: "linkUrl",     label: "link URL",         read: (c) => str(c?.linkUrl || c?.url) },
  { value: "selection",   label: "selected text",    read: (c) => str(c?.selection || c?.text) },
  { value: "imageUrl",    label: "image source",     read: (c) => str(c?.imageUrl) },
  { value: "siteName",    label: "site name",        read: (c) => str(c?.siteName) },
  { value: "description", label: "description",      read: (c) => str(c?.description) },
  { value: "today",       label: "today's date",     read: () => new Date().toLocaleDateString("en-CA") },
  { value: "literal",     label: "a literal",        read: (_c, m) => str(m?.value) },
];

// A SITE SUFFIX, as the three separators real titles use. Anchored at the end
// and requiring the separator, so "Star Wars: A New Hope" keeps its colon.
const SUFFIX = /\s*[|–—-]\s*[^|–—-]{1,40}$|\s+IMDb$/;

/** What can be done to a value. A small fixed set — anything else, edit the box. */
export const SHARE_TRANSFORMS = [
  { value: "none",        label: "—",                  apply: (s) => s },
  { value: "trim",        label: "trim",               apply: (s) => s.trim() },
  { value: "stripSuffix", label: "strip site suffix",  apply: (s) => s.replace(SUFFIX, "").trim() },
  // EMPTY, NOT THE INPUT, when there is no match: passing the input through
  // would write a film's title into its Year field.
  { value: "year",        label: "extract year",       apply: (s) => (s.match(/\b(1[89]\d{2}|20\d{2})\b/) || [""])[0] },
  { value: "number",      label: "extract number",     apply: (s) => (s.match(/-?\d+(?:\.\d+)?/) || [""])[0] },
  { value: "parens",      label: "text in parentheses", apply: (s) => (s.match(/\(([^)]*)\)/) || ["", ""])[1] },
  { value: "lower",       label: "lowercase",          apply: (s) => s.toLowerCase() },
];

const sourceBy = new Map(SHARE_SOURCES.map((s) => [s.value, s]));
const transformBy = new Map(SHARE_TRANSFORMS.map((t) => [t.value, t]));

/**
 * @param {object} clip   the staged clip
 * @param {{source:string, transform?:string, value?:string, override?:string}} mapping
 * @returns {string} what will be written — never undefined
 */
export function resolveMapping(clip, mapping = {}) {
  // THE EDITED BOX WINS, and an empty edit means empty. `!= null` rather than
  // truthiness: clearing the box is a deliberate "write nothing".
  if (mapping.override != null) return str(mapping.override);
  const src = sourceBy.get(mapping.source);
  if (!src) return "";
  const raw = str(src.read(clip, mapping));
  const tf = transformBy.get(mapping.transform || "none");
  return tf ? str(tf.apply(raw)) : raw;
}

/** The whole table. Empty results are DROPPED — an empty value is not a value. */
export function resolveMappings(clip, mappings = {}) {
  const out = {};
  for (const [fieldId, mapping] of Object.entries(mappings)) {
    const v = resolveMapping(clip, mapping);
    if (v !== "") out[fieldId] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/shareMapping.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/shareMapping.js client/src/__tests__/shareMapping.test.js
git commit -m "feat(client): the share mapping table — sources, transforms, resolution"
```

---

### Task 2: The stage — model and service

**Files:**
- Create: `server/models/ShareStage.js`, `server/services/shareStage.js`
- Test: `server/__tests__/shareStage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createStage({ userId, payload }) => Promise<{ stageId, key }>`, `readStage(stageId, key) => Promise<payload|null>`, `consumeStage(stageId, key) => Promise<payload|null>`, `STAGE_TTL_MS = 600000`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareStage.test.js
//
// The stage holds a clip for the ten minutes between clipping it and placing
// it. Its KEY is the authorization — the placement window may be open in a
// browser that is not signed in — so the cases that matter are the refusals.
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows = [];
vi.mock("../models/ShareStage.js", () => ({ default: {
  create: async (doc) => { rows.push({ ...doc }); return doc; },
  findOne: (q) => ({ lean: async () => rows.find((r) => r.id === q.id) || null }),
  updateOne: async (q, u) => {
    const r = rows.find((x) => x.id === q.id);
    if (r && u.$set) Object.assign(r, u.$set);
    return { modifiedCount: r ? 1 : 0 };
  },
}}));

const { createStage, readStage, consumeStage, STAGE_TTL_MS } = await import("../services/shareStage.js");

beforeEach(() => { rows = []; });

describe("createStage", () => {
  it("returns an id and a key, and stores neither in plain sight of the other", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(stageId).toBeTruthy();
    expect(key).toBeTruthy();
    expect(key).not.toBe(stageId);
    expect(key.length).toBeGreaterThanOrEqual(32);
  });

  it("writes an expiry ten minutes out", async () => {
    const before = Date.now();
    await createStage({ userId: "u1", payload: {} });
    const exp = rows[0].expiresAt.getTime();
    expect(exp).toBeGreaterThanOrEqual(before + STAGE_TTL_MS - 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + STAGE_TTL_MS + 1000);
  });
});

describe("readStage", () => {
  it("returns the payload for the right key", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await readStage(stageId, key)).toMatchObject({ url: "https://x" });
  });

  it("refuses a WRONG key — the case that matters, since the key IS the auth", async () => {
    const { stageId } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await readStage(stageId, "not-the-key")).toBeNull();
    expect(await readStage(stageId, "")).toBeNull();
    expect(await readStage(stageId, undefined)).toBeNull();
  });

  it("refuses an unknown stage", async () => {
    expect(await readStage("nope", "k")).toBeNull();
  });

  it("refuses an EXPIRED stage even with the right key", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: {} });
    rows[0].expiresAt = new Date(Date.now() - 1);
    expect(await readStage(stageId, key)).toBeNull();
  });

  it("does NOT consume — the window reads before you have decided anything", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    await readStage(stageId, key);
    expect(await readStage(stageId, key)).toMatchObject({ url: "https://x" });
  });
});

describe("consumeStage", () => {
  it("returns the payload once and never again", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await consumeStage(stageId, key)).toMatchObject({ url: "https://x" });
    expect(await consumeStage(stageId, key)).toBeNull();
    // And a read after the commit is refused too — the window is done.
    expect(await readStage(stageId, key)).toBeNull();
  });

  it("refuses a wrong key without consuming", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await consumeStage(stageId, "wrong")).toBeNull();
    expect(await consumeStage(stageId, key)).toMatchObject({ url: "https://x" });
  });

  it("carries the userId, so the caller writes as the right person", async () => {
    const { stageId, key } = await createStage({ userId: "u7", payload: { url: "https://x" } });
    const { payload, userId } = await consumeStage(stageId, key, { withUser: true });
    expect(userId).toBe("u7");
    expect(payload).toMatchObject({ url: "https://x" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/shareStage.test.js`
Expected: FAIL — cannot resolve `../services/shareStage.js`.

- [ ] **Step 3: Write the model**

```js
// server/models/ShareStage.js
//
// A clip, parked for the ten minutes between clipping it and placing it.
// It holds NO grid data and writes none: staging is what lets the placement
// window exist without a half-made row appearing the moment you open it.
import mongoose from "mongoose";

const ShareStageSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true, index: true },
  userId:    { type: String, required: true, index: true },
  // The authorization. 32 random bytes, hex. Compared in constant time.
  key:       { type: String, required: true },
  payload:   { type: mongoose.Schema.Types.Mixed, required: true },
  consumedAt:{ type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

// Mongo drops the row itself once it expires; `readStage` ALSO checks the date,
// because the TTL monitor runs about once a minute and "roughly expired" is not
// a property a credential should have.
ShareStageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.ShareStage || mongoose.model("ShareStage", ShareStageSchema);
```

- [ ] **Step 4: Write the service**

```js
// server/services/shareStage.js
//
// Create, read and consume a staged share. EVERY key check lives here — one
// place to read when asking "what can this URL parameter actually do".
//
// What the key authorizes: reading ONE staged payload and committing it. Not
// reading a grid, not listing occurrences, not writing anything else. It dies
// on the commit or at ten minutes, whichever comes first.
import crypto from "node:crypto";
import ShareStage from "../models/ShareStage.js";

export const STAGE_TTL_MS = 10 * 60 * 1000;

const newId = () => crypto.randomUUID();
const newKey = () => crypto.randomBytes(32).toString("hex");

// Constant-time, and length-safe: timingSafeEqual throws on a length mismatch.
function keyMatches(stored, given) {
  const a = Buffer.from(String(stored || ""), "utf8");
  const b = Buffer.from(String(given || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

const live = (row) => !!row && !row.consumedAt && row.expiresAt?.getTime() > Date.now();

export async function createStage({ userId, payload }) {
  const stageId = newId();
  const key = newKey();
  await ShareStage.create({
    id: stageId, userId, key, payload,
    createdAt: new Date(), expiresAt: new Date(Date.now() + STAGE_TTL_MS),
  });
  return { stageId, key };
}

/** The payload, or null. Does NOT consume — the window reads before deciding. */
export async function readStage(stageId, key, { withUser = false } = {}) {
  const row = await ShareStage.findOne({ id: stageId }).lean();
  if (!live(row) || !keyMatches(row.key, key)) return null;
  return withUser ? { payload: row.payload, userId: row.userId } : row.payload;
}

/** The payload, once. The commit is what spends the key. */
export async function consumeStage(stageId, key, { withUser = false } = {}) {
  const row = await ShareStage.findOne({ id: stageId }).lean();
  if (!live(row) || !keyMatches(row.key, key)) return null;
  await ShareStage.updateOne({ id: stageId }, { $set: { consumedAt: new Date() } });
  return withUser ? { payload: row.payload, userId: row.userId } : row.payload;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/shareStage.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add server/models/ShareStage.js server/services/shareStage.js server/__tests__/shareStage.test.js
git commit -m "feat(server): stage a share for ten minutes, addressed by a one-time key"
```

---

### Task 3: Stage endpoints

**Files:**
- Modify: `server/routes/apiV1.js` (add routes beside `POST /share`, around line 1252)
- Test: `server/__tests__/apiShareStage.test.js`

**Interfaces:**
- Consumes: `createStage`, `readStage` from Task 2.
- Produces: `POST /api/v1/share/stage` → `201 { stageId, key, expiresInMs }`; `GET /api/v1/share/stage/:id?k=<key>` → `200 { payload }` or `404`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/apiShareStage.test.js
//
// Staging over the real router. The point of these two routes is that the
// FIRST needs a token and the SECOND deliberately does not — the window may be
// open in a browser with no Moduli session, and the key is what stands in.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
const staged = [];
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async ({ userId, payload }) => {
    staged.push({ userId, payload });
    return { stageId: "stage-1", key: "key-1" };
  },
  readStage: async (id, key) => (id === "stage-1" && key === "key-1" ? { url: "https://x", title: "T" } : null),
  consumeStage: async () => null,
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}`,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());

const post = (path, body, token) => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe("POST /share/stage", () => {
  it("stages a clip and hands back an id and a key", async () => {
    const r = await post("/share/stage", { url: "https://x", title: "T" }, "good-token");
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b).toMatchObject({ stageId: "stage-1", key: "key-1" });
    expect(b.expiresInMs).toBe(600000);
    expect(staged.at(-1).userId).toBe("u1");
  });

  it("refuses without a token — staging is an authenticated act", async () => {
    expect((await post("/share/stage", { url: "https://x" })).status).toBe(401);
  });

  it("refuses an empty share", async () => {
    // Same rule /share has: something must be being shared.
    expect((await post("/share/stage", {}, "good-token")).status).toBe(400);
  });
});

describe("GET /share/stage/:id", () => {
  it("returns the payload for the right key, with NO token", async () => {
    const r = await fetch(`${base}/share/stage/stage-1?k=key-1`);
    expect(r.status).toBe(200);
    expect((await r.json()).payload).toMatchObject({ url: "https://x" });
  });

  it("404s on a wrong key", async () => {
    expect((await fetch(`${base}/share/stage/stage-1?k=nope`)).status).toBe(404);
  });

  it("404s with no key at all", async () => {
    expect((await fetch(`${base}/share/stage/stage-1`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiShareStage.test.js`
Expected: FAIL — 404 from express on `/share/stage` (route not mounted).

- [ ] **Step 3: Add the routes**

Insert immediately **before** `router.post("/share", …)` in `server/routes/apiV1.js`:

```js
  // ── Staging a share (2026-09-28 placement window, spec §3) ─────────────
  // A clip is parked here BEFORE the placement window opens, for two reasons:
  // a long selection plus an og:image URL does not reliably fit in a URL, and
  // nothing may be written to the grid until the user presses Clip.
  router.post("/share/stage", authAndLimit({ requireScope: "write", allowSessionJwt: true }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.url && !body.text && !body.clip) {
        return err(res, 400, "validation_error", "url, text or clip required");
      }
      const { createStage, STAGE_TTL_MS } = await import("../services/shareStage.js");
      const { stageId, key } = await createStage({ userId: req.userId, payload: body });
      res.status(201).json({ stageId, key, expiresInMs: STAGE_TTL_MS });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // DELIBERATELY UNAUTHENTICATED. The key in `?k=` is the authorization: the
  // placement window can be open in a browser with no Moduli session, and a
  // login screen between clipping a thing and placing it is the friction this
  // feature exists to remove. The key reaches exactly one staged payload.
  router.get("/share/stage/:id", async (req, res) => {
    try {
      const { readStage } = await import("../services/shareStage.js");
      const payload = await readStage(req.params.id, req.query.k);
      if (!payload) return err(res, 404, "not_found", "no such stage");
      res.json({ payload });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiShareStage.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole server suite**

Run: `cd server && ./node_modules/.bin/vitest run`
Expected: 2,784+ pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add server/routes/apiV1.js server/__tests__/apiShareStage.test.js
git commit -m "feat(server): POST /share/stage and GET /share/stage/:id"
```

---

### Task 4: Destination search

**Files:**
- Create: `server/services/destinationSearch.js`
- Modify: `server/routes/apiV1.js`
- Test: `server/__tests__/destinationSearch.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `searchDestinations({ userId, gridId, q, limit }) => Promise<Array<{id,label,crumb,role,kind,childCount}>>`; `GET /api/v1/destinations?gridId=&q=&limit=`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/destinationSearch.test.js
//
// "Where does this go?" over a grid with 22,000 occurrences. The existing
// GET /occurrences cannot answer it: no label search, and Occurrence.find()
// loads every row for the grid before paginating.
//
// The query direction is the whole design: match MODULE labels first (there
// are far fewer, and the label lives there), then find the occurrences that
// point at them.
import { describe, it, expect, vi, beforeEach } from "vitest";

let modules = [], occurrences = [];
const findChain = (rows) => ({
  sort: () => findChain(rows), limit: () => findChain(rows), lean: async () => rows,
});
vi.mock("../models/Module.js", () => ({ default: {
  find: (q) => {
    const rx = q.label?.$regex;
    const roles = q.role?.$in || [];
    return findChain(modules.filter((m) =>
      roles.includes(m.role) && (!rx || new RegExp(rx, q.label.$options).test(m.label))));
  },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  find: (q) => {
    // Two shapes: by module (the hits) and by id (the crumb walk, one level
    // at a time). A mock that ignored the second would hide a full-grid scan.
    if (q.id?.$in) return findChain(occurrences.filter((o) => q.id.$in.includes(o.id)));
    const ids = q.moduleId?.$in || null;
    return findChain(occurrences.filter((o) => (!ids || ids.includes(o.moduleId))));
  },
}}));

const { searchDestinations } = await import("../services/destinationSearch.js");

const mod = (id, label, role = "container", kind = "board") => ({ id, label, role, kind, gridId: "g1", userId: "u1" });
const occ = (id, moduleId, parentId = null, children = []) =>
  ({ id, moduleId, parentId, occurrences: children, gridId: "g1", userId: "u1" });

beforeEach(() => {
  modules = [
    mod("m-movies", "Movies"), mod("m-media", "Media", "page", "board"),
    mod("m-boards", "Boards", "page", "folder"), mod("m-books", "Books"),
    mod("m-row", "Brightburn", "artifact", "movie"),
  ];
  occurrences = [
    occ("o-boards", "m-boards"),
    occ("o-media", "m-media", "o-boards"),
    occ("o-movies", "m-movies", "o-media", ["o-row1", "o-row2"]),
    occ("o-books", "m-books", "o-media"),
    occ("o-row1", "m-row", "o-movies"),
  ];
});

describe("searchDestinations", () => {
  it("finds a container by label", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "mov" });
    expect(out.map((d) => d.label)).toContain("Movies");
  });

  it("carries a crumb so two same-named containers can be told apart", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].crumb).toBe("Boards › Media");
  });

  it("reports the child count — 'like its 993 rows' needs a number", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].childCount).toBe(2);
  });

  it("offers PAGES as well as containers", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "media" });
    expect(out.map((d) => d.role)).toContain("page");
  });

  it("never offers a leaf row as a destination", async () => {
    // "Brightburn" is an artifact/movie — a thing you place, not a place.
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "bright" });
    expect(out).toEqual([]);
  });

  it("an empty query returns the destinations anyway, so the list opens populated", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("honours the cap", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "", limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("never runs an UNSCOPED occurrence query — the reason this endpoint exists", async () => {
    // The first draft of this service resolved crumbs by loading every
    // occurrence on the grid, which is precisely the cost GET /occurrences
    // already pays. Every query must be scoped by module or by id.
    const seen = [];
    const Occurrence = (await import("../models/Occurrence.js")).default;
    const real = Occurrence.find;
    Occurrence.find = (q) => { seen.push(q); return real(q); };
    await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    Occurrence.find = real;
    for (const q of seen) expect(Boolean(q.moduleId?.$in || q.id?.$in)).toBe(true);
  });

  it("escapes a regex-special query instead of throwing", async () => {
    // A user typing "(" must not 500 the endpoint.
    await expect(searchDestinations({ userId: "u1", gridId: "g1", q: "(" })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/destinationSearch.test.js`
Expected: FAIL — cannot resolve `../services/destinationSearch.js`.

- [ ] **Step 3: Write the service**

```js
// server/services/destinationSearch.js
//
// "Where does this go?" — the searchable list behind the placement window.
//
// WHY THIS EXISTS RATHER THAN `GET /occurrences`: that endpoint has no label
// search and runs `Occurrence.find(filter)` before paginating, which on poms
// grid means loading 22,000 rows to answer a type-ahead.
//
// The query direction is what makes it fast: a label lives on the MODULE, and
// there are far fewer modules than occurrences, so match those first and then
// fetch only the occurrences that point at them.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const DEST_ROLES = ["container", "page"];
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CRUMB_DEPTH = 4;

export async function searchDestinations({ userId, gridId, q = "", limit = 50 }) {
  const query = { userId, gridId, role: { $in: DEST_ROLES } };
  if (q) query.label = { $regex: escapeRx(q), $options: "i" };
  const mods = await Module.find(query).sort({ label: 1 }).limit(limit * 2).lean();
  if (!mods.length) return [];

  const byId = new Map(mods.map((m) => [m.id, m]));
  const occs = await Occurrence.find({ userId, gridId, moduleId: { $in: [...byId.keys()] } })
    .limit(limit * 4).lean();

  const hits = occs.slice(0, limit);

  // CRUMBS, WITHOUT LOADING THE GRID. Walk up one LEVEL at a time with an
  // `$in` over just the parents actually reached — at most CRUMB_DEPTH small
  // queries. Fetching every occurrence to resolve ancestor labels would
  // reintroduce exactly the cost this endpoint exists to avoid.
  const occById = new Map();
  let frontier = [...new Set(hits.map((o) => o.parentId).filter(Boolean))];
  for (let depth = 0; depth < CRUMB_DEPTH && frontier.length; depth++) {
    const rows = await Occurrence.find({ userId, gridId, id: { $in: frontier } })
      .limit(frontier.length).lean();
    for (const r of rows) occById.set(r.id, r);
    frontier = [...new Set(rows.map((r) => r.parentId).filter((id) => id && !occById.has(id)))];
  }

  // One more module lookup for the ancestors, which the label search did not
  // match and therefore did not fetch.
  const ancestorModIds = [...new Set([...occById.values()].map((o) => o.moduleId).filter((id) => id && !byId.has(id)))];
  if (ancestorModIds.length) {
    const more = await Module.find({ userId, gridId, id: { $in: ancestorModIds } }).lean();
    for (const m of more) byId.set(m.id, m);
  }
  const labelOf = (occ) => (occ ? byId.get(occ.moduleId)?.label || null : null);

  const out = [];
  for (const o of hits) {
    const m = byId.get(o.moduleId);
    if (!m) continue;
    const crumbs = [];
    let cur = occById.get(o.parentId);
    for (let i = 0; i < CRUMB_DEPTH && cur; i++) {
      const l = labelOf(cur);
      if (l) crumbs.unshift(l);
      cur = occById.get(cur.parentId);
    }
    out.push({
      id: o.id, label: m.label || "(untitled)", crumb: crumbs.join(" › "),
      role: m.role, kind: m.kind || null, childCount: (o.occurrences || []).length,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/destinationSearch.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mount the route**

Add after the `GET /share/stage/:id` route in `server/routes/apiV1.js`:

```js
  // The searchable destination list behind the placement window.
  router.get("/destinations", authAndLimit({ requireScope: "read", allowSessionJwt: true }), async (req, res) => {
    try {
      const { gridId, q, limit } = req.query;
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      const owned = await Grid.exists({ _id: gridId, userId: req.userId }).catch(() => null);
      if (!owned) return err(res, 404, "not_found", `grid ${gridId} not found`);
      const { searchDestinations } = await import("../services/destinationSearch.js");
      const destinations = await searchDestinations({
        userId: req.userId, gridId, q: q || "",
        limit: Math.min(Number(limit) || 50, 100),
      });
      res.json({ destinations });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
```

- [ ] **Step 6: Measure it against the real grid before believing it**

```bash
cd server && cat > _destperf.mjs <<'EOF'
import mongoose from "mongoose";
await mongoose.connect(process.env.MONGO_URI);
const { searchDestinations } = await import("./services/destinationSearch.js");
const g = await mongoose.connection.db.collection("grids").findOne({ name: "poms grid" });
for (const q of ["", "movie", "book", "("]) {
  const t = Date.now();
  const out = await searchDestinations({ userId: String(g.userId), gridId: String(g._id), q });
  console.log(`q=${JSON.stringify(q).padEnd(9)} ${out.length} results in ${Date.now() - t}ms  ${out[0] ? `${out[0].crumb} › ${out[0].label} (${out[0].childCount})` : ""}`);
}
await mongoose.disconnect();
EOF
MONGO_URI="$(grep -m1 '^MONGO_URI=' .env | cut -d= -f2-)" node _destperf.mjs
```

Expected: every query returns in well under a second, `movie` finds `Boards › Media › Movies (993)`, and `(` returns without throwing. **If a query takes longer than ~1s, stop and fix the query direction before moving on** — a type-ahead that lags is the feature failing, not a polish item.

- [ ] **Step 7: Commit**

```bash
git add server/services/destinationSearch.js server/routes/apiV1.js server/__tests__/destinationSearch.test.js
git commit -m "feat(server): GET /destinations — searchable containers and pages with crumbs"
```

---

### Task 5: Manual placement — the writer

**Files:**
- Create: `server/services/manualPlacement.js`
- Test: `server/__tests__/manualPlacement.test.js`

**Interfaces:**
- Consumes: `runOperationServerSide` from `services/serverExecutor.js`.
- Produces: `placeManually({ share, placement, userId, gridId, io, mirror }) => Promise<{ ran: [...], halted: true }>` — the same shape `runShareRules` returns, so `/share` and the share log need no special case. `placement` is `{ parentId, role, kind, bindingsLike?, fields: Record<fieldId,string>, bindFields?: string[], label? }`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/manualPlacement.test.js
//
// A hand-placed clip is written by the SAME writer the share rules use — a
// synthetic one-step CREATE handed to runOperationServerSide. This is the
// spec's §7 constraint expressed as a test: if a future edit starts minting
// occurrences here instead, "calls the shared executor" fails.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runs = [];
// `failNext` is how the failure case is driven. A test that cannot make the
// executor fail cannot claim the failure is reported — this repo has recorded
// three green tests that were measuring nothing.
let failNext = null;
vi.mock("../services/serverExecutor.js", () => ({
  runOperationServerSide: async (op, opts) => {
    runs.push({ op, opts });
    if (failNext) { const f = failNext; failNext = null; return f; }
    return { ok: true, effects: [{ _effect: "CREATE", occurrenceId: "new-1", status: "created" }], scope: {}, unsupported: [] };
  },
}));

const { placeManually } = await import("../services/manualPlacement.js");

const SHARE = { type: "link", label: "A Guide…", externalId: "link:https://imdb/x", props: { url: "https://imdb/x" } };
const PLACEMENT = {
  parentId: "0cti4si13ijy", role: "artifact", kind: "movie",
  bindingsLike: "m-movie-row",
  fields: { "f-year": "2006", "f-cat": "movie" },
};

beforeEach(() => { runs.length = 0; failNext = null; });

describe("placeManually", () => {
  it("calls the shared executor rather than minting anything itself", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs).toHaveLength(1);
  });

  it("builds ONE create step carrying the placement", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    const steps = runs[0].op.pipeline.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].config).toMatchObject({
      type: "CREATE",
      parentId: "0cti4si13ijy",
      role: "artifact",
      kind: "movie",
      bindingsLike: "m-movie-row",
    });
  });

  it("passes field VALUES as literals, so no $var in a clipped title is resolved", async () => {
    // A page title containing "$today" must be written verbatim.
    await placeManually({
      share: SHARE, userId: "u1", gridId: "g1",
      placement: { ...PLACEMENT, fields: { "f-title": "$today and $allItems" } },
    });
    expect(runs[0].op.pipeline.steps[0].config.fields["f-title"]).toBe("literal:$today and $allItems");
  });

  it("keeps the share's externalId, so re-clipping the same link updates one row", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].op.pipeline.steps[0].config.externalId).toBe("link:https://imdb/x");
  });

  it("gives $share to the executor, so a placement can still reference it", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].opts.vars.$share).toMatchObject({ type: "link" });
  });

  it("returns the runShareRules shape, halted, so /share needs no special case", async () => {
    const out = await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(out.halted).toBe(true);
    expect(out.ran).toHaveLength(1);
    expect(out.ran[0]).toMatchObject({ ruleName: "Placed by hand", ok: true });
    expect(out.ran[0].created[0]).toMatchObject({ occurrenceId: "new-1" });
  });

  it("falls back to the share's label when the placement names none", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].op.pipeline.steps[0].config.label).toBe("literal:A Guide…");
  });

  it("refuses a placement with no parent — an unplaced manual placement is a contradiction", async () => {
    await expect(placeManually({
      share: SHARE, userId: "u1", gridId: "g1",
      placement: { ...PLACEMENT, parentId: null },
    })).rejects.toThrow(/parentId/);
  });

  it("reports an executor failure rather than swallowing it", async () => {
    failNext = { ok: false, error: { message: "boom" }, effects: [], unsupported: [] };
    const out = await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(out.ran[0].ok).toBe(false);
    expect(out.ran[0].error).toMatchObject({ message: "boom" });
    expect(out.ran[0].created).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/manualPlacement.test.js`
Expected: FAIL — cannot resolve `../services/manualPlacement.js`.

- [ ] **Step 3: Write the service**

```js
// server/services/manualPlacement.js
//
// A clip the user placed by hand.
//
// IT DOES NOT MINT ANYTHING. It builds a one-step CREATE pipeline and hands it
// to `runOperationServerSide` — the same executor every share RULE runs
// through, which already knows how to resolve a parent, copy a sibling's
// bindings (`bindingsLike`), key a row on its externalId and mirror the write
// into the warm cache. This is the spec's §7 constraint: three surfaces now
// turn a clip into an occurrence, and they must share one writer.
//
// Its return value is deliberately the shape `runShareRules` returns, so
// `/share` logs a hand placement exactly as it logs a rule.
import { runOperationServerSide } from "./serverExecutor.js";

// Every mapped value is a LITERAL. The window already resolved it and showed
// it to the user; a page title containing "$today" must be written verbatim
// rather than re-resolved by the executor's expression layer.
const lit = (v) => `literal:${v == null ? "" : String(v)}`;

export async function placeManually({ share, placement, userId, gridId, io = null, mirror = null }) {
  const p = placement || {};
  if (!p.parentId) throw new Error("manual placement requires a parentId");

  const fields = {};
  for (const [fieldId, value] of Object.entries(p.fields || {})) {
    if (value !== "" && value != null) fields[fieldId] = lit(value);
  }

  const op = {
    id: "manual-placement", name: "Placed by hand", enabled: true,
    pipeline: { sources: [], steps: [{
      id: "place",
      type: "action",
      config: {
        type: "CREATE",
        parentId: p.parentId,
        label: lit(p.label || share?.label || ""),
        role: p.role || "instance",
        kind: p.kind || null,
        externalId: share?.externalId || null,
        ...(p.bindingsLike ? { bindingsLike: p.bindingsLike } : {}),
        ...(p.bindFields?.length ? { bindFields: p.bindFields } : {}),
        fields,
      },
    }] },
  };

  const res = await runOperationServerSide(op, { vars: { $share: share }, userId, gridId, io, mirror });
  return {
    ran: [{
      ruleId: "manual", ruleName: "Placed by hand",
      ok: res.ok !== false,
      error: res.error || null,
      created: (res.effects || []).filter((e) => e._effect === "CREATE"),
      unsupported: res.unsupported || [],
    }],
    halted: true,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/manualPlacement.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/manualPlacement.js server/__tests__/manualPlacement.test.js
git commit -m "feat(server): place a share by hand through the same writer the rules use"
```

---

### Task 6: `/share` learns `mode: "manual"` and the stage key

**Files:**
- Modify: `server/routes/apiV1.js` (`POST /share`, from line 1252)
- Test: `server/__tests__/apiShareManual.test.js`

**Interfaces:**
- Consumes: `placeManually` (Task 5), `consumeStage` (Task 2).
- Produces: `POST /share` accepts `{ mode: "manual", placement: {...} }` and `{ stageId, stageKey }` in place of a bearer token.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/apiShareManual.test.js
//
// Two additions to /share, and the reason they belong on /share rather than on
// a new endpoint: a hand-placed clip must appear in the SAME share log the
// Imports tab shows, beside every automatic one.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
  findOneAndUpdate: () => ({ lean: async () => ({ shareLog: [] }) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null }) } }));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));
vi.mock("../services/shareIngress.js", () => ({
  prepareShare: async (a) => ({ type: "link", label: a.title || "L", externalId: "link:x", props: { url: a.url } }),
}));
const rulesRan = [];
vi.mock("../services/shareRules.js", () => ({
  runShareRules: async () => { rulesRan.push(1); return { ran: [], halted: false }; },
}));
const placed = [];
vi.mock("../services/manualPlacement.js", () => ({
  placeManually: async (a) => {
    placed.push(a);
    return { ran: [{ ruleId: "manual", ruleName: "Placed by hand", ok: true, created: [{ occurrenceId: "new-1" }] }], halted: true };
  },
}));
const logged = [];
vi.mock("../services/shareLog.js", () => ({
  shareLogEntry: (a) => a,
  recordShare: async (a) => { logged.push(a); },
}));
const consumed = [];
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async () => ({ stageId: "s1", key: "k1" }),
  readStage: async () => null,
  consumeStage: async (id, key, opts) => {
    consumed.push({ id, key });
    if (id === "s1" && key === "k1") return opts?.withUser ? { payload: { url: "https://x" }, userId: "u1" } : { url: "https://x" };
    return null;
  },
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}`,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());

const share = (body, token) => fetch(`${base}/share`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const MANUAL = {
  gridId: "g1", url: "https://imdb/x", mode: "manual",
  placement: { parentId: "0cti", role: "artifact", kind: "movie", fields: { "f-year": "2006" } },
};

describe("mode: manual", () => {
  it("places instead of running the rules", async () => {
    rulesRan.length = 0; placed.length = 0;
    const r = await share(MANUAL, "good-token");
    expect(r.status).toBe(201);
    expect(placed).toHaveLength(1);
    expect(rulesRan).toHaveLength(0);
  });

  it("passes the placement straight through", async () => {
    placed.length = 0;
    await share(MANUAL, "good-token");
    expect(placed[0].placement).toMatchObject({ parentId: "0cti", kind: "movie" });
  });

  it("STILL writes to the share log — the Imports tab shows hand placements too", async () => {
    logged.length = 0;
    await share(MANUAL, "good-token");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).toMatch(/Placed by hand/);
  });

  it("refuses a manual share with no placement", async () => {
    const r = await share({ ...MANUAL, placement: null }, "good-token");
    expect(r.status).toBe(400);
  });

  it("an unknown mode is refused rather than silently running the rules", async () => {
    const r = await share({ ...MANUAL, mode: "sideways" }, "good-token");
    expect(r.status).toBe(400);
  });
});

describe("stage-key authorization", () => {
  it("accepts a valid stageId + stageKey with NO bearer token", async () => {
    const r = await share({ ...MANUAL, stageId: "s1", stageKey: "k1" });
    expect(r.status).toBe(201);
  });

  it("refuses a wrong key", async () => {
    const r = await share({ ...MANUAL, stageId: "s1", stageKey: "wrong" });
    expect(r.status).toBe(401);
  });

  it("refuses a reused stage — the commit consumed it", async () => {
    // consumeStage returns null the second time in the real service; here the
    // mock is asked for a stage that does not exist, which is the same answer.
    const r = await share({ ...MANUAL, stageId: "s-gone", stageKey: "k1" });
    expect(r.status).toBe(401);
  });

  it("a bearer token still works and does not need a stage", async () => {
    const r = await share(MANUAL, "good-token");
    expect(r.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiShareManual.test.js`
Expected: FAIL — manual shares still run the rules; stage-key requests 401 at the auth middleware.

- [ ] **Step 3: Add stage-key authorization**

In `server/routes/apiV1.js`, immediately **before** the `router.post("/share", …)` line, add a middleware that turns a valid stage key into `req.userId` so the existing auth chain lets it through:

```js
  // A placement window authorizes itself with the key it was opened with, not
  // with a session — it may be open in a browser that has never signed in.
  // This runs BEFORE the auth middleware and only ever sets `req.userId` from
  // a stage the key actually opens; everything else falls through to the
  // normal token/session path untouched.
  const stageKeyAuth = async (req, _res, next) => {
    const { stageId, stageKey } = req.body || {};
    if (!stageId || !stageKey || req.headers.authorization) return next();
    try {
      const { consumeStage } = await import("../services/shareStage.js");
      const opened = await consumeStage(stageId, stageKey, { withUser: true });
      if (opened) {
        req.userId = opened.userId;
        req.stagePayload = opened.payload;
        req.viaStageKey = true;
      }
    } catch { /* fall through to the normal auth failure */ }
    next();
  };
```

Then change the route signature to run it first and to accept the injected user:

```js
  router.post("/share", stageKeyAuth, authAndLimit({ requireScope: "write", allowSessionJwt: true, allowPreAuthed: true }), acceptShareFiles, async (req, res) => {
```

`authAndLimit` gains `allowPreAuthed`: when `req.userId` is already set it skips its own check. Find `authAndLimit` in this file and add, as the first line of its handler:

```js
    if (opts.allowPreAuthed && req.userId) return next();
```

- [ ] **Step 4: Add the manual branch**

In `POST /share`, replace the `runShareRules` call:

```js
      const result = await runShareRules({
        share, userId: req.userId, gridId, io,
        mirror: (model, doc) => mirrorToCache(req.userId, gridId, model, doc),
      });
```

with:

```js
      // AUTO or MANUAL. A hand placement skips the rules and writes one row,
      // and is logged exactly the same way — the Imports tab's Recent shares
      // is the audit trail for everything that reaches this endpoint.
      const mode = body.mode || "auto";
      if (mode !== "auto" && mode !== "manual") {
        await logShare(share, null, `unknown mode ${mode}`);
        return err(res, 400, "validation_error", `unknown mode: ${mode}`);
      }
      if (mode === "manual" && !body.placement?.parentId) {
        await logShare(share, null, "manual share with no placement");
        return err(res, 400, "validation_error", "mode:manual requires placement.parentId");
      }
      const mirror = (model, doc) => mirrorToCache(req.userId, gridId, model, doc);
      const result = mode === "manual"
        ? await (await import("../services/manualPlacement.js")).placeManually({
            share, placement: body.placement, userId: req.userId, gridId, io, mirror })
        : await runShareRules({ share, userId: req.userId, gridId, io, mirror });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiShareManual.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run every share suite — this route has eight of them**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiShare.test.js __tests__/apiShareHttp.test.js __tests__/apiShareStage.test.js __tests__/apiShareManual.test.js __tests__/shareRules.test.js __tests__/shareIcsEndToEnd.test.js __tests__/shareLinkCompat.test.js __tests__/shareLog.test.js`
Expected: all pass. A failure here means the auth change leaked into the normal path — fix before moving on.

- [ ] **Step 7: Commit**

```bash
git add server/routes/apiV1.js server/__tests__/apiShareManual.test.js
git commit -m "feat(server): /share takes mode:manual and a stage key"
```

---

### Task 7: Which rule would Auto run

**Files:**
- Modify: `server/routes/apiV1.js`
- Test: `server/__tests__/apiSharePreview.test.js`

**Interfaces:**
- Consumes: `selectShareRules` (already exported from `services/shareRules.js`), `readStage`.
- Produces: `GET /api/v1/share/stage/:id/preview?k=&gridId=` → `{ ruleId, ruleName }` or `{ ruleId: null, ruleName: null }`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/apiSharePreview.test.js
//
// Auto must say where it will put the thing BEFORE you press Clip. The whole
// feature exists because a clip went somewhere the user could not find; a mode
// called "auto" that will not say where is the same failure with a nicer name.
//
// It resolves on the SERVER, through selectShareRules — the function the real
// run uses. A second matcher in the page would be free to disagree with it.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/Grid.js", () => ({ default: { exists: async () => ({ _id: "g1" }) } }));
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async () => ({ stageId: "s1", key: "k1" }),
  readStage: async (id, key, opts) => (id === "s1" && key === "k1"
    ? (opts?.withUser ? { payload: { url: "https://x", shape: "link" }, userId: "u1" } : { url: "https://x", shape: "link" })
    : null),
  consumeStage: async () => null,
}));
vi.mock("../models/Operation.js", () => ({ default: {
  find: () => ({ lean: async () => ([
    { id: "r-link", name: "Share: link", enabled: true, triggerObjects: [{ eventType: "onShare", shareType: "link" }] },
    { id: "r-all", name: "Share: anything else", enabled: true, triggerObjects: [{ eventType: "onShare", shareType: "*" }] },
  ]) },
}}));

const { makeApiV1Router } = await import("../routes/apiV1.js");

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}`,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());

describe("GET /share/stage/:id/preview", () => {
  it("names the FIRST rule that would run, not the catch-all", async () => {
    const r = await fetch(`${base}/share/stage/s1/preview?k=k1&gridId=g1`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ruleId: "r-link", ruleName: "Share: link" });
  });

  it("404s on a wrong key, like every other stage read", async () => {
    expect((await fetch(`${base}/share/stage/s1/preview?k=no&gridId=g1`)).status).toBe(404);
  });

  it("requires a gridId, since rules are per grid", async () => {
    expect((await fetch(`${base}/share/stage/s1/preview?k=k1`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiSharePreview.test.js`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 3: Add the route**

After `GET /share/stage/:id` in `server/routes/apiV1.js`:

```js
  // Which rule Auto would run. Key-authorized like the stage read itself.
  router.get("/share/stage/:id/preview", async (req, res) => {
    try {
      const { gridId } = req.query;
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      const { readStage } = await import("../services/shareStage.js");
      const opened = await readStage(req.params.id, req.query.k, { withUser: true });
      if (!opened) return err(res, 404, "not_found", "no such stage");
      const { default: Operation } = await import("../models/Operation.js");
      const { selectShareRules } = await import("../services/shareRules.js");
      const ops = await Operation.find({ userId: opened.userId, gridId }).lean();
      // The share's TYPE decides, and the stage holds the sender's own guess at
      // it (`shape`). Anything unrecognised falls to the catch-all, which is
      // what the real run would do too.
      const type = opened.payload?.shape || opened.payload?.type || "link";
      const first = selectShareRules(ops, type)[0] || null;
      res.json({ ruleId: first?.id || null, ruleName: first?.name || null, type });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/apiSharePreview.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/routes/apiV1.js server/__tests__/apiSharePreview.test.js
git commit -m "feat(server): Auto names the rule it will run before you commit"
```

---

### Task 8: The placement helper — form state to payload

**Files:**
- Create: `client/src/helpers/sharePlacement.js`
- Test: `client/src/__tests__/sharePlacement.test.js`

**Interfaces:**
- Consumes: `resolveMappings` (Task 1).
- Produces: `shapeFromDestination(destination, siblingModule) => { role, kind, bindingsLike, bindFields, autoFields }`, `buildSharePayload({ clip, gridId, mode, destination, shape, mappings, stageId, stageKey }) => object`, `CLIP_KINDS: Array<{value,label,desc}>`.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/sharePlacement.test.js
//
// Form state → the body /share receives. Pure, because this is where a wrong
// answer is invisible: the window would look right and write the wrong row.
import { describe, it, expect } from "vitest";
import { shapeFromDestination, buildSharePayload, CLIP_KINDS } from "../helpers/sharePlacement";

const CLIP = { title: "A Guide (2006) IMDb", url: "https://imdb/x", siteName: "IMDb" };

// A Movies row as poms actually stores it (spec §1).
const MOVIE_ROW = {
  id: "m-movie", role: "artifact", kind: "movie",
  fieldBindings: [
    { fieldId: "f-owned", order: 0 }, { fieldId: "f-drive", order: 1 },
    { fieldId: "f-year", order: 4 }, { fieldId: "f-cat", order: 5 },
  ],
};

describe("shapeFromDestination", () => {
  it("copies the siblings' role, kind and module", () => {
    const s = shapeFromDestination({ id: "o-movies", childCount: 993 }, MOVIE_ROW);
    expect(s).toMatchObject({ role: "artifact", kind: "movie", bindingsLike: "m-movie" });
  });

  it("offers the siblings' fields as the rows to fill", () => {
    const s = shapeFromDestination({ id: "o-movies", childCount: 993 }, MOVIE_ROW);
    expect(s.bindFields).toEqual(["f-owned", "f-drive", "f-year", "f-cat"]);
  });

  it("falls back to a plain instance when the destination is EMPTY", () => {
    // An empty container has no rows to copy; the override list is the answer.
    const s = shapeFromDestination({ id: "o-new", childCount: 0 }, null);
    expect(s).toMatchObject({ role: "instance", kind: null, bindingsLike: null });
    expect(s.bindFields).toEqual([]);
  });

  it("names no sibling module when there is none, rather than undefined", () => {
    expect(shapeFromDestination({ id: "o-new", childCount: 0 }, null).bindingsLike).toBeNull();
  });
});

describe("CLIP_KINDS", () => {
  it("carries the app's own labels, not retyped ones", () => {
    // Drift between this list and the + menu is the thing being prevented.
    const byValue = Object.fromEntries(CLIP_KINDS.map((k) => [k.value, k]));
    expect(byValue.textblock.label).toBe("Textblock");
    expect(byValue.image.label).toBe("Image");
    expect(byValue.bookmark.label).toBe("Bookmark");
  });
});

describe("buildSharePayload", () => {
  const base = { clip: CLIP, gridId: "g1", stageId: "s1", stageKey: "k1" };

  it("auto mode sends no placement", () => {
    const p = buildSharePayload({ ...base, mode: "auto" });
    expect(p.mode).toBe("auto");
    expect(p.placement).toBeUndefined();
    expect(p).toMatchObject({ gridId: "g1", stageId: "s1", stageKey: "k1" });
  });

  it("manual mode sends the resolved values, not the mappings", () => {
    // The server writes what the window showed. Sending mappings would mean a
    // second resolver on the server, free to disagree with the box.
    const p = buildSharePayload({
      ...base, mode: "manual",
      destination: { id: "o-movies" },
      shape: { role: "artifact", kind: "movie", bindingsLike: "m-movie", bindFields: ["f-year"] },
      mappings: { "f-year": { source: "title", transform: "year" } },
    });
    expect(p.mode).toBe("manual");
    expect(p.placement).toMatchObject({
      parentId: "o-movies", role: "artifact", kind: "movie", bindingsLike: "m-movie",
      fields: { "f-year": "2006" },
    });
  });

  it("carries the clip through, so the server can prepare the share", () => {
    const p = buildSharePayload({ ...base, mode: "auto" });
    expect(p.url).toBe("https://imdb/x");
  });

  it("drops a mapping that resolved to nothing", () => {
    const p = buildSharePayload({
      ...base, mode: "manual", destination: { id: "o1" }, shape: { role: "instance" },
      mappings: { "f-a": { source: "title" }, "f-b": { source: "selection" } },
    });
    expect(Object.keys(p.placement.fields)).toEqual(["f-a"]);
  });

  it("still BINDS a field whose value is empty, when the shape asked for it", () => {
    // A bound-but-empty field is how a row reaches an op that gates on
    // _boundFieldIds — dropping the binding with the value would break that.
    const p = buildSharePayload({
      ...base, mode: "manual", destination: { id: "o1" },
      shape: { role: "instance", bindFields: ["f-a", "f-b"] },
      mappings: { "f-a": { source: "title" }, "f-b": { source: "selection" } },
    });
    expect(p.placement.bindFields).toEqual(["f-a", "f-b"]);
  });

  it("refuses to build a manual payload with no destination", () => {
    expect(() => buildSharePayload({ ...base, mode: "manual", shape: { role: "instance" } }))
      .toThrow(/destination/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlacement.test.js`
Expected: FAIL — cannot resolve `../helpers/sharePlacement`.

- [ ] **Step 3: Write the implementation**

```js
// client/src/helpers/sharePlacement.js
//
// Form state → the body `POST /share` receives.
//
// Pure, and separate from the window, because this is where a wrong answer is
// INVISIBLE: the screen would look correct and write the wrong row.
import { resolveMappings } from "./shareMapping.js";
import { KIND_TILE } from "../ui/QuickAddMenu.jsx";

// The override list — what a clip can be when it is NOT like its neighbours.
// Labels come from the quick-add menu's own table so the two vocabularies
// cannot drift; "bookmark" is the one the + menu has no tile for, since you
// cannot quick-add a bookmark, only clip one.
export const CLIP_KINDS = [
  { value: "bookmark",  role: "artifact",  kind: "bookmark",  label: "Bookmark",  desc: "A saved link" },
  { value: "textblock", role: "textblock", kind: null,        label: KIND_TILE.textblock.label, desc: KIND_TILE.textblock.desc },
  { value: "image",     role: "artifact",  kind: "image",     label: KIND_TILE.image.label,     desc: KIND_TILE.image.desc },
];

/**
 * The shape a new row takes in this destination: the same one its siblings
 * have. This is what the app's own `+` already does — `siblingFieldBindings`
 * pre-ticks whatever the row's siblings bind — and it is why "add it as a
 * movie" works at all: a movie is `artifact/movie` with six bindings, not a
 * primitive anyone could have picked from a list.
 *
 * @param {{id:string, childCount:number}} destination
 * @param {object|null} siblingModule  the module one existing child points at
 */
export function shapeFromDestination(destination, siblingModule) {
  if (!siblingModule) {
    return { role: "instance", kind: null, bindingsLike: null, bindFields: [], autoFields: {} };
  }
  const bindFields = (siblingModule.fieldBindings || [])
    .filter((b) => b?.fieldId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((b) => b.fieldId);
  return {
    role: siblingModule.role || "instance",
    kind: siblingModule.kind || null,
    bindingsLike: siblingModule.id,
    bindFields,
    autoFields: {},
  };
}

/** The whole request body. Throws rather than sending a manual share nowhere. */
export function buildSharePayload({ clip, gridId, mode, destination, shape, mappings, stageId, stageKey, source = "extension" }) {
  const base = {
    gridId, source, mode,
    ...(stageId ? { stageId, stageKey } : null),
    url: clip?.url || clip?.linkUrl || null,
    text: clip?.selection || clip?.text || null,
    title: clip?.title || null,
    shape: clip?.shape || null,
    clip: clip?.record || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  };
  if (mode !== "manual") return base;
  if (!destination?.id) throw new Error("a manual placement needs a destination");
  return {
    ...base,
    placement: {
      parentId: destination.id,
      role: shape?.role || "instance",
      kind: shape?.kind || null,
      ...(shape?.bindingsLike ? { bindingsLike: shape.bindingsLike } : null),
      ...(shape?.bindFields?.length ? { bindFields: shape.bindFields } : null),
      // RESOLVED VALUES, not mappings: the server writes what the window
      // showed, so there is no second resolver free to disagree with the box.
      fields: resolveMappings(clip, mappings || {}),
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlacement.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/sharePlacement.js client/src/__tests__/sharePlacement.test.js
git commit -m "feat(client): turn placement form state into a share payload"
```

---

### Task 9: The window — shell, stage read, Auto

**Files:**
- Create: `client/src/ui/SharePlace.jsx`
- Modify: `client/src/main.jsx:63`
- Test: `client/src/__tests__/sharePlace.test.jsx`

**Interfaces:**
- Consumes: `buildSharePayload` (Task 8), the four endpoints (Tasks 3, 4, 6, 7).
- Produces: the route `/share-place`, and a default-exported `SharePlace` component.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/__tests__/sharePlace.test.jsx
//
// The window's WIRING: what it fetches, what it renders, what it posts. The
// look is checked in a browser (Task 13) — jsdom cannot tell you whether a
// popup reads well, and this repo has three defects on record that only a real
// browser found.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const calls = [];
beforeEach(() => {
  calls.length = 0;
  window.history.replaceState({}, "", "/share-place?stage=s1&k=k1");
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts });
    const u = String(url);
    if (u.includes("/share/stage/s1/preview")) return json({ ruleId: "r-link", ruleName: "Share: link" });
    if (u.includes("/share/stage/s1")) return json({ payload: { url: "https://imdb/x", title: "A Guide (2006) IMDb", shape: "link" } });
    if (u.includes("/me/share")) return json({ gridId: "g1" });
    if (u.includes("/grids")) return json({ grids: [{ id: "g1", name: "poms grid" }, { id: "g2", name: "test grid 2" }] });
    if (u.includes("/destinations")) return json({ destinations: [] });
    if (u.includes("/fields")) return json({ fields: [] });
    if (u.includes("/share")) return json({ ran: [{ ruleName: "Share: link", created: [{ occurrenceId: "n1" }] }] }, 201);
    return json({});
  });
});
afterEach(cleanup);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const { default: SharePlace } = await import("../ui/SharePlace.jsx");

describe("SharePlace", () => {
  it("reads the staged clip with the key from the URL", async () => {
    render(<SharePlace />);
    await waitFor(() => expect(calls.some((c) => c.url.includes("/share/stage/s1?k=k1"))).toBe(true));
  });

  it("shows what is being clipped", async () => {
    render(<SharePlace />);
    expect(await screen.findByText(/A Guide \(2006\) IMDb/)).toBeTruthy();
  });

  it("defaults the grid to the user's share grid", async () => {
    render(<SharePlace />);
    await waitFor(() => expect(screen.getByLabelText(/grid/i).value).toBe("g1"));
  });

  it("NAMES the rule Auto would run", async () => {
    render(<SharePlace />);
    expect(await screen.findByText(/Share: link/)).toBeTruthy();
  });

  it("re-asks which rule would run when the grid changes", async () => {
    render(<SharePlace />);
    await screen.findByText(/Share: link/);
    const before = calls.filter((c) => c.url.includes("/preview")).length;
    fireEvent.change(screen.getByLabelText(/grid/i), { target: { value: "g2" } });
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/preview")).length).toBeGreaterThan(before));
  });

  it("posts an auto share and nothing else when you press Clip", async () => {
    render(<SharePlace />);
    await screen.findByText(/Share: link/);
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.opts?.method === "POST" && c.url.endsWith("/share"));
      expect(post).toBeTruthy();
      const body = JSON.parse(post.opts.body);
      expect(body.mode).toBe("auto");
      expect(body.placement).toBeUndefined();
      expect(body.stageId).toBe("s1");
    });
  });

  it("writes NOTHING before Clip is pressed", async () => {
    render(<SharePlace />);
    await screen.findByText(/Share: link/);
    expect(calls.filter((c) => c.opts?.method === "POST")).toHaveLength(0);
  });

  it("says so when the stage is gone instead of rendering an empty form", async () => {
    global.fetch = vi.fn(async () => json({ error: "not_found" }, 404));
    render(<SharePlace />);
    expect(await screen.findByText(/expired|no longer/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlace.test.jsx`
Expected: FAIL — cannot resolve `../ui/SharePlace.jsx`.

- [ ] **Step 3: Write the component (shell + Auto)**

```jsx
// client/src/ui/SharePlace.jsx
//
// THE PLACEMENT WINDOW. Opened by the companion extension (and by
// SharePending, for a phone or Windows share) at
// `/share-place?stage=<id>&k=<key>`.
//
// It is a Moduli page rather than extension HTML so it reuses the app's own
// pickers and session — the alternative was a second field picker and a second
// occurrence search, which would drift (user, 2026-09-28: "any place that
// selects a field should be using that one").
//
// NOTHING IS WRITTEN UNTIL "Clip" IS PRESSED. Closing the window leaves the
// stage to expire unused.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { buildSharePayload } from "../helpers/sharePlacement.js";

const api = (path, opts) => fetch(`/api/v1${path}`, opts);
const param = (k) => new URLSearchParams(window.location.search).get(k) || "";

export default function SharePlace() {
  const stageId = useMemo(() => param("stage"), []);
  const stageKey = useMemo(() => param("k"), []);
  const [clip, setClip] = useState(null);
  const [gone, setGone] = useState(false);
  const [grids, setGrids] = useState([]);
  const [gridId, setGridId] = useState("");
  const [mode, setMode] = useState("auto");
  const [autoRule, setAutoRule] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  // The staged clip, and where shares go by default.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await api(`/share/stage/${encodeURIComponent(stageId)}?k=${encodeURIComponent(stageKey)}`);
      if (!live) return;
      if (!r.ok) { setGone(true); return; }
      setClip((await r.json()).payload || {});
      const [me, gs] = await Promise.all([
        api("/me/share").then((x) => (x.ok ? x.json() : {})).catch(() => ({})),
        api("/grids").then((x) => (x.ok ? x.json() : {})).catch(() => ({})),
      ]);
      if (!live) return;
      setGrids(gs.grids || []);
      setGridId(me.gridId || gs.grids?.[0]?.id || "");
    })();
    return () => { live = false; };
  }, [stageId, stageKey]);

  // WHICH RULE AUTO WOULD RUN — re-asked whenever the grid changes, because
  // rules are per grid. Resolved on the server through the same
  // `selectShareRules` the real run uses.
  useEffect(() => {
    if (!gridId || !stageId) return;
    let live = true;
    api(`/share/stage/${encodeURIComponent(stageId)}/preview?k=${encodeURIComponent(stageKey)}&gridId=${encodeURIComponent(gridId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live) setAutoRule(b); })
      .catch(() => {});
    return () => { live = false; };
  }, [gridId, stageId, stageKey]);

  const submit = useCallback(async (extra = {}) => {
    setBusy(true); setError(null);
    try {
      const body = buildSharePayload({ clip, gridId, mode, stageId, stageKey, ...extra });
      const r = await api("/share", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setError(b.message || b.error || `HTTP ${r.status}`); return; }
      const created = (b.ran || []).flatMap((x) => x.created || [])[0];
      if (!created) { setError("nothing was written — no rule matched"); return; }
      setDone(b);
      setTimeout(() => window.close(), 900);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [clip, gridId, mode, stageId, stageKey]);

  if (gone) return <Shell><p>That clip has expired or was already placed.</p></Shell>;
  if (!clip) return <Shell><p>Loading…</p></Shell>;
  if (done) return <Shell><p>Clipped.</p></Shell>;

  return (
    <Shell>
      <header style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{clip.title || clip.url}</div>
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{clip.url}</div>
      </header>

      <label htmlFor="grid" style={lblSt}>Grid</label>
      <select id="grid" value={gridId} onChange={(e) => setGridId(e.target.value)} style={inputSt}>
        {grids.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0" }}>
        <label style={rowSt}>
          <input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} /> Auto
        </label>
        {mode === "auto" && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 8px 22px" }}>
            {autoRule?.ruleName ? `→ ${autoRule.ruleName}` : "→ no rule matches — the catch-all will file it"}
          </div>
        )}
        <label style={rowSt}>
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New
        </label>
        <label style={rowSt}>
          <input type="radio" checked={mode === "preset"} onChange={() => setMode("preset")} /> Preset
        </label>
      </fieldset>

      {error && <p style={{ color: "var(--danger-text)", fontSize: 11 }}>{error}</p>}

      <footer style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={() => window.close()} disabled={busy}>Cancel</button>
        <button onClick={() => submit()} disabled={busy || !gridId}>Clip</button>
      </footer>
    </Shell>
  );
}

const lblSt = { fontSize: 11, color: "var(--text-faint)", display: "block", marginBottom: 2 };
const inputSt = { width: "100%", padding: "4px 6px", background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 4, fontSize: 12 };
const rowSt = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" };

function Shell({ children }) {
  return (
    <div style={{ font: "13px/1.5 system-ui, sans-serif", color: "var(--text-primary)", background: "var(--surface-1, #16181c)", minHeight: "100vh", padding: 16 }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `client/src/main.jsx`, line 63, extend the share-path array and lazy import:

```js
const isSharePath = ["/share-pending", "/share-target", "/share-place"].includes(window.location.pathname);
```

and inside that branch, pick the component by path:

```js
  const SharePending = React.lazy(() => import("./ui/SharePending.jsx"));
  const SharePlace = React.lazy(() => import("./ui/SharePlace.jsx"));
  const Page = window.location.pathname === "/share-place" ? SharePlace : SharePending;
```

replacing `<SharePending />` with `<Page />`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlace.test.jsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/SharePlace.jsx client/src/main.jsx client/src/__tests__/sharePlace.test.jsx
git commit -m "feat(client): the share placement window — shell, staged clip, Auto"
```

---

### Task 10: The New pane — destination, shape, field table

**Files:**
- Modify: `client/src/ui/SharePlace.jsx`
- Test: `client/src/__tests__/sharePlaceNew.test.jsx`

**Interfaces:**
- Consumes: `shapeFromDestination`, `SHARE_SOURCES`, `SHARE_TRANSFORMS`, `resolveMapping`, `ui/FieldSelect`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/__tests__/sharePlaceNew.test.jsx
//
// The manual pane. The assertions are about what reaches the SERVER, because
// that is what the user cannot see and cannot undo.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// FieldSelect is a Radix popover; jsdom cannot open one reliably (this repo
// deleted a prefill test over exactly that). It stands in as a plain select,
// so these cases test SharePlace, not the picker.
vi.mock("../ui/FieldSelect.jsx", () => ({
  default: ({ fields, value, onChange, noneLabel }) => (
    <select data-testid="field-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {noneLabel != null && <option value="">{noneLabel}</option>}
      {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  ),
}));

const calls = [];
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  calls.length = 0;
  window.history.replaceState({}, "", "/share-place?stage=s1&k=k1");
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts });
    const u = String(url);
    if (u.includes("/preview")) return json({ ruleName: "Share: link" });
    if (u.includes("/share/stage/s1")) return json({ payload: { url: "https://imdb/x", title: "A Guide (2006) IMDb" } });
    if (u.includes("/me/share")) return json({ gridId: "g1" });
    if (u.includes("/grids")) return json({ grids: [{ id: "g1", name: "poms grid" }] });
    if (u.includes("/destinations")) return json({ destinations: [
      { id: "o-movies", label: "Movies", crumb: "Boards › Media", role: "container", kind: "board", childCount: 993 },
    ] });
    if (u.includes("/occurrences?parentId=o-movies")) return json({ occurrences: [{ id: "o-row", moduleId: "m-movie" }] });
    if (u.includes("/modules")) return json({ modules: [{ id: "m-movie", role: "artifact", kind: "movie",
      fieldBindings: [{ fieldId: "f-year", order: 0 }, { fieldId: "f-cat", order: 1 }] }] });
    if (u.includes("/fields")) return json({ fields: [
      { id: "f-year", name: "Year", type: "number" }, { id: "f-cat", name: "Board Category", type: "select" },
    ] });
    if (u.endsWith("/share")) return json({ ran: [{ created: [{ occurrenceId: "n1" }] }] }, 201);
    return json({});
  });
});
afterEach(cleanup);

const { default: SharePlace } = await import("../ui/SharePlace.jsx");

const openNew = async () => {
  render(<SharePlace />);
  await screen.findByText(/A Guide/);
  fireEvent.click(screen.getByLabelText("New"));
};

describe("the New pane", () => {
  it("searches destinations as you type", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("/destinations") && c.url.includes("q=mov"))).toBe(true));
  });

  it("shows the crumb, so two same-named containers are distinguishable", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    expect(await screen.findByText(/Boards › Media/)).toBeTruthy();
  });

  it("adopts the destination's shape, and SAYS what it adopted", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    fireEvent.click(await screen.findByText("Movies"));
    expect(await screen.findByText(/artifact\/movie/)).toBeTruthy();
    expect(screen.getByText(/993/)).toBeTruthy();
  });

  it("posts the adopted shape and the resolved values", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    fireEvent.click(await screen.findByText("Movies"));
    fireEvent.click(screen.getByText(/\+ field/));
    fireEvent.change(screen.getAllByTestId("field-select").at(-1), { target: { value: "f-year" } });
    fireEvent.change(screen.getByLabelText(/source for Year/i), { target: { value: "title" } });
    fireEvent.change(screen.getByLabelText(/transform for Year/i), { target: { value: "year" } });
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.opts?.method === "POST" && c.url.endsWith("/share"));
      const body = JSON.parse(post.opts.body);
      expect(body.mode).toBe("manual");
      expect(body.placement).toMatchObject({
        parentId: "o-movies", role: "artifact", kind: "movie", bindingsLike: "m-movie",
        fields: { "f-year": "2006" },
      });
    });
  });

  it("shows the value each mapping will write", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    fireEvent.click(await screen.findByText("Movies"));
    fireEvent.click(screen.getByText(/\+ field/));
    fireEvent.change(screen.getAllByTestId("field-select").at(-1), { target: { value: "f-year" } });
    fireEvent.change(screen.getByLabelText(/source for Year/i), { target: { value: "title" } });
    fireEvent.change(screen.getByLabelText(/transform for Year/i), { target: { value: "year" } });
    expect(screen.getByLabelText(/value for Year/i).value).toBe("2006");
  });

  it("an edited value is what gets posted", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    fireEvent.click(await screen.findByText("Movies"));
    fireEvent.click(screen.getByText(/\+ field/));
    fireEvent.change(screen.getAllByTestId("field-select").at(-1), { target: { value: "f-year" } });
    fireEvent.change(screen.getByLabelText(/source for Year/i), { target: { value: "title" } });
    fireEvent.change(screen.getByLabelText(/value for Year/i), { target: { value: "1999" } });
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.opts?.method === "POST" && c.url.endsWith("/share"));
      expect(JSON.parse(post.opts.body).placement.fields["f-year"]).toBe("1999");
    });
  });

  it("Clip is refused with no destination chosen", async () => {
    await openNew();
    expect(screen.getByRole("button", { name: /^clip$/i }).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlaceNew.test.jsx`
Expected: FAIL — the New pane renders nothing.

- [ ] **Step 3: Implement the pane**

Add to `SharePlace.jsx`: state for `destination`, `shape`, `mappings`, `fields`; a debounced destination search hitting `/destinations?gridId=&q=`; on pick, fetch one child via `/occurrences?parentId=<id>&limit=1` and its module via `/modules?gridId=`, then `shapeFromDestination`. Render:

```jsx
{mode === "new" && (
  <section>
    <label style={lblSt}>Where</label>
    <input placeholder="search containers and pages" value={q}
      onChange={(e) => setQ(e.target.value)} style={inputSt} />
    {!destination && dests.map((d) => (
      <button key={d.id} onClick={() => pickDestination(d)} style={destRowSt}>
        <span>{d.label}</span>
        <span style={{ color: "var(--text-faint)", fontSize: 10 }}>{d.crumb}</span>
      </button>
    ))}
    {destination && (
      <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0" }}>
        Shape: like its {destination.childCount} rows — {shape.role}{shape.kind ? `/${shape.kind}` : ""}
        <button onClick={() => setOverride(true)} style={linkBtnSt}>not that — make it a…</button>
      </div>
    )}
    <label style={lblSt}>Fields</label>
    {Object.entries(mappings).map(([fieldId, m]) => (
      <MappingRow key={fieldId} field={fieldsById[fieldId]} mapping={m} clip={clip}
        onChange={(next) => setMappings((p) => ({ ...p, [fieldId]: next }))}
        onRemove={() => setMappings((p) => { const n = { ...p }; delete n[fieldId]; return n; })} />
    ))}
    <button onClick={() => setAdding(true)}>+ field…</button>
    {adding && (
      <FieldSelect fields={fields} value={null} noneLabel="pick a field…"
        onChange={(id) => { if (id) setMappings((p) => ({ ...p, [id]: { source: "none" } })); setAdding(false); }} />
    )}
  </section>
)}
```

with a `MappingRow` whose three controls carry the labels the test queries:

```jsx
function MappingRow({ field, mapping, clip, onChange, onRemove }) {
  const resolved = resolveMapping(clip, mapping);
  const name = field?.name || field?.id || "field";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 11, minWidth: 90 }}>{name}</span>
        <select aria-label={`source for ${name}`} value={mapping.source || "none"}
          onChange={(e) => onChange({ ...mapping, source: e.target.value, override: undefined })}>
          {SHARE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select aria-label={`transform for ${name}`} value={mapping.transform || "none"}
          onChange={(e) => onChange({ ...mapping, transform: e.target.value, override: undefined })}>
          {SHARE_TRANSFORMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={onRemove} title="remove">×</button>
      </div>
      {/* THE VALUE, editable. A mapping that resolves to empty is this
          screen's failure mode, and it is invisible without this box. */}
      <input aria-label={`value for ${name}`} value={mapping.override ?? resolved}
        onChange={(e) => onChange({ ...mapping, override: e.target.value })} style={inputSt} />
    </div>
  );
}
```

Pass `destination`, `shape` and `mappings` into `submit()` via `buildSharePayload`, and disable Clip in `new` mode until a destination is chosen.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlaceNew.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the field-picker walker — it must still be satisfied**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/fieldSelectEverywhere.test.js`
Expected: PASS. If it fails, a native `<select>` over the field list crept in; use `FieldSelect`.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/SharePlace.jsx client/src/__tests__/sharePlaceNew.test.jsx
git commit -m "feat(client): the New pane — destination, shape from its rows, mapped fields"
```

---

### Task 11: Presets

**Files:**
- Create: `client/src/helpers/sharePresets.js`
- Modify: `client/src/ui/SharePlace.jsx`
- Test: `client/src/__tests__/sharePresets.test.js`

**Interfaces:**
- Consumes: `PATCH /api/v1/grids/:id` (exists).
- Produces: `readPresets(grid) => Preset[]`, `withPreset(presets, preset) => Preset[]`, `presetFromForm({ name, destination, shape, mappings }) => Preset`, `formFromPreset(preset) => { destination, shape, mappings }`. `Preset` is `{ id, name, role, kind, bindingsLike, destinationId, bindFields, mappings }`.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/sharePresets.test.js
//
// A preset is a saved SHAPE, not a trigger (user 2026-09-28: "its just a saved
// preset of type of occurance, values, and binded fields. there is no rule
// from IMDB"). Nothing here may fire on its own.
import { describe, it, expect } from "vitest";
import { readPresets, withPreset, presetFromForm, formFromPreset } from "../helpers/sharePresets";

const FORM = {
  name: "Movie",
  destination: { id: "o-movies", label: "Movies", childCount: 993 },
  shape: { role: "artifact", kind: "movie", bindingsLike: "m-movie", bindFields: ["f-year", "f-cat"] },
  mappings: {
    "f-year": { source: "title", transform: "year", override: "2006" },
    "f-cat": { source: "literal", value: "movie" },
  },
};

describe("readPresets", () => {
  it("returns [] for a grid with none, rather than undefined", () => {
    expect(readPresets({})).toEqual([]);
    expect(readPresets(null)).toEqual([]);
  });

  it("reads them off grid.meta", () => {
    expect(readPresets({ meta: { sharePresets: [{ id: "p1", name: "Movie" }] } })).toHaveLength(1);
  });
});

describe("presetFromForm", () => {
  it("keeps the shape and the destination", () => {
    const p = presetFromForm(FORM);
    expect(p).toMatchObject({
      name: "Movie", role: "artifact", kind: "movie",
      bindingsLike: "m-movie", destinationId: "o-movies", bindFields: ["f-year", "f-cat"],
    });
    expect(p.id).toBeTruthy();
  });

  it("DROPS an override — an edit is for one clip, never for every clip after it", () => {
    // Saving one movie must not freeze "2006" into every movie.
    expect(presetFromForm(FORM).mappings["f-year"]).toEqual({ source: "title", transform: "year" });
  });

  it("KEEPS a literal, because a literal source is a deliberate constant", () => {
    expect(presetFromForm(FORM).mappings["f-cat"]).toEqual({ source: "literal", value: "movie" });
  });
});

describe("formFromPreset", () => {
  it("round-trips the shape", () => {
    const p = presetFromForm(FORM);
    const f = formFromPreset(p);
    expect(f.shape).toMatchObject({ role: "artifact", kind: "movie", bindingsLike: "m-movie" });
    expect(f.destination.id).toBe("o-movies");
  });

  it("returns mappings with no override, so values re-resolve for the new clip", () => {
    const f = formFromPreset(presetFromForm(FORM));
    expect(f.mappings["f-year"].override).toBeUndefined();
  });

  it("has no destination when the preset saved none", () => {
    const f = formFromPreset({ id: "p", name: "X", mappings: {} });
    expect(f.destination).toBeNull();
  });
});

describe("withPreset", () => {
  it("appends a new one", () => {
    expect(withPreset([], { id: "p1", name: "Movie" })).toHaveLength(1);
  });

  it("REPLACES one of the same name, so saving twice does not make two Movies", () => {
    const out = withPreset([{ id: "p1", name: "Movie", kind: "old" }], { id: "p2", name: "Movie", kind: "movie" });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("movie");
  });

  it("matches a name case-insensitively and trimmed", () => {
    expect(withPreset([{ id: "p1", name: "Movie" }], { id: "p2", name: "  movie " })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePresets.test.js`
Expected: FAIL — cannot resolve `../helpers/sharePresets`.

- [ ] **Step 3: Write the helper**

```js
// client/src/helpers/sharePresets.js
//
// A saved SHAPE — "a Movie is an artifact/movie in Movies with these six
// fields" — so adding your own stuff is quick. It is NOT a rule: nothing here
// carries a condition and nothing fires on its own (user, 2026-09-28).
//
// Per GRID, because a preset names that grid's fields and containers.
import { uid } from "../uid";

export function readPresets(grid) {
  const list = grid?.meta?.sharePresets;
  return Array.isArray(list) ? list : [];
}

const key = (name) => String(name || "").trim().toLowerCase();

/** Append, or replace one of the same name — saving twice is an edit. */
export function withPreset(presets, preset) {
  const rest = (presets || []).filter((p) => key(p.name) !== key(preset.name));
  return [...rest, preset];
}

/**
 * AN OVERRIDE IS NOT SAVED. Typing a value in the window fixes THIS clip; if a
 * preset kept it, saving one movie would write "2006" into every movie after
 * it. A literal survives, because choosing the "a literal" source is a
 * deliberate constant ("Board Category: movie").
 */
export function presetFromForm({ name, destination, shape, mappings }) {
  const cleaned = {};
  for (const [fieldId, m] of Object.entries(mappings || {})) {
    const { override, ...rest } = m || {};
    cleaned[fieldId] = rest;
  }
  return {
    id: uid(), name: String(name || "").trim(),
    role: shape?.role || "instance",
    kind: shape?.kind || null,
    bindingsLike: shape?.bindingsLike || null,
    bindFields: shape?.bindFields || [],
    destinationId: destination?.id || null,
    mappings: cleaned,
  };
}

export function formFromPreset(preset) {
  return {
    destination: preset?.destinationId ? { id: preset.destinationId, label: preset.name, childCount: 0 } : null,
    shape: {
      role: preset?.role || "instance", kind: preset?.kind || null,
      bindingsLike: preset?.bindingsLike || null, bindFields: preset?.bindFields || [],
    },
    mappings: { ...(preset?.mappings || {}) },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePresets.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Wire the Preset mode into the window**

In `SharePlace.jsx`: fetch the chosen grid (`/grids`) to read `meta.sharePresets`; in `preset` mode render a `<select>` of preset names that calls `formFromPreset` into the same `destination`/`shape`/`mappings` state the New pane uses, then render the New pane's body beneath it; add a `Save as preset…` button in the New pane that prompts for a name and `PATCH /grids/:id` with `meta: { ...grid.meta, sharePresets: withPreset(readPresets(grid), presetFromForm({...})) }`.

**Spread the whole `meta`** — a partial write drops `defaultStyle`, `scheduleFieldIds` and every other key on it.

- [ ] **Step 6: Run both window suites**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePlace.test.jsx src/__tests__/sharePlaceNew.test.jsx src/__tests__/sharePresets.test.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/sharePresets.js client/src/ui/SharePlace.jsx client/src/__tests__/sharePresets.test.js
git commit -m "feat(client): saved placement presets, per grid"
```

---

### Task 12: The extension opens the window; SharePending routes into it

**Files:**
- Modify: `extension/clip.js`, `extension/background.js`, `client/src/ui/SharePending.jsx`
- Test: `server/__tests__/extensionClip.test.js` (extend), `client/src/__tests__/sharePendingRoutes.test.jsx` (new)

**Interfaces:**
- Consumes: `POST /share/stage`.
- Produces: context-menu ids `clip-<context>-choose`; `SharePending` redirects to `/share-place`.

- [ ] **Step 1: Write the failing test for the menus**

Append to `server/__tests__/extensionClip.test.js`:

```js
describe("the choose… menus", () => {
  it("offers a second item for every context that can be clipped", () => {
    const plain = CLIP_MENUS.filter((m) => !m.id.endsWith("-choose"));
    const choose = CLIP_MENUS.filter((m) => m.id.endsWith("-choose"));
    expect(choose).toHaveLength(plain.length);
    for (const p of plain) {
      expect(choose.some((c) => c.id === `${p.id}-choose`)).toBe(true);
    }
  });

  it("the choose… items sit in the same contexts as their instant twin", () => {
    for (const c of CLIP_MENUS.filter((m) => m.id.endsWith("-choose"))) {
      const twin = CLIP_MENUS.find((m) => m.id === c.id.replace(/-choose$/, ""));
      expect(c.contexts).toEqual(twin.contexts);
    }
  });

  it("buildClipRecord reads the base id, so a choose… click still builds a record", () => {
    // The record must not depend on WHICH of the two menu items was used.
    const info = { menuItemId: "clip-link-choose", linkUrl: "https://x/y" };
    const plain = buildClipRecord({ info: { ...info, menuItemId: "clip-link" }, tab: { title: "T" }, fieldIds: {} });
    const viaChoose = buildClipRecord({ info, tab: { title: "T" }, fieldIds: {} });
    expect(viaChoose).toEqual(plain);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/extensionClip.test.js`
Expected: FAIL — no `-choose` entries.

- [ ] **Step 3: Add the menus and the base-id read**

In `extension/clip.js`, after the existing `CLIP_MENUS` array is built, derive the second set and make the shape lookup strip the suffix:

```js
// A SECOND ITEM PER CONTEXT. "Clip …" stays instant — rules, notification, no
// window — because that is the common case. "Clip … (choose…)" stages the clip
// and opens the placement window (spec §3).
const CHOOSE_SUFFIX = "-choose";
export const CLIP_MENUS = [
  ...BASE_MENUS,
  ...BASE_MENUS.map((m) => ({ ...m, id: `${m.id}${CHOOSE_SUFFIX}`, title: `${m.title} (choose…)` })),
];
export const isChooseMenu = (menuItemId) => String(menuItemId || "").endsWith(CHOOSE_SUFFIX);
export const baseMenuId = (menuItemId) => String(menuItemId || "").replace(/-choose$/, "");
```

and in `buildClipRecord`, resolve the shape from `baseMenuId(info.menuItemId)`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run __tests__/extensionClip.test.js`
Expected: PASS.

- [ ] **Step 5: Branch in the background worker**

In `extension/background.js`'s `onClicked` listener, after `record` is built:

```js
  // "choose…" stages the clip and opens the placement window; the instant item
  // posts to /share exactly as before.
  if (isChooseMenu(info.menuItemId)) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/share/stage`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(overrideGridId ? { gridId: overrideGridId } : null),
          source: "extension", url: record.moduleFileRef, shape: record.meta?.clipShape,
          title: tab?.title || null, text: info.selectionText || null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null, clip: record,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.stageId) { notify(`Clip failed: ${body.message || `HTTP ${res.status}`}`); return; }
      await api.windows.create({
        type: "popup", width: 500, height: 660,
        url: `${baseUrl}/share-place?stage=${encodeURIComponent(body.stageId)}&k=${encodeURIComponent(body.key)}`,
      });
    } catch (e) { notify(`Clip failed: ${e?.message || "could not reach Moduli"}`); }
    return;
  }
```

- [ ] **Step 6: Write the SharePending test**

```jsx
// client/src/__tests__/sharePendingRoutes.test.jsx
//
// Every sender reaches the placement window (user's choice, 2026-09-28) — a
// phone or Windows share stages and redirects instead of posting straight to
// /share, so Auto is one press and manual placement is available there too.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const assigned = [];
beforeEach(() => {
  assigned.length = 0;
  delete window.location;
  window.location = { search: "", pathname: "/share-pending", assign: (u) => assigned.push(u) };
  global.fetch = vi.fn(async (url) => (String(url).includes("/share/stage")
    ? { ok: true, status: 201, json: async () => ({ stageId: "s9", key: "k9" }) }
    : { ok: true, status: 200, json: async () => ({}) }));
});
afterEach(cleanup);

describe("SharePending", () => {
  it("stages the share and sends the browser to the placement window", async () => {
    const { default: SharePending } = await import("../ui/SharePending.jsx");
    // A share handed over by the service worker:
    window.__moduliPendingShare = { url: "https://x", title: "T" };
    render(<SharePending />);
    await waitFor(() => {
      expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/share/stage"))).toBe(true);
      expect(assigned.some((u) => u.includes("/share-place?stage=s9&k=k9"))).toBe(true);
    });
  });
});
```

- [ ] **Step 7: Make SharePending stage and redirect**

Replace its direct `POST /api/v1/share` with a `POST /api/v1/share/stage` followed by `window.location.assign('/share-place?stage=…&k=…')`. Keep its existing signed-out handling and its honest reporting (`describeShareResult`) for the case where staging itself fails.

- [ ] **Step 8: Run both suites**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/sharePendingRoutes.test.jsx src/__tests__/sharePending.test.jsx && cd ../server && ./node_modules/.bin/vitest run __tests__/extensionClip.test.js __tests__/extensionSettings.test.js`
Expected: all pass. `sharePending.test.jsx` will need its expectation updated from "posts to /share" to "stages and redirects" — **invert it with the old reasoning kept in a comment**, do not delete it.

- [ ] **Step 9: Commit**

```bash
git add extension client/src/ui/SharePending.jsx client/src/__tests__/sharePendingRoutes.test.jsx client/src/__tests__/sharePending.test.jsx server/__tests__/extensionClip.test.js
git commit -m "feat: a second menu item opens the placement window; every sender routes through it"
```

---

### Task 13: Watch it work on prod

**Files:**
- Create: `_placewindow.mjs` (repo root, gitignored probe)

No unit test replaces this. The repo's record on this exact class is explicit: the chart's `nodeClick`, the pointer-capture bug that ate every click, and the spread that was full-screen in the stylesheet while rendering in a quadrant — three defects a real browser found and no unit test could.

- [ ] **Step 1: Run the full suites**

```bash
cd server && ./node_modules/.bin/vitest run
cd ../client && ./node_modules/.bin/vitest run
```
Expected: server 2,784+ / 0 fail; client 5,245+ with only the documented `accountBalances` timeout in a full run (re-run it alone to confirm it passes).

- [ ] **Step 2: Deploy**

```bash
./deploy.sh "feat: the share placement window"
```
Server files changed, so this restarts. Confirm the script says it restarted.

- [ ] **Step 3: Drive the window against the real IMDb clip**

```bash
cd /home/joshpoms/moduli
export S=/tmp/claude-1000/-home-joshpoms-moduli/<session>/scratchpad
MONGO_URI="$(grep -m1 '^MONGO_URI=' server/.env | cut -d= -f2-)" \
JWT_SECRET="$(grep -m1 '^JWT_SECRET=' server/.env | cut -d= -f2-)" node _mkauth.mjs
```

Then a probe that stages a clip through the API and opens the window as the extension would:

```js
// _placewindow.mjs — stage the IMDb clip, open the window, place it in Movies.
import { chromium } from "playwright";
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync(`${process.env.S}/auth.json`, "utf8"));
const CLIP = { source: "extension", url: "https://www.imdb.com/title/tt0473488/",
  title: "A Guide to Recognizing Your Saints (2006) IMDb", shape: "link" };
const r = await fetch("https://viafluere.com/api/v1/share/stage", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${A.token}` },
  body: JSON.stringify(CLIP),
});
const { stageId, key } = await r.json();
console.log("staged:", stageId);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 500, height: 660 } });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.addInitScript((a) => { localStorage.setItem("moduli-token", a.token); localStorage.setItem("moduli-userId", a.userId); }, A);
await page.goto(`https://viafluere.com/share-place?stage=${stageId}&k=${key}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
console.log("window text:", (await page.innerText("body")).slice(0, 400));
await page.screenshot({ path: `${process.env.S}/place-window.png` });
await browser.close();
```

- [ ] **Step 4: Check each claim, in order**

1. The window renders the clip's title and URL, and Auto names **`Share: link`** (not the catch-all).
2. `New` → typing `mov` lists **`Movies`** with the crumb `Boards › Media` and **993**.
3. Picking it reports the shape as `artifact/movie`.
4. Add `Year`, source `page title`, transform `extract year` → the box reads **2006**.
5. Press Clip → the window closes.
6. In Mongo: one new occurrence under `0cti4si13ijy` with `role: artifact`, `kind: movie`, `Year = 2006`, `Board Category = movie`, and the same six bindings its siblings have.
7. `grid.shareLog`'s newest entry names **`Placed by hand`**.
8. Re-running the same probe **updates that row rather than adding a second** (the externalId dedupe).
9. Look at the screenshot. A popup that works and reads badly is not done.

- [ ] **Step 5: Remove the probe row**

The placement is real data on poms grid. Delete it through the app's own `delete_occurrence` (the pattern in `server/scripts/_bssweep.mjs`), behind a guard that re-checks it is the row the probe made, and confirm the Movies container is back to 993.

- [ ] **Step 6: Document and commit**

Add an entry to `CLAUDE.md` and to `client/src/ui/CLAUDE.md` + `server/CLAUDE.md` naming: the stage key's blast radius, the `bindingsLike` reuse, and anything the browser found that the tests did not.

```bash
git add -A && git commit -m "docs: the share placement window, watched working on prod"
```

---

## Self-Review

**Spec coverage.** §1 the IMDb case → Tasks 8/10/13. §2 nothing rebuilt → Task 5 reuses `runOperationServerSide`, Task 9 reuses the `main.jsx` share-path pattern. §3 the flow → Tasks 3, 12. §4 the window → Tasks 9, 10. §5 presets → Task 11. §6 the four server pieces → Tasks 2, 3, 4, 6, 7. §7 one writer → Task 5's first test. §8 testing → every task, plus Task 13. §9 one pass → presets are Task 11, not deferred. §10 out of scope → no task adds conditions to presets or a second field picker.

**Two places where the plan is thinner than the code will need**, called out rather than hidden:

1. **`authAndLimit` gaining `allowPreAuthed`** (Task 6, Step 3) touches every route that uses it. The step says to add one early-return line; whoever implements it must run the whole server suite, not just the share ones, and confirm no other route can reach it with `req.userId` already set.
2. **`destinationSearch`'s crumb walk** was written wrong in the first draft of this plan and is worth knowing about: it resolved ancestor labels with `Occurrence.find({ userId, gridId })` — every row on the grid, which is exactly the cost this endpoint exists to avoid. It now walks up one level at a time with an `$in` over only the parents reached, and a test asserts **every** occurrence query is scoped by `moduleId` or `id`. Task 4 Step 6 still measures it against poms, because a bound on the query shape is not a measurement of latency.

**Type consistency.** `placement` is `{ parentId, role, kind, bindingsLike?, bindFields?, fields }` in Tasks 5, 6, 8 and 10. `shape` is `{ role, kind, bindingsLike, bindFields, autoFields }` in Tasks 8, 10, 11. A `mapping` is `{ source, transform?, value?, override? }` in Tasks 1, 8, 10, 11. `createStage` returns `{ stageId, key }` in Tasks 2, 3, 12.
