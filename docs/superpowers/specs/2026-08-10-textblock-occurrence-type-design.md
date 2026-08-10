# Textblock as its own occurrence type — design

**Date:** 2026-08-10
**User ask:** *"we should make a plan to make textblocks its own occurance type instead of a module
instance."*
**Constraint the user added when the measurement came back:** *"it should work exactly the same way
it does now, just as its own type"* — plus architectural cleanliness and the performance of
1,090 textblocks each being a live editor.

---

## 0. THE PREMISE CHANGED — measure first, as always

The task was written believing that *"ModuleContainer routes a textblock child to
`<ModuleInstance renderBody={TextblockCard}>`, so a textblock inherits the instance row shell."*

Measured across all three grids (`server/scripts/_textblockcensus.mjs`, read-only), that is true of
**about 5% of textblocks**:

| how a textblock actually renders | poms grid | test grid 1 | test grid 2 |
|---|---|---|---|
| `InstanceTextblockInlineNode` (inline chip) | 721 | 9 | 9 |
| `InstanceTextblockNode` (block node view) | 246 | 236 | 233 |
| `ModuleInstance` + `renderBody` ← *the instance shell* | 45 | 8 | 7 |
| listed-only (container child loop → also the shell) | 6 | 0 | 0 |
| **total textblock occurrences** | **1,036** | **253** | **249** |

`InstanceTextblockNode` and `InstanceTextblockInlineNode` mount `ModuleInstance` **nowhere**.
`InstanceTextblockNode` carries the comment *"Mirrors ModuleInstance"* — it **re-implements** the
drag mode, radial menu and drag registration rather than inheriting them.

**So the thing to escape is not the instance shell. It is that one role has three renderers, and
the shell is the smallest of them.**

### There is no data change

`role: "textblock"` is already a first-class role. On poms grid its 1,036 occurrences carry:

| key | count of 1036 |
|---|---|
| `textmap` | 1036 |
| `meta.link` | 709 |
| `identitySignature` | 14 |
| `ownStyle` | 0 |
| `meta.layoutCascadeOverride` | 0 |
| `linkedGroupId` | 0 |
| children | 0 |
| `viewId` | 0 |

**Module↔occurrence is 1:1 — 0 of 1,036 textblock modules back more than one occurrence.**

This is purely a **rendering** question, which makes it far cheaper and lower-risk than the task
assumed.

### The field machinery is dead weight for textblocks

| role | modules | modules BINDING a field | occurrences | occs HOLDING a value |
|---|---|---|---|---|
| textblock | 1090 | 56 (5.1%) | 1036 | **19 (1.8%)** |
| instance *(control)* | 722 | 722 (100%) | 810 | 793 (97.9%) |

All 56 binders are the single `Daily Answer` module. On test grid 2 — the seed's own target —
**zero** textblock occurrences hold a field value.

### Probe note, recorded because it nearly became a finding

The first run of the census reported **732 of 1,036 textblocks as orphans** (listed by no parent and
embedded in no textmap). That was the documented compressed-textmap trap: raw reads store `textmap`
COMPRESSED, so walking `o.textmap` directly finds almost no embeds
(CLAUDE.md 2026-07-30 (7), 2026-08-01 (18)). With `decompressTextmap` the real figure is
**18 orphans**. Every number in this document is post-fix. *Check the probe before believing the
number.*

---

## 1. What "its own occurrence type" means here

Since nothing changes in the data, "its own type" is exactly **its own renderer and its own route**:
`modules/ModuleTextblock.jsx` joins `ModuleInstance` / `ModuleContainer` / `ModulePage` as a peer.

It answers one question — *render textblock occurrence X in context C* — where the three contexts are
measured, not invented:

| context | where it appears | poms | today's renderer |
|---|---|---|---|
| `card` | container child, board/canvas page child, `moduleEmbed` in a doc | ~51 | `ModuleInstance` + `renderBody={TextblockCard}` |
| `block` | `instanceTextblock` node in a doc body | 246 | `InstanceTextblockNode` → `DocContent` → `Editor` |
| `inline` | `instanceTextblockInline` node in a doc body | 721 | `InstanceTextblockInlineNode` (plain DOM, no editor) |

---

## 2. The three renderers have DISJOINT feature sets — the main risk

Unification is **not** "pick one and delete two". Each renderer has features the others lack:

| feature | `card` (TextblockCard) | `block` (InstanceTextblockNode) | `inline` (InstanceTextblockInlineNode) |
|---|---|---|---|
| lazy mount (IntersectionObserver) | ✅ | ❌ | n/a |
| link chip | ✅ *(own impl)* | ❌ | ✅ *(own impl)* |
| `BoundBody` field binding (Daily Answer ×56) | ❌ | ✅ | ❌ |
| `listCapRows` multi-column | ✅ | ❌ | ❌ |
| provisional-textblock lifecycle | ❌ | ✅ | ❌ |
| `embedDeleteRegistry` | — | ✅ | ✅ |
| radial menu / drag registration | via `ModuleInstance` | own | own |
| editor engine | `Editor` (TipTap) | `DocContent` → `Editor` (TipTap) | **plain DOM `textContent`** |

Two consequences that shape the whole plan:

1. **A union renderer would silently GRANT features** — e.g. field binding appearing on card
   textblocks, or a lazy placeholder on an inline chip. That violates *"works exactly the same."*
   Therefore `ModuleTextblock` takes the **context** and each context keeps its feature set
   **explicitly**; nothing inherits the union by default.
2. **The link chip is implemented twice** (`TextblockCard`'s branch and the inline node), and
   **709 of 1,036** poms textblocks are link chips. That is the single most likely regression site
   in this work.

### Where the performance problem actually is

The inline node does **not** use TipTap at all — it writes `contentRef.current.textContent`
directly. So the 721 chips are already cheap.

`TextblockCard` is the **only** renderer with lazy mounting (IntersectionObserver, 700px
`rootMargin`, click-to-live, stays-live-once-live):

| file | IntersectionObserver |
|---|---|
| `modules/TextblockCard.jsx` | ✅ |
| `modules/DocContent.jsx` | ❌ |
| `docs/pills/InstanceTextblockNode.jsx` | ❌ |
| `docs/pills/InstanceTextblockInlineNode.jsx` | ❌ |

**So the entire performance problem is 246 eager ProseMirror instances on the `block` path — and
the proven fix already exists 51 occurrences away.** That is the single most valuable thing in this
plan, and it is available before any type split lands.

---

## 3. Staging — four stages, each independently shippable and verifiable

### Stage 0 — Characterization tests (MUST come first)

*"Works exactly the same"* is unverifiable today. The three renderer components have **zero direct
test coverage**: the only inline-textblock test pins the **TipTap extension config** (node name,
attrs, `inline`/`atom` flags), never the node view.

Pin current behaviour per context **before touching anything**:

- **card** — link chip, both variants (external URL opens in a tab; in-app target calls
  `jumpToOccurrence`); lazy placeholder before intersection; live editor after; `listCapRows`
  multi-column.
- **block** — `DocContent` mounts; `BoundBody` replaces it when a body binding resolves;
  `embedDeleteRegistry` is registered and cleaned up; a provisional occurrence renders from the
  registry rather than the store.
- **inline** — chip text derives from stored text; the right arrow opens the target; radial menu
  present.

Every test A/B'd against a mutation of the thing it pins. **This stage is worth shipping on its own
merits** even if the rest is deferred.

### Stage 1 — Extract the lazy-editor seam; give it to the `block` path

*The performance win. Independent of the type split.*

- Extract `TextblockCard`'s IntersectionObserver + plain-text placeholder into a shared hook.
- `TextblockCard` consumes it — behaviour identical, pinned by Stage 0.
- `InstanceTextblockNode` consumes it — **246 eager ProseMirror instances become on-demand.**
- **Measure before/after** with the existing `loadDiag` editor-mount counter on poms grid. An
  unmeasured perf claim is not a claim.

#### Three named traps Stage 1 would otherwise walk into

**(a) A deferred block must still be typeable immediately.** 2026-08-07 records that deferring the
mint alone left a new block **un-editable for 1223 ms** — *"the original wait, moved."* So the eager
condition on the block path must include *is provisional* and *has a pending focus claim*, not just
TextblockCard's current `isInline || !hasContent`. A newly minted block must be typeable in the frame
it appears.

**(b) Caret navigation between adjacent textblocks focuses the SIBLING's inner `.ProseMirror`
directly — and fails SILENTLY if it does not exist.** `InstanceTextblockNode` walks to its
neighbour and focuses it:

```js
// :154 (forward)              and  :268 (backward)
const innerPM = editor.view.nodeDOM(nextChildStart)?.querySelector?.(".ProseMirror");
if (innerPM) { innerPM.focus(); /* place caret at start / end */ }
```

A lazily-unmounted neighbour renders a placeholder and **no `.ProseMirror`**, so `innerPM` is null,
the `if` guard swallows it, and **the caret simply stops moving between blocks** — no error, nothing
in the console. This is the highest-risk consequence of Stage 1 and it is invisible to any unit test
that does not drive real focus.

*Fix direction (decide at implementation time):* the lazy seam must expose an imperative
**"go live now, synchronously"** so a neighbour can be forced live immediately before being focused;
alternatively the block path eagerly mounts its immediate siblings. Whichever is chosen, Stage 0 must
first pin arrow/Enter navigation across a block boundary, or the regression ships unseen.

**(c) Anything that MEASURES rendered text by querying `.ProseMirror` breaks the same way — and this
has already happened once.** `WrapGroupNode` documents the exact bug at `:183`: because
TextblockCard mounts lazily, a host below the fold has thousands of characters on screen and no
`.ProseMirror` at all — measured on the Eminem page, **17 of 18 groups reported `textArea` 0 with
2,580–3,826 real characters**, which `decideWrapStack` read as *"blank host — nothing to wrap"* and
stacked. Nothing below the first screen ever wrapped, whatever the policy said. The fix was to fall
back to `.textblock-card-placeholder`.

So the block path's placeholder needs a class the measurers know about, and every consumer must be
re-checked. Current consumers of a rendered `.ProseMirror` (excluding tests):

| file | line(s) | what breaks if the target is a placeholder |
|---|---|---|
| `docs/pills/InstanceTextblockNode.jsx` | 154, 268 | caret navigation between blocks — **silent** |
| `docs/WrapGroupNode.jsx` | 193, 256 | wrap/stack decision — already fixed once for the card path |
| `modules/DocContent.jsx` | 121 | focus hand-off to a just-minted sub-editor |
| `docs/PillBackspaceExtension.js` | 24 | backspace pill behaviour |
| `ui/Editor.jsx` | 1641, 1654, 1770, 1867 | caret/pos fix-ups |
| `helpers/scrollDiag.js` | 455 | diagnostic count only (harmless, but will read low) |

### Stage 2 — `ModuleTextblock` owns the `card` context

- New `modules/ModuleTextblock.jsx`; the five card mount sites (`ModuleContainer` ×2, `PageBoard`,
  `PageCanvas`, `ModuleEmbedNode`) route `role === "textblock"` to it.
- **Recommendation: it initially COMPOSES `ModuleInstance`**, passing `renderBody` itself. Stage 2
  is then pure routing and *"exactly the same"* is true by construction; the shell is absorbed later
  once Stage 0's tests have proven themselves.
- Absorbing the shell means reproducing what the 19 `renderBody` branches decide: `floatHandle`,
  suppressed label, suppressed media, the **absolute top-right universal-fields strip**
  (2026-08-10), radial menu including convert-to-instance, drag registration, selection. Those
  branches encode real decisions; re-deriving them blind is how this regresses.

### Stage 3 — Node views delegate their body

- `InstanceTextblockNode` and `InstanceTextblockInlineNode` keep only ProseMirror concerns:
  `NodeViewWrapper`, `getPos`/`deleteNode`, `embedDeleteRegistry`, caret and selection handling.
- Their **body** becomes `<ModuleTextblock context="block" | "inline">`.
- The duplicate link-chip implementation unifies here — **the riskiest single change in the plan**,
  gated by Stage 0's chip tests on *both* paths. If the two chips turn out to differ in ways that
  cannot be reconciled without a visible change, the honest outcome is to leave the inline chip
  alone and say so, rather than to change what the user sees.

---

## 4. What deliberately stays behind

- **`ArtifactCard` still rides `ModuleInstance` + `renderBody`.** The `renderBody` machinery does
  **not** go away and `ModuleInstance` does **not** get smaller. Textblock leaving is not a
  deletion. Stated plainly so nobody expects a shrink that will not come.
- **The instance↔textblock convert feature** (`CONVERTIBLE_LEAF_ROLES`, reachable from both the
  radial and the context menu) now spans two renderers. It must keep working in both directions and
  needs its own test.
- **Inline chips are still the same role rendered a third way.** This plan unifies the renderer, not
  the concept.

---

## 5. Verification

- Every stage A/B'd against the unfixed/unrefactored source; each new test must fail exactly one
  mutation.
- **Browser verification is required.** This repo's record is that the wiring, not the unit, is
  where these break:
  - click an empty line → the block mints and is typeable in the **same frame**;
  - a long doc scrolls and its blocks go live without a flash or lost edit state;
  - a link chip opens (external and in-app);
  - `Daily Answer` still reads and writes its bound field;
  - convert instance→textblock and textblock→instance both work.
- Editor-mount count measured before and after on poms grid.
- Full suite green with **zero skips**. Baseline **re-run and verified while writing this spec**
  (2026-08-10), not inherited from a status line:

  ```
  client   160 files   2372 passed   0 failed   0 skipped
  server    49 files    666 passed   0 failed   0 skipped
  ```

  Read the failure **count**, not "roughly the same" — on 2026-08-09 (6) a fourth failure was caught
  only because the count went 3 → 4.

---

## 6. Non-goals

- No data migration, and no change to what a textblock **is**.
- No change to the field machinery, the universal-fields cascade, or `fieldReveal`.
- No attempt to make `ModuleInstance` smaller (see §4).
- Not a layout change — the layout-UI unification is its own plan and runs after this one.

---

## 6.5 RESOLVED AT IMPLEMENTATION TIME — the inline chip keeps its own renderer

§2 flagged the duplicate link-chip implementation as the riskiest single change in the plan, and
Stage 3 gated it on diffing the two before writing anything. **Diffed, and they are not
reconcilable without a visible change. The inline path is therefore left alone**, which is the
outcome the plan pre-authorized rather than a failure to finish.

| | `card` — TextblockCard's link branch | `inline` — InstanceTextblockInlineNode |
|---|---|---|
| structure | one `<a>` / `<button>` + two spans | **three zones**: `.itbi-handle` / `.itbi-content` / `.itbi-arrow` |
| styling | inline `chipStyle` object | CSS classes (`itbi--url` / `itbi--occ`) |
| text | read-only label | **contentEditable**, commits on blur / Enter, reverts on Escape |
| drag | none | Pragmatic `draggable`, handle-scoped, with the Firefox attribute disarm |
| radial menu | none | hover-mounted, additionally gated on `editor.isEditable` |
| caret | n/a | `placeCaretFromPoint` — the Firefox caret-suppression fix |
| **clicking the chip** | **opens the target** | **places a caret to edit it**; only the arrow opens |

That last row is the one that decides it. On a card the whole chip IS the link; inline, the chip is
an editable text zone and opening the target is the arrow's job. Unifying them changes what a click
does — **for 709 of poms grid's 1,036 textblocks**, the single largest behaviour surface in this
work. The constraint is *"it should work exactly the same way it does now"*, so the correct move is
to stop.

**What this costs, stated plainly:** one duplicate implementation stays. `ModuleTextblock` throws
for `context: "inline"`, so nothing can route there by accident, and the inline characterization
tests (§ Stage 0) remain the gate if anyone revisits it. What would make it tractable later is a
product decision about whether an inline chip should be editable in place at all — not a refactor.

---

## 7. Open question for implementation time

Stage 2 offers a choice the plan deliberately does not pre-decide: whether `ModuleTextblock` ever
**absorbs** the instance shell, or permanently **composes** it for the `card` context. Composing
forever is legitimate — it keeps one shell implementation for the two body-card roles
(textblock + artifact) and makes the card context trivially identical. Decide it after Stage 0's
tests exist and the real cost of the 19 branches is visible, not before.
