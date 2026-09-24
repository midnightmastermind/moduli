# Share → Import Routing: Phone & Windows Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moduli appears in the Android share sheet and in Windows' share and "open with" menus, feeding the rules engine Plans 1 and 2 already built.

**Architecture:** No native app. One web-app manifest gains `share_target`, `file_handlers` and `protocol_handlers`; a service worker catches the share POST (which carries no `Authorization` header) and hands it to a page that re-sends it with the Bearer token.

**Tech Stack:** Web App Manifest · Service Worker · React route · multer

**Spec:** `docs/superpowers/specs/2026-09-23-share-import-routing-design.md` (§8, §11, D1, D14)

**Depends on:** Plan 1 (the `/api/v1/share` endpoint and the rules engine). Plan 2 is not required — transport is content-agnostic — but sharing an `.ics` is the acceptance test, so do Plan 2 first if you want the headline case.

## Progress (updated 2026-09-24)

| task | state |
|---|---|
| 1 verify on device | **installability confirmed by the user** (Android/Chrome, Windows/Edge); share-sheet and "Open with" can only be checked after this deploys |
| 2 upload cap | done (with the engine plan's file shares) |
| 3 stash | done — differently, see below |
| 4 manifest + worker + pending page | done; **needs the on-phone check (Step 6)** |
| 5 Windows open-with + webcal | done in code (manifest + `launchQueue`); needs the on-Windows check |
| 6 seed poms' rules | **done 2026-09-24** (data, via the API): ics → Tasks › Appointments, link → Bookmarks, image, video; the `*` catch-all mints itself on the first share. Needs Step 2's by-sharing check after deploy |

**Where the code differs from the sketches:**
- **No IndexedDB stash.** The worker keeps the ORIGINAL share form in Cache Storage
  (`new Response(formData)`), and the page reads it back with `response.formData()`. The form is the
  one shape; only the cache name and key are shared, and a test reads `sw.js` to keep them equal
  (the worker is a classic script and cannot import the helper). Consumed on read.
- **Auth:** the page sends the signed-in SESSION (`localStorage["moduli-token"]`) as the Bearer;
  `POST /share` alone accepts it (`apiAuth({ allowSessionJwt })`), every other route still refuses it.
- **`sw.js` answers exactly one request** (POST /share-target) and passes everything else through —
  no caching, no offline mode. Redirect URLs are absolute (built from the request).
- **Server fallback:** `POST /share-target` with no worker installed yet → 303 to the pending page
  saying to open Moduli once and share again (not a 404).
- **The pending page** (`/share-pending`, `/share-target`) is its own entry in `main.jsx`, rendered
  without the grid, so it works signed out ("Sign in, then share again") and never shows an empty grid.
- `sw.js` is tested by running the REAL file in a simulated worker scope.
## Global Constraints

- **Auth stays `Bearer`-only.** Verified: no cookie middleware anywhere in `server/`. **Do not add cookie auth to make the share POST easier** — the service-worker hand-off is the design (spec §8).
- **A share must never silently vanish.** If auth fails or the payload is lost, the page says so (spec §12). Redirecting to an empty grid is the failure mode to avoid.
- **§11's four claims are UNVERIFIED** and Task 1 exists to verify them before anything is built on top. They are documented capabilities, not measurements.
- **Deploy:** `./deploy.sh "<msg>"`. A manifest or service-worker change is client-only, so it will correctly report *"Server unchanged — NOT restarting"* — except Task 2, which touches multer.
- **Verify by doing the thing**, on the real phone and the real Windows machine. Nothing in this plan can be proven headlessly.

---

## File Structure

**Created**

| file | responsibility |
|---|---|
| `client/public/sw.js` | Service worker. Catches `POST /share-target`, stashes the payload, redirects to the pending page. |
| `client/src/ui/SharePending.jsx` | The page that reads the stash, attaches the Bearer token, posts to `/api/v1/share`, and reports the outcome. |
| `client/src/helpers/shareStash.js` | IndexedDB read/write for the stashed payload. One module so the SW and the page cannot disagree about the shape. |
| `client/src/__tests__/shareStash.test.js` | |

**Modified**

| file | change |
|---|---|
| `client/public/manifest.json` | `share_target`, `file_handlers`, `protocol_handlers`, and whatever installability needs. |
| `client/src/main.jsx` | Register the service worker; route `/share-pending`. |
| `server/server.js` | Raise the multer cap for the share path (D14). |

---

## Task 1: Verify the four unknowns before building on them

Spec §11 lists four claims this plan rests on that have **never been measured**. A plan that builds on them without checking is how a week disappears.

**Files:** none — this task produces findings, not code.

- [ ] **Step 1: Install the PWA on the Android device and record what it took**

Serve the current build, open it in Chrome on the phone, and try to install it. Record: did the install prompt appear? Did it require a service worker with a fetch handler, or only manifest + icons + HTTPS?

Expected finding: one of *"installs with manifest alone"* or *"requires a service worker"*. Either is fine; the point is knowing before Task 3.

- [ ] **Step 2: Confirm an installed PWA can appear in the Windows share sheet**

Install the same PWA on Windows via Edge or Chrome, then press Share on a file in Explorer. Record whether Moduli appears as a target.

**If it does not, say so and stop building Task 5** — Windows share would then need a different mechanism, and that is a finding, not a failure to work around.

- [ ] **Step 3: Confirm `file_handlers` can claim `text/calendar` on Windows**

With the PWA installed and a `file_handlers` entry for `.ics`, check whether Moduli appears under "Open with" for an `.ics` file.

- [ ] **Step 4: Decide the ics library question if Plan 2 has not already**

If Plan 2 ran first, this is already answered by its timezone tests. If not, note that Plan 2 Task 1 decides it.

- [ ] **Step 5: Record the findings in the spec**

Update spec §11 in place, turning each unverified claim into a measured statement with the date and the device. Commit:

```bash
git add docs/superpowers/specs/2026-09-23-share-import-routing-design.md
git commit -m "docs(share): §11 verified on device — <one line per finding>"
```

---

## Task 2: Raise the upload cap for shares

> **Done 2026-09-24** with the engine plan's file shares: `server/config/uploadLimits.js`, a separate
> 500 MB multer for `/api/v1/share`, and the nginx `location = /api/v1/share` block.

**Files:**
- Modify: `server/server.js:497` (`const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });`)
- Create: `server/__tests__/shareUploadLimit.test.js`

**D14: 500 MB.** Phone video is one of the named types and routinely exceeds 50 MB.

**Interfaces:**
- Produces: `SHARE_MAX_BYTES` exported from `server/server.js` (or a small `server/config/uploadLimits.js` if that keeps `server.js` tidier), used by both the multer instance and the error message.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareUploadLimit.test.js
//
// D14 — a phone video routinely exceeds the old 50 MB cap, and video is one of
// the types the feature exists for. The failure must NAME the size and the
// limit; "upload failed" sends you looking in the wrong place.
import { describe, it, expect } from "vitest";
import { SHARE_MAX_BYTES, describeTooLarge } from "../config/uploadLimits.js";

describe("share upload limits", () => {
  it("allows 500 MB", () => {
    expect(SHARE_MAX_BYTES).toBe(500 * 1024 * 1024);
  });

  it("names both the size and the limit when refusing", () => {
    const msg = describeTooLarge(220 * 1024 * 1024);
    expect(msg).toMatch(/220/);
    expect(msg).toMatch(/500/);
  });

  it("still refuses something larger than the new cap", () => {
    expect(describeTooLarge(900 * 1024 * 1024)).toMatch(/900/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/shareUploadLimit.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/config/uploadLimits.js
//
// D14 — the share path takes 500 MB. The artifact-upload path keeps its own
// 50 MB: raising a limit for one entry point is a smaller claim than raising it
// for every uploader in the app.
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
export const SHARE_MAX_BYTES = 500 * 1024 * 1024;

const mb = (b) => Math.round(b / 1024 / 1024);

export function describeTooLarge(sizeBytes, limit = SHARE_MAX_BYTES) {
  return `Too large to share (${mb(sizeBytes)} MB, limit ${mb(limit)} MB)`;
}
```

Then give the `/share` route its own multer instance with `limits: { fileSize: SHARE_MAX_BYTES }`, leaving `/api/artifacts/upload` on the existing cap.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/shareUploadLimit.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Check the disk before trusting the number**

500 MB uploads buffer to a temp file. Confirm the droplet has room:

```bash
ssh deploy@viafluere.com 'df -h /var/www/moduli /tmp | tail -3'
```
If free space is tight, **report it** rather than shipping a limit the disk cannot honour.

- [ ] **Step 6: Commit**

```bash
git add server/config/uploadLimits.js server/server.js server/routes/apiV1.js server/__tests__/shareUploadLimit.test.js
git commit -m "feat(share): 500 MB cap on the share path only (D14)"
```

---

## Task 3: The stash — one shape the SW and the page agree on

The share POST carries no token. The service worker catches it, stashes it, and a page re-sends it with the Bearer. Both halves must agree about the stash's shape, so it lives in one module.

**Files:**
- Create: `client/src/helpers/shareStash.js`
- Create: `client/src/__tests__/shareStash.test.js`

**Interfaces:**
- Produces: `stashShare(payload) → Promise<string>` (returns an id) and `takeShare(id) → Promise<payload | null>`. `payload` is `{ title, text, url, files: [{ name, type, blob }] }`.
- **`takeShare` removes the entry** — a stash read twice would double-post the share.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/shareStash.test.js
//
// The SW writes and the PAGE reads. Two modules with their own idea of the
// shape is how the halves drift; this is the one definition.
//
// takeShare REMOVES: a stash read twice double-posts the share, which with
// externalId dedup would be invisible for links and duplicate rows for text.
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { stashShare, takeShare } from "../helpers/shareStash.js";

describe("shareStash", () => {
  it("round-trips a text share", async () => {
    const id = await stashShare({ title: "T", text: "hello", url: null, files: [] });
    const got = await takeShare(id);
    expect(got.text).toBe("hello");
    expect(got.title).toBe("T");
  });

  it("round-trips a file share, preserving name and type", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const id = await stashShare({ files: [{ name: "m.ics", type: "text/calendar", blob }] });
    const got = await takeShare(id);
    expect(got.files[0].name).toBe("m.ics");
    expect(got.files[0].type).toBe("text/calendar");
    expect(await got.files[0].blob.text()).toContain("VCALENDAR");
  });

  it("is consumed on read — a second take returns null", async () => {
    const id = await stashShare({ text: "once" });
    expect(await takeShare(id)).toBeTruthy();
    expect(await takeShare(id)).toBe(null);
  });

  it("returns null for an unknown id rather than throwing", async () => {
    expect(await takeShare("nope")).toBe(null);
  });

  it("keeps two concurrent shares apart", async () => {
    const a = await stashShare({ text: "a" });
    const b = await stashShare({ text: "b" });
    expect((await takeShare(b)).text).toBe("b");
    expect((await takeShare(a)).text).toBe("a");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd client && npm install -D fake-indexeddb
./node_modules/.bin/vitest run src/__tests__/shareStash.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// client/src/helpers/shareStash.js
//
// A shared payload arrives as a POST with NO Authorization header (the server
// is Bearer-only and has no cookies). The service worker cannot read
// localStorage, so it stashes the payload here and a PAGE — which can read the
// token — picks it up and posts it properly.
//
// `takeShare` DELETES on read: a stash read twice posts the share twice.
const DB = "moduli-share", STORE = "pending";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out.result ?? out);
    t.onerror = () => reject(t.error);
  });
};

export async function stashShare(payload) {
  const id = (crypto.randomUUID?.() || String(Date.now()));
  await tx("readwrite", (s) => s.put(payload, id));
  return id;
}

export async function takeShare(id) {
  const got = await tx("readonly", (s) => s.get(id));
  if (!got) return null;
  await tx("readwrite", (s) => s.delete(id));
  return got;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/shareStash.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/shareStash.js client/src/__tests__/shareStash.test.js client/package.json
git commit -m "feat(share): one stash shape the service worker and the page agree on"
```

---

## Task 4: Manifest, service worker, and the pending page

**Files:**
- Modify: `client/public/manifest.json`
- Create: `client/public/sw.js`
- Create: `client/src/ui/SharePending.jsx`
- Modify: `client/src/main.jsx`

- [ ] **Step 1: Add the manifest entries**

```json
  "share_target": {
    "action": "/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [{ "name": "files",
                  "accept": ["text/calendar", "image/*", "video/*", "audio/*",
                             "application/pdf", "*/*"] }]
    }
  }
```

- [ ] **Step 2: Write the service worker**

```js
// client/public/sw.js
//
// A share_target POST lands here as a FORM NAVIGATION — no Authorization
// header, and the server is Bearer-only (no cookies anywhere). So this stashes
// the payload and redirects to a page that CAN read the token.
//
// 303 is required: it turns the POST into a GET so a reload does not re-submit.
importScripts("/share-stash-sw.js");   // the stash helpers, built for SW scope

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;

  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const files = await Promise.all(
        form.getAll("files").filter(Boolean).map(async (f) => ({
          name: f.name, type: f.type, blob: f,
        })));
      const id = await stashShare({
        title: form.get("title"), text: form.get("text"),
        url: form.get("url"), files,
      });
      return Response.redirect(`/share-pending?id=${id}`, 303);
    } catch (err) {
      // A share must never silently vanish (spec §12).
      return Response.redirect(`/share-pending?error=${encodeURIComponent(String(err))}`, 303);
    }
  })());
});
```

- [ ] **Step 3: Write the pending page**

```jsx
// client/src/ui/SharePending.jsx
//
// Reads the stash, attaches the Bearer token, posts to /api/v1/share and SAYS
// WHAT HAPPENED. The failure modes here are the ones that matter: a share must
// never vanish silently, and it must never redirect to an empty grid looking
// like it worked (spec §12).
import { useEffect, useState } from "react";
import { takeShare } from "../helpers/shareStash.js";

export default function SharePending() {
  const [state, setState] = useState({ status: "working" });

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.get("error")) return setState({ status: "error", message: params.get("error") });

      const payload = await takeShare(params.get("id"));
      if (!payload) return setState({ status: "error", message: "That share was already handled." });

      const token = localStorage.getItem("moduli-token");
      if (!token) return setState({ status: "error", message: "Sign in to Moduli, then share again." });

      const fd = new FormData();
      for (const k of ["title", "text", "url"]) if (payload[k]) fd.append(k, payload[k]);
      fd.append("source", "android");
      fd.append("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      for (const f of payload.files || []) fd.append("files", f.blob, f.name);

      const res = await fetch("/api/v1/share", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ status: "error", message: body.message || `Failed (${res.status})` });

      const created = (body.ran || []).flatMap(r => r.created || []);
      setState({ status: "done", type: body.type, count: created.length,
                 rule: body.ran?.[0]?.ruleName, notices: body.notices || [] });
    })().catch(err => setState({ status: "error", message: String(err?.message || err) }));
  }, []);

  if (state.status === "working") return <p>Filing your share…</p>;
  if (state.status === "error") return <p role="alert">Couldn’t file that: {state.message}</p>;
  return (
    <div>
      <p>Filed {state.count} item{state.count === 1 ? "" : "s"} via “{state.rule}”.</p>
      {state.notices.map(n => <p key={n}>{n}</p>)}
      <a href="/">Open Moduli</a>
    </div>
  );
}
```

- [ ] **Step 4: Register the worker and the route** in `client/src/main.jsx`.

- [ ] **Step 5: Build and deploy**

```bash
cd /home/joshpoms/moduli && ./deploy.sh "feat(share): Android share target"
```
Expect *"Server unchanged — NOT restarting"* unless Task 2 shipped in the same run.

- [ ] **Step 6: VERIFY ON THE PHONE BY DOING IT**

Share a link, an image, and (if Plan 2 shipped) an `.ics` from the Android share sheet. For each: does Moduli appear as a target, does the pending page report what it filed, and is the row in the grid? Read at least one back out of Mongo.

Then the failure path: sign out and share again — the page must say *"Sign in to Moduli, then share again"* rather than land on an empty grid.

- [ ] **Step 7: Commit with the observed results**

```bash
git add client/public/manifest.json client/public/sw.js client/src/ui/SharePending.jsx client/src/main.jsx
git commit -m "feat(share): Moduli is an Android share target

<paste what was shared, what the page said, what Mongo held>"
```

---

## Task 5: Windows — share sheet, "open with", and `webcal://`

**Gated on Task 1 Steps 2–3.** If the PWA did not appear in the Windows share sheet, stop and report that instead.

**Files:**
- Modify: `client/public/manifest.json`

- [ ] **Step 1: Add the handlers**

```json
  "file_handlers": [
    { "action": "/share-target",
      "accept": { "text/calendar": [".ics", ".ical"] } }
  ],
  "protocol_handlers": [
    { "protocol": "webcal", "url": "/share-target?url=%s" }
  ]
```

`file_handlers` delivers a **launch** with files rather than a POST, so the pending page must also read `launchQueue` when present:

```js
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (files?.length) { /* same post path, with these file handles */ }
  });
}
```

- [ ] **Step 2: Deploy, reinstall the PWA on Windows, and do it**

Right-click an `.ics` → Open with → Moduli. Then press Share on a file in Explorer and pick Moduli. Record both outcomes.

- [ ] **Step 3: Commit with the observed results**

```bash
git add client/public/manifest.json client/src/ui/SharePending.jsx
git commit -m "feat(share): Windows open-with for .ics and webcal:// links

<paste what Windows offered and what landed>"
```

---

## Task 6: Seed poms' typed rules

**D19 — data, not code.** These name containers that exist only on poms, which is why bootstrap cannot invent them (D18).

**Files:** none. Authored through the Imports tab.

- [ ] **Step 1: Create the four rules**

| type | destination |
|---|---|
| `ics` | Appointments (the Plan 2 rule, if it shipped) |
| `image` | Files / Images |
| `video` | Files |
| `link` | Bookmarks |

The `*` catch-all already exists from Plan 1's bootstrap — **do not create a second one.** Confirm there is exactly one.

- [ ] **Step 2: Verify each by sharing one of each type**

Share a link, an image, a video and an `.ics`. Confirm each lands where its rule says, and that the Imports log names the matching rule for each.

- [ ] **Step 3: Confirm the catch-all still works**

Share a `.zip`. It should land in Files via the catch-all, proving no typed rule swallowed it and the catch-all still runs last.

- [ ] **Step 4: Record**

```bash
git commit --allow-empty -m "verify(share): poms' typed rules seeded and each verified by sharing

<one line per type: what was shared, which rule matched, where it landed>"
```

---

## Self-Review

**Spec coverage.** §11 verification → Task 1 · D14 cap → Task 2 · §8 auth hand-off → Tasks 3, 4 · D1 Android → Task 4 · D1 Windows + `webcal://` → Task 5 · D19 poms seeding → Task 6.

**Placeholders.** None in the code steps. Task 5 Step 1's `launchQueue` consumer body is deliberately elided with a comment pointing at the post path defined in full in Task 4 — the same code, not an unwritten one.

**Type consistency.** `stashShare(payload) → id` and `takeShare(id) → payload | null` (Task 3) are used with exactly those signatures by the service worker and the pending page (Task 4). The payload shape `{ title, text, url, files: [{ name, type, blob }] }` is written by the SW and read by the page unchanged. `SHARE_MAX_BYTES` (Task 2) is consumed by the `/share` multer instance.

**Two risks, both real.**
1. **Task 1 can invalidate Tasks 4–5.** If Windows does not offer PWAs as share targets, or installability blocks on something unexpected, that is a finding to report — not something to engineer around. The plan is ordered so this is discovered first.
2. **`launchQueue` and `share_target` are different delivery mechanisms** for what the user experiences as the same gesture. The pending page has to handle both, and Task 5 is where that divergence lands.
