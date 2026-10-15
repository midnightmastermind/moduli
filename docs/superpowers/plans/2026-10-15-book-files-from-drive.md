# Plan — book files from Google Drive, read in the app

User, 2026-10-15: *"connect my book files, which ill upload in google drive, with our book file occurances. and then
when i open to view, we have a similar view for browser which shows the book in normal format, and a magic button
that turns that page into temporary occurances (unless dragged out obvi). with a save page button as well."*

Status: **plan only — nothing built.** Decisions the user needs to make are marked **ASK**.

## What exists today (measured on poms grid, 2026-10-15)

- **595 book rows** (`role:"artifact" kind:"book"`, two shared "Book" modules). They came from a drive import: each
  carries Title, Author (`meta.mediaAuthor`), `Formats`, `Size`, `Drive` ("Freyja's library…"), a web-search cover —
  and **no file**. `fileRef` is null; nothing points at the actual book.
- Formats across those rows: **azw 259 · epub 150 · pdf 97 · mobi 31 · azw3 2 · djvu 2 · doc 2**.
- A **Google Drive connection** exists (Connections tab). Its status is **`needs_reconnect`**. It uses the
  `drive.file` scope: Moduli can only see files **it uploaded itself or the user picked for it** — not everything in
  the user's Drive. Files are served through `GET /files/:connectionId/:fileId` (Range requests work).
- Pieces to reuse: the Files field + `main` (a row's attachments and its face), `ensureArtifactPageOcc` (an artifact
  opens as a full-screen page), `BookmarkView`'s mode strip (Reader · Magic · Web · Archive), `import_plan` (plans
  an occurrence tree and writes nothing), `readerStateFromPlan` + `PagePreviewBody` (renders a plan read-only),
  the OCR viewer's `+ Page` (files a planned page in Imports), `pdfjs-dist` (already a dependency).

## 1. Getting the files into Drive where Moduli can read them

`drive.file` cannot see files the user drops into Drive by hand. Three ways around it:

| | How | Cost |
|---|---|---|
| A | Upload through Moduli (Connections › Upload, or drop on the Books board) — files land in Drive's "Moduli uploads" | Works today; 595 files is a big upload through a browser |
| B | Google Picker: the user picks files in a Google dialog, which grants `drive.file` access to each picked file | New: Picker API key + a dialog; multi-select works, a whole folder does not grant its contents |
| C | Ask for `drive.readonly` and list a chosen folder | Restricted scope — fine while the Google app stays in "testing" with the user as a test user; unverified-app warning |

**ASK:** A, B or C? (Recommendation: **C** for a personal library this size — pick one folder, Moduli lists it. B if
the app should stay on the narrow scope.)

First step regardless: **reconnect the Drive connection** (it is `needs_reconnect`).

## 2. Linking a Drive file to its book row

A "Link library" action (Connections tab, or the Books board's menu):

1. List the book files in the chosen folder (name, size, mime).
2. Match each file to a row: normalise the file name (strip extension, "(z-lib.org)", underscores, author suffixes)
   and compare with the row's `mediaLibraryKey` / title; break ties with author and with `Size` vs the file's size
   (the rows already record a size, which is a strong second key).
3. Show the matches in a review list (the `ConfirmListHost` pattern): matched · ambiguous (pick one) · unmatched.
4. On confirm, each file becomes an artifact (`kind` from its extension, `fileRef: gdrive:<conn>:<fileId>`), homed in
   **Files › Books**, attached to the row's Files field and made its `main` file.

**ASK:** an unmatched file — create a new book row for it, or leave it in Files › Books only?

## 3. Opening a book: the reader page

Opening a book row (or its file) opens a page like the bookmark browser, with a mode strip:

**Book · Magic** (+ a **Save page** button)

- **Book** — the book as written, paginated, with next/previous and a table of contents.
  - epub / mobi / azw3: **foliate-js** (MIT, renders EPUB, MOBI, KF8/AZW3, FB2, CBZ in the browser; vendored, lazy
    chunk like highlight.js / tesseract). *To verify:* that its MOBI parser opens the old `.azw` files.
  - pdf: the existing `pdfjs-dist`.
  - Kindle `.azw` files bought from Amazon are usually **DRM-locked** and cannot be opened by anything here. The
    viewer says so plainly instead of showing a blank page. (Likely a large share of the 259.)
  - djvu / doc: not supported in the first pass (5 files).
- **Reading position** is stored on the book row (`meta.readingPosition`: an EPUB CFI or a PDF page) so the book
  reopens where it was left, on any device.

## 4. Magic: the current page as temporary occurrences

- Takes the **current page/chapter**: an EPUB section's HTML (turned into markdown by the server's existing
  converter) or a PDF page's text (pdf.js text content, laid out by `helpers/ocrLayout`).
- Sends it to `import_plan` with shape `magic` → sections, textblocks, lists — **planned, never written**.
- Renders the plan read-only (`readerStateFromPlan` + `PagePreviewBody`, `publishComputed={false}`), exactly how the
  bookmark Magic mode and OCR Magic already work. Leaving the page leaves nothing behind.
- **Dragged out = kept.** New: a planned node is draggable; dropping it on a board, doc or canvas mints that node and
  its planned children for real (one undo step), in the dropped mode (copy). This is the one genuinely new mechanism —
  the reader is currently isolated with no write path, on purpose (a reader must never write by accident).

## 5. Save page

**Save page** files the current page as a real page in **Imports**, in the current mode's shape (Book → one
textblock of the page's text; Magic → the planned tree), and opens it — the same path as the OCR viewer's `+ Page`.
The saved page carries a link back to the book row and the position it came from.

**ASK:** should saved pages go in Imports, or in a folder per book (e.g. `Library/Reading/<book>`)?

## Build order

1. Reconnect Drive; the chosen access route (section 1).
2. Link library — listing, matching, review, attach (section 2). Test on 10 books first.
3. Book mode for epub + pdf (foliate-js + pdf.js), reading position (section 3).
4. Magic mode via `import_plan` (section 4, render only).
5. Save page (section 5).
6. Drag a planned node out of Magic (section 4, last part).
7. mobi/azw3 checks, DRM message, unsupported formats.

Each step is usable on its own; 2 alone already fixes "the book rows point at nothing".
