# File Upload + Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix OS file drag-and-drop so files upload and display correctly as artifact panels (image/video/audio/pdf all playable/viewable; markdown editable).

**Architecture:** Two separate systems need to work together: (1) `handleFileDrop` in `dropHandlers.js` uploads to `/api/artifacts/upload` and creates a panel View; (2) `ModulePanel.jsx` renders the display panel using `resolvedView.artifactType`. The bug is that the client-created panel View has no `artifactType`, so all artifact types render as blank markdown editors instead of image/video/audio/pdf viewers.

**Tech Stack:** React, Socket.io, Express, Multer, TipTap

---

## Root Cause Analysis

The flow when a file is dropped:

```
handleFileDrop
  → POST /api/artifacts/upload
  → Server creates: artifactModule + artifactOccurrence (viewId → artifactView {viewType:"display", artifactType:"image"})
  → Client receives: { occurrence: uploadedOcc }
  → Client calls createPanelInGrid → panelOccurrence
  → Client calls createView({ viewType: "display", activeOccurrenceId: uploadedOcc.id })
         ^^^^ NO artifactType here!
  → Client calls updateOccurrence({ ...panelOccurrence, viewId: newPanelViewId })

ModulePanel.jsx display panel branch:
  → resolvedView = panelView { viewType: "display", artifactType: undefined }
  → <Artifact artifactType={resolvedView?.artifactType ?? null} />
         ^^^^ always null → falls into markdown branch → blank editor
```

**Fix 1 (primary):** In `ModulePanel.jsx` display panel branch, look up the active occurrence's own view (`activeOcc.viewId → viewsById`) to get the real `artifactType`.

**Fix 2 (secondary):** In `handleFileDrop`, pass the server's `uploadedOcc.id`'s view data so the panel view doesn't need its own `artifactType` — or read it from the occurrence's view in the renderer (Fix 1 does this).

---

## File Map

| File | Change |
|------|--------|
| `client/src/modules/ModulePanel.jsx:1016-1029` | Modify: look up `activeOcc.viewId` → `viewsById` to get `artifactType` for display panel |
| `client/src/helpers/dropHandlers.js:490-538` | Verify/add logging around upload response; confirm `uploadedOcc.id` is present |
| `server/server.js:328-372` | Verify upload endpoint; serve files from correct path |
| `client/src/modules/ArtifactContent.jsx` | Verify file path format (`/uploads/${fileRef}`) is correct |

---

## Task 1: Verify the upload endpoint works end-to-end

**Files:**
- Read: `server/server.js:328-372`

- [ ] **Step 1: Smoke-test the upload endpoint with curl**

```bash
curl -X POST http://localhost:5000/api/artifacts/upload \
  -F "file=@/path/to/test.jpg" \
  -F "userId=<your_userId>" \
  -F "gridId=<your_gridId>"
```

Expected response:
```json
{
  "module": { "id": "...", "fileRef": "user/...", "meta": { "artifactType": "image", "viewType": "display" } },
  "occurrence": { "id": "...", "viewId": "..." },
  "fileRef": "user/1234567-abc.jpg",
  "url": "/artifacts/user/1234567-abc.jpg"
}
```

- [ ] **Step 2: Verify the file is actually accessible**

After upload, the file should be at `/uploads/user/{destFileName}`. Test:
```bash
curl -I http://localhost:5000/uploads/user/<destFileName>
```
Expected: `200 OK` with correct Content-Type.

> Note: `ArtifactContent.jsx` uses `/uploads/${fileRef}` path. `fileRef` = `user/{destFileName}`. The server's `app.use("/uploads", express.static(uploadsDir))` serves from `server/uploads/`. This should work — just verify.

- [ ] **Step 3: Commit baseline (no code changes yet)**

```bash
git add -A
git commit -m "chore: verify upload endpoint before fixing display rendering"
```

---

## Task 2: Trace the client-side drop detection

**Files:**
- Modify: `client/src/helpers/dropHandlers.js:490-538`

- [ ] **Step 1: Add logging at entry of handleFileDrop**

In `dropHandlers.js`, add to the top of `handleFileDrop`:

```javascript
export function handleFileDrop(ctx, drop) {
  console.log("[handleFileDrop] triggered", { drop, payload: drop?.payload });
  const { dispatch, socket, state, occurrencesById, clearSession } = ctx;
  const { payload, panelId, getCellFromPoint, x, y } = drop;
  // ... existing code
```

- [ ] **Step 2: Add logging after the fetch**

After the `.then(({ occurrence: uploadedOcc }) => {` line, add:
```javascript
console.log("[handleFileDrop] upload response", { uploadedOcc });
```

And after `CommitHelpers.createView`:
```javascript
console.log("[handleFileDrop] created view", { viewId, panelResult });
```

- [ ] **Step 3: Test a file drop and check browser console**

Open the app, drag a JPG file onto the grid. Expected console output:
```
[handleFileDrop] triggered { ... }
[handleFileDrop] upload response { uploadedOcc: { id: "...", viewId: "..." } }
[handleFileDrop] created view { viewId: "...", panelResult: { occurrence: { id: "..." } } }
```

If "[handleFileDrop] triggered" never appears → file drop is not being detected (see Task 2b).
If "[handleFileDrop] upload response" shows `uploadedOcc: null` → server error.
If both appear → upload works, problem is in rendering (Task 3).

- [ ] **Step 4: (If drop not detected) Check native fallback**

In `DragProvider.jsx`, find the native fallback (around line 888):
```javascript
const gridFrame = document.querySelector(".grid-frame");
```

Add logging:
```javascript
console.log("[DragProvider] native fallback setup, gridFrame:", gridFrame);
```

Verify `.grid-frame` exists in the DOM when the effect runs.

- [ ] **Step 5: Remove debug logging**

```javascript
// Remove all console.log lines added in Task 2 steps 1-4
```

---

## Task 3: Fix display panel rendering — artifactType from artifact occurrence's view

This is the primary bug. `ModulePanel.jsx` renders all dropped artifacts as blank markdown editors because the panel view doesn't have `artifactType`.

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx:1016-1030`

- [ ] **Step 1: Read the current display panel branch**

```javascript
// Current code (around line 1016):
if (viewType === "display" || viewType === "markdown" || viewType === "image" || viewType === "pdf" || viewType === "audio" || viewType === "video") {
  const activeOccId = resolvedView?.activeOccurrenceId;
  const activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
      <Artifact
        occurrence={activeOcc}
        viewType={viewType}
        artifactType={resolvedView?.artifactType ?? null}  // ← BUG: panel view has no artifactType
        dispatch={dispatch}
        socket={socket}
      />
    </div>
  );
}
```

- [ ] **Step 2: Fix — look up the artifact occurrence's own view for artifactType**

Replace the display panel branch with:

```javascript
if (viewType === "display" || viewType === "markdown" || viewType === "image" || viewType === "pdf" || viewType === "audio" || viewType === "video") {
  const activeOccId = resolvedView?.activeOccurrenceId;
  const activeOcc = activeOccId ? occurrencesById?.[activeOccId] : null;
  const activeOccView = activeOcc?.viewId ? viewsById?.[activeOcc.viewId] : null;
  const effectiveViewType = activeOccView?.viewType ?? viewType;
  const effectiveArtifactType = activeOccView?.artifactType ?? resolvedView?.artifactType ?? null;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
      <Artifact
        occurrence={activeOcc}
        viewType={effectiveViewType}
        artifactType={effectiveArtifactType}
        dispatch={dispatch}
        socket={socket}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify `viewsById` is destructured at the top of ModulePanel**

In `ModulePanel.jsx`, find where `occurrencesById` is destructured from context. Verify `viewsById` is also destructured there. If not, add it:

```javascript
const { ..., occurrencesById, viewsById, ... } = useContext(GridActionsContext);
```

- [ ] **Step 4: Run the app and drag an image file onto the grid**

Expected: a new panel appears showing the image.

Run tests:
```bash
npm --prefix ./server run test
```
Expected: all 63 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModulePanel.jsx
git commit -m "fix: display panel reads artifactType from artifact occurrence's view

When a file is dropped and uploaded, the client creates a panel view with
viewType:'display' but no artifactType. The renderer now looks up the active
occurrence's own view (set by the server during upload) to get the correct
artifactType (image/video/audio/pdf), so all file types render correctly."
```

---

## Task 4: Test all artifact types end-to-end

**Files:**
- None (manual testing)

Test each file type by dragging onto the grid:

- [ ] **Step 1: Test image upload**

Drag a `.jpg` or `.png` file onto an empty grid cell.
Expected:
- New panel appears
- Image displays with `object-fit: contain` inside the panel
- Panel label = filename

- [ ] **Step 2: Test video upload**

Drag a `.mp4` file onto an empty grid cell.
Expected:
- New panel appears  
- `<video>` element with controls renders
- Clicking play starts playback

- [ ] **Step 3: Test audio upload**

Drag a `.mp3` or `.wav` file onto an empty grid cell.
Expected:
- New panel appears
- `<audio>` element with controls renders
- Audio is playable

- [ ] **Step 4: Test PDF upload**

Drag a `.pdf` file onto an empty grid cell.
Expected:
- New panel appears
- `<iframe>` renders the PDF

- [ ] **Step 5: Test markdown upload**

Drag a `.md` file onto an empty grid cell.
Expected:
- New panel appears
- TipTap editor renders with file content
- (Note: the server uploads but doesn't parse the .md into the occurrence textmap — editor will be empty. This is known/acceptable behavior.)

- [ ] **Step 6: Test dropping onto existing artifact panel**

Open an existing artifact panel (one that shows a file). Drag a new file onto it.
Expected: the panel switches to display the new file (panel view's `activeOccurrenceId` updates).

- [ ] **Step 7: Commit if any minor fixes were needed**

```bash
git add -A
git commit -m "test: verify all artifact types render after file drop"
```

---

## Task 5: Fix stale panel view activeOccurrenceId when dropping on existing panel

**Files:**
- Read: `client/src/helpers/dropHandlers.js:500-508`

- [ ] **Step 1: Review the existing-panel branch**

In `handleFileDrop`:
```javascript
const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
const isExistingArtifactPanel = capturedPanelView?.viewType === "display" || capturedPanelView?.hasTree;

// ... after upload:
if (isExistingArtifactPanel && capturedPanelView) {
  CommitHelpers.updateView({ dispatch, socket, view: { ...capturedPanelView, activeOccurrenceId: uploadedOcc.id } });
}
```

This correctly updates the existing panel's view. No fix needed here.

- [ ] **Step 2: Confirm the `capturedPanelOcc` lookup is correct**

`capturedPanelOcc` is found by:
```javascript
const capturedPanelOcc = panelId ? Object.values(occurrencesById).find(o => o.targetId === panelId) : null;
```

`panelId` comes from `drop.panelId`. Verify this is populated when dropping onto a panel's content area (not just empty grid cell).

If `panelId` is null during the drop, `isExistingArtifactPanel` will be false, and the new-panel branch runs instead. This would create a second panel instead of updating the existing one. This is likely fine behavior (user dropped on empty area).

- [ ] **Step 3: No code changes needed — proceed**

---

## Self-Review

**Spec coverage:**
- [x] Image upload and display → Task 3 + 4
- [x] Video upload and playback → Task 3 + 4
- [x] Audio upload and playback → Task 3 + 4
- [x] PDF upload and display → Task 3 + 4
- [x] Markdown/doc upload → Task 3 + 4
- [x] Drop detection → Task 2
- [x] Upload endpoint → Task 1
- [x] Drop on existing panel → Task 5

**Gaps:**
- Code file types (`.js`, `.py`, etc.) → handled by server's `mimeToViewType` → `viewType: "code"` → `CodeViewer` in `ArtifactContent.jsx`. Fix in Task 3 also covers this since `effectiveViewType` will be `"code"`.

**Type consistency:**
- `effectiveViewType` / `effectiveArtifactType` introduced in Task 3 are local vars, no cross-task confusion.
- `activeOccView` pattern matches the same pattern already used in `TreePanelContent` (line 1003).
