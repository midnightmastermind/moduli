# Search providers on an occurrence dropdown — a picked result arrives with its fields filled

**User, 2026-08-23:** *"loop in diff search queries for the multi select box. so when
i have a movies one, i can loop in like a imdb search or for workouts do a workout
one, food one, book one, music one, etc"* · *"wikiepedia search"* · *"or do we need
special indexers"* · *"it would be like looping in search providers and we have
prefilled fields that come with those new occurances"*

---

## 1. The answer to "do we need special indexers"

**Wikipedia alone is not enough, and it is also not nothing.** The split is sharp
and it decides the whole design:

| what you want | Wikipedia gives it? |
|---|---|
| a film / book / album / artist EXISTS, with a title, year, summary, poster | **yes** — and `services/wikipediaTools.js` already does search + summary + `extractInfobox`, which parses the sidebar into label/value rows |
| calories · protein · carbs · fats **per serving** | **no** |
| an exercise's muscle group · equipment · movement pattern | **no** |
| a specific book EDITION (ISBN, page count, cover) | **no** — the article is about the WORK |
| a track's length, album, release date | **thinly** — article-level, not track-level |

So Wikipedia is the right DEFAULT provider for "is this a real thing, and what is
it called", and it is genuinely useful today because the infobox parser already
exists. **Domain fields need domain sources.** None of these need scraping:

| domain | source | key? | gives you |
|---|---|---|---|
| film / TV | **TMDB** | free key | title, year, runtime, genres, poster, overview |
| books | **Open Library** | none | title, author, first published, ISBN, cover |
| food | **USDA FoodData Central** | free key | per-100g macros + micros — matches the fields `0123` already fills |
| food (packaged) | **Open Food Facts** | none | barcode, per-serving macros, brand |
| music | **MusicBrainz** + Cover Art Archive | none (rate-limited, UA required) | artist, release, track, cover |
| exercise | **wger** | none | name, muscle group, equipment, category |
| anything else | **Wikipedia** | none | title, extract, thumbnail, infobox rows |

**IMDB itself has no free public API** — TMDB is the one people actually use for
this, and it carries the poster the Movies board already wants.

---

## 2. It is one mechanism, and three quarters of it already ships

Nothing here is a new subsystem. The pieces exist and have never been joined:

```
optionsSource.find      an occurrence dropdown already resolves its options by predicate
addNew                  "+ Add new" already MINTS an option into a chosen parent board,
                        copying identity fields off that parent (helpers/addNewOption.js)
addNew.fieldIds         already prompts for field values through GET_USER_INPUT
prefill (0042)          already fills a row's fields FROM a picked occurrence
/api/images/search      already proxies a public endpoint, keyless, server-side
wikipediaTools          already does search / summary / infobox -> label,value rows
```

**What is missing is a SEARCH step before the mint, and a mapping from a provider's
record onto the new occurrence's fields.**

---

## 2b. THE LIST IS MERGED, NEVER REPLACED

**User, 2026-08-23:** *"i want to make sure we are looping the search options in.
we still have our search for our own occurances merged in there."*

This is the load-bearing constraint and it shapes the UI more than the providers
do. A dropdown already searches YOUR OWN occurrences — the board's rows, resolved
by `optionsSource.find`'s predicate. A provider **adds a second source to the same
list**; it does not take the list over.

```
  type "inception"
  ┌─────────────────────────────────────────────┐
  │ ON YOUR GRID                                │   <- always first, always shown,
  │   Inception            Movies board         │      even when a provider is slow
  │   Inception (2010) …   Watchlist            │      or offline
  ├─────────────────────────────────────────────┤
  │ FROM WIKIPEDIA              ⟳               │   <- arrives late, appended
  │   Inception — 2010 film by C. Nolan         │
  │   Inception (soundtrack)                    │
  └─────────────────────────────────────────────┘
```

Three rules fall out of that, and each is a way this could go wrong:

- **Your own rows resolve LOCALLY and render immediately.** They must never wait on
  a network call. A provider that is slow, rate-limited or down degrades to
  today's behaviour exactly — the list still works.
- **A provider result that ALREADY EXISTS on your grid is not offered twice.**
  Matched on the identity the provider gives (a TMDB id, an ISBN, a Wikipedia
  page id) stored on the occurrence when it was imported — never on the title,
  because "Inception" the film and "Inception" the soundtrack are different rows
  and `0035` is what a title match costs.
- **The two sections are visibly different**, because picking one does something
  different: your own row is SELECTED, a provider row is IMPORTED — it mints an
  occurrence and fills its fields. A single undifferentiated list would make the
  second look like the first and quietly grow the board.

## 3. Shape

**A provider is DATA on the field**, the way `optionsSource` and `addNew` already
are — never a hardcoded list of domains:

```jsonc
// field.meta.searchProvider
{
  "provider": "tmdb",              // registry key; "wikipedia" is the default
  "fieldMap": {                    // provider record path -> field id on the new occurrence
    "title":      "<Name fieldId>",
    "year":       "<Year fieldId>",
    "poster_url": "<Poster fieldId>",   // an ARTIFACT, minted like 0121 does
    "overview":   "<Notes fieldId>"
  }
}
```

**Server owns every provider.** One route, `GET /api/v1/search/:provider?q=`,
normalising to `{ id, title, subtitle, thumbnail, fields: {...} }`. Reasons this is
not client-side: API keys must not ship in a bundle; several providers forbid
browser CORS; and rate limits belong in one place (`safeFetchUrl`'s guard and the
per-provider queue `0054` already needed for Nominatim).

**The picker is the intake sheet's second step**, which already exists —
`followUp: { kind: "choose-one" }` (2026-08-09 (2)) renders a list of options in
place. A search result list is that same control with a text input above it.

**A picked result mints the option and stamps the mapped fields**, reusing
`addNew`'s existing parent-choice + `buildStampFields`. The only new write is the
field map.

---

## 4. Order, smallest first

1. **The registry + one keyless provider (Wikipedia).** Proves the whole path with
   zero credentials, and the infobox parser makes it immediately useful.
2. **The field map**, driven by the Movies board — title, year, poster. Poster
   mints an artifact through `0121`'s existing route rather than storing a URL.
3. **Open Library** (books, keyless) — a second provider proves the registry is a
   registry and not a Wikipedia special case.
4. **TMDB** — the first keyed provider; establishes where a key lives
   (`server/.env`, never the bundle) and what happens when it is absent (the
   provider is simply not offered, rather than failing at search time).
5. **USDA / Open Food Facts** — the highest-value one, because the ingredient
   fields it fills (`0123`'s fourteen micronutrients) are the ones currently typed
   by hand.
6. **wger** for movements, if the existing Movements board still wants rows.

---

## 5. Decisions that need the user

- **Does a picked result OVERWRITE a field the row already has?** `prefill` never
  overwrites with empty but does overwrite with a value; a search import probably
  should not clobber something typed by hand.
- **One provider per field, or a chooser at search time?** A Media field spanning
  film + book + music would want the latter.
- **Keys.** TMDB and USDA are free but need an account. Nothing is blocked on them
  — steps 1-3 are keyless.

## 6. Risks worth naming up front

- **A provider's record is not a fact about the user's grid.** The `0052`/`0054`
  rule applies: a plausible value that nobody entered is indistinguishable from one
  they did. Every mapped field should be visibly attributable, and a provider that
  returns nothing must leave the field EMPTY rather than guessing.
- **Rate limits are per provider, not shared** — the mistake `0054` already
  corrected once for Nominatim.
- **A search box that mints on every keystroke** is how a board fills with junk.
  The mint happens on an explicit pick, never on a query.
