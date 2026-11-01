# Media streaming in Moduli — design

2026-11-01. Phase 1: movies and TV. Music and books come later on the same plumbing.

## Intent

The user's films and shows live on six drives attached to their PC (POMS-PC), served by
Jellyfin. Their Moduli grid (poms grid, on viafluere.com) already has a Movies board, a TV
Series board, a Seasons board and an Episodes board. They want to press Play on a row in Moduli
and watch it right there, from anywhere, and have Moduli and Jellyfin agree on what has been
watched. A friend may watch too, through Jellyfin directly.

The PC is on **hotel wifi**: no port forwarding, possibly carrier-grade NAT. Nothing may depend
on opening an inbound port at home.

## Goals

1. **Reachable from anywhere** at a private HTTPS address (working name `media.viafluere.com`),
   with no app installed on the watching device.
2. **Play inside Moduli.** A Movie row and an Episode row get a Play button; the video plays in
   Moduli's existing viewer. An "Open in Jellyfin" link is the fallback (always offered).
3. **TV conveniences.** A TV Series row and a Season row get "Play next unwatched".
4. **Watch state, both ways.**
   - Moduli remembers where you stopped (the existing `meta.playbackPosition` behaviour).
   - Passing ~90% counts as finished: it ticks the row watched in Moduli, logs a Watch entry
     (the existing Watch routine that feeds the trackers), and marks it played in Jellyfin.
   - Something finished in a Jellyfin app shows as watched in Moduli too.
5. **Every Jellyfin movie and show is in Moduli.** A Jellyfin item with no Moduli row gets one
   (poster and details), on the right board, in the same shape as its siblings. Existing rows are
   linked, not duplicated.
6. **Transcoding on the GPU** (AMD AMF, already owed) so the stream fits the hotel upload.

## Non-goals (phase 1)

- Music and books (next phase).
- A Moduli login for the friend. The friend uses Jellyfin at the same address with their own
  Jellyfin user.
- Downloading missing films (Radarr's job; it has no indexer yet).

## Anti-goals

- A broken or spinning player when the PC is off or asleep. Moduli must say plainly that the
  media server is unreachable.
- Duplicate rows. Matching must prefer linking an existing row over creating one.
- Media reachable without a login.
- Cloudflare in the path: its terms bar video through the free tunnel. Use the user's own server.
- Breaking a match when a folder is renamed. A row remembers its Jellyfin item id once matched.

## Constraints and facts

- **Moduli server:** DigitalOcean droplet `deploy@viafluere.com` (142.93.5.142), 3 GB RAM, nginx
  in front of Node on :5000, Let's Encrypt via certbot. DNS points straight at the droplet.
  Deploys go through `./deploy.sh`; prod pm2 runs as `deploy`.
- **Jellyfin:** 10.x tray app on Windows, user jtpom, `http://localhost:8096`, libraries Movies,
  Shows, Music, Books, Documentaries. Paths are `\\wsl.localhost\Ubuntu-24.04\mnt\wsl\<drive>\…`.
  The drives are mounted inside WSL at logon by `C:\Users\jtpom\Scripts\mount-norse-drives.ps1`.
- **Moduli data:** poms grid. Movies are `role:"artifact" kind:"movie"` rows sharing one Movie
  module (~994), with Drive / File Path / Size / Owned fields; TV Series ~186 shows (TMDB id in
  `meta.tmdbId`); Seasons ~909; Episodes ~14,787 (`kind:"episode"`, fields TV Show, Season,
  Episode #, Air Date). These ride in the deferred half of the load. Rows are named by their
  placement (`occurrenceDisplayLabel`).
- **Standing rules:** poms grid changes only through migrations (dry run, apply, read back, pm2
  restart). No secrets in the client; a stored key is encrypted server-side and never sent back
  (as `services/searchKeys.js` does). No git push.
- Bandwidth: the video passes through the droplet and counts against its monthly transfer.

## Decided

- **Tunnel through the user's own server**, not Cloudflare, not port forwarding. If performance
  is poor, switch to **Tailscale** (user's call).
- Default tunnel shape (builder may refine): the PC holds an outgoing, auto-reconnecting
  encrypted connection to the droplet that exposes Jellyfin on a droplet-local port; nginx serves
  `media.viafluere.com` over HTTPS and proxies to it.
- Login: Jellyfin's own users (the user's, plus one for the friend).
- Finished = past ~90% (our call; the user accepted).
- Jellyfin items missing from Moduli are added as rows.
- **Past history:** the first sync logs a DATED Watch entry for anything Jellyfin already shows as
  played (dated when it was last played). Today nothing is played yet, so this is a no-op now.
- **Where a Watch entry goes:** the Schedule time slot of the day and time it was finished.
- **Documentaries:** Jellyfin's Documentaries library (`D:\Danny` on Thor) is part of phase 1,
  on a new Moduli board named **Danny Documentaries**.

## Our calls (the user can overrule)

- Only the user's own Jellyfin user counts toward Moduli; the friend's viewing never reaches the
  trackers.
- Only rows linked to a Jellyfin file get Play. "Play next unwatched" skips episodes with no file
  and says it skipped them. Jellyfin seasons/episodes that TMDB lacks (specials, odd numbering)
  get rows too, so every Jellyfin item has one.
- Resume position is shared both ways (read from Jellyfin on Play, written while playing).
- "Watched" is a field on the row (reuse an existing watched/last-watched field if one exists,
  else add one by migration). Watching again logs another Watch entry.
- Matching order: file path (where a row's File Path points at the same file), then TMDB / IMDb
  provider id, then title + year.

## Left to the builder

- Tunnel software and how it starts at logon on Windows/WSL.
- How Moduli's server talks to Jellyfin (API key handling, endpoint for stream URLs), and how a
  Moduli page gets a playable stream without leaking a long-lived key to the browser.
- Matching rules (TMDB / IMDb provider ids first, then title + year), and how sync runs
  (schedule, on load, Jellyfin webhook).
- Which Jellyfin play mode to use (direct play vs. HLS transcode) and quality defaults.
- The exact unreachable-server message and where it appears.
