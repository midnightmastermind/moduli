# Share → Import Routing

**Date:** 2026-09-23
**Status:** design approved, not implemented

Share things *to* Moduli — from the Android share sheet, from Windows, from the
browser — and let per-type rules decide what becomes of each one.

> **USER, 2026-09-23:** *"we need to create a plan for share options. share from
> phone or browser. this share functionality will allow us to choose what happens
> with these imports (from the command center tab imports). for example, we can
> say what to do with ics files being shared to the app … we want other options
> as well, what happens to images, videos, bookmarks, etc."*
> → *"this is sharing **to** the app btw"*

---

## 1. What already exists (and therefore is not being built)

The single most important fact about this feature: **almost every handler it
needs is already in production.** This is a routing and configuration layer, not
a second set of importers.

| shared thing | the code that already handles it |
|---|---|
| image / video / any file | `POST /api/artifacts/upload` (sha256 dedup, thumbnails, EXIF) |
| link → bookmark record | `POST /api/v1/bookmarks` → `addBookmarkOccurrence` |
| link → whole page | `POST /api/v1/import/url` → `utils/linkImport` |
| text / HTML | `services/markdownImporter` via `/import/html` |
| a generic labelled row with fields | `POST /api/v1/ingest` |
| **`.ics` calendar** | **nothing — the one new content handler** |

Verified 2026-09-23: `grep -rn "VEVENT\|DTSTART\|BEGIN:VCALENDAR\|text/calendar"`
across `server/`, `client/src/` and `extension/` returns **nothing**, and neither
`package.json` carries an ics/ical/rrule dependency.

Three further pieces of existing machinery this design leans on:

- **`POST /api/v1/ingest` carries an `externalId` idempotency key.**
  `extension/clip.js`: *"IDENTITY IS THE URL, per shape. Clipping the same page
  twice updates one row."* Shares inherit this — see §7.
- **`extension/` is a working browser extension** ("Moduli Companion") that
  already clips via `/api/v1/ingest`, resolving field ids by name from
  `GET /api/v1/fields`. It is the first transport, not a new one.
- **`ui/commandCenter/PrefillEditor.jsx`** is already a row-per-mapping editor
  (*"read THIS field on the thing I picked, write it to THAT field"*). The
  Imports tab borrows its grammar rather than inventing a second one.

**What is NOT reused, deliberately:** `helpers/intakeApply.js`, the client-side
intake router. See §9.

---

## 2. Decisions

Each was settled with the user on 2026-09-23.

| # | Decision | Rationale |
|---|---|---|
| D1 | Entry points: **Android share sheet, Windows share + "open with", browser extension** | All three ride the same web-app manifest; no native app. |
| D2 | A share **lands immediately at a destination named by a rule** | User chose this over an inbox/triage model. |
| D3 | **A catch-all rule always matches**, shipped pointing at a Files folder | No share can fail for lack of a rule; no second mechanism to build. |
| D4 | **`.ics` → one row per VEVENT**, `SUMMARY` → the row **label** | Feeds the existing `Schedule: Place Dated Work` pipeline via Date / Time Slot / Duration. |
| D5 | **Mapping is variable binding**, not a bespoke mapping table | `$share.*` → `$vars` → actions. The operations language already does this. |
| D6 | **Rules are authored in the Command Center Imports tab**, reusing the operations *components* | User: *"we shouldnt actually use the operations ui though we should add it to be used in the cc import rules"* — you never leave for the Operations tab. |
| D7 | **All execution is server-side**; `serverExecutor` gains `CREATE` + `FIND` | One execution path for every entry point; the extension genuinely has no tab. |
| D8 | **One rule per type**, branching *inside* that rule | User: *"ics -> looks for Brews -> do something with Brews one. so the operation kinda handles that."* |
| D9 | A rule may **halt the chain** | Escape hatch if a type ever needs two rules. |
| D10 | A **`shareGrid` setting** names the default grid; a rule may override it | Prevents shares landing in a test grid. |
| D11 | ics time **floors to the slot it falls inside** | 2:17pm → "2:00pm". Never moves an event earlier than it starts. |
| D12 | **Recurring events import the first occurrence only**, with a notice | Better than silently creating one row when fifty were expected. |
| D13 | Build order: **extension → endpoint → rule → row**, then ics, then phone, then Windows | The extension needs no new transport, so the spine is proved with the least new surface. |
| D14 | **Raise the share upload cap to 500 MB** (from 50 MB) | Phone video is one of the named types and routinely exceeds 50 MB. |
| D15 | **The extension re-routes through `/share`**, with a shipped `link` rule reproducing today's clip shape | One path for everything; day-one behaviour is unchanged but becomes configurable. |
| D16 | **The Imports tab carries a recent-shares log** | With no inbox (D2), a log is the only way to notice a rule sending things to the wrong place. |
| D17 | The ics `CREATE` **binds** Schedule Type / Date / Time Slot / Duration, Schedule Type left empty | `Schedule: Place Dated Work` gates on the *binding*, not the value — so binding is what puts the event on the Schedule. |

### A correction recorded, not quietly dropped

An earlier draft justified server-side execution with *"the app is closed."*
**That is only true of the extension.** Sharing to an installed PWA *launches the
PWA* — that is the mechanism of `share_target`. So:

| entry point | is a tab available? |
|---|---|
| Android share sheet | **yes** — the share launches the app |
| Windows share / open-with | **yes** — same |
| browser extension clip | **no** |

D7 still stands, on the surviving reasons: one execution path rather than
behaviour that differs by entry point, and the extension case is real. The
decision does not rest on the claim that was wrong.

---

## 3. Architecture

```
Android share sheet ─┐
Windows share        ├─→ POST /api/v1/share ─→ INGRESS ──→ RULE ENGINE ──→ existing services
"Open with" an .ics ─┤                          prepare      onShare op
browser extension   ─┘                          $share       (server-side)
```

**Ingress prepares; the rule routes.** The endpoint does all mechanical work
*before* any rule runs:

- files are uploaded to artifacts (so a rule never handles a binary),
- `.ics` is parsed into events,
- link metadata is fetched.

The rule then sees clean, flat data. This is what makes `LOOP $share.events`
expressible, and it keeps the rule language free of I/O.

### `$share` — the payload a rule sees

```js
$share = {
  type:   "ics" | "image" | "video" | "audio" | "pdf" | "file" | "link" | "text" | "html",
  source: "android" | "windows" | "extension" | "api",
  receivedAt: "<ISO>",
  // per-type properties, below
}
```

Classification is **coarse and token-based** — a rule matches a token, not a
regex — from MIME type plus extension plus payload shape.

### Property catalogues

These are fixed, documented lists. They are what makes the Imports tab's
variable picker buildable, and a property not on this list does not exist.

| type | properties |
|---|---|
| **ics** | `events[]` of `{ summary, start:{date,time,timeSlot}, end:{date,time,timeSlot}, durationMin, allDay, location, description, organizer, uid, recurring }` |
| **link** | `url · title · description · siteName · image · favicon` |
| **image** | `fileRef · occurrenceId · filename · mimeType · width · height · exif.DateTimeOriginal · exif.GPSLatitude · exif.GPSLongitude` |
| **video / audio / pdf / file** | `fileRef · occurrenceId · filename · mimeType · sizeBytes` |
| **text / html** | `text · firstLine · html` |

Files are **already uploaded** by the time a rule runs, which is why
`occurrenceId` and `fileRef` are available as properties.

---

## 4. The rule model

A rule is an **operation pipeline** with an `onShare` trigger, stored and
executed exactly like every other operation — but authored in the Imports tab.

```
On Share · type = ics
  $events = $share.events
  LOOP $events as $e
    $title = $e.summary
    $when  = $e.start.date
    $slot  = $e.start.timeSlot
    IF $title CONTAINS "Brews"
      CREATE instance in <Employment>
        label = $title · Date = $when · Time Slot = $slot · Duration = $e.durationMin
    ELSE
      CREATE instance in <Appointments>
        label = $title · Date = $when · Time Slot = $slot · Duration = $e.durationMin
```

- **One rule per type** (D8). Branching lives inside the pipeline, which is why
  the earlier "first match vs all match" question largely dissolves.
- **Ordering + halt.** Rules run in operation `priority` order. Because there is
  one rule per type (D8), ordering matters in exactly one place: **the catch-all
  runs last**, and is reached only when no typed rule handled the share.
- **Halting.** A rule stops the chain by setting the reserved variable
  `$share.handled = true` via an ordinary `SET_VAR`. The engine checks it between
  rules. No new action type is introduced for this (D9).
- **The catch-all** is the rule whose trigger type is `*` (D3). It matches every
  share, so it must be the lowest priority or it would swallow everything.
- **Grid.** The share resolves to `user.meta.share.gridId` unless the rule names
  its own (D10). Because rules *are* operations, they are stored on the grid
  whose containers they reference.

### Storage

```js
user.meta.share = {
  gridId: "<the designated share grid>",
  // rules themselves are Operation records on that grid, trigger onShare
}
```

Rules live as Operations rather than as a bespoke record type so the executor,
the editor components, the run log and the existing trigger plumbing all apply
unchanged.

---

## 5. Server executor extension

`server/services/serverExecutor.js` is today a deliberate subset. Its own header:

> handles `INIT_VAR / SET_VAR / IF / LOOP / CALL_API / SHOW_VALUE` … *"The full
> client-side executor handles dozens more action types (FIND / CREATE /
> COPY_LINK / APPLY_TEMPLATE …) — anything beyond the subset above needs a
> connected browser tab today. Phase 4+ work will either port the full executor
> server-side or refactor the client one into a shared isomorphic module."*

**This feature pays off the first slice of that docket item.** A share rule needs
`IF`, `SET_VAR`, `LOOP` — all present — plus:

- **`CREATE`** — mint an occurrence (and module) under a named parent, with
  `fields` **and `fieldBindings`**. Wires to the same minting the
  `/api/v1/ingest` route and `markdownImporter.mintEntities` already perform; it
  is not written from scratch.
  **Bindings are not optional polish** (D17): ops gate on
  `_boundFieldIds`, and a value written to an unbound field renders nowhere. A
  `CREATE` that can set values but not bindings would produce rows that look
  right in Mongo and are invisible to both the Schedule and the UI.
- **`FIND`** — resolve a destination container, or an existing option row, by
  predicate.

**Scope discipline:** only these two are added. Anything else a share rule turns
out to need is a separate decision, recorded rather than smuggled in. The subset
comment in `serverExecutor.js` must be updated in the same commit — a stale
capability comment is worse than none.

---

## 6. The ics handler — `server/services/icsImport.js`

The only genuinely new content code.

**Parse** `BEGIN:VCALENDAR` → `VEVENT`s. Needs an ics parser dependency (none
present today); evaluate `node-ical` / `ical.js` for footprint and timezone
correctness before choosing.

**Map** to the catalogue in §3. Two rules settled with the user:

- **`timeSlot` floors to the slot it falls inside** (D11). 2:17pm → `"2:00pm"`;
  2:55pm → `"2:30pm"`. Slot labels come from the destination's own slot
  vocabulary, not a hardcoded list — the Schedule's slot labels are data.
- **A recurring event imports its first occurrence only** (D12), sets
  `recurring: true`, and the ingress reports *"recurrence not imported"*. `RRULE`
  expansion is explicitly out of scope for v1 (§10).

**`durationMin`** is `DTEND - DTSTART` in minutes; an all-day event sets
`allDay: true` and leaves `timeSlot` null.

**The created row must BIND the four fields, not merely carry values** (D17).
`Schedule: Place Dated Work` gates on
`_boundFieldIds ARRAY_INCLUDES <Schedule Type>` — the binding, not the value —
so a row with values and no bindings is invisible to the Schedule. The shipped
ics rule therefore binds Schedule Type (left empty, since `SUMMARY` goes to the
label), Date, Time Slot and Duration. This is the same shape the `Work` row in
`Routines › Occupational › Employment` carries.

**Consequence for the `CREATE` action** (§5): it must be able to declare
`fieldBindings`, not just `fields`. A value written to an unbound field renders
nowhere — the defect `addNewOption.js` already records ("*an ingredient module
did not BIND the macro fields at all*").

**Timezones are a correctness trap, not a detail.** `DTSTART` may carry a
`TZID`, be UTC (`Z`-suffixed), or be floating. The parser must resolve to the
user's local date before deriving `date` and `timeSlot`, or an evening event
lands on the wrong day. This wants an explicit test per form.

---

## 7. Idempotency

`externalId` — the key `/api/v1/ingest` already implements.

| type | externalId |
|---|---|
| ics event | `ics:<UID>` |
| link | `<shape>:<url>` (the extension's existing scheme) |
| file | `sha256:<hash>` (the upload endpoint already computes it) |

Re-sharing an updated invite **updates the existing row** rather than adding a
second. This is why `uid` appears in the ics catalogue.

---

## 8. Transport per entry point

### Browser extension (first slice)
Already has transport and a Bearer token. It **re-routes** through
`/api/v1/share` instead of minting a clip record directly (D15), so the same
rules govern a clip and a phone share of the same link.

**Day-one behaviour must be identical.** The shipped `link` rule reproduces
`buildClipRecord`'s current output exactly — bookmark shape, `externalId`
`<shape>:<url>`, the same `URL` / `Excerpt` / `Cover` field writes. The
regression test is that clipping a page before and after the change produces the
same row. From then on the rule is editable, which is the point.

### Android + Windows share sheet
Web app manifest (`client/public/manifest.json` exists; no service worker does):

```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title", "text": "text", "url": "url",
    "files": [{ "name": "files", "accept": ["text/calendar", "image/*", "video/*", "application/pdf", "*/*"] }]
  }
}
```

**Auth is the wrinkle.** Verified 2026-09-23: the server authenticates by
`Bearer` only — `grep` finds **no cookie middleware, no `res.cookie`, no
`req.cookies` anywhere**. A share POST is a form navigation and carries no
`Authorization` header. So the documented service-worker pattern applies:

1. the SW intercepts `POST /share`,
2. stashes the payload (Cache/IndexedDB) and redirects to an app route,
3. the page reads the token from `localStorage` and re-posts to
   `/api/v1/share` with `Bearer`.

A service worker is very likely needed anyway — `share_target` requires the PWA
to be *installed*, and installability has historically required one. That
requirement has been relaxed at points, so it is listed as unverified in §11
rather than asserted here.

### Windows "open with .ics" and `webcal://`
Same manifest, two more entries — `file_handlers` for `text/calendar`, and
`protocol_handlers` for `webcal`. No new server surface: both route into the
same `/share` handler.

---

## 8a. The Command Center Imports tab

The one client surface. It authors rules and shows what happened — it is **not**
in the execution path (§2 D7).

**Rules editor.** Reuses the operations components rather than a bespoke editor
(D6): the condition builder, `ActionPicker`, `ExprOrPath` and the drilldown path
picker, laid out with `PrefillEditor`'s row grammar. A rule reads as trigger
(type) → variable rows → condition/action rows. The user never leaves for the
Operations tab.

**Recent-shares log** (D16). With no inbox, this is how a bad rule is noticed:

```
13:58  ics    meeting.ics   rule: ics   → "Dentist"  → Appointments
13:41  link   nytimes.com   rule: link  → bookmark   → Bookmarks
12:02  file   notes.zip     rule: *     → file       → Files/Inbox
```

Each row names what arrived, which rule matched, what was created, and links to
the created occurrence. It is a view over the **operation run log that already
exists** (`OperationLogPanel`), not a second store — the rules are operations, so
their runs are already recorded.

Deliberately NOT built: a re-run button. It would require retaining payloads,
which means keeping uploaded files alive for shares that already landed. If
re-running turns out to matter, it is an additive change.

---

## 9. Two routers, and why that is not a mistake

This repo's most-repeated defect class is *"two implementations of one
question."* There will now be two routers, and the distinction must hold:

| | `helpers/intakeApply.js` (existing) | the share rule engine (new) |
|---|---|---|
| trigger | a drop or paste **with a pointer** | a share with **no destination** |
| decides | *which shape* — it asks the user | *which rule* — configured ahead of time |
| runs | client | server |

They answer different questions, so they are not merged. **The guard is that
neither may own a handler.** Both call the same services (§1). If a second
uploader or a second bookmark minter appears in either, the split is wrong and
should be revisited.

---

## 10. Out of scope for v1

Recorded so they are choices, not oversights:

- **`RRULE` expansion** — first occurrence only, with a notice (D12).
- **iOS.** Safari does not implement the Web Share Target API. The cheapest
  future route is an iOS Shortcut posting to `/api/v1/share`; a Share Extension
  needs a native wrapper.
- **Outbound sharing** (Moduli → elsewhere). This feature is inbound only.
- **Porting the *whole* executor server-side.** Only `CREATE` and `FIND` (§5).
- **An inbox / triage queue.** Explicitly rejected in favour of D2 + D3.
- **Contacts (`.vcf`), archives (`.zip`), Office documents** — these fall to the
  catch-all as stored files until someone writes a rule.

---

## 11. Open items to verify before building

Each is a factual claim this design rests on that has **not** been measured on
the real devices:

1. **PWA installability requirements on the target Android device** — whether a
   service worker with a fetch handler is still required for the install prompt.
2. **Windows `share_target` support** in the installed PWA (Edge/Chrome), and
   whether Windows' "add to calendar" share actually offers a PWA target.
3. **`file_handlers` registration for `text/calendar`** on Windows.
4. Which ics parsing library handles `TZID` correctly at acceptable footprint.

None blocks the first slice (D13), which uses the extension.

---

## 12. Error handling

- **No rule matched** — impossible by construction (D3); if it ever happens, the
  share is stored as a file at the default destination and reported.
- **A rule throws** — the share is not lost: ingress has already uploaded any
  file, so the artifact exists. The failure is recorded in the operation run log
  with the `$share` payload, and reported to the sharing surface.
- **Partial multi-event ics** — each event is its own `CREATE`; one failure does
  not roll back the others, and the notice names how many of how many landed.
- **Auth failure from the phone** — the share cannot silently vanish. The app
  page must say so rather than redirect to an empty grid.
- **Too large** — refused before any write, naming the size and the limit
  (D14 raises it to 500 MB; a 4K video can still exceed that).
- **Every one of the above appears in the Imports log** (§8a), which is the
  surface that makes a silent misroute visible.

---

## 13. Testing

- **Pure units, A/B'd:** ics parse → catalogue (per timezone form: `TZID`, `Z`,
  floating, all-day), slot flooring at boundaries (2:00, 2:17, 2:29, 2:30),
  `durationMin`, classification token per MIME/extension.
- **Rule engine:** a rule with conditions produces the expected `CREATE`s; the
  halt flag stops the chain; the catch-all always matches.
- **Server executor:** `CREATE`/`FIND` behaviour, and a control asserting the
  actions outside the documented subset still refuse rather than half-run.
- **Idempotency:** the same `externalId` twice updates one row — the test that
  matters most, since a duplicate is silent.
- **End to end on prod, by doing it:** right-click clip → the row appears, read
  back out of Mongo. Per this repo's standing rule, a feature is unverified
  until someone has watched it work.

---

## 14. Sequencing

1. **`serverExecutor` gains `CREATE` + `FIND`** (+ update its subset comment).
2. **`POST /api/v1/share`** — classification, ingress prep, `onShare` dispatch.
3. **Imports tab** — author one rule, reusing the operations components.
4. **Extension** posts to `/share`, plus the compatibility `link` rule and its
   before/after regression test (D15). *Tracer bullet complete: clip → row.*
5. **Recent-shares log** in the Imports tab over the existing run log (D16).
6. **`services/icsImport.js`** + the shipped ics rule, binding the four fields
   (D17).
7. **Raise the upload cap to 500 MB** for the share path (D14) — before phone
   transport, since video is the case that needs it.
8. **Manifest + service worker** → Android share.
9. **`file_handlers` / `protocol_handlers`** → Windows open-with and `webcal://`.
