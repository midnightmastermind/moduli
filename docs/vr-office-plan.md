# Moduli Office (VR) — plan

User direction, 2026-10-21 (CLAUDE_CHAT.md 11:33–11:52): a Quest 3 app that turns
a hotel room into a cozy fireplace office, maps the real room, puts VR furniture
where the real furniture is, and shelves Moduli content you can pick up and use.

## Shipped

### 2026-10-21 (2) — the office runs INSIDE Moduli (`/?office`)
User (12:03–12:04): *"it wouldnt be a board page, it would just be a query"* → run it inside the
app. The standalone `/vr/` page and the server's `/vr/shelf` route are gone; `/vr/` redirects.
- `client/src/vr/VrOffice.jsx` (lazy; three.js lives only in its chunk) over the grid, which stays
  rendered underneath. `vr/officeScene.js` is the Three.js/WebXR scene (fireplace, room fitting in
  mixed reality, pointing, placing, the palette).
- **Shelves are saved queries** on the grid: `grid.meta.vrOffice.shelves[] = { id, title, asset:
  book|record|vhs, feed }` (`vr/officeConfig.js`). The query is a feed, answered by
  `resolveFeedItems` (`vr/shelfItems.js`) — no copies, no board pages. A shelf with no query yet
  holds nothing. Place one from the palette; its ⚙ opens settings with the app's own feed editor
  (`ui/FeedSection` in a mode that edits a feed not stored on an occurrence). The PLACED shelf picks
  the asset: bookshelf = spines, record crate = face-out sleeves (covers when the picture allows
  CORS), VHS shelf = black tapes. Pointing at an item opens it in Moduli (its pdf/epub, audio or
  video file when it has one).
- **Screens** (12:07–12:08): `grid.meta.vrOffice.screens[] = { id, title, source: page|grid,
  pageOccId }`. A screen shows a picture of one page (rendered off screen through
  `PagePreviewBody`) or of the whole grid as it looks in the app (`html-to-image`). ⟳ redraws;
  pointing opens the page. Pictures, not live pages: WebXR cannot draw a web page in the scene.
- **This device only** (12:10): while the office is open the tab keeps panel pages, the split
  layout and the date filter to itself (`helpers/localLayout.js`, checked in `safeEmit`; incoming
  layout from other devices is ignored too). The office's settings save through
  `PUT /api/v1/vr/office`, which writes `meta.vrOffice` ALONE. A pill offers "Sync with my other
  devices" (reloads the shared layout).
- **Decor library** (12:14): the palette's "Decor ▸" page lists the built-in pieces plus every 3D
  model file (`.glb` / `.gltf`, new file kind `model`) on the grid (`vr/decorLibrary.js`). Upload a
  model to Moduli and it is on the palette; it is scaled to a room-sized piece and stood on its base.
- Where things stand in the room is still kept per device (localStorage, per grid) — §7.

### 2026-10-21 — first prototype (standalone `/vr/`, replaced the same day)

## Decisions (user, 2026-10-21 ~12:00)

- Shelf query: open **Moduli's real feed editor in a window** beside you; the
  shelf refills when you come back (§1a option b).
- Reading at the chair: a **VR reader** at the chair; everything else opens in
  Moduli's own viewers (§3 option a).
- Record player: **both** — a Drive audio file when the album has one, else Spotify.
- VHS: **video files in Drive**; a tape without one shows its poster and says so.
- Typewriter: line it up **by hand** now; a **native Quest app** later.
- Build order: **placeable shelves + feed queries first**.

## Next

### 1. A VR Type field (optional now — a shelf's query is any feed)
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

### 1a. The shelf you place decides the asset (11:59)
User: *"it should make a custom query feed using the same ui as our system,
that pulls occurances and each one should become a book asset, record asset, or
movie asset, based on the shelf i choose to place"*.

- The SHELF TYPE you place (bookshelf / record crate / VHS shelf) decides what
  every result looks like; the QUERY decides what is on it. VR Type (§1) becomes
  one optional condition in the query, not the thing that picks the asset.
- The query is a Moduli FEED — the same conditions / scope / roles / sort /
  limit, edited with the same feed editor UI (`ui/FeedSection`), not a VR-only
  query language.
- Open question — how "the same UI" appears in VR: the WebXR scene cannot show
  the app's own React panels, so either (a) the shelf's Settings rebuilds the
  feed editor's controls in 3D (same fields, same options, same live count), or
  (b) Settings opens Moduli's real feed editor for that shelf in a browser
  window beside you and the shelf refills when you come back. (b) is exactly
  the same UI and far less work; (a) keeps you inside VR.

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

### 3. Carry a book or note anywhere and read it
Grab an item (hand or controller) and it stays in your hand; it opens to read
**wherever you sit or stand** (user 12:13: *"open the book anywhere i sit in the
office btw, not just the chair"*) — the reader floats in front of you, not a
chair-only spot.
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
