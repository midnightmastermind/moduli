// Assistant eval (local LLM plan, Task 6). Runs Jonah's real code in-process against test grid 2 on prod's REST API,
// times each case, checks the result in Mongo, and deletes everything it made.
//
//   node --env-file=server/.env server/eval/assistant/run.mjs --label llama [--agent <assistantAgent.js>] [--only cps]
//   Set the backend's env first: ASSISTANT_BACKEND=local LLM_URL=http://127.0.0.1:8080
//                            or: ASSISTANT_BACKEND=ollama OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=llama3.2:3b
//                                with --agent pointing at a checkout from BEFORE the switch (its own env names).
// NEVER point it at poms grid: --grid defaults to "test grid 2" and the script refuses any protected grid.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg("--label", "run");
const gridName = arg("--grid", "test grid 2");
const only = arg("--only");
const agentPath = path.resolve(arg("--agent", path.join(here, "../../services/assistantAgent.js")));
const BASE = arg("--base", "https://viafluere.com");
if (/poms/i.test(gridName)) throw new Error("refusing a protected grid");

const cases = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8")).filter((c) => !only || c.id === only);
const { assistantChat, assistantConfirm } = await import(agentPath);
const { default: ApiToken } = await import("../../models/ApiToken.js");
const { isProtectedGrid } = await import("../../utils/protectedGrids.js");

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;
const grid = await db.collection("grids").findOne({ name: gridName });
if (!grid || isProtectedGrid(grid)) throw new Error(`no unprotected grid "${gridName}"`);
const gridId = grid.id || String(grid._id);
const userId = String(grid.userId);
const { rawToken, tokenDoc } = await ApiToken.mint({ userId, name: "assistant eval (delete after)", scopes: ["read", "write"] });

const COLS = ["occurrences", "modules", "fields", "folders", "operations"];
const idsNow = async () => Object.fromEntries(await Promise.all(COLS.map(async (c) => [c, new Set((await db.collection(c).find({ gridId }, { projection: { id: 1 } }).toArray()).map((d) => d.id))])));
const api = async (method, p) => fetch(`${BASE}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${rawToken}` } }).then((r) => r.status).catch(() => 0);

async function cleanup(before) {
  const after = await idsNow();
  const made = Object.fromEntries(COLS.map((c) => [c, [...after[c]].filter((id) => !before[c].has(id))]));
  for (const c of COLS) for (const id of made[c]) await api("DELETE", `/${c}/${encodeURIComponent(id)}`);
  const left = await idsNow();
  return Object.fromEntries(COLS.map((c) => [c, [made[c].length, made[c].filter((id) => left[c].has(id)).length]]));
}

async function check(c, made, setupIds = null, answerText = "") {
  if (c.kind === "question") {
    // A question writes nothing beyond what its setup built, and (when the case knows the answer) says it.
    const extra = made.occurrences.filter((id) => !(setupIds?.occurrences || []).includes(id));
    const said = String(answerText || "");
    const missing = (c.check?.answerHas || []).filter((alts) => ![].concat(alts).some((a) => new RegExp(a, "i").test(said)));
    return { passed: extra.length === 0 && missing.length === 0, why: [extra.length ? `wrote ${extra.length} rows` : "", missing.length ? `answer lacks ${JSON.stringify(missing)}` : ""].filter(Boolean).join("; ") };
  }
  const occs = await db.collection("occurrences").find({ gridId, id: { $in: made.occurrences } }).toArray();
  const mods = new Map((await db.collection("modules").find({ gridId, id: { $in: occs.map((o) => o.moduleId) } }).toArray()).map((m) => [m.id, m]));
  const labelOf = (o) => o.label || mods.get(o.moduleId)?.label || "";
  if (c.id === "cps") {
    const dateField = (await db.collection("fields").findOne({ gridId, name: "Date" }))?.id;
    const rows = occs.filter((o) => labelOf(o) === c.check.label);
    const days = rows.map((o) => String(o.fields?.[dateField]?.value || "").slice(0, 10)).filter(Boolean);
    const good = days.filter((d) => d.startsWith(c.check.month) && c.check.weekdays.includes(new Date(d + "T12:00:00Z").getUTCDay()));
    return { passed: new Set(good).size >= c.check.minRows, why: `${rows.length} rows, ${new Set(good).size} distinct Mon-Thu Nov days` };
  }
  if (c.id === "quicklinks") {
    const board = occs.find((o) => labelOf(o) === c.check.board && mods.get(o.moduleId)?.role === "page");
    const field = await db.collection("fields").findOne({ gridId, name: c.check.field, id: { $in: made.fields } });
    const bms = occs.filter((o) => mods.get(o.moduleId)?.role === "artifact" || /^https?:/.test(mods.get(o.moduleId)?.fileRef || ""));
    const valued = field ? bms.filter((o) => o.fields?.[field.id]?.value != null && o.fields[field.id].value !== "").length : 0;
    const filtered = !!(board && field && (board.filters || []).some((f) => JSON.stringify(f).includes(field.id)));
    const passed = !!board && !!field && bms.length >= c.check.bookmarks && valued >= c.check.bookmarks && filtered;
    return { passed, why: `board ${!!board}, field ${!!field}, bookmarks ${bms.length}, valued ${valued}, filter ${filtered}` };
  }
  if (c.id === "glossary") {
    const docPage = occs.find((o) => mods.get(o.moduleId)?.role === "page" && mods.get(o.moduleId)?.kind === "doc");
    const urlChips = occs.filter((o) => o.meta?.link?.kind === "url").length;
    const appLinks = occs.filter((o) => o.meta?.link?.kind === "occurrence").length;
    const ops = await db.collection("operations").find({ gridId, createdAt: { $gte: new Date(Date.now() - 15 * 60e3) } }).toArray();
    const openOp = ops.some((o) => JSON.stringify(o.pipeline || {}).includes("OPEN_URLS"));
    const passed = !!docPage && urlChips >= 9 && appLinks >= 3 && openOp;
    return { passed, why: `docPage ${!!docPage}, url chips ${urlChips}, in-app links ${appLinks}, open-links op ${openOp}` };
  }
  if (c.check?.edit) {
    // change / remove / undo act on what the setup built: read those rows back by id.
    const setupOccs = await db.collection("occurrences").find({ gridId, id: { $in: setupIds?.occurrences || [] } }).toArray();
    const smods = new Map((await db.collection("modules").find({ gridId, id: { $in: (setupIds?.modules || []) } }).toArray()).map((m) => [m.id, m]));
    const named = (label) => setupOccs.filter((o) => (o.label || smods.get(o.moduleId)?.label) === label);
    const e = c.check.edit;
    if (e === "rename") { const ok = named(c.check.to).length === 1 && named(c.check.from).length === 0; return { passed: ok, why: `${c.check.from}: ${named(c.check.from).length}, ${c.check.to}: ${named(c.check.to).length}` }; }
    if (e === "remove") { const ok = named(c.check.gone).length === 0 && named(c.check.kept).length === 1; return { passed: ok, why: `${c.check.gone}: ${named(c.check.gone).length}, ${c.check.kept}: ${named(c.check.kept).length}` }; }
    if (e === "undo") { const left = setupOccs.length; return { passed: left === 0, why: `${left} of ${setupIds?.occurrences?.length || 0} built rows left` }; }
  }
  return { passed: false, why: "no check" };
}

async function kindsOf(made) {
  const mods = await db.collection("modules").find({ gridId, id: { $in: made.modules } }, { projection: { role: 1, kind: 1, label: 1, fileRef: 1 } }).toArray();
  return mods.map((m) => `${m.role}/${m.kind || "-"}:${(m.label || "").slice(0, 20)}${m.fileRef ? " @" + String(m.fileRef).slice(0, 30) : ""}`);
}

const results = [];
try {
for (const c of cases) {
  let before = null;
  try {
  before = await idsNow();
  // A case may build something first (change / remove / undo need a thing to act on). Built over REST like any
  // client; deleted with the rest by cleanup().
  let setupIds = null;
  if (c.setup) {
    const r = await fetch(`${BASE}/api/v1/build`, { method: "POST", headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ gridId, nodes: c.setup }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (!r?.made) throw new Error(`setup failed: ${JSON.stringify(r).slice(0, 200)}`);
    const mid = await idsNow();
    setupIds = Object.fromEntries(COLS.map((k) => [k, [...mid[k]].filter((id) => !before[k].has(id))]));
    await new Promise((res) => setTimeout(res, 1500));   // let the build's transaction flush before an undo
  }
  const t0 = Date.now();
  let confirmOut = [];
  let first = null, toolCalls = 0, cacheN = null, promptN = null, model = null, out = null, err = null;
  let predN = 0, predMs = 0;   // tokens WRITTEN and the time spent writing them (llama-server timings)
  const onProgress = (p) => {
    if (p.phase === "token" && first == null) first = Date.now() - t0;
    if (p.phase === "timings") {
      cacheN = (cacheN || 0) + (p.timings.cache_n || 0); promptN = (promptN || 0) + (p.timings.prompt_n || 0); model = p.model;
      predN += p.timings.predicted_n || 0; predMs += p.timings.predicted_ms || 0;
    }
  };
  try {
    // A case may select some of what its setup built (by label), the way the window sends a multi-selection.
    let context = null;
    if (c.select && setupIds) {
      const rows = await db.collection("occurrences").find({ gridId, id: { $in: setupIds.occurrences } }).toArray();
      const ms = new Map((await db.collection("modules").find({ gridId, id: { $in: rows.map((o) => o.moduleId) } }).toArray()).map((m) => [m.id, m]));
      const selection = rows.filter((o) => c.select.includes(o.label || ms.get(o.moduleId)?.label)).map((o) => ({ id: o.id, label: o.label || ms.get(o.moduleId)?.label }));
      context = { selection };
    }
    out = await assistantChat({ messages: [{ role: "user", content: c.text }], userId, gridId, context, baseUrl: BASE, apiToken: rawToken, onProgress });
    for (const t of out.transcript || []) toolCalls += (t.toolCalls || []).length;
    for (const p of out.pendingConfirmations || []) { const r = await assistantConfirm({ name: p.name, input: p.input, userId, gridId, baseUrl: BASE, apiToken: rawToken }); confirmOut.push({ name: p.name, input: p.input, output: r.output ?? r.error }); }
  } catch (e) { err = String(e?.message || e); }
  const wallMs = Date.now() - t0;
  const after = await idsNow();
  const made = Object.fromEntries(COLS.map((k) => [k, [...after[k]].filter((id) => !before[k].has(id))]));
  const fullAnswer = (out?.transcript || []).filter((t) => t.role === "assistant").map((t) => t.content).join(" ");
  const verdict = err ? { passed: false, why: err.slice(0, 120) } : await check(c, made, setupIds, fullAnswer);
  const madeKinds = await kindsOf(made);
  const removed = await cleanup(before);
  before = null;
  const answer = (out?.transcript || []).filter((t) => t.role === "assistant").map((t) => t.content).join(" ").slice(0, 160);
  results.push({ case: c.id, mode: out?.mode || "error", model: model || out?.model || "", wallMs, firstTokenMs: first, toolCalls, pending: (out?.pendingConfirmations || []).map((p) => p.name).join(","), cacheN, promptN,
    writeTok: predN, writeTokPerS: predMs ? +(predN / (predMs / 1000)).toFixed(1) : null, passed: verdict.passed, why: verdict.why, answer, removed, confirmOut, madeKinds });
  console.table([results.at(-1)].map(({ answer, removed, ...r }) => r));
  } finally {
    // a case that threw past its own try still gets its rows deleted
    if (before) await cleanup(before).catch(() => {});
  }
}
} finally {
  // the scratch token never outlives the run
  await ApiToken.deleteOne({ _id: tokenDoc._id }).catch(() => {});
}
fs.mkdirSync(path.join(here, "results"), { recursive: true });
const file = path.join(here, "results", `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.table(results.map(({ answer, removed, ...r }) => r));
console.log("wrote", file);
await mongoose.disconnect();
