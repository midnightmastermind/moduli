# Spotify songs play in the viewer, with Moduli's own audio controls

Date: 2026-10-20 · Status: design, awaiting approval

## Intent

The user's Spotify library already lives on poms grid's **Songs** board: 5,484 rows, each a
Spotify track, imported 2026-08-24 from a Spotify CSV export (`server/utils/spotifyLibrary.js`).
Today a song's link opens in the viewer as Spotify's own embedded player, which plays previews
unless the browser happens to share a Spotify login, and looks and behaves nothing like Moduli's
audio tiles.

The user wants a song to behave **like an image does**: an image can be backed by a stored file
or by a link, and either way it opens and works the same. A song backed by a Spotify link should
open in the viewer and play through **Moduli's own audio player**, the same one a Drive mp3
uses. They do not want a dedicated Spotify panel or player page. Their words:
*"i dont want a dedicated spotify panel, i want to click the song, it opens in viewer so i can
play it with our audio system we have."*

They have Spotify Premium.

## Goals

1. **Connect Spotify once**, in Command Center › Connections, beside Google Drive (the user:
   *"put spotify in the connections tab … or wherever drive connection lives"*). Same shape as the
   Drive connection: a Connect button, an OAuth sign-in, a status (ok / needs reconnect), and a
   Disconnect. **Only the connection lives there.** Everything about what the sync does — the
   destination, Sync now, the last run's result, the backfill count — lives in **Command Center ›
   Imports**, in its own Spotify section beside Feeds (the user, 17:29: *"put the spotify settings
   (other than initial connection stuff) in the imports section"*).
2. **A Spotify track opens in the viewer as an audio tile**, not as Spotify's embed. Clicking a song
   row opens the viewer as today; the tile is Moduli's audio player, driven by Spotify's Web Playback
   SDK: play/pause, a seek bar, elapsed/total time, volume. It should look like the existing audio
   tile (`modules/AudioWaveform.jsx`) wherever possible.
3. **It remembers where you stopped**, like every other audio and video file (`hooks/useMediaPlace`).
4. **A Transcribe button on every audio tile.** It is generic: the app does not know or care that a
   track is a song (the user: *"i dont want it to say lyrics cause the system shouldnt really know
   its music and not just audio"*). For a Spotify track, Transcribe finds the track's page on Genius
   and opens it **in a new browser tab**. (Checked 2026-10-20: Genius answers
   `X-Frame-Options: SAMEORIGIN`, so it cannot be shown as a viewer tile. Do NOT open it through the
   viewer's browser tile either: that tile offers Reader/Magic, which would copy the page.) For other
   audio it is a placeholder for a later speech-to-text feature (see non-goals).
5. **The board keeps up with Spotify.** Songs the user likes or albums they save on Spotify after
   today appear on the Songs board by themselves, with their Artist and Album rows, in the same
   shape as the existing 5,484 rows.

## Non-goals (for this project)

- **The user's own music files** (the 4,113 FLAC/MP3s on the WD My Passport, the easystore tracks).
  Explicitly deferred: *"i just need the spotify library for now, not my music."* The design must
  not block them later: a song row will eventually be backed by a file, a link, or both.
- **Speech-to-text for audio files.** Wanted *"at a future date"*. This project only puts the
  Transcribe button in place and routes it per source; the file branch can say "not available yet"
  or be hidden until it exists. Builder's call which.
- **Playlists, podcasts, albums as a playable unit.** Only single tracks play. (An album or playlist
  link keeps today's behaviour.)
- **Phones.** Spotify's Web Playback SDK does not run on mobile browsers. On a phone the tile keeps
  today's Spotify embed (or an "Open in Spotify" link). Desktop Chrome and Firefox are the target.

## Anti-goals (would make this a failure even if it "works")

- **No copy of lyrics in Moduli, ever.** Transcribe opens Genius's page; it never fetches, scrapes,
  parses or stores the words. No "Magic"/Reader treatment of a Genius page built for this. (The
  user asked for a Magic button on the lyrics page; this was declined in conversation.)
- **No capturing or downloading Spotify audio.** The SDK's audio is encrypted and stays that way.
- **No music-specific wording or special-casing in shared UI.** The button is "Transcribe", the tile
  is an audio tile. What makes a Spotify track different is its link, decided in one place.
- **No duplicate rows.** Sync must never mint a second row for a track already on the board. Identity
  is the Spotify track id, never the title (the import's own rule: titles collide, ids do not).
- **No writes to poms grid that skip the app's write paths.** poms grid is protected live data:
  everything a sync writes goes through the same create/link machinery the share rules use, with
  the warm cache kept in step, and it is rehearsed on test grid 2 first.

## What exists today (measured 2026-10-20)

- **Songs rows** (poms, 5,484): `role: artifact, kind: song`, all sharing ONE module labelled "Song"
  (no `fileRef`). Per row: field **URL** = `https://open.spotify.com/track/<id>`, fields **Artist** and
  **Album** (occurrence links to Artist / Album board rows), **Board Category** `song`; `meta`:
  `searchProvider: "spotify"`, `searchExternalId: <track id>`, `spotifyArtist`, `spotifyAlbum`, `isrc`,
  `cover` (Deezer cover art URL). None carry `meta.source` — the import wrote `searchExternalId`.
- **Viewer:** `helpers/embedUrl.js` already rewrites a Spotify track/album/playlist URL to
  `open.spotify.com/embed/...`; `helpers/spreadBrowser.planSpreadBrowser` plans a browser tile from a
  row's URL. That is how a song opens today.
- **Audio tile:** `modules/AudioWaveform.jsx` (wavesurfer, lazy) used by `ArtifactCard` in the spread;
  saved spot via `hooks/useMediaPlace(moduleId)`, written to `module.meta.playbackPosition`.
- **Connections:** `server/services/googleOAuth.js` (signed `state`, refresh token encrypted with
  `SECRETS_KEY`, reconnect keeps the id), `server/models/Connection.js` (`type` enum is `["gdrive"]`),
  Command Center › Connections UI.
- **Timers:** feeds already run on a server timer (`services/feeds.js`).

## Decided in conversation

- Spotify library only, not the user's files (for now).
- No Spotify panel; songs open in the viewer and play in Moduli's player.
- User has Premium → the Web Playback SDK route (our controls), not the embed.
- Transcribe is a generic audio button; for Spotify tracks it opens Genius's page; it will later do
  real speech-to-text for files. It is not called "Lyrics".
- The 5,484 rows are the whole library; new likes/saves should keep arriving automatically.
- Spotify's connection lives where Drive's does (Command Center › Connections); its sync settings live in Command Center › Imports.
- **What the sync brings in (user, 17:27):** every **liked song**, and **every track of every saved
  album**. That includes a one-time **backfill** of the tracks of the albums already saved (the
  08-24 import made those Album rows without their tracks), then, from then on, each newly liked
  song and each newly saved album's tracks. Album tracks the user never liked individually become
  rows too. The rehearsal on test grid 2 must report how many rows the backfill will add before it
  runs on poms.

## Calls I made (the user has not ruled on these — flag for review)

- **Saved spot is per placement for link-backed audio.** `useMediaPlace` keys on the MODULE, and all
  5,484 songs share one module, so every song would share one saved position. For a link-backed
  track the position goes on the occurrence (`occurrence.meta.playbackPosition`); file-backed audio
  keeps the module. (A Spotify track also remembers its place through Spotify itself only per
  session, so this is still worth doing.)
- **One Spotify player per browser tab.** The SDK creates a Spotify Connect device ("Moduli"); a
  second tile pauses the first. Starting a song in another tab moves playback there, as Spotify does.
- Unliking a song or unsaving an album on Spotify does **not** delete rows (a row may carry the
  user's own fields/notes); they are left alone. Followed artists add Artist rows only.
- **Sync cadence:** on connect, then every 30 minutes and on a "Sync now" button in the Imports tab's
  Spotify section, which also shows the last run (when, how many rows added, any error).
  The first run reconciles liked songs by id and performs the saved-album backfill.
- **Where new rows go:** the same Songs / Artists / Albums containers the 08-24 import used, found by
  what the existing rows sit in, not by name.
- **Artist / Album links for a synced song.** Only ~163 artists and ~199 albums on the board carry a
  Spotify id; the rest were made from song credits and are keyed by normalised name
  (`spotifyLibrary.normName`). A synced song links to an existing row by Spotify id first, then by the
  import's normalised-name rule, and mints a row only when neither matches. When a row is matched by
  name, its Spotify id is filled in then (one write, only for rows a new song touches — never a
  sweep over the ~4,000 existing rows).
- **Saved place is not shared by copies.** Each placement keeps its own `playbackPosition`; a copy or
  copy-link starts at the beginning.
- **Which grid the sync writes to:** the Spotify connection belongs to the user (like Drive), and the
  Imports tab's Spotify section has a **"Songs go to"** picker naming a grid + Songs board (and the Artists/Albums
  boards next to it). Set to poms' Songs board after the rehearsal on test grid 2. Nothing is synced
  until a destination is chosen.
- **The tile's look:** the song's cover, then the same controls row as the audio tile (play/pause,
  seek bar, times, volume), with a plain progress bar where the waveform would be. Spotify's audio is
  encrypted, so there is nothing to draw a waveform from.
- **Genius lookup** goes through the server (a Genius API client token in `server/.env`), searching
  by track title + first artist and taking the top result whose primary artist matches; no match →
  a Genius search page for the same query.

## Constraints

- Spotify developer app (free) with redirect URI `https://viafluere.com/...callback`; dev-mode apps
  serve only allow-listed users, which is fine for one user. Env: `SPOTIFY_CLIENT_ID`,
  `SPOTIFY_CLIENT_SECRET` (and optional redirect override), never in chat or git.
- Scopes: `streaming`, `user-read-email`, `user-read-private` (SDK), `user-read-playback-state`,
  `user-modify-playback-state` (start a track on the Moduli device), `user-library-read` (sync),
  `user-follow-read` (followed artists).
- The SDK needs a fresh access token on demand; the browser must never see the refresh token. A
  session-authenticated route hands out a short-lived access token.
- Playback needs DRM (Widevine) enabled in the browser; Firefox asks once. The tile should say so
  if the SDK reports it.
- Tests: the repo's habits apply — pure helpers tested, A/B'd, behaviour watched on prod before it is
  called done.

## Left to the builder

Component and file names; how the Spotify tile shares code with `AudioWaveform` (one component with
two sources, or two that share a controls bar); the exact sync diff/merge mechanics; where the
Transcribe button sits in the tile header; error and loading states; the SDK loader; how the
Connections UI is extended (one generic list with a Spotify card is expected).
