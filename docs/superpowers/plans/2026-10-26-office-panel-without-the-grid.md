# The headset's control panel without the whole grid

User, 2026-10-26: "the control panel shouldnt load the entire grid" → chose **"Server answers it"**.

## Why
Measured on the Quest 3S (2026-10-26): the app was killed by the low-memory killer at ~1.9 GB main + 0.7 GB
browser engine. Every web page in the app shares one process. The control panel (`/?office`) was a whole Moduli
tab: full grid data (~35k occurrences), the grid drawn under its menu (22,885 elements), every operation re-run.
Step 0 (shipped `passiveWindow`): no grid drawn, no ops/feeds/schedules/reminders there. The data is still loaded.

## Shape
- **One source for the office logic.** `client/src/vr/officeCore.js` re-exports the pure shelf/office functions;
  `npm run build:office-core` bundles it with esbuild for Node into `server/generated/officeCore.mjs` (committed,
  so a server deploy needs no client build). The server and the app run the same code.
- **Server reads from the warm cache** (`getUserCache`), with SHALLOW COPIES of the maps per request: the client
  helpers memoise on object identity (`cachedParentMap`, music shelf cache) and the server mutates its maps in place.

## Tasks
1. ☑ `vr/officeState.js`: move `nativeOfficeState`, `bookmarkBar`, `findBookmarksBoard`, `findDayPage`,
   `findNotesFolder` out of NativeOffice (pure; `origin` passed in). NativeOffice imports them. officeCore exports.
2. ☑ Server `POST /api/v1/vr/office/state` `{ gridId, shelfAt, origin }` → the state message (session JWT).
   Test with a small fixture against the generated bundle; a test that the bundle is current (rebuild + compare).
3. ☑ (as `/vr/office/plan`: albumQueue, shelfReorder, folderDelete planned on the server; the writes stay the app's own events from the panel — undo/transactions unchanged. newNote/saveBookmark/placeInto run in the panel with what it has or fetches) Server `POST /api/v1/vr/office/action`: `albumQueue` (read), `deleteItems`, `shelfReorder`, `newNote`,
   `saveBookmark`, `placeInto` — each the same write the client helper makes, done on the server through the
   existing handlers' code paths (cache + Mongo + broadcast + transactions).
4. ☑ `OfficePanelApp` (like ReaderApp): `/?office` inside `window.ModuliNative` boots it instead of App. No
   full_state. Socket joined quietly (`join_grid_quiet`); any occurrence/folder/grid event → refetch state
   (debounced; removals at once, as now). Menu UI = NativeOffice's, fed by the server state. Piece windows
   (`&piece=`) need shelf/screen settings — ShelfSettings uses FeedSection (needs field/occurrence lists): fetch
   `GET /fields` and the occurrence options it needs, or keep piece windows on the full app for now (rarely open).
5. ☐ (remote panel skips them; poms has 0 office screens) Screen pictures (`screenPicture`) render pages off screen — needs page rows: move to the grid screen or fetch
   the page subtree (`/occurrences/:id/subtree`, ReaderApp's).
6. ☐ Measure on the headset: app memory with the room loaded, before/after.

## Status 2026-10-26
Shipped: state (byte-identical to the app's answer on poms; ~0.35-0.5s server compute; a fingerprint makes an
unchanged answer a few bytes — the full one is 1.5 MB), plans, OfficePanelApp booted from main.jsx when
`window.ModuliNative && ?office && !piece`. The grid record must go through JSON before the shared code reads it
(its Date/ObjectId values made every feed empty). **Not yet watched on the headset** (task 6).
