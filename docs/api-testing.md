# Moduli API — Testing Guide

How to set up, exercise, and verify the `/api/v1` REST surface end-to-end.
Companion to `docs/api-plan.md` (the spec).

---

## 1. What you're testing

Two architectural halves, both wired end-to-end as of commit `48b15832`:

```
┌──────────────────────────────────────────────────────────────────────┐
│                          INBOUND REST                                │
│                                                                      │
│  External script ─[HTTPS]→ /api/v1/* (Express router, REST handlers) │
│        │                                                             │
│        │ Bearer token auth (server/middleware/apiAuth.js)            │
│        │ Per-token scopes (read / write / admin)                     │
│        │ Per-user data isolation                                     │
│        ↓                                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Mongoose models (Module, Occurrence, Field, Operation)     │    │
│  │  + io.to(userRoom).emit("*_updated") so connected browser   │    │
│  │  tabs sync the same frame the external write lands.         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│         POST /api/v1/operations/:id/run  ← the headliner             │
│                                                                      │
│  HTTP request lands → server stashes a Promise in opRunBridge        │
│        │ keyed by requestId, emits "run_op_for_api" over socket      │
│        ↓                                                             │
│  Connected client (browser tab OR apiDemoClient.js) picks it up      │
│        │ Runs the op via the full client-side executor               │
│        │ CALL_API actions hit external endpoints from the client     │
│        │ SHOW_VALUE actions stage vars for the response              │
│        ↓                                                             │
│  Client emits "api_op_result" → server resolves the Promise →        │
│  HTTP response returns { ok, vars, effects, durationMs }             │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                          OUTBOUND CALL_API                           │
│                                                                      │
│  Any op pipeline can include a CALL_API step:                        │
│                                                                      │
│     { type: "CALL_API", url, method, headers, query, body,           │
│       responseVar: "$weather", onError: "fail" }                     │
│                                                                      │
│  Action runs in the browser today (Phase 3 will move it server-      │
│  side for secrets + CORS). Suspends the pipeline via the same        │
│  _suspend pattern GET_USER_INPUT uses. Response binds to             │
│  $responseVar; downstream steps see it in $vars.                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Phase 1 + 2 shipped:** auth, every CRUD verb for the 4 main entities,
single + bulk field writes, batch endpoint, sync op invocation, CALL_API
action. **Phase 3 (deferred):** headless server-side executor, Secrets
Store, OpenAPI doc, rate limiting.

---

## 2. Prerequisites

| What | How to verify |
|------|---------------|
| Node 20+ | `node -v` |
| MongoDB reachable | `curl -sS http://localhost:5000/health` (after step 3 starts the server) → `{"ok":true,"db":"ok",...}` |
| `server/.env` populated | `grep MONGO_URI server/.env` |
| At least one user account | use `josh@jpoms.com` from `createDefaultUserData` / `createLiveData` seeds, or `test@moduli.test` |
| At least one grid | true after running any seed script (`server/scripts/createDefaultUserData.js`, `createLiveData.js`, etc.) |
| `socket.io-client` installed in `server/` | already in `server/package.json` |

---

## 3. Setup (do once)

### Start the server

```bash
cd /home/joshpoms/moduli
npm run dev
```

This boots both the client (port 5173) and the server (port 5000). The
client tab at `http://localhost:5173` doubles as the executor for the
`/api/v1/operations/:id/run` endpoint — keep it open in a browser, or
use the headless `apiDemoClient.js` (step 5).

> If port 5000 is taken, start just the server on another port:
> `PORT=5001 node --env-file=server/.env server/server.js`
> Then set `MODULI_API_BASE=http://localhost:5001` for every subsequent
> curl / script call.

### Mint an API token

```bash
node --env-file=server/.env server/scripts/createApiToken.js \
  josh@jpoms.com 'read,write' 'testing'
```

Output:

```
✅ API token minted:
  Token ID:  Rk64OVeNp--W
  User:      josh@jpoms.com
  Scopes:    read, write
  Name:      testing

  Raw token (SAVE THIS — it won't be shown again):
  moduli_Rk64OVeNp--W_sa26EMh3GcgzJ5FttWGZ47yPW0S5rRfi
```

Copy the raw token into your shell:

```bash
export MODULI_API_TOKEN="moduli_Rk64OVeNp--W_sa26EMh3GcgzJ5FttWGZ47yPW0S5rRfi"
```

The token shape is `moduli_<tokenId>_<secret>`. The server bcrypts the
secret half on disk — that raw string is your one chance to copy it.
Lose it → mint a new one (or `db.apitokens.deleteOne(...)` to wipe).

### Seed the demo weather op (for the round-trip demo)

```bash
node --env-file=server/.env server/scripts/seedApiDemoOp.js josh@jpoms.com
```

Adds a `Demo: Weather Lookup` op to the user's first grid. Pipeline:

1. `CALL_API` GET `api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,wind_speed_10m`
2. `INIT_VAR $temperature = $weather.current.temperature_2m`
3. `INIT_VAR $windSpeed = $weather.current.wind_speed_10m`
4. `INIT_VAR $units = $weather.current_units.temperature_2m`
5. Three `SHOW_VALUE` steps surface `$temperature` / `$windSpeed` / `$units` back to the caller.

Idempotent — re-running replaces any prior op with the same name.

---

## 4. Quick smoke test (5 curls)

Run these to confirm every layer of the auth + read + write stack:

```bash
BASE="${MODULI_API_BASE:-http://localhost:5000}"
AUTH="Authorization: Bearer $MODULI_API_TOKEN"
CT="Content-Type: application/json"

# 1) Health (no auth)
curl -sS "$BASE/health"

# 2) Auth wall — missing header
curl -sS "$BASE/api/v1/grids"
# → {"error":"unauthorized","message":"Missing Bearer token"}

# 3) Auth wall — bad token
curl -sS -H "Authorization: Bearer moduli_bad_token" "$BASE/api/v1/grids"
# → {"error":"unauthorized","message":"Invalid or revoked token"}

# 4) Auth pass — list grids
curl -sS -H "$AUTH" "$BASE/api/v1/grids"
# → {"grids":[{"id":"...","name":"...","createdAt":"..."}, ...]}

# 5) Grid state — pick any grid id from #4
GRID="<paste-id-from-above>"
curl -sS -H "$AUTH" "$BASE/api/v1/grids/$GRID/state" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print({k: (len(v) if isinstance(v, list) else v) for k,v in d.items()})"
# → {'grid': {...}, 'modules': 582, 'occurrences': 581, ...}
```

Pass all 5 → auth, scoping, persistence, and broadcast pipes are all
healthy.

---

## 5. The "both halves" round-trip

Two ways: real browser tab or the headless fake client.

### Option A — with a real browser tab (production-shaped)

1. Start the server: `npm run dev`
2. Visit `http://localhost:5173`, log in.
3. In a separate terminal:

```bash
node server/scripts/apiDemo.js
```

The browser tab acts as the executor — when `apiDemo.js` POSTs to
`/api/v1/operations/.../run`, the server emits `run_op_for_api` over
the user's socket room, the tab's `bindSocketToStore.js` picks it up,
runs the op via the full client-side executor (including CALL_API to
open-meteo), and emits `api_op_result` back. Server returns the JSON.

### Option B — headless (terminal-only, no browser)

```bash
# Terminal 1 — server (port 5001 to avoid clashing with npm run dev)
PORT=5001 node --env-file=server/.env server/server.js

# Terminal 2 — fake client (acts as a connected browser tab)
MODULI_API_BASE=http://localhost:5001 \
  node --env-file=server/.env server/scripts/apiDemoClient.js josh@jpoms.com

# Terminal 3 — run the demo
MODULI_API_TOKEN=moduli_... MODULI_API_BASE=http://localhost:5001 \
  node server/scripts/apiDemo.js
```

The fake client is a minimal Node script that connects to the server's
socket.io endpoint and runs `Demo: Weather Lookup` via a tiny inline
executor (just CALL_API + INIT_VAR + SHOW_VALUE). Production uses the
full browser executor.

### Expected output of `apiDemo.js`

```
============================================================
  1. GET /api/v1/grids — list grids
============================================================
  status: 200
  - undefined  (69f3df9ba0192243910d267d)
  - Test Grid  (6a09c83f3e6822a1ed7d8cda)
  - Live Grid  (6a0e26f13c83100f58269e97)

============================================================
  2. GET /api/v1/grids/.../state — snapshot
============================================================
  status: 200
  modules:     582    occurrences: 581
  fields:      77     operations:  49

============================================================
  3. POST /api/v1/operations/:id/run — invoke Demo: Weather Lookup
============================================================
  op id: ac39f1a2-b2e8-48b0-b300-8ac97de4095e
  invoking with vars: { $lat: 41.88, $lon: -87.63 }   (Chicago)
  status:     200       ok: true       durationMs: 584
  vars returned (these came from CALL_API → open-meteo):
    $temperature: 8.3
    $windSpeed: 16.2
    $units: "°C"
  effects emitted: 3
```

The `$temperature` value is **live data** from `api.open-meteo.com`. If
you see a number near current Chicago weather, every layer of the
plumbing is working.

---

## 6. Endpoint reference + recipes

All requests need `Authorization: Bearer $MODULI_API_TOKEN`. Set
`AUTH="Authorization: Bearer $MODULI_API_TOKEN"` and
`BASE=http://localhost:5000` once.

### Grids

```bash
# List grids
curl -sS -H "$AUTH" "$BASE/api/v1/grids"

# Full state snapshot for one grid
curl -sS -H "$AUTH" "$BASE/api/v1/grids/<gridId>/state"
```

### Modules

```bash
# List with filters + pagination
curl -sS -H "$AUTH" "$BASE/api/v1/modules?gridId=<id>&role=container&kind=list&q=water&limit=20"
# → { modules: [...], nextCursor: "<b64>" | null, total: N }
# Use ?cursor=<b64-from-prior-response> to page

# Create
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"gridId":"<gridId>","label":"My Container","role":"container","kind":"list"}' \
  "$BASE/api/v1/modules"

# Update (partial)
curl -sS -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"label":"Renamed"}' \
  "$BASE/api/v1/modules/<moduleId>"

# Delete
curl -sS -X DELETE -H "$AUTH" "$BASE/api/v1/modules/<moduleId>"
```

### Occurrences

```bash
# List
curl -sS -H "$AUTH" "$BASE/api/v1/occurrences?gridId=<id>&parentId=<id>&limit=50"

# Read one
curl -sS -H "$AUTH" "$BASE/api/v1/occurrences/<id>"

# Create
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"gridId":"<gridId>","moduleId":"<moduleId>","parentId":"<parentOccId>","fields":{}}' \
  "$BASE/api/v1/occurrences"

# Update arbitrary fields (filterOverride, meta, parentId, etc.)
curl -sS -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"meta":{"customNote":"hello"}}' \
  "$BASE/api/v1/occurrences/<id>"

# Delete
curl -sS -X DELETE -H "$AUTH" "$BASE/api/v1/occurrences/<id>"

# Write ONE field value (most common write — triggers onChange ops)
curl -sS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"value":42,"flow":"in"}' \
  "$BASE/api/v1/occurrences/<id>/fields/<fieldId>"

# Bulk-write MULTIPLE fields on ONE occurrence (single transaction)
curl -sS -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"fields":{"<fid1>":{"value":1},"<fid2>":{"value":"done","flow":"any"}}}' \
  "$BASE/api/v1/occurrences/<id>/fields"
```

### Fields

```bash
# List (with search + type filter)
curl -sS -H "$AUTH" "$BASE/api/v1/fields?gridId=<id>&q=water&type=number"

# Create
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"gridId":"<gridId>","name":"My Field","type":"number","unit":"oz"}' \
  "$BASE/api/v1/fields"

# Update / Delete (same shape as other entities)
curl -sS -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"Renamed Field"}' "$BASE/api/v1/fields/<id>"
curl -sS -X DELETE -H "$AUTH" "$BASE/api/v1/fields/<id>"

# Bulk-write field values across many occurrences (single round-trip)
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"writes":[
    {"occurrenceId":"<occ1>","fieldId":"<fid>","value":1},
    {"occurrenceId":"<occ2>","fieldId":"<fid>","value":2}
  ]}' \
  "$BASE/api/v1/fields/bulk"
```

### Operations

```bash
# List (filter to externally-runnable)
curl -sS -H "$AUTH" "$BASE/api/v1/operations?gridId=<id>&runnable=true"

# Create / Update / Delete (standard verbs)
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"gridId":"<gridId>","name":"My Op","pipeline":{"sources":[],"steps":[]},"triggerType":"manual"}' \
  "$BASE/api/v1/operations"

# Invoke synchronously — the headliner
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"vars":{"$lat":41.88,"$lon":-87.63},"wait":true,"timeoutMs":30000}' \
  "$BASE/api/v1/operations/<opId>/run"
# → { ok: true, durationMs: 584, vars: {...}, effects: [...], log: [] }

# Fire-and-forget (returns 202 immediately)
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"vars":{"$foo":"bar"},"wait":false}' \
  "$BASE/api/v1/operations/<opId>/run"

# Dry-run (compute effects, don't apply)
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"vars":{"$x":1},"dryRun":true}' \
  "$BASE/api/v1/operations/<opId>/run"
```

### Batch

Pack up to N sub-requests in one HTTP call. Same auth applies to every
sub-request.

```bash
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"operations":[
    {"method":"GET","path":"/grids"},
    {"method":"GET","path":"/operations?runnable=true&limit=5"},
    {"method":"PATCH","path":"/occurrences/<id>","body":{"meta":{"foo":"bar"}}}
  ]}' \
  "$BASE/api/v1/batch"
# → { results: [{ status, body }, { status, body }, ...] }
```

### Error shapes

```json
{ "error": "code", "message": "human readable", "details": { ... } }
```

| Status | `error` | When |
|--------|---------|------|
| 400    | `validation_error` | Missing required body field |
| 401    | `unauthorized`     | No Bearer header, or token invalid/revoked |
| 403    | `forbidden`        | Token lacks required scope |
| 404    | `not_found`        | Entity doesn't exist (or belongs to another user) |
| 503    | `no_executor`      | Op run requested with no connected client (Phase 3 fixes) |
| 504    | `timeout`          | Op run took longer than `timeoutMs` |
| 500    | `internal_error`   | Anything else — check server logs |

---

## 7. Writing your own CALL_API op

Two-minute tutorial for adding a new outbound integration:

1. Pick a public endpoint (e.g. `https://api.github.com/repos/anthropics/anthropic-sdk-python`)
2. Mint an op via the API:

```bash
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "gridId":"<gridId>",
    "name":"GitHub: Repo Stats",
    "triggerType":"manual",
    "triggerTypes":["manual"],
    "pipeline":{
      "sources":[],
      "steps":[
        {"id":"s1","type":"action","config":{
          "type":"CALL_API",
          "url":"https://api.github.com/repos/$owner/$repo",
          "method":"GET",
          "responseVar":"$repo"
        }},
        {"id":"s2","type":"action","config":{
          "type":"INIT_VAR","name":"$stars","expr":"$repo.stargazers_count"
        }},
        {"id":"s3","type":"action","config":{
          "type":"INIT_VAR","name":"$forks","expr":"$repo.forks_count"
        }},
        {"id":"s4","type":"action","config":{
          "type":"SHOW_VALUE","name":"$stars","value":"$stars"
        }},
        {"id":"s5","type":"action","config":{
          "type":"SHOW_VALUE","name":"$forks","value":"$forks"
        }}
      ]
    }
  }' \
  "$BASE/api/v1/operations"
```

3. Invoke it:

```bash
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"vars":{"$owner":"anthropics","$repo":"anthropic-sdk-python"}}' \
  "$BASE/api/v1/operations/<newOpId>/run"
# → { ok: true, vars: { "$stars": 1234, "$forks": 567 }, ... }
```

That's the whole loop: define the op once, invoke it from anywhere
that can make an HTTPS request.

---

## 8. Verifying sync to the live UI

Open the Moduli tab at `http://localhost:5173`, then in a terminal:

```bash
# Pick any occurrence visible in the UI, grab its id (e.g. from devtools
# inspector → look for data-occurrence-id) and a field id
curl -sS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"value":"set from API"}' \
  "$BASE/api/v1/occurrences/<occId>/fields/<fieldId>"
```

The field value should change in the live UI the same frame the curl
returns — REST writes broadcast `occurrence_updated` to the user's
socket room exactly like internal CRUD does.

---

## 9. Running the regression suite

```bash
# Client (731 tests, ~8s)
cd client && ./node_modules/.bin/vitest run --reporter=dot

# Server (111 tests, ~3s)
npm --prefix ./server run test
```

No tests yet target the `/api/v1` routes directly — they're verified
end-to-end via `server/scripts/apiDemo.js`. Adding a vitest suite that
spins up an in-process Express + supertest would be the next step.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `503 no_executor` on `/operations/:id/run` | No connected client. Open `http://localhost:5173` in a browser tab OR run `apiDemoClient.js`. |
| `504 timeout` on op run | The op took longer than `timeoutMs` (default 30000). For long ops bump it or use `wait: false` and poll. |
| `401 unauthorized` after rotating tokens | The old token is hashed in DB — revoke (delete the doc) or mint a fresh one. |
| `apiDemoClient.js` exits immediately | `MONGO_URI` not loaded — make sure you used `--env-file=.env` from the `server/` dir. |
| `apiDemoClient.js` reconnects in a loop | Server isn't on the expected port. Set `MODULI_API_BASE=http://localhost:<port>` before launch. |
| Curl works but UI doesn't sync | The user's socket room is `user:<userId>`. If the UI tab is signed in as a different user than the token's owner, broadcasts won't reach it. |
| Demo op missing | Re-seed: `node --env-file=server/.env server/scripts/seedApiDemoOp.js josh@jpoms.com`. Idempotent. |
| Want to inspect a token | `db.apitokens.find({ tokenId: "<id>" })` in mongo shell. |
| Want to delete all tokens for a user | `db.apitokens.deleteMany({ userId: "<id>" })` |

---

## 11. Phase 3 — headless server-side executor + secrets + OpenAPI + rate limit

Shipped in commit after `cb2bc474`. The biggest unlock: `/operations/:id/run`
no longer requires a browser tab for `CALL_API` ops.

### 11.1 Server-side executor

A lean executor in `server/services/serverExecutor.js` handles the subset
of action types most integrations need:

- `INIT_VAR` / `SET_VAR` — read/write `$vars` with `resolveExpr` support
- `IF` — predicate eval with `IS / IS_NOT / IS_EMPTY / IS_NOT_EMPTY /
  GREATER / GREATER_OR_EQUAL / LESS / LESS_OR_EQUAL / CONTAINS /
  ARRAY_INCLUDES` comparators
- `LOOP` — over arrays in `$vars` with `as` binding
- `CALL_API` — full outbound HTTP including `$secrets.KEY` resolution
- `SHOW_VALUE` — surfaces named results in the response's `vars`

Anything outside this subset (FIND / CREATE / COPY_LINK / APPLY_TEMPLATE /
aggregations / etc.) needs the full client-side executor — open a browser
tab or run `apiDemoClient.js`.

### 11.2 Executor selection

The `/operations/:id/run` endpoint accepts an `executor` field:

```bash
# auto (default) — prefer client if connected, fall back to server
curl -X POST -H "$AUTH" -H "$CT" -d '{"vars":{"$lat":41.88,"$lon":-87.63}}' \
  "$BASE/api/v1/operations/<id>/run"

# server — always headless (CALL_API, INIT_VAR, IF, LOOP, SHOW_VALUE only)
curl -X POST -H "$AUTH" -H "$CT" \
  -d '{"vars":{"$lat":41.88,"$lon":-87.63},"executor":"server"}' \
  "$BASE/api/v1/operations/<id>/run"

# client — require a connected browser tab (503 if none)
curl -X POST -H "$AUTH" -H "$CT" \
  -d '{"vars":{"$lat":41.88,"$lon":-87.63},"executor":"client"}' \
  "$BASE/api/v1/operations/<id>/run"
```

Response now includes `executor: "server" | "client"` so you can tell
which path ran.

**Verified live** (no browser tab, no fake client):

```
$ curl -X POST -H "$AUTH" -H "$CT" \
    -d '{"vars":{"$lat":41.88,"$lon":-87.63}}' \
    http://localhost:5001/api/v1/operations/<weatherOp>/run
{
  "ok": true,
  "durationMs": 534,
  "vars": { "$temperature": 8.2, "$windSpeed": 15.3, "$units": "°C" },
  "effects": [ ... 3 SHOW_VALUE entries ... ],
  "executor": "server"
}
```

### 11.3 Secrets store

Configure the master key (one time per deploy):

```bash
# 32 random bytes, base64-encoded
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "SECRETS_KEY=$SECRETS_KEY" >> server/.env
# Restart server to pick up the env var
```

AES-256-GCM with a unique IV per secret. Server fails closed if
`SECRETS_KEY` is missing — POST `/secrets` returns 503 `secrets_unavailable`.

Endpoints:

```bash
# Store / update a secret (value visible only at create time)
curl -X POST -H "$AUTH" -H "$CT" \
  -d '{"key":"STRIPE_KEY","value":"sk_live_xxx"}' \
  "$BASE/api/v1/secrets"

# List secret keys (no values ever returned)
curl -H "$AUTH" "$BASE/api/v1/secrets"
# → { "secrets": [{ "key": "STRIPE_KEY", "lastUsedAt": "...", "createdAt": "..." }],
#     "configured": true }

# Delete
curl -X DELETE -H "$AUTH" "$BASE/api/v1/secrets/STRIPE_KEY"
```

Use in a `CALL_API` pipeline step:

```json
{
  "type": "CALL_API",
  "url": "https://api.stripe.com/v1/customers",
  "headers": { "Authorization": "Bearer $secrets.STRIPE_KEY" }
}
```

Secrets ONLY resolve in the server-side executor (the client executor
never sees them). The plain `$secrets.X` expression in headers/body/url
is replaced with the decrypted value at execution time.

**Verified live**: created `DEMO_BEARER` → `"my-secret-bearer-xyz"`,
created an op with `headers: { "X-My-Secret": "$secrets.DEMO_BEARER" }`,
invoked via the server executor against `httpbin.org/headers` →
response echoed `X-My-Secret: my-secret-bearer-xyz`. Round-trip works.

### 11.4 Rate limiting

Per-token in-memory token bucket. Default: **600 requests/minute** per
token. Response headers exposed on every request:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 594
```

When a token exceeds its window:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 47
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1779337123

{"error":"rate_limited","message":"Token exceeded 600 requests per 60s window"}
```

Single-process state — multi-instance deploys need a shared backend
(redis) which is deferred.

### 11.5 OpenAPI document

Auto-served — no auth required (intentionally, so tooling can fetch
the spec to discover auth requirements):

```bash
curl http://localhost:5001/api/v1/openapi.json
```

Importable by Postman / Insomnia / Hoppscotch / openapi-generator /
any OpenAPI 3.1 consumer. Covers all 17 path templates, request +
response shapes, security scheme, and the BearerAuth `scopes` field.

Open in [Swagger Editor](https://editor.swagger.io/) for a rendered
view:

1. Open the editor
2. File → Import URL → `http://localhost:5001/api/v1/openapi.json`
3. Browse the endpoints with full schema + try-it-out tabs

---

## 12. Phase 4+ still deferred

- **Webhook signing** — HMAC-SHA256 over `/api/webhooks/:opId`.
- **Idempotency keys** — `Idempotency-Key` header for retry-safe POSTs.
- **Per-token request log endpoint** — `GET /api/v1/tokens/me/requests`.
- **Shared rate-limit backend** for multi-instance deploys.
- **Push the full client executor server-side** for parity. Requires
  splitting the executor out of its React/Redux deps (`sonner`,
  `bindSocketToStore`). Current Phase-3 mini-executor covers the
  common integration case.

See `docs/api-plan.md` §3 (Phased rollout) for the full sequence.
