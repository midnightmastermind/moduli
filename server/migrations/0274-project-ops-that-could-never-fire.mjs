/**
 * 0274 — the three project ops, and TWO of them could never fire.
 *
 * Found while planning the user's ask (2026-08-28): *"set up a plan to use the
 * Project template and make a project for Pauls Clown Website and Via Fluere.
 * make sure to include the ops"*. Measuring the ops before designing anything
 * is what turned "wire up two projects" into "the wiring is dead".
 *
 * ── DEFECT 1: `Project: Create` has been INERT since 2026-08-03 ──────────────
 * Its template lookup was
 *
 *     FIND $allOccurrences  where meta.templateName IS "Project Page"
 *
 * and `0035` UNSET `meta.templateName` on template roots. Measured on poms grid:
 *
 *     occurrences carrying meta.templateName == "Project Page"    0
 *     occurrences carrying ANY meta.templateName                  6   <- all "Day Page"
 *     the template root FZ-uqepntDle instead carries              meta.templateModule: true
 *
 * So the FIND bound nothing, the `$projectTplId IS_NOT_EMPTY` guard failed, and
 * APPLY_TEMPLATE never ran. The op is `onLoad` and enabled, so it fired on every
 * page load for 25 days and emitted nothing.
 *
 * A FRESH SEED WAS FINE, which is why nobody saw it — `buildProjectTemplate`
 * still writes `meta.templateName` on the template root, so only a MIGRATED grid
 * is broken. That is the `0043` / `0064` class exactly: a key one side retired
 * and the other kept writing.
 *
 * THE FIX IS PICKER-DIRECT, and the seed had already learned it one op over:
 * `makeDayPageBuildOp` throws without `dayPageTemplateOccId`, with a comment
 * saying resolving a template by `meta.templateName` matches every CLONE too
 * (APPLY_TEMPLATE copies meta) and a multi-match FIND returns an ARRAY that
 * APPLY_TEMPLATE cannot use. `Project: Create` never got the same treatment.
 *
 * THE onLoad ARM GOES WITH IT, and that is not cosmetic. It stamped a hardcoded
 * `Moduli v1 Launch` name + scope on every load. Fixing the lookup alone would
 * wake a 25-day-dormant op that MINTS A PAGE on the next load. It converges only
 * because of the label-collision guard below it — luck, not design. The op is
 * now what its ELSE branch always was: a manual run that asks for name + scope.
 *
 * ── DEFECT 2: NOTHING binds `Status`, so both routing ops are unfireable ─────
 *     modules binding Status (OWQdY4aV7o5v)      0
 * `Project: Status Router` and `Project: Sync To Todo List` both trigger on
 * `onChange · field · Status`. No occurrence can carry that field, so neither
 * has EVER fired. The kanban is six containers you can drag between; the routing
 * behind it is declared and dead. `0275` mints the tasks that bind it — this
 * migration only makes the pipelines correct for when they can.
 *
 * ── AND THE MIRROR LANDS PER PROJECT NOW (the user's call) ───────────────────
 * `Sync To Todo List` sent Backburner AND Docket into ONE hardcoded container,
 * `Occupational` on the Tasks page. The 2026-05 spec wanted a Backburner and a
 * Docket container on the Todo List page; that page became the **Tasks** page
 * (nine wellness dimensions), which has neither, so both arms were retargeted
 * onto the nearest dimension and collapsed together. The user asked for one
 * container per project instead.
 *
 * THE CONTAINER IS FOUND BY ITS `Project` VALUE, not its label and not a
 * per-project id baked into the pipeline. A label is one rename from wrong (the
 * `SCHEDULE_LABEL_PREFIX` lesson); a baked id needs this op edited for every new
 * project, which is the "the eighth caller forgets" trap. It FAILS OPEN to
 * Occupational — a task naming no project still gets its mirror, because
 * dropping it reads as the sync silently breaking.
 *
 * ── REGENERATED FROM THE SEED'S OWN BUILDERS, NOT PATCHED IN PLACE ───────────
 * Both pipelines are rebuilt by importing `makeProjectCreateOp` /
 * `makeProjectSyncToTodoOp` — the same functions the seed calls — so a fresh
 * grid and a migrated grid cannot drift. `Sync To Todo List` lived INLINE in
 * `createLiveData` until this pass, which is exactly how a stored pipeline and
 * its author drift; it is a builder now. The op's own `id`, `folderId`,
 * `priority` and `enabled` are preserved, so nothing that references it by id
 * or lists it in a category moves.
 *
 * ── THE TEMPLATE IS RESOLVED STRUCTURALLY, and refuses when ambiguous ────────
 * Not by `meta.templateName` (retired — that is the bug) and not by label alone.
 * A template is the page in the protected Templates folder whose label still
 * carries the UNREPLACED `{ProjectName}` token — a clone cannot, because
 * APPLY_TEMPLATE replaces it. Exactly one must match or the migration REFUSES.
 */

export const id = "0274-project-ops-that-could-never-fire";
export const describe = "Regenerate Project: Create (dead template lookup, onLoad demo arm) and Project: Sync To Todo List (per-project mirror container) from the seed's own builders. Rewrites two operation pipelines; deletes nothing.";
export const touches = ["operations"];

const PROJECT_NAME_TOKEN = "{ProjectName}";

/**
 * The Project Page template root. Structural: a page occurrence whose label
 * still holds the unreplaced token. A CLONE has the token replaced, so it can
 * never match — which is the whole reason this beats a label or a meta marker.
 * Returns { id } or { error }.
 */
export function findProjectTemplate(occurrences, modulesById) {
  const hits = occurrences.filter(o => {
    const m = modulesById[o.moduleId];
    if (m?.role !== "page") return false;
    const label = o.label ?? m?.label ?? "";
    return label.includes(PROJECT_NAME_TOKEN);
  });
  if (hits.length === 1) return { id: hits[0].id };
  if (!hits.length) return { error: `no page occurrence carries the ${PROJECT_NAME_TOKEN} token — the Project Page template is missing` };
  return { error: `${hits.length} page occurrences carry ${PROJECT_NAME_TOKEN} — ambiguous, refusing to guess (${hits.map(h => h.id).join(", ")})` };
}

/** Resolve one field by NAME **and** type — this grid carries duplicate field names. */
export function resolveField(fields, name, type) {
  const hits = fields.filter(f => f.name === name && f.type === type);
  if (hits.length === 1) return { id: hits[0].id };
  if (!hits.length) return { error: `no ${type} field named "${name}"` };
  return { error: `${hits.length} ${type} fields named "${name}" — ambiguous` };
}

/**
 * The comparable SHAPE of an operation: its pipeline and trigger surface with
 * every generated `id` stripped. The builders mint a fresh `uid()` for each step
 * on every call, so a raw JSON compare NEVER matches and the migration would
 * report a rewrite — and churn every step id — on each run. Stripping ids is
 * what makes "already converged" mean something.
 */
export function shapeOf(op) {
  const strip = (n) => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    return Object.fromEntries(
      Object.entries(n).filter(([k]) => k !== "id" && k !== "_id").map(([k, v]) => [k, strip(v)])
    );
  };
  return JSON.stringify(strip({
    pipeline: op.pipeline, triggerObjects: op.triggerObjects, triggerTypes: op.triggerTypes,
  }));
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Operation, Field } = models;
  const userId = grid?.userId;
  if (!userId) { log("  REFUSING: the grid names no userId"); return; }

  const { makeProjectCreateOp, makeProjectSyncToTodoOp } =
    await import("../utils/liveSystemBuilders.js");

  const [occs, mods, fields, ops, folders] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
    models.Folder.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));

  // ── resolve everything the two builders need, refusing on any miss ────────
  const tpl = findProjectTemplate(occs, modulesById);
  if (tpl.error) { log(`  REFUSING: ${tpl.error}`); return; }

  const projectsFolder = folders.find(f => f.name === "Projects" && f.folderType !== "category" && f.parentId);
  if (!projectsFolder) { log("  REFUSING: no root 'Projects' folder — Project: Create has nowhere to mint into"); return; }

  const status  = resolveField(fields, "Status",  "select");
  const project = resolveField(fields, "Project", "occurrence");
  if (status.error)  { log(`  REFUSING: ${status.error}`);  return; }
  if (project.error) { log(`  REFUSING: ${project.error}`); return; }

  const tasksPage = occs.find(o => modulesById[o.moduleId]?.role === "page" && (o.label ?? modulesById[o.moduleId]?.label) === "Tasks");
  if (!tasksPage) { log("  REFUSING: no Tasks page — the mirror has no ancestor scope"); return; }
  const occupational = (tasksPage.occurrences || [])
    .map(id => occs.find(o => o.id === id))
    .find(o => o && (o.label ?? modulesById[o.moduleId]?.label) === "Occupational");
  if (!occupational) { log("  REFUSING: no Occupational container on the Tasks page — no fail-open destination"); return; }

  log(`  template ${tpl.id} · Projects folder ${projectsFolder.id} · Status ${status.id} · Project ${project.id}`);
  log(`  Tasks page ${tasksPage.id} · fail-open container ${occupational.id}`);

  // ── rebuild each pipeline from the seed's own builder ─────────────────────
  const rebuilds = [
    {
      name: "Project: Create",
      build: () => makeProjectCreateOp({ userId, gridId, projectsFolderId: projectsFolder.id, projectTemplateOccId: tpl.id }),
    },
    {
      name: "Project: Sync To Todo List",
      build: () => makeProjectSyncToTodoOp({
        userId, gridId,
        statusFieldId: status.id, projectFieldId: project.id,
        tasksPageOccId: tasksPage.id, fallbackContainerOccId: occupational.id,
      }),
    },
  ];

  const planned = [];
  for (const r of rebuilds) {
    const live = ops.find(o => o.name === r.name);
    if (!live) { log(`  SKIP "${r.name}" — not on this grid`); continue; }
    const next = r.build();
    const before = shapeOf(live);
    const after  = shapeOf(next);
    if (before === after) { log(`  "${r.name}" already matches the builder — no change`); continue; }
    planned.push({ id: live.id, name: r.name, next });
  }

  if (!planned.length) { log("  both pipelines already match their builders — already converged"); return; }
  for (const p of planned) {
    const j = JSON.stringify(p.next);
    log(`  REWRITE "${p.name}" (${p.id}) → steps=${p.next.pipeline.steps.length} triggers=${p.next.triggerObjects.length}` +
        ` templateName=${j.includes("templateName")} onLoad=${j.includes("onLoad")}`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const p of planned) {
    // The op's identity is preserved: id, folderId, priority and enabled are
    // NOT taken from the builder (which mints a fresh id every call).
    await Operation.updateOne({ gridId, id: p.id }, {
      $set: {
        description:    p.next.description,
        triggerType:    p.next.triggerType,
        triggerTypes:   p.next.triggerTypes,
        triggerObjects: p.next.triggerObjects,
        pipeline:       p.next.pipeline,
      },
    });
  }
  log(`  done — ${planned.length} pipeline(s) regenerated from the seed's builders`);
}
