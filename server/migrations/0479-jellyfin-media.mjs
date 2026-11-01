/**
 * 0479 — Jellyfin media: a "Danny Documentaries" board, Last Watched on the playable rows, and the sync op.
 *
 * Media streaming plan, Task 6. Jellyfin's Documentaries library (D:\Danny on Thor) gets its own board in
 * Boards/Media, copied from the Movies page + board pair at run time (Board Category `documentary`, identity
 * signature `jellyfin:danny` — what services/jellyfinSync.js finds it by), with a "Documentary" module copied
 * from the Movie module for the rows the sync creates there.
 *
 * Last Watched (an existing DATE field) is bound visibly on the Movie, Episode and Documentary modules; a new
 * hidden text field "Watched At" beside it holds the full ISO date-time the sync compares against (a date alone
 * cannot say which of two plays on one day is newer).
 *
 * Op "Jellyfin: Sync" (Library Ops): onLoad + daily at 05:00, CALL_API POST /api/v1/jellyfin/sync with the grid.
 * It is created DISABLED: its first real run writes hundreds of rows, so its dry-run counts go to the user first,
 * and switching it on (Command Center › Operations) is the go-ahead.
 *
 * Writes nothing it finds already present: run twice, one board, one field, one op. Deletes nothing.
 */
import { randomUUID } from "node:crypto";

export const id = "0479-jellyfin-media";
export const describe = "Danny Documentaries board (Boards/Media), Last Watched + hidden Watched At on Movie/Episode/Documentary, op 'Jellyfin: Sync'. Deletes nothing.";
export const touches = ["occurrences", "modules", "fields", "operations"];

export const OP_NAME = "Jellyfin: Sync";
export const BOARD_LABEL = "Danny Documentaries";
export const DANNY_SIGNATURE = "jellyfin:danny";
const TAG = "documentary";
const WATCHED_AT = "Watched At";

const roleKind = (mById, o) => { const m = mById.get(o.moduleId); return `${m?.role}/${m?.kind}`; };
const tagsOf = (o, catId) => { const v = o.fields?.[catId]; const x = v && typeof v === "object" && "value" in v ? v.value : v; return Array.isArray(x) ? x : x ? [x] : []; };
function stripId(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  if (Array.isArray(rest.fieldBindings)) rest.fieldBindings = rest.fieldBindings.map(({ _id: _d, ...b }) => b);
  return rest;
}

export function syncPipeline() {
  return { sources: [], steps: [{ id: randomUUID(), type: "action", config: {
    type: "CALL_API", url: "/api/v1/jellyfin/sync", method: "POST", body: { gridId: "$grid._id" },
    timeoutMs: 60000, responseVar: "$jellyfinSync", onError: "continue", errorVar: "$jellyfinSyncError" } }] };
}

/** Pure: what 0479 would write to `state` ({ gridId, userId, fields, modules, occurrences, operations, folders }). */
export function planJellyfinMigration(state, { newId = randomUUID, now = new Date() } = {}) {
  const { gridId, userId, fields, modules, occurrences, operations, folders } = state;
  const mById = new Map(modules.map((m) => [m.id, m]));
  const one = (name, type) => { const hits = fields.filter((f) => f.name === name && (!type || f.type === type)); if (hits.length > 1) throw new Error(`expected one "${name}" field, found ${hits.length}`); return hits[0] || null; };
  const cat = one("Board Category", "select"); if (!cat) throw new Error('no "Board Category" field');
  const lw = one("Last Watched", "date"); if (!lw) throw new Error('no "Last Watched" date field');
  const plan = { fields: [], bindings: [], board: null, op: null };

  let wa = one(WATCHED_AT);
  if (wa && wa.type !== "text") throw new Error(`REFUSING: a "${WATCHED_AT}" field of type ${wa.type} exists`);
  if (!wa) { wa = { id: newId(), userId, gridId, name: WATCHED_AT, type: "text", folderId: lw.folderId || null, inputEnabled: true, displayEnabled: false, meta: {} }; plan.fields.push(wa); }

  // ── the board ────────────────────────────────────────────────────────────────────────────
  const moviesBox = occurrences.find((o) => roleKind(mById, o) === "container/board" && o.feed?.enabled && !o.meta?.feedSourceId
    && (o.feed.conditions || []).some((c) => c.fieldId === cat.id && c.value === "movie"));
  const moviesPage = moviesBox && occurrences.find((o) => roleKind(mById, o) === "page/board" && (o.occurrences || []).includes(moviesBox.id));
  if (!moviesBox || !moviesPage) throw new Error("REFUSING: no Movies page + board pair to copy");
  const movieRows = occurrences.filter((o) => tagsOf(o, cat.id).includes("movie") && !o.meta?.feedSourceId && !o.feed?.enabled && mById.get(o.moduleId)?.role !== "container");
  const counts = {}; for (const o of movieRows) counts[o.moduleId] = (counts[o.moduleId] || 0) + 1;
  const movieModId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const movieMod = mById.get(movieModId);
  if (!movieMod) throw new Error("REFUSING: no Movie module to copy");

  const withWatch = (bindings) => {
    const have = new Set((bindings || []).map((b) => b.fieldId)), add = [];
    let order = (bindings || []).length;
    if (!have.has(lw.id)) add.push({ fieldId: lw.id, role: "input", order: order++ });
    if (!have.has(wa.id)) add.push({ fieldId: wa.id, role: "input", order: order++, hidden: true });
    return add;
  };

  const existingDanny = occurrences.find((o) => o.identitySignature === DANNY_SIGNATURE);
  if (!existingDanny) {
    const docMod = { ...stripId(movieMod), id: newId(), label: "Documentary" };
    docMod.fieldBindings = [...(docMod.fieldBindings || []), ...withWatch(docMod.fieldBindings)];
    const boxMod = { ...stripId(mById.get(moviesBox.moduleId)), id: newId(), label: BOARD_LABEL, fieldBindings: [] };
    const pageMod = { ...stripId(mById.get(moviesPage.moduleId)), id: newId(), label: BOARD_LABEL, fieldBindings: [] };
    const containerId = newId(), pageId = newId();
    const siblings = occurrences.filter((o) => o.parentId === moviesPage.parentId && roleKind(mById, o) === "page/board");
    plan.board = {
      modules: [docMod, boxMod, pageMod],
      container: { id: containerId, userId: moviesBox.userId || userId, gridId, moduleId: boxMod.id, parentId: null, occurrences: [],
        identitySignature: DANNY_SIGNATURE, filterOverride: moviesBox.filterOverride ?? {}, filters: [],
        feed: { ...moviesBox.feed, conditions: [{ fieldId: cat.id, comparator: "CONTAINS", value: TAG }] },
        fields: { [cat.id]: { value: [TAG], flow: "in" } },
        meta: { ...(moviesBox.meta || {}), documentaryModuleId: docMod.id }, sortOrder: 0 },
      page: { id: pageId, userId: moviesPage.userId || userId, gridId, moduleId: pageMod.id, parentId: moviesPage.parentId,
        occurrences: [containerId], filterOverride: moviesPage.filterOverride ?? null, filterNavConfig: moviesPage.filterNavConfig ?? {},
        fields: {}, meta: {}, sortOrder: Math.max(0, ...siblings.map((o) => o.sortOrder ?? 0)) + 1 },
    };
  }

  // ── bindings: every module a movie / episode / documentary row uses, and the Documentary module ───────────────────
  const watchMods = new Set();
  for (const o of occurrences) {
    const tags = tagsOf(o, cat.id);
    if (!tags.some((t) => t === "movie" || t === "episode" || t === TAG)) continue;
    if (o.feed?.enabled || o.meta?.feedSourceId) continue;
    const m = mById.get(o.moduleId);
    if (m && m.role !== "container" && m.role !== "page") watchMods.add(m.id);
  }
  if (existingDanny?.meta?.documentaryModuleId) watchMods.add(existingDanny.meta.documentaryModuleId);
  for (const mid of watchMods) {
    const m = mById.get(mid); if (!m) continue;
    const add = withWatch(m.fieldBindings);
    if (add.length) plan.bindings.push({ moduleId: mid, add });
  }

  // ── the op ─────────────────────────────────────────────────────────────────────────────────
  if (!operations.some((o) => o.name === OP_NAME)) {
    const folder = folders.find((f) => f.name === "Library Ops" && (f.categoryKind === "op" || f.folderType === "category"));
    const triggerObjects = [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 9 }];
    plan.op = { id: newId(), userId, gridId, name: OP_NAME, folderId: folder?.id || null,
      description: "On load and daily at 05:00: links every Jellyfin movie / show / season / episode / documentary to its row (adding the missing ones) and copies what you played in Jellyfin into Last Watched (0479).",
      pipeline: syncPipeline(), triggerObjects, triggerTypes: ["onLoad"], triggerType: "onLoad", enabled: false,
      schedule: { kind: "atTimes", times: ["05:00"], suppressNotifications: true, lastFiredAt: now.toISOString() }, updatedAt: now };
  }
  return plan;
}

/** Applies a plan to the in-memory state (tests; and what up() mirrors in Mongo). */
export function applyMigrationPlan(state, plan) {
  state.fields.push(...plan.fields);
  for (const b of plan.bindings) { const m = state.modules.find((x) => x.id === b.moduleId); m.fieldBindings = [...(m.fieldBindings || []), ...b.add]; }
  if (plan.board) { state.modules.push(...plan.board.modules); state.occurrences.push(plan.board.container, plan.board.page); }
  if (plan.op) state.operations.push(plan.op);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Folder, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const [occurrences, modules, fields, operations, folders] = await Promise.all([
    Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, feed: 1, meta: 1, identitySignature: 1,
      userId: 1, sortOrder: 1, filterOverride: 1, filterNavConfig: 1 }).lean(),
    Module.find({ gridId }).lean(), Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(), Folder.find({ gridId }).lean(),
  ]);
  const state = { gridId, userId: String(grid.userId), fields, modules, occurrences, operations, folders };
  const plan = planJellyfinMigration(state);
  log(`  field "${WATCHED_AT}": ${plan.fields.length ? "will be created" : "present"}`);
  log(`  board "${BOARD_LABEL}": ${plan.board ? `will be created in folder ${plan.board.page.parentId}` : "present"}`);
  for (const b of plan.bindings) log(`  bind on "${modules.find((m) => m.id === b.moduleId)?.label}": ${b.add.map((a) => fields.find((f) => f.id === a.fieldId)?.name || WATCHED_AT).join(", ")}`);
  log(`  op "${OP_NAME}": ${plan.op ? `will be created (folder ${plan.op.folderId})` : "present"}`);
  if (dryRun) return;

  const now = new Date();
  if (plan.fields.length) await Field.insertMany(plan.fields.map((f) => ({ ...f, createdAt: now, updatedAt: now })));
  for (const b of plan.bindings) await Module.updateOne({ gridId, id: b.moduleId }, { $push: { fieldBindings: { $each: b.add } }, $set: { updatedAt: now } });
  if (plan.board) {
    for (const m of plan.board.modules) await Module.create(m);
    await Occurrence.create({ ...plan.board.container, timestamp: now });
    await Occurrence.create({ ...plan.board.page, timestamp: now });
  }
  if (plan.op) await Operation.create(plan.op);

  // ── read back ─────────────────────────────────────────────────────────────────────────────
  const box = await Occurrence.findOne({ gridId, identitySignature: DANNY_SIGNATURE }).lean();
  const page = box && await Occurrence.findOne({ gridId, occurrences: box.id }).lean();
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  const waAfter = await Field.findOne({ gridId, name: WATCHED_AT }).lean();
  const docMod = box && await Module.findOne({ gridId, id: box.meta?.documentaryModuleId }).lean();
  if (!box || !page || !op || !waAfter || !docMod) throw new Error("readback: board / page / op / Watched At / Documentary module missing");
  const again = planJellyfinMigration({ ...state, ...await (async () => ({
    occurrences: await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, feed: 1, meta: 1, identitySignature: 1, sortOrder: 1 }).lean(),
    modules: await Module.find({ gridId }).lean(), fields: await Field.find({ gridId }).lean(), operations: await Operation.find({ gridId }).lean() }))() });
  if (again.fields.length || again.bindings.length || again.board || again.op) throw new Error("readback: a re-plan is not empty");
  log(`  applied and read back: board ${box.id} on page ${page.id}, op ${op.id} — RESTART pm2.`);
}
