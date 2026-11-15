// services/buildPlan.js — plan everything one `build` call makes (Jonah, 2026-11-15). PURE: no database.
//
// User: "we should be able to make any occurance with jonah" · "everything". Spec:
// docs/superpowers/specs/2026-11-15-jonah-build-anything-design.md. A local model cannot chain twenty calls, so Jonah
// sends ONE tree and this turns it into every record: pages, folders, sections (containers), items (rows with field
// values), textblocks, link chips / bookmark cards, images, fields, and buttons with their operation. Names are
// resolved through `ctx` (the grid as it is) and against what this same build makes (a link to a page made two nodes
// earlier). Anything it cannot do is a `problem`, never a guess.
//
// Shapes it writes are the app's own: link chips are role:"textblock" kind:"inline" with meta.link, LISTED by and
// EMBEDDED in the textblock holding them (as the importer and 0501 do); a doc parent lists AND embeds its children; a
// doc section ends in one hover line (client docs/trailingEmpty).
import { randomUUID } from "node:crypto";
import { coerceValue, findFieldByName, selectMetaFor, expandRepeats } from "./assistantBuildTools.js";

export const NODE_KINDS = ["page", "folder", "section", "item", "text", "link", "image", "file", "field", "button"];
const PAGE_KINDS = new Set(["doc", "board", "canvas", "table"]);
const SECTION_KINDS = new Set(["doc", "board", "table", "canvas"]);

/** A node's kind and name. An object names its kind by key (`{ page: "Home" }`) or `type`; a string is short form. */
export function nodeKind(n) {
  if (typeof n === "string") return { kind: "short", name: n };
  if (!n || typeof n !== "object") return { kind: null };
  for (const k of NODE_KINDS) if (typeof n[k] === "string") return { kind: k, name: n[k] };
  if (NODE_KINDS.includes(n.type)) return { kind: n.type, name: n.name ?? n.label ?? n.text ?? "" };
  return { kind: null };
}

/** "Label | https://url" → link; "Label ->" or "Label -> Page" → in-app link; else an item named by the string. Pure. */
export function parseShort(s) {
  const t = String(s).trim();
  const arrow = t.match(/^(.*?)\s*->\s*(.*)$/);
  if (arrow) return { kind: "link", name: arrow[1].trim(), to: (arrow[2] || arrow[1]).trim() };
  const bar = t.lastIndexOf(" | ");
  if (bar > 0) {
    const url = t.slice(bar + 3).trim();
    if (/^https?:\/\//i.test(url)) return { kind: "link", name: t.slice(0, bar).trim(), url };
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(url)) return { kind: "link", name: t.slice(0, bar).trim(), url: `https://${url}` };
  }
  if (/^https?:\/\/\S+$/i.test(t)) return { kind: "link", name: t.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), url: t };
  return { kind: "item", name: t };
}

const para = (content) => (content && content.length ? { type: "paragraph", content } : { type: "paragraph" });

/**
 * @param {object} args
 * @param {Array} args.nodes   the tree
 * @param {string} [args.under] an existing place to add into (name or "A › B")
 * @param {object} args.ctx    { gridId, userId, rootFolderId, folders:[{id,name,parentId}], fields:[...],
 *                               find(name) → {occId, role, kind, moduleKind} | {folderId} | null,
 *                               buttonFieldFor(label) → {fieldId, listening:Set<actionKey>} | null, mint? }
 * @returns {{ modules, occurrences, folders, fields, operations, attach, problems, made }}
 */
export function planBuild({ nodes = [], under = null, ctx }) {
  const mint = ctx.mint || randomUUID;
  const base = { userId: ctx.userId, gridId: ctx.gridId };
  const out = { modules: [], occurrences: [], folders: [], fields: [], operations: [], attach: [], problems: [], made: [] };
  const fieldsAll = [...(ctx.fields || [])];
  const planned = new Map();            // lowercased name → { occId, role, kind } made in THIS build
  const pendingLinks = [];              // in-app links resolved after the whole tree is planned
  const pendingShows = [];              // "show page X" buttons, same
  const madeButtons = new Map();        // label → { fieldId, listening: Set<action> }

  // ── records ──────────────────────────────────────────────────────────
  const mkModule = (m) => { const mod = { ...base, id: mint(), fieldBindings: [], ...m }; out.modules.push(mod); return mod; };
  const mkOcc = (mod, parentId, extra = {}) => {
    const occ = { ...base, id: mint(), moduleId: mod.id, parentId: parentId ?? null, occurrences: [], fields: {}, ...extra };
    out.occurrences.push(occ);
    return occ;
  };
  const isDoc = (p) => p?.docLike === true;
  // A parent is { occ, module, docLike, boardLike, existing? }. Adding a child lists it; a doc parent embeds it too.
  const addChild = (parent, occ, embedNode) => {
    if (parent.existing) { out.attach.push({ parentId: parent.occ.id, childId: occ.id, doc: isDoc(parent) }); return; }
    parent.occ.occurrences.push(occ.id);
    if (isDoc(parent)) {
      parent.occ.textmap = parent.occ.textmap || { type: "doc", content: [] };
      parent.occ.textmap.content.push(embedNode || { type: "moduleEmbed", attrs: { occurrenceId: occ.id } });
    }
  };

  // ── folders ──────────────────────────────────────────────────────────
  const folderByPath = (path) => {
    if (!path) return { id: ctx.rootFolderId };
    const parts = String(path).split(/\s*(?:›|»|>|\/)\s*/).filter(Boolean);
    let parentId = ctx.rootFolderId; let hit = null;
    const all = [...(ctx.folders || []), ...out.folders];
    for (const p of parts) {
      const kids = all.filter((f) => f.parentId === parentId && f.name.toLowerCase() === p.toLowerCase());
      hit = kids[0] || (parts.length === 1 ? all.find((f) => f.name.toLowerCase() === p.toLowerCase()) : null);
      if (!hit) return null;
      parentId = hit.id;
    }
    return hit;
  };

  // ── buttons ──────────────────────────────────────────────────────────
  const act = (config) => ({ id: mint(), type: "action", config });
  const buttonSteps = (does, hostId) => {
    const d = String(does || "open links").trim();
    if (/^open links?$/i.test(d)) return { key: "open links", steps: [
      act({ type: "FIND", over: "$allOccurrences", multiple: true, itemVar: "$links", predicate: { operator: "AND", rules: [
        { id: mint(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$trigger.occurrenceId" },
        { id: mint(), left: "meta.link.kind", comparator: "IS", right: "url" },
      ] } }),
      act({ type: "OPEN_URLS", urls: "$links" }),
    ] };
    const show = d.match(/^show(?: page)?\s+(.+)$/i);
    if (show) return { key: `show ${show[1].toLowerCase()}`, target: show[1], steps: null };
    const add = d.match(/^add (?:an? )?(?:item|row) (?:to|in)\s+(.+)$/i);
    if (add) return { key: `add ${add[1].toLowerCase()}`, addTo: add[1], steps: null };
    return { error: `a button can "open links", "show page <name>" or "add item to <name>" — not "${d}"` };
  };
  const addButton = (owner, node) => {
    const label = node.button || node.label || "Open in browser";
    const spec = buttonSteps(node.does, owner.occ.id);
    if (spec.error) { out.problems.push(spec.error); return; }
    // The same label is the same button: one field, and one operation per action (made here OR already on the grid).
    const key = label.toLowerCase();
    if (!madeButtons.has(key)) {
      const onGrid = ctx.buttonFieldFor?.(label);
      if (onGrid) madeButtons.set(key, { fieldId: onGrid.fieldId, listening: new Set(onGrid.listening || []) });
      else {
        const f = { ...base, id: mint(), name: label, type: "button", meta: { buttonLabel: label } };
        out.fields.push(f); fieldsAll.push(f);
        madeButtons.set(key, { fieldId: f.id, listening: new Set() });
      }
    }
    const existing = madeButtons.get(key);
    const fieldId = existing.fieldId;
    // the button shows on the owner (an existing owner's binding is added by the route — `bindOn`)
    if (owner.existing) out.attach.push({ bindOn: owner.occ.moduleId, fieldId });
    else owner.module.fieldBindings.push({ fieldId, role: "input", order: owner.module.fieldBindings.length });
    if (existing.listening.has(spec.key)) return;        // an operation already does this for that button
    const op = { ...base, id: mint(), name: `${label}: ${spec.key}`, enabled: true,
      description: `The "${label}" button: ${spec.key}.`,
      triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: fieldId, priority: 5 }],
      triggerTypes: ["onButton"], triggerType: "onButton", pipeline: { sources: [], steps: spec.steps || [] } };
    out.operations.push(op);
    if (spec.target) pendingShows.push({ op, name: spec.target, mode: "show" });
    if (spec.addTo) pendingShows.push({ op, name: spec.addTo, mode: "add" });
    existing.listening.add(spec.key);
  };

  // ── link chips (in a doc) ───────────────────────────────────────────
  // Consecutive links under a doc parent become ONE textblock holding a bullet list of chips.
  const linkList = (parent, links) => {
    const tbMod = mkModule({ role: "textblock", kind: "doc", label: "" });
    const tb = mkOcc(tbMod, parent.occ.id, {});
    const items = [];
    for (const l of links) {
      const link = l.url ? { kind: "url", url: l.url } : null;
      const cm = mkModule({ role: "textblock", kind: "inline", label: l.name, meta: link ? { link } : {} });
      const co = mkOcc(cm, tb.id, { meta: link ? { link } : {}, textmap: { type: "doc", content: [para([{ type: "text", text: l.name }])] } });
      if (l.to) pendingLinks.push({ name: l.to, mods: [cm], occs: [co] });
      tb.occurrences.push(co.id);
      items.push({ type: "listItem", content: [para([{ type: "instanceTextblockInline", attrs: { occurrenceId: co.id, instanceId: cm.id } }])] });
    }
    tb.textmap = { type: "doc", content: [{ type: "bulletList", content: items }] };
    addChild(parent, tb, { type: "instanceTextblock", attrs: { instanceId: tbMod.id, occurrenceId: tb.id } });
  };

  // ── items ────────────────────────────────────────────────────────────
  const itemValues = (byName = {}) => {
    const fields = {}; const bindings = [];
    for (const [name, raw] of Object.entries(byName || {})) {
      if (raw == null || raw === "") continue;
      const f = findFieldByName(fieldsAll, name);
      if (f.error) { out.problems.push(f.error); continue; }
      if (f.field.type === "occurrence") { out.problems.push(`${name}: a value pointing at another row is set with create_items`); continue; }
      const v = coerceValue(f.field, raw);
      if (v.error) { out.problems.push(v.error); continue; }
      fields[f.field.id] = { value: v.value, flow: "in" };
      bindings.push({ fieldId: f.field.id, role: "input", order: bindings.length });
    }
    return { fields, bindings };
  };
  const makeItem = (parent, node, name) => {
    const rows = node.repeat ? expandRepeats([{ label: name, fields: node.fields || {}, repeat: node.repeat }]) : [{ label: name, fields: node.fields || {} }];
    if (rows.error) { out.problems.push(rows.error); return; }
    const list = Array.isArray(rows) ? rows : rows.items || [];
    let shared = null;
    for (const r of list) {
      const { fields, bindings } = itemValues(r.fields);
      if (!shared) shared = mkModule({ role: "instance", label: name, fieldBindings: bindings });
      const occ = mkOcc(shared, parent.occ.id, { fields });
      addChild(parent, occ);
      for (const b of node.children || []) if (nodeKind(b).kind === "button") addButton({ occ, module: shared }, b);
    }
    out.made.push(list.length > 1 ? `${list.length} × ${name}` : `item ${name}`);
  };

  // ── walk ─────────────────────────────────────────────────────────────
  const place = (parent, children) => {
    let run = [];
    const flush = () => { if (run.length) { if (isDoc(parent)) linkList(parent, run); else for (const l of run) bookmark(parent, l); run = []; } };
    for (const raw of children || []) {
      let { kind, name } = nodeKind(raw);
      let node = typeof raw === "string" ? {} : raw;
      if (kind === "short") { const s = parseShort(name); kind = s.kind; name = s.name; node = s; }
      if (kind === "link") { run.push({ name, url: node.url, to: node.to }); continue; }
      flush();
      if (!kind) { out.problems.push(`not a node: ${JSON.stringify(raw).slice(0, 80)}`); continue; }
      build(parent, kind, name, node);
    }
    flush();
  };
  const bookmark = (parent, l) => {
    if (l.to) { out.problems.push(`"${l.name}": an in-app link goes in a doc page or section`); return; }
    const m = mkModule({ role: "artifact", kind: "bookmark", label: l.name, fileRef: l.url, meta: { url: l.url } });
    addChild(parent, mkOcc(m, parent.occ.id, { meta: { url: l.url } }));
    out.made.push(`bookmark ${l.name}`);
  };
  const remember = (name, occ, role, kind) => planned.set(String(name).toLowerCase(), { occId: occ.id, role, kind });

  function build(parent, kind, name, node) {
    switch (kind) {
      case "folder": {
        const into = node.in ? folderByPath(node.in) : parent?.folderId ? { id: parent.folderId } : { id: ctx.rootFolderId };
        if (!into) { out.problems.push(`no folder "${node.in}"`); return; }
        const f = { ...base, id: mint(), name, parentId: into.id, icon: "folder", sortOrder: 0, isExpanded: true, meta: {} };
        out.folders.push(f);
        const card = mkOcc(mkModule({ role: "page", kind: "folder", label: name }), f.id);
        remember(name, card, "page", "folder");
        out.made.push(`folder ${name}`);
        place({ folderId: f.id }, node.children);
        return;
      }
      case "page": {
        const pk = node.kind === "folder" ? null : (PAGE_KINDS.has(node.kind) ? node.kind : "doc");
        if (!pk) return build(parent, "folder", name, node);
        const into = node.in ? folderByPath(node.in) : parent?.folderId ? { id: parent.folderId } : { id: ctx.rootFolderId };
        if (!into) { out.problems.push(`no folder "${node.in}"`); return; }
        const mod = mkModule({ role: "page", kind: pk, label: name });
        const occ = mkOcc(mod, into.id, pk === "doc" ? { textmap: { type: "doc", content: [] } } : {});
        remember(name, occ, "page", pk);
        out.made.push(`${pk} page ${name}`);
        const me = { occ, module: mod, docLike: pk === "doc" };
        for (const b of (node.children || []).filter((c) => nodeKind(c).kind === "button")) addButton(me, b);
        place(me, (node.children || []).filter((c) => nodeKind(c).kind !== "button"));
        return;
      }
      case "section": {
        if (!parent?.occ) { out.problems.push(`section "${name}" needs a page or section around it (or "under")`); return; }
        const sk = SECTION_KINDS.has(node.kind) ? node.kind : (isDoc(parent) ? "doc" : "board");
        const mod = mkModule({ role: "container", kind: sk, label: name, meta: isDoc(parent) ? { headingLevel: parent.depth ? 3 : 2 } : {} });
        const occ = mkOcc(mod, parent.occ.id, sk === "doc" ? { textmap: { type: "doc", content: [] } } : {});
        addChild(parent, occ);
        remember(name, occ, "container", sk);
        out.made.push(`section ${name}`);
        const me = { occ, module: mod, docLike: sk === "doc", depth: (parent.depth || 0) + 1 };
        for (const b of (node.children || []).filter((c) => nodeKind(c).kind === "button")) addButton(me, b);
        if (node.filter) {
          const f = findFieldByName(fieldsAll, node.filter);
          if (f.error) out.problems.push(f.error);
          else occ.filters = [{ id: mint(), fieldId: f.field.id, active: true, showNav: true, comparator: "IS", hides: false }];
        }
        place(me, (node.children || []).filter((c) => nodeKind(c).kind !== "button"));
        if (sk === "doc") occ.textmap.content.push({ type: "paragraph" }); // the hover line
        return;
      }
      case "item": {
        if (!parent?.occ) { out.problems.push(`item "${name}" needs a page or section around it (or "under")`); return; }
        return makeItem(parent, node, name);
      }
      case "text": {
        if (!parent?.occ) { out.problems.push("text needs a page or section around it (or \"under\")"); return; }
        const lines = String(name || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        const mod = mkModule({ role: "textblock", kind: "doc", label: "" });
        const occ = mkOcc(mod, parent.occ.id, { textmap: { type: "doc", content: lines.map((l) => para([{ type: "text", text: l }])) } });
        addChild(parent, occ, { type: "instanceTextblock", attrs: { instanceId: mod.id, occurrenceId: occ.id } });
        out.made.push("text");
        return;
      }
      case "image": case "file": {
        if (!parent?.occ) { out.problems.push(`${kind} needs a page or section around it`); return; }
        const url = node.url || name;
        if (!/^https?:\/\//i.test(url || "")) { out.problems.push(`${kind} needs a url`); return; }
        const m = mkModule({ role: "artifact", kind: kind === "image" ? "image" : "file", label: node.label || url.split("/").pop(), fileRef: url });
        addChild(parent, mkOcc(m, parent.occ.id));
        out.made.push(`${kind} ${m.label}`);
        return;
      }
      case "field": {
        if (findFieldByName(fieldsAll, name).field) { out.problems.push(`field "${name}" already exists — used as is`); return; }
        const type = node.fieldType || node.type_ || node.kind || "text";
        const f = { ...base, id: mint(), name, type, meta: type === "select" ? selectMetaFor(node.options || [], { multiSelect: !!node.multiSelect }) : {} };
        out.fields.push(f); fieldsAll.push(f);
        out.made.push(`field ${name}`);
        return;
      }
      case "button": {
        if (!parent?.occ) { out.problems.push("a button goes on a page, section or item"); return; }
        return addButton(parent, node);
      }
      default: out.problems.push(`unknown node kind "${kind}"`);
    }
  }

  // ── where it goes ────────────────────────────────────────────────────
  let top = { folderId: ctx.rootFolderId };
  if (under) {
    const hit = ctx.find?.(under);
    if (!hit) { out.problems.push(`nothing named "${under}" to add into`); return out; }
    if (hit.folderId) top = { folderId: hit.folderId };
    else top = { occ: { id: hit.occId, moduleId: hit.moduleId }, existing: true, docLike: hit.kind === "doc", depth: hit.role === "container" ? 1 : 0 };
  }
  place(top, nodes);

  // ── names resolved after the whole tree exists ───────────────────────
  const resolve = (name) => planned.get(String(name).toLowerCase()) || ctx.find?.(name) || null;
  for (const p of pendingLinks) {
    const hit = resolve(p.name);
    const target = hit?.occId || null;
    if (!target) { out.problems.push(`no page or folder named "${p.name}" — left as plain text`); continue; }
    const link = { kind: "occurrence", occId: target };
    for (const m of p.mods) m.meta = { ...(m.meta || {}), link };
    for (const o of p.occs) o.meta = { ...(o.meta || {}), link };
  }
  for (const s of pendingShows) {
    const hit = resolve(s.name);
    if (!hit?.occId) { out.problems.push(`no page named "${s.name}" for the button`); s.op.enabled = false; continue; }
    s.op.pipeline.steps = s.mode === "show"
      ? [act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: hit.occId })]
      : [act({ type: "CREATE", name: "New item", role: "instance", parent: hit.occId })];
  }
  return out;
}
