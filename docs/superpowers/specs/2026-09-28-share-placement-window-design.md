# The Share Placement Window

**Date:** 2026-09-28
**Status:** design approved, not implemented

Clip something from the browser and, when you want it, say where it goes and
what it becomes — in a window, before anything is written.

> **USER, 2026-09-28:** *"we should create a plan that on the share, see if we
> can open up a window to manually place things. if we select auto instead, it
> does the share rules."*
> → *"like we have a dropdown of grids and a drop down of occurances to search"*
> → *"and place it there"*
> → *"but thats a manual section, if auto (we still select the grid tho), it does
> the share rules"*
> → *"it should have an option what to do with it, i can select a type of
> occurance to turn it into and map fields right from the companion app window"*
> → *"this window should go after the share btw, not in the companion apps
> settings"*
> → *"heres an example id like to replicate, im trying to manually add that as a
> movie instead of a bookmark link"*
> → *"we should be able to save diff configurations too"* · *"its just a saved
> preset of type of occurance, values, and binded fields. there is no rule from
> IMDB"*
> → *"there can be multiple presets, so we have auto, new, or saved preset"*
> → asked four questions and answered all four: mappings get **a small transform
> set AND an editable value box**; **presets ship in the same pass**; **every
> share can use the window**, not just the extension's; and the popup reads its
> clip with **a one-time key in the URL**.

---

## 1. Why this exists — the clip that started it

A clip of an IMDb page, made from the companion extension on 2026-09-28:

```
21:51-21:54Z  type=link  source=extension
  "A Guide to Recognizing Your Saints (2006) IMDb https://www.imdb.com › title"
  rule    "Share: anything else"   (the catch-all)
  created 67207c1f  role=artifact kind=bookmark  →  the grid's root Files folder
```

Two separate problems, and only one of them is a bug:

1. **It went to the wrong grid.** The extension sent an explicit `gridId` from
   its options (test grid 2, left over from the 09-24 testing), and
   `POST /api/v1/share` resolves the grid as
   `body.gridId || user.meta.share.gridId || body.fallbackGridId` — so the
   extension's stale copy outranked the app's own "Shares land in" setting.
   **Fixed 2026-09-28** (`a65fd92f`): the options field is an override, blank
   means the app decides.
2. **A link became a bookmark, and the user wanted a movie.** That is not a
   bug — the rules did exactly what they say. It is the missing feature: there
   was no way to say *"not that, this"* at the moment of clipping.

**And a movie is not a primitive.** Read off poms grid:

```
Movies container 0cti4si13ijy — 993 rows
  Movie  [role: artifact · kind: "movie"]
  binds: Owned · Drive · Size · File Path · Year · Board Category
  Board Category = ["movie"]
```

So "add it as a movie" means an `artifact/movie` with six bindings and
`Board Category: movie` — a shape that exists in the data, not one from a
palette. Any design with a fixed list of primitive kinds cannot express it, and
would make the user hand-build a movie on every clip. That single measurement is
what drove §4.

## 2. What already exists (and is therefore not being built)

| piece | where it already is |
|---|---|
| a share reaches the server and is routed | `POST /api/v1/share` → `shareIngress` → `runShareRules` |
| per-type rules, editable, ordered, haltable | operations with an `onShare` trigger; `commandCenter/ImportsTab` |
| a record of what every share did | `grid.shareLog` (capped 50) + the Imports tab's Recent shares |
| a clip becomes a record | `extension/clip.js buildClipRecord` (pure, tested) |
| a Moduli page that receives a share and posts it | `ui/SharePending.jsx` — `main.jsx:63` routes `/share-pending` and `/share-target` to it lazily, outside the app shell. **`/share-place` is one more entry in that array**, not a new routing mechanism |
| a searchable field picker | `ui/FieldSelect.jsx` → `DestinationPicker` → `OptionSearchList` |
| a searchable occurrence/destination list | `ui/DestinationPicker` + `helpers/containerCrumbs` (CLIENT-side only — see §6) |
| grid list · field list | `GET /api/v1/grids` · `GET /api/v1/fields?gridId=` |

**This is a placement surface, not a second importer.** Everything it writes, it
writes through `/share`.

## 3. The flow

```
right-click a link
  ├─ "Clip link to Moduli"            → instant: share rules, notification, no window
  └─ "Clip link to Moduli (choose…)"  → the window
                                          ↓
         extension POSTs the clip to /share/stage   → { stageId, key }
         extension opens a popup window 480×620 at
           https://viafluere.com/share-place?stage=<id>&k=<key>
                                          ↓
         the page reads the staged clip and renders the form
                                          ↓
         you press Clip  →  POST /share  →  the row is written, the log records
                            it, the stage is consumed, the window closes
```

**Every sender can reach this window, not just the extension** (user's choice).
A phone or Windows share lands in `SharePending` today, which posts straight to
`/share`; it instead STAGES and redirects to the same `/share-place`, where Auto
is one press. One placement surface for everything you share, and the phone gets
the feature for free because it is the same page.

**Two menu items rather than one window that always opens** (user's choice): the
instant path is the common case and must stay one click.

**Nothing is written until Clip is pressed.** Closing the window leaves the stage
to expire unused, so an abandoned clip cannot become a row nobody remembers
making — the class of debris this repo has repaired from five directions.

**Why a stage and not query parameters.** A clip carries a title, a URL, an
`og:image` URL and possibly a long selection. That does not reliably fit in a
URL, and a window that works until the day you clip a long quote is worse than
one that never did. The stage is also the idempotency handle: the same stage can
only be consumed once.

## 4. The window

```
┌─ Clip to Moduli ──────────────────────────────────┐
│ A Guide to Recognizing Your Saints (2006) – IMDb  │  ← what you are clipping,
│ imdb.com/title/tt0473488/               [cover]   │    with its preview
├───────────────────────────────────────────────────┤
│ Grid    [ poms grid ▾ ]                           │  ← always, in every mode
│                                                   │
│ (•) Auto                                          │
│     → Share: link · lands in Bookmarks            │  ← names the rule that WILL run
│                                                   │
│ ( ) New                                           │
│     Where  [ search containers and pages ▾ ]      │
│     Shape  like its 993 rows — artifact/movie     │
│            not that — make it a… ▾                │
│     Fields                                        │
│       Board Category ← movie              (auto)  │
│       Year           ← ⟨pick a source⟩ ▾          │
│       + field…                                    │
│     [ Save as preset… ]                           │
│                                                   │
│ ( ) Preset  [ Movie ▾ ]                           │  ← Movie · Recipe · Article
│     …fills the same form, still editable          │
│                                                   │
│                          [ Cancel ]  [ Clip ]     │
└───────────────────────────────────────────────────┘
```

**Three modes, one row of radio buttons: Auto · New · Preset.** A preset is a
saved *New*, so choosing one is a first-class option rather than a dropdown
hanging off the manual pane.

**The grid is chosen in every mode.** Auto runs that grid's rules; New and Preset
place into that grid. The grid dropdown defaults to the user's share grid
(`GET /me/share`) and lists `GET /grids`.

**Auto names the rule it will run**, before you commit. The entire reason this
feature exists is a clip that went somewhere the user could not find; a mode
called "auto" that will not say where is the same failure with a nicer label.
Resolved by matching the staged clip's type against that grid's `onShare`
operations in order — the first non-halted match, or "no rule matches — the
catch-all will file it".

**Shape comes from the destination, with an override.** Pick Movies and the new
row is shaped like its 993 siblings: `artifact/movie`, their bindings,
`Board Category` pre-filled. This is what the app's own `+` already does —
`siblingFieldBindings` pre-ticks whatever the row's siblings bind, and its
comment says why: *"so the common case is one Enter and the uncommon case is
unticking."* The override (`not that — make it a…`) covers clipping something
unlike its neighbours: bookmark · textblock · image, with the labels read from
`QuickAddMenu.KIND_TILE` so the two vocabularies cannot drift.

**The field table starts empty and is built by hand** (user's choice), except for
the values the destination's shape implies (`Board Category: movie`), which are
pre-filled and marked `(auto)`. `+ field…` is `ui/FieldSelect` over every field
on the grid.

**Every mapping row shows the value it will write, in an editable box.** Not the
source's name — the value:

```
Title  ← page title ▾  ↳ strip suffix ▾
       [ A Guide to Recognizing Your Saints        ]
Year   ← page title ▾  ↳ extract year ▾
       [ 2006                                      ]
```

A mapping that silently resolves to empty is the failure mode of this whole
screen, and it is invisible without this. The user's own example is why the box
is EDITABLE as well as visible: IMDb's page title is
`"A Guide to Recognizing Your Saints (2006) IMDb"`, which is nobody's idea of a
movie title.

**Sources** per row: page title · page URL · link URL · selected text · image
source · site name · `og:description` · `og:image` · today's date · a literal
you type.

**Transforms** — a small fixed set, not a language: trim · strip a suffix ·
extract a year · extract a number · text inside parentheses · lowercase. Each is
a pure `(string) => string`, listed in one table so the set is countable and
testable. Anything they cannot express, the editable box can.

**An edit is a value for THIS clip, never a change to the preset.** Typing in
the box overrides the resolved value for this placement only; the preset keeps
its `{ source, transform }` so the next movie still resolves its own title. A
preset stores a literal only when the row's SOURCE is "a literal you type" —
otherwise saving one movie would freeze its title into every movie after it.

## 5. Presets

A preset is **a saved shape, not a trigger** (user: *"there is no rule from
IMDB"*). Nothing about a preset fires on its own; it exists so that adding your
own stuff is quick.

```js
grid.meta.sharePresets = [
  {
    id, name: "Movie",
    role: "artifact", kind: "movie",
    destinationId: "0cti4si13ijy",   // optional — omit and you pick each time
    bindings: [ownedFid, driveFid, sizeFid, filePathFid, yearFid, boardCatFid],
    mappings: { [boardCatFid]: { source: "literal", value: "movie" },
                [yearFid]:     { source: "none" } },
  },
]
```

Per GRID, because a preset names that grid's fields and containers. Stored
through the existing `PATCH /grids/:id`, so no new persistence.

Picking a preset fills the form and leaves everything editable — a preset is a
starting point, never a commitment.

## 6. Server pieces

Four, three of them new.

**`POST /api/v1/share/stage`** — takes the same body `/share` takes, stores it
user-scoped with a 10-minute TTL, returns `{ stageId, key }`. Writes nothing to
the grid. Called by the extension (with its API token) and by `SharePending`
(with the session).

**`GET /api/v1/share/stage/:id?k=<key>`** — returns the staged payload. **The key
IS the authorization**, so the popup works in a browser that is not signed in —
no login detour between clipping a thing and placing it.

**What the key can do, stated plainly, because it is a credential in a URL.** It
is 32 random bytes; it authorizes exactly two calls against exactly one staged
payload — read it, and commit it — and nothing else. It cannot read a grid, list
occurrences, or write anything but that one placement. Reads do not consume it;
the COMMIT does, and it dies at 10 minutes regardless. The URL is constructed by
the extension and handed to `windows.create`, so it is never typed, linked or
shared. If the popup needs the grid list, the destination search or the field
list, those still require the session or a token — so a leaked key exposes one
pending clip, not an account.

**`GET /api/v1/destinations?gridId=&q=&limit=`** — `[{ id, label, crumb, role,
kind, childCount }]` for containers and pages. **This is new because the
existing endpoint cannot do it:** `GET /occurrences` has no label search and
`Occurrence.find(filter)` loads every row for the grid before paginating — 22k
on poms. Query direction matters for speed: match `q` against MODULE labels
(role in container/page) first, then find the occurrences pointing at them;
crumbs walk a bounded parent chain. Capped at ~50.

**`POST /api/v1/share` gains `mode: "manual"`** (authorized by the session, a
token, or a stage key naming that stage) carrying
`{ parentId, role, kind, bindings[], fields{} }`. It skips `runShareRules` and
writes one occurrence, and — this is the point — still appends to `shareLog`, so
a hand-placed clip appears in the Imports tab's Recent shares beside every other
share. `externalId` dedupe is unchanged, so re-clipping the same link updates
rather than duplicates.

## 7. One definition of what a clip becomes

This will be the **third** surface that turns a clip into an occurrence, after
the share rules and `buildClipRecord`. The manual path must therefore build the
same record shape the rules consume and hand it to the same writer — not mint
occurrences of its own. Two implementations of one question is the class this
log has paid for repeatedly (the comparator lists, the paste paths, the id
unwrappers); a third one here would drift the first time a field type is added.

## 8. Testing

| what | how |
|---|---|
| stage lifecycle | create → read → commit → 404; expiry; a WRONG key gets 404 (not "another user" — the key is the authorization, so that is the case that matters) |
| destination search | shape AND speed against a 22k-occurrence grid; label match, crumb correctness, the cap |
| the mapping resolver | pure function, every source × every field type, **including the empty cases** — the failure this screen exists to prevent |
| shape-from-destination | a container of 993 `artifact/movie` rows yields that role, kind and bindings; an EMPTY container falls back to the override list |
| `mode: "manual"` | writes exactly one row, with the mapped fields, AND appends to `shareLog`; re-running the same stage does not duplicate |
| the two menu items | route to different paths — instant posts `/share`, "choose…" posts `/share/stage` and opens the window |
| transforms | each is a pure `(string) => string` with its empty/no-match case pinned; "extract year" against a title with two years, with none, and with a year in the URL |
| an edited value | overrides THIS placement and does NOT change the preset it came from — the case that would otherwise freeze one movie's title into every movie |
| the stage key | reads do not consume it · the commit does · it is refused after expiry · it cannot commit a DIFFERENT stage · it cannot read the grid, list occurrences or write anything else |
| a phone share | `SharePending` stages and redirects to the same window; Auto there behaves exactly as posting straight to `/share` did |
| presets | save → appears → picking one fills the form → editing after picking does not mutate the stored preset |
| the window itself | driven in a real browser against the IMDb clip, end to end, into Movies |

That last row is not optional. This repo's record on this exact class is
explicit: the chart's `nodeClick`, the pointer-capture bug that ate every click,
the spread that was full-screen in the stylesheet and rendered in a quadrant —
three defects a real browser found and no unit test could. A window is a place
you look at.

## 9. Built in one pass

Presets ship with the window rather than as a phase 2 (user's choice), so the
first movie you clip can be saved as `Movie` and the second one is two clicks.

## 10. Out of scope

- Conditions on presets ("always do this for imdb.com"). The user was explicit:
  a preset is a shape, not a rule. Rules already exist and have their own editor.
- Editing share RULES from this window. That is the Imports tab.
- Any second field picker. `ui/FieldSelect` is the one (2026-09-28: *"any place
  that selects a field should be using that one"*).
- Scraping the page for richer metadata (a year, a director). The window maps
  what the clip already carries; enriching a clip is its own pass.
