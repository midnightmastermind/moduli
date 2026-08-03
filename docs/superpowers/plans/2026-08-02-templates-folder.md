# Templates-as-a-Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make templates editable like any other page by turning them into ordinary pages in one protected `Templates` folder, and give the app a single create-page menu.

**Architecture:** Location becomes the only marker of "this is a template" — the `manifestType: "templates"` manifest, `meta.templateName`, and `module.meta.templateModule` all go away. Every template is a `role:"page"`, so clicking it in the Root tree opens it in a panel and all existing drag-and-drop works with no template-specific editor. `QuickAddMenu` becomes the one create-page surface for both the tree and panels.

**Tech Stack:** React 18, Vitest, Express + Socket.io, Mongoose. Client tests `npm --prefix ./client run test`; server tests `npm --prefix ./server run test`.

**Spec:** `docs/superpowers/specs/2026-08-02-template-editing-design.md`

## Global Constraints

- **`poms grid` is protected live data.** Structure changes go through `server/migrations/` + `npm run migrate:poms`. Never the seed.
- **Rehearse every migration on `test grid 2`** (`DEFAULT_GRID_NAME`) before `poms grid`. Never `test grid 1` (frozen archive).
- **No fallbacks, no legacy paths.** When a read moves to the new location, the old one is deleted, not kept as a backstop.
- **Migrations must be idempotent** — find-then-patch, never blind-append.
- **A guard throws.** Protected-resource checks raise, they don't return false (`server/utils/protectedGrids.js` precedent).
- **Verify against a real database by diffing state**, not by reading code. In-memory tests miss what the persistence layer drops.
- After any deploy, verify prod HEAD over SSH — never trust script output.

## Deploy sequencing (read before starting)

Task 2's migration moves template data; Task 3 switches the client to read the new location. **Run the migration BEFORE deploying the client.** Between the two, the old Command Center tab shows an empty list — harmless, and that tab is deleted in Task 7 anyway. Do not deploy Task 3 before the migration has run against `poms grid`.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/utils/protectedFolders.js` (new) | The one rule for "this folder cannot be deleted." |
| `server/socketHandlers/crud.js` | `setupGenericCRUD("folder", …)` delete path calls the guard. |
| `server/migrations/0035-templates-folder.mjs` (new) | Creates the folder, wraps `Day Page`, moves templates, clears markers. |
| `client/src/helpers/templateHelpers.js` | "Templates are the children of the Templates folder." Granular `templateKindOf`. |
| `client/src/ui/QuickAddMenu.jsx` | THE create-page menu: adds `page-folder`, adds create-page-from-template. |
| `client/src/modules/ManifestTree.jsx` | `+` opens `QuickAddMenu` instead of its own hardcoded item list. |
| `client/src/ui/TemplatesSection.jsx` | Apply from a page header: kind-filtered list + merge/copy mode. |
| `client/src/ui/commandCenter/TemplatesTab.jsx` | Deleted. |

---

### Task 1: Protected folders — the guard

**Files:**
- Create: `server/utils/protectedFolders.js`
- Modify: `server/socketHandlers/crud.js` (the `setupGenericCRUD` delete branch, ~line 604-620)
- Test: `server/__tests__/protectedFolders.test.js`

**Interfaces:**
- Produces: `TEMPLATES_FOLDER_NAME` (string `"Templates"`), `isProtectedFolder(folder) -> boolean`, `assertNotProtectedFolder(folder, action?) -> void (throws)`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/protectedFolders.test.js
import { describe, it, expect } from "vitest";
import {
  TEMPLATES_FOLDER_NAME, isProtectedFolder, assertNotProtectedFolder,
} from "../utils/protectedFolders.js";

describe("protected folders", () => {
  it("recognises the Templates folder by its protected flag", () => {
    expect(isProtectedFolder({ name: "Templates", meta: { protected: true } })).toBe(true);
  });

  it("does NOT protect a user folder that merely shares the name", () => {
    // Name alone must not protect — the user may legitimately have their own
    // folder called Templates somewhere else in the tree.
    expect(isProtectedFolder({ name: TEMPLATES_FOLDER_NAME })).toBe(false);
  });

  it("THROWS rather than returning false — a boolean someone forgets to check is not a guard", () => {
    expect(() => assertNotProtectedFolder({ name: "Templates", meta: { protected: true } }, "delete"))
      .toThrow(/protected/i);
  });

  it("lets an ordinary folder through", () => {
    expect(() => assertNotProtectedFolder({ name: "Notes" })).not.toThrow();
    expect(isProtectedFolder(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix ./server run test -- protectedFolders`
Expected: FAIL — `Cannot find module '../utils/protectedFolders.js'`

- [ ] **Step 3: Implement**

```js
// server/utils/protectedFolders.js
//
// THE rule for "this folder cannot be deleted". Mirrors utils/protectedGrids.js,
// including its hardest-won lesson: the check THROWS. A boolean someone forgets
// to check is not a guard.
//
// Protection is carried by `meta.protected`, NOT by the name — the user may have
// their own folder called "Templates" somewhere in the tree and it is theirs to
// delete. The migration stamps the flag on the one folder that matters.

export const TEMPLATES_FOLDER_NAME = "Templates";

export function isProtectedFolder(folder) {
  return !!folder?.meta?.protected;
}

export function assertNotProtectedFolder(folder, action = "modify") {
  if (isProtectedFolder(folder)) {
    throw new Error(
      `Refusing to ${action} protected folder "${folder.name}" (${folder.id ?? "no id"})`,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./server run test -- protectedFolders`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire the guard into the delete chokepoint**

In `server/socketHandlers/crud.js`, add the import at the top beside the other utils:

```js
import { assertNotProtectedFolder } from "../utils/protectedFolders.js";
```

Then in `setupGenericCRUD`'s `delete_${modelName}` handler, immediately after `before` is resolved and **before** `Model.findOneAndDelete`:

```js
        // Folders can be protected (the Templates folder). Throwing here lands
        // in the handler's catch, which emits server_error — the delete simply
        // does not happen.
        if (modelName === "folder") assertNotProtectedFolder(before, "delete");
```

- [ ] **Step 6: Run the full server suite**

Run: `npm --prefix ./server run test`
Expected: PASS, 371+ tests

- [ ] **Step 7: Commit**

```bash
git add server/utils/protectedFolders.js server/socketHandlers/crud.js server/__tests__/protectedFolders.test.js
git commit -m "feat(templates): protected-folder guard that throws"
```

---

### Task 2: Migration 0035 — create the folder, wrap Day Page, move templates

**Files:**
- Create: `server/migrations/0035-templates-folder.mjs`

**Interfaces:**
- Consumes: `TEMPLATES_FOLDER_NAME` from Task 1.
- Produces: a `Folder` with `meta.protected: true` under the USER manifest root; every template a `role:"page"` child of it.

**Context the implementer needs:**
- User manifest: `manifestType: "user"`; its `rootFolderId` is the destination's parent.
- The three templates today: `Schedule Template` (`E7vqHZiiJy6Z`, role page), `Day Page` (`ktMxTVErceWq`, role **container** — needs wrapping), `Project Page` (role page).
- **Wrapping is safe**: `Day Page: Build` binds `$tplId = $tpl.id` with `ktMxTVErceWq` baked in; `Schedule: Build Schedule` binds `$allItemsById.9EZL5iXnYhul`. Giving a container a parent page does not change the container's id.
- Migration contract: `export const id`, `export const describe`, `export async function up({ gridId, models, log, dryRun })`.

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0035-templates-folder.mjs
//
// Templates become "the children of one protected folder" instead of a separate
// manifest plus three hidden markers. See
// docs/superpowers/specs/2026-08-02-template-editing-design.md
//
// Day Page is a role:"container" and only role:"page" opens in a panel, so it
// gets the page wrapper Schedule Template already has. SAFE: both build ops
// resolve their template picker-direct by id (ktMxTVErceWq / 9EZL5iXnYhul), and
// wrapping does not change those ids.
import { TEMPLATES_FOLDER_NAME } from "../utils/protectedFolders.js";
import { nanoid } from "nanoid";

export const id = "0035-templates-folder";
export const describe =
  "Creates a protected Templates folder under the user manifest root, wraps container-templates in a page, " +
  "and moves every template into it. Deletes no user content; template subtrees are moved, never rebuilt.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Manifest, Folder } = models;

  const userMan = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!userMan?.rootFolderId) { log("no user manifest — nothing to do"); return; }

  // 1. The protected folder (idempotent).
  let folder = await Folder.findOne({
    gridId, parentId: userMan.rootFolderId, name: TEMPLATES_FOLDER_NAME,
  }).lean();
  if (!folder) {
    log(`creating "${TEMPLATES_FOLDER_NAME}" under user root ${userMan.rootFolderId}`);
    if (!dryRun) {
      const doc = {
        id: `tpl-folder-${gridId}`, gridId, userId: userMan.userId,
        name: TEMPLATES_FOLDER_NAME, parentId: userMan.rootFolderId,
        folderType: "normal", sortOrder: 0, meta: { protected: true },
      };
      await Folder.findOneAndUpdate({ id: doc.id }, doc, { upsert: true });
      folder = doc;
    } else {
      folder = { id: `tpl-folder-${gridId}` };
    }
  } else {
    log(`"${TEMPLATES_FOLDER_NAME}" already exists (${folder.id})`);
    if (!folder.meta?.protected && !dryRun) {
      await Folder.updateOne({ id: folder.id }, { $set: { "meta.protected": true } });
      log("  stamped meta.protected");
    }
  }

  // 2. Everything currently marked as a template, wherever it lives.
  const occs = await Occurrence.find({ gridId }).select("-textmap").lean();
  const mods = await Module.find({ gridId }).lean();
  const modById = Object.fromEntries(mods.map(m => [m.id, m]));
  const templates = occs.filter(o =>
    o.meta?.templateName || modById[o.moduleId]?.meta?.templateModule);
  log(`${templates.length} template(s) found`);

  for (const t of templates) {
    const mod = modById[t.moduleId];
    const label = t.meta?.templateName || mod?.label || "(unnamed)";
    // Only ROOTS move — a signed child inside a template subtree is not itself
    // a template, and re-parenting it would tear the subtree apart.
    const isRoot = !occs.some(o => (o.occurrences || []).includes(t.id));
    if (!isRoot) { log(`  skip "${label}" — nested inside another template`); continue; }

    if (mod?.role === "page") {
      log(`  "${label}" is already a page → move to ${folder.id}`);
      if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { parentId: folder.id } });
    } else {
      log(`  "${label}" is a ${mod?.role} → wrap in a page, then move`);
      if (!dryRun) {
        const wrapModId = `tplwrap-mod-${t.id}`;
        const wrapOccId = `tplwrap-occ-${t.id}`;
        await Module.findOneAndUpdate({ id: wrapModId }, {
          id: wrapModId, gridId, userId: t.userId, label,
          role: "page", kind: mod?.kind || "doc", fieldBindings: [], meta: {},
        }, { upsert: true });
        await Occurrence.findOneAndUpdate({ id: wrapOccId }, {
          id: wrapOccId, gridId, userId: t.userId, moduleId: wrapModId,
          parentId: folder.id, occurrences: [t.id], fields: {}, meta: {},
        }, { upsert: true });
        // The container keeps its id — that is what the build ops resolve.
        await Occurrence.updateOne({ gridId, id: t.id }, { $set: { parentId: wrapOccId } });
      }
    }

    // 3. Markers are no longer how a template is identified.
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: t.id }, { $unset: { "meta.templateName": "" } });
      if (mod) await Module.updateOne({ gridId, id: mod.id }, { $unset: { "meta.templateModule": "" } });
    }
  }

  log(dryRun ? "(dry run — no writes)" : "done");
}
```

- [ ] **Step 2: Dry-run against test grid 2 FIRST**

Run: `npm run migrate -- --grid "test grid 2" --dry-run`
Expected: names the folder it would create and each template it would move; no writes.

- [ ] **Step 3: Apply to test grid 2 and verify by diffing state**

Run: `npm run migrate -- --grid "test grid 2" --apply`
Then confirm with a throwaway probe (delete it afterwards) that: the folder exists with `meta.protected`, every template is a `role:"page"` child of it, and each wrapped container kept its original id.

- [ ] **Step 4: Re-run to prove idempotency**

Run: `npm run migrate -- --grid "test grid 2" --dry-run`
Expected: `Nothing pending` (or a no-op report).

- [ ] **Step 5: Apply to poms grid**

Run: `npm run migrate:poms -- --dry-run` then `npm run migrate:poms -- --apply`
Then restart the server: `ssh deploy@viafluere.com "cd /var/www/moduli && pm2 restart moduli"` — the warm cache is authoritative for occurrence/module/folder reads.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/0035-templates-folder.mjs
git commit -m "migrate(0035): templates move into one protected folder"
```

---

### Task 3: templateHelpers — location is the marker

**Files:**
- Modify: `client/src/helpers/templateHelpers.js`
- Test: `client/src/__tests__/templateHelpers.test.js`

**Interfaces:**
- Produces: `templatesFolderFor(lookups, gridId) -> Folder|null`, `templateKindOf(lookups, occ) -> string|null` (granular kind), `templatesByKind(lookups, gridId, kind) -> Occurrence[]`.
- Consumed by: `ui/QuickAddMenu.jsx`, `ui/TemplatesSection.jsx` (Tasks 4 and 6).

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/templateHelpers.test.js
import { describe, it, expect } from "vitest";
import { templatesFolderFor, templateKindOf, templatesByKind } from "../helpers/templateHelpers";

const lookups = {
  foldersById: {
    "tpl-f": { id: "tpl-f", gridId: "g1", name: "Templates", meta: { protected: true } },
    other:   { id: "other", gridId: "g1", name: "Notes" },
  },
  occurrencesById: {
    board: { id: "board", parentId: "tpl-f", moduleId: "m-board" },
    doc:   { id: "doc",   parentId: "tpl-f", moduleId: "m-doc" },
    loose: { id: "loose", parentId: "other", moduleId: "m-board" },
  },
  modulesById: {
    "m-board": { id: "m-board", role: "page", kind: "board", label: "Schedule Template" },
    "m-doc":   { id: "m-doc",   role: "page", kind: "doc",   label: "Day Page" },
  },
};

describe("templateHelpers", () => {
  it("finds the protected Templates folder", () => {
    expect(templatesFolderFor(lookups, "g1")?.id).toBe("tpl-f");
  });

  it("reports the GRANULAR kind, not just 'page'", () => {
    // The old templateKindOf returned role||kind, collapsing every page to
    // "page" — which cannot tell a board template from a doc one.
    expect(templateKindOf(lookups, lookups.occurrencesById.board)).toBe("board");
    expect(templateKindOf(lookups, lookups.occurrencesById.doc)).toBe("doc");
  });

  it("lists only templates of the requested kind", () => {
    expect(templatesByKind(lookups, "g1", "board").map(o => o.id)).toEqual(["board"]);
    expect(templatesByKind(lookups, "g1", "doc").map(o => o.id)).toEqual(["doc"]);
  });

  it("ignores pages outside the folder", () => {
    expect(templatesByKind(lookups, "g1", "board").map(o => o.id)).not.toContain("loose");
  });

  it("returns nothing when the folder does not exist", () => {
    expect(templatesByKind({ foldersById: {}, occurrencesById: {}, modulesById: {} }, "g1", "board")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix ./client run test -- templateHelpers`
Expected: FAIL — `templatesFolderFor is not a function`

- [ ] **Step 3: Rewrite the helper**

```js
// helpers/templateHelpers.js — templates are the children of the Templates folder.
//
// Location is the ONLY marker. There is no templates manifest, no
// meta.templateName, and no module.meta.templateModule — see
// docs/superpowers/specs/2026-08-02-template-editing-design.md

export function templatesFolderFor(lookups, gridId) {
  return Object.values(lookups?.foldersById || {})
    .find(f => f.gridId === gridId && f.meta?.protected && f.name === "Templates") || null;
}

/**
 * The GRANULAR kind — board / doc / canvas / table — so a board page is only
 * ever offered board templates. Returning `role` here would collapse every page
 * to "page" and defeat the compatibility filter.
 */
export function templateKindOf(lookups, templateOccurrence) {
  if (!templateOccurrence) return null;
  const m = lookups?.modulesById?.[templateOccurrence.moduleId];
  return m?.kind || m?.role || null;
}

export function templatesByKind(lookups, gridId, kind) {
  const folder = templatesFolderFor(lookups, gridId);
  if (!folder) return [];
  return Object.values(lookups?.occurrencesById || {})
    .filter(o => o.parentId === folder.id && templateKindOf(lookups, o) === kind);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- templateHelpers`
Expected: PASS, 5 tests

- [ ] **Step 5: Fix the now-broken consumers**

`rootFolderForTemplates` and `templatesManifestFor` no longer exist. Update the two remaining importers to use `templatesFolderFor`:
- `client/src/ui/TemplatesSection.jsx:9` and its use at line 33.
- `client/src/ui/commandCenter/TemplatesTab.jsx:4` — this file is deleted in Task 7; until then, point it at `templatesFolderFor` so the build stays green.

- [ ] **Step 6: Run the full client suite and build**

Run: `npm --prefix ./client run test && npm --prefix ./client run build`
Expected: PASS; build clean with the chunk sanity check holding (tiptap ~435 / highlight ~969 / CommandCenter ~203 / PagePreviewApp ~919).

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/templateHelpers.js client/src/__tests__/templateHelpers.test.js client/src/ui/TemplatesSection.jsx client/src/ui/commandCenter/TemplatesTab.jsx
git commit -m "refactor(templates): location is the marker; granular templateKindOf"
```

---

### Task 4: QuickAddMenu — the one create-page menu

**Files:**
- Modify: `client/src/ui/QuickAddMenu.jsx` (tile registry ~lines 46-95; `templateRows` ~line 322)
- Test: `client/src/__tests__/quickAddMenu.test.js` (existing file — add cases)

**Interfaces:**
- Consumes: `templatesByKind` from Task 3.
- Produces: tile key `page-folder`; `onCreatePageFromTemplate({ templateOccId, kind })` prop.

- [ ] **Step 1: Write the failing test**

```js
// add to client/src/__tests__/quickAddMenu.test.js
import { tileKindsForRole, tileMeta } from "../ui/QuickAddMenu";

describe("create-page menu parity", () => {
  it("offers Folder page — the tree offered it and the panel did not", () => {
    expect(tileKindsForRole("page")).toContain("page-folder");
  });

  it("labels it", () => {
    expect(tileMeta("page-folder", "page").label).toBe("Folder page");
  });

  it("still offers every other page kind", () => {
    for (const k of ["page-board", "page-doc", "page-table", "page-canvas"]) {
      expect(tileKindsForRole("page")).toContain(k);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix ./client run test -- quickAddMenu`
Expected: FAIL — `page-folder` not in the list

- [ ] **Step 3: Add the tile**

In `client/src/ui/QuickAddMenu.jsx`, beside the other `page-*` entries (~line 46):

```js
  "page-folder": { label: "Folder page", desc: "New folder page, previewed here" },
```

and include `"page-folder"` in the array `tileKindsForRole` returns for the page role, so both surfaces offer an identical list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- quickAddMenu`
Expected: PASS

- [ ] **Step 5: Make template tiles able to CREATE a page**

`templateRows` (~line 322) already lists templates for adding into a host. Add the create-a-page case: when the menu is opened with `targetRole="page"`, list `templatesByKind` for every page kind and, on pick, call the new `onCreatePageFromTemplate({ templateOccId, kind })` prop instead of the add-into-host path. Creation itself reuses `CommitHelpers.createPage` followed by `commitApplyTemplate(socket, { templateOccurrenceId, targetOccurrenceId, mode: "merge" })`.

- [ ] **Step 6: Run the full client suite**

Run: `npm --prefix ./client run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/ui/QuickAddMenu.jsx client/src/__tests__/quickAddMenu.test.js
git commit -m "feat(templates): one create-page menu, Folder page included"
```

---

### Task 5: ManifestTree `+` opens QuickAddMenu

**Files:**
- Modify: `client/src/modules/ManifestTree.jsx` (the `RadialMenu` at ~line 1188-1197; `handleCreatePage` at ~line 1078)

- [ ] **Step 1: Replace the hardcoded item list**

Delete the five hardcoded `{ label: "Board page", … }` entries and mount a `QuickAddMenu` with `targetRole="page"`, opened imperatively from the `+` via `openTrigger` (the same pattern `ModulePanel` already uses for "Add page…"). Keep `handleCreatePage(kind)` — it stays the commit path; only the menu that calls it changes.

- [ ] **Step 2: Verify both surfaces now offer the same list**

Run the app (`npm run dev`), open the tree `+` and a panel's "Add page…". Both must list Board / Doc / Canvas / Table / **Folder**, plus every template.

- [ ] **Step 3: Run the full client suite and build**

Run: `npm --prefix ./client run test && npm --prefix ./client run build`
Expected: PASS; build clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/ManifestTree.jsx
git commit -m "refactor(templates): the tree's + uses the shared create menu"
```

---

### Task 6: TemplatesSection — kind filter and apply mode

**Files:**
- Modify: `client/src/ui/TemplatesSection.jsx`
- Test: `client/src/__tests__/templatesSection.test.jsx` (new)

**Interfaces:**
- Consumes: `templatesByKind`, `templateKindOf` from Task 3; `commitApplyTemplate` from `helpers/CommitHelpers`.

- [ ] **Step 1: Write the failing test**

Test the two DECISIONS as pure functions rather than through the DOM — the
filtering rule and the default mode are the logic worth pinning, and a render
test of a dropdown is slow and brittle by comparison.

```js
// client/src/__tests__/templatesSection.test.js
import { describe, it, expect } from "vitest";
import { applicableTemplates, DEFAULT_APPLY_MODE } from "../ui/TemplatesSection";

const lookups = {
  foldersById: { "tpl-f": { id: "tpl-f", gridId: "g1", name: "Templates", meta: { protected: true } } },
  occurrencesById: {
    boardTpl: { id: "boardTpl", parentId: "tpl-f", moduleId: "m-board" },
    docTpl:   { id: "docTpl",   parentId: "tpl-f", moduleId: "m-doc" },
  },
  modulesById: {
    "m-board": { id: "m-board", role: "page", kind: "board", label: "Schedule Template" },
    "m-doc":   { id: "m-doc",   role: "page", kind: "doc",   label: "Day Page" },
    "m-host":  { id: "m-host",  role: "page", kind: "board", label: "Some Board" },
  },
};
const boardHost = { id: "host", moduleId: "m-host" };

describe("which templates a page is offered", () => {
  it("offers a board template to a board page", () => {
    expect(applicableTemplates(lookups, "g1", boardHost).map(t => t.id)).toEqual(["boardTpl"]);
  });

  it("does NOT offer a doc template to a board page", () => {
    // Dropping a textmap body into a container list has no sensible meaning, so
    // it is not offered at all rather than offered and then failing.
    expect(applicableTemplates(lookups, "g1", boardHost).map(t => t.id)).not.toContain("docTpl");
  });

  it("offers nothing when the host has no resolvable kind", () => {
    expect(applicableTemplates(lookups, "g1", { id: "x", moduleId: "nope" })).toEqual([]);
  });

  it("defaults to merge — structure flows, the user's content is untouched", () => {
    expect(DEFAULT_APPLY_MODE).toBe("merge");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix ./client run test -- templatesSection`
Expected: FAIL

- [ ] **Step 3: Implement**

Export the two decisions, then use them in the component:

```js
// client/src/ui/TemplatesSection.jsx
import { templatesByKind, templateKindOf, templatesFolderFor } from "../helpers/templateHelpers";

// Merge, not copy: structure flows from the template while the page keeps
// everything the user wrote. Copy is the deliberate "stamp it once" choice.
export const DEFAULT_APPLY_MODE = "merge";

/** Only templates whose kind matches the host — see the spec's Compatibility section. */
export function applicableTemplates(lookups, gridId, hostOccurrence) {
  const kind = templateKindOf(lookups, hostOccurrence);
  if (!kind) return [];
  return templatesByKind(lookups, gridId, kind);
}
```

In the component, replace the current `templatesByKind(lookups, gridId, myKind)` memo with
`applicableTemplates(lookups, gridId, occurrence)`, and add a two-option Merge/Copy control whose
value is passed straight through as `mode` to `commitApplyTemplate`, initialised to
`DEFAULT_APPLY_MODE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- templatesSection`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/TemplatesSection.jsx client/src/__tests__/templatesSection.test.jsx
git commit -m "feat(templates): kind-filtered apply with merge/copy"
```

---

### Task 7: Getting templates IN — both paths COPY

**Files:**
- Modify: `client/src/modules/ManifestTree.jsx` (the `FolderNode` drop target — today it re-parents)
- Modify: `client/src/ui/TemplatesSection.jsx` (add "Save as template")
- Test: `client/src/__tests__/templateIntake.test.js` (new)

**Interfaces:**
- Consumes: `templatesFolderFor` (Task 3), `commitCloneSubtreeAsTemplate` from `helpers/CommitHelpers`.

**Why this is its own task:** the tree's folder drop currently **moves** (`updateOccurrence({ parentId })`). Dropping onto the Templates folder must instead **copy**, or dragging your real Schedule page in would move it out of Interfaces and break the app. This is a behaviour change to an existing drop path, so it gets its own review gate.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/templateIntake.test.js
import { describe, it, expect, vi } from "vitest";
import { resolveFolderDrop } from "../modules/ManifestTree";

const templatesFolder = { id: "tpl-f", name: "Templates", meta: { protected: true } };
const notesFolder = { id: "notes-f", name: "Notes" };

describe("dropping a page onto a folder", () => {
  it("COPIES into the Templates folder — never moves the original", () => {
    expect(resolveFolderDrop({ folder: templatesFolder })).toBe("copy");
  });

  it("still MOVES into an ordinary folder", () => {
    expect(resolveFolderDrop({ folder: notesFolder })).toBe("move");
  });

  it("treats a missing folder as a move (existing behaviour unchanged)", () => {
    expect(resolveFolderDrop({ folder: null })).toBe("move");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix ./client run test -- templateIntake`
Expected: FAIL — `resolveFolderDrop is not a function`

- [ ] **Step 3: Implement the decision as a pure export**

In `client/src/modules/ManifestTree.jsx`, add near the top:

```js
/**
 * Dropping onto the protected Templates folder COPIES; every other folder
 * MOVES, as it always has. Without this, dragging the real Schedule page in to
 * "make a template of it" would move it out of Interfaces and break the app.
 */
export function resolveFolderDrop({ folder }) {
  return folder?.meta?.protected ? "copy" : "move";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- templateIntake`
Expected: PASS, 3 tests

- [ ] **Step 5: Use it in the drop handler**

In `FolderNode`'s drop handler, branch on `resolveFolderDrop({ folder })`. The `move` branch keeps today's `CommitHelpers.updateOccurrence({ id, parentId: folder.id })`. The `copy` branch calls instead:

```js
      CommitHelpers.commitCloneSubtreeAsTemplate(socket, {
        sourceOccurrenceId: draggedOccId,
        name: draggedLabel,
        parentFolderId: folder.id,
      });
```

- [ ] **Step 6: Add "Save as template" to the page header**

In `client/src/ui/TemplatesSection.jsx`, add a button that runs the same call against the host occurrence, targeting `templatesFolderFor(lookups, gridId).id`. It is the identical operation from the other direction — the page stays exactly where it is.

- [ ] **Step 7: Run the full client suite and build**

Run: `npm --prefix ./client run test && npm --prefix ./client run build`
Expected: PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/modules/ManifestTree.jsx client/src/ui/TemplatesSection.jsx client/src/__tests__/templateIntake.test.js
git commit -m "feat(templates): drag-in and save-as-template both copy"
```

---

### Task 8: Delete the Command Center tab

**Files:**
- Delete: `client/src/ui/commandCenter/TemplatesTab.jsx`
- Modify: `client/src/ui/CommandCenter.jsx` (remove the tab registration and import)

**Do this only after Tasks 4-7 are merged** — it removes the current apply surface, and the replacements must already exist.

- [ ] **Step 1: Delete and unregister**

```bash
git rm client/src/ui/commandCenter/TemplatesTab.jsx
```

Then remove its import and tab entry from `client/src/ui/CommandCenter.jsx`.

- [ ] **Step 2: Confirm nothing still references it**

Run: `grep -rn "TemplatesTab" client/src`
Expected: no output.

- [ ] **Step 3: Run the full client suite and build**

Run: `npm --prefix ./client run test && npm --prefix ./client run build`
Expected: PASS; build clean, CommandCenter chunk slightly smaller.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(templates): delete the Command Center tab; the tree is the surface"
```

---

### Task 9: End-to-end verification

**Files:** none committed — a throwaway probe, deleted afterwards.

- [ ] **Step 1: Verify on test grid 2, by diffing state**

Against a real database, confirm each of these and record the before/after:
1. **The original ask:** click a template in the Root tree → it opens in a panel as a page, and you
   can **drag an occurrence into it, use the `+` menu, and use an insert-gap.** This is the whole
   point of the change; if this does not work, nothing else matters.
2. The Templates folder cannot be deleted (server refuses; `server_error` emitted).
3. Dragging a page onto the Templates folder COPIES it — the original is still in its old folder
   afterwards.
4. A page copied into the folder appears in the create menu and in a matching page's apply list.
3. **Merge preserves content:** add a section to a template, apply to a page that has writing in it → the section arrives and the writing is byte-identical.
4. **Copy detaches:** apply with copy, then edit the template → the page does not change.
5. **Compatibility:** a board page's list contains no doc template.
6. Both create menus offer an identical list of kinds, Folder included.

- [ ] **Step 2: Confirm the builds still work**

The morning after deploying, confirm the Day Page and Schedule columns still build. Assert the pipelines still reference `ktMxTVErceWq` and `9EZL5iXnYhul`.

- [ ] **Step 3: Deploy and verify prod HEAD**

```bash
bash ./deploy.sh "deploy: templates as a folder"
ssh deploy@viafluere.com "cd /var/www/moduli && git log --oneline -1"
```

Confirm the served asset hashes changed and the prod HEAD matches local.

- [ ] **Step 4: Update the session log**

Add an entry to `CLAUDE.md` recording the design, the migration, and the two facts worth keeping: templates are identified by location, and both build ops bind picker-direct by id (which is why wrapping was safe).

```bash
git add CLAUDE.md && git commit -m "docs: record the templates-as-a-folder change"
```
