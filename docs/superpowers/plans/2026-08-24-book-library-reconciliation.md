# Book Library Reconciliation — Survey and Manifest

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**User, 2026-08-24:** *"look at the Calibre Library in my windows Documents folder and the book files
in Documents folder of the drive and compare the two libraries while also coming up with one big
organized book manifest so i can merge and organize these books better."*

**Goal:** ONE manifest describing every book across both machines' libraries, saying for each title
where every copy lives, which formats exist, and which copies are duplicates — so the merge is a
decision the user makes from evidence rather than a script guessing.

**Deliverable (user's call, asked before planning): a REPORT FIRST.** Read-only. Nothing is moved,
renamed, deleted or imported. Whether it later becomes a Moduli board or a rebuilt Calibre library
is a separate decision taken once the report exists.

**Duplicates (user's call): FLAG, NEVER AUTO-DELETE.** The manifest marks duplicates and lists every
path; the user decides case by case. These are real book files and there is no undo.

**Scope (user's call, 2026-08-24):**
- **`big_books` IS in scope** — all 792. The manifest covers all five libraries, ~1,816 books.
- **`archived_files_unorganized` (305) is EXCLUDED ENTIRELY**, the same treatment as `work_files`.
  The count is still reported so the user knows what was skipped — an exclusion nobody can see is
  indistinguishable from a survey that missed them. **This retires Task 5's first bullet.**

---

## What was measured BEFORE this plan was written

**The premise in the ask is wrong in two ways, and both change the work.** It is not "two
libraries", and the C: one is not a Calibre library.

```
                                                          books    size   metadata.db
D:\Documents\book_files\big_books                           792   6.14GB   YES
D:\Documents\book_files\Calibre Library                     454   3.44GB   YES
D:\Documents\book_files\Books                               278   2.68GB   no
D:\Documents\book_files\calibre-20210601T153354Z-001         32   0.08GB   no   (Takeout export)
D:\Documents\book_files\  (loose in root)                     8      —     n/a
C:\Users\jtpom\Documents\Calibre Library                    239   0.93GB   NO
C:\Users\jtpom\Documents\  (loose in root)                   13      —     n/a
                                                          -----
                                                          1,816  ~13 GB    across SEVEN locations
```

**FIVE libraries, not two.** `big_books` alone is more than three times the C: folder the ask names.

**THE C: "Calibre Library" IS NOT ONE — it has no `metadata.db`.** It is a hybrid:
```
  95 books in 64 author folders, in Calibre's own `Title (bookid)` layout
 144 books dumped FLAT at the top level  <- Calibre would not know about these
 279 PNGs under .MoonReader/             <- an Android reader's page cache, NOT books
```
So its 95 structured books came from a real library whose database is somewhere else — and D: has
two databases. **Task 2 tests whether they are a subset of one of them**, because if so, the C:
folder is a partial copy and the merge is far simpler than it looks.

**AND 3,194 FILES THAT LOOK LIKE BOOKS ARE NOT BOOKS.** A naive recursive count of `D:\Documents`
returns **5,078** book-extension files. `work_files` holds 3,194 of them and `archived_files_unorganized`
another 305 — certificates, scans, pay stubs, a 1Password emergency kit:
```
  10-Skills-to-Increase-Your-Communitys-Diversity-Competence-mos-certificate-completion.pdf
  1Password Emergency Kit A3-LH6REB-argusinc.pdf
  Paycheck_2022-01-31_2022-02-13.pdf
```
**Counting by extension would have put 3,194 work documents into the user's book manifest.** They are
excluded by FOLDER, and the exclusion is reported rather than silent, because `archived_files_unorganized`
is a genuine grab-bag that may hold real books (Task 5).

## Constraints

- **READ-ONLY, all seven locations.** No move, rename, delete or write outside this repo's own
  output. This is the user's real library and the whole point of "report first".
- **`metadata.db` is opened read-only and NEVER through Calibre.** Two of them are live libraries;
  a write could corrupt a catalog. Copy to the scratchpad and read the copy.
- **A count is not an identity.** Match on content hash first, normalised title/author second, and
  say which rule fired for every duplicate claim.
- **The manifest names no book the survey did not actually find.** No inference from a filename
  alone where the file's own metadata can be read.

## Open, needs the user

- **D: is not mounted in WSL.** It exists (2.8TB used) and is readable via `powershell.exe`, which is
  how every number above was measured — but a per-file hash of 1,816 files through PowerShell is slow.
  Mounting is one command the user runs, since `sudo` needs a password:
  ```
  ! sudo mount -t drvfs D: /mnt/d
  ```
  **Not a blocker** — Task 1 falls back to PowerShell hashing if it stays unmounted, and says so.

---

## Task 0 — Establish the corpus, and prove the exclusions

- [ ] Enumerate all seven locations; classify each file `book` / `not-book` / `unsure`.
- [ ] **Exclude `work_files` (3,194) and `archived_files_unorganized` (305) by FOLDER, and report
      both counts** — never silently. The 3,194 are the reason this task exists.
- [ ] Sample 20 from each excluded folder and record what they actually are, so the exclusion is
      evidence rather than an assumption.
- [ ] **Positive control:** the corpus must contain a title the user can name from memory. A survey
      that finds nothing recognisable is a broken probe, not an empty library.

**Expected:** ~1,816 books, ~13 GB, seven locations. A number materially different means the
extension list or the folder exclusions are wrong — stop and re-measure.

## Task 1 — Read the two Calibre catalogs

- [ ] Copy both `metadata.db` to the scratchpad; open the COPIES read-only.
- [ ] Extract per book: title, author(s), series + index, ISBN/identifiers, tags, pubdate, formats,
      and the on-disk path.
- [ ] **Reconcile catalog against disk in BOTH directions** — a row whose file is missing, and a
      file no row mentions. Both are real states in a library that has been copied around, and each
      means something different for the merge.
- [ ] Record which of the 792 + 454 are catalogued vs orphaned.

## Task 2 — Test whether C:'s 95 structured books are a subset of a D: library

- [ ] Parse the `(bookid)` out of each of C:'s 95 author-folder names.
- [ ] Look each id up in both D: databases; compare title + author + file size.
- [ ] **Report the verdict either way.** If they ARE a subset, C:'s structured half needs no
      reconciliation at all and the real work is its 144 flat files. If they are NOT, C: is a fifth
      independent library and the id space collides with D:'s — which would make ids useless as
      identity and is exactly the kind of thing to learn before relying on them.

## Task 3 — Identity: decide what "the same book" means

- [ ] **Content hash (SHA-256) first** — byte-identical copies are the unambiguous case, and with
      1,816 files across copied-around folders this is expected to be the bulk of the duplicates.
- [ ] **Normalised title + author second**, for the same book in two formats or two scans. Normalise
      the way `spotifyLibrary.normName` already does (case, punctuation, whitespace) rather than
      writing a second normaliser.
- [ ] **ISBN third, and only as corroboration** — a Calibre ISBN is often the edition's, and two
      genuinely different editions share a work.
- [ ] **Every duplicate claim records WHICH rule fired.** A hash match and a fuzzy title match are
      not the same confidence and must not be presented as if they were.
- [ ] Extract embedded metadata for the 144 + 278 + 32 + 21 uncatalogued files: EPUB `content.opf`,
      PDF `/Info` + XMP. **Where a file's own metadata is unreadable, the manifest says
      `title: unknown (from filename)` rather than passing a parsed filename off as metadata.**

## Task 4 — The manifest

- [ ] One row per WORK, listing every copy: path, library, format, size, hash, catalogued y/n.
- [ ] Columns the merge decision actually needs: `formats_available`, `copy_count`,
      `duplicate_rule`, `best_copy` (a SUGGESTION, flagged as such), `metadata_confidence`.
- [ ] Write both `books-manifest.csv` (sortable in Excel) and `books-manifest.json` (machine-readable
      for a later Moduli import, if the user takes that route).
- [ ] **A summary the user can act on:** total works, total files, space recoverable if duplicates
      were removed, works present in only one library, format conflicts, and the unreadable tail.

## Task 5 — Report the judgement calls, do not make them

- [x] ~~`archived_files_unorganized` (305): ask before including~~ — **SETTLED: excluded entirely**
      (user, 08-24). The count is reported, never silently dropped.
- [ ] Files whose metadata cannot be read at all — listed, counted, never guessed at.
- [ ] Format conflicts (same work as EPUB and PDF) — listed as a choice, not resolved.
- [x] ~~Confirm `big_books` is in scope~~ — **SETTLED: in scope** (user, 08-24), all 792.

## Explicitly NOT in this plan

- Moving, renaming, deleting or de-duplicating any file.
- Rebuilding a Calibre library or writing to any `metadata.db`.
- Importing into Moduli. **If that follows, `0199` (bookmarks) is the model** — a board of rows with
  fields, `artifact` role for the row-count reasons `0222` measured, and covers as `meta.cover`
  rather than an artifact each.
- Touching `work_files`.
