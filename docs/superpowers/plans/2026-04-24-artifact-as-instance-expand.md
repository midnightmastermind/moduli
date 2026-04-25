# Artifact + Textblock as First-Class Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote artifacts and textblocks to first-class module **roles** (not instances), each droppable into board containers like instances, each with a type-specific renderer (artifacts: image/video/audio/pdf/markdown thumbnails with click-to-expand; textblocks: inline rich-text editor). Uploads appear at the drop location instantly, with no rebuild required.

**Architecture:**
- Module roles become `{ panel, container, instance, page, artifact, textblock }`. For artifact modules, `kind` carries the subtype (`image | video | audio | pdf | markdown`) — `meta.artifactType` is retired. Schema is unconstrained on `role` / `kind`, so this is a value-only change.
- Container children are now any "leaf-placeable" module: instance, artifact, or textblock. `getContainerItemsWithOccurrences` resolves child modules from a merged `leafModulesById` lookup; `ModuleContainer` routes each child by role to `<ModuleInstance>` / `<ArtifactCard>` / `<TextblockCard>`.
- `handleFileDrop` (OS file → container) dispatches the new module + occurrence into local state synchronously from the upload response, eliminating the blank-spot delay caused by waiting for socket broadcasts.
- A single migration script flips existing `role: "instance", kind: "artifact"` modules to `role: "artifact", kind: <inferred>`. No fallback shims (per project convention — `feedback_no_fallbacks`).

**Tech Stack:** React 18, TipTap v3, Mongoose 7, Express, Socket.io, lucide-react, existing CommitHelpers / state action creators / dropHandlers, CSS in `client/src/index.css`.

---

## File Structure

| File | Role |
|------|------|
| `server/server.js` | `mimeToViewType` returns `kind` (image/video/audio/pdf/markdown) instead of `{viewType, artifactType}`. `/api/artifacts/upload` creates a module with `role: "artifact"` and that `kind`. |
| `server/scripts/migrateArtifactRole.js` (NEW) | One-shot script: any module with `role:"instance" && kind:"artifact"` is rewritten to `role:"artifact"`, with `kind` set from `meta.artifactType` (or extension as fallback within the script itself), `meta.artifactType` deleted. |
| `client/src/state/masterReducer.js` | `deriveRoleArrays` adds `artifacts` and `textblocks` buckets. |
| `client/src/state/initialState.js` | `artifacts: []`, `textblocks: []`. |
| `client/src/App.jsx` | Build `artifactsById`, `textblocksById`, and a merged `leafModulesById = {...instancesById, ...artifactsById, ...textblocksById}` memo. Pass through context. |
| `client/src/GridActionsContext.js` | Add `artifactsById`, `textblocksById`, `leafModulesById` defaults. |
| `client/src/state/selectors.js` | `createLookupsFromState` populates `artifactsById` and `textblocksById` buckets. `computeRoleByModuleId` understands the two new roles. |
| `client/src/helpers/LayoutHelpers.js` | `getContainerItemsWithOccurrences(container, occurrencesLookup, leafModulesLookup, ...)` — second-to-last arg renamed/used as the merged leaf map. Internal lookups unchanged otherwise. |
| `client/src/helpers/dropHandlers.js` | `handleModuleDrop` accepts `role: "artifact"` and `role: "textblock"` for container drops. `handleFileDrop` dispatches `createModuleAction` + `createOccurrenceAction` from upload response. |
| `client/src/modules/ArtifactCard.jsx` (NEW) | Renderer for artifact modules in containers. Thumbnail + expanded modes. Click to expand; X to collapse. Video: `<video controls autoPlay>`. |
| `client/src/modules/TextblockCard.jsx` (NEW) | Renderer for textblock modules in containers. Wraps the existing `<Editor>` (TipTap) on `occurrence.textmap` with debounced save via `CommitHelpers.updateOccurrence`. |
| `client/src/modules/ModuleContainer.jsx` | Child render loop routes by `module.role`. The artifact/textblock cards still get drag handles + radial menu via the existing wrapper. |
| `client/src/modules/ModuleInstance.jsx` | Remove the inline `instance.fileRef` `<img>/<video>/🎵` block (replaced by `ArtifactCard` for artifact modules; instances no longer render fileRef). |
| `client/src/ui/commandCenter/FilesTab.jsx` | `ArtifactPill` sets `role: "artifact"` in its draggable payload. `artifacts` filter uses `m.role === "artifact"` instead of `m.fileRef != null`. |
| `client/src/ui/QuickAddMenu.jsx` | Adds an "Add textblock" item when invoked from a board container's `+` button. |
| `client/src/modules/ModuleContainer.jsx` (QuickAdd usage) | Wires the new "Add textblock" callback → creates a `role:"textblock", kind:"doc"` module + occurrence + appends to container. |
| `client/src/index.css` | Adds `.artifact-card`, `.artifact-card--expanded`, `.artifact-thumb`, `.artifact-expand-close`, `.textblock-card` rules. |
| `client/src/modules/CLAUDE.md`, `client/src/helpers/CLAUDE.md`, `client/src/state/CLAUDE.md`, `server/CLAUDE.md` | Append "Recent Changes (Apr 24 2026 — Artifact + Textblock Roles)" entries. |

---

## Task 1: Server — `kind`-based artifact upload + migration

**Files:**
- Modify: `server/server.js`
- Create: `server/scripts/migrateArtifactRole.js`

- [ ] **Step 1: Update `mimeToViewType` to return `kind`**

In `server/server.js` around lines 317–326, replace:

```js
const CODE_EXTENSIONS = new Set([...]);

function mimeToViewType(mime, filename) {
  if (mime?.startsWith("image/")) return { viewType: "display", artifactType: "image" };
  if (mime?.startsWith("video/")) return { viewType: "display", artifactType: "video" };
  if (mime?.startsWith("audio/")) return { viewType: "display", artifactType: "audio" };
  if (mime === "application/pdf") return { viewType: "display", artifactType: "pdf" };
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}
```

with:

```js
function mimeToKind(mime, filename) {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  // Code files and plain text get rendered as markdown — same TipTap editor.
  return "markdown";
}
```

- [ ] **Step 2: Update the upload handler to use the new role + kind**

In the `app.post("/api/artifacts/upload", ...)` handler (around line 328), find:

```js
const { viewType, artifactType } = mimeToViewType(req.file.mimetype, req.file.originalname);
...
const mod = new Module({
  id: moduleId, userId, gridId: gridId || null,
  role: "instance",
  kind: "artifact",
  label: req.file.originalname,
  fileRef,
  defaultDragMode: "copy",
  meta: { mimeType: req.file.mimetype, viewType, artifactType, originalName: req.file.originalname, folderId: parentFolderId || null }
});
const artifactViewId = nanoid();
const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
await artifactView.save();
const occ = new Occurrence({
  id: occurrenceId, userId, gridId: gridId || null,
  targetId: moduleId, targetType: "module",
  parentId: parentFolderId || null,
  viewId: artifactViewId,
  textmap: viewType === "markdown" ? { type: "doc", content: [] } : null
});
```

Replace with:

```js
const kind = mimeToKind(req.file.mimetype, req.file.originalname);
const mod = new Module({
  id: moduleId, userId, gridId: gridId || null,
  role: "artifact",
  kind,
  label: req.file.originalname,
  fileRef,
  defaultDragMode: "copy",
  meta: { mimeType: req.file.mimetype, originalName: req.file.originalname, folderId: parentFolderId || null }
});
const occ = new Occurrence({
  id: occurrenceId, userId, gridId: gridId || null,
  targetId: moduleId, targetType: "module",
  parentId: parentFolderId || null,
  textmap: kind === "markdown" ? { type: "doc", content: [] } : null
});
```

The `View` record is no longer created on upload — artifacts render via their `kind` directly inside whatever container they land in. (Existing artifact panels with views still work because `ArtifactContent` still resolves through occurrence.viewId; we are only changing the *upload-time* default.)

Apply the same `mimeToKind` swap to the legacy `/api/upload` handler (around line 374) and the connection-import handler (around line 447), wherever `mimeToViewType` is called. Where they currently set `role: "instance", kind: "artifact"`, replace with `role: "artifact", kind`.

- [ ] **Step 3: Search for stale references**

Run, from the repo root:

```bash
grep -rn "mimeToViewType\|kind: *\"artifact\"\|kind: *'artifact'\|artifactType" server/ --include='*.js'
```

Expected: only `mimeToKind` references remain in `server/server.js` after edits. Any other hit (e.g. in `createDefaultUserData.js` if it seeds artifacts) must be updated to the new shape.

- [ ] **Step 4: Write the migration script**

Create `server/scripts/migrateArtifactRole.js`:

```js
// Migrate role:"instance" + kind:"artifact" modules to role:"artifact" with kind from meta.artifactType.
// Run once: `node server/scripts/migrateArtifactRole.js`
import mongoose from "mongoose";
import Module from "../models/Module.js";

const MONGO = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/moduli";

function inferKindFromFileRef(fileRef = "") {
  const ext = fileRef.split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) return "image";
  if (["mp4","webm","mov"].includes(ext)) return "video";
  if (["mp3","wav","ogg","m4a"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "markdown";
}

async function main() {
  await mongoose.connect(MONGO);
  const targets = await Module.find({ role: "instance", kind: "artifact" });
  console.log(`Found ${targets.length} artifact modules to migrate`);
  for (const m of targets) {
    const kind = m.meta?.artifactType || inferKindFromFileRef(m.fileRef);
    const nextMeta = { ...(m.meta || {}) };
    delete nextMeta.artifactType;
    delete nextMeta.viewType;
    m.role = "artifact";
    m.kind = kind;
    m.meta = nextMeta;
    await m.save();
    console.log(`  ${m.id} → role=artifact, kind=${kind}`);
  }
  await mongoose.disconnect();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the migration on the dev DB**

```bash
node server/scripts/migrateArtifactRole.js
```

Expected output: `Found N artifact modules to migrate` followed by per-id lines, then `done`. Verify in mongo:

```bash
mongo moduli --eval 'db.modules.find({role:"artifact"}).count()'
```

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/scripts/migrateArtifactRole.js
git commit -m "feat(artifacts): role=artifact with kind=image|video|audio|pdf|markdown"
```

---

## Task 2: Client state — derive `artifacts` + `textblocks` arrays

**Files:**
- Modify: `client/src/state/masterReducer.js`
- Modify: `client/src/state/initialState.js`
- Modify: `client/src/state/selectors.js`

- [ ] **Step 1: Update `deriveRoleArrays` (masterReducer.js, lines 19–29)**

Replace:

```js
function deriveRoleArrays(modules = []) {
  const panels = [], containers = [], instances = [], pages = [];
  for (const m of modules) {
    if (m.trashed) continue;
    if (m.role === "panel") panels.push(m);
    else if (m.role === "page") pages.push(m);
    else if (m.role === "container") containers.push(m);
    else if (m.role === "instance") instances.push(m);
  }
  return { panels, containers, instances, pages };
}
```

With:

```js
function deriveRoleArrays(modules = []) {
  const panels = [], containers = [], instances = [], pages = [], artifacts = [], textblocks = [];
  for (const m of modules) {
    if (m.trashed) continue;
    if (m.role === "panel") panels.push(m);
    else if (m.role === "page") pages.push(m);
    else if (m.role === "container") containers.push(m);
    else if (m.role === "instance") instances.push(m);
    else if (m.role === "artifact") artifacts.push(m);
    else if (m.role === "textblock") textblocks.push(m);
  }
  return { panels, containers, instances, pages, artifacts, textblocks };
}
```

- [ ] **Step 2: Add `artifacts: []` and `textblocks: []` to LOGOUT and FULL_STATE clears**

In `masterReducer.js`, search for any object literal that currently contains `instances: []` and add `artifacts: [], textblocks: []` next to it. Specifically:

- Line ~76–78 (FULL_STATE return) — append two more keys.
- Line ~117–118 (LOGOUT clear) — append two more keys.
- Line ~200–211 area — same.

The exact `instances:` lines are at 78, 118, 200; add the two new keys to each.

- [ ] **Step 3: Update `initialState.js`**

In `client/src/state/initialState.js`, find:

```js
instances: [],
```

and update the surrounding state object to also include:

```js
artifacts: [],
textblocks: [],
```

- [ ] **Step 4: Update `selectors.js`**

In `createLookupsFromState`, locate the loop that bins modules into role buckets (around line 80 — currently does `state.instances.forEach(...)`). Add equivalent buckets for `artifacts` and `textblocks`:

```js
const artifactsById = {};
(state.artifacts || []).forEach(a => { if (a.id && !artifactsById[a.id]) artifactsById[a.id] = a; });
const textblocksById = {};
(state.textblocks || []).forEach(t => { if (t.id && !textblocksById[t.id]) textblocksById[t.id] = t; });
```

Update the function's return value to include `artifactsById, textblocksById`.

In `computeRoleByModuleId` fallback loop (around line 91), add:

```js
else if (mod.role === "artifact" || mod.role === "textblock") roleMap[mod.id] = mod.role;
```

- [ ] **Step 5: Commit**

```bash
git add client/src/state/masterReducer.js client/src/state/initialState.js client/src/state/selectors.js
git commit -m "feat(state): derive artifacts + textblocks role arrays"
```

---

## Task 3: Client — expose `leafModulesById` through context

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/GridActionsContext.js`

- [ ] **Step 1: Build the merged lookups in App.jsx**

In `client/src/App.jsx`, find the existing `instancesById` memo (lines 100–103) and add right after it:

```js
const artifactsById = useMemo(
  () => buildLookup(state.artifacts),
  [state.artifacts]
);

const textblocksById = useMemo(
  () => buildLookup(state.textblocks),
  [state.textblocks]
);

// Merged leaf-placeable lookup — anything that can live as a child of a container.
const leafModulesById = useMemo(
  () => ({ ...instancesById, ...artifactsById, ...textblocksById }),
  [instancesById, artifactsById, textblocksById]
);
```

- [ ] **Step 2: Pass them through `actionsValue`**

Locate the `actionsValue = useMemo(() => ({...}), [...])` block in App.jsx and:
1. Add `artifactsById, textblocksById, leafModulesById` to the returned object.
2. Add the three to the dependency array.

- [ ] **Step 3: Add defaults to `GridActionsContext.js`**

In `client/src/GridActionsContext.js`, add to the default-values object:

```js
artifactsById: Object.create(null),
textblocksById: Object.create(null),
leafModulesById: Object.create(null),
```

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx client/src/GridActionsContext.js
git commit -m "feat(state): expose artifactsById/textblocksById/leafModulesById via context"
```

---

## Task 4: LayoutHelpers — resolve container children from leaf modules, not just instances

**Files:**
- Modify: `client/src/helpers/LayoutHelpers.js`

- [ ] **Step 1: Update `getContainerItemsWithOccurrences`**

In `client/src/helpers/LayoutHelpers.js`, the function at line 71 currently looks up children in `instancesLookup`. Rename the parameter to make intent clear and pass `leafModulesLookup` from callers.

Replace:

```js
export function getContainerItemsWithOccurrences(container, occurrencesLookup, instancesLookup, currentFilterValue, containerOccurrence) {
  const ids = resolveChildOccurrenceIds(containerOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      const instance = getItemById(occ.targetId, instancesLookup);
      if (!instance) return null;
      return { instance, occurrence: occ };
    })
    .filter(Boolean);
}
```

With:

```js
export function getContainerItemsWithOccurrences(container, occurrencesLookup, leafModulesLookup, currentFilterValue, containerOccurrence) {
  const ids = resolveChildOccurrenceIds(containerOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      const module = getItemById(occ.targetId, leafModulesLookup);
      if (!module) return null;
      return { module, occurrence: occ };
    })
    .filter(Boolean);
}
```

(Note the renamed return key: `instance` → `module`. We update call sites in Task 5.)

- [ ] **Step 2: Update `getContainerItems` similarly**

The same rename applies to the simpler `getContainerItems` function at line 55 — pass `leafModulesLookup`, return modules directly. Update its parameter name.

- [ ] **Step 3: Search for callers**

```bash
grep -rn "getContainerItemsWithOccurrences\|getContainerItems\b" client/src/ --include='*.jsx' --include='*.js'
```

Expected callers (each will be updated in subsequent tasks):
- `client/src/modules/ModuleContainer.jsx` (lines 345, 378)
- Possibly `client/src/modules/pages/PageBoard.jsx` and similar.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/LayoutHelpers.js
git commit -m "refactor(layout): resolve container children from leafModulesLookup"
```

---

## Task 5: ModuleContainer — route children by role to the right renderer

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx`
- Create: `client/src/modules/ArtifactCard.jsx`
- Create: `client/src/modules/TextblockCard.jsx`

- [ ] **Step 1: Create `ArtifactCard.jsx`**

```jsx
// modules/ArtifactCard.jsx
// Renderer for role:"artifact" modules sitting in a container.
// Two modes:
//   - thumbnail (default): compact preview, click to expand.
//   - expanded: fills the parent instance-wrap, video gets <video controls autoPlay>,
//     image scales up, close button collapses back.
import React, { useState, useCallback } from "react";
import { X, Maximize2 } from "lucide-react";

export default function ArtifactCard({ module, label }) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = module?.fileRef;
  const kind = module?.kind;
  const src = fileRef ? `/uploads/${fileRef}` : null;

  const toggle = useCallback((e) => {
    e?.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  if (!src) {
    return (
      <div className="artifact-card artifact-card--empty">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label || "No file"}</span>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="artifact-card artifact-card--expanded" data-kind={kind}>
        <button className="artifact-expand-close" onClick={toggle} aria-label="Collapse">
          <X size={14} />
        </button>
        {renderExpanded(kind, src, label)}
      </div>
    );
  }

  return (
    <div
      className="artifact-card"
      data-kind={kind}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
    >
      {renderThumbnail(kind, src, label)}
      <Maximize2 className="artifact-thumb-expand-hint" size={12} />
    </div>
  );
}

function renderThumbnail(kind, src, label) {
  if (kind === "image") return <img className="artifact-thumb" src={src} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-thumb" src={src} muted playsInline preload="metadata" />;
  if (kind === "audio") return (
    <div className="artifact-thumb artifact-thumb--audio">
      <span style={{ fontSize: 18 }}>🎵</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label || "audio"}</span>
    </div>
  );
  if (kind === "pdf") return (
    <div className="artifact-thumb artifact-thumb--pdf">
      <span style={{ fontSize: 18 }}>📕</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label || "pdf"}</span>
    </div>
  );
  // markdown / unknown
  return (
    <div className="artifact-thumb artifact-thumb--unknown">
      <span style={{ fontSize: 10 }}>{label || "file"}</span>
    </div>
  );
}

function renderExpanded(kind, src, label) {
  if (kind === "image") return <img className="artifact-expanded-media" src={src} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-expanded-media" src={src} controls autoPlay playsInline />;
  if (kind === "audio") return (
    <div className="artifact-expanded-audio">
      <audio src={src} controls autoPlay style={{ width: "100%" }} />
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{label}</span>
    </div>
  );
  if (kind === "pdf") return <iframe className="artifact-expanded-media" src={src} title={label || "pdf"} />;
  return <div style={{ padding: 16, color: "var(--text-muted)" }}>Unsupported kind: {kind}</div>;
}
```

- [ ] **Step 2: Create `TextblockCard.jsx`**

```jsx
// modules/TextblockCard.jsx
// Renderer for role:"textblock" modules in a container.
// Wraps the existing <Editor> on occurrence.textmap. Saves are debounced through Editor's
// existing onChange → updateOccurrence path (same as DocContent).
import React, { useContext } from "react";
import Editor from "../ui/Editor.jsx";
import { GridActionsContext } from "../GridActionsContext";

export default function TextblockCard({ module, occurrence }) {
  const { dispatch, socket } = useContext(GridActionsContext);
  return (
    <div className="textblock-card">
      <Editor
        occurrence={occurrence}
        content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
        dispatch={dispatch}
        socket={socket}
        placeholder="Type…"
        showToolbar={false}
      />
    </div>
  );
}
```

- [ ] **Step 3: Wire `ModuleContainer.jsx` child loop to route by role**

In `client/src/modules/ModuleContainer.jsx`, find the existing destructure on line 18:

```js
import {
  getContainerItems,
  getContainerItemsWithOccurrences,
  ...
} from "../helpers/LayoutHelpers";
```

(no change to imports.)

At the call site on line 378 (currently `getContainerItemsWithOccurrences(module, occurrencesById, instancesById, undefined, containerOccurrence)`), update to pass the merged lookup. First, destructure `leafModulesById` from `GridActionsContext` near the existing `instancesById` destructure (line ~57):

```js
const { fieldsById, addInstanceToContainer, occurrencesById, linkedGroupIndex, instancesById, leafModulesById, operationsById } = useContext(GridActionsContext);
```

Then update the call at line 378:

```js
() => getContainerItemsWithOccurrences(module, occurrencesById, leafModulesById, undefined, containerOccurrence),
```

And dependency array `[module, occurrencesById, leafModulesById, containerOccurrence]`.

Same change for the line 345 call to `getContainerItems` if used.

- [ ] **Step 4: Update the child render loop (line ~1013)**

The current code:

```jsx
{itemsWithOccurrences.map(({ instance, occurrence }) => (
  <ModuleInstance
    key={occurrence.id}
    module={instance}
    ...
  />
))}
```

Replace with role routing. Add imports at the top:

```js
import ArtifactCard from "./ArtifactCard.jsx";
import TextblockCard from "./TextblockCard.jsx";
```

Then update the loop:

```jsx
{itemsWithOccurrences.map(({ module: childModule, occurrence }) => {
  if (childModule.role === "artifact") {
    return (
      <ModuleInstance
        key={occurrence.id}
        module={childModule}
        occurrence={occurrence}
        containerId={module.id}
        panelId={panelId}
        panel={panel}
        container={module}
        containerOccurrence={containerOccurrence}
        dispatch={dispatch}
        socket={socket}
        allowedEdges={containerAllowedEdges}
        onInstanceFocus={null}
        renderBody={() => <ArtifactCard module={childModule} label={childModule.label} />}
      />
    );
  }
  if (childModule.role === "textblock") {
    return (
      <ModuleInstance
        key={occurrence.id}
        module={childModule}
        occurrence={occurrence}
        containerId={module.id}
        panelId={panelId}
        panel={panel}
        container={module}
        containerOccurrence={containerOccurrence}
        dispatch={dispatch}
        socket={socket}
        allowedEdges={containerAllowedEdges}
        onInstanceFocus={null}
        renderBody={() => <TextblockCard module={childModule} occurrence={occurrence} />}
      />
    );
  }
  return (
    <ModuleInstance
      key={occurrence.id}
      module={childModule}
      occurrence={occurrence}
      containerId={module.id}
      panelId={panelId}
      panel={panel}
      container={module}
      containerOccurrence={containerOccurrence}
      dispatch={dispatch}
      socket={socket}
      allowedEdges={containerAllowedEdges}
      onInstanceFocus={null}
    />
  );
})}
```

The `renderBody` prop is added to `ModuleInstance` in the next step — when present it replaces the fields/operations area; the drag handle + radial menu are kept as-is.

- [ ] **Step 5: Add `renderBody` opt-out to `ModuleInstance.jsx`**

In `client/src/modules/ModuleInstance.jsx`:

1. Add `renderBody = null` to the props of `InstanceInner` (around line 37).
2. Around the existing fileRef preview block (lines 349–378), delete the entire block (artifacts no longer reach this path).
3. At the same location, when `renderBody` is provided, call it instead of the standard fields layout. Wrap the whole "fields/operations area" branch with a top-level conditional:

```jsx
{renderBody ? (
  <div className="instance-body" style={{ flex: 1, minWidth: 0 }}>
    {renderBody()}
  </div>
) : (
  /* existing fields + operation widgets layout stays exactly as it is */
)}
```

Keep the label + drag handle + radial menu rendering above this branch unchanged.

4. Also pass `renderBody` from the outer `ModuleInstance` wrapper down to `InstanceInner` (search for `<InstanceInner` and forward the new prop).

- [ ] **Step 6: Manual test**

Run `npm run dev`. Drag an existing image artifact from the Files tab into a list container:
- Expected: thumbnail renders inside the container row.
- Click thumbnail → expanded view fills the row, X closes.
- Drag handle still visible on hover; radial menu still works (rename, remove, etc.).

- [ ] **Step 7: Commit**

```bash
git add client/src/modules/ArtifactCard.jsx client/src/modules/TextblockCard.jsx client/src/modules/ModuleContainer.jsx client/src/modules/ModuleInstance.jsx
git commit -m "feat(modules): ArtifactCard + TextblockCard, ModuleContainer routes children by role"
```

---

## Task 6: CSS for `.artifact-card` and `.textblock-card`

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Append the rule block at the end of `index.css`**

```css
/* ============================================================ */
/* ArtifactCard — thumbnail + expanded media viewer             */
/* ============================================================ */
.artifact-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 80px;
  cursor: zoom-in;
  border-radius: 4px;
  overflow: hidden;
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
}
.artifact-thumb {
  max-height: 120px;
  max-width: 100%;
  width: auto;
  object-fit: cover;
  border-radius: 3px;
  display: block;
}
.artifact-thumb--audio,
.artifact-thumb--pdf,
.artifact-thumb--unknown {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px;
}
.artifact-thumb-expand-hint {
  position: absolute;
  top: 4px;
  right: 4px;
  color: var(--text-faint);
  background: rgba(0, 0, 0, 0.35);
  border-radius: 3px;
  padding: 2px;
  opacity: 0;
  transition: opacity 0.12s ease-out;
  pointer-events: none;
}
.artifact-card:hover .artifact-thumb-expand-hint { opacity: 1; }

.artifact-card--expanded {
  position: absolute;
  inset: 0;
  z-index: 50;
  cursor: default;
  padding: 24px;
  background: var(--input-bg);
  border: 1px solid var(--border-default);
  border-radius: 4px;
}
.artifact-expanded-media {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}
.artifact-expanded-audio {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.artifact-expand-close {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.artifact-expand-close:hover { background: rgba(0, 0, 0, 0.8); }
.instance-wrap:has(.artifact-card--expanded) {
  position: relative;
  min-height: 220px;
}

/* ============================================================ */
/* TextblockCard — inline rich-text in a container row          */
/* ============================================================ */
.textblock-card {
  width: 100%;
  padding: 4px 6px;
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.45;
}
.textblock-card .ProseMirror { min-height: 24px; outline: none; }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat(css): styles for ArtifactCard + TextblockCard"
```

---

## Task 7: Drag plumbing — accept `role: "artifact"` and `role: "textblock"` drops

**Files:**
- Modify: `client/src/helpers/dropHandlers.js`
- Modify: `client/src/ui/commandCenter/FilesTab.jsx`

- [ ] **Step 1: Update `handleModuleDrop` to accept the new roles**

In `client/src/helpers/dropHandlers.js` around line 627, the current code is:

```js
if (!role || role === "instance") { ... }
```

Replace with:

```js
const isLeafRole = !role || role === "instance" || role === "artifact" || role === "textblock";
if (isLeafRole) {
  // (existing body unchanged — copyInstanceToContainer creates an occurrence with
  // targetId = sourceModuleId; the targetType label is informational only.)
  ...
}
```

The function `copyInstanceToContainer` works without modification — it only references the source module via `sourceInstanceId` (a generic moduleId), and writes `targetType: "instance"` into the occurrence. We are renaming behavior, not data — to fix `targetType`, update the literal in `LayoutHelpers.copyInstanceToContainer` (line ~672) so it reads:

```js
targetType: "module",
```

(`module` is already used elsewhere as the universal pointer; per `Occurrence.js` schema this field is unconstrained — see schema in `server/models/Occurrence.js`. Confirm by `grep "targetType" server/models/Occurrence.js`.)

- [ ] **Step 2: Update `FilesTab` `ArtifactPill` payload**

In `client/src/ui/commandCenter/FilesTab.jsx`, find the draggable initial data (around line 36):

```js
getInitialData: () => ({
  type: "module",
  id: mod.id,
  data: { ...mod, defaultDragMode: "copy" },
  role: mod.role || "instance",
  defaultDragMode: "copy",
  sourceType: "command-center",
}),
```

Replace with:

```js
getInitialData: () => ({
  type: "module",
  id: mod.id,
  data: { ...mod, defaultDragMode: "copy" },
  role: "artifact",
  defaultDragMode: "copy",
  sourceType: "command-center",
}),
```

And update the artifacts filter (line 80):

```js
const artifacts = useMemo(
  () => Object.values(modulesById || {}).filter(m => m.role === "artifact"),
  [modulesById]
);
```

- [ ] **Step 3: Manual test**

Drag an artifact pill from the Files tab into a board container. Expected: the artifact thumbnail appears in the container.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/dropHandlers.js client/src/ui/commandCenter/FilesTab.jsx client/src/helpers/LayoutHelpers.js
git commit -m "feat(drag): handleModuleDrop accepts artifact + textblock roles"
```

---

## Task 8: Optimistic upload dispatch in `handleFileDrop`

**Files:**
- Modify: `client/src/helpers/dropHandlers.js`

- [ ] **Step 1: Import action creators**

At the top of `client/src/helpers/dropHandlers.js`:

```js
import { createModuleAction, createOccurrenceAction } from "../state/actions.js";
```

- [ ] **Step 2: Dispatch from upload response**

In `handleFileDrop` (around line 516–518), update the `.then` to:

```js
.then(({ module: uploadedModule, occurrence: uploadedOcc }) => {
  if (!uploadedOcc?.id) return;
  if (uploadedModule) dispatch(createModuleAction(uploadedModule));
  dispatch(createOccurrenceAction(uploadedOcc));
  // ...rest of the existing branches (container append / panel switch / new panel)
```

The reducer is idempotent (`CREATE_MODULE` / `CREATE_OCCURRENCE` cases merge by id), so the duplicate dispatch when the socket event arrives is a no-op.

- [ ] **Step 3: Manual test**

OS-drag a `.png` and a `.mp4` onto a board container. Expected: thumbnail appears within ~200 ms (upload latency) — no rebuild required. Reload the page; artifacts persist.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/dropHandlers.js
git commit -m "fix(artifacts): dispatch module+occurrence locally on upload to avoid blank-spot delay"
```

---

## Task 9: "Add textblock" affordance + creation flow

**Files:**
- Modify: `client/src/ui/QuickAddMenu.jsx`
- Modify: `client/src/modules/ModuleContainer.jsx`
- Modify: `client/src/helpers/CommitHelpers.js` (add `createTextblockInContainer` helper)
- Modify: `client/src/state/bindSocketToStore.js` (handle `module_created` for role:"textblock" — should already work via existing `onModuleCreated`, verify only)

- [ ] **Step 1: Add `createTextblockInContainer` to CommitHelpers**

In `client/src/helpers/CommitHelpers.js`, append a new exported function:

```js
export function createTextblockInContainer({ dispatch, socket, gridId, userId, containerOccurrence, label = "" }) {
  if (!gridId || !userId || !containerOccurrence) return null;
  const moduleId = uid();
  const occurrenceId = uid();
  const module = {
    id: moduleId,
    userId,
    gridId,
    role: "textblock",
    kind: "doc",
    label: label || "",
  };
  const occurrence = {
    id: occurrenceId,
    userId,
    gridId,
    targetId: moduleId,
    targetType: "module",
    parentId: containerOccurrence.id,
    textmap: { type: "doc", content: [] },
  };
  // Optimistic local dispatch.
  dispatch(createModuleAction(module));
  dispatch(createOccurrenceAction(occurrence));
  // Socket emits.
  safeEmit(socket, "create_module", module);
  safeEmit(socket, "create_occurrence", occurrence);
  // Append to container.
  updateOccurrence({
    dispatch, socket,
    occurrence: {
      id: containerOccurrence.id,
      occurrences: [...(containerOccurrence.occurrences || []), occurrenceId],
    },
    emit: true,
  });
  return { moduleId, occurrenceId };
}
```

(`uid`, `safeEmit`, `createModuleAction`, `createOccurrenceAction`, `updateOccurrence` are all already imported in CommitHelpers.js — verify with `grep "^import\|^export" client/src/helpers/CommitHelpers.js | head`.)

- [ ] **Step 2: Add "Textblock" item to `QuickAddMenu`**

In `client/src/ui/QuickAddMenu.jsx`, find the place where the "New instance" / "New container" item is rendered (search for `New instance` or `targetRole`). Conditionally add a "+ Textblock" entry when `targetRole === "instance"` (i.e. when invoked on a list/board container's `+` button) that calls a new prop `onAddTextblock` if provided.

- [ ] **Step 3: Wire the callback in `ModuleContainer.jsx`**

Find the `<QuickAddMenu targetRole="instance" ...>` invocation in `ModuleContainer.jsx`. Add an `onAddTextblock` prop:

```jsx
<QuickAddMenu
  targetRole="instance"
  ...existing props
  onAddTextblock={() => {
    CommitHelpers.createTextblockInContainer({
      dispatch, socket,
      gridId: state?.gridId || state?.grid?._id,
      userId: state?.userId,
      containerOccurrence,
    });
  }}
/>
```

- [ ] **Step 4: Manual test**

Click the `+` button on a board container's header → choose "Textblock" → expect a new empty textblock card to appear in the container with focus inside it. Type some text. Reload the page — text persists.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/CommitHelpers.js client/src/ui/QuickAddMenu.jsx client/src/modules/ModuleContainer.jsx
git commit -m "feat(textblock): + Textblock QuickAdd item creates role:textblock module in container"
```

---

## Task 10: Drag-source for textblocks (optional, for parity with artifacts)

**Files:**
- Modify: `client/src/ui/commandCenter/FilesTab.jsx` (or a new ComponentsTab section)

The minimal feature works after Task 9 (you can create a textblock from the container `+` button). Optional polish: add a draggable "Textblock" pill in the Files or Components tab so the user can drop an existing textblock into another container.

- [ ] **Step 1: Add a TextblockPill section in FilesTab**

(deferred; mark as a follow-up in the CLAUDE.md note.)

---

## Task 11: Update folder CLAUDE.md files

**Files:**
- Modify: `client/src/modules/CLAUDE.md`
- Modify: `client/src/helpers/CLAUDE.md`
- Modify: `client/src/state/CLAUDE.md`
- Modify: `server/CLAUDE.md` (if it exists; otherwise skip)

- [ ] **Step 1: Append entries**

For each, prepend a new "Recent Changes (Apr 24 2026 — Artifact + Textblock Roles)" block summarizing the file's changes (one bullet per file touched). Examples:

`client/src/modules/CLAUDE.md`:
```markdown
## Recent Changes (Apr 24 2026 — Artifact + Textblock Roles)
- **ArtifactCard.jsx** (NEW): Thumbnail + expanded renderer for role:"artifact" modules. Click to expand; X to collapse. Video uses `<video controls autoPlay>`.
- **TextblockCard.jsx** (NEW): Inline `<Editor>` wrapper for role:"textblock" modules in containers; saves textmap via existing onChange path.
- **ModuleContainer.jsx**: Child render loop now routes by `module.role` — `<ModuleInstance>` (instance), `<ModuleInstance renderBody=ArtifactCard>` (artifact), `<ModuleInstance renderBody=TextblockCard>` (textblock). Reads `leafModulesById` from context.
- **ModuleInstance.jsx**: Accepts new `renderBody` prop — when provided, replaces the standard fields/operations area. The old inline `instance.fileRef` preview block was deleted (artifacts no longer reach this path; they have their own renderer).
```

`client/src/helpers/CLAUDE.md`:
```markdown
## Recent Changes (Apr 24 2026 — Artifact + Textblock Roles + Optimistic Upload)
- **dropHandlers.js**: `handleModuleDrop` accepts `role: "artifact"` and `role: "textblock"` for container drops (treated as leaf-placeable). `handleFileDrop` dispatches `createModuleAction` + `createOccurrenceAction` from the upload response so thumbnails appear immediately.
- **LayoutHelpers.js**: `getContainerItemsWithOccurrences` and `getContainerItems` now take `leafModulesLookup` (merged instances + artifacts + textblocks) instead of `instancesLookup`. Return key renamed `instance` → `module`. `copyInstanceToContainer` writes `targetType: "module"` (was `"instance"`).
- **CommitHelpers.js**: New `createTextblockInContainer({...})` — creates role:"textblock", kind:"doc" module + occurrence + appends to container, optimistic-dispatched.
```

`client/src/state/CLAUDE.md`:
```markdown
## Recent Changes (Apr 24 2026 — Artifact + Textblock Role Buckets)
- **masterReducer.js / initialState.js**: `state.artifacts` and `state.textblocks` arrays added; `deriveRoleArrays` buckets new roles. LOGOUT/FULL_STATE clears include them.
- **selectors.js**: `createLookupsFromState` returns `artifactsById` and `textblocksById`. `computeRoleByModuleId` recognises both new roles.
```

- [ ] **Step 2: Commit**

```bash
git add client/src/modules/CLAUDE.md client/src/helpers/CLAUDE.md client/src/state/CLAUDE.md
git commit -m "docs(claudemd): note artifact + textblock role refactor"
```

---

## Self-Review Checklist

**Spec coverage** (the user's asks):
1. *"Artifacts as their own role, kind = type of artifact"* → Tasks 1, 2, 3, 5 (server upload writes `role: "artifact", kind: image|video|audio|pdf|markdown`; state derives `artifacts` bucket; ArtifactCard renders by `kind`).
2. *"Textblocks should be able to go into board containers"* → Tasks 2, 3, 5, 9 (role: "textblock" derived; TextblockCard renders inline; QuickAdd creates one in any list/board container).
3. *"Display how it looks now, click image/video thumbnail to expand to fit container"* → Task 5 (`ArtifactCard` thumbnail + expanded modes).
4. *"Video opens with player when expanded"* → Task 5 (`<video controls autoPlay>` in `renderExpanded`).
5. *"New occurrence shows up immediately in the spot I dropped it"* → Task 8 (`handleFileDrop` dispatches locally from upload response).

**Type / signature consistency:**
- `getContainerItemsWithOccurrences` returns `{ module, occurrence }` — same key used in `ModuleContainer` map.
- `ArtifactCard` props `{ module, label }` — same in Task 5 child loop.
- `TextblockCard` props `{ module, occurrence }` — same in Task 5 child loop.
- `copyInstanceToContainer` writes `targetType: "module"` — matches `Occurrence.js` schema (no enum constraint).

**Placeholder scan:** every step has full code. The only deferred item is Task 10 (drag-source for textblocks), explicitly marked optional.

**Out of scope:**
- Drag-resize of expanded artifact (Notion-style).
- Lightbox-style portal that escapes container bounds.
- Migrating `meta.viewType` references on existing **panels** that show artifacts in `display`/`code` view (Task 1 only changes upload-time defaults; existing artifact-panel views still work via `occurrence.viewId`).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-24-artifact-as-instance-expand.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — run tasks in this session with checkpoints.

Which approach?
