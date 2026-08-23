# Bookmarks — a Raindrop export becomes a board you can open in a panel

**User, 2026-08-22:** *"i want to add in a task to look at bookmark artfifacts and
start building those out. im going to give you a raindrop export and i want you to
create a board page of bookmarks where i can click into and it opens the url inside
of the panel or i can right click it and import it as a page"*

Source: `screenshots/eb0a375c-4aed-4436-aa66-2c68d50cadc5.csv` — 1,847 rows,
51 folders, 670 domains, 2017 → 2026.

---

## What the export actually holds, measured before any design

```
1,847  bookmarks
1,163  (63%) in "Unsorted"
  324  on google.com — of which 281 are SEARCHES and 43 are real bookmarks
                        (accounts.google.com, remotedesktop.google.com)
  104  duplicate rows across 77 distinct URLs
1,211  carry a cover image · 1,052 an excerpt · 0 notes · 0 favorites
   28  tags — 19 auto-generated DATES ("21/08/2025") covering 906 bookmarks;
       only 9 are real: ai_project articles philosophy opportunities learning
                        videos want friends entertainment
   10  folders auto-named "Jul 24 at 11:34", covering 76
```

**The 43 non-search Google links are the reason to measure rather than assume.**
A rule of "drop google.com searches" written from the domain alone would have
silently dropped four dozen real bookmarks.

---

## What gets imported

```
1,847  total
 -281  google searches            -> become the Lookup page
  -99  duplicate URLs             (earliest kept; the rest listed in the log)
─────
1,467  bookmarks
```

Plus **273 distinct Lookup terms** (281 searches, 8 of them repeats).

---

## The Bookmarks board

**Flat**, one board page, one row per bookmark. The Raindrop folder is NOT a
container — it goes into `Tags` alongside the real tags, so filtering by tag
recovers any folder. (User: *"take the tags and put them in the tags field, add
the category in the tags field too"*.)

| field | source | count |
|---|---|---|
| label | `title` | 1,467 |
| `URL` | `url` — **what a double-click opens** | 1,467 |
| `Cover` | `cover`, else an image search by title | 1,030 + 437 |
| `Excerpt` | `excerpt` | 952 |
| `Tags` | the 9 real tags + the folder name | 253 + 1,400 |
| `Created` | `created` | 1,467 |

**`Cover` is its own field and must not be the URL field** — that one is the
destination the click follows. (User: *"we cant put it in the url field cause
thats what the click goes to"*.)

**Modules are CLONED per row**, consistent with the rest of the grid — the user's
explicit call after being shown the cost (1,467 extra modules, and every future
delete strands one unless it goes through `utils/migrationDelete.js`).

---

## The Lookup page

Its own page. 273 search terms as tickable instance rows — a backlog of
curiosity, not a search history: **no URL, nothing auto-fetched.** The terms are
a real trail: *hand of mysteries · the fibinacci sequence · gnosis nomind wu weu
· does the davinci code have any history*.

---

## The `iframe` view — the piece this is really built on

**User:** *"we need a whole iframe view that can go on links and bookmark
artifacts so we can open them up in a panel"* / *"it should probably work like
folder does with its views"* / *"the iframe itself acting as a folder view mode
wise, and we put that view on links and bookmark artifacts"*.

**There is no new mechanism here, which is the point.** `helpers/layoutCascade`
already declares views per role and kind:

```
folder     dragInView: "preview"   navOptions: ["preview","representation"]
artifact   dragInView: "actual"    navOptions: ["preview","actual"]
board/doc  dragInView: "actual"    navOptions: ["preview","representation","actual"]
```

So `iframe` becomes an entry in that same table, shaped like `folder`, and links
and bookmark artifacts declare it. The header switcher that already flips a
folder page between preview and representation is the control.

**For a bookmark, `actual` IS the web page** (user's call). Its own fields are
what you see on the row; the actual content is the site.

### The limit, and it is not optional

`modules/PreviewNode.jsx` records that preview cards USED to be iframes
(`<iframe src="/?previewOcc=X">`) and were replaced on 2026-05-25 because
**11 on screen pegged the browser**. 1,467 bookmark rows as live frames is not a
thing that can be allowed to happen by accident.

**So a frame renders only where the occurrence is the ACTIVE page of a panel.**
Anywhere else — a row on the board, a card in a container, a node on a canvas —
it draws its cover and title. Five panels means at most five frames, by
construction rather than by a cap somebody can raise.

### What carries it

- **bookmark artifacts** — the 1,467
- **link chips in documents** — the inline `meta.link` nodes the intake shapes
  already mint
- **any occurrence carrying a URL field** — a Place with a website, a Person's
  LinkedIn

That last one is what keeps `noDomainKnowledge` satisfied: the view is offered
because a row HAS a url, never because something learned what a "bookmark" is.

### Two modes, READER FIRST

**User:** *"can you make sure to open in text preview mode if possible. text
reader or whatever"* and *"have the iframe have buttons at the top to switch
between reader and web"*.

**Reader is the default.** The page is fetched server-side through `import_url`
and rendered as OUR DOM: faster, no third-party scripts, and selection,
right-click and turning text into modules all work without a mode switch.

**Web** is the live site in a frame — interactive, navigable, and what you switch
to when you need the real thing (a logged-in view, an app, a video). Sandboxed
`allow-scripts allow-same-origin allow-forms allow-popups` WITHOUT
`allow-top-navigation`: links and forms work, and a page cannot navigate the grid
away.

The strip carries an explicit toggle, so neither mode is a hidden state:

```
┌──────────────────────────────────────────────────┐
│ ‹ ›  wikipedia.org/wiki/Main_Page  [Reader|Web] ⋮ │  <- ours
├──────────────────────────────────────────────────┤
│                                                   │
└──────────────────────────────────────────────────┘
```

### "If possible" is doing real work — measured

Fourteen of the user's own bookmarks, one per domain, fetched server-side:

```
coffeehousetheology 11,941 words    en.wikipedia.org  12,997
cslewisinstitute     5,709          danbrown.com       3,896
prs.org              3,072          eppc.org           3,033
divinity.uchicago    1,257
──────────────────────────────────────────────────────────
devin.ai   429 (HTTP 429)   scribd 195   blog.spl.org 108
catholiceducation 108       viafluere 116   amazon 62   reddit 29
```

**About half yield a real read; the rest return a JavaScript shell.** Reddit is
the clearest — 29 words, because the page builds itself in the browser.

So the default is reader **when the fetch yields enough text**, and web
otherwise. A reader view showing 29 words of nav chrome is worse than the site.

*Caveat on those numbers:* they came from a crude regex tag-strip, not the app's
readability extractor, so they are indicative and probably pessimistic. The
threshold must be calibrated against the REAL parser before it is hardcoded —
picking a number off this table would be tuning against the wrong instrument.

**The framing-refused fallback is the same code as reader mode.** github, reddit
and google refuse to frame; in reader-first that mostly stops mattering, because
the frame is the opt-in rather than the default.

### What CANNOT work, established by measurement rather than assumed

```
frame's contentDocument   ->  null — cross-origin
frame's getSelection()    ->  SecurityError
right-click inside frame  ->  the parent receives NOTHING (only window-blur)
right-click OUTSIDE it    ->  the parent receives contextmenu   <- the control
an overlay over the frame ->  elementFromPoint returns the overlay
```

So **"right-click text inside the live frame and make a module" is closed by the
browser**, not by our code. It is the same wall that stops the framed page
reading the grid, and no flag opens it. That is the entire reason clip mode
exists.

**Dragging text OUT of the frame works**, because the browser owns the drag and
carries it across the boundary itself — it arrives in our `drop` handler as
ordinary `text/plain`, which `handleExternalDrop` already classifies into a
textblock. Almost nothing new is needed for the gesture the user asked for first.

*Not verified end to end:* a synthetic drag produced no drop, but this repo
already records that synthetic drags do not drive the real machinery, so that is
a claim about the probe. One real drag confirms it.

### The chrome strip

Our controls live ABOVE the frame, outside it, where clicks and right-clicks
reach us:

```
┌──────────────────────────────────────────┐
│ ‹ ›  wikipedia.org/wiki/Main_Page  ✂ ⋮   │  <- ours
├──────────────────────────────────────────┤
│          the live page, interactive       │
└──────────────────────────────────────────┘
```

No modes to remember and no modifier keys: the page below stays live at all
times, and everything of ours is reachable without competing with it.

## Interaction

| gesture | behaviour |
|---|---|
| **double-click** a bookmark | opens it in a panel. Double, not single — a single click competes with the drag handle |
| double-click with **no panel set** | opens in the cell the bookmark is on |
| **right-click → Open in panel ›** | picks the TARGET panel, and it STICKS |
| **right-click → Import as page** | the existing `import_url` path |

### The target panel is a sticky, grid-wide setting

**User:** *"i should be able to set in the right click menu, a panel ... and it
should be set as that until i turn it off. so when i double click then on the
bookmark, it opens in the panel i selected. if none is selected, we open in the
panel we are opening it from."*

One reading panel for the whole grid, held on the grid rather than per row —
setting it per bookmark would mean 1,467 places to change your mind.

```
right-click any bookmark → Open in panel ›
                              • Panel A
                              ✓ Panel C     <- sticky, until cleared
                              • Panel D
                              ─────────
                              • Clear
```

**Unset is the default and it is invisible:** with no target, a double-click
opens in the panel it was clicked FROM. Setting a target is how you say "no,
over there", so the feature costs nothing until it is wanted.

**A stale target falls back to the same rule.** If the chosen panel is gone, the
double-click opens where it was clicked rather than failing — the setting quietly
stops applying instead of swallowing the click. It does NOT re-open a closed
panel: changing the layout as a side effect of a double-click is a surprise, and
the click still has somewhere obvious to land.

## Risks, stated rather than discovered later

1. **The `Tags` field goes from 45 values to ~95** (41 folders + 9 tags). It is
   also the field `0164`'s tracker category axis reads, so its dropdown and that
   axis both grow. Worth a look before committing.
2. **437 image searches** at the `0121` rate (one per ~400ms) is ~3 minutes, and
   the route proxies a public endpoint. It must be probed first and REFUSE
   rather than half-populate — a board where some rows have invented covers and
   others none is worse than one with no covers.
3. **~1,470 new occurrences and ~1,470 new modules** on a grid holding 3,455 and
   3,204. Every `full_state` carries them. Accepted knowingly.
4. **Sandboxing is unspecified.** What `sandbox` attributes the frame carries,
   whether scripts run, and what happens when the user navigates INSIDE the
   frame are not settled here. A frame that lets a page break out of it is a
   security question, not a layout one.

---

## Build order

**The `iframe` view comes first** — it is the mechanism, the bookmarks are only
its first consumer, and it is testable on a single link chip instead of 1,467
rows.

1. The `iframe` view in the layout cascade + the active-page-only rule
2. The framing fallback (refused → server-side fetch → reader)
3. The importer + `Bookmark` shape (a migration, dry-runnable)
4. The Lookup page — smallest, proves the parse
5. The board, with covers from the export only
6. The image search for the 437, as its own re-runnable pass
7. Right-click → open-in-panel (panel picker) and import-as-page
8. **The browser extension** — see below

---

## 8. The browser extension

**User:** *"add a windows menu shortcut so i can right click on the stuff inside
the iframe"* / *"ive seen raindrop do this"* / *"how does raindrop get away with
it"*.

**Windows has nothing to do with it, and that is the useful correction.** The
Windows shell context menu only appears over Explorer and the desktop. What
appears over a web page is the BROWSER's menu — styled to look native on
Windows, which is why "Save to Raindrop.io" reads like a shell item. It is an
entry Raindrop's EXTENSION contributes through `chrome.contextMenus`.

**And that is exactly why it works inside an iframe.** An extension declares
`"all_frames": true` with host permissions, so its content script is injected
INTO the framed document — it is a resident of that page, not an outsider
reaching in. Our parent page is the outsider, which is why it gets
`SecurityError` on `contentWindow.getSelection()`.

So the extension is not a workaround for the thing we could not build. It is the
same thing Raindrop does, and the only design that could ever have worked.

**It also makes the iframe less load-bearing.** Clipping from any tab is more
useful than clipping from a panel, so the in-app view becomes a convenience
rather than the only route to capture. Worth knowing before spending on it.

### The menu

| context | action |
|---|---|
| selected text | → textblock |
| the page | → bookmark (title, url, og:image) |
| a link | → bookmark, without visiting it |
| an image | → artifact |

### Where a clip lands

**The `Imports` folder** — it already exists (`efefe286-…`) with a shared
find-or-create helper (`helpers/importsFolder.js`), so this reuses the
destination every other intake path uses rather than inventing one. Opening a
clip afterwards targets a panel the user picks, the same secondary menu the
bookmark rows use.

### The receiving end already exists

`POST /api/v1/ingest` — token auth with scopes, idempotent on
`(source, externalId)`, batches of up to 200, 18 tests, and a written guide
whose own worked example is a Raindrop bookmark. The extension is a thin client
over an endpoint that already works; it needs no tab open and no socket.

**Chrome/Edge and Firefox both** — one codebase, two manifests. The difference
is the background service worker vs event page model.
