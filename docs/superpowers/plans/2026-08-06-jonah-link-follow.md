# Jonah asks to follow the links — and imported links point at OUR pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: NOT STARTED. Sequenced AFTER the artifact-spread and prefill plans.**

**User direction (2026-08-06):**
> "add in a task after these two plans, to make the jonah bot ask if it wants link follows too.
> where we grab the links from the minitextblocks and create pages out of those, so those links go to
> our pages and not back to wikipedia"

**Goal:** After an import, Jonah offers to follow the links the article actually contains; the ones
you accept are imported, and every chip that pointed at Wikipedia is rewritten to open the page in
this app instead.

---

## What exists, and the exact gap

Two thirds of this shipped in June and are still in place:

- **`wikipedia_import_batch`** (server tool, `requires_confirm`) imports N titles in one confirm card
  and calls relink once at the end. **`wikipedia_links`** lists an article's outbound links. The
  system prompt already documents the recipe "X AND the surrounding links" → `wikipedia_links` → one
  batch.
- **`services/importRelink.js`** — pure `relinkTextmap` / `relinkOccurrences`: after a batch, an
  imported doc's **inline wiki link MARKS** become native `docLink` nodes when the target was also
  imported.

**THE GAP — and it is why the user is asking.** The importer stopped emitting link *marks*. Since
2026-06-06 a prose link becomes its **own occurrence**: a `role:"textblock" kind:"inline"` mini
textblock carrying `meta.link = { kind:"url", url }`, embedded as an `instanceTextblockInline` node
(`markdownImporter.buildInlineLink`). `relinkTextmap` walks marks — **it does not know about
`meta.link` on a mini textblock**, so nothing it does reaches today's imports. Every chip still
opens en.wikipedia.org.

`TextblockCard` already renders `meta.link.kind === "occurrence"` as an in-app jump
(`jumpToOccurrence`), so **the target shape already exists** — nothing needs designing, only
converting.

## Architecture

1. **Harvest from the occurrences, not the HTML.** After an import, walk the imported subtree for
   `role:"textblock" kind:"inline"` occurrences whose `meta.link.kind === "url"` and whose url is a
   wiki article. That is the honest list of "links this page actually shows", already de-duplicated
   by the importer, and it is what the user pointed at ("grab the links from the minitextblocks").
2. **Jonah asks.** A confirm card listing the harvested titles with checkboxes (all checked), a count,
   and a depth of 1 — the shape `ConfirmCard`'s `isImportBatch` branch already renders for
   `wikipedia_import_batch`. Declining imports nothing and leaves the chips alone.
3. **Import the accepted set** through the existing `wikipedia_import_batch` — no new import path.
4. **Rewrite the chips.** Extend relink to a second, occurrence-level pass: for every mini-textblock
   link whose url resolves to an imported root, rewrite `meta.link` from
   `{ kind:"url", url }` to `{ kind:"occurrence", occId }`. One `update_occurrence` per rewritten
   chip; idempotent (a chip already pointing at an occurrence is skipped).
5. **Un-imported links stay urls.** A chip pointing at an article you did not accept must keep
   working as a web link — this converts what it can and leaves the rest exactly as it was.

## Tech Stack

Express + Socket.io, Mongoose, Vitest (server). Client: React 18.

## Global Constraints

- **`poms grid` is protected live data.** The Eminem page is imported content already on it — any
  rewrite pass must be idempotent and must never touch a chip it did not resolve.
- **No new import path.** Reuse `wikipedia_import_batch`; a second importer would drift from the
  first (the two alarm builders already taught this).
- **Server restart applies tool/prompt changes**; imports are user-triggered, no reseed.
- **Verify by diffing persisted state** — count chips before and after, and assert the untouched
  ones are byte-identical.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/services/importRelink.js` | Gains `collectLinkChips(occurrences)` and `relinkLinkChips(occurrences, titleToRoot)` — the occurrence-level pass. Pure. |
| `server/services/assistantTools.js` | `wikipedia_link_candidates({ rootOccurrenceId })` — harvest + resolve which are already imported. `wikipedia_import_batch` gains a `relinkChips` step. |
| `server/services/assistantAgent.js` | SYSTEM_PROMPT: after an import, offer to follow its links. |
| `client/src/ui/AssistantDrawer.jsx` | The follow-links confirm card (reuses the batch checklist shape). |
| `server/migrations/00NN-relink-existing-import-chips.mjs` | One-off: rewrite chips on ALREADY-imported pages (the Eminem page) whose targets are also already imported. |

---

## Open questions — ASK, do not assume

The user has asked to be given selectable options rather than recommendations. Before Task 2:

1. **When does Jonah offer?** Automatically after every import, or only when you say "and its links"?
2. **How many links?** An article has hundreds. Top N by position (the lead's links are the
   meaningful ones), only links that appear in prose, or let the user tick from a list?
3. **Depth.** Follow the links of the pages it just imported (depth 2), or stop at one hop?

---

### Task 1: The occurrence-level relink (pure, testable, no assistant involved)

**Files:** `server/services/importRelink.js`; test `server/__tests__/importRelinkChips.test.js`.

- [ ] **Step 1: Failing tests** — a chip whose url matches an imported title is rewritten to
      `{kind:"occurrence", occId}`; one whose title was NOT imported is left byte-identical; a chip
      already pointing at an occurrence is skipped (idempotent); url forms `/wiki/X`, `.../wiki/X#anchor`,
      underscores vs spaces, and percent-encoding all resolve to the same title.
- [ ] **Step 2: Implement** `collectLinkChips` + `relinkLinkChips`.
- [ ] **Step 3:** Prove it against REAL data: load the Eminem import's chips from poms grid
      (read-only) and report how many would resolve against the pages currently imported.

---

### Task 2: Jonah offers, and the batch relinks chips

**Blocked on the three open questions.**

- [ ] Harvest tool + confirm card + wiring `relinkLinkChips` into the batch's tail.
- [ ] E2E on `test grid 2`: import an article with links, accept two, confirm those two chips jump
      in-app and the rest still open the web.

---

### Task 3: Repair the pages already imported

- [ ] Migration rewrites resolvable chips on existing imports. **Dry run and report the count before
      applying** — this changes where the user's existing links go.

---

## Risks

- **A chip is a real occurrence with its own textmap.** Rewriting `meta.link` must not touch the
  text; assert the rendered label is unchanged in the tests.
- **Title resolution is fuzzy** (redirects, anchors, `Eminem_(album)`), and a WRONG resolution sends
  a link to the wrong page — worse than leaving it on the web. Resolve only exact title matches; do
  not guess.
- **Import volume.** "Follow the links" on a big article can mean hundreds of pages; the existing
  batch caps at 15 for a reason. Keep that cap and make the count visible on the card.
