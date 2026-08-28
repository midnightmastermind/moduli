/**
 * 0275 — two real projects on the Project template, and the trello board gets work in it.
 *
 * User, 2026-08-28: *"set up a plan to use the Project template and make a
 * project for Pauls Clown Website and Via Fluere. make sure to include the ops
 * and adding the tasks to schedule (set up starter tasks). we have a trello
 * board in the template"* → *"they should go in a Projects folder"* → *"in root"*.
 *
 * `0274` made the three project ops able to fire. This puts real work in front
 * of them. Three decisions here were the USER'S, asked before anything was
 * written, because each produces materially different data:
 *
 *   Via Fluere        → RENAME the existing `Moduli v1 Launch` project rather
 *                       than minting a second overlapping one.
 *   the Todo mirror   → ONE CONTAINER PER PROJECT on the Tasks page.
 *   Work on Paul's website → COPY-LINK it into the kanban (not move, not leave).
 *
 * ── THE RENAME IS SAFE, AND IT IS SAFE BECAUSE IT WAS MEASURED ──────────────
 *     "Project: Moduli v1 Launch"  6 kanban columns, ALL EMPTY (0 children each)
 * There is nothing in it to lose. Had a single column held a task this would
 * have been a mint-and-migrate instead. The labels live on the MODULES
 * (`occurrence.label` is null on both the page and the board row), so the
 * rename is two module labels plus the scope textmap — not an occurrence write.
 *
 * ── THE BOARD ROW IS MINTED THE WAY ITS FOUR SIBLINGS ALREADY EXIST ─────────
 * The `Projects` board is a FEED (`Board Category CONTAINS "project"`), and this
 * file's standing rule is not to push into a feed's `occurrences[]`. That rule
 * is about feed COPIES. Measured, the four live project rows are NOT copies:
 *     Moduli v1 Launch · Portfolio Site · Home Lab · Garden Build
 *     every one:  parentId = the board,  listed in the board,  feedSourceId absent
 * So parented-and-listed IS the healthy shape here, demonstrated four times over,
 * and a new row copies it. The `Board Category: ["project"]` tag is what makes it
 * an option in the `Project` dropdown — that is a value, not a placement.
 *
 * ── STARTER TASKS BIND `Status`, WHICH IS THE ENTIRE POINT ──────────────────
 *     modules binding Status, before this migration:  0
 * Both routing ops trigger on `onChange · Status`, so until a task can carry it
 * the kanban is six containers you can drag between with nothing behind them.
 * Every task minted here binds it, plus `Project` (which is how `Sync To Todo
 * List` finds the task's own Tasks-page container), and the same
 * Completed / Completed On / Due / Days Until Due / Date / Time Slot set every
 * other task on this grid carries.
 *
 * **NO TASK IS STAMPED WITH A `Date` VALUE.** The grid filters on `Date`, and a
 * row carrying one is visible on exactly one day of the year — that is the
 * 1,467-invisible-bookmarks defect of 2026-08-23 (3), and a project board is
 * precisely where it would go unnoticed. The FIELD is bound (so a task dragged
 * onto the schedule behaves like every other task and `Stamp Date & Time Slot`
 * has somewhere to write); the VALUE is left absent.
 *
 * ── HOW A TASK REACHES THE SCHEDULE: A `Due` DATE, AND NOTHING NEW ──────────
 * `Schedule: Place Dated Work` phase 2 places a due-dated row into every day it
 * is still outstanding and sweeps it when it stops being due. So "adding the
 * tasks to schedule" is a `Due` value — no new mechanism, and none invented.
 * A few starter tasks carry one so the path is exercised rather than asserted.
 *
 * ── THE PER-PROJECT CONTAINER IS KEYED, NOT LABELLED ────────────────────────
 * `Sync To Todo List` finds a task's Tasks-page container by the container's own
 * `Project` VALUE. So each project container is stamped with its board row id.
 * That value is deliberately NOT BOUND on the container's module: it is a
 * routing key an operation reads out of stored data, the container's own label
 * already names the project, and 2026-08-11 (3) records a redundant pill in a
 * container header as a defect in its own right. Every sibling dimension
 * container on that page binds nothing either, so this stays consistent with
 * them. Reported in the run log so it is not a silent key.
 *
 * ── `Work on Paul's website` IS COPY-LINKED, WITH THE CONSEQUENCE STATED ────
 * The copy shares `moduleId` and a `linkedGroupId` of `lg-<sourceId>` — the same
 * derivation `COPY_LINK` uses, so a later COPY_LINK of the same source converges
 * on one group instead of forking. Binding `Status` therefore adds it to the
 * ORIGINAL too; that is correct, a linked pair is one thing in two places.
 * **The consequence, said plainly:** once its Status leaves Backburner/Docket,
 * `Sync To Todo List` DELETES the Tasks-page copy by design — the task is not
 * lost, it lives on in the kanban. It starts at `Docket`, which is consistent
 * with the mirror existing.
 *
 * Deletes nothing. Idempotent at every step: each mint is guarded by a lookup
 * for what it would create.
 */

export const id = "0275-two-real-projects";
export const describe = "Rename the Moduli v1 Launch project to Via Fluere, mint Paul's Clown Website, give both a Tasks-page container and starter tasks that bind Status. Deletes nothing.";
export const touches = ["occurrences", "modules"];

const TOKEN_NAME  = "{ProjectName}";
const TOKEN_SCOPE = "{ProjectScope}";

export const VIA_FLUERE_SCOPE =
  "Via Fluere is the workspace this grid runs on: a modular, event-driven surface where anything you do can be measured, and any measurement can be rolled up across any time window and any category. The work is making that true in daily use rather than in a demo — the schedule builds itself every morning, the trackers agree with the rows they read, and nothing needs a second system beside it.";

export const PAUL_SCOPE =
  "A website for Paul: somewhere to send people that shows the act, the photos and the dates, and lets someone book without an email thread. Small on purpose — a landing page, a gallery, an about page and a booking form — so it can ship and then grow.";

/**
 * Starter tasks. Placeholders by design — the user asked for starters, not for
 * their real backlog. `status` MUST equal the column label, or `Project: Status
 * Router` moves the row the first time anything touches it.
 * `dueInDays` is relative so a re-seeded grid is not born with stale dates.
 */
export const STARTERS = {
  "Paul's Clown Website": [
    { column: "Docket",      label: "Register the domain",            dueInDays: 3 },
    { column: "Docket",      label: "Pick a hosting plan" },
    { column: "Docket",      label: "Draft the About page copy" },
    { column: "Working On",  label: "Build the landing page",         dueInDays: 7 },
    { column: "Backburner",  label: "Add a photo gallery" },
    { column: "Backburner",  label: "Set up a booking form" },
  ],
  "Via Fluere": [
    { column: "Docket",      label: "Write the launch page copy",     dueInDays: 5 },
    { column: "Docket",      label: "Set up error monitoring" },
    { column: "Working On",  label: "Ship the project kanban",        dueInDays: 2 },
    { column: "Backburner",  label: "Public REST API at /api/v1" },
    { column: "Backburner",  label: "Assistant drawer in every workspace" },
  ],
};

/** Deep token replacement over a TipTap textmap. Returns a new object. */
export function replaceTokens(node, replacements) {
  if (Array.isArray(node)) return node.map(n => replaceTokens(n, replacements));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "text" && typeof v === "string") {
      out[k] = Object.entries(replacements).reduce((s, [t, r]) => s.split(t).join(r), v);
    } else out[k] = replaceTokens(v, replacements);
  }
  return out;
}

/** Resolve one field by NAME **and** type — this grid carries duplicate field names. */
export function resolveField(fields, name, type) {
  const hits = fields.filter(f => f.name === name && f.type === type);
  if (hits.length === 1) return hits[0].id;
  return null;
}

/** ISO yyyy-mm-dd, `days` from `from`. Local-midnight safe: built from parts. */
export function isoPlusDays(from, days) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const userId = grid?.userId;
  if (!userId) { log("  REFUSING: the grid names no userId"); return; }

  const { cloneSubtree } = await import("../utils/cloneSubtree.js");

  const [occs, mods, fields, folders] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
    models.Folder.find({ gridId }).lean(),
  ]);
  const modulesById   = Object.fromEntries(mods.map(m => [m.id, m]));
  const occById       = Object.fromEntries(occs.map(o => [o.id, o]));
  const nameOf        = o => o?.label ?? modulesById[o?.moduleId]?.label ?? null;

  // ── everything the migration needs, each refusing rather than guessing ────
  const F = {
    status:    resolveField(fields, "Status", "select"),
    project:   resolveField(fields, "Project", "occurrence"),
    completed: resolveField(fields, "Completed", "boolean"),
    completedOn: resolveField(fields, "Completed On", "date"),
    due:       resolveField(fields, "Due", "date"),
    daysUntil: resolveField(fields, "Days Until Due", "number"),
    date:      resolveField(fields, "Date", "date"),
    timeslot:  resolveField(fields, "Time Slot", "select"),
    boardCat:  resolveField(fields, "Board Category", "select"),
  };
  for (const [k, v] of Object.entries(F)) if (!v) { log(`  REFUSING: field "${k}" did not resolve uniquely by name AND type`); return; }

  const projectsFolder = folders.find(f => f.name === "Projects" && f.folderType !== "category" && f.parentId);
  if (!projectsFolder) { log("  REFUSING: no root 'Projects' folder"); return; }

  const template = occs.find(o => modulesById[o.moduleId]?.role === "page" && (nameOf(o) || "").includes(TOKEN_NAME));
  if (!template) { log(`  REFUSING: no page carries the ${TOKEN_NAME} token — the Project Page template is missing`); return; }

  const projectsBoard = occs.find(o => {
    const m = modulesById[o.moduleId];
    return m?.role === "container" && nameOf(o) === "Projects" && o.feed?.enabled;
  });
  if (!projectsBoard) { log("  REFUSING: no feed-backed 'Projects' board to hold the option rows"); return; }

  const tasksPage = occs.find(o => modulesById[o.moduleId]?.role === "page" && nameOf(o) === "Tasks");
  if (!tasksPage) { log("  REFUSING: no Tasks page"); return; }

  const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const today = new Date();
  const writes = [];   // { what, run: async () => void }
  const say = (s) => log(`      ${s}`);

  // Bindings every starter task carries, in render order. `Date`/`Time Slot`
  // are BOUND and never VALUED — see the header.
  const taskBindings = () => ([
    { fieldId: F.status,      order: 0, role: "input" },
    { fieldId: F.project,     order: 1, role: "input" },
    { fieldId: F.completed,   order: 2, role: "input" },
    { fieldId: F.due,         order: 3, role: "input" },
    { fieldId: F.completedOn, order: 4, role: "input", hidden: true },
    { fieldId: F.date,        order: 5, role: "input", hidden: true },
    { fieldId: F.timeslot,    order: 6, role: "input", hidden: true },
    { fieldId: F.daysUntil,   order: 7, role: "display" },
  ]);

  // ── STEP 1 — Via Fluere: rename, do not mint ─────────────────────────────
  const RENAME = { from: "Moduli v1 Launch", to: "Via Fluere" };
  let viaRowId = null, viaPageId = null;

  const existingViaRow  = occs.find(o => nameOf(o) === RENAME.to   && o.parentId === projectsBoard.id);
  const oldRow          = occs.find(o => nameOf(o) === RENAME.from && o.parentId === projectsBoard.id);
  const existingViaPage = occs.find(o => nameOf(o) === `Project: ${RENAME.to}`   && o.parentId === projectsFolder.id);
  const oldPage         = occs.find(o => nameOf(o) === `Project: ${RENAME.from}` && o.parentId === projectsFolder.id);

  if (existingViaRow && existingViaPage) {
    viaRowId = existingViaRow.id; viaPageId = existingViaPage.id;
    say(`Via Fluere already renamed — row ${viaRowId}, page ${viaPageId}`);
    if (existingViaPage.meta?.templateModule) {
      say(`  …but it still reads as a TEMPLATE — clearing the marker`);
      writes.push({ what: "clear stale template marker", run: async () => {
        await Occurrence.updateOne({ gridId, id: existingViaPage.id }, { $unset: { "meta.templateModule": "", "meta.templateName": "" } });
        await Module.updateOne({ gridId, id: existingViaPage.moduleId }, { $unset: { "meta.templateModule": "" } });
      }});
    }
  } else if (oldRow && oldPage) {
    // The guard that makes the rename a rename and not a data loss.
    const kanban = (oldPage.occurrences || []).map(i => occById[i]).find(o => nameOf(o) === "Kanban");
    const held = (kanban?.occurrences || []).reduce((n, c) => n + ((occById[c]?.occurrences || []).length), 0);
    if (held > 0) { log(`  REFUSING: "${RENAME.from}" holds ${held} kanban task(s) — a rename would relabel work that exists. Mint separately instead.`); return; }
    viaRowId = oldRow.id; viaPageId = oldPage.id;
    say(`RENAME "${RENAME.from}" → "${RENAME.to}" (page ${viaPageId}, row ${viaRowId}) — 6 columns, ${held} tasks`);
    const scope = (oldPage.occurrences || []).map(i => occById[i]).find(o => modulesById[o.moduleId]?.role === "textblock");
    // Its poster artifact is labelled after the project too — found through the
    // row's own media value, never by matching the old NAME, which would also
    // hit anything else that happens to be called that.
    const posterId = Object.entries(oldRow.fields || {})
      .map(([fid, v]) => ({ fid, v }))
      .filter(({ fid }) => (modulesById[oldRow.moduleId]?.fieldBindings || []).some(b => b.fieldId === fid && b.role === "media"))
      .map(({ v }) => v?.value).find(Boolean) || null;
    const poster = posterId ? occById[posterId] : null;
    if (poster) say(`  …and its poster artifact ${poster.id}`);

    writes.push({ what: "rename Via Fluere", run: async () => {
      await Module.updateOne({ gridId, id: oldRow.moduleId },  { $set: { label: RENAME.to } });
      await Module.updateOne({ gridId, id: oldPage.moduleId }, { $set: { label: `Project: ${RENAME.to}` } });
      if (poster) await Module.updateOne({ gridId, id: poster.moduleId }, { $set: { label: RENAME.to } });
      // A LIVE project is not a template. This page was cloned from one and
      // kept the marker; `gridIntegrity` identifies template roots by exactly
      // this key, so leaving it makes a real project read as a template root.
      await Occurrence.updateOne({ gridId, id: oldPage.id }, { $unset: { "meta.templateModule": "", "meta.templateName": "" } });
      await Module.updateOne({ gridId, id: oldPage.moduleId }, { $unset: { "meta.templateModule": "" } });
      if (scope) {
        // Rebuild the scope body from the TEMPLATE, so the renamed project's
        // scope is the template's skeleton with this project's text — not the
        // demo paragraph with a find-and-replace over it.
        const tScope = (template.occurrences || []).map(i => occById[i]).find(o => modulesById[o.moduleId]?.role === "textblock");
        if (tScope?.textmap) {
          await Occurrence.updateOne({ gridId, id: scope.id }, { $set: {
            textmap: replaceTokens(tScope.textmap, { [TOKEN_NAME]: RENAME.to, [TOKEN_SCOPE]: VIA_FLUERE_SCOPE }),
          }});
        }
      }
    }});
  } else {
    log(`  REFUSING: neither "${RENAME.from}" nor "${RENAME.to}" resolves to BOTH a board row and a project page — nothing safe to rename`);
    return;
  }

  // ── STEP 2 — Paul's Clown Website: board row + project page ──────────────
  const PAUL = "Paul's Clown Website";
  let paulRowId = occs.find(o => nameOf(o) === PAUL && o.parentId === projectsBoard.id)?.id ?? null;
  let paulPageId = occs.find(o => nameOf(o) === `Project: ${PAUL}` && o.parentId === projectsFolder.id)?.id ?? null;

  if (paulRowId) say(`board row "${PAUL}" already exists (${paulRowId})`);
  else {
    const modId = uid(), occId = uid();
    paulRowId = occId;
    // Copies the shape of its four live siblings exactly: same role, the same
    // hidden Board Category binding, parented to and listed by the board.
    const sibling = modulesById[(occs.find(o => o.parentId === projectsBoard.id && o.fields?.[F.boardCat]) || {}).moduleId];
    say(`MINT board row "${PAUL}" (${occId}) tagged Board Category: ["project"]`);
    writes.push({ what: `board row ${PAUL}`, run: async () => {
      await Module.create({
        id: modId, userId, gridId, role: "instance", label: PAUL,
        fieldBindings: (sibling?.fieldBindings || []).map(b => ({ fieldId: b.fieldId, order: b.order, hidden: b.hidden, role: b.role })),
      });
      await Occurrence.create({
        id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
        parentId: projectsBoard.id, sortOrder: (occs.filter(o => o.parentId === projectsBoard.id).length),
        fields: { [F.boardCat]: { value: ["project"], flow: "in" } }, meta: {},
      });
      await Occurrence.updateOne({ gridId, id: projectsBoard.id }, { $addToSet: { occurrences: occId } });
    }});
  }

  if (paulPageId) say(`project page "Project: ${PAUL}" already exists (${paulPageId})`);
  else {
    say(`CLONE the template → "Project: ${PAUL}" under ${projectsFolder.id}`);
    writes.push({ what: `project page ${PAUL}`, run: async () => {
      const uc = { occurrencesById: { ...occById }, modulesById: { ...modulesById } };
      const { rootClonedOccurrenceId, occurrenceIds } = await cloneSubtree({
        rootOccurrenceId: template.id, userId, gridId, uc,
        newParentId: projectsFolder.id,
        rootLabel: `Project: ${PAUL}`,
        occMetaPatch: { appliedFromTemplateId: template.id, createdByOperation: false },
      });
      paulPageId = rootClonedOccurrenceId;
      // The clone carries the template's tokens verbatim; swap them in every
      // textmap it produced. cloneSubtree does not do replacements — that is
      // APPLY_TEMPLATE's job on the client, and this is its server twin.
      for (const oid of occurrenceIds) {
        const src = uc.occurrencesById[oid];
        if (!src?.textmap) continue;
        await Occurrence.updateOne({ gridId, id: oid }, { $set: {
          textmap: replaceTokens(src.textmap, { [TOKEN_NAME]: PAUL, [TOKEN_SCOPE]: PAUL_SCOPE }),
        }});
      }
      // The template root is a TEMPLATE; its clone must not read as one, or
      // the next migration looking for "the template" finds two.
      await Occurrence.updateOne({ gridId, id: rootClonedOccurrenceId }, { $unset: { "meta.templateModule": "", "meta.templateName": "" } });
      await Module.updateOne({ gridId, id: uc.occurrencesById[rootClonedOccurrenceId].moduleId }, { $unset: { "meta.templateModule": "" } });
    }});
  }

  // ── STEP 3 — one Tasks-page container per project, keyed by Project ──────
  const projectContainers = [
    { name: PAUL,       label: "Paul's Website", rowGetter: () => paulRowId },
    { name: RENAME.to,  label: RENAME.to,        rowGetter: () => viaRowId  },
  ];
  for (const pc of projectContainers) {
    const existing = (tasksPage.occurrences || []).map(i => occById[i]).find(o => o && nameOf(o) === pc.label);
    if (existing) {
      const cur = existing.fields?.[F.project]?.value ?? null;
      say(`Tasks container "${pc.label}" exists (${existing.id}) — Project key ${cur ? `already ${cur}` : "MISSING, stamping"}`);
      if (!cur) writes.push({ what: `key ${pc.label}`, run: async () => {
        await Occurrence.updateOne({ gridId, id: existing.id }, { $set: { [`fields.${F.project}`]: { value: pc.rowGetter(), flow: "in" } } });
      }});
      pc.containerId = existing.id;
    } else {
      const modId = uid(), occId = uid();
      pc.containerId = occId;
      say(`MINT Tasks container "${pc.label}" (${occId})`);
      writes.push({ what: `Tasks container ${pc.label}`, run: async () => {
        await Module.create({ id: modId, userId, gridId, role: "container", kind: "board", label: pc.label });
        await Occurrence.create({
          id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
          parentId: tasksPage.id, sortOrder: (tasksPage.occurrences || []).length,
          fields: { [F.project]: { value: pc.rowGetter(), flow: "in" } }, meta: {},
        });
        await Occurrence.updateOne({ gridId, id: tasksPage.id }, { $addToSet: { occurrences: occId } });
      }});
    }
  }

  // ── STEP 4 — starter tasks in the kanban columns ─────────────────────────
  const pageFor = { [PAUL]: () => paulPageId, [RENAME.to]: () => viaPageId };
  const rowFor  = { [PAUL]: () => paulRowId,  [RENAME.to]: () => viaRowId  };
  let plannedTasks = 0;
  for (const [projectName, starters] of Object.entries(STARTERS)) {
    for (const st of starters) {
      plannedTasks++;
      writes.push({ what: `task ${projectName}/${st.label}`, run: async () => {
        const page = await Occurrence.findOne({ gridId, id: pageFor[projectName]() }).lean();
        const kids = await Occurrence.find({ gridId, id: { $in: page?.occurrences || [] } }).lean();
        const kmods = await Module.find({ gridId, id: { $in: kids.map(k => k.moduleId) } }).lean();
        const kById = Object.fromEntries(kmods.map(m => [m.id, m]));
        const kanban = kids.find(k => (k.label ?? kById[k.moduleId]?.label) === "Kanban");
        if (!kanban) throw new Error(`no Kanban under "${projectName}"`);
        const cols = await Occurrence.find({ gridId, id: { $in: kanban.occurrences || [] } }).lean();
        const cmods = await Module.find({ gridId, id: { $in: cols.map(c => c.moduleId) } }).lean();
        const cById = Object.fromEntries(cmods.map(m => [m.id, m]));
        const col = cols.find(c => (c.label ?? cById[c.moduleId]?.label) === st.column);
        if (!col) throw new Error(`no "${st.column}" column under "${projectName}"`);

        // Idempotent: a task with this label already in this column is skipped.
        const siblings = await Occurrence.find({ gridId, id: { $in: col.occurrences || [] } }).lean();
        const smods = await Module.find({ gridId, id: { $in: siblings.map(s => s.moduleId) } }).lean();
        const sById = Object.fromEntries(smods.map(m => [m.id, m]));
        if (siblings.some(s => (s.label ?? sById[s.moduleId]?.label) === st.label)) return;

        const modId = uid(), occId = uid();
        await Module.create({ id: modId, userId, gridId, role: "instance", label: st.label, fieldBindings: taskBindings() });
        const f = {
          [F.status]:  { value: st.column, flow: "in" },
          [F.project]: { value: rowFor[projectName](), flow: "in" },
        };
        if (st.dueInDays != null) f[F.due] = { value: isoPlusDays(today, st.dueInDays), flow: "in" };
        await Occurrence.create({
          id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
          parentId: col.id, sortOrder: (col.occurrences || []).length, fields: f, meta: {},
        });
        await Occurrence.updateOne({ gridId, id: col.id }, { $addToSet: { occurrences: occId } });
      }});
    }
  }
  say(`${plannedTasks} starter task(s) planned across both kanbans`);

  // ── STEP 5 — copy-link the existing Paul task into the kanban ────────────
  const paulTask = occs.find(o => nameOf(o) === "Work on Paul's website");
  if (!paulTask) say(`"Work on Paul's website" not found — nothing to copy-link`);
  else {
    const lgId = paulTask.linkedGroupId || `lg-${paulTask.id}`;
    const already = occs.some(o => o.id !== paulTask.id && o.linkedGroupId && o.linkedGroupId === lgId);
    if (already) say(`"Work on Paul's website" already copy-linked (${lgId})`);
    else {
      say(`COPY-LINK "Work on Paul's website" into Paul's Docket (group ${lgId}) and bind Status on the shared module`);
      writes.push({ what: "copy-link Paul task", run: async () => {
        const page = await Occurrence.findOne({ gridId, id: paulPageId }).lean();
        const kids = await Occurrence.find({ gridId, id: { $in: page?.occurrences || [] } }).lean();
        const kmods = await Module.find({ gridId, id: { $in: kids.map(k => k.moduleId) } }).lean();
        const kById = Object.fromEntries(kmods.map(m => [m.id, m]));
        const kanban = kids.find(k => (k.label ?? kById[k.moduleId]?.label) === "Kanban");
        const cols = await Occurrence.find({ gridId, id: { $in: kanban?.occurrences || [] } }).lean();
        const cmods = await Module.find({ gridId, id: { $in: cols.map(c => c.moduleId) } }).lean();
        const cById = Object.fromEntries(cmods.map(m => [m.id, m]));
        const docket = cols.find(c => (c.label ?? cById[c.moduleId]?.label) === "Docket");
        if (!docket) throw new Error("no Docket column under Paul's project");

        // The shared module gains Status + Project. Both halves of a linked
        // pair are one thing in two places, so the original gains them too.
        const srcMod = await Module.findOne({ gridId, id: paulTask.moduleId }).lean();
        const have = new Set((srcMod?.fieldBindings || []).map(b => b.fieldId));
        const add = [];
        if (!have.has(F.status))  add.push({ fieldId: F.status,  order: -2, role: "input" });
        if (!have.has(F.project)) add.push({ fieldId: F.project, order: -1, role: "input" });
        if (add.length) await Module.updateOne({ gridId, id: paulTask.moduleId }, { $push: { fieldBindings: { $each: add } } });

        const copyId = uid();
        await Occurrence.create({
          id: copyId, userId, gridId, moduleId: paulTask.moduleId, targetId: paulTask.moduleId, targetType: "module",
          parentId: docket.id, sortOrder: (docket.occurrences || []).length,
          linkedGroupId: lgId,
          fields: {
            ...(paulTask.fields || {}),
            [F.status]:  { value: "Docket", flow: "in" },
            [F.project]: { value: paulRowId, flow: "in" },
          },
          meta: {},
        });
        await Occurrence.updateOne({ gridId, id: docket.id }, { $addToSet: { occurrences: copyId } });
        // The SOURCE joins the group and takes the same routing values, so the
        // pair is consistent the moment it exists rather than on first write.
        await Occurrence.updateOne({ gridId, id: paulTask.id }, { $set: {
          linkedGroupId: lgId,
          [`fields.${F.status}`]:  { value: "Docket", flow: "in" },
          [`fields.${F.project}`]: { value: paulRowId, flow: "in" },
        }});
      }});
    }
  }

  log(`  ${writes.length} write group(s) planned`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const w of writes) await w.run();
  log(`  done — ${writes.length} write group(s) applied`);
}
