// Found by the new `unsigned-template-node` integrity check the same day it was
// written (2026-07-31), which is the point of the check.
//
// `buildProjectTemplate` wrote each kanban column's identitySignature into the
// MODULE's `meta` — but identitySignature is a TOP-LEVEL field on the
// OCCURRENCE (schema, 2026-05-14). Merge never looked there, so the signatures
// have never done anything: re-applying the Project template would have cloned
// all six columns, exactly the way the Day Page cloned its sections. It had not
// gone off yet only because projects are created rarely.
//
// The builder is fixed in the same commit (so a fresh seed is correct); this
// signs the template that already exists on a frozen grid. The Kanban container
// and the Project Scope textblock are signed too — merge recurses into a node
// it matched, so an unsigned child duplicates one level down.

export const id = "0024-project-template-signatures";
export const describe =
  "Puts identitySignature on the Project template's occurrences (kanban board, its six columns, the scope " +
  "textblock). They were written into module meta, where APPLY_TEMPLATE's merge never reads them, so " +
  "re-applying the template would have duplicated every column.";

const COLUMN_KEYS = {
  "Backburner": "backburner",
  "Docket": "docket",
  "Working On": "workingOn",
  "In Review": "inReview",
  "Test": "test",
  "Complete": "complete",
};

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const rootMod = await Module.findOne({ gridId, label: /^Project: /, "meta.templateModule": true })
    .select({ id: 1, label: 1 }).lean();
  if (!rootMod) { log("no Project template on this grid"); return; }
  const rootOcc = await Occurrence.findOne({ gridId, moduleId: rootMod.id }).select({ id: 1, occurrences: 1 }).lean();
  if (!rootOcc) { log("Project template module has no occurrence"); return; }

  let signed = 0;
  const sign = async (occ, sig) => {
    if (!occ || occ.identitySignature === sig) return;
    log(`  ${sig}`);
    signed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: occ.id }, { $set: { identitySignature: sig } });
  };

  for (const kid of rootOcc.occurrences || []) {
    const occ = await Occurrence.findOne({ gridId, id: kid })
      .select({ id: 1, moduleId: 1, occurrences: 1, identitySignature: 1 }).lean();
    if (!occ) continue;
    const mod = await Module.findOne({ gridId, id: occ.moduleId }).select({ label: 1 }).lean();
    if (mod?.label === "Kanban") {
      await sign(occ, "project:Kanban");
      for (const colId of occ.occurrences || []) {
        const col = await Occurrence.findOne({ gridId, id: colId })
          .select({ id: 1, moduleId: 1, identitySignature: 1 }).lean();
        const colMod = col && await Module.findOne({ gridId, id: col.moduleId }).select({ label: 1 }).lean();
        const key = COLUMN_KEYS[colMod?.label];
        if (key) await sign(col, `kanbanCol:${key}`);
        else if (col) log(`  ! unrecognised kanban column "${colMod?.label}" — left unsigned, name it in COLUMN_KEYS`);
      }
    } else if (mod?.label === "Project Scope") {
      await sign(occ, "project:Project Scope");
    } else if (mod) {
      log(`  ! unrecognised template child "${mod.label}" — left unsigned`);
    }
  }

  log(`${signed} occurrence(s) signed`);
}
