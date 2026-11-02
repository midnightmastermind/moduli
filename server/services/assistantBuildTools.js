// services/assistantBuildTools.js
// ============================================================
// Jonah's "build" tools — the multi-step things a small local model cannot
// plan one REST call at a time (measured 2026-11-02: llama3.2 3B asked for a
// Quick Links board created a module with role "board" and stopped).
//
//   create_board  — a board PAGE in a folder, its container, its rows
//                   (bookmark cards or plain items), optionally a filter
//   create_items  — many rows in one named container, field values BY NAME
//   add_filter    — a filter on a page/container, nothing set, nav showing
//
// Everything a model would get wrong is decided here, by name: folders,
// containers ("Tasks › Appointments"), fields, select options, and the row an
// occurrence field should point at. An occurrence-field value that names no
// existing option is ADDED the way the field's own "+ Add new" adds it (into
// its add-new container, tagged so the field's own query finds it).
//
// The pure helpers are exported and tested (__tests__/assistantBuildTools.test.js).
// ============================================================

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const splitPath = (s) => String(s ?? "").split(/\s*(?:›|>|\/)\s*/).map((p) => p.trim()).filter(Boolean);

// ── pure helpers ─────────────────────────────────────────────────────────

/** A folder by name or path ("Interfaces", "Root/Interfaces"). Null when none or ambiguous. */
export function findFolder(folders, name) {
  const parts = splitPath(name);
  if (!parts.length) return { error: "folder name is empty" };
  const byId = new Map(folders.map((f) => [f.id, f]));
  const last = norm(parts[parts.length - 1]);
  const cands = folders.filter((f) => norm(f.name) === last).filter((f) => {
    let cur = byId.get(f.parentId);
    for (let i = parts.length - 2; i >= 0; i--) {
      // Root may be named or not; a missing ancestor in the path is allowed only for "root".
      while (cur && norm(cur.name) !== norm(parts[i])) cur = byId.get(cur.parentId);
      if (!cur) return false;
      cur = byId.get(cur.parentId);
    }
    return true;
  });
  if (cands.length === 1) return { folder: cands[0] };
  if (!cands.length) return { error: `no folder named "${name}"`, choices: folders.map((f) => f.name).slice(0, 40) };
  return { error: `"${name}" matches ${cands.length} folders — give its path`, choices: cands.map((f) => f.id) };
}

/** A destination (container/page) by name or path from /destinations hits. */
export function pickDestination(hits, name) {
  const parts = splitPath(name);
  if (!parts.length) return { error: "container name is empty" };
  const last = norm(parts[parts.length - 1]);
  const ancestors = parts.slice(0, -1).map(norm);
  let cands = hits.filter((h) => norm(h.label) === last);
  if (ancestors.length) {
    cands = cands.filter((h) => {
      const crumb = splitPath(h.crumb).map(norm);
      let at = 0;
      for (const a of ancestors) { const i = crumb.indexOf(a, at); if (i < 0) return false; at = i + 1; }
      return true;
    });
  }
  // A container is where rows go; prefer one over a page of the same name.
  if (cands.length > 1) {
    const containers = cands.filter((h) => h.role === "container");
    if (containers.length === 1) cands = containers;
  }
  if (cands.length === 1) return { destination: cands[0] };
  if (!cands.length) return { error: `no container named "${name}"` };
  return {
    error: `"${name}" matches ${cands.length} places — use the path, e.g. "${cands[0].crumb ? `${cands[0].crumb} › ` : ""}${cands[0].label}"`,
    choices: cands.map((h) => (h.crumb ? `${h.crumb} › ${h.label}` : h.label)),
  };
}

/** A field by exact (case-insensitive) name. */
export function findFieldByName(fields, name) {
  const hits = fields.filter((f) => norm(f.name) === norm(name));
  if (hits.length === 1) return { field: hits[0] };
  if (!hits.length) return { error: `no field named "${name}"` };
  return { error: `${hits.length} fields are named "${name}"` };
}

/** The manual options of a select field, as {value,label}. */
export function manualOptions(field) {
  const src = field?.meta?.optionsSource;
  if (!src || src.mode !== "manual") return null;
  return (src.values || []).map((v) => (typeof v === "string" ? { value: v, label: v } : v));
}

/** meta for a new select field from a plain list of option names. */
export function selectMetaFor(options, { multiSelect = false } = {}) {
  const values = [...new Set((options || []).map((o) => String(o).trim()).filter(Boolean))]
    .map((v) => ({ value: v, label: v }));
  return { optionsSource: { mode: "manual", values }, multiSelect: !!multiSelect, allowNewOptions: true };
}

/** "4h", "4 hours", "90m", "1h 30m", 240 → minutes. */
export function parseDuration(raw) {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/); const m = s.match(/(\d+)\s*m/);
  if (!h && !m) return null;
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
}

/** Any date the model writes → "YYYY-MM-DD" (a day, read as written — no timezone shift). */
export function parseDay(raw) {
  const s = String(raw ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A raw value the model gave for a NON-occurrence field → the stored value.
 * Occurrence fields are resolved by the caller (they need a lookup).
 */
export function coerceValue(field, raw) {
  const t = field.type;
  if (t === "number" || t === "rating") {
    const n = Number(raw); return Number.isFinite(n) ? { value: n } : { error: `${field.name}: "${raw}" is not a number` };
  }
  if (t === "duration") {
    const n = parseDuration(raw); return n == null ? { error: `${field.name}: "${raw}" is not a duration` } : { value: n };
  }
  if (t === "date") {
    const d = parseDay(raw); return d ? { value: d } : { error: `${field.name}: "${raw}" is not a date` };
  }
  if (t === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    const s = norm(raw); if (["true", "yes", "1", "on"].includes(s)) return { value: true };
    if (["false", "no", "0", "off", ""].includes(s)) return { value: false };
    return { error: `${field.name}: "${raw}" is not yes/no` };
  }
  if (t === "select") {
    const list = Array.isArray(raw) ? raw : [raw];
    const opts = manualOptions(field);
    const out = [];
    for (const r of list) {
      if (!opts) { out.push(String(r)); continue; }
      const hit = opts.find((o) => norm(o.value) === norm(r) || norm(o.label) === norm(r));
      if (!hit) return { error: `${field.name}: "${r}" is not one of its options`, choices: opts.map((o) => o.label) };
      out.push(hit.value);
    }
    return { value: field.meta?.multiSelect ? out : out[0] };
  }
  return { value: raw };
}

/** The literal tag values a field's option query requires (`fields.X.value CONTAINS/IS literal`). */
export function predicateTags(field) {
  const src = field?.meta?.optionsSource || {};
  const pred = src.predicate || src.find?.predicate || {};
  const out = [];
  for (const r of pred.rules || []) {
    const m = String(r?.left || "").match(/^fields\.([^.]+)\.value$/);
    if (!m || !["CONTAINS", "IS"].includes(r.comparator)) continue;
    if (r.right == null || r.right === "" || String(r.right).startsWith("$")) continue;
    out.push({ fieldId: m[1], value: r.right });
  }
  return out;
}

/** Where a field's "+ Add new" puts new option rows. */
export function addNewParentOf(field) {
  const src = field?.meta?.optionsSource || {};
  return src.addNew?.parentOccurrenceId || src.find?.addNew?.parentOccurrenceId || null;
}

/** A filter entry with nothing set and the nav showing — the shape the Filter menu writes. */
export function filterEntryFor(field, id) {
  const entry = {
    id, fieldId: field.id, active: true, showNav: true, hides: false,
    condition: {
      operator: "OR",
      rules: [
        { left: "$field.value", comparator: field.type === "date" ? "DATE_EQUALS" : "CONTAINS", right: "$nav" },
        { left: "$field.value", comparator: "IS_EMPTY" },
      ],
    },
  };
  if (field.type === "date") entry.timeUnit = "day";
  const opts = manualOptions(field);
  if (opts) { entry.style = "select"; entry.options = opts.map((o) => o.value); }
  return entry;
}

/** Bindings for a new row: the siblings' own, plus (visible) any field being set that they lack. */
export function bindingsFor(siblingBindings, setFieldIds) {
  const base = (siblingBindings || []).map(({ _id, ...b }) => ({ ...b }));
  const have = new Set(base.map((b) => b.fieldId));
  let order = base.reduce((m, b) => Math.max(m, b.order ?? 0), -1);
  for (const b of base) if (setFieldIds.includes(b.fieldId) && b.role !== "media" && b.role !== "files") b.hidden = false;
  for (const id of setFieldIds) if (!have.has(id)) base.push({ fieldId: id, order: ++order, hidden: false, role: "input" });
  return base;
}

const rid = () => Math.random().toString(36).slice(2, 12);

/** A list the model may send as JSON TEXT (llama3.2 3B does: rows: "[{...}]"). Anything else that is not a list -> []. */
export function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MAX_REPEAT = 366;

/** An object the model may send as JSON TEXT, like asList. */
const asObject = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } }
  return null;
};

/**
 * Items carrying `repeat: { from, to, weekdays?, except?, dateField? }` -> one item per matching
 * day, its date written into `dateField` (default "Date"). The SERVER lists the dates: asked for
 * "Mon-Thu in November", llama3.2 3B wrote 13 of the 17 and skipped a whole week, silently.
 * Calendar-day arithmetic in UTC on YYYY-MM-DD, so no timezone shift.
 */
export function expandRepeats(itemsIn) {
  const items = [];
  for (const it of itemsIn || []) {
    if (it?.repeat == null) { items.push(it); continue; }
    const rep = asObject(it.repeat);
    if (!rep) return { error: `${it.label}: repeat must be {from, to, weekdays}` };
    const from = parseDay(rep.from); const to = parseDay(rep.to);
    if (!from || !to) return { error: `${it.label}: repeat needs from and to dates (YYYY-MM-DD)` };
    if (to < from) return { error: `${it.label}: repeat "from" ${from} must be before "to" ${to}` };
    const wd = typeof rep.weekdays === "string" && !rep.weekdays.trim().startsWith("[")
      ? rep.weekdays.split(/[,\s]+/).filter(Boolean)
      : asList(rep.weekdays);
    let days = null;
    if (wd.length) {
      days = new Set();
      for (const w of wd) {
        const i = WEEKDAYS.indexOf(String(w).trim().toLowerCase().slice(0, 3));
        if (i < 0) return { error: `${it.label}: "${w}" is not a weekday` };
        days.add(i);
      }
    }
    const except = new Set(asList(rep.except).map(parseDay).filter(Boolean));
    const dateField = rep.dateField || "Date";
    const { repeat: _r, ...base } = it;
    const start = Date.parse(`${from}T00:00:00Z`); const end = Date.parse(`${to}T00:00:00Z`);
    if ((end - start) / 86400000 + 1 > MAX_REPEAT) return { error: `${it.label}: repeat covers too many days (max ${MAX_REPEAT})` };
    for (let t = start; t <= end; t += 86400000) {
      const d = new Date(t);
      const day = d.toISOString().slice(0, 10);
      if (days && !days.has(d.getUTCDay())) continue;
      if (except.has(day)) continue;
      items.push({ ...base, fields: { ...(base.fields || {}), [dateField]: day } });
    }
  }
  return { items };
}

// ── the pack ────────────────────────────────────────────────────────────

export function buildToolPack({ call, gridId }) {
  const ok = (r) => r.status < 400;
  const fail = (r, what) => ({ error: `${what}: ${r.body?.message || r.body?.error || r.status}` });

  let fieldCache = null;
  const loadFields = async () => {
    if (fieldCache) return fieldCache;
    const r = await call("GET", `/fields?gridId=${encodeURIComponent(gridId)}&limit=500`);
    fieldCache = r.body?.fields || [];
    return fieldCache;
  };

  const moduleLabels = async (ids) => {
    const out = new Map();
    for (const id of [...new Set(ids)].filter(Boolean)) {
      const r = await call("GET", `/modules/${encodeURIComponent(id)}`);
      if (ok(r)) out.set(id, r.body?.module || r.body);
    }
    return out;
  };

  // An occurrence-field value by NAME → the option row's id; adds the option when missing.
  const resolveOccurrenceValue = async (field, raw, created) => {
    const list = Array.isArray(raw) ? raw : [raw];
    const parent = addNewParentOf(field);
    if (!parent) return { error: `${field.name}: can't look its options up by name — pass the option's id` };
    const kids = (await call("GET", `/occurrences?gridId=${encodeURIComponent(gridId)}&parentId=${encodeURIComponent(parent)}&limit=500`)).body?.occurrences || [];
    const mods = await moduleLabels(kids.map((k) => k.moduleId));
    const ids = [];
    for (const name of list) {
      if (kids.some((k) => k.id === name)) { ids.push(name); continue; }
      const hit = kids.filter((k) => norm(k.label || mods.get(k.moduleId)?.label) === norm(name) && !k.meta?.feedSourceId);
      if (hit.length >= 1) { ids.push(hit[0].id); continue; }
      // Not there: add it the way "+ Add new" does.
      const sib = kids.find((k) => !k.meta?.feedSourceId);
      const sibMod = sib ? mods.get(sib.moduleId) : null;
      const tags = predicateTags(field);
      const fields = {};
      const all = await loadFields();
      for (const t of tags) {
        const tf = all.find((f) => f.id === t.fieldId);
        fields[t.fieldId] = { value: tf?.meta?.multiSelect ? [t.value] : t.value, flow: "in" };
      }
      const mr = await call("POST", `/modules`, {
        gridId, role: "instance", label: String(name),
        fieldBindings: sibMod?.fieldBindings ? bindingsFor(sibMod.fieldBindings, []) : tags.map((t, i) => ({ fieldId: t.fieldId, order: i, hidden: true, role: "input" })),
      });
      if (!ok(mr)) return fail(mr, `adding "${name}" to ${field.name}`);
      const or = await call("POST", `/occurrences`, { gridId, moduleId: mr.body.module.id, parentId: parent, fields });
      if (!ok(or)) return fail(or, `adding "${name}" to ${field.name}`);
      kids.push({ ...or.body.occurrence, label: String(name) });
      created.push(`${field.name} option "${name}"`);
      ids.push(or.body.occurrence.id);
    }
    return { value: field.meta?.multiSelect ? ids : ids[0] };
  };

  // { "Field Name": value } → { fieldId: {value, flow} }
  const fieldValues = async (byName, created) => {
    const all = await loadFields();
    const out = {};
    for (const [name, raw] of Object.entries(byName || {})) {
      if (raw == null || raw === "") continue;
      const f = findFieldByName(all, name);
      if (f.error) return { error: f.error };
      const v = f.field.type === "occurrence"
        ? await resolveOccurrenceValue(f.field, raw, created)
        : coerceValue(f.field, raw);
      if (v.error) return v;
      out[f.field.id] = { value: v.value, flow: "in" };
    }
    return { fields: out };
  };

  const resolveContainer = async (name) => {
    if (!name) return { error: "say which container" };
    if (/^[\w-]{8,}$/.test(name) && !/\s/.test(name)) {
      const r = await call("GET", `/occurrences/${encodeURIComponent(name)}`);
      if (ok(r)) return { destination: { id: name } };
    }
    const last = splitPath(name).pop();
    const r = await call("GET", `/destinations?gridId=${encodeURIComponent(gridId)}&q=${encodeURIComponent(last)}&limit=100`);
    if (!ok(r)) return fail(r, "looking up the container");
    return pickDestination(r.body?.destinations || [], name);
  };

  const ensureField = async ({ name, type = "select", options, multiSelect }, created) => {
    const all = await loadFields();
    const found = findFieldByName(all, name);
    if (found.field) {
      // Add any option the field lacks (a manual select only).
      const opts = manualOptions(found.field);
      if (opts && options?.length) {
        const missing = options.filter((o) => !opts.some((x) => norm(x.value) === norm(o)));
        if (missing.length) {
          const meta = { ...found.field.meta, optionsSource: { mode: "manual", values: [...opts, ...missing.map((v) => ({ value: v, label: v }))] } };
          const r = await call("PATCH", `/fields/${found.field.id}`, { meta });
          if (!ok(r)) return fail(r, `adding options to ${name}`);
          Object.assign(found.field, r.body?.field || { meta });
        }
      }
      return { field: found.field };
    }
    const body = { gridId, name, type };
    if (type === "select") body.meta = selectMetaFor(options || [], { multiSelect });
    const r = await call("POST", `/fields`, body);
    if (!ok(r)) return fail(r, `creating field ${name}`);
    all.push(r.body.field);
    created.push(`field "${name}"`);
    return { field: r.body.field };
  };

  const addFilter = async (occId, field) => {
    const r = await call("GET", `/occurrences/${encodeURIComponent(occId)}`);
    if (!ok(r)) return fail(r, "reading the target");
    const occ = r.body?.occurrence || r.body;
    const filters = Array.isArray(occ.filters) ? occ.filters : [];
    if (filters.some((f) => f.fieldId === field.id)) return { ok: true, already: true };
    const p = await call("PATCH", `/occurrences/${encodeURIComponent(occId)}`, { filters: [...filters, filterEntryFor(field, rid())] });
    return ok(p) ? { ok: true } : fail(p, "adding the filter");
  };

  return [
    {
      name: "create_board",
      description: "Make a whole BOARD in one step: a board page in a folder, its container, and its rows. Rows are bookmark cards (give `url`) or plain items (give only `label`). `fields` on a row sets field values BY NAME, e.g. {\"Quick Link Type\": \"social\"}. `selectFields` creates select fields first (with their options). `filterField` adds a filter for that field on the page, nothing set, nav showing. Put EVERY link/item the user listed in `rows`, each with its name as `label` — do not shorten the list. Use for 'make a board of …'.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Board name" },
          folder: { type: "string", description: "Folder name or path, e.g. Interfaces" },
          selectFields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, options: { type: "array", items: { type: "string" } }, multiSelect: { type: "boolean" } }, required: ["name", "options"] } },
          rows: { type: "array", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" }, fields: { type: "object", additionalProperties: true } }, required: ["label"] } },
          filterField: { type: "string", description: "Field name to add a filter for (nav showing)" },
        },
        required: ["name", "folder"],
      },
      destructive: false,
      requires_confirm: true,
      run: async ({ name, folder, selectFields: sfIn, rows: rowsIn, filterField }) => {
        const created = [];
        const selectFields = asList(sfIn); const rows = asList(rowsIn);
        const fr = await call("GET", `/folders?gridId=${encodeURIComponent(gridId)}`);
        const fo = findFolder(fr.body?.folders || [], folder);
        if (fo.error) return fo;
        for (const sf of selectFields) { const r = await ensureField({ ...sf, type: "select" }, created); if (r.error) return r; }

        const pm = await call("POST", `/modules`, { gridId, role: "page", kind: "board", label: name });
        if (!ok(pm)) return fail(pm, "creating the page");
        const po = await call("POST", `/occurrences`, { gridId, moduleId: pm.body.module.id, parentId: fo.folder.id });
        if (!ok(po)) return fail(po, "placing the page");
        const pageId = po.body.occurrence.id;
        const cm = await call("POST", `/modules`, { gridId, role: "container", kind: "board", label: name });
        if (!ok(cm)) return fail(cm, "creating the container");
        const co = await call("POST", `/occurrences`, { gridId, moduleId: cm.body.module.id, parentId: pageId });
        if (!ok(co)) return fail(co, "placing the container");
        const containerId = co.body.occurrence.id;

        const made = []; const problems = [];
        for (const row of rows) {
          const fv = await fieldValues(row.fields, created);
          if (fv.error) { problems.push(`${row.label}: ${fv.error}`); continue; }
          const setIds = Object.keys(fv.fields);
          if (row.url) {
            const br = await call("POST", `/bookmarks`, { gridId, url: row.url, parentId: containerId, label: row.label });
            if (!ok(br)) { problems.push(`${row.label}: ${br.body?.message || br.status}`); continue; }
            const occ = br.body.occurrence;
            if (setIds.length) {
              const mr = await call("GET", `/modules/${encodeURIComponent(occ.moduleId)}`);
              const mod = mr.body?.module || mr.body;
              await call("PATCH", `/modules/${encodeURIComponent(occ.moduleId)}`, { fieldBindings: bindingsFor(mod?.fieldBindings, setIds) });
              await call("PATCH", `/occurrences/${encodeURIComponent(occ.id)}/fields`, { fields: fv.fields });
            }
            made.push(row.label);
          } else {
            const mr = await call("POST", `/modules`, { gridId, role: "instance", label: row.label, fieldBindings: bindingsFor([], setIds) });
            if (!ok(mr)) { problems.push(`${row.label}: ${mr.body?.message || mr.status}`); continue; }
            const or = await call("POST", `/occurrences`, { gridId, moduleId: mr.body.module.id, parentId: containerId, fields: fv.fields });
            if (!ok(or)) { problems.push(`${row.label}: ${or.body?.message || or.status}`); continue; }
            made.push(row.label);
          }
        }
        let filter = null;
        if (filterField) {
          const f = findFieldByName(await loadFields(), filterField);
          filter = f.error ? f : await addFilter(pageId, f.field);
        }
        return { ok: problems.length === 0, pageId, containerId, folder: fo.folder.name, rows: made.length, created, problems, filter };
      },
    },
    {
      name: "create_items",
      description: "Add MANY rows to one container in a single step. `container` is its name or path, e.g. \"Tasks › Appointments\". Each item has a `label` and `fields` BY FIELD NAME, e.g. {\"Date\": \"2026-11-02\", \"Time Slot\": \"4:00pm\", \"Duration\": \"4h\", \"Schedule Type\": \"Class\"}. Something that REPEATS on many dates: do NOT list the dates — send ONE item with `repeat`: {\"from\": \"2026-11-01\", \"to\": \"2026-11-30\", \"weekdays\": [\"Mon\",\"Tue\",\"Wed\",\"Thu\"]} and one row is made per matching day (date in the Date field; `except` lists days to skip). A dropdown value that does not exist yet is added to the dropdown. Include EVERY item the user listed. Rows with the same label share one template.",
      input_schema: {
        type: "object",
        properties: {
          container: { type: "string" },
          items: { type: "array", items: { type: "object", properties: {
            label: { type: "string" },
            fields: { type: "object", additionalProperties: true },
            repeat: { type: "object", properties: {
              from: { type: "string" }, to: { type: "string" },
              weekdays: { type: "array", items: { type: "string" } },
              except: { type: "array", items: { type: "string" } },
              dateField: { type: "string" },
            } },
          }, required: ["label"] } },
        },
        required: ["container", "items"],
      },
      destructive: false,
      requires_confirm: true,
      run: async ({ container, items: itemsIn }) => {
        const created = [];
        const expanded = expandRepeats(asList(itemsIn));
        if (expanded.error) return { error: expanded.error };
        const items = expanded.items;
        const d = await resolveContainer(container);
        if (d.error) return d;
        const parentId = d.destination.id;
        // The siblings' bindings (an appointment row already binds Date, Time Slot, …).
        const sib = (await call("GET", `/occurrences?gridId=${encodeURIComponent(gridId)}&parentId=${encodeURIComponent(parentId)}&limit=1`)).body?.occurrences?.[0];
        let sibBindings = [];
        if (sib) { const m = await call("GET", `/modules/${encodeURIComponent(sib.moduleId)}`); sibBindings = (m.body?.module || m.body)?.fieldBindings || []; }
        const moduleByLabel = new Map();
        const made = []; const problems = []; const dates = [];
        for (const it of items) {
          const fv = await fieldValues(it.fields, created);
          if (fv.error) { problems.push(`${it.label}: ${fv.error}`); continue; }
          let moduleId = moduleByLabel.get(norm(it.label));
          if (!moduleId) {
            const mr = await call("POST", `/modules`, { gridId, role: "instance", label: it.label, fieldBindings: bindingsFor(sibBindings, Object.keys(fv.fields)) });
            if (!ok(mr)) { problems.push(`${it.label}: ${mr.body?.message || mr.status}`); continue; }
            moduleId = mr.body.module.id; moduleByLabel.set(norm(it.label), moduleId);
          }
          const or = await call("POST", `/occurrences`, { gridId, moduleId, parentId, fields: fv.fields });
          if (!ok(or)) { problems.push(`${it.label}: ${or.body?.message || or.status}`); continue; }
          made.push(or.body.occurrence.id);
          const day = Object.values(it.fields || {}).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
          if (day) dates.push(day);
        }
        // `dates` = what was actually made, so the reply can name them and a gap is visible.
        return { ok: problems.length === 0, container: d.destination.label || container, created: made.length, dates, alsoAdded: created, problems };
      },
    },
    {
      name: "add_filter",
      description: "Add a filter for a field on a page or container (by name or path) — nothing selected, the nav picker showing in its header.",
      input_schema: { type: "object", properties: { target: { type: "string" }, field: { type: "string" } }, required: ["target", "field"] },
      destructive: false,
      requires_confirm: true,
      run: async ({ target, field }) => {
        const d = await resolveContainer(target);
        if (d.error) return d;
        const f = findFieldByName(await loadFields(), field);
        if (f.error) return f;
        return addFilter(d.destination.id, f.field);
      },
    },
  ];
}
