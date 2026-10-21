# Moduli Office (VR) — plan

User direction, 2026-10-21 (CLAUDE_CHAT.md 11:33–11:52): a Quest 3 app that turns
a hotel room into a cozy fireplace office, maps the real room, puts VR furniture
where the real furniture is, and shelves Moduli content you can pick up and use.

## Shipped (prototype, `/vr/`)

- WebXR page at `client/public/vr/` (Three.js from a CDN, no build step).
  Mixed reality (passthrough) or full VR; the desktop shows the same scene.
- Room fitting from Space Setup: fireplace on the biggest wall, shelves on the
  other walls, a desk lamp on any table the headset found.
- Shelves are queries. Each one names a board or folder (or a container id) and
  shows its rows; ◀ ▶ on top flips through shelf-fulls. Defaults: Notes, Books,
  Albums, Movies. A feed board's rows are its feed, so a shelf pointed at a feed
  board shows exactly what the feed collects; a feed copy opens its source.
- Pointing at a book opens it in Moduli itself: `/?open=<id>` (App.jsx +
  `helpers/deepLinkOpen.js`). A file opens as its own page (file viewer / book
  reader), anything else opens the page it lives on. The VR session ends and
  Moduli opens in a browser window.
- Object palette (armchair, lamps, plant, rug, candle); place on the floor or a
  table, pick anything up to move it. Layout kept in the browser.
- Server: `GET /api/v1/vr/shelf?gridId=[&board=]` (`services/vrShelf.js`).

## Next

### 1. A VR Type field decides the shelf and the object (fully custom queries)
Today a shelf query is a board/folder NAME and the library list lives in the
browser. User (2026-10-21 11:53): *"i would have a field called like vr_type and
then query off that"*.

- A **VR Type** select field — Book, Note, Record, VHS (more later). Tag any
  occurrence with it: a book row, a doc page, an album, a movie. One field does
  both jobs: which library the item belongs to AND which physical object it is.
- Each library = a VR Type value, optionally narrowed with Moduli's own feed
  conditions (scope, roles, other fields, sort, limit) — so "a lot more notes"
  is just every page tagged Note, wherever it lives.
- Tagging in bulk: bind VR Type on a shared module (all 474 book rows use one
  Book module) or stamp it with an operation / feed rule, rather than by hand.
- Where libraries are listed: a **VR Libraries** folder in Moduli, one board per
  library, each board's feed = `VR Type IS <kind>` plus any extra conditions,
  built in the existing feed editor. `/vr/libraries` returns them; each shelf
  reads `/vr/shelf?board=<id>`. (Or, without boards: `/vr/shelf?vrType=Note`.)
- Caveat: a feed fills its board while a Moduli tab is open (the feed leader).
  For shelves that are fresh without the app open, the server needs its own
  query evaluator — a port of `state/selectors.resolveFeedItems` +
  `helpers/feedPredicate` — which the `?vrType=` form would need anyway.

### 1b. Shelves are created and edited in VR
User (11:54): *"this all should be editable in vr. so i would go to a new custom
shelf and type in the query in its settings and it fills the assets with those
things"*.

- Place a new shelf from the palette (Bookshelf, Record crate, VHS shelf…).
- Point at it and open its **Settings** panel in VR: name, kind (the asset),
  and the QUERY — VR Type value, plus optional conditions (field, comparator,
  value — the same rule shape feeds use), scope (under which page/folder),
  sort, limit. A live count shows what matches; Apply fills the shelf.
- Typing: the real keyboard (key events reach the page during a session), with
  a pointer-driven VR keyboard as the fallback; voice later.
- Saved in Moduli, not the browser: each shelf's definition (query + asset +
  where it stands in the room) is stored with the grid, so it follows you to
  any headset and survives a reload.
- This needs the server-side query evaluator from §1 — a shelf typed in VR has
  no feed board behind it, so `/vr/shelf` evaluates the query itself, with the
  same predicate semantics as `helpers/feedPredicate` (shared code, not a copy).

### 2. Different libraries, different physical assets
Picked by VR Type; every library is custom-queried (§1).

| VR Type | Furniture | One item looks like |
|---|---|---|
| Book | bookshelf | a book; spine = title, cover from the row's picture |
| Note | bookshelf / binder rack | a notebook or binder |
| Record | record crate or shelf | an LP sleeve with the album cover |
| VHS | tape shelf beside the TV | a VHS case with the movie poster on the spine |

### 3. Carry a book or note to your chair and read it
Grab an item (hand or controller) and it stays in your hand; walk to the chair;
sit (or drop it on the chair's reading spot) and it opens to read.
**Open question:** reading inside VR means an in-VR reader — PDF pages (pdf.js
to a texture), epub/notes as laid-out text. That contradicts "use Moduli's own
viewers", which cannot be drawn inside the 3D scene. Options: (a) an in-VR
reader for reading at the chair, Moduli's viewer for everything else; (b) always
leave VR for Moduli's viewer.

### 4. Record player
A turntable; put an album's LP on it and the album plays.
**Open question:** where the audio comes from — the album's own audio files in
Drive (playable in the page), or Spotify (Web Playback SDK, Premium, needs the
Spotify connection from the Connections plan).

### 5. VHS player and a TV where your TV is
Space Setup can label a TV/screen; the VR TV goes in that exact spot. Put a tape
in the VHS player and the movie plays on the TV (a video texture).
**Open question:** the video source. A video file Moduli serves (Drive mp4)
plays on a texture. YouTube or streaming services cannot be drawn as a texture
(their players are cross-origin), so a movie row needs a playable file.

### 6. A typewriter on your desk, lined up with your keyboard
A typewriter model sits where the real desk is, positioned over the real
keyboard, so typing on the keyboard reads as typing on the typewriter. Typed
text appears on the paper and saves into a Moduli note.
**Limits:** WebXR does not track physical keyboards (Meta's tracked-keyboard
support is native-only), so the typewriter is placed on the desk the headset
found and nudged into line by hand once per room. Passthrough around the
keyboard (seeing your hands on the keys) also needs the native SDK.

### 7. Layout kept in Moduli, per room
Today the layout is in the browser and resets if the room origin moves. Save it
in Moduli, keyed to the room, using spatial anchors so a room you return to
comes back exactly as you left it, and a new hotel room is fitted afresh.

## Native app later
The WebXR prototype covers §1–§5. A Unity + Meta XR SDK build (Mixed Reality
Utility Kit) would add: tracked keyboard and keyboard passthrough (§6), richer
scene understanding, hand physics, better lighting. It would use the same Moduli
API.
