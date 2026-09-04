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

## Matching: on FILE PATH, never on title

Jellyfin reports a `Path` for every item it has. Your rows already carry the same
paths. **So the match is exact string comparison, and no fuzzy title matching is
needed** — which matters, because `0201` and the artwork migrations record how
badly title matching goes (a bogus ISBN returns a real book; "The Ring (2002)"
and "The Ring (1927)" collapse together).

Normalisation needed, and only this: Windows `D:\Movies\x.mkv` vs Jellyfin's
`/mnt/odin/Movies/x.mkv`. The `Drive` field is exactly the hint that closes it —
one prefix rule per drive, configured once.

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
ambiguous. Expect the unmatched list to be long on the first run and to be about
prefix rules, not about Jellyfin. Iterate on the dry run; apply once it is boring.

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
- Fuzzy title matching. The paths are exact; using titles would import the wrong
  film with full confidence.
