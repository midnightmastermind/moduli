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

## Interaction

| gesture | behaviour |
|---|---|
| **double-click** a bookmark | opens it in a panel. Double, not single — a single click competes with the drag handle |
| double-click with **no panel set** | opens in an iframe in the cell the bookmark is on |
| **right-click → Open in panel** | secondary menu picks WHICH panel |
| **right-click → Import as page** | the existing `import_url` path |

### Framing, and the fallback that makes it honest

Measured, not assumed:

```
github.com     x-frame-options: deny        will not frame
youtube.com    x-frame-options: SAMEORIGIN  /watch blocked, /embed/ fine
reddit.com     restrictive CSP
google.com     blocked in practice
wikipedia.org  frames fine
devin.ai       frames fine
```

Roughly a third of the collection is on domains that answer an iframe with a
blank box. So: **try to frame; where the site refuses, fetch it server-side
through `import_url` and render the readable text in the panel**, with an
"open in a new tab" escape. The user stays inside Moduli either way, and nothing
silently shows an empty panel.

---

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
4. **An iframe in a panel is a new render surface.** Sandbox attributes,
   scrolling, and what happens on navigation inside the frame are unspecified
   here and need their own pass.

---

## Build order

1. The importer + `Bookmark` module/field shape (a migration, dry-runnable)
2. The Lookup page — smallest, proves the parse
3. The board, with covers from the export only
4. The image search for the 437, as its own re-runnable pass
5. Double-click → panel, with the framing fallback
6. Right-click → open-in-panel (panel picker) and import-as-page
