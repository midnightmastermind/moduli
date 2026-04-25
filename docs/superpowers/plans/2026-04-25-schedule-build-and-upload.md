# Schedule Auto-Build & Optimistic File Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an optimistic file-upload flow with a placeholder spinner, replace single-day schedule slots with a per-day auto-build operation (slots + Due container + preset routine + due-date sweep), and replace the existing schedule clear-on-move op with one that distinguishes move from copy.

**Architecture:** Four bundled features, ordered bottom-up so each phase is independently testable.
1. **Infra** — server `create_occurrence` auto-pushes new occurrence ID into its parent's `occurrences[]`; client gets a `MOVE_OCCURRENCE_TO_PARENT` action so the auto-build pipeline can move occurrences between parents.
2. **Optimistic upload** — client generates IDs, dispatches a placeholder Module (`meta.uploadStatus: "pending"`) before the fetch; ArtifactCard renders a spinner until upload completes; server upload endpoint upserts using the supplied IDs.
3. **Seed + auto-build** — slot Modules tagged with `meta.scheduleSlot`, Todo container tagged with `meta.todoListContainer`, two new instance modules ("Take Medication", "Go to Gym"), one new operation ("Schedule: Auto-Build for Active Date"), one replaced operation ("Schedule: Clear Date on Move-Out").
4. **Smoke** — manual verification checklist + a Node-script integration test for the auto-build operation.

**Tech Stack:** Mongoose (server), Socket.io, React, Vitest (client+server unit tests), Playwright (e2e — optional in this plan).

**Spec:** `docs/superpowers/specs/2026-04-25-schedule-build-and-upload-design.md`

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `client/src/helpers/fileKind.js` | Pure helper — `mimeToKind(mime, filename)` mirroring server. Lets the client choose the correct `kind` before posting upload. |
| `server/__tests__/createOccurrenceAutoPush.test.js` | Vitest — verifies new auto-push behaviour of `create_occurrence` socket handler. |
| `server/__tests__/artifactUploadOptimistic.test.js` | Vitest — verifies `/api/artifacts/upload` upserts an existing Module/Occurrence when their IDs are supplied. |
| `server/scripts/testScheduleAutoBuild.js` | One-shot integration script — drops + recreates the test grid, then exercises the Auto-Build operation across two simulated days (today / tomorrow / move-out). |

### Modified

| Path | Change |
|---|---|
| `server/socketHandlers/crud.js` | `create_occurrence` handler: when `parentId` set, push `id` to parent's `occurrences[]` (idempotent, supports `insertAtIndex`). |
| `server/server.js` | `/api/artifacts/upload`: accept optional `moduleId` + `occurrenceId` in the FormData; upsert instead of always creating; emit `module_updated` instead of `module_created` when updating. |
| `server/scripts/createTestGrid.js` | Slot modules get `meta: { scheduleSlot, slotHour, slotMinute, slotLabel }`; Todo container gets `meta.todoListContainer`; add `takeMedicationModId` + `goToGymModId` instance modules to Daily Toolkit; remove SCHEDULE_PREFILL loop + per-day slot occurrence pre-creation; add Schedule Auto-Build operation; replace Schedule Clear op. |
| `client/src/helpers/dropHandlers.js` | `handleFileDrop`: generate IDs client-side, dispatch placeholder Module + Occurrence + container update BEFORE fetch; pass IDs into upload POST; on response dispatch `updateModule` with real fileRef; on failure dispatch `updateModule({ meta: { uploadStatus: "error" } })`. |
| `client/src/helpers/operationActions.js` | New `MOVE_OCCURRENCE_TO_PARENT` action case (resolves `occurrenceIdExpr` + `toParentOccIdExpr`, emits effect). |
| `client/src/state/bindSocketToStore.js` | New `MOVE_OCCURRENCE_TO_PARENT` effect handler (3 `updateOccurrence` calls: detach from old parent, set new parentId, append to new parent). `CREATE_OCCURRENCE_FOR_MODULE` effect handler passes `insertAtIndex` through to socket payload. |
| `client/src/modules/ArtifactCard.jsx` | When `module.meta?.uploadStatus === "pending"`: render `<Spinner />` overlay + filename caption (skip the file-load path). When `"error"`: render error icon + filename. |

---

## Task 1: Server `create_occurrence` auto-pushes to parent

**Files:**
- Modify: `server/socketHandlers/crud.js:154-181`
- Test: `server/__tests__/createOccurrenceAutoPush.test.js`

**Background:** Today, when a client emits `create_occurrence` with `parentId` set, the server saves the new occurrence but does NOT update the parent's `occurrences[]` array. Operation pipelines that create occurrences therefore need a follow-up `update_occurrence` step. This task pushes the ID into the parent automatically.

- [ ] **Step 1: Read the existing handler so the test mirrors its IO**

Run: `sed -n '154,182p' server/socketHandlers/crud.js`
Expected: handler signature, `Occurrence.findOneAndUpdate(... upsert: true)`, `socket.to(userRoom(userId)).emit("occurrence_created", ...)`.

- [ ] **Step 2: Write the failing test**

Create `server/__tests__/createOccurrenceAutoPush.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Occurrence from "../models/Occurrence.js";
import { setupGenericCRUD, setupOccurrencesCRUD } from "../socketHandlers/crud.js";

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Occurrence.deleteMany({});
});

function mockSocket() {
  const handlers = {};
  const emitted = [];
  return {
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => { emitted.push({ scope: "self", event, data }); },
    to: (room) => ({
      emit: (event, data) => { emitted.push({ scope: "broadcast", room, event, data }); },
    }),
    fire: (event, payload) => handlers[event](payload),
    emitted,
  };
}

describe("create_occurrence auto-push to parent", () => {
  it("pushes new occurrence ID into parent.occurrences when parentId is set", async () => {
    const userId = "user_test";
    await Occurrence.create({ id: "parent_1", userId, gridId: "g1", targetType: "module", targetId: "m_parent", occurrences: [] });

    const socket = mockSocket();
    const uc = { occurrencesById: {} };
    setupOccurrencesCRUD(socket, userId, async () => uc);

    await socket.fire("create_occurrence", {
      occurrence: { id: "child_1", userId, gridId: "g1", targetType: "module", targetId: "m_child", parentId: "parent_1" },
    });

    const parent = await Occurrence.findOne({ id: "parent_1" });
    expect(parent.occurrences).toEqual(["child_1"]);
  });

  it("respects insertAtIndex when provided", async () => {
    const userId = "user_test";
    await Occurrence.create({ id: "parent_2", userId, gridId: "g1", targetType: "module", targetId: "m_parent", occurrences: ["existing_a", "existing_b"] });

    const socket = mockSocket();
    const uc = { occurrencesById: {} };
    setupOccurrencesCRUD(socket, userId, async () => uc);

    await socket.fire("create_occurrence", {
      occurrence: { id: "child_2", userId, gridId: "g1", targetType: "module", targetId: "m_child", parentId: "parent_2", insertAtIndex: 0 },
    });

    const parent = await Occurrence.findOne({ id: "parent_2" });
    expect(parent.occurrences).toEqual(["child_2", "existing_a", "existing_b"]);
  });

  it("is idempotent — re-creating the same child does not duplicate the ID", async () => {
    const userId = "user_test";
    await Occurrence.create({ id: "parent_3", userId, gridId: "g1", targetType: "module", targetId: "m_parent", occurrences: ["child_3"] });

    const socket = mockSocket();
    const uc = { occurrencesById: { parent_3: { id: "parent_3", occurrences: ["child_3"] } } };
    setupOccurrencesCRUD(socket, userId, async () => uc);

    await socket.fire("create_occurrence", {
      occurrence: { id: "child_3", userId, gridId: "g1", targetType: "module", targetId: "m_child", parentId: "parent_3" },
    });

    const parent = await Occurrence.findOne({ id: "parent_3" });
    expect(parent.occurrences).toEqual(["child_3"]);
  });

  it("does nothing extra when parentId is not set", async () => {
    const userId = "user_test";
    const socket = mockSocket();
    const uc = { occurrencesById: {} };
    setupOccurrencesCRUD(socket, userId, async () => uc);

    await socket.fire("create_occurrence", {
      occurrence: { id: "orphan_1", userId, gridId: "g1", targetType: "module", targetId: "m_x" },
    });

    const orphan = await Occurrence.findOne({ id: "orphan_1" });
    expect(orphan).toBeTruthy();
    // No parent to verify; just assert no broadcast extra than the create
    const updates = socket.emitted.filter(e => e.event === "occurrence_updated");
    expect(updates).toHaveLength(0);
  });
});
```

> **NOTE for the implementer:** `setupOccurrencesCRUD` may not be a current export. Check `server/socketHandlers/crud.js` — if the handler is wired inside a single `setupGenericCRUD` factory, extract just the `create_occurrence` `socket.on(...)` registration into a small named export `setupOccurrencesCRUD(socket, userId, getUc)` so tests can attach to it without booting a real Express + Socket.io server. Keep the existing default export wiring untouched.

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm --prefix ./server test -- createOccurrenceAutoPush`
Expected: 3 of 4 tests fail (`parent.occurrences` empty / not preserving order). The "no parentId" test may pass already.

- [ ] **Step 4: Implement the auto-push in `server/socketHandlers/crud.js`**

Replace the existing `socket.on("create_occurrence", ...)` body (lines 154-181) with:

```js
socket.on("create_occurrence", async ({ occurrence } = {}) => {
  try {
    if (!userId) return;
    const uc = await getUc();
    const id = occurrence?.id;
    if (!id) return;
    const occurrenceData = {
      ...createOccurrenceData({
        id, userId,
        targetType: occurrence.targetType, targetId: occurrence.targetId,
        gridId: occurrence.gridId,
        placement: occurrence.placement, fields: occurrence.fields,
        meta: occurrence.meta, linkedGroupId: occurrence.linkedGroupId || null,
      }),
      ...(occurrence.parentId != null && { parentId: occurrence.parentId }),
      ...(occurrence.textmap != null && { textmap: occurrence.textmap }),
      ...(occurrence.viewId != null && { viewId: occurrence.viewId }),
      ...(Array.isArray(occurrence.occurrences) && { occurrences: occurrence.occurrences }),
    };
    uc.occurrencesById[id] = occurrenceData;
    await Occurrence.findOneAndUpdate({ id, userId }, occurrenceData, { upsert: true });
    socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occurrenceData });

    // ── Auto-push into parent.occurrences[] ──
    if (occurrenceData.parentId) {
      const parent = await Occurrence.findOne({ id: occurrenceData.parentId, userId });
      if (parent) {
        const current = Array.isArray(parent.occurrences) ? parent.occurrences : [];
        if (!current.includes(id)) {
          const insertAt = typeof occurrence.insertAtIndex === "number" ? occurrence.insertAtIndex : current.length;
          const next = [...current];
          next.splice(insertAt, 0, id);
          await Occurrence.findOneAndUpdate(
            { id: occurrenceData.parentId, userId },
            { $set: { occurrences: next } }
          );
          const updatedParent = { ...parent.toObject(), occurrences: next };
          uc.occurrencesById[occurrenceData.parentId] = updatedParent;
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedParent });
          socket.emit("occurrence_updated", { occurrence: updatedParent });
        }
      }
    }
  } catch (err) {
    console.error("create_occurrence error:", err);
    socket.emit("server_error", "Failed to create occurrence");
  }
});
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm --prefix ./server test -- createOccurrenceAutoPush`
Expected: 4/4 pass.

- [ ] **Step 6: Run the full server test suite to confirm no regressions**

Run: `npm --prefix ./server test`
Expected: All previously-passing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add server/socketHandlers/crud.js server/__tests__/createOccurrenceAutoPush.test.js
git commit -m "feat(server): create_occurrence auto-pushes to parent.occurrences[]

Eliminates a redundant update_occurrence round-trip after every operation-pipeline
CREATE_OCCURRENCE_FOR_MODULE. Idempotent on re-emit; honors optional insertAtIndex."
```

---

## Task 2: Client passes `insertAtIndex` through `CREATE_OCCURRENCE_FOR_MODULE`

**Files:**
- Modify: `client/src/state/bindSocketToStore.js:523-543`
- Modify: `client/src/helpers/operationActions.js:886-915`

**Background:** The action emits an effect; the effect handler emits the socket event. Both need to know about `insertAtIndex` so it reaches the server (used by Task 10 to put the Due container at the top).

- [ ] **Step 1: Update the action to forward `insertAtIndex`**

In `client/src/helpers/operationActions.js`, inside `case "CREATE_OCCURRENCE_FOR_MODULE"` (lines ~886-914), change the `updates.push(...)` to include `insertAtIndex`:

```js
updates.push({
  _effect: "CREATE_OCCURRENCE_FOR_MODULE",
  occurrenceId,
  moduleId,
  parentId: resolveExpr(cfg.parentIdExpr || cfg.parentId, $vars) || null,
  viewId: resolveExpr(cfg.viewIdExpr || cfg.viewId, $vars) || null,
  fields,
  textmap,
  insertAtIndex: typeof cfg.insertAtIndex === "number" ? cfg.insertAtIndex : null,
});
```

- [ ] **Step 2: Update the effect handler to forward `insertAtIndex`**

In `client/src/state/bindSocketToStore.js` `case "CREATE_OCCURRENCE_FOR_MODULE"` (lines ~523-543), change the `socket?.emit("create_occurrence", { occurrence: { ... } })` payload to include `insertAtIndex` when set:

```js
socket?.emit("create_occurrence", {
  occurrence: {
    id: effect.occurrenceId,
    targetType: "module",
    targetId: effect.moduleId,
    gridId,
    parentId: effect.parentId || null,
    viewId: effect.viewId || null,
    fields: effect.fields || {},
    meta: { createdByOperation: true },
    textmap: effect.textmap || null,
    occurrences: [],
    ...(typeof effect.insertAtIndex === "number" && { insertAtIndex: effect.insertAtIndex }),
  },
});
```

- [ ] **Step 3: Verify nothing breaks — run any client unit tests**

Run: `npm --prefix ./client test`
Expected: existing pass count unchanged.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationActions.js client/src/state/bindSocketToStore.js
git commit -m "feat(operations): forward insertAtIndex through CREATE_OCCURRENCE_FOR_MODULE

Lets pipelines insert new occurrences at a specific position in the parent's
occurrences[] (used by the Schedule Auto-Build op to pin the Due container at
index 0)."
```

---

## Task 3: Client `MOVE_OCCURRENCE_TO_PARENT` action + effect

**Files:**
- Modify: `client/src/helpers/operationActions.js` (after `case "MOVE_OCCURRENCE":`)
- Modify: `client/src/state/bindSocketToStore.js` (add `case "MOVE_OCCURRENCE_TO_PARENT":` near other effects)

**Background:** The existing `MOVE_OCCURRENCE` action takes `toContainerId` (a *Module* ID) and is wired to a server handler that re-resolves the destination occurrence by module ID. The Auto-Build op needs to move occurrences into a *specific occurrence* (the Due container's per-day occurrence), so we need an action that addresses the destination by occurrence ID directly.

- [ ] **Step 1: Add the action case in `operationActions.js`**

Insert after the existing `case "MOVE_OCCURRENCE":` block (around line 460):

```js
case "MOVE_OCCURRENCE_TO_PARENT": {
  const occId         = resolveExpr(cfg.occurrenceIdExpr, $vars);
  const toParentOccId = resolveExpr(cfg.toParentOccIdExpr, $vars);
  if (occId && toParentOccId) {
    updates.push({
      _effect: "MOVE_OCCURRENCE_TO_PARENT",
      occurrenceId: occId,
      toParentOccurrenceId: toParentOccId,
    });
  }
  break;
}
```

- [ ] **Step 2: Add the effect handler in `bindSocketToStore.js`**

Insert after the existing `case "MOVE_OCCURRENCE":` handler (look for the `applyOperationEffect` switch — the effect goes near other occurrence-mutating cases like `UPDATE_OCCURRENCE`):

```js
case "MOVE_OCCURRENCE_TO_PARENT": {
  const occ = state.occurrencesById?.[effect.occurrenceId];
  if (!occ) break;
  const fromParentId = occ.parentId;

  // 1. Remove from old parent's occurrences[]
  if (fromParentId && fromParentId !== effect.toParentOccurrenceId) {
    const fromParent = state.occurrencesById[fromParentId];
    if (fromParent) {
      updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
        id: fromParentId,
        occurrences: (fromParent.occurrences || []).filter(x => x !== effect.occurrenceId),
      }});
    }
  }

  // 2. Update moved occurrence's parentId
  updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
    id: effect.occurrenceId,
    parentId: effect.toParentOccurrenceId,
  }});

  // 3. Append to new parent's occurrences[]
  const toParent = state.occurrencesById[effect.toParentOccurrenceId];
  if (toParent && !(toParent.occurrences || []).includes(effect.occurrenceId)) {
    updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
      id: effect.toParentOccurrenceId,
      occurrences: [...(toParent.occurrences || []), effect.occurrenceId],
    }});
  }
  break;
}
```

- [ ] **Step 3: Verify build**

Run: `npm --prefix ./client run build`
Expected: success, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationActions.js client/src/state/bindSocketToStore.js
git commit -m "feat(operations): MOVE_OCCURRENCE_TO_PARENT action + effect

Moves an occurrence to a specific destination occurrence (by occurrence ID,
not container module ID). Used by Schedule Auto-Build to sweep due-today todos
into the Due container."
```

---

## Task 4: Shared `mimeToKind` helper

**Files:**
- Create: `client/src/helpers/fileKind.js`

**Background:** The server's `mimeToKind` lives in `server/server.js:318-326`. The client needs the same logic to label its placeholder Module before posting upload. Duplicate the constants — they're tiny — rather than introducing a build step.

- [ ] **Step 1: Create the helper**

```js
// client/src/helpers/fileKind.js
// Mirrors server/server.js mimeToKind. Keep these in sync if the server changes.

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".bash",
  ".json", ".yaml", ".yml", ".toml",
  ".css", ".html", ".xml", ".sql",
  ".go", ".rs", ".c", ".cpp", ".h",
  ".rb", ".php", ".swift", ".kt",
]);

export function mimeToKind(mime, filename = "") {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.includes(".") ? "." + filename.split(".").pop().toLowerCase() : "";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "markdown";
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/helpers/fileKind.js
git commit -m "feat(helpers): add client-side mimeToKind helper mirroring server"
```

---

## Task 5: Server upload accepts existing IDs (upsert)

**Files:**
- Modify: `server/server.js:336-381` (the `/api/artifacts/upload` handler)
- Test: `server/__tests__/artifactUploadOptimistic.test.js`

**Background:** The handler currently always creates a new Module and Occurrence. For the optimistic flow we need it to upsert when `moduleId` + `occurrenceId` are supplied in the FormData, broadcasting `module_updated` instead of `module_created` for existing IDs.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/artifactUploadOptimistic.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

let mongo;
let app;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "tiny.txt");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  // Boot the app — verify how server.js exports it; if no export, this test
  // will need to import the express instance via a small refactor.
  ({ app } = await import("../server.js"));
  await mongoose.connect(mongo.getUri());
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, "hi");
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Module.deleteMany({});
  await Occurrence.deleteMany({});
});

describe("POST /api/artifacts/upload — optimistic IDs", () => {
  it("creates module + occurrence with the supplied IDs when none exist", async () => {
    const res = await request(app)
      .post("/api/artifacts/upload")
      .field("userId", "user_optim")
      .field("gridId", "grid_optim")
      .field("moduleId", "mod_supplied")
      .field("occurrenceId", "occ_supplied")
      .attach("file", fixturePath);
    expect(res.status).toBe(200);
    expect(res.body.module.id).toBe("mod_supplied");
    expect(res.body.occurrence.id).toBe("occ_supplied");

    const mod = await Module.findOne({ id: "mod_supplied" });
    expect(mod.fileRef).toBeTruthy();
    expect(mod.meta?.uploadStatus).toBe("ready");
  });

  it("updates an existing placeholder module (uploadStatus pending → ready) without creating a duplicate", async () => {
    await Module.create({
      id: "mod_placeholder", userId: "user_optim", gridId: "grid_optim",
      role: "artifact", kind: "image", label: "tiny.txt",
      fileRef: null, meta: { uploadStatus: "pending" },
    });
    await Occurrence.create({
      id: "occ_placeholder", userId: "user_optim", gridId: "grid_optim",
      targetType: "module", targetId: "mod_placeholder",
    });

    const res = await request(app)
      .post("/api/artifacts/upload")
      .field("userId", "user_optim")
      .field("gridId", "grid_optim")
      .field("moduleId", "mod_placeholder")
      .field("occurrenceId", "occ_placeholder")
      .attach("file", fixturePath);
    expect(res.status).toBe(200);

    const mods = await Module.find({ id: "mod_placeholder" });
    expect(mods).toHaveLength(1);
    expect(mods[0].fileRef).toBeTruthy();
    expect(mods[0].meta?.uploadStatus).toBe("ready");
  });

  it("falls back to creating new IDs when none provided (existing behavior)", async () => {
    const res = await request(app)
      .post("/api/artifacts/upload")
      .field("userId", "user_optim")
      .field("gridId", "grid_optim")
      .attach("file", fixturePath);
    expect(res.status).toBe(200);
    expect(res.body.module.id).toBeTruthy();
    expect(res.body.module.meta?.uploadStatus).toBe("ready");
  });
});
```

> **NOTE:** If `server.js` doesn't export `app`, add `export { app };` near the bottom (without removing the `app.listen(...)` — the test imports the module but the listen is harmless under a different env). Or guard the listen with `if (process.env.NODE_ENV !== "test") app.listen(...)`. Use whichever pattern other tests in the suite already use.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --prefix ./server test -- artifactUploadOptimistic`
Expected: failures around `mod_supplied` not being honored (server generates a new nanoid).

- [ ] **Step 3: Implement the upsert flow in `server/server.js`**

Replace the body of `app.post("/api/artifacts/upload", upload.single("file"), async (req, res) => { ... })` (lines ~336-381). New body:

```js
try {
  const { userId, gridId, parentFolderId, manifestId } = req.body;
  if (!userId || !req.file) return res.status(400).json({ error: "Missing userId or file" });

  const subfolder = "user";
  const artifactSubdir = path.join(uploadsDir, subfolder);
  fs.mkdirSync(artifactSubdir, { recursive: true });
  const destFileName = req.file.filename;
  const destPath = path.join(artifactSubdir, destFileName);
  fs.renameSync(req.file.path, destPath);
  const fileRef = `${subfolder}/${destFileName}`;
  const kind = mimeToKind(req.file.mimetype, req.file.originalname);
  const { viewType, artifactType } = viewFieldsForKind(kind);

  // Use supplied IDs if present (optimistic flow), otherwise generate fresh ones.
  const moduleId = req.body.moduleId || nanoid();
  const occurrenceId = req.body.occurrenceId || nanoid();

  const existingMod = await Module.findOne({ id: moduleId });
  const isUpdate = !!existingMod;

  const moduleDoc = {
    id: moduleId, userId, gridId: gridId || null,
    role: "artifact", kind,
    label: existingMod?.label || req.file.originalname,
    fileRef, defaultDragMode: "copy",
    meta: {
      ...(existingMod?.meta || {}),
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folderId: parentFolderId || existingMod?.meta?.folderId || null,
      uploadStatus: "ready",
    },
  };
  await Module.findOneAndUpdate({ id: moduleId }, moduleDoc, { upsert: true });

  const existingOcc = await Occurrence.findOne({ id: occurrenceId });
  const occDoc = existingOcc
    ? { ...existingOcc.toObject(), targetType: "module", targetId: moduleId }
    : {
        id: occurrenceId, userId, gridId: gridId || null,
        targetType: "module", targetId: moduleId,
        parentId: parentFolderId || null,
        textmap: kind === "markdown" ? { type: "doc", content: [] } : null,
      };
  // Only create View when occurrence is new (existing occurrences brought their viewId).
  if (!existingOcc) {
    const artifactViewId = nanoid();
    const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
    await artifactView.save();
    occDoc.viewId = artifactViewId;
  }
  await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

  if (manifestId) {
    const manifestView = await View.findOne({ manifestId, userId });
    if (manifestView) {
      manifestView.activeOccurrenceId = occurrenceId;
      await manifestView.save();
      const vc = { ...manifestView.toObject(), id: manifestView.id };
      const cache = cacheByUser[userId];
      if (cache) cache.viewsById[vc.id] = vc;
      io.to(userRoom(userId)).emit("view_updated", vc);
    }
  }

  const modObj = await Module.findOne({ id: moduleId }).lean();
  const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
  const cache = cacheByUser[userId];
  if (cache) {
    cache.modulesById[modObj.id] = modObj;
    cache.occurrencesById[occObj.id] = occObj;
  }

  if (isUpdate) {
    io.to(userRoom(userId)).emit("module_updated", modObj);
  } else {
    io.to(userRoom(userId)).emit("module_created", modObj);
    io.to(userRoom(userId)).emit("occurrence_created", occObj);
  }
  io.to(userRoom(userId)).emit("artifact_created", { moduleId, occurrenceId, fileRef });
  res.json({ module: modObj, occurrence: occObj, fileRef, url: `/artifacts/${fileRef}` });
} catch (err) {
  console.error("Artifact upload error:", err);
  res.status(500).json({ error: err.message });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm --prefix ./server test -- artifactUploadOptimistic`
Expected: 3/3 pass.

- [ ] **Step 5: Run the full server suite**

Run: `npm --prefix ./server test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/__tests__/artifactUploadOptimistic.test.js
git commit -m "feat(server): /api/artifacts/upload accepts moduleId/occurrenceId for optimistic upload

When client supplies IDs (placeholder already dispatched), server upserts the
Module/Occurrence and broadcasts module_updated. Existing flow without IDs is
unchanged."
```

---

## Task 6: ArtifactCard renders spinner when `meta.uploadStatus === "pending"`

**Files:**
- Modify: `client/src/modules/ArtifactCard.jsx`

**Background:** The card currently renders `"No file"` when `fileRef` is missing. Replace that branch with a spinner overlay when `meta.uploadStatus === "pending"`, and an error indicator when `"error"`.

- [ ] **Step 1: Locate the existing Spinner component**

Run: `find client/src -name "spinner*" -o -name "Spinner*"`
Expected: `client/src/ui/spinner.jsx` (or similar).

If not found, search: `grep -rn "export.*Spinner\|export default.*Spinner" client/src/ui/`. Use the existing component — do not create a new one.

- [ ] **Step 2: Update `ArtifactCard.jsx` to handle upload states**

Replace the early-return branch at lines 20-26 with the following block (preserve the rest of the file):

```jsx
import React, { useState, useCallback } from "react";
import { X, Maximize2, AlertCircle } from "lucide-react";
import Spinner from "../ui/spinner.jsx";   // adjust path/name if step 1 found a different export

export default function ArtifactCard({ module, label }) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = module?.fileRef;
  const kind = module?.kind;
  const status = module?.meta?.uploadStatus;
  const src = fileRef ? `/uploads/${fileRef}` : null;

  const toggle = useCallback((e) => {
    e?.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  if (status === "pending") {
    return (
      <div className="artifact-card artifact-card--uploading" data-kind={kind}>
        <Spinner size="md" />
        <span className="artifact-upload-caption">{label || module?.label || "Uploading…"}</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="artifact-card artifact-card--upload-error" data-kind={kind}>
        <AlertCircle size={18} />
        <span className="artifact-upload-caption">{label || module?.label || "Upload failed"}</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="artifact-card artifact-card--empty">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label || "No file"}</span>
      </div>
    );
  }
  // ... rest of file unchanged (expanded branch + thumb branch)
```

- [ ] **Step 3: Add minimal CSS for the new states**

Append to `client/src/index.css` (find the existing `.artifact-card` section first; place these alongside it):

```css
.artifact-card--uploading,
.artifact-card--upload-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  min-height: 80px;
  background: var(--input-bg);
  border: 1px dashed var(--border-default);
  border-radius: 6px;
}
.artifact-upload-caption {
  font-size: 10px;
  color: var(--text-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Build to confirm no syntax errors**

Run: `npm --prefix ./client run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ArtifactCard.jsx client/src/index.css
git commit -m "feat(artifact): render spinner overlay for placeholder uploads

ArtifactCard now branches on module.meta.uploadStatus:
  pending → spinner + filename
  error   → AlertCircle + filename
  ready   → existing thumbnail/preview path"
```

---

## Task 7: `handleFileDrop` optimistic flow

**Files:**
- Modify: `client/src/helpers/dropHandlers.js:485-558`

**Background:** Current flow waits for the upload response before dispatching anything. New flow generates IDs, dispatches placeholder + container update synchronously, then runs the upload in the background. Server upsert (Task 5) handles the placeholder→real swap.

- [ ] **Step 1: Locate existing `createModuleAction` import**

Run: `grep -n "createModuleAction\|createOccurrenceAction\|updateModule" client/src/helpers/dropHandlers.js`
Expected: existing imports near the top of the file. If `updateModule` from `CommitHelpers` is not imported here, add it.

- [ ] **Step 2: Replace the body of `handleFileDrop`**

Replace lines 491-558 with:

```js
export function handleFileDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { payload, panelId, containerId, getCellFromPoint, x, y } = drop;

  const file = payload.data.files[0];
  const cell = getCellFromPoint(x, y);
  const fileGridId = state?.gridId || state?.grid?._id;
  const fileUserId = state?.userId;
  const fileGrid = state?.grid;

  if (!fileGridId || !fileUserId || !fileGrid) { clearSession(); return; }

  const capturedPanelOcc = panelId ? Object.values(occurrencesById).find(o => o.targetId === panelId) : null;
  const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
  const isExistingArtifactPanel = capturedPanelView?.viewType === "display" || capturedPanelView?.hasTree;

  const capturedContainerOcc = containerId
    ? Object.values(occurrencesById).find(o => o.targetId === containerId)
    : null;

  // ── Build placeholder module + occurrence with client-generated IDs ──
  const moduleId = makeUUID();
  const occurrenceId = makeUUID();
  const kind = mimeToKind(file.type, file.name);

  const placeholderModule = {
    id: moduleId,
    userId: fileUserId,
    gridId: fileGridId,
    role: "artifact",
    kind,
    label: file.name,
    fileRef: null,
    defaultDragMode: "copy",
    meta: {
      uploadStatus: "pending",
      originalName: file.name,
      mimeType: file.type,
      uploadSize: file.size,
    },
  };

  const placeholderOccurrence = {
    id: occurrenceId,
    userId: fileUserId,
    gridId: fileGridId,
    targetType: "module",
    targetId: moduleId,
    fields: {},
    meta: {},
  };

  // Optimistic local dispatch (renders the spinner immediately).
  dispatch(createModuleAction(placeholderModule));
  dispatch(createOccurrenceAction(placeholderOccurrence));

  // Wire the placeholder into its destination so the spinner appears in the right spot.
  if (capturedContainerOcc) {
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: capturedContainerOcc.id, occurrences: [...(capturedContainerOcc.occurrences || []), occurrenceId] },
      emit: true,
    });
  } else if (isExistingArtifactPanel && capturedPanelView) {
    CommitHelpers.updateView({ dispatch, socket, view: { ...capturedPanelView, activeOccurrenceId: occurrenceId } });
  } else {
    const targetCell = cell || { row: 0, col: 0 };
    const newPanelModule = { id: makeUUID(), label: file.name || "Uploaded File", role: "panel", kind: "list" };
    const panelResult = LayoutHelpers.createPanelInGrid({
      dispatch, socket, grid: fileGrid, panel: newPanelModule,
      placement: { row: targetCell.row, col: targetCell.col, width: 1, height: 1 },
      userId: fileUserId, emit: true,
    });
    if (panelResult?.occurrence) {
      const viewId = makeUUID();
      const { viewType, artifactType } = viewFieldsForKindClient(kind);
      CommitHelpers.createView({
        dispatch, socket,
        view: { id: viewId, userId: fileUserId, gridId: fileGridId, viewType, artifactType, hasTree: false, manifestId: null, activeOccurrenceId: occurrenceId },
        emit: true,
      });
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelResult.occurrence, viewId }, emit: true });
    }
  }

  // ── Background upload — server upserts using the IDs we just dispatched ──
  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", fileUserId);
  formData.append("gridId", fileGridId);
  formData.append("moduleId", moduleId);
  formData.append("occurrenceId", occurrenceId);

  fetch("/api/artifacts/upload", { method: "POST", body: formData })
    .then(r => r.json())
    .then(({ module: uploadedModule }) => {
      if (uploadedModule?.id) {
        // Local module already exists; reducer is idempotent — this just clears the spinner.
        CommitHelpers.updateModule({ dispatch, socket, module: uploadedModule, emit: false });
      }
    })
    .catch(err => {
      console.error("[FILE DROP] Upload error:", err);
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: moduleId, meta: { ...placeholderModule.meta, uploadStatus: "error" } },
        emit: false,
      });
    });

  clearSession();
}

// Local mirror of server.js viewFieldsForKind (only used when creating an artifact panel).
function viewFieldsForKindClient(kind) {
  if (["image", "video", "audio", "pdf"].includes(kind)) return { viewType: "display", artifactType: kind };
  if (kind === "code") return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}
```

- [ ] **Step 3: Add the `mimeToKind` import at the top of the file**

```js
import { mimeToKind } from "./fileKind.js";
```

Also confirm `makeUUID` and `CommitHelpers.updateModule` are imported. If `updateModule` is missing, add it to the existing `CommitHelpers` import.

- [ ] **Step 4: Verify `CommitHelpers.updateModule` accepts `emit: false`**

Run: `grep -n "export.*updateModule\|updateModule.*=.*function" client/src/helpers/CommitHelpers.js`
Expected: a function signature like `updateModule({ dispatch, socket, module, emit = true })`. If `emit` is not a recognized param, leave it off (the local Redux state already has the truth; we just want to avoid double-emit).

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`
In the browser:
1. Drop an image into a container → spinner should appear immediately.
2. Within ~1-2s the image should replace the spinner.
3. Open dev tools → Network → confirm `/api/artifacts/upload` was called with `moduleId` + `occurrenceId` form fields.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/dropHandlers.js
git commit -m "feat(upload): optimistic file drop — placeholder + spinner before upload

handleFileDrop now generates IDs client-side, dispatches a placeholder Module
(meta.uploadStatus: pending) and Occurrence into Redux + container, then runs
the upload in the background. Server upsert (POST /api/artifacts/upload with
moduleId+occurrenceId) finalizes by clearing uploadStatus."
```

---

## Task 8: Tag schedule slot modules + Todo container + add new instance modules

**Files:**
- Modify: `server/scripts/createTestGrid.js` (STEPs 3 + 4)

**Background:** Three seed-data tweaks that the auto-build operation depends on. No behavior change yet — just metadata + new modules.

- [ ] **Step 1: Tag the slot Modules**

In `server/scripts/createTestGrid.js`, find STEP 4 (around line 244-256) and update the `Module.insertMany([...])` call:

```js
const timeSlots = generateTimeSlots();
const schedContainers = {};
for (const slot of timeSlots) {
  const key = `slot_${slot.hour}_${slot.minute}`;
  schedContainers[key] = { id: uid(), label: slot.label, hour: slot.hour, minute: slot.minute };
}

await Module.insertMany([
  { id: physicalContId,     userId, gridId, role: "container", kind: "list", label: "Physical", styleMode: "own", ownStyle: { bg: "#b44a1a" } },
  { id: physicalGoalContId, userId, gridId, role: "container", kind: "list", label: "Physical", styleMode: "own", ownStyle: { bg: "#b44a1a" } },
  { id: todoGeneralContId,  userId, gridId, role: "container", kind: "list", label: "General",
    defaultDragMode: "move", meta: { todoListContainer: true } },         // ← tag
  ...timeSlots.map(slot => {
    const key = `slot_${slot.hour}_${slot.minute}`;
    return {
      id: schedContainers[key].id, userId, gridId, role: "container", kind: "list",
      label: slot.label,
      meta: {
        scheduleSlot: true,
        slotHour: slot.hour,
        slotMinute: slot.minute,
        slotLabel: slot.label,
      },
    };
  }),
]);
```

- [ ] **Step 2: Add two new instance Modules + IDs**

Near the top of the file (around line 102-122 where existing module IDs are pre-generated), add:

```js
const takeMedicationModId = uid();
const goToGymModId        = uid();
```

In STEP 3 `Module.insertMany([...])` (around line 162-241), add to the array:

```js
{
  id: takeMedicationModId, userId, gridId, role: "instance", kind: "list", label: "Take Medication",
  defaultDragMode: "copy",
  fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
},
{
  id: goToGymModId, userId, gridId, role: "instance", kind: "list", label: "Go to Gym",
  defaultDragMode: "copy",
  fieldBindings: [{ fieldId: completedFieldId, role: "input", order: 0 }],
},
```

- [ ] **Step 3: Wire the new instance modules into the Daily Toolkit Physical container**

Find the section around line 281-298 where `drinkWaterOccId`, `morningRunOccId`, `vitaminsOccId`, `stretchOccId` are created. Add two more occurrences alongside:

```js
const takeMedicationOccId = await mkOcc({
  targetType: "module", targetId: takeMedicationModId,
  meta: { containerId: physicalContId }, fields: {},
});
const goToGymOccId = await mkOcc({
  targetType: "module", targetId: goToGymModId,
  meta: { containerId: physicalContId }, fields: {},
});
```

Then update the `physContOccId = await mkOcc(...)` call (around line 311-314):

```js
const physContOccId = await mkOcc({
  targetType: "module", targetId: physicalContId,
  occurrences: [drinkWaterOccId, morningRunOccId, vitaminsOccId, stretchOccId, takeMedicationOccId, goToGymOccId],
});
```

- [ ] **Step 4: Run the seed script + spot-check**

```bash
node --env-file=server/.env server/scripts/createTestGrid.js josh@jpoms.com
```

Expected: completes without errors. Then in mongo (or via a simple `--debug` query) confirm: a slot module has `meta.scheduleSlot: true, meta.slotLabel: "7:00am"`.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "chore(seed): tag schedule slot + todo modules; add Take Medication + Go to Gym

Slot modules now carry meta.{scheduleSlot,slotHour,slotMinute,slotLabel}.
Todo container module carries meta.todoListContainer = true. Two new instance
modules wired into the Daily Toolkit Physical container so the upcoming
Schedule Auto-Build operation can FIND_OCCURRENCE them by label."
```

---

## Task 9: Remove pre-creation + SCHEDULE_PREFILL from seed

**Files:**
- Modify: `server/scripts/createTestGrid.js` (STEP 6 — slot occurrence loop + prefill loop)

**Background:** With the auto-build operation about to land (Task 10), the seed should not pre-create per-day slot occurrences or fill them with sample data. The Schedule page seeds with an empty `occurrences: []` and the operation populates it on first load.

- [ ] **Step 1: Delete the slot occurrence loop**

Find lines ~358-372:

```js
// Schedule slot container occurrences (created before pre-fill so we know each slot's id)
const slotOccByKey = {};
const scheduleOccIds = [];
for (const slot of timeSlots) {
  ...
}
```

Delete the entire block. Replace with:

```js
// Schedule slots are created on demand by the "Schedule: Auto-Build for Active Date"
// operation when the user navigates to a date that doesn't have slot occurrences yet.
const scheduleOccIds = [];
```

- [ ] **Step 2: Delete the SCHEDULE_PREFILL loop**

Find lines ~374-411 (the `for (const entry of SCHEDULE_PREFILL)` block) and delete it entirely. Also delete the `SCHEDULE_PREFILL` constant declaration at lines 59-68 — it's no longer referenced.

- [ ] **Step 3: Verify the seed still runs**

```bash
node --env-file=server/.env server/scripts/createTestGrid.js josh@jpoms.com
```

Expected: completes. Schedule page exists with `occurrences: []`.

- [ ] **Step 4: Update the file's top comment block**

Lines 16-30 describe the "Schedule pre-fill" expectations. Replace with:

```js
//   [0,1] Center Hub ×2  — Schedule (slots created on-demand) | Notes
//
// Schedule slots and the preset routine (Drink Water / Take Medication / Go to Gym)
// are created automatically by the "Schedule: Auto-Build for Active Date" operation
// the first time the user opens or navigates to a given date. Re-running the
// operation on the same date is a no-op.
```

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "chore(seed): remove schedule pre-fill — auto-build operation owns it

Schedule slots and preset routine are now created by the operation pipeline on
first load/filter-change for any date. Seed produces an empty Schedule page."
```

---

## Task 10: Schedule Auto-Build operation

**Files:**
- Modify: `server/scripts/createTestGrid.js` (STEP 12 — operations section)

**Background:** The big one. This adds a new operation with five step groups (locate schedule → ensure Due → ensure 48 slots → seed presets → sweep due todos). Idempotent across re-runs on the same date.

- [ ] **Step 1: Add the operation block after the existing "Tasks Completed Today" operation**

In `server/scripts/createTestGrid.js` STEP 12, after the existing "Tasks Completed Today" `await new Operation({ ... }).save();` block (ends around line 635), insert:

```js
await new Operation({
  id: uid(), userId, gridId, name: "Schedule: Auto-Build for Active Date",
  description:
    "On load and filter change: ensure 48 timeslot containers + Due container exist for the active date. " +
    "On a fresh day, also seed three preset items (Drink Water 7am, Take Medication 8am, Go to Gym 9am) " +
    "and move any todos whose dueDate matches into the Due container.",
  triggerTypes: ["onLoad", "onFilterChange"],
  triggerObjects: [
    { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
    { eventType: "onFilterChange", subjectType: "filterNav", targetId: "" },
  ],
  enabled: true,
  pipeline: {
    sources: [
      { id: uid(), variableName: "triggerType", entityType: "trigger", triggerProp: "type" },
    ],
    steps: [
      // ── 1. Locate schedule page ─────────────────────────────────────────
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$slotsCreated", value: 0 } },
      { id: uid(), type: "action", config: {
          type: "FIND_OCCURRENCE",
          moduleLabelExpr: "literal:Schedule",
          resultVar: "$schedPage",
          resultIdVar: "$schedPageId",
      }},
      {
        id: uid(), type: "if",
        condition: { operator: "AND", rules: [{ id: uid(), left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
        then: [
          // ── 2. Ensure Due container module exists, then per-day occurrence ──
          { id: uid(), type: "action", config: {
              type: "FIND_MODULE",
              nameExpr: "literal:Due",
              resultVar: "$dueMod",
              resultIdVar: "$dueModId",
          }},
          {
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$dueModId", comparator: "IS_EMPTY", right: "" }] },
            then: [
              { id: uid(), type: "action", config: {
                  type: "CREATE_MODULE",
                  nameExpr: "literal:Due",
                  role: "container",
                  kind: "list",
                  extra: { meta: { scheduleDueContainer: true } },
              }},
              // CREATE_MODULE sets $lastCreatedModuleId; copy into $dueModId for the rest of the pipeline.
              { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$dueModId", expr: "$lastCreatedModuleId" } },
            ],
            else: [],
          },
          { id: uid(), type: "action", config: {
              type: "FIND_OCCURRENCE",
              targetIdExpr: "$dueModId",
              dateFieldId: dateFieldId,
              dateExpr: "$activeDate",
              resultVar: "$dueOcc",
              resultIdVar: "$dueOccId",
          }},
          {
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$dueOccId", comparator: "IS_EMPTY", right: "" }] },
            then: [
              { id: uid(), type: "action", config: {
                  type: "CREATE_OCCURRENCE_FOR_MODULE",
                  moduleIdExpr: "$dueModId",
                  parentIdExpr: "$schedPageId",
                  dateFieldId: dateFieldId,
                  dateExpr: "$activeDate",
                  insertAtIndex: 0,
                  resultIdVar: "$dueOccId",
              }},
              { id: uid(), type: "action", config: {
                  type: "SET_FIELD_VALUE",
                  occurrenceIdExpr: "$dueOccId",
                  fieldId: timeslotFieldId,
                  value: "Due",
              }},
            ],
            else: [],
          },

          // ── 3. Ensure 48 slot occurrences exist for the active date ──
          {
            id: uid(), type: "loop", overExpr: "$allModules", as: "$slotMod",
            body: [{
              id: uid(), type: "if",
              condition: { operator: "AND", rules: [
                { id: uid(), left: "$slotMod.meta.scheduleSlot", comparator: "IS", right: true },
              ]},
              then: [
                { id: uid(), type: "action", config: {
                    type: "FIND_OCCURRENCE",
                    targetIdExpr: "$slotMod.id",
                    dateFieldId: dateFieldId,
                    dateExpr: "$activeDate",
                    resultVar: "$slotOcc",
                    resultIdVar: "$slotOccId",
                }},
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [{ id: uid(), left: "$slotOccId", comparator: "IS_EMPTY", right: "" }] },
                  then: [
                    { id: uid(), type: "action", config: {
                        type: "CREATE_OCCURRENCE_FOR_MODULE",
                        moduleIdExpr: "$slotMod.id",
                        parentIdExpr: "$schedPageId",
                        dateFieldId: dateFieldId,
                        dateExpr: "$activeDate",
                        resultIdVar: "$newSlotOccId",
                    }},
                    { id: uid(), type: "action", config: {
                        type: "SET_FIELD_VALUE",
                        occurrenceIdExpr: "$newSlotOccId",
                        fieldId: timeslotFieldId,
                        valueExpr: "$slotMod.meta.slotLabel",
                    }},
                    { id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$slotsCreated", by: 1 } },
                  ],
                  else: [],
                },
              ],
              else: [],
            }],
          },

          // ── 4. Seed preset routine (only on a freshly-built day) ──
          {
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$slotsCreated", comparator: "GREATER_THAN", right: 0 }] },
            then: [
              ...presetSeedSteps({ slotLabel: "7:00am", moduleLabel: "Drink Water",     dateFieldId, timeslotFieldId, completedFieldId, uid }),
              ...presetSeedSteps({ slotLabel: "8:00am", moduleLabel: "Take Medication", dateFieldId, timeslotFieldId, completedFieldId, uid }),
              ...presetSeedSteps({ slotLabel: "9:00am", moduleLabel: "Go to Gym",       dateFieldId, timeslotFieldId, completedFieldId, uid }),
            ],
            else: [],
          },

          // ── 5. Sweep todos with dueDate === activeDate into Due ──
          { id: uid(), type: "action", config: {
              type: "FIND_OCCURRENCE",
              moduleMetaKey: "todoListContainer",
              moduleMetaValue: true,
              resultVar: "$todoCont",
              resultIdVar: "$todoContId",
          }},
          {
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ id: uid(), left: "$todoContId", comparator: "IS_NOT_EMPTY", right: "" }] },
            then: [
              {
                id: uid(), type: "loop", overExpr: "$todoCont.occurrences", as: "$todoChildId",
                body: [
                  { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$todoChildOcc", expr: "$allOccurrences[$todoChildId]" } },
                  {
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      { id: uid(), left: `$todoChildOcc.fields.${dueFieldId}.value`, comparator: "SAME_DAY", right: "$activeDate" },
                    ]},
                    then: [
                      { id: uid(), type: "action", config: {
                          type: "MOVE_OCCURRENCE_TO_PARENT",
                          occurrenceIdExpr: "$todoChildId",
                          toParentOccIdExpr: "$dueOccId",
                      }},
                      { id: uid(), type: "action", config: {
                          type: "SET_FIELD_VALUE",
                          occurrenceIdExpr: "$todoChildId",
                          fieldId: dateFieldId,
                          valueExpr: "$activeDate",
                      }},
                    ],
                    else: [],
                  },
                ],
              },
            ],
            else: [],
          },
        ],
        else: [],
      },
    ],
  },
}).save();
```

- [ ] **Step 2: Add the `presetSeedSteps` helper near the top of the file**

After the `SCHEDULE_PREFILL` const used to live (now deleted in Task 9), add this helper right above `export async function createTestGrid(...)`:

```js
// Build the per-preset block of steps used by the Schedule Auto-Build operation.
// Each preset is a FIND_OCCURRENCE (source instance) + FIND_OCCURRENCE (target slot for active date)
// + CREATE_OCCURRENCE_FOR_MODULE + 2 SET_FIELD_VALUE (timeslot label, completed=false).
function presetSeedSteps({ slotLabel, moduleLabel, dateFieldId, timeslotFieldId, completedFieldId, uid }) {
  const sourceVar = `$src_${slotLabel.replace(/[^a-z0-9]/gi, "")}`;
  const slotVar   = `$slot_${slotLabel.replace(/[^a-z0-9]/gi, "")}`;
  const newOccVar = `$newOcc_${slotLabel.replace(/[^a-z0-9]/gi, "")}`;
  return [
    { id: uid(), type: "action", config: {
        type: "FIND_OCCURRENCE",
        moduleLabelExpr: `literal:${moduleLabel}`,
        resultVar: sourceVar,
    }},
    { id: uid(), type: "action", config: {
        type: "FIND_OCCURRENCE",
        moduleMetaKey: "scheduleSlot",
        moduleMetaValue: true,
        moduleMetaSecondaryKey: "slotLabel",
        moduleMetaSecondaryValue: slotLabel,
        dateFieldId,
        dateExpr: "$activeDate",
        resultIdVar: `${slotVar}Id`,
    }},
    { id: uid(), type: "action", config: {
        type: "CREATE_OCCURRENCE_FOR_MODULE",
        moduleIdExpr: `${sourceVar}.targetId`,
        parentIdExpr: `${slotVar}Id`,
        dateFieldId,
        dateExpr: "$activeDate",
        resultIdVar: newOccVar,
    }},
    { id: uid(), type: "action", config: {
        type: "SET_FIELD_VALUE",
        occurrenceIdExpr: newOccVar,
        fieldId: timeslotFieldId,
        value: slotLabel,
    }},
    { id: uid(), type: "action", config: {
        type: "SET_FIELD_VALUE",
        occurrenceIdExpr: newOccVar,
        fieldId: completedFieldId,
        value: false,
    }},
  ];
}
```

- [ ] **Step 3: Extend `FIND_OCCURRENCE` action to support meta-key lookup**

The pipeline above uses two new config keys: `moduleMetaKey/moduleMetaValue` (single-key match for the Due + Todo lookups) and `moduleMetaSecondaryKey/moduleMetaSecondaryValue` (compound match for slot-by-label-on-date). Open `client/src/helpers/operationActions.js` `case "FIND_OCCURRENCE"` (line 791) and extend candidate-narrowing logic:

```js
case "FIND_OCCURRENCE": {
  const targetId = resolveExpr(cfg.targetIdExpr, $vars);
  const moduleLabel = resolveExpr(cfg.moduleLabelExpr, $vars) || cfg.moduleLabel;
  const allOccurrences = $vars.$allOccurrences || occurrencesById || {};
  const allModules = $vars.$allModules || [];
  let found = null;

  let effectiveTargetIds = [];
  if (targetId) {
    effectiveTargetIds = [targetId];
  } else if (moduleLabel) {
    const mod = allModules.find(m => m.label?.toLowerCase() === moduleLabel.toLowerCase());
    if (mod) effectiveTargetIds = [mod.id];
  } else if (cfg.moduleMetaKey) {
    // Match modules by meta key/value (and optional secondary key/value).
    const matches = allModules.filter(m => {
      const v = m?.meta?.[cfg.moduleMetaKey];
      if (v !== cfg.moduleMetaValue) return false;
      if (cfg.moduleMetaSecondaryKey) {
        return m?.meta?.[cfg.moduleMetaSecondaryKey] === cfg.moduleMetaSecondaryValue;
      }
      return true;
    });
    effectiveTargetIds = matches.map(m => m.id);
  }

  if (effectiveTargetIds.length > 0) {
    const occList = Array.isArray(allOccurrences) ? allOccurrences : Object.values(allOccurrences);
    const candidates = occList.filter(o =>
      effectiveTargetIds.includes(o.targetId) && !o.deleted && !o.meta?.isTemplate
    );

    if (cfg.dateFieldId) {
      const targetDateStr = resolveExpr(cfg.dateExpr, $vars) || resolveExpr("$today", $vars);
      if (targetDateStr) {
        const refDate = new Date(targetDateStr.length <= 10 ? targetDateStr + "T00:00:00" : targetDateStr);
        found = candidates.find(o => {
          const fv = o.fields?.[cfg.dateFieldId];
          const val = fv?.value !== undefined ? fv.value : fv;
          if (!val) return false;
          const d = new Date(val);
          return !isNaN(d.getTime()) && d.toDateString() === refDate.toDateString();
        }) || null;
      }
    } else {
      found = candidates[0] || null;
    }
  }
  $vars[cfg.resultVar || "$foundOccurrence"] = found || null;
  $vars[cfg.resultIdVar || "$foundOccurrenceId"] = found?.id || null;
  break;
}
```

- [ ] **Step 4: Confirm `INIT_VAR` supports an `expr` field**

Run: `grep -n 'case "INIT_VAR"' client/src/helpers/operationActions.js`
Then read the case body. The plan uses `INIT_VAR` with `expr: "$lastCreatedModuleId"` — confirm the case handles `cfg.expr` (resolves via `resolveExpr`). If only `value` is supported, add an `expr` branch:

```js
case "INIT_VAR": {
  const value = cfg.expr !== undefined ? resolveExpr(cfg.expr, $vars) : cfg.value;
  $vars[cfg.name] = value;
  break;
}
```

- [ ] **Step 5: Reset the test grid + verify the operation registered**

```bash
node --env-file=server/.env server/scripts/createTestGrid.js josh@jpoms.com
```

Expected: completes; check the Operations collection has "Schedule: Auto-Build for Active Date".

- [ ] **Step 6: Smoke test in the browser**

```bash
npm run dev
```

In the browser:
1. Refresh the page → Schedule panel should populate with 48 slots + Due at top + 3 preset items in 7am/8am/9am slots.
2. Click the date nav forward arrow → tomorrow's schedule populates with the same shape.
3. Click backward → today's schedule still intact.

If presets don't appear, open dev console + run `window.__moduli_state__.operationsById` to confirm the op exists; check for executor errors.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/createTestGrid.js client/src/helpers/operationActions.js
git commit -m "feat(operations): Schedule Auto-Build for Active Date

Single op runs onLoad + onFilterChange. Locates the Schedule page, ensures the
Due container module + per-day occurrence exist, ensures 48 slot occurrences
exist for the active date, seeds Drink Water/Take Medication/Go to Gym on a
freshly-built day, and sweeps todos whose dueDate matches the active date
into Due. Idempotent across re-runs on the same date.

Extends FIND_OCCURRENCE to support module-meta lookup
(moduleMetaKey/moduleMetaValue + optional secondary pair) so the pipeline
finds slot/Due/todo containers without label collisions."
```

---

## Task 11: Replace "Schedule: Clear Date" with onMove + HAS_ANCESTOR

**Files:**
- Modify: `server/scripts/createTestGrid.js` (replaces lines ~655-669)

**Background:** The existing op fires `onMove` and always clears date+timeslot. The replacement uses `HAS_ANCESTOR` to check whether the moved occurrence is *still* under the Schedule page — only clears when it has actually left. Copy creates a new occurrence (different ID, fires `OccurrenceCreateOp`, NOT `onMove`) so copy semantics are preserved automatically.

- [ ] **Step 1: Replace the existing operation block**

Find the existing "Schedule: Clear Date & Time Slot" `await new Operation({ ... }).save();` (around lines 655-669). Replace it with:

```js
await new Operation({
  id: uid(), userId, gridId, name: "Schedule: Clear Date on Move-Out",
  description:
    "When an occurrence is moved (not copied), check whether it still lives under the Schedule page. " +
    "If it has been moved out of the schedule, clear its date + timeslot fields. Copy creates a new " +
    "occurrence with a different ID, so this op naturally does not fire on copy.",
  triggerTypes: ["onMove"],
  triggerObjects: [
    { eventType: "onMove", subjectType: "occurrence", targetId: "" },
  ],
  enabled: true,
  pipeline: {
    sources: [
      { id: uid(), variableName: "self", entityType: "trigger", triggerProp: "occurrenceId" },
    ],
    steps: [
      { id: uid(), type: "action", config: {
          type: "FIND_OCCURRENCE",
          moduleLabelExpr: "literal:Schedule",
          resultVar: "$schedPage",
          resultIdVar: "$schedPageId",
      }},
      // Wrap the check in a single-iteration loop so the executor populates $self._ancestors.
      {
        id: uid(), type: "loop", overExpr: "[$self]", as: "$selfId",
        body: [{
          id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$selfId._ancestors", comparator: "NOT_HAS_ANCESTOR", right: "$schedPageId" },
          ]},
          then: [
            { id: uid(), type: "action", config: {
                type: "SET_FIELD_VALUE",
                occurrenceIdExpr: "$selfId.id",
                fieldId: dateFieldId,
                value: null,
            }},
            { id: uid(), type: "action", config: {
                type: "SET_FIELD_VALUE",
                occurrenceIdExpr: "$selfId.id",
                fieldId: timeslotFieldId,
                value: null,
            }},
          ],
          else: [],
        }],
      },
    ],
  },
}).save();
```

- [ ] **Step 2: Add `NOT_HAS_ANCESTOR` comparator if missing**

Run: `grep -n 'NOT_HAS_ANCESTOR\|HAS_ANCESTOR' client/src/helpers/operationActions.js`
Expected: `HAS_ANCESTOR` exists. If `NOT_HAS_ANCESTOR` doesn't exist, add it next to `HAS_ANCESTOR` in `evalRule` (search for the `case "HAS_ANCESTOR":` line):

```js
case "HAS_ANCESTOR":
case "ARRAY_INCLUDES":
  return Array.isArray(leftVal) && leftVal.includes(rightVal);
case "NOT_HAS_ANCESTOR":
  return !(Array.isArray(leftVal) && leftVal.includes(rightVal));
```

- [ ] **Step 3: Confirm the loop executor handles the literal-array form `"[$self]"`**

Run: `grep -n 'overExpr\|gatherLoopItems' client/src/helpers/operationExecutor.js | head -20`
Then read the loop branch around line 817-828. If `overExpr` is parsed as a JS expression (`resolveExpr`), `[$self]` should work — verify by reading `resolveExpr` for array-literal handling. If it doesn't resolve `[$var]` patterns, fall back to: declare `$selfArr` via `INIT_VAR` first, then loop `overExpr: "$selfArr"`.

If `INIT_VAR` doesn't have a way to set an array literal, add a small case to `INIT_VAR`:

```js
case "INIT_VAR": {
  let value;
  if (cfg.expr !== undefined) value = resolveExpr(cfg.expr, $vars);
  else if (cfg.arrayOf !== undefined) value = (Array.isArray(cfg.arrayOf) ? cfg.arrayOf : [cfg.arrayOf]).map(x => resolveExpr(x, $vars));
  else value = cfg.value;
  $vars[cfg.name] = value;
  break;
}
```

…and rewrite the loop wrapper as:

```js
{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$selfArr", arrayOf: ["$self"] } },
{ id: uid(), type: "loop", overExpr: "$selfArr", as: "$selfItem", body: [ ... use $selfItem._ancestors ... ] },
```

- [ ] **Step 4: Reset + smoke**

```bash
node --env-file=server/.env server/scripts/createTestGrid.js josh@jpoms.com
npm run dev
```

In the browser:
1. Open the schedule, find the 7am Drink Water item.
2. Drag it (move mode — hold whatever key/gesture forces move) into a non-schedule container, e.g. the Daily Toolkit Physical container.
3. Confirm: the moved occurrence's date and timeslot fields are now empty (right-click → inspect, or check via dev console: `window.__moduli_state__.occurrencesById[<id>].fields`).
4. Drag again, this time copy (default for the toolkit instances): a new occurrence appears in the destination, the original stays in the schedule with its date/timeslot intact.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createTestGrid.js client/src/helpers/operationActions.js
git commit -m "feat(operations): Clear schedule date on move-out (preserve on copy)

Replaces the unconditional onMove clear with a HAS_ANCESTOR check against the
Schedule page. Move out → clear date + timeslot. Copy creates a new occurrence
(different ID, fires OccurrenceCreateOp not onMove), so copy keeps fields."
```

---

## Task 12: End-to-end manual smoke + integration script

**Files:**
- Create: `server/scripts/testScheduleAutoBuild.js`

**Background:** Operation pipelines are notoriously hard to unit-test in isolation because they need the executor + the full state shape. A small Node script that boots a real cache, runs `createTestGrid`, then calls the operation and asserts the resulting state is the most useful regression check.

- [ ] **Step 1: Create the integration script**

```js
// server/scripts/testScheduleAutoBuild.js
// Run: node --env-file=.env server/scripts/testScheduleAutoBuild.js
//
// Boots a fresh Test Grid, then exercises the Schedule Auto-Build operation
// across two simulated dates and a move-out. Prints PASS/FAIL per scenario.

import "dotenv/config";
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";
import { dropExistingTestGrid, createTestGrid } from "./createTestGrid.js";
import User from "../models/User.js";

const TEST_EMAIL = "josh@jpoms.com";

function assert(cond, msg) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) process.exitCode = 1;
}

async function countSlotsForDate(gridId, dateISO) {
  // Count slot occurrences where dateField value matches the ISO date.
  const slotMods = await Module.find({ gridId, "meta.scheduleSlot": true });
  const slotIds = slotMods.map(m => m.id);
  const occs = await Occurrence.find({ gridId, targetId: { $in: slotIds } }).lean();
  return occs.filter(o => {
    const dateField = Object.values(o.fields || {}).find(f => {
      const v = f?.value ?? f;
      return typeof v === "string" && new Date(v).toDateString() === new Date(dateISO).toDateString();
    });
    return !!dateField;
  }).length;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: TEST_EMAIL });
  if (!user) throw new Error(`User ${TEST_EMAIL} not found — run scripts/createTestUser.js first.`);

  console.log("Resetting Test Grid…");
  await dropExistingTestGrid(user.id);
  const result = await createTestGrid(user.id);
  console.log(`Created grid ${result.gridId}.`);

  console.log("\n[Scenario 1] Schedule starts empty after seed");
  const initialOccs = await Occurrence.countDocuments({ gridId: result.gridId, targetId: { $in: (await Module.find({ gridId: result.gridId, "meta.scheduleSlot": true })).map(m => m.id) } });
  assert(initialOccs === 0, `0 slot occurrences before any operation run (got ${initialOccs})`);

  console.log("\n[Scenario 2] Auto-Build is registered");
  const autoBuild = await Operation.findOne({ gridId: result.gridId, name: "Schedule: Auto-Build for Active Date" });
  assert(!!autoBuild, "operation present in DB");

  console.log("\n[Scenario 3 & beyond] Run executor in-app via npm run dev — these scripted scenarios verify static state only.");
  console.log("Manually verify in the browser:");
  console.log("  a. Open the app — schedule populates with 48 slots + Due at top + 3 presets.");
  console.log("  b. Navigate to tomorrow — tomorrow populates similarly.");
  console.log("  c. Navigate back — today's slots intact.");
  console.log("  d. Add a todo with dueDate=tomorrow, switch to tomorrow — todo appears in Due.");
  console.log("  e. Drag a slot occurrence out (move) — its date/timeslot clears.");
  console.log("  f. Drag a slot occurrence out (copy) — original keeps fields, new copy has them too.");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script**

```bash
node --env-file=server/.env server/scripts/testScheduleAutoBuild.js
```

Expected: PASS lines for the static scenarios (1, 2). The runtime scenarios (3+) require the dev server.

- [ ] **Step 3: Boot the dev server + walk the manual scenarios**

```bash
npm run dev
```

Open the app and run through scenarios a-f from the script output. Mark each in the script comments as verified or note any deviations. Fix any divergences encountered (the operation pipeline is the most likely culprit; check the per-op run log via `getLastOpLog` if executor errors are silent).

- [ ] **Step 4: Commit + push**

```bash
git add server/scripts/testScheduleAutoBuild.js
git commit -m "test(seed): add scripted reset-and-verify for Schedule Auto-Build

Resets the Test Grid via dropExistingTestGrid + createTestGrid, then asserts
that the operation is wired and that no slot occurrences exist before the
client runs onLoad. Lists manual browser scenarios that cover the executor
behavior."
```

---

## Self-Review

- **Spec coverage:** §1 file upload → Tasks 4–7. §2 per-day slots → Task 8. §3 Auto-Build operation → Task 10. §4 Move-out clears date → Task 11. §5a server auto-push → Task 1. §5b MOVE_OCCURRENCE_TO_PARENT → Task 3. §5c new modules + Todo tagging → Task 8. Testing plan §7 → Tasks 1, 5, 12 + manual smoke embedded in 6, 7, 10, 11.
- **Placeholders:** No "TBD" / "TODO" / "implement later". Every code block is complete.
- **Type consistency:** `moduleMetaKey/moduleMetaValue` (single match) and `moduleMetaSecondaryKey/moduleMetaSecondaryValue` (compound) are used in both Task 10's pipeline and Task 10 Step 3's `FIND_OCCURRENCE` handler — consistent. `meta.uploadStatus` literal "pending"/"ready"/"error" used in Tasks 5, 6, 7 — consistent. `MOVE_OCCURRENCE_TO_PARENT` config keys `occurrenceIdExpr` + `toParentOccIdExpr` consistent across action (Task 3) and pipeline use (Task 10). `insertAtIndex` (lowercase a) consistent across Tasks 1, 2, 10.
- **One known gap to flag for the implementer:** Task 11 Step 3 checks if the executor's `resolveExpr` understands the literal-array form `"[$self]"`. If not, fall back to the `INIT_VAR arrayOf` pattern shown in Step 3. This is a contingency, not a blocker.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-schedule-build-and-upload.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
