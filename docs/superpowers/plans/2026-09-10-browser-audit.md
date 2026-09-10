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

### 1. Browser User-Agent, with a fallback  *(server, isolated)* — **SHIPPED `ef821f0c`**
`safeFetchUrl.fetchPageHtml` sends a Chrome UA + `Accept-Language`; a 401/403
retries once with the current Moduli UA.
**Buys:** total 33.0s → 15.4s, max 6529ms → 1536ms, WaPo 14.8s → 0.44s.
**A/B:** the retry must fire on kickstarter (403 → 200); reverting must restore
the WaPo timeout. Assert the mutation lands.

### 2. Stop blocking the view on the reader fetch — **RESHAPED AND SHIPPED `3e42c564`**
`resolveMode` returns `"loading"` for every non-embeddable url. Instead: decide
from what is known immediately (embed → frame), render, and UPGRADE to reader
when the read lands. The spinner becomes an overlay, not a gate.
**Buys:** first paint stops waiting on p90 2880ms / p95 3332ms.
**Risk, and it is the real one:** a page that resolves to `reader` would flash the
frame first. Mitigation — hold the frame's `src` for a short grace window
(~250ms) so a fast read (median 401ms… so most reads do NOT beat it) still wins.
**The measurement changed the item.** Re-run through the shipped fetch, the
median read is 363ms and nothing hits the 6s leash any more (max 8583 -> 4401ms).
So the blocking wait is no longer the cost, and buying a bit of it with a
frame-flash on a library where 77% of pages will not frame is a bad trade.

What IS the cost is the SECOND round trip: 53% of opens then waited serially for
the archive. `page_reader` now answers with the snapshot already found, gated so
a page that will show gets nothing. Shipped as `3e42c564` — one round trip, no
flash, no visual change at all.

### 3. Archive-first for the cases that cannot be framed — **SHIPPED `f40d6090`**
When the fetch says `framable === false` AND the reader is thin — 32% of opens —
go to the snapshot rather than framing a page we know will refuse. Add retry +
backoff to `wayback_lookup`, and treat a non-JSON 200 as a failure with an honest
reason rather than letting `res.json()` throw.
**The client was already right** — `resolveMode` prefers a snapshot the moment a
page refuses framing. The failure was the lookup: no retry against a service that
returned 429 on 4 of 5 serial requests, and `res.json()` on an HTML body reaching
the user as `Unexpected token '<'`. Retry + `Retry-After` + text-then-parse.
Verified against the real service: **4/5 resolved, was 1/5.**
**Control:** a framable page is NOT diverted to the archive.

### 4. ~~One live browser at a time in a spread~~ — **RETIRED BY MEASUREMENT**
The theory was that `ArtifactCard` passing `isActivePage` hardcoded true mounts N
iframes and N server fetches in a spread. **All 1,468 bookmarks have ZERO
children**, so `filesOf` yields exactly one card and a bookmark always opens as
`data-count="1"` — one frame, one fetch. There is no N to collapse.

**Still a latent hazard, reported not fixed:** the hardcoded flag would bite a
spread that genuinely holds several bookmarks (opening a container of them).
`BookmarkView`'s own header says the rule exists to make 1,467 frames "impossible
rather than merely unlikely" — this is the hole in it. Not worth speculative
complexity until a real case produces it.

### 5. Height independent of neighbour count — **SHIPPED `ef821f0c`**
Measure the rendered rects first. Then: an OPEN browser takes the overlay's
height regardless of `data-count`, and the root gets a definite height rather
than an inert `flex: 1`.
**Verification is a rect, not a rule** — measured in a browser against the built
stylesheet, both arms in one document: tile 738 -> 815px at 1600x900 and
1000 -> 1265px at 1600x1400; dead space 122 -> 12px and 360 -> 11px. Control: a
spread with no open bookmark still reads the 738px photo cap.

**The first version shipped INERT** — same (0,4,0) specificity as the cap it had
to beat, both `!important`, cap later in source order. And lifting the cap was
only half: `height: 100%` resolves against an `auto` parent, so the chain above
had to be made definite too. Both caught by measuring, neither by reading.

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
- Item 5 is now measured in a browser. The `flex: 1` suspicion turned out not to
  be the cause — the per-count photo cap was.
- Item 4's premise was wrong and is retired above; measuring the data killed it.


---

## END TO END, the case this started from

Washington Post, through the shipped code, one reply:

```
 1003ms  fetch      ok · 1031KB          (was a 14,792ms tarpit)
 1135ms  reader     91 words → unusable
 1135ms  framing    framable=false — x-frame-options: sameorigin
 4452ms  archive    SNAPSHOT 2023-12-05  → framable, 1,614 reader words
```

Before: a 14.8s hang, no fetch, then a serial lookup that 429'd into a dead end.

**Honest note on that 4452ms:** the archive leg measured 644ms earlier in the
session and 3.3s here, because these probes had been hammering archive.org. The
round-trip count is the durable win; the archive's own latency is theirs.

## What is still open
- **Item 4's latent hazard** — `isActivePage` hardcoded true in `ArtifactCard`
  would mount N frames for a spread that genuinely holds several bookmarks. No
  such case exists in this library (all 1,468 bookmarks carry no children).
- **77% of pages cannot be framed at all.** That is the sites, not us. The
  archive is the answer and it is now reliable; a local snapshot store taken at
  save time (true Raindrop) is the only thing that would close the rest, and it
  is a storage decision rather than a perf one.
