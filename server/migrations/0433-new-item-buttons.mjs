/**
 * 0433 — "New movie / book / song / artist / album / author / series / person / routine / task" buttons.
 *
 * User 2026-10-25: "add a new movies, books, music, artist, routine, task, etc button". A button picks no
 * operation; an operation LISTENS to it (an On Button trigger on that field). So each board gets:
 *  - a button field "New <x>" (category Buttons) bound on the board's container, and
 *  - an operation "New <x>" (op category Buttons) listening to it: Ask with a form → Create → Scroll to.
 *
 * What the form asks and what the Create writes is read off the board's own rows, never named here:
 *  - SHARED module (≥ half the rows place one module — every media library): the new row is another placement of
 *    it, named by the form; the form asks the module's visible input fields.
 *  - otherwise (People): a new module of the rows' role, with the fields at least half the rows bind (their hidden
 *    flags kept); the form asks the visible input ones.
 *  - values every row holds identically (Board Category = movie …) are written as fixed values, not asked.
 *  - WHERE targets (Routines areas, Tasks): the form also asks which container (a choice of the area's
 *    sub-containers / the Tasks containers); the fields every row there binds are bound empty.
 * Media / files / display / button fields are never asked. Idempotent: a board already carrying a button with the
 * same label is skipped. Writes fields, operations, folders and the container modules' bindings; deletes nothing.
 */
import { randomUUID } from "node:crypto";

export const id = "0433-new-item-buttons";
export const describe = "Adds New movie/book/song/artist/album/author/series/person/routine/task buttons, each with a listening form → create → scroll-to operation. Deletes nothing.";
export const touches = ["fields", "operations", "folders", "modules"];

// Board containers on poms grid (the populated one where a page name repeats), with the button text.
export const TARGETS = [
  { container: "0cti4si13ijy", expect: "Movies", label: "New movie" },
  { container: "j0rmo0vsqbhq", expect: "Books", label: "New book" },
  { container: "omK6EzlhYDoQ", expect: "Songs", label: "New song" },
  { container: "z0uq2xk0cs1h", expect: "Artists", label: "New artist" },
  { container: "9u204s73cxy8", expect: "Albums", label: "New album" },
  { container: "1mrwt3hindvx", expect: "Authors", label: "New author" },
  { container: "4l9lpinrjgxp", expect: "TV Series", label: "New series" },
  { container: "QaZWtRFE7GCM", expect: "People", label: "New person" },
  ...["-Z6LtlgXmTel", "nAyceEP45waM", "QAZXlo0ZAIf7", "O8G12R1ufQFS", "ql1jxBfNyOXR", "4_sLdLP_kHk2", "M1Mj5TrdDG5o",
    "cSTDNz86SFSo", "K_uxemw48Gsw"].map((c) => ({ container: c, label: "New routine", where: "children" })),
  { container: "542da7cf-79a9-4a85-be33-cce33327aa72", expect: "Todo", label: "New task", where: "page-siblings" },
];

const LEAF = new Set(["instance", "artifact", "textblock"]);
const NO_ASK = new Set(["media", "files", "button"]);
const filled = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** Fields every row holds with the same non-empty value. Needs 2+ rows. Pure. */
export function agreedValues(rows, fieldIds) {
  const out = {};
  if (rows.length < 2) return out;
  for (const fid of fieldIds) {
    const first = rows[0]?.fields?.[fid]?.value;
    if (!filled(first)) continue;
    const key = JSON.stringify(first);
    if (rows.every((r) => JSON.stringify(r?.fields?.[fid]?.value) === key)) out[fid] = first;
  }
  return out;
}

/** The binding each field first carries among `rows`, and how many rows bind it. Pure. */
export function bindingCensus(rows, modById) {
  const first = new Map(); const count = new Map();
  for (const r of rows) {
    for (const b of modById.get(r.moduleId)?.fieldBindings || []) {
      if (!b?.fieldId) continue;
      if (!first.has(b.fieldId)) first.set(b.fieldId, b);
      count.set(b.fieldId, (count.get(b.fieldId) || 0) + 1);
    }
  }
  return { first, count };
}

const slug = (s, taken) => {
  const base = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  let k = base, n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  taken.add(k);
  return k;
};
const step = (config) => ({ id: randomUUID(), type: "action", config });

/** Plan one target. Pure over the loaded maps. */
export function planTarget(t, { occById, modById, fieldById, childrenOf }) {
  const container = occById.get(t.container);
  const cmod = container && modById.get(container.moduleId);
  if (!container || !cmod) return { skip: `container ${t.container} not found` };
  if (t.expect && cmod.label !== t.expect) return { skip: `container ${t.container} is "${cmod.label}", expected "${t.expect}"` };

  // Where the new row can go, and the rows that describe its shape.
  let places = null;
  if (t.where === "children") places = childrenOf(container).filter((c) => modById.get(c.moduleId)?.role === "container");
  if (t.where === "page-siblings") {
    const page = [...occById.values()].find((o) => (o.occurrences || []).includes(container.id) && modById.get(o.moduleId)?.role === "page");
    places = page ? childrenOf(page).filter((c) => modById.get(c.moduleId)?.role === "container") : [];
  }
  const scope = places || [container];
  const rows = scope.flatMap((c) => childrenOf(c)).filter((o) => LEAF.has(modById.get(o.moduleId)?.role || "instance"));

  const items = [{ key: "name", label: "Name", type: "text", required: true }];
  const taken = new Set(["name"]);
  if (places) {
    items.push({ key: slug("where", taken), label: "Where", type: "select", required: true,
      options: places.map((p) => ({ value: p.id, label: p.label || modById.get(p.moduleId)?.label || p.id })) });
  }
  const create = { type: "CREATE", parent: places ? "$form.values.where" : "$trigger.occurrenceId", itemIdVar: "$newId", fields: {} };

  const { first, count } = bindingCensus(rows, modById);
  const modCount = new Map();
  for (const r of rows) modCount.set(r.moduleId, (modCount.get(r.moduleId) || 0) + 1);
  const [sharedId, sharedN] = [...modCount.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const shared = !places && sharedN >= 2 && sharedN * 2 >= rows.length ? modById.get(sharedId) : null;

  // The fields that make up the shape: the shared module's, else those half (or, with Where, all) the rows bind.
  const need = places ? rows.length : Math.ceil(rows.length / 2);
  const shapeBindings = shared
    ? (shared.fieldBindings || []).filter((b) => b?.fieldId)
    : [...first.values()].filter((b) => rows.length && (count.get(b.fieldId) || 0) >= need);
  const usable = shapeBindings.filter((b) => {
    const f = fieldById.get(b.fieldId);
    return f && !f.trashed && f.displayEnabled !== true && f.type !== "button" && (b.role || "input") !== "display";
  });
  const agreed = places ? {} : agreedValues(rows, usable.map((b) => b.fieldId));
  const fieldHidden = {};
  for (const b of usable) {
    const f = fieldById.get(b.fieldId);
    if (b.hidden === true) fieldHidden[b.fieldId] = true;
    if (b.fieldId in agreed) { const v = agreed[b.fieldId]; create.fields[f.id] = typeof v === "string" ? `literal:${v}` : v; continue; }
    const askable = !places && b.hidden !== true && !NO_ASK.has(f.type) && f.inputEnabled !== false && (b.role || "input") === "input";
    if (!askable) { if (!shared) create.fields[f.id] = null; continue; }
    // A field called "Name" is what the form's own Name answers — fill it, don't ask twice.
    if (String(f.name).trim().toLowerCase() === "name") { create.fields[f.id] = "$form.values.name"; continue; }
    items.push({ key: slug(f.name, taken), label: f.name, fieldId: f.id });
    create.fields[f.id] = `$form.fields.${f.id}`;
  }
  if (shared) Object.assign(create, { module: shared.id, occurrenceLabel: "$form.values.name" });
  else {
    const roleN = new Map();
    for (const r of rows) { const m = modById.get(r.moduleId); const k = `${m?.role || "instance"}|${m?.kind || ""}`; roleN.set(k, (roleN.get(k) || 0) + 1); }
    const [rk] = [...roleN.entries()].sort((a, b) => b[1] - a[1])[0] || ["instance|"];
    const [role, kind] = rk.split("|");
    Object.assign(create, { role, ...(kind ? { kind } : {}), name: "$form.values.name", newModule: true });
    if (Object.keys(fieldHidden).length) create.fieldHidden = fieldHidden;
  }
  const steps = [
    step({ type: "ASK_FORM", title: t.label, submitLabel: "Add", items }),
    step(create),
    step({ type: "SCROLL_TO", itemIdExpr: "$newId" }),
  ];
  return { container, cmod, rows: rows.length, shared: shared?.label || null, items, create, steps };
}

async function category(Folder, { gridId, userId, kind, dryRun, log }) {
  const hit = await Folder.findOne({ gridId, folderType: "category", categoryKind: kind, name: "Buttons" }).lean();
  if (hit) return hit.id;
  const id = randomUUID();
  log(`  new ${kind} category "Buttons"`);
  if (!dryRun) await Folder.create({ id, userId, gridId, parentId: null, name: "Buttons", icon: "folder", sortOrder: 300, isExpanded: true, folderType: "category", categoryKind: kind, meta: {} });
  return id;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Folder, Grid } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).select("id moduleId occurrences label fields parentId").lean(),
    Module.find({ gridId }).select("id label role kind fieldBindings").lean(),
    Field.find({ gridId }).select("id name type meta displayEnabled inputEnabled trashed").lean(),
  ]);
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const childrenOf = (o) => (o.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
  const maps = { occById, modById, fieldById, childrenOf };

  const plans = [];
  for (const t of TARGETS) {
    const p = planTarget(t, maps);
    if (p.skip) { log(`  SKIP ${t.label}: ${p.skip}`); continue; }
    const already = (p.cmod.fieldBindings || []).some((b) => {
      const f = fieldById.get(b.fieldId);
      return f?.type === "button" && (f.meta?.buttonLabel || f.name) === t.label;
    });
    if (already) { log(`  ${t.label} on ${p.cmod.label}: already there`); continue; }
    plans.push({ t, ...p });
    log(`  ${t.label.padEnd(12)} on ${String(p.cmod.label).padEnd(14)} rows ${String(p.rows).padStart(5)} · ${p.shared ? `places "${p.shared}"` : `${p.create.role}${p.create.kind ? "/" + p.create.kind : ""}`} · asks ${p.items.map((i) => i.label).join(", ")} · fixed ${Object.entries(p.create.fields).filter(([, v]) => v != null && !String(v).startsWith("$form")).map(([k]) => fieldById.get(k)?.name).join(", ") || "—"}`);
  }
  if (!plans.length || dryRun) return;

  const fieldCat = await category(Folder, { gridId, userId, kind: "field", dryRun, log });
  const opCat = await category(Folder, { gridId, userId, kind: "op", dryRun, log });
  const usedNames = new Set(fields.map((f) => (f.name || "").toLowerCase()));
  for (const p of plans) {
    let name = p.t.label;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${p.t.label} ${n}`;
    usedNames.add(name.toLowerCase());
    const fieldId = randomUUID();
    await Field.create({ id: fieldId, userId, gridId, name, type: "button", folderId: fieldCat, meta: { buttonLabel: p.t.label } });
    await Operation.create({
      id: randomUUID(), userId, gridId, name: p.t.label, folderId: opCat,
      description: `Runs when "${p.t.label}" is pressed on ${p.cmod.label}: asks with a form, creates the new occurrence, scrolls to it.`,
      pipeline: { sources: [], steps: p.steps },
      triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: fieldId, priority: 5 }],
      triggerTypes: ["onButton"], triggerType: "onButton", enabled: true,
    });
    const bindings = [...(p.cmod.fieldBindings || [])];
    bindings.push({ fieldId, role: "input", order: bindings.length });
    await Module.updateOne({ gridId, id: p.cmod.id }, { $set: { fieldBindings: bindings } });
    p.cmod.fieldBindings = bindings;
  }
  log(`  applied: ${plans.length} buttons + operations. RESTART pm2.`);
}
