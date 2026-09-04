# Playing your own movies inside Moduli — Jellyfin over Tailscale

_Written 2026-09-04. Decisions in this file are the user's; measurements are from the live grid._

## The finding that reshapes this: the catalogue is already done

Measured on `poms grid` before designing anything:

| | |
|---|---|
| rows carrying a `File Path` | **1,727** — real paths, `D:\Documents\book_files\…` |
| rows carrying a `Drive` name | **1,592** — e.g. `Odin` |
| rows carrying a `Size` | 1,266 — a good many at 33–37 GB |
| rows marked `Owned` | 1,807 |

**Nothing needs importing, scanning or cataloguing.** The whole missing piece is
turning `Drive` + `File Path` into something the browser can play. That is a
handful of config rows, not a migration over 1,592 occurrences.

## Decisions taken

- **Jellyfin at home**, not a plain file server. Files at 33–37 GB are h265/mkv
  in practice, which no browser plays natively. Jellyfin transcodes on demand;
  a static file server would hand the browser bytes it cannot decode. This is
  the deciding constraint, not a preference.
- **Tailscale** for reachability. No port forwarding, nothing on the public
  internet, and the tablet just needs the app once.
- **Plex was considered and set aside** — it also transcodes, but its API is
  less pleasant and remote access is tied to their account and relay.
- **Proton / Google Drive are the wrong tool here.** Proton Drive is end-to-end
  encrypted and exposes no usable public API; Google throttles large-file
  streaming and needs OAuth. Neither is a fit for 37 GB video.

## The blocker to solve FIRST, before any Moduli code

**viafluere.com is served over HTTPS, and an HTTPS page cannot load `http://`
media — browsers block mixed content for video outright, not with a warning.**
So `http://homebox:8096/...` will never play, no matter how well the rest is
wired. Verified against the live site rather than assumed.

**Tailscale Serve** resolves it: it provisions a real Let's Encrypt certificate
for `<machine>.<tailnet>.ts.net`, so Jellyfin is reachable over genuine HTTPS
while still only existing inside the tailnet.

```
tailscale serve --bg 8096          # https://homebox.<tailnet>.ts.net -> Jellyfin
```

Do this and confirm the URL loads in the tablet's browser **before** any of the
build below. If it does not, nothing downstream can work, and every hour spent
on the Moduli side is spent on a foundation that is not there.

## Bytes go device → home, never through the droplet

The stream URL points at the Tailscale host, so video travels directly from your
machine to the device watching it. It must NOT be proxied through the droplet:
that would push every gigabyte through DigitalOcean, add latency, and cost
bandwidth for no benefit. The droplet only ever serves the Moduli app itself.

## Two populations, and only one of them is Jellyfin's job

Measured after the first draft, and it corrects that draft: the 1,727 paths are
**two different libraries in one field**.

| | movies / TV | books |
|---|---|---|
| `File Path` | `movies/Cloud Atlas` — RELATIVE | `D:\Documents\book_files\…` — absolute |
| `Drive` | Odin 400 · Baldr 550 · Loki 123 · Heimdall 61 · Freyja 46 · Thor 4 | none |
| size | 13–37 GB, and they are FOLDERS not files | small |
| formats | (no extension — the folder holds the video) | 259 `.azw` · 150 `.epub` · 97 `.pdf` · 31 `.mobi` |

**Jellyfin does music, and it does NOT usefully do these books.** Music is a
first-class Jellyfin library and the grid has 5,484 songs / 3,027 albums / 1,679
artists — a straight fit, same mechanism as video. But 290 of the 541 book files
are Amazon formats (`.azw`, `.mobi`) that Jellyfin cannot read, and **books need
no transcoding at all** — which is the entire reason Jellyfin was chosen over a
plain file server. That argument simply does not reach them.

So: **Jellyfin for video and music; plain static serving for books.** That is not
a second system — it is the simple option that was already on the table, applied
where it is actually the better one. Moduli already renders PDFs in the artifact
viewer; `.epub` would want a reader, and `.azw`/`.mobi` realistically want
Calibre, not the browser. Worth deciding what "open a book" should even mean
before building anything for it.

## Matching: on the RELATIVE TAIL, never on title or absolute path

The first draft said "match on the absolute file path". That is wrong for the
movies, because they do not store one — they store `Drive: Odin` plus
`movies/Cloud Atlas`. Which is better: the pair composes to a full path under
whatever root the drive is mounted at, and the RELATIVE part is stable across
every possible mount.

So match on the tail. Jellyfin will report something like
`O:\movies\Cloud Atlas\…` on Windows or `/media/odin/movies/Cloud Atlas/…` in
a container; both end with `movies/Cloud Atlas`. **Matching the tail means the
choice of where Jellyfin runs stops mattering** — no prefix table to maintain,
nothing to redo if the drives are remounted or the server moves.

Titles are still not used. `0201` and the artwork migrations record what title
matching costs (a bogus ISBN returns a real book; two films called "The Ring"
collapse together), and here there is an exact key available instead.

## Where Jellyfin should run: Windows, not WSL

This machine is **WSL2** (`Ubuntu-24.04` on a `microsoft-standard-WSL2` kernel),
and the drives are already mounted with the right names — `/mnt/odin`,
`/mnt/thor`, `/mnt/baldr`, `/mnt/freyja`, `/mnt/heimdall`, `/mnt/loki` — all
currently EMPTY, which is the hardware still being on order rather than anything
misconfigured.

Run Jellyfin on **Windows**, not inside WSL:

- WSL2 sits behind a NAT with an IP that changes on reboot, so reaching it from
  the tablet needs a `netsh interface portproxy` rule re-established each time.
  That is a moving part that will break silently on a Tuesday.
- Windows Jellyfin sees the drives directly, with no `/mnt` translation.
- Tailscale should run on Windows for the same reason — it advertises the host
  the media actually lives on.

Because matching is on the relative tail, this choice costs nothing in the
matching design if it is ever revisited.

## Store the ID, DERIVE the URL

- **Store** the Jellyfin `ItemId` on the occurrence. That is IDENTITY — stable
  across re-scans and re-encodes, and worth persisting.
- **Derive** the stream URL from the connection's base URL at render time. That
  is LOCATION. Stamping URLs onto 1,592 rows means re-migrating all of them the
  first time the machine's name, port or tailnet changes.

This is the same split the repo already makes elsewhere (a module's `fileRef` is
identity; `resolveFileRef` derives the servable URL).

## It plugs into surfaces that already exist

Nothing new is needed for playback or for the viewer:

1. A movie row gets an **artifact child** of `kind: "video"` whose `fileRef` is
   the derived stream URL — exactly the pattern `0246` already uses to hang
   posters off a row (parented to the row AND listed in its `occurrences[]`, so
   it renders in the file spread but never as an inline row).
2. `ArtifactCard` already renders `<video controls playsInline>` for that kind.
3. Clicking the cover already opens the artifact viewer, which already lists a
   row's files.
4. The **dock switch** (shipped 2026-09-04) already puts that viewer inside a
   panel, and a file opened from it full-screen inside the same panel.

So "click a movie → see its files → watch it beside your work" is already built.
The only missing link is a video child with a playable URL.

## Build order

**0. Prove the foundation** (you, not code): Jellyfin installed, libraries
pointed at the drives, `tailscale serve` up, the `https://…ts.net` URL playing a
movie in the tablet's own browser. Stop here until that works.

**1. Connections become real records.** Today `CONNECTIONS` in `server/server.js`
is a hardcoded two-entry array pointing at `/home/joshpoms/files` — paths on the
DROPLET, which do not exist there. It needs to be a per-user collection:
`{ id, kind: "jellyfin", name, baseUrl, apiKey, drivePrefixes }`.

**2. A browse endpoint** that lists a Jellyfin library through its API, so the
Connections tab can show what is there and confirm the key works. Read-only —
worth having before anything writes.

**3. The match pass**, dry-run first, reporting per drive: matched / unmatched /
ambiguous. Matching is `endsWith(\`movies/${title}\`)` against Jellyfin's reported
path, so the failures should be about naming drift between the catalogue and the
folder on disk — not about mounts. Iterate on the dry run; apply once it is boring.

**4. Mint the video children** for matched rows — `0246`'s shape, so it is one
reviewed pattern rather than a second one.

**5. Re-runnable.** A row that already has its video child is skipped, so adding
a drive later fills only the gaps.

## Risks, stated up front

- **The API key would live in the client** if the browser talks to Jellyfin
  directly — which it must, to keep bytes off the droplet. Mitigate with a
  Jellyfin user that has read-only access to those libraries, not an admin key.
  Worth deciding deliberately rather than discovering.
- **Transcoding is CPU work.** A machine serving five drives over USB may or may
  not keep up with 4K h265. Direct-play works when the codec already suits the
  device; transcoding is the fallback. Measure on one real file early.
- **The machine has to be awake.** Nothing here works when it is asleep, and
  that is a property of the choice, not a bug to fix later.
- **Unmatched rows are the normal case at first.** 1,727 paths written by hand
  and by import over months will not all resolve. The dry run exists to make
  that visible and cheap to iterate on.

## Explicitly not doing

- Copying movies onto the droplet. `/api/connections/:id/import` does exactly
  this and is right for documents; for a multi-terabyte library it is not.
- Books through Jellyfin. Two thirds of them are formats it cannot read, and the
  one advantage it has — transcoding — is irrelevant to a 2 MB epub.
- Fuzzy title matching. The paths are exact; using titles would import the wrong
  film with full confidence.
