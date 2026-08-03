# Templates: a folder, not a subsystem

_2026-08-02. Design agreed with the user in conversation; supersedes the Command Center
Templates tab as the editing surface._

## The problem

> "we need a plan to really revamp templates. idk how we can drag and drop in the template
> section" … "we need a good way to edit them thats not in the command center cause thats really
> hard to just add stuff there"

`ui/commandCenter/TemplatesTab.jsx` is 182 lines of **list-and-apply**. It has no editing, no
drag-and-drop, and no way to add anything. So the only way to change a template today is to edit
the live data by hand or write a migration.

Underneath that, templates carry three hidden markers and live in their own manifest:

| marker | set on | read by |
| --- | --- | --- |
| `manifestType: "templates"` | a whole Manifest | `templateHelpers.templatesManifestFor` |
| `meta.templateName` | the template occurrence | `templateHelpers.templatesByKind` |
| `module.meta.templateModule` | the template's module | `apply_template` (stripped from clones) |

That produced two folders both literally named **"Templates"** — one `folderType: "normal"` under
Library holding `Schedule Template`, one `folderType: "templates"` at the root of the templates
manifest holding `Day Page`. Migration `0034` unified their *location*; this design removes the
reason they were ever separate.

## The rule

> **A template is a page in the `Templates` folder. What you are templating is what's inside it.**

Location is the only marker. No `templateName`, no `templateModule`, no separate manifest.

This is not a new idea in the data — `Schedule Template` is **already** a `role:"page"` whose child
is the `Day` container holding all 50 slots. `Day Page` is the inconsistent one: a bare
`role:"container"` with no wrapper. The migration makes it match.

Both build operations already apply **contents, not wrapper**, so nothing about what gets built
changes:

```
Day Page: Build           APPLY_TEMPLATE … "unwrapRoot": true
Schedule: Build Schedule  loops $dayCont.occurrences, applies each child
```

### Why wrapping `Day Page` is safe

Verified against the live pipelines before this was written, because getting it wrong breaks the
morning build:

- `Day Page: Build` binds its template **picker-direct** — `INIT_VAR $tplId = $tpl.id`, with the
  occurrence id `ktMxTVErceWq` baked into the pipeline. It never references `templateName`.
- `Schedule: Build Schedule` binds `INIT_VAR $dayCont = $allItemsById.9EZL5iXnYhul` — the Day
  container, by id.

Giving a container a parent page does not change the container's id, so both ops resolve exactly
what they resolve today.

## What the user does

**Edit** — click the template in the Root tree. It opens in a panel as an ordinary page. Every
existing affordance (drag-and-drop, the `+` menu, insert-gaps, radial menus) works because it *is*
an ordinary page. There is no template-specific editor, so there is nothing to keep in sync.

**Apply** — two entry points, both where you would reach for them:

- **In the create menu itself**, not as a separate step after it. Creating a page already offers
  Board / Doc / Canvas / Table; the templates in the folder are listed alongside those as further
  ways to start. Picking one creates a page of *that template's* kind with its contents merged in.

  **There must be ONE create-page menu**, not the template list bolted onto two. Today there are
  two independent implementations, and they have already drifted:

  | surface | source | offers |
  | --- | --- | --- |
  | `ManifestTree` `+` | `RadialMenu`, hardcoded items array | Board, Doc, Canvas, Table, **Folder** |
  | `ModulePanel` "Add page…" | `QuickAddMenu` tile registry (`page-*` keys) | Board, Doc, Table, Canvas — **no Folder** |

  Adding templates to both would double a divergence that already exists. `QuickAddMenu` becomes
  the single surface: it already owns the tile registry (`tileKindsForRole`), search, and imperative
  opening (`openTrigger`, used by ModulePanel and ModulePage today). `ManifestTree`'s `+` opens it
  instead of its own item list, and `page-folder` joins the registry so the drift closes rather than
  being preserved.
- **An existing page's header menu** → `ui/TemplatesSection.jsx`, which already lives there and
  only needs its list retargeted at the folder and filtered by kind.

**Add a template** — either drag an existing page into the folder, or "Save as template" from a
page's header menu. **Both COPY**, and they are the same operation from two directions; the
original stays exactly where it is. (User's call: dragging must not be able to move the real
Schedule page into Templates by accident.)

## Apply modes

| mode | structure | the user's content | use |
| --- | --- | --- | --- |
| **Merge** (default) | keeps getting topped up from the template | untouched | Day Page, Schedule |
| **Copy** | stamped once, then independent | independent | one-off starting points |
| **Copy-link** | shared | **shared** | *not a template mode* — see below |

Merge is `APPLY_TEMPLATE mode:"merge"`, matching by `identitySignature`. Since the auto-signing
change (`auto:<tplOccId>` fallback), a section added to a template through the UI merges correctly
with no signature written by hand — **the user never encounters the concept**.

Merge is additive: adding to a template tops up pages built from it; removing from a template never
removes from a page already built. Confirmed with the user as the desired behaviour.

**Copy-link is deliberately not a template mode.** `server/socketHandlers/occurrences.js:317` fans
`fields` and `textmap` out to every occurrence sharing a `linkedGroupId`, so copy-linking day
content would make every day show the same journal entry. It remains a per-*item* choice for things
genuinely meant to be shared — e.g. the Todo container that is one occurrence parented into both
the Schedule and the Day Page, so ticking it in either place is the same write.

## Compatibility — only offer templates that fit

> "only have like pages appliable. if i have a board page, it be hard to add doc page template
> to it"

A template is applicable to a target only when **their kinds match** — board→board, doc→doc,
canvas→canvas, table→table. The apply picker filters to those; the rest are not offered at all,
rather than offered and then failing.

This follows directly from applying contents-not-wrapper: a board page's children are containers,
a doc page's body is a textmap of embeds. Dropping one into the other has no sensible meaning.

It is also consistent with what already works — the `Day Page` template is `kind: "doc"` and the
day column it merges into is `kind: "doc"`; `Schedule Template` is `kind: "board"` and the Schedule
page is a board.

`templateHelpers.templatesByKind(lookups, gridId, kindOrRole)` is already this function. One fix is
needed: `templateKindOf` currently returns `m?.role || m?.kind`, which collapses every page to
`"page"` and cannot tell a board template from a doc one. It must return the **kind** for pages and
containers, so the filter is granular enough to honour this rule.

## Components

| unit | responsibility |
| --- | --- |
| `helpers/templateHelpers.js` | rewritten: "templates are the children of the Templates folder". Drops `templatesManifestFor`, the `meta.templateName` filter, and the manifest walk. `templateKindOf` returns the granular **kind** so the compatibility filter works. |
| `utils/protectedFolders.js` (new, server) | the one rule for "this folder cannot be deleted". `assertNotProtectedFolder` THROWS, mirroring `utils/protectedGrids.js`. |
| `ui/TemplatesSection.jsx` | keeps its job (apply / save-over); its list source changes and it gains the mode choice. |
| `ui/commandCenter/TemplatesTab.jsx` | **deleted.** The tree is the surface. |
| `ui/QuickAddMenu.jsx` | THE create-page menu. Gains `page-folder` (closing the existing drift) and lists the folder's templates alongside the blank kinds; a template entry creates a page of that template's kind with its contents merged in. |
| `modules/ManifestTree.jsx` | its `+` opens `QuickAddMenu` instead of a hardcoded `RadialMenu` item list. `handleCreatePage` stays as the commit path. |
| `modules/ModulePanel.jsx` | unchanged in shape — it already opens `QuickAddMenu`; it inherits templates for free. |
| `migrations/0035-templates-folder.mjs` | creates the protected folder, wraps `Day Page` in a page, moves the three templates in, retires the templates manifest, clears the now-unused markers. (`0034` is applied; `0035` is next.) |

## Guardrails

The folder must be undeletable, enforced **server-side**. `utils/protectedGrids.js` earned this
lesson already — *"a boolean someone forgets to check is not a guard"* — so the folder check throws
rather than returning false, and every delete path calls it. The client additionally hides the
delete affordance, but the server is the guarantee.

## Testing

- The protected folder cannot be deleted — asserted against a **mocked** model, per the 2026-07-28
  lesson that a test guarding live data must not be able to destroy it.
- A page copied into the folder is offered by the apply picker.
- **Merge preserves content**: apply a template that has gained a section to a page with writing in
  it → the section arrives, the writing is byte-identical.
- **Compatibility filter**: a board page is offered only board templates; a doc template does not
  appear in its picker at all.
- **Create-from-template** produces a page of the template's kind with its contents — asserted from
  the tree's `+` and the panel's "Add page…", which must now be the SAME menu.
- **No drift**: both surfaces offer an identical list of page kinds, Folder included.
- **"Save as template" copies**: the source page still exists in its original folder afterwards.
- **Copy detaches**: applying with copy then editing the template changes nothing on the page.
- Wrapping `Day Page` leaves both builds resolving the same ids — assert the pipelines still
  reference `ktMxTVErceWq` and `9EZL5iXnYhul`.
- End-to-end against a real database on **test grid 2**, never poms grid, diffing state before and
  after — the 2026-08-01 lesson that in-memory tests miss what the persistence layer drops.

## Out of scope

- Choosing which page a template builds into, or whether it auto-applies on a new day. That is
  hardcoded in the Build ops and is its own piece of work.
- Template versioning or history.
- Any change to what the Schedule or Day Page actually build. This design changes where templates
  live and how they are edited, and nothing about the output.

## Risks

- **Wrapping `Day Page`** is the one structural change to live data. Mitigated by both ops binding
  by id (verified above), a dry run, and the runner's automatic pre-migration snapshot.
- **Deleting `TemplatesTab`** removes the only current apply surface; the tree + header menu must
  land in the same change, not after it.
