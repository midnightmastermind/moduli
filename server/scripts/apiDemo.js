// scripts/apiDemo.js
//
// End-to-end demo of the /api/v1 surface. Run:
//
//   1. Start the server:        npm run dev
//   2. Open a Moduli tab + log in (the client must be connected to act
//      as the executor — Phase 3 will add a headless server-side
//      executor).
//   3. Mint a token (once):     node --env-file=.env server/scripts/createApiToken.js <email>
//   4. Seed the demo op (once): node --env-file=.env server/scripts/seedApiDemoOp.js <email>
//   5. Run the demo:            MODULI_API_TOKEN=<token> node server/scripts/apiDemo.js
//
// Exercises:
//   GET  /api/v1/grids                      → list grids
//   GET  /api/v1/grids/:id/state            → read full state
//   POST /api/v1/operations/:id/run         → invoke "Demo: Weather Lookup",
//                                              which itself uses CALL_API
//                                              to hit api.open-meteo.com

const TOKEN = process.env.MODULI_API_TOKEN;
const BASE = process.env.MODULI_API_BASE || "http://localhost:5000";

if (!TOKEN) {
  console.error("Set MODULI_API_TOKEN env var. Mint one with:");
  console.error("  node --env-file=.env server/scripts/createApiToken.js <email>");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function req(method, path, body = null) {
  const init = { method, headers };
  if (body != null) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function divider(label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(60));
}

async function main() {
  divider("1. GET /api/v1/grids — list grids");
  const grids = await req("GET", "/api/v1/grids");
  console.log("  status:", grids.status);
  if (grids.status !== 200) { console.error(grids.body); process.exit(1); }
  for (const g of grids.body.grids) console.log(`  - ${g.name}  (${g.id})`);
  const gridId = grids.body.grids[0]?.id;
  if (!gridId) { console.error("No grids."); process.exit(1); }

  divider(`2. GET /api/v1/grids/${gridId}/state — snapshot`);
  const state = await req("GET", `/api/v1/grids/${gridId}/state`);
  console.log("  status:", state.status);
  if (state.status !== 200) { console.error(state.body); process.exit(1); }
  console.log("  modules:    ", state.body.modules.length);
  console.log("  occurrences:", state.body.occurrences.length);
  console.log("  fields:     ", state.body.fields.length);
  console.log("  operations: ", state.body.operations.length);

  divider("3. POST /api/v1/operations/:id/run — invoke Demo: Weather Lookup");
  const op = state.body.operations.find(o => o.name === "Demo: Weather Lookup");
  if (!op) {
    console.error("Demo op not found. Seed it first:");
    console.error("  node --env-file=.env server/scripts/seedApiDemoOp.js <email>");
    process.exit(1);
  }
  console.log("  op id:", op.id);
  console.log("  invoking with vars: { $lat: 41.88, $lon: -87.63 }   (Chicago)");
  const run = await req("POST", `/api/v1/operations/${op.id}/run`, {
    vars: { $lat: 41.88, $lon: -87.63 },
    wait: true,
    timeoutMs: 30000,
  });
  console.log("  status:    ", run.status);
  if (run.status !== 200) { console.error(run.body); process.exit(1); }
  console.log("  ok:        ", run.body.ok);
  console.log("  durationMs:", run.body.durationMs);
  console.log("  vars returned (these came from CALL_API → open-meteo):");
  for (const [k, v] of Object.entries(run.body.vars || {})) {
    console.log(`    ${k}: ${JSON.stringify(v)}`);
  }
  console.log(`  effects emitted: ${run.body.effects?.length || 0}`);

  divider("DONE — both halves of the API plan working end-to-end");
  console.log("  Inbound: external HTTP → /api/v1/operations/:id/run → executor");
  console.log("  Outbound: executor pipeline → CALL_API → open-meteo → response back");
}

main().catch(err => { console.error("Demo failed:", err); process.exit(1); });
