# Pulling your data into Moduli

**Scope:** how to get existing (backfill) and new (live) data from 12 external sources into
Moduli as occurrences + field values, plus how to hand-enter the 5 things that have no source,
plus a brainstorm of what else is worth pulling.

**Status:** §0–§3 describe code that is **live in production** as of 2026-08-07 (prod HEAD
`49f1428e`), covered by 18 tests in `server/__tests__/apiIngest.test.js`. The `/ingest` endpoint and
the three write-path fixes it depends on were built while writing this guide. §4 per-source routes
are researched recommendations; each names what to verify on your own account before building it.
§7 is speculative on purpose.

**Revised 2026-08-07** to make phone-side capture a first-class route rather than an aside.
Facebook, Instagram and SMS have no usable API between them; **Tasker reading the notification
stream is their live path**, and it also reaches a dozen things — call log, geofences, NFC tags,
app usage — that no cloud service can see. See §3 *Which producer for which source*, §4
*Notification capture*, and the friend-export parse under *People profiles*.

---

## 0. Use `POST /api/v1/ingest`

That's the whole answer. Everything an external producer needs is behind one endpoint, and it needs
no browser tab open.

```bash
curl -s -X POST "$MOD_API/ingest" \
  -H "Authorization: Bearer $MOD_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "gridId": "'"$GRID"'",
    "source": "raindrop",
    "externalId": "884120391",
    "moduleLabel": "Bookmark",
    "parentId": "<bookmarks-container-occ-id>",
    "label": "Notes on control theory",
    "fields": { "<urlFieldId>": { "value": "https://..." } }
  }'
```

```json
{ "ok": true, "source": "raindrop",
  "summary": { "created": 1 },
  "results": [{ "ok": true, "externalId": "884120391", "status": "created",
                "occurrenceId": "ing-raindrop-3f2a...", "linkedToParent": true }] }
```

Batch by swapping the record keys for a `records` array (max 200):

```json
{ "gridId": "...", "source": "spotify", "parentId": "...", "moduleLabel": "Spotify Play",
  "records": [ { "externalId": "a", "label": "Track A" },
               { "externalId": "b", "label": "Track B" } ] }
```

### What it does that a raw `POST /occurrences` does not

Four things, each of which was a bug that would have bitten you on day one:

1. **Idempotent on `(source, externalId)`.** Re-run a backfill, or let a producer retry a timed-out
   POST, and you get `"status": "skipped"` instead of a duplicate. `onExisting` controls it:
   `"skip"` (default), `"update"` (merge incoming fields), `"replace"` (incoming is authoritative).
   Neither update mode touches `parentId` — a row you've since moved by hand stays where you put it.
2. **Links into the parent's `occurrences[]`.** Every renderer reads the *parent's* child list, not
   the child's `parentId`. A create that sets only `parentId` produces a row that exists in the
   database and is invisible on screen — the "created-but-unlinked" class this repo has swept
   repeatedly.
3. **Mirrors into the warm cache.** `request_full_state` is served entirely from a 30-minute
   in-memory cache. A write that reaches only Mongo doesn't show up until that expires — and worse,
   the socket write path merges over the cached copy, so a later in-app edit could republish the
   stale row on top of your import.
4. **Find-or-mints the type module** from `moduleLabel`, once per batch. A new source needs no
   manual setup before its first record.

**A bad `parentId` fails the record** rather than quietly creating an orphan, because an unparented
occurrence is exactly how data goes missing here.

> **These were live defects, fixed 2026-08-07** while writing this guide. (1) and (4) didn't exist;
> (2) and (3) were missing from every REST CRUD route, so *any* external write was invisible or
> resurrectable. The CRUD routes now maintain both invariants too — see
> `server/__tests__/apiIngest.test.js`.

### What NOT to use: webhook → operation

`POST /api/webhooks/:operationId` verifies its HMAC and then only emits `trigger_operation` to your
socket room. The executor that can create an occurrence is **client-side** — the server-side one
(`server/services/serverExecutor.js`) handles just
`INIT_VAR / SET_VAR / IF / LOOP / CALL_API / SHOW_VALUE`. **With no tab open, the payload is
dropped.**

It used to answer `{ ok: true }` for that, which made a dead pipe look healthy. It now reports:

```json
{ "ok": true, "delivered": false,
  "warning": "No Moduli client connected — the operation did not run and this payload was dropped..." }
```

**Check `delivered` if you ever point a producer at a webhook.** For data intake, use `/ingest`;
webhooks are for interactive automation you trigger while using the app.

---

## 1. Setup, once

### Mint an API token

```bash
cd /home/joshpoms/moduli
node --env-file=server/.env server/scripts/createApiToken.js yeshpoms@gmail.com "read,write" "ingest"
```

The raw token prints once (`moduli_<tokenId>_<secret>`). By default it's also written to
`server/.env` as `ASSISTANT_API_TOKEN`, so it survives reseeds. Store it in your password manager
and in whatever runs your ingest scripts.

Mint a **separate token per source** if you can — `"raindrop ingest"`, `"bank ingest"` — so you can
revoke one without breaking the rest, and so `lastUsedAt` tells you which pipe went quiet.

### Base URLs

| Environment | URL |
|---|---|
| Production | `https://viafluere.com/api/v1` |
| Local dev | `http://localhost:5000/api/v1` |

### Smoke test

```bash
export MOD_TOKEN='moduli_...'
export MOD_API='https://viafluere.com/api/v1'

curl -s -H "Authorization: Bearer $MOD_TOKEN" "$MOD_API/grids" | jq '.grids[] | {id, name}'
```

Note your **poms grid** id — call it `$GRID`. Everything below needs it.

### Know what you're writing to

- **`poms grid` is protected live data.** Back it up before any bulk write:
  `npm run backup:poms`.
- **`test grid 2` is the seed's target — overwrite it freely.** Build and prove every new
  ingest script there first.
- After any bulk write, run the integrity check:
  `node --env-file=server/.env server/scripts/checkGrid.js --all`

### Rate limits and retry safety

- 600 requests/minute per token. Batch anything larger.
- Every mutating request accepts an **`Idempotency-Key`** header. Same key within 24h returns the
  cached response with `X-Idempotent-Replay: true` instead of writing twice. Use it on every write —
  IFTTT and most webhook producers retry on timeout.

---

## 2. How an external record becomes a Moduli row

Moduli's model maps onto external data cleanly once you fix the vocabulary:

| Moduli | Ingest meaning | Example |
|---|---|---|
| **Module** | the *type* of thing | "Spotify Play", "Bank Transaction", "Text Message" |
| **Occurrence** | one *record* | that specific play at 09:12 on Aug 3 |
| **Field** | a *column* on the record | Artist, Amount, Sender, Date |
| **`meta`** | your bookkeeping | `{ source: "spotify", externalId: "...", ingestedAt: "..." }` |
| **`label`** | what it reads as | "Kendrick Lamar — Money Trees" |
| **`boardCategory`** | which board collects it | `"music"`, `"appointment"`, `"person"` |

### What `/ingest` handles for you

`meta.source`, `meta.externalId`, and `meta.ingestedAt` are stamped automatically from the `source`
and `externalId` you pass, and the occurrence gets a deterministic id derived from that pair. So
dedupe, the `meta` bookkeeping, and the parent link are not your problem.

Two things you still choose:

**Pick a stable `externalId`.** Use the source system's own primary key — Raindrop's id, Plex's
`ratingKey`, the bank's transaction id. If a source gives you nothing stable, hash the immutable
parts of the record (e.g. `sha1(timestamp + amount + description)`), but never include anything the
source might edit later, or an edit re-imports as a new row.

**One module per type, reused forever.** Pass the same `moduleLabel` for every record of a kind and
`/ingest` mints it once, then reuses it. Don't mint a module per record.

Once the type module exists, **bind its fields in the app** (or via `PATCH /modules/:id`). Values
written to an unbound field render as nothing — see the `0047` note in `server/CLAUDE.md`: stamping
values without bindings leaves numbers only an operation can see. `/ingest` writes the values; the
bindings are what make them visible and editable.

### Where rows land

`parentId` is the container the rows go into, and `/ingest` links them there. Additionally **tag
them** by including your `boardCategory` field in `fields`:

```json
"fields": { "<boardCategoryFieldId>": { "value": "music" } }
```

The link is what makes a row appear; the tag is what makes it findable by every board, dropdown,
feed, and tracker that already queries on `boardCategory` — that's the mechanism behind the existing
34 boards. Feeds materialize client-side, so tagging alone shows nothing until you open the app;
that's exactly why `/ingest` does the explicit link as well.

---

## 3. The two recipes you'll reuse for every source

### Recipe A — one live record

Exactly the `curl` in §0. One call, no pre-flight lookup, safe to retry.

### Recipe B — backfill from an export file

```
read export file
  → map each record to { externalId, label, fields }
  → chunk into batches of 200
  → POST /ingest per chunk with a shared { gridId, source, parentId, moduleLabel }
  → sum the per-chunk summaries
```

No dedupe pass and no separate parent write — re-running the whole file is a no-op that reports
`{ "skipped": N }`. That means you can iterate on a mapping, re-run, and only new or changed records
move.

Always run it against `test grid 2` first, count the rows, look at the page, *then* point it at
`$GRID`. The 2026-08-03 `0035` incident in CLAUDE.md is the standing lesson: verify what a selector
matched against a *named* expectation, not just a count.

### Two things `/ingest` deliberately does not do

- **Concurrency per board.** Parent links are atomic `$push`es, so concurrent ingests can't clobber
  each other's appends — but ordering between two producers writing the same container is
  unspecified. If order matters, pass `index`, or give each source its own container.
- **Cascading delete.** `DELETE /occurrences/:id` unlinks the row from its parent but does not
  remove its children. Delete leaves, or use the app.

### Getting IFTTT to talk to the API

IFTTT's **Webhooks** action can POST JSON to a URL. Custom request headers are a Pro-tier feature
and have moved around — **verify on your plan before designing around it.**

- **If you have custom headers:** point IFTTT straight at `/api/v1/ingest` with
  `Authorization: Bearer …` and build the body from IFTTT ingredients. No relay, no code.
- **If you don't:** put a thin relay in front — accept IFTTT's POST at a secret URL path, attach the
  Bearer token, forward to `/ingest`. A Cloudflare Worker or a ~20-line route on the same droplet.

Either way the relay stays trivial now, because dedupe, parent linking, and module creation live
server-side in `/ingest` rather than in every producer. Its only job is authentication and mapping
this source's payload shape onto `{ externalId, label, fields }`.

### Getting Tasker to talk to the API

Tasker (Android) posts JSON directly — no relay, no Pro tier, no header restriction. One `HTTP
Request` action is the whole integration:

```
Action: HTTP Request
  Method:  POST
  URL:     https://viafluere.com/api/v1/ingest
  Headers: Authorization: Bearer %MOD_TOKEN
           Content-Type: application/json
  Body:    {"gridId":"%MOD_GRID","source":"tasker-sms","externalId":"%eid",
            "moduleLabel":"Message","parentId":"%MOD_MSG_PARENT",
            "label":"%SMSRF","fields":{"<bodyFieldId>":{"value":"%SMSRB"}}}
  Timeout: 30
```

Put `%MOD_TOKEN`, `%MOD_GRID` and the parent ids in **global variables** (set once in a
`Tasker Start` profile or by hand), never inline in each task — you will have a dozen of these and
rotating a token should be one edit.

Three things that are not optional:

- **Retry on failure.** Tasker fires whether or not the phone has signal. Wrap the HTTP Request in
  an `If %http_response_code !~ 2*` → `Wait 30` → retry, or queue to a file and drain on
  connectivity. `/ingest` is idempotent on `(source, externalId)`, so a retry is free **provided
  the id is stable** — see below.
- **A stable `externalId`, derived deterministically.** This is where a notification pipe goes
  wrong. A push notification carries no id you can trust, so you build one and it must come out the
  same on a retry: `sha1(package + title + text + yyyy-mm-dd-hh-mm)`. Minute granularity is the
  right trade — it collapses the retry and the duplicate re-post of the same alert, while two
  genuinely different messages in the same minute differ in `text`.
- **One `source` per producer**, not one for all of Tasker. `tasker-sms`, `tasker-ig-dm`,
  `tasker-fb-friend-request`. Dedupe is scoped to `(source, externalId)`, and you will eventually
  want to replay or purge exactly one of these.

### Which producer for which source

The line is **where the data actually lives**, and it decides itself:

| The data lives… | Use | Because |
|---|---|---|
| In a cloud service with a trigger | **IFTTT** (or a direct API poll) | Nothing phone-side is involved; it fires with your phone off. Spotify, YouTube, Google Calendar, GitHub, weather, RSS. |
| Only on the phone | **Tasker** | There is no API to poll. Notifications, SMS, call log, app usage, screen/Bluetooth/NFC/wifi context, battery, steps. |
| In a service whose IFTTT trigger was retired | **Tasker** | Android SMS and Facebook personal profiles both died this way. The phone still sees them. |
| In a service with a real API and no urgency | **a poller on the droplet** | No third party, no per-applet limits, full control over what becomes an occurrence. Raindrop, Spotify, YouTube RSS. |

**Prefer a poller over IFTTT where both work.** IFTTT is a dependency that can retire a service
under you — it has, twice, on sources in this document.

---

## 4. Source by source

Verdict legend: **✅ solid** · **⚠️ workable with effort** · **❌ no live path — backfill only**

| Source | Live | Backfill | Verdict |
|---|---|---|---|
| SMS / text | **Tasker** SMS trigger → `/ingest` | SMS Backup & Restore XML | ✅ |
| Email | Gmail API or forward-to-relay | Google Takeout (mbox) | ✅ |
| FB Messenger | **Tasker** notification capture | Facebook DYI export (JSON) | ⚠️ |
| Instagram DMs | **Tasker** notification capture | Instagram data download | ⚠️ |
| FB / IG friend requests | **Tasker** notification capture | — (accepted ones land in the friends export) | ⚠️ |
| Spotify (plays) | Web API poll / IFTTT | Extended streaming history export | ✅ |
| YouTube | RSS per channel / IFTTT | Takeout (watch + like history) | ✅ |
| Facebook (social) | none via API; **Tasker** for anything that notifies | DYI export | ⚠️ |
| People profiles | none | FB friends + IG following JSON | ✅ |
| Banks (UWCU, Landmark) | SimpleFIN / Plaid | OFX/QFX/CSV download | ⚠️ |
| Grocery (Woodman's) | none | — (Moduli is the source of truth) | ❌ |
| Plex | Plex Pass webhooks | Tautulli history export | ✅ |
| Raindrop | REST API poll | REST API full export | ✅ |
| MyChart | via calendar or email | manual / FHIR | ⚠️ |
| Moon+ Reader | none | SQLite backup from cloud sync | ⚠️ |

### Messages

**SMS/text.** IFTTT's Android SMS trigger was retired years ago; don't plan around it. **Tasker**
is the route, and it needs no notification listener — Tasker has a first-class `Received Text`
event giving you `%SMSRF` (sender), `%SMSRB` (body), `%SMSRD`/`%SMSRT` (date/time) directly. That
is cleaner than reading the SMS notification, so read the event, not the notification.

```
Profile: Event → Phone → Received Text (Type: SMS)
Task:    Variable Set  %eid  to  %SMSRF-%SMSRD-%SMSRT   (then hash it if you prefer)
         HTTP Request  → /api/v1/ingest   (source: "tasker-sms")
```

For history, **SMS Backup & Restore** exports XML you can parse in one pass — one `<sms>` element
per message with `address`, `date` (epoch ms), `type` (1 = received, 2 = sent) and `body`. Use
`address + date` as the `externalId` so the backfill and the live pipe converge on the same rows
instead of duplicating the overlap.

*Privacy note:* this puts message bodies in your database. Consider ingesting metadata only
(sender, timestamp, length) unless you specifically want searchable content — and note that the
decision is per-source, so you can keep SMS bodies and drop DM bodies, or the reverse.

**Email.** Two good options. The lightweight one: a Gmail filter that forwards matching mail to a
dedicated address your relay reads (or IFTTT's Email service trigger address). The robust one: a
small script against the Gmail API or plain IMAP, polling every 15 minutes, which gives you full
control over which labels/senders become occurrences. Backfill from **Google Takeout** (mbox).

Don't ingest all email. Pick the categories that are actually data — receipts, appointment
confirmations, bills, shipping notices — and let those become typed occurrences. This doubles as
the ingestion path for MyChart appointments and utility bills below.

**Facebook Messenger and Instagram DMs.** No API exists for personal message access on either
platform, and none is coming — so the *content* is backfill only, via the official data exports
(Facebook: Settings → Your Facebook Information → Download Your Information, choose JSON;
Instagram: Download Your Information). Both produce per-thread JSON: a one-time archive import.

**But the event is live, via the notification.** A new DM raises a push notification that names the
sender and carries a preview of the body, and Tasker can read it. That is enough for "who
contacted me and when", which is the thing a Social/Connection tracker actually wants — the full
thread text is the archive's job. See **Notification capture** below; it is the same mechanism that
covers friend requests, and it is the only live path either platform has.

### Socials

Worth naming the mismatch up front: **none of these platforms expose "notifications" over an API.**
What their APIs give you are *events* — a track you saved, a video you liked, a video a
subscription posted. The notification stream itself only exists on the phone, so that is where you
take it from. **This is a real route, not a fallback** — for Facebook and Instagram it is the only
live route there is, and it is what the next section is about.

**Spotify.** Solid. The Web API's `/me/player/recently-played` returns your last 50 plays (24h
window), and `/me/tracks` returns saved tracks. Poll every 30 minutes with a refresh token. IFTTT's
Spotify service also has "new saved track" / "new recently played track" triggers if you'd rather
not manage OAuth. For **full lifetime history**, request Spotify's *Extended streaming history* from
your privacy page — it's the complete record, and it takes days to weeks to arrive, so request it
now even if you build the pipe later.

**YouTube.** The zero-auth trick: every channel publishes an RSS feed at
`https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`. Poll the channels you care about — no
API key, no quota, no IFTTT. For your own activity (likes, watch history), IFTTT's YouTube service
has triggers, and Google Takeout has the full history.

**Facebook.** Personal profile triggers were removed from IFTTT in 2018 when Facebook locked down
its Graph API; only Pages work now. If you don't run a Page there is no *API* path — the live path
is the phone.

### Notification capture (Tasker) — the live route for FB, IG and anything else with no API

This is the one route that reaches sources nothing else can. The phone already receives an event
for every new message, friend request, mention and reaction; a notification listener reads it, and
Tasker POSTs it to `/ingest`. **Cost: it is noisy, and the noise is the whole engineering problem.**
Solve it once here rather than per-profile.

**Use AutoNotification** (Tasker plugin) rather than Tasker's built-in notification event — it
exposes the fields you need (`%antitle`, `%antext`, `%anapp`, `%anpackage`, `%ansubtext`) and, more
importantly, filters *before* the task runs, so a hundred junk notifications a day never wake a
task. **Verify the variable names on your version before writing five profiles against them.**

**Step 0, before writing any profile: capture what actually arrives.** Make one throwaway profile
that logs every notification from the four packages to a file for a day. FB and Instagram reword
their notification strings regularly, and matching on a string you guessed instead of one you
observed is how this pipe silently stops. This is the same rule the rest of this repo runs on —
measure the claim before writing the fix.

The packages:

| Source | Package |
|---|---|
| Facebook | `com.facebook.katana` |
| Messenger | `com.facebook.orca` |
| Instagram | `com.instagram.android` |
| Google Messages (SMS) | `com.google.android.apps.messaging` |

#### The four filters that make it usable

Apply all of them. Each one exists because of a specific way the stream lies to you:

1. **Drop group summaries.** Android posts a *summary* notification alongside the individual ones
   ("3 new messages"). Ingest it and you get a phantom row whose "sender" is a count. Filter on
   the group-summary flag — AutoNotification can exclude these directly.
2. **Drop `ongoing` notifications.** Foreground services (uploads, calls, media) post persistent
   rows that re-fire on every update. Nothing ongoing is an event.
3. **Package allowlist, then title/text discriminator.** `com.facebook.katana` posts friend
   requests, likes, comments, memories, birthday reminders, and "you have new notifications"
   digests through the same channel. The package narrows it to Facebook; only the text tells you
   *which*. Match on the observed phrasing from step 0 — a friend request reads
   `"<Name> sent you a friend request"`; the digest form (`"You have N new notifications"`) is the
   one to reject, because it carries no name and would ingest as an unnamed person.
4. **Deduplicate at the id, not the filter.** An app may re-post the same notification when you
   glance at it. The derived `externalId` (§3, `sha1(package + title + text + minute)`) makes that
   a no-op at `/ingest` rather than something the profile has to reason about. This is why the id
   derivation is not optional.

#### Friend requests and messages are two different things

They arrive through the same listener and they must not land in the same place:

- **A friend request is person-shaped.** The only payload is a name, and what you want from it is
  a People row (or a link to the one that exists). Send it with `moduleLabel: "Friend Request"`
  into its own container, carrying the name and the platform — then let an in-app operation decide
  whether it matches someone in People. **Do not have Tasker create the person.** The phone cannot
  tell "Mike Anderson" from the Mike Anderson you already have, and a producer that mints People
  rows will fill that board with near-duplicates within a month.
- **A message is a contact event on a person who may already exist.** `moduleLabel: "Message"`,
  fields for platform, sender name, timestamp, and body-or-not per your privacy call. Same rule:
  the sender is a *string* at ingest time; resolving it to a People occurrence is the app's job,
  where the dropdown and the existing occurrence-matching already live.

**Where unresolved ones go.** Both cases produce rows naming a person Moduli may not know. `/ingest`
fails a record with a bad `parentId` rather than creating an orphan, so give each source a real
container that exists — an **Inbox** container is the right destination for anything unmatched
(§7 argues for one generally; this is the source that makes it necessary rather than nice).

#### What else Tasker reaches that IFTTT cannot

Worth knowing while you are already in there — all of these are phone-only, so there is no other
route to them at all:

- **Call log** — inbound/outbound/missed, with number and duration. This is the honest input for a
  Phone Calls / Connection tracker, which is currently hand-entered.
- **App usage / screen time**, and **screen on-off events** — real numbers for a focus or
  screen-time tracker instead of a guess.
- **Location arrive/leave** by geofence, wifi SSID, or Bluetooth connect. "Arrived at gym" is a
  workout occurrence with no button pressed; "car Bluetooth connected" is a commute.
- **NFC tags** — the cheapest possible physical button. A tag on the fridge logs water; a tag by
  the door logs a walk. This is the one that makes hand-entry disappear.
- **Battery, charging state, step count**, and any sensor the phone exposes.
- **Media playing** — what is on right now, including apps with no API at all.

Each is the same `HTTP Request` action with a different trigger; the endpoint does not change.

### People profiles

No API on either platform. Your Facebook DYI export includes a friends list; Instagram's export
includes following/followers. Both are flat JSON — they map onto the **existing People board**
(`boardCategory: "person"`), which already exists in the seed with 10 person occurrences and is
already bound by the Meet/Visit/Host actions and the Event board's People field.

**Where the files are.** Request JSON, not HTML, from both.

| Platform | Path in the export | Shape |
|---|---|---|
| Facebook | `friends_and_followers/your_friends.json` (older exports: `friends/friends.json`) | `{ "friends_v2": [ { "name": "...", "timestamp": 1590000000 } ] }` |
| Instagram | `followers_and_following/following.json` | `{ "relationships_following": [ { "string_list_data": [ { "value": "<handle>", "href": "...", "timestamp": … } ] } ] }` |
| Instagram | `followers_and_following/followers_1.json` (may be `_1`, `_2`, … — glob it) | same `string_list_data` shape, top-level array |

**The trap: Facebook's JSON is mojibake, and it is not your parser's fault.** The export writes
UTF-8 bytes escaped as if they were latin-1, so `José` arrives as `JosÃ©` and every emoji arrives
as three garbage characters. Import it raw and a few percent of your roster is permanently wrong
in a way that is tedious to find later. Repair each string on the way in:

```js
const fixMojibake = (s) =>
  Buffer.from(s, "latin1").toString("utf8");   // "JosÃ©" -> "José"
```

Apply it to names only, verify on a name you know has an accent, and **do not** apply it to
Instagram's export — Instagram encodes correctly, and running the repair over clean UTF-8 corrupts
it. One of the two needs it; check both against a known name before the full run.

**Ingesting the roster.** One `/ingest` batch per platform (200 records max per call, so chunk it):

```json
{ "gridId": "…", "source": "facebook-friends", "parentId": "<People board occ id>",
  "moduleLabel": "Person", "onExisting": "skip",
  "records": [
    { "externalId": "fb:jose-garcia", "label": "José García",
      "fields": { "<platformFieldId>": { "value": "Facebook" } } }
  ] }
```

- **`externalId`**: use the platform's own id where the export gives you one; otherwise a
  normalized name (`fb:` + lowercased, accent-stripped, hyphenated). It only has to be stable
  across *your own* re-runs, which is what makes `onExisting: "skip"` correct — re-export in six
  months and only the new friends land.
- **A person on both platforms is two source rows and should be one People occurrence.** Dedupe by
  name in the app after both imports, not in the importer — Instagram gives you a *handle*, not a
  name, so the two sides frequently cannot be matched automatically. Import both, merge by hand
  for the people you actually track.
- **Several hundred rows is a migration-sized write.** Dry-run it: parse, print the count and the
  first and last twenty names, and check that against what you expect to see before pointing it at
  `poms grid`. The 0035 lesson applies here exactly — a selector or parse that "looks right" at
  the count level has moved real data before in this repo.

Photos and richer profile detail are manual. This is a one-time import that gives you the roster;
you enrich the people you actually track. Friend *requests* arriving live (above) land against this
same board, which is what makes the roster worth having early.

### Bank accounts (UWCU, Landmark)

No IFTTT service for either. Three routes, in order of practicality:

1. **CSV/OFX/QFX download (start here).** Both credit unions' online banking will export
   transactions for a date range. One parser handles both — the fields you need are date, amount,
   description, and account. Run it monthly. Free, no third party sees your credentials, and it
   covers backfill and ongoing in the same script.
2. **SimpleFIN Bridge.** ~$1.50/month, read-only, returns clean JSON, built for exactly this.
   Genuinely live. Verify both institutions are supported before subscribing.
3. **Plaid.** Developer account, more setup, better coverage. Overkill for two accounts.

**Mapping is already built.** The seed has the `Track` occurrence (universal money action, with
`flow: in/out/replace`), an `accountRef` field, `Amount`, and the `supportsReplace` tracker pattern
where a `flow:"replace"` entry sets the balance base and later transactions stack on top. So:
each imported transaction → a `Track` occurrence with `accountRef` = the account, `Amount` with
`flow` from the sign. Each statement balance → a `flow:"replace"` entry. The Checking Balance and
Cash Balance trackers then compute correctly with zero new operations.

*Gate transactions on the Schedule + completion policy documented in CLAUDE.md 2026-07-11 — imported
rows need `Completed: true` or they won't move the balance trackers.*

### Grocery list (Woodman's)

No API, no export. **Moduli should be the source of truth here, not the destination.** The Grocery
List board already exists (`boardCategory: "grocery"`) with `addNew` wired, so adding an item is a
one-tap flow in the app. That's less friction than any sync would be.

If you want purchase *history*, the route is the receipt email → email ingestion above, or an
on-demand scrape of the order history page (the repo has Firecrawl available) when you want to
reconcile a month.

### Movies and shows (Plex)

The best-supported source on your list.

- **Live:** Plex Pass includes **native webhooks** (Settings → Account → Webhooks). Plex POSTs a
  JSON payload on `media.scrobble` (watched), `media.play`, `media.rate`, etc. Point it at your
  relay, filter to `media.scrobble`, and each finished item becomes an occurrence. No IFTTT, no
  polling. Requires Plex Pass.
- **Backfill:** **Tautulli** is the standard Plex stats companion — it keeps full watch history and
  exposes both a CSV export and its own API. If you already run it, your entire history is one
  export away. If not, install it now; it starts recording from the day it's installed, so earlier
  history depends on what Plex's own database retained.

Maps to the existing Media boards and the `Movies Watched` / `Books Read` / `Podcasts Listened`
trackers, which read the Media pick fields.

### Bookmarks (Raindrop)

Clean, documented REST API at `api.raindrop.io/rest/v1` with OAuth. No relay needed for backfill —
`GET /raindrops/0?sort=-created&perpage=50` walks everything you have. For live, poll every 15
minutes against the same endpoint and filter on `created` newer than your last run; Raindrop's ids
are stable, so `meta.externalId` dedupe is trivial.

This is the easiest source on the list. **Build this one first** as the proving ground for your
ingest pipeline — it's low-stakes data with a well-behaved API.

### Music (Spotify)

Covered under Socials above — same API, different intent. Worth separating in Moduli: a *play* is a
high-volume event (hundreds per week) and a *saved track* is a deliberate act. Ingest saves into the
Media board as durable occurrences; consider aggregating plays into a daily count rather than one
occurrence per play, or you'll add ~2000 rows a month to a grid that currently holds ~4000 total.

**This is the volume warning for the whole document.** Think about rows-per-month before you build
each pipe, and prefer daily rollups for anything high-frequency.

### Appointments (MyChart)

Epic MyChart supports FHIR patient-access APIs, but registration is per-health-system through
open.epic.com and it's a heavy lift for a handful of appointments a year. Two pragmatic routes:

1. **Calendar bridge (recommended).** MyChart's appointment view has "add to calendar." Once it's in
   Google Calendar, IFTTT's Google Calendar service has "event starts" / "new event added" triggers
   — and this same bridge then serves *every* appointment source you'll ever have, not just MyChart.
2. **Email parse.** MyChart sends appointment confirmation and reminder emails. Your email pipeline
   catches them; a small parser pulls date, provider, and location.

Maps to the **Appointment occurrence added 2026-07-29** — it already binds Completed, Appointment
Type, Place, People, and Duration, and it drags onto a Schedule slot stamping date + timeslot.
So an ingested appointment lands in your day correctly with no new modeling.

### Books (Moon+ Reader)

Moon+ Reader Pro syncs to Dropbox/Google Drive, and its reading data lives in a SQLite database in
the backup. So: nightly script pulls the synced backup file, opens the SQLite, reads the book list
and reading-time stats, and emits occurrences. No live path — reading sessions land the next
morning, which is fine for this data.

Verify the backup file's schema on your own device before building; app internals change between
versions, and this is the least documented source on your list. Budget an hour just to explore it.

Maps to the existing Reading board + the `Total Reading Time` tracker.

---

## 5. Hand-entered: tasks, interests, workout plan, bills, meal plan

These five have no external source — they're *your* structured intent. The goal is to make entering
a list fast enough that you actually keep it current.

### The workflow

1. **Write the list in plain text.** One item per line, in whatever notation is natural to you.
2. **Open the assistant drawer** (Jonah) and paste it with a placement instruction.
3. **Approve the confirm card** — creates are `requires_confirm`, and for `create_occurrence` the
   card shows an editable **location picker** with a best-guess pre-filled. Correct it there if
   Jonah guessed wrong.

Jonah has `create_module`, `create_occurrence`, `set_occurrence_field`, `move_occurrence`,
`copy_occurrence`, `create_field`, and `apply_template`, and its system prompt tells it to find the
parent id once and then issue one create per item.

### Prompt templates

**Tasks**
```
Add these as tasks under the Tasks page, in the Occupational container:
- Renew car registration
- Email the landlord about the lease
- Book dentist follow-up
```

**Interests**
```
Add each of these to the Interests board as an occurrence tagged boardCategory "interest":
woodworking, generative art, Icelandic sagas, home espresso
```

**Workout plan**
```
Create a workout plan under Routines > Physical > Fitness. For each line, the movement
name and the three set counts:
Bench Press 8 8 6
Incline DB Press 10 10 8
Cable Fly 12 12 12
```
*Movements already exist on the Movements board with `muscleGroup` bound — tell Jonah to
**pick the existing movement** rather than create a new one, or you'll fork the per-muscle Volume
trackers, which resolve the pick and read its `muscleGroup`.*

**Bills**
```
Add these to Financial Tasks as recurring bills, each with a Due date and an Amount
(flow: out):
Rent, 1st, 1450
Car insurance, 12th, 138
Internet, 20th, 70
```

**Meal plan**
```
Add this week's meal plan. For each day create an Eat occurrence under that day's
Schedule column, with the Meal field set:
Mon - Chicken and rice
Tue - Salmon and vegetables
...
```
*Meals already exist as occurrences with the Ingredient dropdown and prefill wired
(`0042` + `0047`) — setting the Meal field auto-fills ingredients and their summed macros. So a
meal plan entered this way populates nutrition tracking for free. Reference existing meals by name
where you can.*

### When to skip Jonah

The local model runs on CPU and a multi-step request is slow — a 30-item list is minutes of
watching a progress bar. **For anything over ~10 items, use Recipe B instead**: write the list as
CSV, run the batch script, done in seconds. Jonah is for conversational, small, or
placement-ambiguous additions; the API is for bulk.

### Make it repeatable

Once a list shape settles (your workout plan, your monthly bills), **save it as a template**. The
templates folder + `apply_template` with `mode: "merge"` will top up what's missing and leave what
you've edited alone — that's what `identitySignature` is for. A meal plan applied weekly is a
template application, not 21 creates.

---

## 6. Not corrupting your grid

A checklist to run for every new pipe, in order:

- [ ] `npm run backup:poms` before the first bulk write
- [ ] Build and prove it on **`test grid 2`**, never poms grid
- [ ] Dry-run mode on every script — print what it *would* create, and read the actual rows, not
      just the count
- [ ] Verify the row count against a **named expectation** ("42 transactions in July"), not a
      plausible-looking number
- [ ] `meta.externalId` on every row, and a re-run that creates **zero**
- [ ] `node --env-file=server/.env server/scripts/checkGrid.js --all` after — expect 0 errors
- [ ] Check the page in the browser. The DOM is ground truth; a correct-looking Mongo query is not.

The recurring failure mode in this codebase's history is a database query reporting success while
the screen disagrees. Look at the screen.

---

## 7. Brainstorm — what else is worth pulling

Ordered by value-per-hour-of-work.

**Tasker re-prices several of these.** Anything below that reads as "moderate effort" because it
needs a phone-side exporter is now a trigger and one HTTP action: steps, screen time, location
arrive/leave, media playing, call log. Once the notification pipe exists, the marginal cost of the
next phone-sourced thing is about ten minutes — so weigh these by *whether you want the number*,
not by effort.

### Tier 1 — high value, low effort, and you already have the trackers

- **Calendar (Google/Apple).** The universal appointment spine. One integration serves MyChart,
  work meetings, events, birthdays, and anything else that ever gets scheduled. IFTTT has solid
  Google Calendar triggers. **If you build one more thing after Raindrop, build this.**
- **Steps and sleep from your phone or watch.** You have `physicalSteps` and Sleep tracking already
  modeled with **nothing feeding them**. Health Connect (Android) or an Apple Health export closes
  a loop that's already half-built.
- **Weather at your location, daily.** One free API call on a cron, stamped onto the day column.
  Costs an hour, and it's the context variable that makes mood/energy/activity correlations
  actually interpretable later.
- **Bills and subscriptions, derived from bank data.** Once transactions are ingesting, recurring
  charges fall out of the data — you don't need to hand-enter bills at all after month two. This
  turns one of your five manual items into an automatic one.

### Tier 2 — genuinely useful, moderate effort

- **Location history** (Google Timeline export, or OwnTracks for live). "Where was I" on a day page
  is a strong memory anchor, and it makes journal entries far easier to write.
- **Photos taken that day** (Google Photos / Immich). Thumbnails on the day column. You already have
  artifact occurrences and image fields; this is mostly plumbing.
- **Screen time / app usage** (Digital Wellbeing export). Pairs with your Occupational trackers, and
  it's the honest counterweight to self-reported productivity.
- **Podcast listens** (Pocket Casts / AntennaPod both export). Feeds the existing Podcasts
  Listened tracker.
- **Books read** (StoryGraph or Goodreads export/RSS) as a cross-check on Moon+ Reader — different
  systems, same shelf.
- **Package deliveries**, parsed from shipping emails. Free once email ingestion exists.
- **GitHub/code activity** — commits per day, via the events API or IFTTT. Trivially easy if that's
  a thing you want visible.

### Tier 3 — interesting, speculative

- **Voice memos → transcription → journal draft.** Whisper locally, drop the text into the day's
  Journal container. This is the highest-value/highest-effort item on the list — it removes the
  friction from the one thing you actually have to write yourself.
- **Car mileage and fuel**, if you track it.
- **Strava/Garmin**, if the workout data lives there rather than in Moduli.
- **Reverse direction — push *out* of Moduli.** Your Schedule → a calendar feed; tasks → phone
  reminders. Moduli currently only receives. Publishing an .ics from the Schedule would make it
  usable from a lock screen.

### Capabilities, not sources — worth as much as any of the above

- **A generic Inbox page.** Anything ingested that doesn't map cleanly lands there for triage
  instead of being dropped or guessed at. Nothing is ever silently lost, and unmapped volume tells
  you what to model next.
- **A `source` field on every ingested occurrence** (not just `meta`), so you can filter a page to
  "only what I entered myself" and trust-check any number a tracker shows you.
- **A "Data Health" tracker container.** One tile per source counting rows ingested in the last 24h.
  A pipe that silently dies is the default failure mode of every personal-data setup ever built —
  and you will not notice for weeks without this. Cheap to build with the tracker ops you already
  have.
- **Nightly reconcile job** — re-fetch the last 7 days from each source and fill gaps, so a missed
  webhook self-heals instead of leaving a permanent hole.

---

## 8. Suggested build order

1. ~~**The generic ingest endpoint.**~~ **Done 2026-08-07** — `POST /api/v1/ingest`, plus the parent-link
   and warm-cache fixes across the REST CRUD routes, plus honest webhook delivery reporting.
   18 tests in `server/__tests__/apiIngest.test.js`. Every source is now a mapping config rather
   than a bespoke script. **Deploy this before building any pipe on top of it.**
2. **Raindrop**, end to end, as the proving ground. Clean API, low stakes, fast feedback.
3. **Tasker → SMS**, as the phone-side proving ground. It uses the `Received Text` event rather
   than a notification listener, so it exercises the token, the retry, and the `externalId`
   derivation with none of the notification noise in the way. Get this one right and every other
   Tasker profile is a copy of it.
4. **The Inbox container**, before the notification pipes — it is where anything unresolved lands,
   and building it after means the first week of friend requests has nowhere to go.
5. **Tasker → notification capture** for FB / IG / Messenger. Spend the first day only *logging*
   what arrives (step 0 above); write the filters against what you observed.
6. **The friend-export import**, once People is where you want it. It is a one-shot, it takes an
   hour, and it makes every message and friend-request row that follows resolvable to a person.
7. **Calendar**, which unlocks MyChart and everything future.
8. **Banks**, via CSV first — highest value, and the modeling is already built.
9. **Plex**, via native webhooks — nearly free once the relay exists.
10. **Spotify**, plus request the extended history export *today* so it's ready when you are.
11. **Data Health tiles**, before you have enough pipes to lose track of one. A notification pipe
    dies silently the first time Android revokes the listener permission after an update, and this
    is the only thing that will tell you.
12. Everything else as the appetite strikes.

Requests to fire off now, since they take days to arrive: **Spotify extended streaming history**,
**Facebook DYI export**, **Instagram data download**, **Google Takeout**.
