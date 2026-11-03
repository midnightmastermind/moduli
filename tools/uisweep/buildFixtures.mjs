// tools/uisweep/buildFixtures.mjs — the sweep's fixtures on "poms rebuild", built once, kept, idempotent.
//
//   UISWEEP_TOKEN=<api token> node --env-file=server/.env tools/uisweep/buildFixtures.mjs [--dry]
//
// Root › "Sweep Fields" (board page) › "Sweep Fields" (board container) › "Sweep Row" — one row binding one field per
// type × variant the app has (field matrix, Task 5). Root › "Sweep Canvas" (canvas page). Writes go through the REST
// API (Mongo + the warm cache + the parent's list, mirrored and broadcast); existence is read from Mongo. Ids land in
// tools/uisweep/fixtures.json.
import fs from "node:fs";
import path from "node:path";
import mongoose from "../../server/node_modules/mongoose/index.js";

const GRID = "6ab15587409e94bbeb462694"; // poms rebuild
const ROOT_FOLDER = `usr-root-${GRID}`;
const API = `${process.env.UISWEEP_SITE || "https://viafluere.com"}/api/v1`;
const TOKEN = process.env.UISWEEP_TOKEN;
const DRY = process.argv.includes("--dry");
const OUT = path.join(import.meta.dirname, "fixtures.json");
import { REUSE, CREATE } from "./variants.mjs";

async function api(method, p, body) {
  if (DRY) { console.log("DRY", method, p, JSON.stringify(body).slice(0, 160)); return { dry: true }; }
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

if (!TOKEN && !DRY) throw new Error("set UISWEEP_TOKEN (server/scripts/createApiToken.js <email> read,write uisweep --no-env)");
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
const db = mongoose.connection.db;
const fieldByName = async (name) => db.collection("fields").findOne({ gridId: GRID, name });
const fixtures = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
fixtures.grid = GRID; fixtures.fields = fixtures.fields || {};

for (const [variant, name] of REUSE) {
  const f = await fieldByName(name);
  if (!f) throw new Error(`REFUSED: rebuild has no field "${name}" (${variant})`);
  fixtures.fields[variant] = { id: f.id, name, type: f.type, inputEnabled: f.inputEnabled !== false };
}
for (const [variant, def] of CREATE) {
  let f = await fieldByName(def.name);
  if (!f) { const r = await api("POST", "/fields", { gridId: GRID, inputEnabled: true, displayEnabled: false, ...def }); f = r.field || { id: "(dry)", ...def }; }
  fixtures.fields[variant] = { id: f.id, name: def.name, type: def.type, inputEnabled: true };
}

const findOcc = async (label, roleKind) => {
  const mods = await db.collection("modules").find({ gridId: GRID, label, ...(roleKind ? { role: roleKind[0], kind: roleKind[1] } : {}) }).toArray();
  for (const m of mods) { const o = await db.collection("occurrences").findOne({ gridId: GRID, moduleId: m.id }); if (o) return { occ: o, mod: m }; }
  return null;
};
async function ensurePage(label, kind) {
  const have = await findOcc(label, ["page", kind]);
  if (have) return have.occ.id;
  const m = await api("POST", "/modules", { gridId: GRID, role: "page", kind, label });
  const o = await api("POST", "/occurrences", { gridId: GRID, moduleId: m.module?.id, parentId: ROOT_FOLDER });
  return o.occurrence?.id;
}

const pageId = await ensurePage("Sweep Fields", "board");
let cont = await findOcc("Sweep Fields", ["container", "board"]);
let containerId = cont?.occ?.id;
if (!containerId) {
  const m = await api("POST", "/modules", { gridId: GRID, role: "container", kind: "board", label: "Sweep Fields" });
  const o = await api("POST", "/occurrences", { gridId: GRID, moduleId: m.module?.id, parentId: pageId });
  containerId = o.occurrence?.id;
}
const bindings = Object.values(fixtures.fields).map((f, i) => ({ fieldId: f.id, order: i, role: "input" }));
let row = await findOcc("Sweep Row", ["instance", undefined]);
let rowId = row?.occ?.id;
if (!row) {
  const m = await api("POST", "/modules", { gridId: GRID, role: "instance", label: "Sweep Row", fieldBindings: bindings });
  const o = await api("POST", "/occurrences", { gridId: GRID, moduleId: m.module?.id, parentId: containerId });
  rowId = o.occurrence?.id;
} else {
  const have = new Set((row.mod.fieldBindings || []).map((b) => b.fieldId));
  const add = bindings.filter((b) => !have.has(b.fieldId));
  if (add.length) await api("PATCH", `/modules/${row.mod.id}`, { fieldBindings: [...(row.mod.fieldBindings || []), ...add.map((b, i) => ({ ...b, order: (row.mod.fieldBindings || []).length + i }))] });
}
// The grid hides Tags and Date everywhere; the sweep row states its own visibility (Off = show every bound field),
// the nearest level wins, so the matrix can reach them without touching the grid's setting.
if (rowId && !DRY) await api("PATCH", `/occurrences/${rowId}`, { fieldVisibility: { mode: "off" } });
const canvasId = await ensurePage("Sweep Canvas", "canvas");
Object.assign(fixtures, { pageId, containerId, rowId, canvasId });
if (!DRY) fs.writeFileSync(OUT, JSON.stringify(fixtures, null, 2));
console.log(JSON.stringify({ pageId, containerId, rowId, canvasId, fields: Object.keys(fixtures.fields).length }, null, 1));
await mongoose.disconnect();
