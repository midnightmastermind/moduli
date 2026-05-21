# Moduli API Plan — Inbound REST + Outbound CALL_API

_Draft 2026-05-20. Standalone deliverable — ships and is useful on its own.
The assistant work in `docs/assistant-plan.md` will consume this API once it
exists, but every endpoint and action below is independently motivated by
external-integration use cases (scripts, Zapier, the user's own tooling,
phone shortcuts, cron jobs, webhook-driven workflows)._

Two halves, both small and bounded:

1. **Inbound REST** — HTTP endpoints that mirror the existing socket CRUD
   so external callers can manipulate Moduli's state without opening a
   socket connection. Auth via per-user API tokens with scopes. Field
   reads/writes are first-class (Section 1.4) since that's the bulk of any
   integration's traffic. Synchronous operation invocation
   (`POST /api/v1/operations/:id/run`, Section 1.3) is the headliner —
   lets external systems call any user-defined operation with vars and
   get the resulting effects + final `$vars` back in the same response.
2. **Outbound `CALL_API`** — a new pipeline action that lets an operation
   hit an external HTTP endpoint and store the response in `$vars` for
   downstream steps. The same shape any other operation action has — fits
   into the existing executor flow. Pairs with a per-user **Secrets Store**
   (Section 2.3) so API keys never appear in run logs or client code.

**Why these belong together:** they're symmetric. Inbound REST lets the
outside world drive Moduli operations; outbound `CALL_API` lets Moduli
operations drive the outside world. Together they make Moduli a
participant in any HTTP-based workflow instead of a closed app.

This plan grounds in what already exists. The codebase already has:
- `POST /api/webhooks/:operationId` (`server/server.js:523`) — minimal inbound
  trigger for ops. The first item below generalizes this.
- A complete `socketHandlers/crud.js` of CRUD events with consistent shapes.
  The REST surface is a thin HTTP wrapper around those same handlers.
- The pipeline executor (`client/src/helpers/operationExecutor.js` +
  `operationActions.js`) with a typed action catalog. `CALL_API` is one new
  case in `executeActionItem`.

---

## 1. Inbound REST API

### 1.1 Auth

Per-user API tokens stored on the User document. Each token has:

```
{
  id: string,         // surfaced as the "Token ID" in the UI
  name: string,       // user-supplied label ("My Phone", "Zapier", etc.)
  hash: string,       // bcrypt of the raw secret; raw is shown ONCE at creation
  scopes: string[],   // ["read"] | ["read","write"] | ["read","write","admin"]
  createdAt: Date,
  lastUsedAt: Date,
  revoked: boolean,
}
```

CommandCenter → UserSettings tab grows a "API Tokens" section:
- "Generate token" button → modal with name + scope checkboxes → copy-once secret
- List of existing tokens (name, scopes, lastUsedAt, revoke button)

Requests authenticate with `Authorization: Bearer <token>`. Middleware
loads `req.user`, verifies the scope matches the route, and updates
`lastUsedAt` (debounced 60s so we don't write on every call).

**Why tokens not JWTs:** revocable per-token, scopable, and the user can
have multiple. JWT auth stays for the websocket / browser session.

### 1.2 Endpoint shape

Resource-style, mirrors the socket events 1:1. All bodies and responses
are JSON. All `id` paths are the entity's `id` field (UUID), never `_id`.

| Method | Path | Socket equivalent | Scope |
|--------|------|-------------------|-------|
| GET    | `/api/v1/grid` | (current grid summary) | read |
| GET    | `/api/v1/grids` | `getAllGridsForUser` | read |
| POST   | `/api/v1/grids` | `create_grid` | write |
| PATCH  | `/api/v1/grids/:id` | `update_grid` | write |
| DELETE | `/api/v1/grids/:id` | `delete_grid` | admin |
| GET    | `/api/v1/grids/:id/state` | `request_full_state` | read |
| GET    | `/api/v1/modules` (?role&kind&label) | filter from full_state | read |
| POST   | `/api/v1/modules` | `create_module` | write |
| PATCH  | `/api/v1/modules/:id` | `update_module` | write |
| DELETE | `/api/v1/modules/:id` | `delete_module` | write |
| POST   | `/api/v1/modules/:id/trash` | `trash_module` | write |
| POST   | `/api/v1/modules/:id/restore` | `restore_module` | write |
| GET    | `/api/v1/occurrences` (?parentId&moduleId) | filter from full_state | read |
| POST   | `/api/v1/occurrences` | `create_occurrence` | write |
| PATCH  | `/api/v1/occurrences/:id` | `update_occurrence` | write |
| DELETE | `/api/v1/occurrences/:id` | `delete_occurrence` | write |
| POST   | `/api/v1/occurrences/:id/move` | `move_page` etc. | write |
| POST   | `/api/v1/occurrences/:id/copy` | "Copy" semantics — fresh occ, same moduleId | write |
| POST   | `/api/v1/occurrences/:id/copylink` | "Copy-link" — fresh occ + shared linkedGroupId | write |
| GET    | `/api/v1/fields` | filter from full_state | read |
| POST   | `/api/v1/fields` | `create_field` | write |
| PATCH  | `/api/v1/fields/:id` | `update_field` | write |
| DELETE | `/api/v1/fields/:id` | `delete_field` | write |
| GET    | `/api/v1/operations` | filter from full_state | read |
| POST   | `/api/v1/operations` | `create_operation` | write |
| PATCH  | `/api/v1/operations/:id` | `update_operation` | write |
| DELETE | `/api/v1/operations/:id` | `delete_operation` | write |
| POST   | `/api/v1/operations/:id/run` | (new — synchronous run) | write |
| POST   | `/api/v1/templates/:id/apply` | `apply_template` | write |
| POST   | `/api/v1/templates/save` | `clone_subtree_as_template` | write |
| POST   | `/api/v1/templates/:id/save-over` | `save_over_template` | write |

The current `POST /api/webhooks/:operationId` stays as the **unauthenticated**
public webhook trigger (it already exists and is intentionally low-friction
for external services). The new `POST /api/v1/operations/:id/run` is the
**authenticated, synchronous** counterpart.

### 1.3 Synchronous operation invocation (the headliner)

The user's request: "call an operation with the data I'm sending in." This
is what `POST /api/v1/operations/:id/run` is for.

**Endpoint**:

```
POST /api/v1/operations/:id/run
Authorization: Bearer <token>
Content-Type: application/json

{
  "vars": { "$customerEmail": "x@y.com", "$amount": 42 },
  "wait": true,
  "timeoutMs": 30000
}
```

`vars` is folded into `$vars` at pipeline start. Anything the operation's
pipeline reads via `$customerEmail` / `$amount` will resolve to the
caller's values. Combined with `CALL_API` (Section 2), this lets the user
build operations like "given a customer email, look them up in Stripe,
write a new occurrence with their data" and trigger them from any
external service.

**Flow**:
1. Route handler loads the operation, verifies token scope (`write`).
2. Synthesizes a transaction `{ type: "ApiCallOp", apiToken: tokenId,
   ...vars }` so trigger predicates can route on it (matches the
   existing `WebhookOp` pattern).
3. Calls the executor with the synthetic transaction.
4. **If `wait: true`** (default), holds the HTTP response until the
   pipeline completes (or hits `timeoutMs`), then returns:
   ```json
   {
     "ok": true,
     "operationId": "...",
     "runAt": "2026-05-20T19:50:00Z",
     "durationMs": 1247,
     "vars": { "$result": "...", "$total": 8 },
     "effects": [{ "type": "UPDATE_OCCURRENCE", "occurrenceId": "...", ... }],
     "log": [...]
   }
   ```
   The `effects` array surfaces what the op did — useful for callers that
   want to verify a write landed. The `vars` snapshot lets callers
   extract computed values without round-tripping back through a GET.
5. **If `wait: false`**, returns `202 Accepted` with a `runId`. Logs land
   in `OperationRunLog` like any other run — fetchable via
   `GET /api/v1/operations/:id/runs`.

**`SHOW_VALUE` action** can be used to explicitly stage a return value:
the value lands in `$vars` and gets returned in the response. Already
exists in the executor; just needs documenting in the API consumer guide.

**List operations runnable via API**:
```
GET /api/v1/operations?runnable=true
```
Returns ops whose `triggerTypes` includes `onApiCall` (a new trigger
type added alongside the existing `onWebhook` / `onSchedule` / `onLoad`).
Lets any external integration discover what's available — Zapier, the
user's own scripts, phone shortcuts, the future assistant, anything.

**Listing past runs**:
```
GET /api/v1/operations/:id/runs?limit=25
```
Returns recent entries from `OperationRunLog` (already exists; just gets
a REST wrapper).

**Executor changes**:
- `executePipeline` already accepts a `transaction` argument. The HTTP
  handler just constructs one with `type: "ApiCallOp"` and the user's
  vars folded in.
- One new return path: today the executor returns `{ effects, log }` but
  doesn't surface final `$vars`. Easy fix — already in scope of the
  existing return shape.
- New trigger type `onApiCall` so an op author can explicitly opt-in to
  being externally invokable (otherwise `POST .../run` returns 403).

**Calling an op by name** (convenience for humans + integrations):

```
POST /api/v1/operations/run
{
  "name": "Add Expense",            // resolved against op.name in user's grid
  "vars": { "$amount": 42, "$category": "groceries" },
  "wait": true
}
```

Returns `409 conflict` with `{ matches: [{id, name, gridId}] }` when the
name is ambiguous — caller picks an id and retries.

**Cancelling a long-running op**:

```
DELETE /api/v1/operations/runs/:runId
```
Sets the run's abort flag; the executor checks the flag between steps and
unwinds. Same mechanism the future Stop button in OperationsTab will use.

**Dry-run** (compute effects, don't apply):

```
POST /api/v1/operations/:id/run
{
  "vars": {...},
  "dryRun": true
}
```
Returns the same response shape but `effects` are computed and
NOT broadcast / persisted. Useful for any caller that wants to preview
what an op will do before applying (a deploy-bot doing a sanity check, a
test harness, an interactive UI confirming a destructive action) — the
assistant is one such caller. Also useful for testing operations in
isolation.

### 1.4 Field operations (the most common path)

Field values are written to occurrences far more often than entities are
created. The bulk of any integration's traffic will be field writes. So
field operations get a dedicated, ergonomic surface — even though they're
technically just `PATCH /occurrences/:id` calls.

**Read a single field value on an occurrence**:
```
GET /api/v1/occurrences/:id/fields/:fieldId
→ { "value": 42, "flow": "in", "updatedAt": "..." }
```

**Write a single field value**:
```
PUT /api/v1/occurrences/:id/fields/:fieldId
{ "value": 42, "flow": "in" }    // flow optional, defaults to existing
→ 200 with the updated occurrence's fields map
```
Triggers the same `field_value_changed` socket event a UI write would,
so any `onFieldChange` operation predicates fire. This is the bridge
that lets external systems "act like a user" — every existing automation
keeps working because the trigger payload looks identical.

**Bulk-write multiple fields on one occurrence**:
```
PATCH /api/v1/occurrences/:id/fields
{
  "fields": {
    "<fieldId-1>": { "value": 42, "flow": "in" },
    "<fieldId-2>": { "value": "done", "flow": "any" }
  }
}
```
Single transaction, single broadcast. Trigger predicates fire ONCE
against the post-write state (not per field), so trackers can't
double-fire.

**Bulk-write across multiple occurrences** (e.g. "mark all of today's
todos complete"):
```
POST /api/v1/fields/bulk
{
  "writes": [
    { "occurrenceId": "...", "fieldId": "...", "value": true },
    { "occurrenceId": "...", "fieldId": "...", "value": true }
  ]
}
```
Each write fires its own trigger evaluation — matching the per-occurrence
semantics of the UI's "select-many → flip flag" path.

**Read computed values** (what `FieldRenderer` reads for display fields):
```
GET /api/v1/occurrences/:id/computed
→ { "<fieldId>": { "value": 17, "label": "17 / 30g", "color": "..." } }

GET /api/v1/occurrences/:id/computed/:fieldId
→ { "value": 17, "label": "17 / 30g", "color": "..." }
```
Reads from the server-side `computedValues` map (already populated by
the executor on every op run). Avoids the integration having to
re-implement aggregation logic.

**Attach a field to a module** (binding):
```
POST /api/v1/modules/:id/fields
{
  "fieldId": "...",
  "hidden": false,
  "position": 3                 // optional insert position
}

DELETE /api/v1/modules/:id/fields/:fieldId
PATCH  /api/v1/modules/:id/fields/:fieldId
{ "hidden": true, "position": 0 }
```
These are the "field binding" CRUD — distinct from creating the field
itself. A field exists once in `fieldsById` and can be bound to many
modules.

**Field definition CRUD** (the rare path — fields are usually defined
once and reused):
```
GET    /api/v1/fields                          // list all
GET    /api/v1/fields/:id                      // one
POST   /api/v1/fields                          // create
PATCH  /api/v1/fields/:id                      // rename, change type
DELETE /api/v1/fields/:id                      // 409 if bound anywhere unless ?force=true
```

**Field search** (any caller resolving a human-readable field name to id):
```
GET /api/v1/fields?q=water&type=number
→ [{ id, name, type, boundModules: [{id, label}] }]
```
Includes binding info so callers don't need a second round-trip to figure
out where a field is used.

**Why this section gets the most surface area**: field reads/writes
are the bulk of any integration's traffic. A phone shortcut that logs
"drank 8oz water" hits exactly the bulk-write endpoint above. A Zap
that syncs completed tasks to Notion polls the read endpoint. The
future assistant's tool catalog (`docs/assistant-plan.md` §4) maps
heavily to these same paths for the same reason — they're the most
common operation against the data model, regardless of the caller.

### 1.5 Bulk endpoints

For the "do a bunch of things at once" path that integrations always
need:

```
POST /api/v1/batch
{
  "operations": [
    { "method": "POST", "path": "/api/v1/modules", "body": {...} },
    { "method": "PATCH", "path": "/api/v1/occurrences/abc", "body": {...} },
    { "method": "POST", "path": "/api/v1/operations/xyz/run", "body": {...} },
  ]
}
```

Each sub-request runs in order against the same auth context. Response is
an array of `{ status, body }` matching the input order. No transaction
guarantees beyond the existing per-handler atomicity — this is just a
network-roundtrip optimization.

### 1.6 Error shapes

Consistent across all endpoints:

```json
{ "error": "code", "message": "human readable", "details": { ... } }
```

Codes: `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`conflict`, `rate_limited`, `internal_error`.

Status codes: 200 / 201 / 202 / 204 / 400 / 401 / 403 / 404 / 409 / 429 / 500.

### 1.7 Rate limiting

Per-token: 60 requests/minute baseline, configurable per token. Returns
`429 Too Many Requests` with `Retry-After`. In-memory bucket per token
id, persisted state isn't necessary at v1 scale.

### 1.8 Broadcast on writes

Every mutation lands as an `*_updated` socket event to the user's room,
exactly the way the socket handlers already do. Browser tabs see the
external write the same frame an external API call lands — no special
handling. This is the "free" win from layering REST on top of the
existing socket CRUD: state stays consistent across all clients.

### 1.9 OpenAPI document

Ship a `docs/api.openapi.json` alongside the implementation. Auto-served at
`GET /api/v1/openapi.json`. Importable by Postman / Insomnia / Hoppscotch
out of the box, drives the OpenAPI-based codegen tools that integration
authors will reach for, and feeds the future assistant's tool catalog
(`docs/assistant-plan.md` §4). Schemas extracted from the Mongoose models
so they stay in sync.

---

## 2. Outbound: `CALL_API` pipeline action

Lets an operation talk to external services and use the response in
downstream steps.

### 2.1 Action shape

```js
{
  action: "CALL_API",
  cfg: {
    url: "https://api.example.com/customers/$customerEmail",
    method: "POST",          // GET / POST / PUT / PATCH / DELETE
    headers: {
      "Authorization": "Bearer $secrets.STRIPE_KEY",
      "Content-Type": "application/json",
    },
    body: {                  // object → JSON.stringify; string → sent as-is
      email: "$customerEmail",
      amount: "$amount",
      metadata: { gridId: "$gridId" },
    },
    query: { limit: 10 },    // optional query params (URL-encoded)

    timeoutMs: 15000,        // default 10s, max 60s
    retryCount: 0,           // default 0; exponential backoff if > 0
    retryDelayMs: 250,       // base delay; doubles each retry

    // Where to put the response in $vars. The action also always sets
    // $apiResponse for backwards-readability.
    responseVar: "$customerResult",
    extract: {               // optional — pick fields out by JSONPath
      "$customerId": "$.id",
      "$customerName": "$.name",
    },

    // What to do on non-2xx response.
    onError: "fail",         // "fail" (abort pipeline) | "continue" | "branch"
    errorVar: "$apiError",   // when "continue" — error lands here
  }
}
```

All cfg fields resolve through the existing `resolveExpr` machinery so
`$vars` and `$trigger.*` substitutions work inline — same as every other
action.

### 2.2 Variable resolution

The full `resolveExpr` chain applies:
- `$myVar` — pipeline variable
- `$trigger.email` — trigger transaction
- `$grid.activeFilterValues.$dateFieldId` — grid state
- `literal:foo` — escape
- `json:[...]` — inline JSON literal

URL templating uses simple string substitution: `https://api.x.com/u/$id`
becomes `https://api.x.com/u/abc123`. Query params and bodies recurse
through `deepResolveExpr` (already exported from `operationActions.js`).

### 2.3 Secrets

Headers and body values frequently need API keys. Adding a per-user
**Secrets Store**:

```
GET /api/v1/secrets       → [{ key, lastUsedAt }]
POST /api/v1/secrets      → { key, value }  (value never returned again)
DELETE /api/v1/secrets/:key
```

In pipeline expressions: `$secrets.STRIPE_KEY` resolves to the stored
value at execution time. Secret values **never** appear in run logs or
broadcast effects — masked as `***` in any place they'd otherwise leak.

Storage: User document gains `secrets: [{ key, encryptedValue, iv,
createdAt, lastUsedAt }]`. AES-256-GCM with a server-side master key
from `process.env.SECRETS_KEY`. If `SECRETS_KEY` is missing, the
endpoint refuses to accept secrets (fail-closed).

### 2.4 Executor wiring

`executeActionItem` in `operationActions.js` already dispatches by
`action`. Add a new case:

```js
case "CALL_API": {
  const url = resolveExpr(cfg.url, $vars);
  const method = (cfg.method || "GET").toUpperCase();
  const headers = deepResolveExpr(cfg.headers || {}, $vars);
  const body = cfg.body ? deepResolveExpr(cfg.body, $vars) : null;
  const query = deepResolveExpr(cfg.query || {}, $vars);

  const finalUrl = appendQuery(url, query);
  const init = {
    method,
    headers: { ...headers, ...maskSecrets },
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 10000),
  };
  if (body != null && method !== "GET") {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const res = await fetchWithRetry(finalUrl, init, cfg.retryCount ?? 0);
  const parsed = await safeParseJson(res);

  if (!res.ok) {
    if (cfg.onError === "continue") {
      $vars[cfg.errorVar || "$apiError"] = { status: res.status, body: parsed };
      return [];  // proceed
    }
    throw new ActionError(`API ${res.status}`, { status: res.status, body: parsed });
  }

  $vars.$apiResponse = parsed;
  if (cfg.responseVar) $vars[cfg.responseVar] = parsed;
  if (cfg.extract) {
    for (const [varName, path] of Object.entries(cfg.extract)) {
      $vars[varName] = jsonPath(parsed, path);
    }
  }
  return [];  // CALL_API emits no effects
}
```

The executor is already async (other actions like `RUN_OPERATION`
await), so adding network calls is structurally fine. Per-step timeouts
already plumbed via the `signal` pattern above.

### 2.5 Where this runs

**On the server**, not the client. Two reasons:
1. CORS — most external APIs don't allow browser-origin calls.
2. Secrets — we don't want `$secrets.STRIPE_KEY` ever resolving in the
   browser.

This is a behavioral change for the executor: today it runs entirely
client-side. The cleanest path is to detect `CALL_API` (or any other
server-side-only action) at pipeline-load time and route the WHOLE
pipeline to a new server-side executor.

Implementation: `server/services/pipelineExecutor.js` that imports the
same `operationActions.js` / `operationExecutor.js` files via Node ESM,
then runs the pipeline in process. Effects come back through the socket
to the user's room as `apply_operation_effects` events the client
already handles.

For pipelines that don't include `CALL_API`, the existing client-side
executor stays. Server-side fallback is opt-in per-op.

### 2.6 Logging

`CALL_API` log entries follow the existing run-log pattern but redact
secrets:

```json
{
  "action": "CALL_API",
  "url": "https://api.x.com/customers/abc",
  "method": "POST",
  "status": 200,
  "durationMs": 312,
  "requestHeaders": { "Authorization": "***" },
  "responseSummary": { "ok": true, "size": 1842 }
}
```

Full request/response bodies stored ONLY when an "Include bodies" flag
is set on the operation (off by default — bodies can be huge).

### 2.7 Use cases this unlocks

- **Webhook chains** — receive a webhook (`POST /api/webhooks/:opId`),
  parse the payload via `$trigger.body`, call out to enrich, write a
  new occurrence with the enriched data.
- **Sync to external** — when a task is completed, push to a Notion
  database / Linear issue / etc.
- **Pull on schedule** — `onSchedule` op runs daily, pulls a weather
  forecast, writes today's day page with the result.
- **AI integrations** — call OpenAI / Anthropic / Ollama from an op,
  store the response as the text of a new occurrence.

The last one is also why the **assistant LLM plan** can be implemented
without a dedicated assistant server: Jeeves can live entirely inside
the existing op pipeline as a few CALL_API ops talking to Ollama. The
API plan stands on its own, but it also subsumes the assistant's
infrastructure needs as a side effect.

---

## 3. Phased rollout

### Phase 1 — Auth + read endpoints (1 session)
- API token model + UserSettings UI
- `GET /api/v1/grid`, `/grids`, `/modules`, `/occurrences`, `/fields`,
  `/operations`, `/grids/:id/state`
- OpenAPI doc stub

### Phase 2 — Write endpoints (1-2 sessions)
- All POST / PATCH / DELETE entity routes
- `POST /api/v1/operations/:id/run` (sync mode + wait)
- Bulk endpoint
- Broadcast to socket room on writes

### Phase 3 — Secrets + CALL_API (1-2 sessions)
- Secrets store + UI
- Server-side pipeline executor
- `CALL_API` action implementation
- Run-log redaction for secrets

### Phase 4 — Polish
- Rate limiting
- Webhook signing (HMAC) for `/api/webhooks/:opId`
- Streaming responses for long-running ops
- Per-token request log endpoint

---

## 4. Open questions

- **Versioning** — `/api/v1` baked in from day one. Breaking changes go
  to `/v2`. Acceptable.
- **Pagination** — large lists (`/occurrences` on a busy grid) need
  cursor pagination. Spec: `?limit=100&cursor=<base64>`, response
  includes `nextCursor`. Defer to phase 2.
- **Idempotency keys** — for `POST /occurrences` etc., should we
  accept an `Idempotency-Key` header? Yes — store in a TTL cache, dedup
  on hit. Defer to phase 2.
- **Webhook payload signing** — HMAC-SHA256 over body with a
  per-operation secret. The existing `/api/webhooks/:operationId` is
  totally unsigned. Phase 4 hardening.
- **Real-time API** — should we offer a long-polling or SSE endpoint
  for clients that can't open a socket? Probably yes, deferred. Maps to
  the existing socket events 1:1.

---

## 5. Refs

- `server/server.js:523` — `POST /api/webhooks/:operationId` (existing
  partial implementation of the inbound surface)
- `server/socketHandlers/crud.js` — every socket event the REST routes
  will wrap
- `client/src/helpers/operationActions.js` — where `CALL_API` lands as
  a new case in `executeActionItem`
- `client/src/helpers/operationExecutor.js` — orchestrates pipeline
  execution; needs the server-side fork
- `server/models/OperationRunLog.js` — run log storage (already exists)
- `docs/assistant-plan.md` — the LLM plan, which sits on top of this API
