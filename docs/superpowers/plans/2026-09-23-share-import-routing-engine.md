# Share → Import Routing: Engine + Browser Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a link from the browser and have a rule you wrote decide what it becomes — proving the whole share spine end to end, with no PWA work.

**Architecture:** One endpoint (`POST /api/v1/share`) classifies a payload, prepares it (uploads files, fetches metadata), and dispatches an `onShare` operation that runs **server-side**. Rules are ordinary operation pipelines authored in a new Command Center Imports tab. Every content handler but `.ics` already exists; this is a routing and configuration layer over them.

**Tech Stack:** Node ESM · Express · Mongoose · Socket.io · vitest (server) · React + vitest (client)

**Spec:** `docs/superpowers/specs/2026-09-23-share-import-routing-design.md` (20 decisions — read it first; this plan argues from it)

## Scope: this is Plan 1 of 3

The spec covers three independently shippable pieces. Each produces working software on its own:

| plan | delivers | depends on |
|---|---|---|
| **1 — this one** | executor writes server-side · `/share` · rules · Imports tab · extension re-routed | — |
| 2 — `.ics` | `services/icsImport.js`, slot flooring, the shipped ics rule binding four fields | Plan 1 |
| 3 — phone/Windows transport | manifest `share_target`, service worker, `file_handlers`, 500 MB cap | Plan 1 |

Plan 1 ends with: **right-click clip in the browser → a rule you wrote → a row on the grid.**

## Progress (updated 2026-09-24)

| task | state | where |
|---|---|---|
| 1 extract the mint | done | `feat/share-import-routing` |
| 2 CREATE | done | `feat/share-import-routing` |
| 3 FIND | done | `feat/share-import-routing` |
| 4 classify | done (+ F1–F5 fixes) | `feat/share-import-routing` |
| 5 rule engine | done — adapted, see below | `claude/share-input-routing-plan-pigwol` |
| 6 catch-all bootstrap | done — adapted | same |
| 7 `POST /share` | done — links, text **and files** (files added 2026-09-24) | merged via PR |
| 8 Imports tab — rules editor | done — see deviations | merged via PR |
| 9 Imports tab — recent-shares log | done — see deviations | merged via PR |
| 10 re-route the extension | done — **verified on prod 2026-09-24** (Firefox, test grid 2) | merged |

**Where the sketches below did not match the code** (the code is what shipped):
- Triggers are `triggerObjects[{ eventType: "onShare", shareType }]`, not `triggers[{ type }]`.
- `runOperationServerSide` only exposed SHOW_VALUE output, so it now also returns `scope`; without
  that, a rule's `$share.handled` could never halt the chain.
- The Files folder is a `Folder`, not an `Occurrence` — CREATE gained `parentFolderId`.
- The catch-all mints only when ingress did NOT already upload a file (an upload is its own row).
- `services/artifactUpload.js` did not exist; the upload lived inline in `server.js`. It is now that
  service, moved VERBATIM (only `req.file`→`file` and `res.json`→`return` changed), and both
  `/api/artifacts/upload` and `/share` call it. `services/shareFiles.js` makes a shared file
  idempotent on its bytes (`sha256:<hash>` stamped on the occurrence), since the upload route makes a
  new placement every time. Plan 3's Task 2 (500 MB share cap, `config/uploadLimits.js`) is done here
  too, plus `deploy/nginx/moduli.conf` raising nginx's 64 MB cap for `/api/v1/share` only — the LIVE
  nginx config needs that edit by hand (it was installed once by provision.sh).
- `User` had no `meta`; `meta.share.gridId` (D10) is now a field.
- **Decision 2026-09-24 (user: "add pdfs to the documents folder"):** `serverExecutor` gains
  `MOVE_OCCURRENCE` (the client's config: `occurrenceIdExpr`, `toContainerId`) — a shared FILE is uploaded
  into Files before any rule runs, so filing it elsewhere is a MOVE; a CREATE would leave the file in two
  places. Both ends are checked to be on this grid. This is the third action beyond the plan's CREATE + FIND.
- **Task 8:** the editor's CREATE is written as `name/parent/role/kind/attachFields`, which the server
  executor did not read — a rule built by clicking would have made rows with no name and no parent. The
  server now reads both spellings, and keys a share rule's CREATE with no externalId on
  `<share externalId>::<step id>[::<loop index>]`. The "stop here" checkbox is the D9 halt (a
  `SET_VAR $share.handled` step). Share rules are hidden from the Operations tab, whose trigger editor
  does not know `onShare`. The catch-all can be switched off but not deleted from the tab (D3).
- **Task 9:** the existing run log (`getOpRunHistory`) is in the BROWSER and never sees a rule the
  server ran, so it could not be the log. `Grid.shareLog` (top-level, capped at 50 by an atomic
  `$push/$slice`, metadata only) is appended for every share — failures included (§12) — and pushed to
  open tabs as `grid_updated`. It says where each created row landed rather than linking to it: a row in
  the Files folder has no page to open.
- **Prod check (Task 10 Step 6), read back through `/api/v1/occurrences`:** page, selection, link and
  image clips on test grid 2 all landed in `Root / Files` (`3684044d…`, the protected folder) with
  `source: "clip"`; clipping the same page twice left ONE row. It also found a defect: an image on a
  Google results page is a `data:` URL, which classified as a bare `file` and derived externalId
  `text:` (empty) — every such image would share one identity. Fixed: the clip's own externalId wins.
  Also found: the extension's notification icon never existed, so no outcome was ever shown (fixed),
  and Firefox reads only `manifest.json` (the separate Firefox manifest was removed).
- **Task 10:** there is no separate shipped `link` rule (D18 allows bootstrap to mint only the
  catch-all). The extension still builds its record and sends it as `$share.clip`; the catch-all's
  first branch writes it exactly as `/ingest` did (`source: "clip"`, `<shape>:<url>`, same fields, the
  module reused by `fileRef`). A user `link` rule that halts takes over. `shareToClipRecord` was not
  needed — the compat test drives `buildClipRecord` itself through the real pipeline. Deliberate
  change: a clip with no destination lands in Files instead of unfiled. A catch-all minted before
  this is upgraded in place unless `meta.userEdited` is set.

## Global Constraints

Copied verbatim from the spec and this repo's standing rules. Every task's requirements implicitly include this section.

- **Auth is `Bearer` only.** Verified 2026-09-23: no cookie middleware, no `res.cookie`, no `req.cookies` anywhere in `server/`. Never add cookie auth in this plan.
- **Neither router may own a handler** (spec §9). The share engine calls existing services. If you find yourself writing a second uploader or a second bookmark minter, stop — the design is wrong.
- **Only `CREATE` and `FIND`** are added to `serverExecutor` (spec §5). Anything else a rule turns out to need is a separate decision, recorded rather than smuggled in.
- **`CREATE` must set `fieldBindings`, not only `fields`** (D17). A value on an unbound field renders nowhere and is invisible to ops that gate on `_boundFieldIds`.
- **Bootstrap mints the catch-all only** (D18). poms' typed rules are seeded by hand as data (D19), never by code.
- **Idempotency is `externalId`** (spec §7), the key `/api/v1/ingest` already implements.
- **Server tests:** `cd server && npx vitest run <path>`. Client: `cd client && ./node_modules/.bin/vitest run <path>`.
- **A/B every behavioural fix**, and *assert the mutation landed* before believing the result (print a count of the thing you removed). This repo has recorded vacuous A/Bs three times.
- **Deploy:** `./deploy.sh "<msg>"` from the repo root. It runs `git add -A` — it commits the whole working tree, not just your files.
- **Verify on prod by doing the thing.** A feature is unverified until someone has watched it work.

---

## File Structure

**Created**

| file | responsibility |
|---|---|
| `server/services/occurrenceMint.js` | The one way the server mints a module+occurrence with bindings. Extracted from the ingest route so the executor's `CREATE` cannot grow a second copy. |
| `server/services/shareClassify.js` | Payload → `{ type, ...catalogue props }`. Pure; no I/O. |
| `server/services/shareIngress.js` | Prepares `$share`: uploads files, fetches link metadata. The only place in the share path that does I/O before a rule runs. |
| `server/services/shareRules.js` | Selects and runs the matching `onShare` operations in priority order, honouring the halt flag. |
| `server/utils/shareRulesEnsure.js` | Find-or-mint the catch-all rule. Mirrors `utils/protectedFoldersEnsure.js`. |
| `client/src/ui/commandCenter/ImportsTab.jsx` | Authors rules (operations components) and shows the recent-shares log. |
| `server/__tests__/occurrenceMint.test.js` | |
| `server/__tests__/serverExecutorCreate.test.js` | |
| `server/__tests__/shareClassify.test.js` | |
| `server/__tests__/shareRules.test.js` | |
| `server/__tests__/shareRulesEnsure.test.js` | |
| `server/__tests__/apiShare.test.js` | |

**Modified**

| file | change |
|---|---|
| `server/services/serverExecutor.js` | Add `CREATE` + `FIND` branches; `runOperationServerSide` gains `gridId`; **update the subset comment in the same commit**. |
| `server/routes/apiV1.js` | `/ingest` calls `occurrenceMint`; add `POST /share`. |
| `client/src/ui/CommandCenter.jsx` | Mount the Imports tab. |
| `extension/background.js` | Post to `/api/v1/share` instead of `/api/v1/ingest`. |

---

## Task 1: Extract the server-side mint

The ingest route already finds-or-creates a module, validates the parent, and mints an occurrence keyed by `externalId`. `CREATE` needs exactly that. Extract it **behaviour-preservingly** so there is one implementation, guarded by the existing `apiIngest.test.js`.

**Files:**
- Create: `server/services/occurrenceMint.js`
- Create: `server/__tests__/occurrenceMint.test.js`
- Modify: `server/routes/apiV1.js` (the `/ingest` handler, ~line 928)

**Interfaces:**
- Produces: `mintOccurrence({ userId, gridId, label, parentId, moduleRole, moduleKind, moduleFileRef, fields, fieldBindings, externalId, source, meta, io }) → { occurrenceId, moduleId, status }` where `status` is `"created" | "updated" | "skipped"`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/occurrenceMint.test.js
//
// ONE WAY TO MINT. The ingest route and the executor's CREATE must not grow
// two copies of "find-or-create a module, then mint an occurrence under a
// parent" — this repo's most-repeated defect class.
import { describe, it, expect, vi, beforeEach } from "vitest";

const modules = new Map(), occurrences = new Map();
vi.mock("../models/Module.js", () => ({ default: {
  findOne: async (q) => [...modules.values()].find(m => m.id === q.id) || null,
  create:  async (d) => { modules.set(d.id, { ...d }); return { ...d }; },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: async (q) => [...occurrences.values()].find(o =>
    (q.id && o.id === q.id) ||
    (q["meta.externalId"] && o.meta?.externalId === q["meta.externalId"])) || null,
  exists:  async (q) => !![...occurrences.values()].find(o => o.id === q.id),
  create:  async (d) => { occurrences.set(d.id, { ...d }); return { ...d }; },
  updateOne: async (q, u) => {
    const o = [...occurrences.values()].find(x => x.id === q.id);
    Object.assign(o, u.$set || {});
    return { modifiedCount: 1 };
  },
}}));

const { mintOccurrence } = await import("../services/occurrenceMint.js");

beforeEach(() => {
  modules.clear(); occurrences.clear();
  occurrences.set("parent", { id: "parent", userId: "u1", occurrences: [], meta: {} });
});

describe("mintOccurrence", () => {
  it("BINDS the fields it writes, not just their values", async () => {
    // D17: ops gate on _boundFieldIds. A value on an unbound field renders
    // nowhere and is invisible to the Schedule.
    const res = await mintOccurrence({
      userId: "u1", gridId: "g1", label: "Dentist", parentId: "parent",
      moduleRole: "instance", moduleKind: "list",
      fields: { fDate: { value: "2026-09-25", flow: "in" } },
      fieldBindings: [{ fieldId: "fDate", role: "input", order: 0 }],
      externalId: "ics:abc", source: "share",
    });
    expect(res.status).toBe("created");
    const mod = modules.get(res.moduleId);
    expect(mod.fieldBindings).toEqual([{ fieldId: "fDate", role: "input", order: 0 }]);
  });

  it("lists the new occurrence in its parent", async () => {
    const res = await mintOccurrence({
      userId: "u1", gridId: "g1", label: "x", parentId: "parent",
      moduleRole: "instance", externalId: "e1", source: "share",
    });
    expect(occurrences.get("parent").occurrences).toContain(res.occurrenceId);
  });

  it("is idempotent on externalId — the same share twice updates one row", async () => {
    const a = await mintOccurrence({ userId: "u1", gridId: "g1", label: "v1",
      parentId: "parent", moduleRole: "instance", externalId: "e1", source: "share" });
    const b = await mintOccurrence({ userId: "u1", gridId: "g1", label: "v2",
      parentId: "parent", moduleRole: "instance", externalId: "e1", source: "share" });
    expect(b.occurrenceId).toBe(a.occurrenceId);
    expect(b.status).toBe("updated");
    expect(occurrences.get("parent").occurrences.filter(x => x === a.occurrenceId)).toHaveLength(1);
  });

  it("refuses a parentId that does not exist rather than orphaning the row", async () => {
    await expect(mintOccurrence({ userId: "u1", gridId: "g1", label: "x",
      parentId: "nope", moduleRole: "instance", externalId: "e2", source: "share" }))
      .rejects.toThrow(/parent/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run __tests__/occurrenceMint.test.js`
Expected: FAIL — `Cannot find module '../services/occurrenceMint.js'`

- [ ] **Step 3: Write the implementation**

```js
// server/services/occurrenceMint.js
//
// THE ONE WAY THE SERVER MINTS A ROW.
//
// Extracted from the `/api/v1/ingest` route so the share engine's CREATE does
// not grow a second copy — "two implementations of one question" is this
// codebase's most-repeated defect class (see the spec's §9).
//
// BINDINGS ARE NOT OPTIONAL POLISH. Operations gate on `_boundFieldIds`, so a
// value written to an unbound field renders nowhere AND is invisible to the
// Schedule. `addNewOption.js` already records this defect once.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { randomUUID } from "node:crypto";

const userRoom = (userId) => `user:${userId}`;

export async function mintOccurrence({
  userId, gridId, label, parentId = null,
  moduleId: explicitModuleId = null,
  moduleRole = "instance", moduleKind = null, moduleFileRef = null,
  fields = {}, fieldBindings = [],
  externalId, source = "share", meta = {}, io = null,
}) {
  if (!externalId) throw new Error("externalId required — without it a re-share duplicates");
  if (parentId && !(await Occurrence.exists({ id: parentId, userId }))) {
    throw new Error(`parent ${parentId} not found`);
  }

  // Identity is (source, externalId) — the ingest route's existing scheme.
  const existing = await Occurrence.findOne({
    userId, "meta.source": source, "meta.externalId": externalId,
  });

  if (existing) {
    await Occurrence.updateOne({ id: existing.id }, { $set: {
      ...(label ? { label } : {}),
      fields: { ...(existing.fields || {}), ...fields },
    }});
    return { occurrenceId: existing.id, moduleId: existing.moduleId, status: "updated" };
  }

  const moduleIdToUse = explicitModuleId || randomUUID();
  let mod = explicitModuleId ? await Module.findOne({ id: explicitModuleId, userId }) : null;
  if (!mod) {
    mod = await Module.create({
      id: moduleIdToUse, userId, gridId, label,
      role: moduleRole, kind: moduleKind, fileRef: moduleFileRef,
      fieldBindings,
    });
    io?.to?.(userRoom(userId))?.emit?.("module_created", { module: mod });
  }

  const occId = randomUUID();
  const occ = await Occurrence.create({
    id: occId, userId, gridId, moduleId: mod.id, parentId,
    label, fields, occurrences: [],
    meta: { ...meta, source, externalId },
  });
  io?.to?.(userRoom(userId))?.emit?.("occurrence_created", { occurrence: occ });

  if (parentId) {
    const parent = await Occurrence.findOne({ id: parentId, userId });
    const list = parent.occurrences || [];
    if (!list.includes(occId)) {
      await Occurrence.updateOne({ id: parentId }, { $set: { occurrences: [...list, occId] } });
      io?.to?.(userRoom(userId))?.emit?.("occurrence_updated", { occurrence: { id: parentId } });
    }
  }

  return { occurrenceId: occId, moduleId: mod.id, status: "created" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run __tests__/occurrenceMint.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Point `/ingest` at it, and prove behaviour did not change**

The existing `apiIngest.test.js` is the regression guard. Run it **before** touching the route and record the count, then rewrite the route's mint block to call `mintOccurrence`, then run it again.

Run: `cd server && npx vitest run __tests__/apiIngest.test.js`
Expected: the same pass count before and after. If any test changes behaviour, the extraction was not faithful — fix the extraction, not the test.

- [ ] **Step 6: Commit**

```bash
git add server/services/occurrenceMint.js server/__tests__/occurrenceMint.test.js server/routes/apiV1.js
git commit -m "refactor(server): one way to mint a row, shared by ingest and (soon) CREATE"
```

---

## Task 2: `serverExecutor` gains `CREATE`

**Files:**
- Modify: `server/services/serverExecutor.js` (the `executeStep` chain, ~line 162; and the subset comment at the top, lines 1–18)
- Create: `server/__tests__/serverExecutorCreate.test.js`

**Interfaces:**
- Consumes: `mintOccurrence(...)` from Task 1.
- Produces: `runOperationServerSide(op, { vars, userId, gridId, io })` — **note the added `gridId` and `io`**; every later task calls it with these.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/serverExecutorCreate.test.js
//
// serverExecutor's own header says CREATE "needs a connected browser tab
// today". A share arrives with no tab (the extension case), so it cannot.
import { describe, it, expect, vi, beforeEach } from "vitest";

const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (args) => {
    minted.push(args);
    return { occurrenceId: `occ${minted.length}`, moduleId: `mod${minted.length}`, status: "created" };
  },
}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));

const { runOperationServerSide } = await import("../services/serverExecutor.js");

const op = (steps) => ({ id: "op1", name: "t", pipeline: { steps } });
beforeEach(() => { minted.length = 0; });

describe("CREATE, server-side", () => {
  it("mints a row with resolved values from $vars", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$title", value: "literal:Dentist" } },
      { type: "action", config: { type: "CREATE", parentId: "literal:cont1", label: "$title",
        fields: { fDate: "literal:2026-09-25" }, externalId: "literal:ics:abc" } },
    ]), { userId: "u1", gridId: "g1" });

    expect(minted).toHaveLength(1);
    expect(minted[0].label).toBe("Dentist");
    expect(minted[0].parentId).toBe("cont1");
    expect(minted[0].fields.fDate).toEqual({ value: "2026-09-25", flow: "in" });
  });

  it("BINDS every field it writes (D17)", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fA: "literal:1", fB: "literal:2" }, externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId).sort()).toEqual(["fA", "fB"]);
  });

  it("honours an explicit bindFields list, so a field can be bound EMPTY", async () => {
    // The ics rule binds Schedule Type with no value so the Schedule op, which
    // gates on the binding, still picks the row up.
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fDate: "literal:2026-09-25" }, bindFields: ["fSchedType", "fDate"],
        externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId)).toContain("fSchedType");
    expect(minted[0].fields.fSchedType).toBeUndefined();
  });

  it("runs inside a LOOP once per item", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$xs", value: ["a", "b", "c"] } },
      { type: "loop", overExpr: "$xs", as: "$x", body: [
        { type: "action", config: { type: "CREATE", parentId: "literal:c",
          label: "$x", externalId: "$x" } },
      ]},
    ]), { userId: "u1", gridId: "g1" });
    expect(minted.map(m => m.label)).toEqual(["a", "b", "c"]);
  });

  it("CONTROL — an action still outside the subset does not half-run", async () => {
    // Scope discipline: only CREATE and FIND are added. APPLY_TEMPLATE must
    // still be refused rather than silently doing nothing.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "literal:t" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.unsupported).toContain("APPLY_TEMPLATE");
    expect(minted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run __tests__/serverExecutorCreate.test.js`
Expected: FAIL — `minted` is empty; the executor ignores `CREATE`.

- [ ] **Step 3: Add the `CREATE` branch**

In `runOperationServerSide`, accept the new options and track unsupported actions:

```js
export async function runOperationServerSide(op, { vars = {}, userId, gridId, io = null } = {}) {
  // …existing $vars folding…
  const unsupported = [];
  const opts = { userId };
```

Add the branch inside `executeStep`, beside the existing `CALL_API` block:

```js
    if (type === "CREATE") {
      // Server-side row creation. Wires to `occurrenceMint`, the same path
      // `/api/v1/ingest` uses — this executor does not own a second minter.
      const parentId   = await resolveExprAsync(cfg.parentId, $vars, opts);
      const label      = await resolveExprAsync(cfg.label, $vars, opts);
      const externalId = await resolveExprAsync(cfg.externalId, $vars, opts);

      // Values, resolved one at a time so a $var in any of them works.
      const fields = {};
      for (const [fid, expr] of Object.entries(cfg.fields || {})) {
        const value = await resolveExprAsync(expr, $vars, opts);
        if (value !== undefined && value !== null && value !== "") {
          fields[fid] = { value, flow: "in" };
        }
      }

      // BINDINGS (D17). Default: bind exactly what we wrote. `bindFields`
      // widens that so a field can be bound with NO value — which is what puts
      // an ics row in front of `Schedule: Place Dated Work`, since that op
      // gates on `_boundFieldIds`, not on the value.
      const bindIds = Array.isArray(cfg.bindFields) && cfg.bindFields.length
        ? cfg.bindFields
        : Object.keys(fields);
      const fieldBindings = bindIds.map((fieldId, order) => ({ fieldId, role: "input", order }));

      const res = await mintOccurrence({
        userId, gridId, label, parentId, fields, fieldBindings, externalId,
        moduleRole: cfg.moduleRole || "instance",
        moduleKind: cfg.moduleKind || null,
        moduleFileRef: await resolveExprAsync(cfg.moduleFileRef, $vars, opts),
        source: cfg.source || "share",
        io,
      });
      if (cfg.resultVar) $vars[cfg.resultVar] = res;
      effects.push({ _effect: "CREATE", ...res });
      return;
    }
```

And at the end of the `executeStep` chain, record anything unhandled instead of silently returning:

```js
    if (type) unsupported.push(type);
```

Return it: `return { effects, vars: $vars, unsupported, ms: Date.now() - startedAt };`

- [ ] **Step 4: Update the subset comment in the same commit**

`serverExecutor.js` lines 1–18 currently say CREATE "needs a connected browser tab today". Leaving that stale is worse than having no comment. Replace the list with:

```
//   INIT_VAR / SET_VAR — set a $var from an expression
//   IF + AND/OR/NOT predicates with basic comparators
//   LOOP over an array $var (as / overExpr)
//   CALL_API — outbound HTTP
//   SHOW_VALUE — stage a named result for the caller
//   CREATE — mint a row (via services/occurrenceMint), WITH fieldBindings
//   FIND — resolve one occurrence by predicate
//
// Still client-only: COPY_LINK / APPLY_TEMPLATE / aggregations / the rest.
// Anything outside this list is collected in the returned `unsupported[]`
// rather than silently skipped.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run __tests__/serverExecutorCreate.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: A/B — prove the tests discriminate**

```bash
cd /home/joshpoms/moduli
cp server/services/serverExecutor.js /tmp/SE.keep
python3 - <<'PY'
import io
p="server/services/serverExecutor.js"; s=io.open(p).read()
i=s.index('    if (type === "CREATE") {'); j=s.index('    if (type === "FIND"', i) if '"FIND"' in s[i:] else s.index('    if (step.type === "if")', i)
io.open(p,"w").write(s[:i]+s[j:])
PY
echo "CREATE branch present = $(grep -c 'if (type === "CREATE")' server/services/serverExecutor.js) (0 = mutation landed)"
cd server && npx vitest run __tests__/serverExecutorCreate.test.js 2>&1 | grep -E "Tests "
cd .. && cp /tmp/SE.keep server/services/serverExecutor.js
echo "restored = $(grep -c 'if (type === \"CREATE\")' server/services/serverExecutor.js)"
```
Expected: 4 of 5 fail with the branch removed (the CONTROL passes in both arms — report it as a contract pin, not coverage).

- [ ] **Step 7: Commit**

```bash
git add server/services/serverExecutor.js server/__tests__/serverExecutorCreate.test.js
git commit -m "feat(executor): CREATE runs server-side, and it BINDS what it writes"
```

---

## Task 3: `serverExecutor` gains `FIND`

A rule needs to resolve a destination container, or an existing option row, without a tab.

**Files:**
- Modify: `server/services/serverExecutor.js`
- Modify: `server/__tests__/serverExecutorCreate.test.js` (add a `FIND` describe block)

**Interfaces:**
- Produces: `FIND` config `{ type: "FIND", over, predicate, itemVar, itemIdVar }`. `over` is `"$allContainers" | "$allInstances" | "$allOccurrences"`.

- [ ] **Step 1: Write the failing test**

```js
describe("FIND, server-side", () => {
  it("binds the matching occurrence's id to itemIdVar", async () => {
    // seeded via the Occurrence mock: one container labelled "Bookmarks"
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("cont-bookmarks");
  });

  it("leaves the var empty when nothing matches, rather than throwing", async () => {
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Nope" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value ?? null).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/serverExecutorCreate.test.js -t FIND`
Expected: FAIL — `$destId` is undefined.

- [ ] **Step 3: Implement**

```js
    if (type === "FIND") {
      const roleFor = { $allContainers: "container", $allInstances: "instance" };
      const role = roleFor[cfg.over] || null;
      const mods = await Module.find({ userId, gridId, ...(role ? { role } : {}) }).lean();
      const modById = Object.fromEntries(mods.map(m => [m.id, m]));
      const occs = await Occurrence.find({ userId, gridId }).lean();

      const records = occs
        .filter(o => !role || modById[o.moduleId]?.role === role)
        .map(o => ({ ...o, label: o.label || modById[o.moduleId]?.label || "" }));

      const match = records.find(r => evalGroup(cfg.predicate, { ...$vars, ...recordScope(r) }, r));
      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = match?.id ?? null;
      if (cfg.itemVar)   $vars[cfg.itemVar]   = match ?? null;
      return;
    }
```

`recordScope(r)` exposes the record's own keys to the predicate's bare `left`
paths (`label`, `fields.x.value`) — mirroring how the client executor evaluates
a predicate against a record rather than against `$vars` alone.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/serverExecutorCreate.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/serverExecutor.js server/__tests__/serverExecutorCreate.test.js
git commit -m "feat(executor): FIND resolves a destination server-side"
```

> **CHECKPOINT — Plan 1, Phase 1 complete.** The executor can now write without a tab. This is independently valuable and independently shippable: verify it through the existing `POST /api/v1/operations/:id/run` endpoint before continuing.

---

## Task 4: Classify a shared payload

**Files:**
- Create: `server/services/shareClassify.js`
- Create: `server/__tests__/shareClassify.test.js`

**Interfaces:**
- Produces: `classifyShare({ files, url, text, title }) → { type, props }` where `type ∈ {"ics","image","video","audio","pdf","file","link","text","html"}`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareClassify.test.js
import { describe, it, expect } from "vitest";
import { classifyShare } from "../services/shareClassify.js";

const file = (filename, mimetype, size = 100) => ({ filename, mimetype, size });

describe("classifyShare", () => {
  it("names a calendar by mime type", () => {
    expect(classifyShare({ files: [file("m.ics", "text/calendar")] }).type).toBe("ics");
  });

  it("names a calendar by EXTENSION when the mime type is generic", () => {
    // Android frequently shares .ics as application/octet-stream.
    expect(classifyShare({ files: [file("m.ics", "application/octet-stream")] }).type).toBe("ics");
  });

  it("names images, video, audio and pdf", () => {
    expect(classifyShare({ files: [file("a.jpg", "image/jpeg")] }).type).toBe("image");
    expect(classifyShare({ files: [file("a.mp4", "video/mp4")] }).type).toBe("video");
    expect(classifyShare({ files: [file("a.m4a", "audio/mp4")] }).type).toBe("audio");
    expect(classifyShare({ files: [file("a.pdf", "application/pdf")] }).type).toBe("pdf");
  });

  it("falls back to `file` for anything else, so the catch-all can match", () => {
    expect(classifyShare({ files: [file("a.zip", "application/zip")] }).type).toBe("file");
  });

  it("names a link and exposes the url", () => {
    const r = classifyShare({ url: "https://example.com/x", title: "X" });
    expect(r.type).toBe("link");
    expect(r.props.url).toBe("https://example.com/x");
    expect(r.props.title).toBe("X");
  });

  it("finds a bare url shared as TEXT — Android shares links that way", () => {
    expect(classifyShare({ text: "https://example.com/x" }).type).toBe("link");
  });

  it("names prose as text and exposes firstLine", () => {
    const r = classifyShare({ text: "Hello there\nsecond line" });
    expect(r.type).toBe("text");
    expect(r.props.firstLine).toBe("Hello there");
  });

  it("a file wins over accompanying text — the file is the payload", () => {
    expect(classifyShare({ files: [file("a.jpg", "image/jpeg")], text: "look" }).type).toBe("image");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/shareClassify.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/services/shareClassify.js
//
// Payload → ONE COARSE TOKEN. A rule matches a token, not a regex, so the
// config stays readable (spec §3). Pure: no I/O, no DB.
const EXT_TYPE = {
  ics: "ics", ical: "ics",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", heic: "image",
  mp4: "video", mov: "video", mkv: "video", webm: "video",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio",
  pdf: "pdf",
};
const URL_RE = /^https?:\/\/\S+$/i;

const extOf = (name = "") => String(name).split(".").pop().toLowerCase();

function typeOfFile(f) {
  const mime = String(f.mimetype || "").toLowerCase();
  // Extension FIRST for calendars: Android commonly shares .ics as
  // application/octet-stream, so trusting the mime type alone loses them.
  const byExt = EXT_TYPE[extOf(f.filename)];
  if (byExt === "ics") return "ics";
  if (mime === "text/calendar") return "ics";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return byExt || "file";
}

export function classifyShare({ files = [], url = null, text = null, title = null } = {}) {
  if (files.length) {
    const f = files[0];
    return { type: typeOfFile(f), props: {
      filename: f.filename, mimeType: f.mimetype, sizeBytes: f.size,
    }};
  }
  const candidate = url || (typeof text === "string" ? text.trim() : "");
  if (candidate && URL_RE.test(candidate)) {
    return { type: "link", props: { url: candidate, title: title || null } };
  }
  if (text) {
    return { type: "text", props: { text, firstLine: String(text).split("\n")[0], html: null } };
  }
  return { type: "file", props: {} };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/shareClassify.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/shareClassify.js server/__tests__/shareClassify.test.js
git commit -m "feat(share): classify a shared payload into one coarse token"
```

---

## Task 5: The rule engine

**Files:**
- Create: `server/services/shareRules.js`
- Create: `server/__tests__/shareRules.test.js`

**Interfaces:**
- Consumes: `runOperationServerSide` (Task 2/3).
- Produces: `runShareRules({ share, userId, gridId, io }) → { ran: [{ ruleId, ruleName, created: [...] }], halted: bool }`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareRules.test.js
//
// One rule per type (D8); branching lives INSIDE a rule. Ordering therefore
// matters in exactly one place: the catch-all runs last.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ops = [];
vi.mock("../models/Operation.js", () => ({ default: {
  find: () => ({ lean: async () => ops }),
}}));
const runs = [];
vi.mock("../services/serverExecutor.js", () => ({
  runOperationServerSide: async (op, o) => {
    runs.push(op.id);
    // a rule "halts" by setting the reserved var
    const halts = op.__halts;
    return { effects: [], vars: halts ? { "$share": { ...o.vars.$share, handled: true } } : {}, unsupported: [] };
  },
}));

const { runShareRules } = await import("../services/shareRules.js");

const rule = (id, shareType, priority, extra = {}) => ({
  id, name: id, enabled: true, priority,
  triggers: [{ type: "onShare", shareType }],
  pipeline: { steps: [] }, ...extra,
});

beforeEach(() => { ops.length = 0; runs.length = 0; });

describe("runShareRules", () => {
  it("runs the rule whose type matches", async () => {
    ops.push(rule("ics-rule", "ics", 1), rule("link-rule", "link", 1));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule"]);
  });

  it("runs the catch-all LAST, and only it, when no typed rule matches", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1));
    await runShareRules({ share: { type: "zip" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["catch"]);
  });

  it("a typed rule that halts stops the catch-all from also firing", async () => {
    ops.push(rule("catch", "*", 99), { ...rule("ics-rule", "ics", 1), __halts: true });
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule"]);
  });

  it("without the halt flag, both the typed rule and the catch-all run (D9)", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule", "catch"]);
  });

  it("skips disabled rules", async () => {
    ops.push({ ...rule("ics-rule", "ics", 1), enabled: false }, rule("catch", "*", 99));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["catch"]);
  });

  it("passes $share to the rule", async () => {
    ops.push(rule("ics-rule", "ics", 1));
    const share = { type: "ics", events: [{ summary: "Dentist" }] };
    let seen = null;
    const mod = await import("../services/serverExecutor.js");
    mod.runOperationServerSide = async (op, o) => { seen = o.vars.$share; return { effects: [], vars: {} }; };
    await runShareRules({ share, userId: "u1", gridId: "g1" });
    expect(seen.events[0].summary).toBe("Dentist");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/shareRules.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/services/shareRules.js
//
// Selects and runs the `onShare` rules for one shared payload.
//
// ONE RULE PER TYPE (D8) — branching lives inside a rule's pipeline, which is
// why there is no "first match wins" machinery here. Ordering matters in
// exactly one place: the `*` catch-all has the lowest priority and is reached
// only when nothing else handled the share.
import Operation from "../models/Operation.js";
import { runOperationServerSide } from "./serverExecutor.js";

const CATCH_ALL = "*";

export async function runShareRules({ share, userId, gridId, io = null }) {
  const all = await Operation.find({ userId, gridId }).lean();

  const matching = all
    .filter(op => op.enabled !== false)
    .map(op => ({ op, trig: (op.triggers || []).find(t => t.type === "onShare") }))
    .filter(({ trig }) => trig && (trig.shareType === share.type || trig.shareType === CATCH_ALL))
    // typed rules before the catch-all, then by declared priority
    .sort((a, b) => {
      const ac = a.trig.shareType === CATCH_ALL ? 1 : 0;
      const bc = b.trig.shareType === CATCH_ALL ? 1 : 0;
      return ac - bc || (a.op.priority ?? 50) - (b.op.priority ?? 50);
    });

  const ran = [];
  let state = { ...share };

  for (const { op } of matching) {
    const res = await runOperationServerSide(op, {
      vars: { $share: state }, userId, gridId, io,
    });
    ran.push({
      ruleId: op.id, ruleName: op.name,
      created: (res.effects || []).filter(e => e._effect === "CREATE"),
      unsupported: res.unsupported || [],
    });
    // A rule halts the chain by setting the reserved var (D9). No new action
    // type exists for this — it is an ordinary SET_VAR.
    const after = res.vars?.$share;
    if (after?.handled) return { ran, halted: true };
    if (after) state = after;
  }
  return { ran, halted: false };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/shareRules.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/shareRules.js server/__tests__/shareRules.test.js
git commit -m "feat(share): the rule engine — one rule per type, catch-all last"
```

---

## Task 6: Bootstrap the catch-all

**Files:**
- Create: `server/utils/shareRulesEnsure.js`
- Create: `server/__tests__/shareRulesEnsure.test.js`

Read `server/utils/protectedFoldersEnsure.js` first — this mirrors it (find-or-mint, idempotent).

**Interfaces:**
- Produces: `ensureCatchAllRule({ userId, gridId }) → { ruleId, created: bool }`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareRulesEnsure.test.js
//
// D18: a grid gets exactly ONE rule automatically — the `*` catch-all. The
// typed rules are the user's to write (D19), because they name containers that
// exist only on their grid.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = [];
vi.mock("../models/Operation.js", () => ({ default: {
  findOne: async (q) => store.find(o =>
    o.userId === q.userId && o.gridId === q.gridId &&
    (o.triggers || []).some(t => t.type === "onShare" && t.shareType === "*")) || null,
  create: async (d) => { store.push({ ...d }); return { ...d }; },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: async () => ({ id: "files-folder" }),
}}));

const { ensureCatchAllRule } = await import("../utils/shareRulesEnsure.js");
beforeEach(() => { store.length = 0; });

describe("ensureCatchAllRule", () => {
  it("mints the catch-all when none exists", async () => {
    const r = await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(r.created).toBe(true);
    expect(store).toHaveLength(1);
    expect(store[0].triggers[0]).toEqual({ type: "onShare", shareType: "*" });
  });

  it("is idempotent — a second call mints nothing", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    const r = await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(r.created).toBe(false);
    expect(store).toHaveLength(1);
  });

  it("gives it the LOWEST priority so typed rules run first", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(store[0].priority).toBeGreaterThanOrEqual(99);
  });

  it("mints ONLY the catch-all — no typed rules (D18)", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    const types = store.flatMap(o => o.triggers.map(t => t.shareType));
    expect(types).toEqual(["*"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/shareRulesEnsure.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/utils/shareRulesEnsure.js
//
// D18 — a grid gets exactly ONE share rule automatically: the `*` catch-all,
// pointing at its Files folder. Find-or-mint and idempotent, following
// `protectedFoldersEnsure.js`, which does the same job for Templates/Files.
//
// Typed rules are NOT minted here (D19). They name containers that exist only
// on a particular grid, so bootstrap could not invent them; poms' set is seeded
// by hand as data.
import Operation from "../models/Operation.js";
import Occurrence from "../models/Occurrence.js";
import { randomUUID } from "node:crypto";

export const CATCH_ALL_PRIORITY = 99;

export async function ensureCatchAllRule({ userId, gridId }) {
  const existing = await Operation.findOne({ userId, gridId });
  if (existing) return { ruleId: existing.id, created: false };

  const files = await Occurrence.findOne({ userId, gridId, label: /^files$/i });

  const op = await Operation.create({
    id: randomUUID(), userId, gridId,
    name: "Share: anything else",
    enabled: true, priority: CATCH_ALL_PRIORITY,
    triggers: [{ type: "onShare", shareType: "*" }],
    pipeline: { steps: [
      { id: randomUUID(), type: "action", config: {
        type: "CREATE",
        parentId: files ? `literal:${files.id}` : null,
        label: "$share.props.filename",
        externalId: "$share.externalId",
        source: "literal:share",
      }},
    ]},
  });
  return { ruleId: op.id, created: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/shareRulesEnsure.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/shareRulesEnsure.js server/__tests__/shareRulesEnsure.test.js
git commit -m "feat(share): bootstrap mints the catch-all rule, and only that"
```

---

## Task 7: `POST /api/v1/share`

**Files:**
- Create: `server/services/shareIngress.js`
- Modify: `server/routes/apiV1.js` (add the route; follow the `/ingest` route's auth + multer setup)
- Create: `server/__tests__/apiShare.test.js`

**Interfaces:**
- Consumes: `classifyShare`, `runShareRules`, `ensureCatchAllRule`, `mintOccurrence`.
- Produces: `POST /api/v1/share` → `{ type, ran: [...], halted, shareId }`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/apiShare.test.js
//
// INGRESS PREPARES, THE RULE ROUTES (spec §3). The endpoint uploads files and
// fetches link metadata BEFORE any rule runs, so a rule never handles a binary
// and the rule language stays free of I/O.
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploaded = [], ruleRuns = [];
vi.mock("../services/artifactUpload.js", () => ({
  storeSharedFile: async (f) => { uploaded.push(f); return { occurrenceId: "occ-file", fileRef: "user/2026-09/x.jpg" }; },
}));
vi.mock("../services/shareRules.js", () => ({
  runShareRules: async (a) => { ruleRuns.push(a.share); return { ran: [], halted: false }; },
}));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));

const { prepareShare } = await import("../services/shareIngress.js");
beforeEach(() => { uploaded.length = 0; ruleRuns.length = 0; });

describe("share ingress", () => {
  it("uploads a file BEFORE the rule runs, and exposes its ids as properties", async () => {
    const share = await prepareShare({
      userId: "u1", gridId: "g1", source: "extension",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 10, path: "/tmp/a" }],
    });
    expect(uploaded).toHaveLength(1);
    expect(share.type).toBe("image");
    expect(share.props.occurrenceId).toBe("occ-file");
    expect(share.props.fileRef).toBe("user/2026-09/x.jpg");
  });

  it("derives an externalId from the file hash so a re-share updates one row", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", source: "extension",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 10, path: "/tmp/a", sha256: "abc" }] });
    expect(share.externalId).toBe("sha256:abc");
  });

  it("derives a link externalId matching the extension's existing scheme", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", source: "extension",
      url: "https://example.com/x" });
    expect(share.externalId).toBe("link:https://example.com/x");
  });

  it("carries the source so a rule can branch on where it came from", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", source: "android", text: "hi" });
    expect(share.source).toBe("android");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/apiShare.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ingress**

```js
// server/services/shareIngress.js
//
// INGRESS PREPARES; THE RULE ROUTES.
//
// All mechanical work happens here, before any rule runs: files are uploaded to
// artifacts, link metadata is fetched. The rule then sees clean flat data,
// which is what makes `LOOP $share.events` expressible and keeps the rule
// language free of I/O.
import { classifyShare } from "./shareClassify.js";
import { storeSharedFile } from "./artifactUpload.js";

export async function prepareShare({ userId, gridId, source, files = [], url, text, title }) {
  const { type, props } = classifyShare({ files, url, text, title });

  let externalId = null;
  const enriched = { ...props };

  if (files.length) {
    const f = files[0];
    const stored = await storeSharedFile({ file: f, userId, gridId });
    enriched.occurrenceId = stored.occurrenceId;
    enriched.fileRef = stored.fileRef;
    externalId = f.sha256 ? `sha256:${f.sha256}` : `file:${f.filename}:${f.size}`;
  } else if (type === "link") {
    externalId = `link:${enriched.url}`;
  } else {
    externalId = `text:${String(text || "").slice(0, 120)}`;
  }

  return { type, source, props: enriched, externalId, receivedAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Add the route**

In `server/routes/apiV1.js`, beside `/ingest` (Bearer auth applies via the existing `apiAuth` middleware — **do not add cookie auth**, per Global Constraints):

```js
router.post("/share", upload.array("files"), async (req, res) => {
  try {
    const gridId = req.body.gridId || (await resolveShareGrid(req.userId));
    if (!gridId) return res.status(400).json({ error: "no share grid configured" });

    await ensureCatchAllRule({ userId: req.userId, gridId });   // D3/D18

    const share = await prepareShare({
      userId: req.userId, gridId,
      source: req.body.source || "api",
      files: (req.files || []).map(f => ({
        filename: f.originalname, mimetype: f.mimetype, size: f.size, path: f.path,
      })),
      url: req.body.url, text: req.body.text, title: req.body.title,
    });

    const result = await runShareRules({ share, userId: req.userId, gridId, io });
    res.json({ type: share.type, externalId: share.externalId, ...result });
  } catch (err) {
    res.status(500).json({ error: "share_failed", message: String(err?.message || err) });
  }
});
```

`resolveShareGrid(userId)` reads `user.meta.share.gridId` (D10).

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/apiShare.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the whole server suite for regressions**

Run: `cd server && npx vitest run`
Expected: the pre-existing pass count plus your new tests; **zero new failures**. Record the count.

- [ ] **Step 7: Commit**

```bash
git add server/services/shareIngress.js server/routes/apiV1.js server/__tests__/apiShare.test.js
git commit -m "feat(share): POST /api/v1/share — ingress prepares, rules route"
```

---

## Task 8: The Imports tab — rules editor

**Files:**
- Create: `client/src/ui/commandCenter/ImportsTab.jsx`
- Modify: `client/src/ui/CommandCenter.jsx` (mount the tab)

Read `OperationsTab.jsx` and `PrefillEditor.jsx` first. **Reuse their components** — the condition builder, `ActionPicker`, `ExprOrPath`, the drilldown path picker (D6). Do not write a second editor.

**Interfaces:**
- Consumes: the `onShare` operation shape from Task 5.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/importsTab.test.jsx
//
// D6: rules are authored HERE, not in the Operations tab. The tab must reuse
// the operations components rather than grow a second editor — the guard is a
// source check, because mounting the whole builder needs the grid store.
import { describe, it, expect } from "vitest";
import fs from "node:fs"; import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/ImportsTab.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ImportsTab", () => {
  it("reuses the operations components rather than a second editor", () => {
    expect(code).toMatch(/ActionPicker/);
    expect(code).toMatch(/ConditionGroup|ExprOrPath/);
  });

  it("writes rules as onShare operations", () => {
    expect(code).toMatch(/onShare/);
  });

  it("does NOT mint typed rules — bootstrap is catch-all only (D18)", () => {
    // A tab that seeds ics/image/link rules would contradict D18/D19.
    expect(code).not.toMatch(/shareType:\s*["']ics["']/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/importsTab.test.jsx`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the tab**

Build `ImportsTab.jsx` as a list of rules, each row expanding to an editor composed of the operations components. A rule row reads: **trigger type** (a select over the classification tokens plus `*`) → **variable rows** → **condition/action rows**. Persist through the same socket path `OperationsTab` uses to save an operation; the only difference is the trigger it writes.

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/importsTab.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/commandCenter/ImportsTab.jsx client/src/ui/CommandCenter.jsx client/src/__tests__/importsTab.test.jsx
git commit -m "feat(imports): a Command Center tab that authors share rules"
```

---

## Task 9: The Imports tab — recent-shares log

**Files:**
- Modify: `client/src/ui/commandCenter/ImportsTab.jsx`

Read `OperationLogPanel.jsx` first. The log is a **view over the operation run log that already exists** (D16) — the rules are operations, so their runs are already recorded. Do not create a second store.

- [ ] **Step 1: Write the failing test**

```js
describe("the recent-shares log", () => {
  it("reads the existing operation run log rather than a second store", () => {
    expect(code).toMatch(/OperationLogPanel|runLog|operationRuns/);
    expect(code).not.toMatch(/shareLogCollection|ShareLog\.create/);
  });

  it("has no re-run button — that would mean retaining payloads (D16)", () => {
    expect(code).not.toMatch(/re-?run/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/importsTab.test.jsx -t log`
Expected: FAIL.

- [ ] **Step 3: Implement** — render, per run: time, share type, which rule matched, what it created, and a link to the created occurrence.

- [ ] **Step 4: Run to verify it passes** · **Step 5: Commit**

```bash
git add client/src/ui/commandCenter/ImportsTab.jsx client/src/__tests__/importsTab.test.jsx
git commit -m "feat(imports): recent-shares log over the existing run log"
```

---

## Task 10: Re-route the extension, with a compatibility rule

**Files:**
- Modify: `extension/background.js` (the `/api/v1/ingest` fetch, ~line 65)
- Create: `server/__tests__/shareLinkCompat.test.js`

**D15: day-one behaviour must be identical.** The shipped `link` rule must reproduce `buildClipRecord`'s current output exactly — bookmark shape, `externalId` `<shape>:<url>`, the same `URL` / `Excerpt` / `Cover` writes.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/shareLinkCompat.test.js
//
// D15 — clipping a page must produce the SAME row before and after the
// re-route. The rule is editable afterwards; that is the point. But day one
// must be a no-op for the user.
import { describe, it, expect } from "vitest";
import { buildClipRecord } from "../../extension/clip.js";
import { shareToClipRecord } from "../services/shareLinkCompat.js";

const fieldIds = { URL: "fUrl", Excerpt: "fExc", Cover: "fCov", Tags: "fTag" };

describe("link rule compatibility", () => {
  it("produces the same record the extension produced directly", () => {
    const info = { pageUrl: "https://example.com/a", selectionText: "" };
    const tab = { url: "https://example.com/a", title: "A" };
    const before = buildClipRecord({ info, tab, fieldIds });
    const after = shareToClipRecord({
      share: { type: "link", source: "extension",
               props: { url: "https://example.com/a", title: "A" },
               externalId: "link:https://example.com/a" },
      fieldIds,
    });
    expect(after.label).toBe(before.label);
    expect(after.moduleRole).toBe(before.moduleRole);
    expect(after.moduleKind).toBe(before.moduleKind);
    expect(after.fields.fUrl).toEqual(before.fields.fUrl);
  });

  it("keeps the extension's externalId scheme, so old clips still dedup", () => {
    const before = buildClipRecord({
      info: { pageUrl: "https://example.com/a" },
      tab: { url: "https://example.com/a", title: "A" }, fieldIds });
    const after = shareToClipRecord({
      share: { type: "link", source: "extension", props: { url: "https://example.com/a", title: "A" } },
      fieldIds });
    expect(after.externalId).toBe(before.externalId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/shareLinkCompat.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shareToClipRecord`**, then point `extension/background.js` at `/api/v1/share`:

```js
  const res = await fetch(`${baseUrl}/api/v1/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ gridId, source: "extension", url, title, text: selectionText }),
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/shareLinkCompat.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Full suites + deploy**

```bash
cd server && npx vitest run            # record count, zero new failures
cd ../client && ./node_modules/.bin/vitest run
cd .. && ./deploy.sh "feat(share): share→import routing, engine + browser path"
```
A server file changed, so `deploy.sh` will restart pm2. That is correct and expected here.

- [ ] **Step 6: VERIFY ON PROD BY DOING THE THING**

Not optional, and not a unit test. Load the extension, right-click a page, clip it. Then read the row back out of Mongo and confirm: it exists, its `meta.externalId` matches the old scheme, and clipping the **same page twice** leaves **one** row.

Record the before/after in the commit message. Per this repo's standing rule, the feature is unverified until someone has watched it work.

- [ ] **Step 7: Commit**

```bash
git add extension/background.js server/services/shareLinkCompat.js server/__tests__/shareLinkCompat.test.js
git commit -m "feat(share): the extension routes through the rules, identically on day one"
```

---

## Self-Review

**Spec coverage.** Every §1–§14 requirement in scope for Plan 1 maps to a task: §1 reuse → Task 1 · §3 classification/catalogues → Task 4 · §3 ingress → Task 7 · §4 rule model + bootstrap → Tasks 5, 6 · §5 executor → Tasks 2, 3 · §7 idempotency → Tasks 1, 7, 10 · §8 extension → Task 10 · §8a tab + log → Tasks 8, 9 · §12 error handling → Task 7 · §13 testing → every task. **Deferred by design, with their plan named:** §6 ics (Plan 2), §8 Android/Windows transport and D14's 500 MB cap (Plan 3), D19 poms seeding (Plan 3, a data task).

**Placeholders.** None. Every code step carries real code; every run step carries a real command and an expected result.

**Type consistency.** `mintOccurrence` (Task 1) returns `{ occurrenceId, moduleId, status }` and is consumed with those names in Task 2. `runOperationServerSide` gains `gridId`/`io` in Task 2 and is called with them in Task 5. `classifyShare` returns `{ type, props }` (Task 4), consumed as such by `prepareShare` (Task 7). `runShareRules` returns `{ ran, halted }` (Task 5), spread into the route's response (Task 7).

**One risk worth stating.** Task 1 modifies a **live endpoint** (`/ingest`). The extraction must be behaviour-preserving, and `apiIngest.test.js` is the guard — record its pass count before and after.
