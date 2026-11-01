# Media Streaming in Moduli — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play the user's Jellyfin movies, TV and Danny documentaries inside Moduli from anywhere, with watch state kept in step both ways.

**Architecture:** The PC holds a reverse SSH tunnel to the droplet, exposing Jellyfin on droplet `127.0.0.1:8097`. nginx serves `media.viafluere.com` (Jellyfin's own UI, for the friend and the fallback link). Moduli's Node server talks to Jellyfin over that port with a server-side API key; the browser streams through a session-authorized Moduli proxy, so no key reaches the client. A server sync links/creates rows and mirrors watch state; an operation logs Watch entries into the Schedule.

**Tech Stack:** OpenSSH (Windows) + Task Scheduler, nginx + certbot, Node/Express (`server/routes/apiV1.js`), Mongo/Mongoose, React, `hls.js@1.5.20`, Jellyfin 10.x REST API, vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-media-streaming-design.md`

## Global Constraints

- No Cloudflare in the media path; no inbound port at the hotel.
- Jellyfin API key stored encrypted server-side (`models/Secret.js` `encryptValue`), never sent to the client.
- poms grid changes only through migrations: dry run, apply, read back, `pm2 restart` as `deploy`.
- "Finished" = position ≥ 90% of runtime (`FINISHED_FRACTION = 0.9`).
- Only the user's own Jellyfin user's history counts (store its `userId`; never read others).
- Matching order: file path → TMDB/IMDb provider id → title + year. Never create a row a match exists for.
- New board for Jellyfin's Documentaries library: **"Danny Documentaries"** (Board Category `documentary`).
- No git push. Deploy with `./deploy.sh`.
- Copy: unreachable media reads exactly "Media server is offline — the PC may be asleep."

## Review Focus

1. PC asleep / tunnel down mid-film → proxy answers 503 `media_offline` within 5s, player shows the offline copy, position already saved stays saved (Task 4, Task 8 tests).
2. Seeking → `Range` headers pass through the proxy and a 206 comes back (Task 4 test).
3. Session expiring during a 2-hour film → segment requests 401; player shows "Sign in again" instead of freezing (Task 8 test).
4. Two Moduli rows with the same title + year, or one Jellyfin item that matches two rows → no link, item reported as ambiguous, no row created (Task 5 test).
5. Re-running sync / reloading the page → no second Watch entry for the same finish (Task 9 test: idempotent on `meta.watchFor`).

---

### Task 1: Tunnel, address and Jellyfin users (infrastructure)

**Files:**
- Create: `infra/media-tunnel/media-tunnel.ps1` (loop: `ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 127.0.0.1:8097:127.0.0.1:8096 tunnel@viafluere.com`, 10s back-off on exit, log to `%TEMP%\media-tunnel.log`)
- Create: `infra/media-tunnel/install-task.ps1` (Task Scheduler "Moduli media tunnel", at logon, user jtpom, restart on failure)
- Create: `infra/nginx/media.viafluere.com` (proxy to `127.0.0.1:8097`, websocket upgrade, `proxy_buffering off`, `client_max_body_size 0`, `proxy_read_timeout 3600s`)
- Create: `infra/media-tunnel/README.md` (the steps below, for re-running)

- [ ] **Step 1:** On the droplet create user `tunnel` with no shell (`/usr/sbin/nologin`), `authorized_keys` entry restricted with `restrict,port-forwarding,permitlisten="127.0.0.1:8097"`. Generate an ed25519 key on the PC (`C:\Users\jtpom\.ssh\moduli_tunnel`).
- [ ] **Step 2:** Run `media-tunnel.ps1` once. Verify on droplet: `curl -s 127.0.0.1:8097/System/Info/Public` returns JSON with `ServerName`.
- [ ] **Step 3:** Install the scheduled task; log off/on (or run the task); re-verify Step 2.
- [ ] **Step 4:** DNS: A record `media` → `142.93.5.142` (if the registrar is not reachable from here, stop and ask the user to add it). Install the nginx site, `certbot --nginx -d media.viafluere.com`. Verify `curl -sI https://media.viafluere.com/web/` → `200`.
- [ ] **Step 5:** In Jellyfin (Dashboard): Networking › Known proxies `127.0.0.1`; create user for the friend (no admin, library access Movies/Shows/Documentaries); create API key "Moduli". Record the user's own Jellyfin user id.
- [ ] **Step 6:** Commit `infra/`.

### Task 2: GPU transcoding

- [ ] **Step 1:** Jellyfin Dashboard › Playback › Transcoding: Hardware acceleration **AMD AMF**, enable hardware decoding for H264/HEVC, enable hardware encoding. Remote client bitrate limit: 4 Mbps (Dashboard › Networking).
- [ ] **Step 2:** Verify: start a 1080p film at 2 Mbps in the Jellyfin web UI over `media.viafluere.com`; Dashboard › Activity shows a transcode with `(HW)`; Task Manager GPU "Video Encode" > 0.
- [ ] **Step 3:** Record measured upload throughput from the hotel (`speedtest` or Jellyfin's bitrate test) in `infra/media-tunnel/README.md`.

### Task 3: Jellyfin connection settings

**Files:**
- Create: `server/services/jellyfinConfig.js`
- Modify: `server/routes/apiV1.js` (routes)
- Create: `client/src/ui/commandCenter/JellyfinSection.jsx` (mount in the Connections tab beside TokensSection)
- Test: `server/__tests__/jellyfinConfig.test.js`

**Interfaces:**
- Produces: `getJellyfinConfig(userId) -> Promise<{ baseUrl, apiKey, userId: jfUserId, publicUrl } | null>`; `setJellyfinConfig(userId, { baseUrl, apiKey, jfUserId, publicUrl })`; `jellyfinFetch(cfg, path, init?) -> Promise<Response>` (adds `X-Emby-Token`, 5000ms timeout, throws `{ code: "media_offline" }` on connect/timeout).
- Routes (session JWT only, like `/search/keys`): `GET /api/v1/jellyfin/config` → `{ configured, baseUrl, publicUrl, jfUserId }` (never the key); `PUT` same body + `apiKey`; `DELETE`.

- [ ] **Step 1:** Tests: `GET` after `PUT` returns no `apiKey` field; stored doc holds `{iv,ciphertext,authTag}` not the plain key; an API token (non-session) gets 403; `jellyfinFetch` against a closed port rejects with `code === "media_offline"` in < 6000ms.
- [ ] **Step 2:** Run, see them fail.
- [ ] **Step 3:** Implement (store at `user.meta.jellyfin`, key via `encryptValue`; defaults `baseUrl "http://127.0.0.1:8097"`, `publicUrl "https://media.viafluere.com"`).
- [ ] **Step 4:** Tests pass; UI section saves and shows "Connected — <ServerName>" from `/System/Info/Public`.
- [ ] **Step 5:** Commit.

### Task 4: Streaming proxy

**Files:**
- Modify: `server/routes/apiV1.js` — `ALL /api/v1/jellyfin/media/*`
- Create: `server/services/jellyfinProxy.js`
- Modify: `/etc/nginx/sites-enabled/moduli` via `infra/nginx/moduli-media.conf` snippet: `location /api/v1/jellyfin/media/ { proxy_buffering off; proxy_read_timeout 3600s; … }`
- Test: `server/__tests__/jellyfinProxy.test.js`

**Interfaces:**
- Consumes: `getJellyfinConfig`, `jellyfinFetch`.
- Produces: `proxyJellyfin(req, res, cfg)`; browser URLs are `/api/v1/jellyfin/media/<jellyfin path>`; auth by session cookie/JWT (`allowSessionJwt`), also accepting `?t=<session jwt>` for `<video>`/hls.js segment requests.

- [ ] **Step 1:** Tests against a local fake upstream: `Range: bytes=0-99` → 206 with `Content-Range` passed through; client-sent `api_key`/`X-Emby-Token` are stripped and the server's key added; only paths under `/Videos/`, `/Items/`, `/Audio/` allowed (others 404); upstream down → 503 `{ code: "media_offline" }`; no session → 401.
- [ ] **Step 2:** Run, fail.
- [ ] **Step 3:** Implement as a streaming pipe (no buffering), copying status and `Content-Type`/`Content-Length`/`Content-Range`/`Accept-Ranges`.
- [ ] **Step 4:** Pass; commit.

### Task 5: Matching planner (pure)

**Files:**
- Create: `server/services/jellyfinMatch.js`
- Test: `server/__tests__/jellyfinMatch.test.js`

**Interfaces:**
- Produces: `planJellyfinLinks({ items, rows }) -> { link: [{ occId, jfId }], create: [{ item, board }], ambiguous: [{ jfId, reason }], unchanged: n }` where `item = { Id, Type: "Movie"|"Series"|"Season"|"Episode", Name, ProductionYear, Path, ProviderIds: { Tmdb, Imdb }, SeriesId, ParentIndexNumber, IndexNumber, library: "movies"|"shows"|"documentaries" }` and `row = { id, label, year, filePath, tmdbId, imdbId, jellyfinId, board: "movies"|"tv"|"seasons"|"episodes"|"documentaries"|"danny", showRowId, season, number }`. `board` for creates: Movie→`movies`, Series→`tv`, Season→`seasons`, Episode→`episodes`, documentaries library→`danny`.
- Episodes match by (show's linked row, season, number); seasons by (show row, season).

- [ ] **Step 1:** Tests: path match wins over a conflicting title match; TMDB id match; title+year with ±1 year; a row already carrying `jellyfinId` is `unchanged`; two rows same title+year → `ambiguous`, not created; Jellyfin-only movie → `create` on `movies`; documentaries-library item matching a row on the existing `documentaries` board links in place, unmatched goes to `danny`; Episode S01E05 links to the episode row of the linked show; a special S00E01 with no row → `create` on `episodes`.
- [ ] **Step 2:** Run, fail. **Step 3:** Implement. **Step 4:** Pass; commit.

### Task 6: Sync + Danny Documentaries board (migration 0479)

**Files:**
- Create: `server/services/jellyfinSync.js` (shape after `services/tvEpisodes.js`: `loadContext`, `syncJellyfin({ gridId, userId, models, jf, write, dryRun })`)
- Modify: `server/routes/apiV1.js` — `POST /api/v1/jellyfin/sync` (202 + background, warm cache + broadcast exactly like `/tv/episodes/sync`)
- Create: `server/migrations/0479-jellyfin-media.mjs`
- Test: `server/__tests__/jellyfinSync.test.js`, `server/__tests__/0479.test.js`

**Interfaces:**
- Consumes: `planJellyfinLinks`, `jellyfinFetch`.
- Writes per row: `meta.jellyfinId`, `meta.jellyfinPlayable: true`; created rows use the board's shared module and the sibling field shape (as `tvEpisodes.planEpisodeRows` does), cover from `/Items/<id>/Images/Primary` copied via the proxy URL, TMDB id into `meta.tmdbId`; watch state: when Jellyfin `UserData.Played` and `LastPlayedDate` is newer than the row's **Last Watched**, set Last Watched to that date-time.
- 0479: creates Boards/Media › **Danny Documentaries** board page + container (copy the Movies pair's shape at run time, Board Category `documentary`); binds **Last Watched** (date, existing field) visibly on Movie, Episode and documentary modules; adds op **"Jellyfin: Sync"** (onLoad + daily at 05:00, CALL_API POST `/api/v1/jellyfin/sync` with `$grid.id`), category Library Ops. Exports `planJellyfinMigration(state)` (pure, idempotent).

- [ ] **Step 1:** Tests: dry-run report counts link/create/ambiguous; a second run writes nothing; Played in Jellyfin moves Last Watched forward but never backward; a row with a newer Last Watched is untouched; 0479 run twice adds one board and one op.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; commit.
- [ ] **Step 5:** Deploy; `0479` dry run on poms, apply, read back (board exists, op exists); `pm2 restart`. Run the sync with `dryRun` via a scratch script on prod; report counts to the user before the real run.

### Task 7: Play, progress and played endpoints

**Files:**
- Modify: `server/routes/apiV1.js`
- Create: `server/services/jellyfinPlayback.js`
- Test: `server/__tests__/jellyfinPlayback.test.js`

**Interfaces:**
- `GET /api/v1/jellyfin/play/:occId` → `{ playable, offline?, hlsUrl, directUrl, resumeSeconds, runtimeSeconds, openUrl }`. `hlsUrl = /api/v1/jellyfin/media/Videos/<id>/master.m3u8?MediaSourceId=<id>&VideoCodec=h264&AudioCodec=aac&MaxStreamingBitrate=4000000`; `resumeSeconds` = Jellyfin `UserData.PlaybackPositionTicks / 1e7`; `openUrl = <publicUrl>/web/#/details?id=<id>`.
- `POST /api/v1/jellyfin/progress { occId, seconds, paused }` → Jellyfin `/Sessions/Playing/Progress` (and `/Sessions/Playing` on first call per play session).
- `POST /api/v1/jellyfin/played { occId }` → Jellyfin `POST /Users/<jfUserId>/PlayedItems/<id>`.

- [ ] **Step 1:** Tests: unlinked row → `{ playable: false }`; upstream down → `{ offline: true }` (200, not 500); resumeSeconds converts ticks; played posts to the stored user id only.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; commit.

### Task 8: Player in Moduli

**Files:**
- Create: `client/src/ui/JellyfinPlayer.jsx` (lazy; `hls.js@1.5.20`, native HLS on Safari)
- Create: `client/src/helpers/jellyfinPlay.js` (`isPlayableRow(occ) -> boolean` = `!!occ.meta?.jellyfinId`; `FINISHED_FRACTION = 0.9`; `shouldMarkFinished(seconds, runtime) -> boolean`)
- Modify: `client/src/modules/ArtifactCard.jsx` (Play button on movie/episode/documentary cards when playable; opens the viewer with the player tile), `client/src/modules/ModuleInstance.jsx` (radial "Play" + "Open in Jellyfin")
- Modify: `client/package.json` (add `hls.js`)
- Test: `client/src/__tests__/jellyfinPlayer.test.jsx`, `client/src/__tests__/jellyfinPlay.test.js`

**Interfaces:**
- Consumes: Task 7 routes.
- On play: seek to `resumeSeconds`; every 10s and on pause/end POST progress; first time `shouldMarkFinished` is true: write the row's **Last Watched** = now (ISO date-time) through `CommitHelpers.updateOccurrence` inside one `withAction("Watched")`, and POST played. Offline → the exact offline copy plus the Open in Jellyfin link. 401 on a segment → "Sign in again".

- [ ] **Step 1:** Tests: `shouldMarkFinished(5400, 6000)` true, `(5399, 6000)` false; offline response renders "Media server is offline — the PC may be asleep."; the finish writes Last Watched once even if timeupdate fires repeatedly past 90%; no Play button on a row without `jellyfinId`.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; commit.

### Task 9: Watch entries in the Schedule (migration 0480) and "Play next unwatched"

**Files:**
- Create: `server/migrations/0480-media-log-watch.mjs`
- Create: `client/src/helpers/nextUnwatched.js`
- Modify: `client/src/modules/ArtifactCard.jsx` (TV Series + Season rows: "Play next unwatched")
- Test: `client/src/__tests__/mediaLogWatch.test.js` (real executor over the poms fixture), `client/src/__tests__/nextUnwatched.test.js`

**Interfaces:**
- 0480 op **"Media: Log Watch"** (onChange Last Watched; onLoad + onFilterChange grid, p3, category Library Ops): for each Movie/Episode/documentary row whose Last Watched falls on a shown day, find that day's Schedule column and the slot containing the time (`SLOTS_COVERED` / the slot whose Time Slot ≤ time, as `Schedule: Place Scheduled Items` does via `WHEN_SLOTS`), and `COPY_LINK linked:false` the Routines **Watch** item there with Date, Time Slot, Completed true, and Media (movie/documentary) or TV Show + TV Season + Episode (episode); stamp `meta.watchFor = "<rowId>@<Last Watched>"`; skip when a copy with that `watchFor` exists. Day not on screen → placed when the day is shown.
- `nextUnwatched({ showOrSeasonRow, episodes }) -> { episode, skipped: [labels] } | null` — first episode by (season, number) with `jellyfinId` and no Last Watched; records gaps it skipped.

- [ ] **Step 1:** Tests: a movie finished 20:10 lands in that day's 8:00pm slot with Media = the movie; running the sweep twice leaves one entry; watching again (new Last Watched) adds a second; an episode entry carries show/season/episode; `nextUnwatched` skips an episode without a file and reports it; returns null when all watched.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; commit.
- [ ] **Step 5:** Deploy; 0480 dry run, apply, read back, `pm2 restart`.

### Task 10: End-to-end on prod

- [ ] **Step 1:** Run the real sync (Command Center or the op); read back counts (linked, created per board, ambiguous list) and show the user.
- [ ] **Step 2:** In a browser on prod: open a linked movie row → Play → video plays via `/api/v1/jellyfin/media/…`; seek; stop at 50%; reload → resumes; Jellyfin web shows the same position.
- [ ] **Step 3:** Play past 90% → Last Watched set, Jellyfin shows Played, a Watch entry appears in that day's slot; reload → still one entry.
- [ ] **Step 4:** Stop the tunnel task → Play shows the offline copy; restart it → plays.
- [ ] **Step 5:** Update `CLAUDE.md` (dated entry), `server/CLAUDE.md`, `client/src/ui/CLAUDE.md`; commit; deploy.
