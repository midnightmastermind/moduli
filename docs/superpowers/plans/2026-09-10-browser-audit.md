# The browser: audit + plan — 2026-09-10

User: *"do a full audit on the browser itself and make a plan to optimize and speed
it up. right now its still lagging like crazy, heights are all off, and i still
cant access web pages that raindrop can (aka washington post). i need it quicker
and not to slow down the app"*

Everything below is measured against the user's OWN 1,467 bookmarks through the
REAL server path (`fetchPageHtml` → `readerFromHtml` → `framingVerdict`), not
read off the code. Probes: `_audit.mjs`, `_uafix.mjs`, `_wapo.mjs`, `_snap.mjs`,
`_ua.mjs` (scratchpad).

---

## What one bookmark open actually does

```
open ──▶ page_reader (server fetches the whole page)   ← THE VIEW IS BLANK UNTIL THIS RETURNS
           ├─ usable text?      ──▶ reader
           ├─ framable?         ──▶ live iframe
           └─ neither           ──▶ wayback_lookup (a SECOND round trip) ──▶ archive
```

Nothing renders until the first fetch answers, because `resolveMode` returns
`"loading"` while `fetched` is null.

## MEASUREMENT 1 — where 60 real bookmarks land

```
  21   35%  reader
  19   32%  BLOCKED (site refuses framing)  → archive, or a dead end
  13   22%  FETCH FAILED                    → archive, or a frame that will also fail
   4    7%  live frame
   3    5%  embed (youtube/vimeo)
```

**~54% of opens depend on the archive path**, which is a third network round trip
and is the least reliable thing in the chain (measurement 4).

## MEASUREMENT 2 — the blocking wait

```
median 401ms · p75 771ms · p90 2880ms · p95 3332ms · max 8583ms
over 1s: 10/60    over 3s: 5/60    hit the 6s leash: 1/60
```

The 8583ms is the Washington Post — note it EXCEEDS its own 6000ms leash, because
aborting the socket took longer than the leash allowed.

## MEASUREMENT 3 — our User-Agent is being tarpitted

```
washingtonpost.com   Moduli UA   FAIL 14792ms  (timeout — it never answers)
                     Chrome UA    200   151ms   987KB
```

Across the same 60 bookmarks, browser UA vs current:

```
fetch succeeds   48/60 → 48/60   (+0)      ← NOT a coverage fix
reader usable    22/60 → 21/60   (−1)      ← noise
fetch time       median 386→153ms · p90 958→649ms · max 6529→1536ms
total wall       33.0s → 15.4s   (−53%)
```

**Stated plainly: this is a LATENCY fix, not a coverage fix.** It unlocks no new
pages; it removes the worst hangs. And no single UA wins — `kickstarter.com` is
the exact inverse (200 on the Moduli UA, 403 on Chrome), so it needs a fallback.

**Order by cost-of-failure:** Chrome UA first, retry with the plain UA on 401/403.
A wrong-UA failure costs 20ms and is cheap to retry; a tarpit costs 15 seconds
and is not.

## MEASUREMENT 4 — 77% of the library cannot be framed at all

Of the 47 that answered:

```
framable       11
REFUSES        36     22 x-frame-options: sameorigin
                      10 x-frame-options: deny
                       4 csp frame-ancestors
```

So "Web" mode — the default — is unavailable for three quarters of these
bookmarks. That is a property of the sites, not a bug to fix.

## MEASUREMENT 5 — the archive is BETTER than the live page, and is rate-limited

The Washington Post, end to end:

```
live page,  Chrome UA   200 · 987KB · reader   91 words · x-frame-options SAMEORIGIN
snapshot   (2023-12-05) 200 · 411KB · reader 1614 words · NO x-frame-options  ← framable
```

**The snapshot is both framable AND readable where the live page is neither.**
That is exactly what Raindrop shows, and we already fetch it — we just reach for
it last and unreliably:

```
archive.org/wayback/available, 5 serial lookups, 400ms apart:
  429 · 429 · 429 · 429 · 200
```

There is no retry and no backoff. One observed variant returns **HTTP 200 with an
HTML body**, which sails past the `if (!res.ok)` guard and dies in `res.json()` —
surfacing to the user as `Unexpected token '<'`.

*Caveat owned: my own probes were hammering archive.org, so the 429 rate is an
upper bound on what a real user would see. The absent retry is not.*

## MEASUREMENT 6 — the spread mounts N browsers at once

`ArtifactCard`'s spread branch passes `isActivePage` **hardcoded true**, so every
bookmark card in a spread mounts a live iframe AND fires its own `page_reader`.
`--spread-cols` is 3 by default. `BookmarkView`'s own header says the rule exists
so "1,467 bookmark rows must never be able to become 1,467 frames" — the spread
is the hole in it.

**This is the "slows down the app".**

## MEASUREMENT 7 — height is decided by the neighbours

```
.artifact-spread-body[data-count="1"]  --spread-cols: 1    82vh
.artifact-spread-body[data-count="2"]  --spread-cols: 2    66vh
.artifact-spread-body                  --spread-cols: 3    42vh in a grid
.instance-wrap:has(.artifact-card--bookmark-open) { height: 100vh }  ← capped by the above
```

A browser's height should not depend on how many other things are open beside it.
**NOT YET MEASURED IN A BROWSER** — these are the rules, not rendered rects. The
suspected second cause is that `ArtifactContent` returns `<BookmarkView>` bare and
its root is `flex: 1`, which is inert unless the parent is a flex container — the
same class the file already fixed one level down. Confirm with rects before fixing.

---

# THE PLAN, ordered by measured impact

### 1. Browser User-Agent, with a fallback  *(server, isolated)*
`safeFetchUrl.fetchPageHtml` sends a Chrome UA + `Accept-Language`; a 401/403
retries once with the current Moduli UA.
**Buys:** total 33.0s → 15.4s, max 6529ms → 1536ms, WaPo 14.8s → 0.44s.
**A/B:** the retry must fire on kickstarter (403 → 200); reverting must restore
the WaPo timeout. Assert the mutation lands.

### 2. Stop blocking the view on the reader fetch  *(client)*
`resolveMode` returns `"loading"` for every non-embeddable url. Instead: decide
from what is known immediately (embed → frame), render, and UPGRADE to reader
when the read lands. The spinner becomes an overlay, not a gate.
**Buys:** first paint stops waiting on p90 2880ms / p95 3332ms.
**Risk, and it is the real one:** a page that resolves to `reader` would flash the
frame first. Mitigation — hold the frame's `src` for a short grace window
(~250ms) so a fast read (median 401ms… so most reads do NOT beat it) still wins.
**This one needs a measurement before it is built:** how many reads land inside
250ms. If it is most of them, this whole item is not worth the flash.

### 3. Archive-first for the cases that cannot be framed  *(client + server)*
When the fetch says `framable === false` AND the reader is thin — 32% of opens —
go to the snapshot rather than framing a page we know will refuse. Add retry +
backoff to `wayback_lookup`, and treat a non-JSON 200 as a failure with an honest
reason rather than letting `res.json()` throw.
**Buys:** the Washington Post, and 19 of every 60 opens, become a page you can
actually read (1,614 words vs 91).
**Control:** a framable page must NOT be diverted to the archive.

### 4. One live browser at a time in a spread  *(client)*
Stop passing `isActivePage` hardcoded true from `ArtifactCard`. Only the focused
card frames and fetches; the rest render their cover and a "click to open".
**Buys:** the app-wide slowdown — N iframes + N server fetches become 1 + 1.
**Control:** opening a single bookmark must still frame immediately.

### 5. Height independent of neighbour count  *(CSS, after measuring)*
Measure the rendered rects first. Then: an OPEN browser takes the overlay's
height regardless of `data-count`, and the root gets a definite height rather
than an inert `flex: 1`.
**Verification is a rect, not a rule** — this repo's own record is that a layout
claim is unverified until someone measures the box.

### 6. NOT DOING, and why
- **Caching reads per url.** Tempting, but a re-open is not the reported problem
  and a stale read on a page that changed is worse than a 400ms wait.
- **A local snapshot store (true Raindrop).** Storing our own copy at save time is
  the only thing that fully closes the paywalled/bot-blocked case, but it is a
  storage-model decision (where copies live, how big, when refreshed) rather than
  a perf fix, and item 3 gets most of the benefit for none of that cost.

---

## Honest limits of this audit
- 60 of 1,467 bookmarks, evenly spread — not the whole library.
- The archive 429 rate is inflated by my own probe traffic.
- Items 5 and the `flex: 1` suspicion are read off the CSS, **not measured in a
  browser**. They are the two claims here that could still be wrong.
