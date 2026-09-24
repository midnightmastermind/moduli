# Connections tab revamp + Google Drive artifact storage — plan

**Goal (user, 2026-09-24):** *"audit the connections tab, revamp it, and make it accept google drive
info so we can use my google drive for storage of artifact files. the default can be what we had
before but we can change it to use our other connections. this is so my server doesnt increase in
size dramatically due to file uploads."*

So: uploaded file BYTES may live in a **storage connection** other than the server's disk. The server
keeps every record (modules, occurrences, thumbnails, markdown); only the original file moves. The
default stays **Server** (today's `server/uploads/`), and the user can switch it to Google Drive.

---

## 1. Audit — what the Connections tab is today

| # | Finding | Where | Severity |
|---|---|---|---|
| A1 | The two "connections" are **hardcoded paths on the dev machine** (`/home/joshpoms/files`, `/home/joshpoms/notebook`). On the production server both read "not found". | `server.js:625` `CONNECTIONS` | the tab is dead on prod |
| A2 | **No authentication** on `/api/connections*`, `/api/storage-settings`, `/api/artifacts/upload`, `/api/images/upload` — each trusts a `userId` in the request body. Anyone who knows a user id can write into that user's grid **and fill the server's disk**, the very thing this plan exists to prevent. | `server.js:583, 604, 630-735, 880` | **security** |
| A3 | **Path traversal:** `import` does `path.join(conn.path, fileName)` with an unchecked `fileName`, so `../../etc/passwd` copies any readable server file into uploads. | `server.js:658` | **security** |
| A4 | `import` is a hand-copied second upload path: no SHA-256 dedup, no thumbnails, no EXIF, its own MIME table. Two implementations of one question. | `server.js:652-738` vs `services/artifactUpload.js` | drift |
| A5 | `/api/storage-settings` writes `manifest.meta.storageSettings` and **nothing reads it**. | `server.js:604` | dead setting |
| A6 | Deleting an artifact **never deletes its file**; only the manual `scripts/cleanupOrphanArtifacts.js` does. Disk only ever grows. | crud/occurrences delete paths | the growth problem, part 2 |
| A7 | The tab mixes two unrelated jobs — "browse a folder and import" and "upload a file" — and has no notion of *where files are stored*. | `ConnectionsTab.jsx` | UX |

What already exists and is reused, not rebuilt:
- `services/artifactUpload.storeUploadedFile` — the ONE upload lifecycle (hash, dedup, EXIF, thumbnails, module + occurrence + view, cache mirror, broadcast). Shares, uploads and imports all go through it after this plan.
- `models/Secret.js` — AES-256-GCM encryption under `SECRETS_KEY`, fail-closed. Holds the Drive refresh token.
- `client/src/helpers/fileRef.resolveFileRef` — the one place a `fileRef` becomes a URL. A new ref scheme is one branch here.
- `middleware/apiAuth` + session JWT — used to close A2.

---

## 2. Design

### 2.1 A storage backend is a small interface
`server/services/storage/` — one module per backend, one registry:
```
put({ tmpPath, name, mime, size, userId })  -> { ref }              // ref is what fileRef stores
open(ref, { range })                          -> { stream, size, mime, status }
remove(ref)                                   -> void
health()                                      -> { ok, message }
```
- **`local`** — today's behaviour, moved verbatim: `uploads/user/YYYY-MM/<file>`, ref `user/2026-09/…`. Existing refs are local refs; **no migration of existing rows is needed.**
- **`gdrive`** — Google Drive API v3. `put` = resumable upload into one app folder ("Moduli uploads/2026-09"); ref `gdrive:<connectionId>:<driveFileId>`.

### 2.2 Serving a Drive file: a proxy route, not a public link
`GET /files/<connectionId>/<driveFileId>` streams the bytes from Drive through the server (Range
supported, so video seeks; `Content-Disposition` carries the original name; long private cache).
`resolveFileRef("gdrive:c:f")` → `/files/c/f`. Every renderer already goes through
`resolveFileRef`, so images, video, audio, PDF, the code viewer and download buttons need no change.

**Why a proxy:** the files stay private (no "anyone with the link" sharing on your Drive), and the
Google token never reaches a browser. **Cost:** bandwidth passes through the server — but not disk,
which is the problem being solved. (A later option: short-lived redirect to Drive for big video.)

### 2.3 What stays on the server regardless
Thumbnails (256/1024 WebP, ~20 KB each, SHA-keyed), markdown (`uploads/md`), and every database record.
The upload still lands in a temp file first (hash + EXIF + thumbnails are computed from it), then it is
pushed to the backend and the temp file deleted.

### 2.4 Connections become records, per user
New collection `Connection { id, userId, type: "server"|"gdrive"|"folder", name, config, secretId,
status, lastCheckedAt }`. "Server" is implicit (always present, cannot be removed).
`user.meta.storage.defaultConnectionId` picks where NEW uploads go — default Server, i.e. exactly
today's behaviour until you change it. Existing files stay where they are.

### 2.5 Google auth
OAuth 2.0 web flow, scope **`drive.file`** — the app can only see files IT created, never the rest of
your Drive. (It is also the scope Google does not put through a security review.) The refresh token
is encrypted with `Secret.js`. Revoked or expired → the connection shows **Reconnect**.

### 2.5a Load time (user: *"will this also increase the wait time to load in images and videos"*)
What does NOT get slower: every grid, board and card — they show the **thumbnails**, which stay on the
server. What does: opening a full original (full-size image, video, PDF) that lives on Drive — the
server has to ask Drive first, roughly **+0.1–0.5 s to first byte**. Countered by:
- **Browser caching:** `/files/…` answers with a long private `Cache-Control` + `ETag` (a Drive file id
  never changes content), so a file opened once opens instantly afterwards on that device.
- **Streaming with Range:** video and audio start playing after the first chunk; nothing waits for the
  whole file.
- **A small, BOUNDED server cache** of recently opened Drive files (LRU, default 1 GB, set in `.env`),
  so a file several devices open repeatedly is served from the server's disk. Bounded, so it cannot
  regrow the problem this plan solves.
- Later, if big videos still feel slow: redirect those straight to Drive with a short-lived link.

### 2.6 Connections in operations (user, 2026-09-24: *"these connections and what we can do like
upload download etc, should be available in operations as well"*)
A new **Files & storage** category in the action picker (`ui/actionTree.js`, beside Outbound), every
action taking a **connection** chosen from a picker of your connections (Server, each Drive, each folder):

| action | does | result var |
|---|---|---|
| `FILE_SAVE` | store bytes in a connection: an artifact's file, a URL's content, or text → a file | `{ ref, url, name, size }` |
| `FILE_FETCH` | bring a file in from a connection (by path or id) or a URL → a new artifact row in a container/folder | `{ occurrenceId, fileRef }` |
| `FILE_LIST` | list a connection folder | array of `{ name, ref, size, mime, modifiedAt }` — LOOP over it |
| `FILE_MOVE` | move an artifact's bytes to another connection, repointing `fileRef` (Task 9, one file) | `{ ref }` |
| `FILE_DELETE` | remove a file from a connection | `{ ok }` |

**Where they run:** the backends and tokens live only on the server. The **server executor** calls the
storage service directly (so share rules can use them — e.g. "save every shared PDF to Drive"); the
**client executor** suspends and calls one REST route (`POST /api/v1/storage/actions`), the pattern
`CALL_API` and `IMPORT_TEXT` already use. One implementation of each action, on the server.
Every action checks the connection belongs to the op's user and the target row to the op's grid.

---

## 3. Tasks (in order — each shippable alone)

| # | Task | Notes |
|---|---|---|
| 1 | **Close A2 + A3.** Auth the upload/connection/storage routes with the session JWT (`userId` from the token, never the body); client callers send the token. Reject any `fileName` that resolves outside its folder. | Security first; small; no behaviour change for a signed-in tab. Tests: unauthenticated → 401; body `userId` ignored; `../` refused. |
| 2 | **Storage interface + `local` backend.** Move the disk write out of `artifactUpload` into `storage/local.js` unchanged. `/api/images/upload` and connection import (A4) go through `storeUploadedFile`. Delete `/api/storage-settings` (A5). | Pure refactor; every existing upload test must pass unchanged. |
| 3 | **`Connection` model + REST** (`GET/POST/PATCH/DELETE /api/v1/connections`, session-JWT auth) + `user.meta.storage.defaultConnectionId`. | "Server" synthesized, not stored. |
| 4 | **Google Drive connect flow.** `/api/connections/google/start` → Google consent → `/callback` stores the encrypted refresh token and creates the `gdrive` connection + its "Moduli uploads" folder. | Needs the one-time Google Cloud setup (§5). |
| 5 | **`gdrive` backend `put`/`open`/`remove`/`health`** + the `/files/:conn/:id` proxy (Range, 404 → "file missing in Drive", 401 → "reconnect"). | Tested against a mocked Drive; one live check on prod. |
| 6 | **Uploads honour the default connection.** `storeUploadedFile` asks the registry for the user's default backend. Dedup still keys on SHA-256 across backends (same bytes → reuse, wherever they live). | Shares and the extension inherit this for free. |
| 7 | **`resolveFileRef` learns `gdrive:`**; `isExternalFileRef` treats it as INTERNAL (it is the user's own storage). | One branch + tests. |
| 8 | **Revamped Connections tab.** Sections: **Storage** (a card per connection, a "Default for new uploads" choice, health, "Connect Google Drive", usage: count + total size per connection); **Upload** (kept); **Folders** (the old path browser, only if a `folder` connection exists — otherwise gone). | Rendered in a real browser before shipping, like the Imports tab. |
| 9 | **Move existing files** — `scripts/moveUploads.js --to <connectionId> [--apply]`: copy → verify by SHA-256 read-back → repoint `fileRef` → only then delete the local copy (a separate `--delete-local` flag). Dry run by default, resumable, logs every file. | This is what actually shrinks the server. Run on poms only when you say so. |
| 10 | **Deleting an artifact deletes its file** when no other module references the same bytes (A6), in any backend. | The other half of "disk only grows". |
| 11 | **Operation actions (§2.6)** — `FILE_SAVE / FETCH / LIST / MOVE / DELETE`: server service + `/api/v1/storage/actions`, client suspend bridge, server-executor cases, action-tree category with a connection picker, and the `$share.*`-style result shapes documented in the picker. | After 5 (needs a second backend to be worth testing). Tests drive both executors against the mocked Drive. |

---

## 4. Decisions — ALL FOUR ACCEPTED by the user as proposed (2026-09-24)

1. **Drive unreachable at upload time** (token revoked, Google down): *proposed* — store on the Server
   instead and say so in the upload result, rather than fail. Never lose an upload.
2. **Move existing uploads to Drive** (Task 9): *proposed* — yes, but only by an explicit run you
   start; nothing moves automatically.
3. **Scope of the default:** *proposed* — per USER (all your grids). Per-grid override can come later.
4. **Thumbnails** stay on the server (tiny; they make grids load fast). *Proposed yes.*

---

## 5. One-time Google Cloud setup (you do this; Task 4 needs it)

1. console.cloud.google.com → create a project ("Moduli").
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **OAuth consent screen** → External → app name, your email → add scope `.../auth/drive.file` →
   add your own Google account as a **test user**. (Test mode is fine for personal use; no Google review.)
4. **Credentials → Create OAuth client ID → Web application** → Authorized redirect URI
   `https://viafluere.com/api/connections/google/callback`.
5. Put the two values in the server's `server/.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
   and make sure `SECRETS_KEY` is set (32 random bytes, base64) — the token is encrypted with it.

---

## 6. Out of scope (v1)
Dropbox / S3 / OneDrive backends (the interface makes each one file later); per-grid defaults; storage
quotas; importing files that already exist in your Drive beyond what `drive.file` allows (only files
Moduli created, or ones you pick with Google's file picker — a later add); a trigger that fires when a
file appears in a Drive folder (needs polling or Drive push notifications — its own plan).

## Progress

| task | state |
|---|---|
| 1 security | **done 2026-09-24** — `middleware/sessionAuth` (`requireSession` before multer, `ownsGrid`), `utils/safePath.resolveInside`; the upload/image/connection/wikipedia routes take the user from the session; `/api/storage-settings` deleted; client sends `sessionHeaders()` (XHR helper + every direct fetch) and `CALL_API` adds it to same-site URLs only. Tests: `sessionAuthRoutes` (A/B'd: wiring fails on the old server.js), `callApiSession`. **Deploy note:** a tab still on the old bundle gets 401 on upload until reloaded. |
| 2–11 | not started |
