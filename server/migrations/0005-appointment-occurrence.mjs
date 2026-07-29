// User, 2026-07-29: "and we need an appointment occurance if we dont already
// have one." Nothing in the grid modelled a scheduled commitment — the closest
// thing was Social's Meet/Visit/Host (people you choose to see) and the Events
// board (Game Night, Book Club). A dentist visit is neither.
//
// This adds the noun/verb pair the rest of the grid is built from:
//   • an "Appointments" BOARD (Doctor / Dentist / Therapy / Optometrist /
//     Haircut / Car Service / Vet) under the Social board group, feed-backed
//     on boardCategory "appointment" like every other board;
//   • an "Appointment Type" occurrence dropdown scoped to that tag;
//   • an "Appointment" ACTION in the OCCUPATIONAL dimension binding
//     Completed · Appointment Type · Place · People · Duration · Date(hidden),
//     so it drags onto a Schedule slot and stamps date + timeslot like any
//     other action.
//
// Occupational (the obligations/admin dimension) rather than Social, so the
// Social dimension keeps reading as chosen contact. Trackers aggregate by
// FIELD, not by container, so the dimension is only where you go to find it —
// moving it later is a one-line change with no tracker consequence.
//
// The seed produces the same thing in the same commit; this reaches the frozen
// grids. Everything is resolved BY NAME at run time (no baked ids), and every
// step is find-then-create, so a half-applied run resumes cleanly.
import { nanoid } from "nanoid";

export const id = "0005-appointment-occurrence";
export const describe =
  "Adds an Appointments board (7 options) under the Social board group, an 'Appointment Type' " +
  "occurrence dropdown scoped to it, and an 'Appointment' action in the Occupational dimension " +
  "binding Completed/Appointment Type/Place/People/Duration/Date. Creates only — deletes nothing.";

const uid = () => nanoid(12);
const fv = (value, flow = "in") => ({ value, flow });

const OPTIONS = ["Doctor", "Dentist", "Therapy", "Optometrist", "Haircut", "Car Service", "Vet"];
const TAG = "appointment";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Folder } = models;

  // ── Resolve everything this depends on, by name ───────────────────────────
  const fieldId = async (name) => {
    const f = await Field.findOne({ gridId, name }).select({ id: 1 }).lean();
    if (!f) throw new Error(`field "${name}" not found on this grid — cannot place the Appointment action`);
    return f.id;
  };
  const boardCategoryId = await fieldId("Board Category");
  const placeId         = await fieldId("Place");
  const peopleId        = await fieldId("People");
  const durationId      = await fieldId("Duration");
  const completedId     = await fieldId("Completed");
  const dateId          = await fieldId("Date");
  const posterId        = await fieldId("Poster");

  // The Occupational ROUTINES container — NOT the tracker container of the
  // same module label. Discriminated by a child only the routines catalog has.
  const anchor = await Module.findOne({ gridId, role: "instance", label: "Network" }).select({ id: 1 }).lean();
  if (!anchor) throw new Error(`no "Network" action module — cannot locate the Occupational routines container`);
  const anchorOcc = await Occurrence.findOne({ gridId, moduleId: anchor.id }).select({ id: 1 }).lean();
  const occupational = await Occurrence.findOne({ gridId, occurrences: anchorOcc.id }).select({ id: 1, occurrences: 1 }).lean();
  if (!occupational) throw new Error(`"Network" is not listed by any container — cannot place the Appointment action`);
  log(`Occupational routines container: ${occupational.id} (${occupational.occurrences?.length ?? 0} children)`);

  const socialFolder = await Folder.findOne({ gridId, name: "Social" }).select({ id: 1 }).lean();
  if (!socialFolder) throw new Error(`no "Social" board-group folder — cannot place the Appointments board`);

  // ── 1. "appointment" joins the Board Category option list ─────────────────
  // TWO SHAPES IN THE WILD: the seed writes the tag list to `meta.options`,
  // but poms grid (built from an earlier seed) carries it in a manual
  // `meta.optionsSource.values`. Writing the wrong one is not harmless — it
  // would leave a stray one-element list on a field whose real options live
  // elsewhere. Append to whichever list this grid actually uses.
  const bc = await Field.findOne({ gridId, name: "Board Category" }).lean();
  const manual = bc?.meta?.optionsSource?.mode === "manual" && Array.isArray(bc.meta.optionsSource.values);
  const listPath = manual ? "meta.optionsSource.values" : "meta.options";
  const bcOptions = (manual ? bc.meta.optionsSource.values : bc?.meta?.options) ?? [];
  if (bcOptions.includes(TAG)) {
    log(`Board Category already offers "${TAG}" (via ${listPath})`);
  } else {
    log(`add "${TAG}" to Board Category's ${bcOptions.length} options (via ${listPath})`);
    if (!dryRun) {
      await Field.updateOne({ _id: bc._id }, { $set: { [listPath]: [...bcOptions, TAG] } });
    }
  }

  // ── 2. The Appointments board container + its 7 options + its page ────────
  // Created before the dropdown field, which points addNew at the container.
  let boardContOccId = null;
  const existingBoard = await Module.findOne({ gridId, role: "container", label: "Appointments" }).select({ id: 1 }).lean();
  if (existingBoard) {
    const occ = await Occurrence.findOne({ gridId, moduleId: existingBoard.id }).select({ id: 1 }).lean();
    boardContOccId = occ?.id ?? null;
    log(`Appointments board already exists (${boardContOccId})`);
  } else {
    const contModId = uid();
    const contOccId = uid();
    boardContOccId = contOccId;
    log(`create Appointments board: 1 container + ${OPTIONS.length} options + 1 board page`);
    if (!dryRun) {
      const userId = (await Occurrence.findOne({ gridId }).select({ userId: 1 }).lean()).userId;
      const mkOcc = (data) => new Occurrence({
        id: uid(), userId, gridId, timestamp: new Date(),
        fields: {}, meta: {}, hidden: false, ...data,
      }).save();

      const optionOccIds = [];
      for (const label of OPTIONS) {
        const modId = uid();
        // Same shape as every other board option: copy-drag (picking one onto
        // a day must leave it on its board), inline thumbnail, hidden tag.
        await new Module({
          id: modId, userId, gridId, role: "instance",
          label, defaultDragMode: "copy", meta: { mediaInline: true },
          fieldBindings: [
            { fieldId: boardCategoryId, role: "input", order: 0, hidden: true },
            { fieldId: posterId, role: "media", order: 98, hidden: true },
          ],
        }).save();
        const o = await mkOcc({ moduleId: modId, parentId: contOccId, fields: { [boardCategoryId]: fv([TAG]) } });
        optionOccIds.push(o.id);
      }

      await new Module({ id: contModId, userId, gridId, role: "container", kind: "board", label: "Appointments" }).save();
      await mkOcc({
        id: contOccId, moduleId: contModId,
        occurrences: optionOccIds,
        fields: { [boardCategoryId]: fv([TAG]) },
        // Materialized view: anything tagged "appointment" anywhere in the grid
        // is pulled in as a copy-link (feedSync self-excludes owner + children).
        feed: {
          enabled: true,
          conditions: [{ fieldId: boardCategoryId, comparator: "CONTAINS", value: TAG }],
          roles: ["instance"],
          sort: null,
          limit: 200,
        },
      });

      // Board PAGE under the Social group folder, after the boards already there.
      const siblings = await Occurrence.find({ gridId, parentId: socialFolder.id }).select({ sortOrder: 1 }).lean();
      const sortOrder = siblings.reduce((mx, s) => Math.max(mx, s.sortOrder ?? 0), -1) + 1;
      const pageModId = uid();
      await new Module({ id: pageModId, userId, gridId, role: "page", kind: "board", label: "Appointments" }).save();
      await mkOcc({
        moduleId: pageModId, parentId: socialFolder.id, sortOrder,
        occurrences: [contOccId],
        iteration: { mode: "persistent" }, fields: {},
        // A board lists its whole catalog — it must not be filtered by the day.
        filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } },
      });
    }
  }

  // ── 3. The "Appointment Type" dropdown ────────────────────────────────────
  let apptFieldId = null;
  const existingField = await Field.findOne({ gridId, name: "Appointment Type" }).select({ id: 1 }).lean();
  if (existingField) {
    apptFieldId = existingField.id;
    log(`"Appointment Type" field already exists (${apptFieldId})`);
  } else {
    apptFieldId = uid();
    log(`create field "Appointment Type" (occurrence, scoped to boardCategory "${TAG}")`);
    if (!dryRun) {
      const { userId } = await Field.findOne({ gridId }).select({ userId: 1 }).lean();
      await new Field({
        id: apptFieldId, userId, gridId,
        name: "Appointment Type", type: "occurrence",
        inputEnabled: true, displayEnabled: false,
        folderId: bc.folderId,   // same category as every other board dropdown
        meta: {
          multiSelect: false,
          optionsSource: {
            mode: "find",
            over: "$allInstances",
            predicate: {
              operator: "AND",
              rules: [
                { left: `fields.${boardCategoryId}.value`, comparator: "CONTAINS", right: TAG },
                // Feed copies carry their source's tag — without this every
                // option would list twice.
                { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
              ],
            },
            valuePath: "id",
            labelPath: "label",
            addNew: { parentOccurrenceId: boardContOccId },
          },
        },
      }).save();
    }
  }

  // ── 4. The "Appointment" ACTION in Occupational ───────────────────────────
  const existingAction = await Module.findOne({ gridId, role: "instance", label: "Appointment" }).select({ id: 1 }).lean();
  if (existingAction) {
    log(`"Appointment" action already exists (${existingAction.id})`);
    return;
  }
  log(`create "Appointment" action + its occurrence in the Occupational container`);
  if (dryRun) return;

  const { userId } = await Module.findOne({ gridId }).select({ userId: 1 }).lean();
  const actModId = uid();
  // `kind` is deliberately absent — it was dropped from instance modules on
  // 2026-07-29 (it is a sub-type WITHIN a role, and instances have none; a
  // stray kind:"board" makes getModuleTypeIcon draw the BOARD icon).
  await new Module({
    id: actModId, userId, gridId, role: "instance",
    label: "Appointment", defaultDragMode: "copy",
    fieldBindings: [
      { fieldId: completedId, role: "input", order: 0 },
      { fieldId: apptFieldId, role: "input", order: 1 },
      { fieldId: placeId,     role: "input", order: 2 },
      { fieldId: peopleId,    role: "input", order: 3 },
      { fieldId: durationId,  role: "input", order: 4 },
      // The daily-routine convention: routine sources need the Date binding,
      // hidden and stamped by the drop.
      { fieldId: dateId, role: "input", order: 90, hidden: true },
    ],
  }).save();

  const actOcc = await new Occurrence({
    id: uid(), userId, gridId, timestamp: new Date(),
    moduleId: actModId, parentId: occupational.id,
    sortOrder: (occupational.occurrences?.length ?? 0),
    fields: {}, meta: {}, hidden: false,
  }).save();
  // parentId alone does not render it — the container's ordered list is what
  // the board reads.
  await Occurrence.updateOne({ gridId, id: occupational.id }, { $push: { occurrences: actOcc.id } });
  log(`Appointment action occurrence ${actOcc.id} appended to ${occupational.id}`);
}
