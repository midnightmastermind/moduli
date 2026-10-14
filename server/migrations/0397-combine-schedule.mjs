// server/migrations/0397-combine-schedule.mjs
//
// User 2026-10-13: "a field called combine schedule thats a checkbox field and is also a filter on
// schedule, if combined is yes, we should only create one schedule copy for all the dates (instead
// of seperate ones) and it would show all the occurances inside that match the filter" — then
// (14:31) "this field filter thing … should be handled by the operations not some hard coded thing"
// and "it would show a copylinked schedule".
//
// So nothing in the app knows about it. Three pieces of data:
//   1. a boolean field "Combine Schedule";
//   2. a local filter on the Schedule page naming it (Filter menu › Local Filters, nav shown as
//      true / false pills) — toggling it writes the page's filterOverride and fires a NavigationOp;
//   3. the operation "Schedule: Combine Days". When the page's Combine Schedule is true and more than
//      one day is picked it keeps ONE column, "Schedule - Combined", holding copy-links of the
//      template's slots; each slot gets a FEED (since 0399: whatever is listed in that slot on each
//      picked day, under the Schedule page) so it lists every matching item from every picked day as a copy-link of the real item
//      (edits change the real item; the copy carries its Date). The day columns stay and are hidden
//      through the page's layoutCascadeOverride.hideChildIds. Off, or one day: the column is deleted.
//
// The combined column's Schedule Format is "combined", so no "day-col" rule (Build Schedule's sweep,
// Build Day, Place Dated Work, Mark Passed Slots) ever touches it. Its slots have no Date and no
// filterOverride, so they inherit the page's period and the feed keeps only rows dated inside it.
// Runs at priority 4, after Build Schedule (1), which rewrites the page's layout override each run.

export const id = "0397-combine-schedule";
export const describe = "Combine Schedule: a checkbox field, a Schedule-page filter, and the op that copy-links every picked day into one column.";
export const touches = ["fields", "occurrences", "operations"];

export const FIELD_NAME = "Combine Schedule";
export const OP_NAME = "Schedule: Combine Days";
export const BUILD_OP = "Schedule: Build Schedule";
export const COMBINED_FORMAT = "combined";
export const COMBINED_LABEL = "Schedule - Combined";

const uid = () => globalThis.crypto.randomUUID();
const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const all = (...rules) => ({ id: uid(), operator: "AND", rules });
const act = (config) => ({ id: uid(), type: "action", config });
const iff = (condition, then, els = []) => ({ id: uid(), type: "if", condition, then, else: els });
const loop = (overExpr, as, body) => ({ id: uid(), type: "loop", overExpr, as, body });

/** PURE. The op's pipeline. `layoutContId` is the template container whose children are the slots. */
export function combineDaysPipeline({ pageOccurrenceId, layoutContId, combineFieldId, dateFieldId, timeslotFieldId, scheduleFormatFieldId }) {
  const fmt = `fields.${scheduleFormatFieldId}.value`;
  return {
    sources: [],
    steps: [
      act({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${pageOccurrenceId}` }),
      act({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
      act({ type: "INIT_VAR", name: "$combine", expr: `$schedPage._effectiveFilter.${combineFieldId}` }),
      act({ type: "FIND", over: "$allContainers", predicate: all(r("parentId", "IS", "$schedPageId"), r(fmt, "IS", COMBINED_FORMAT)),
        itemIdVar: "$combColId", itemVar: "$combCol" }),
      iff(all(r("$schedPageId", "IS_NOT_EMPTY")), [
        iff(all(r("$combine", "IS", "true"), r("$activePeriodCount", "GREATER", 1)), [
          iff(all(r("$combColId", "IS_EMPTY")), [
            act({ type: "CREATE", name: COMBINED_LABEL, role: "container", kind: "board", meta: { allowChildContainers: true },
              parent: "$schedPageId", fields: { [scheduleFormatFieldId]: COMBINED_FORMAT }, fieldHidden: { [scheduleFormatFieldId]: true },
              itemIdVar: "$combColId", itemVar: "$combCol" }),
          ]),
          act({ type: "ADD_CHILD", parentId: "$schedPageId", childId: "$combColId" }),
          // One pass over the page's day columns: every one is HIDDEN, and the ones dated inside the
          // picked period are the days the combined slots pull from (0399).
          act({ type: "INIT_VAR", name: "$hideIds", expr: "json:[]" }),
          act({ type: "INIT_VAR", name: "$dayColIds", expr: "json:[]" }),
          act({ type: "INIT_VAR", name: "$period", expr: `$schedPage._effectiveFilter.${dateFieldId}` }),
          loop("$allContainers", "$col", [
            iff(all(r("$col.parentId", "IS", "$schedPageId"), r(`$col.${fmt}`, "IS", "day-col")), [
              act({ type: "PUSH_TO_ARRAY", name: "$hideIds", value: "$col.id" }),
              iff(all(r(`$col.fields.${dateFieldId}.value`, "DATE_IN_PERIOD", "$period")), [
                act({ type: "PUSH_TO_ARRAY", name: "$dayColIds", value: "$col.id" }),
              ]),
            ]),
          ]),
          act({ type: "INIT_VAR", name: "$layout", expr: `$allItemsById.${layoutContId}` }),
          loop("$layout.occurrences", "$tplSlotId", [
            act({ type: "FIND", over: "$allContainers",
              predicate: all(r("meta.copyLinkSource", "IS", "$tplSlotId"), r("parentId", "IS", "$combColId")), itemIdVar: "$slotId", itemVar: "$slotOcc" }),
            iff(all(r("$slotId", "IS_EMPTY")), [
              act({ type: "COPY_LINK", sourceId: "$tplSlotId", parent: "$combColId", recursive: false, itemIdVar: "$slotId", itemVar: "$slotOcc" }),
            ], [
              act({ type: "ADD_CHILD", parentId: "$combColId", childId: "$slotId" }),
            ]),
            // The slot pulls WHATEVER SITS in the same slot on each picked day — a Todo item has no Time
            // Slot, a shift spanning 13 slots carries only its start, so no field says where a row sits.
            // Each day column's slot is a copy-link of this template slot (meta.copyLinkSource).
            act({ type: "SET_VAR", name: "$conds", expr: "json:[]" }),
            loop("$dayColIds", "$dcId", [
              act({ type: "SET_VAR", name: "$dc", expr: "$allItemsById.${$dcId}" }),
              loop("$dc.occurrences", "$dsId", [
                act({ type: "SET_VAR", name: "$ds", expr: "$allItemsById.${$dsId}" }),
                iff(all(r("$ds.meta.copyLinkSource", "IS", "$tplSlotId")), [
                  act({ type: "PUSH_TO_ARRAY", name: "$conds",
                    value: { id: "$dsId", path: "_ancestors", comparator: "HAS_ANCESTOR", value: "$dsId" } }),
                ]),
              ]),
            ]),
            // No day slot to pull from must pull NOTHING — a scoped feed with no usable condition
            // mirrors the whole Schedule page.
            iff(all(r("$conds", "IS_EMPTY")), [
              act({ type: "UPDATE", path: "$slotOcc.feed", value: { enabled: false, roles: ["instance"], scope: "$schedPageId", limit: 200, conditions: [] } }),
            ], [
              act({ type: "UPDATE", path: "$slotOcc.feed", value: {
                enabled: true, roles: ["instance"], scope: "$schedPageId", limit: 200, conditionOperator: "OR", conditions: "$conds",
              } }),
            ]),
          ]),
          act({ type: "UPDATE", path: "$schedPage.meta.layoutCascadeOverride.hideChildIds", value: "$hideIds" }),
          act({ type: "UPDATE", path: "$schedPage.meta.layoutCascadeOverride.mode", value: "literal:stack" }),
          // Each row is tagged with its date: the column keeps the Schedule page's own field visibility
          // (a level is a complete answer, so it must restate it) and REVEALS Date, which schedule items
          // bind hidden. Reveal is not a whitelist — every other field shows exactly as it does in a day.
          act({ type: "INIT_VAR", name: "$pageFvMode", expr: "$schedPage.fieldVisibility.mode" }),
          iff(all(r("$pageFvMode", "IS_EMPTY")), [act({ type: "SET_VAR", name: "$pageFvMode", expr: "literal:off" })]),
          act({ type: "INIT_VAR", name: "$pageFvIds", expr: "$schedPage.fieldVisibility.fieldIds" }),
          act({ type: "UPDATE", path: "$combCol.fieldVisibility",
            value: { mode: "$pageFvMode", fieldIds: "$pageFvIds", reveal: [`literal:${dateFieldId}`] } }),
        ], [
          iff(all(r("$combColId", "IS_NOT_EMPTY")), [
            act({ type: "DELETE", itemIdExpr: "$combColId" }),
          ]),
        ]),
      ]),
    ],
  };
}

/** PURE. The template container Build Schedule copies slots from — read off its own $dayCont INIT_VAR. */
export function layoutContainerOf(buildOp) {
  for (const s of buildOp?.pipeline?.steps || []) {
    const c = s.config || {};
    if (c.type === "INIT_VAR" && c.name === "$dayCont") {
      const m = /^\$allItemsById\.(.+)$/.exec(String(c.expr || ""));
      if (m) return m[1];
    }
  }
  return null;
}

/** PURE. The page's filters[] with a Combine Schedule entry, or null when one is already there. */
export function withCombineFilter(filters, combineFieldId) {
  const list = filters || [];
  if (list.some((f) => f.fieldId === combineFieldId)) return null;
  return [...list, { id: uid(), fieldId: combineFieldId, active: true, showNav: true, style: "pills", condition: null }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Occurrence, Operation } = models;
  const grid = await Grid.findById(gridId).lean();
  const ids = grid?.meta?.scheduleFieldIds;
  if (!ids?.pageOccurrenceId || !ids.dateFieldId || !ids.timeslotFieldId || !ids.scheduleFormatFieldId)
    throw new Error("0397: grid.meta.scheduleFieldIds is incomplete — set it in Grid settings › Schedule first");

  const build = await Operation.findOne({ gridId, name: BUILD_OP }).lean();
  const layoutContId = layoutContainerOf(build);
  if (!layoutContId) throw new Error(`0397: could not read the template container from "${BUILD_OP}"`);
  if (!(await Occurrence.findOne({ id: layoutContId, gridId }).lean())) throw new Error(`0397: template container ${layoutContId} not found`);

  let field = await Field.findOne({ gridId, name: FIELD_NAME }).lean();
  if (field && field.type !== "boolean") throw new Error(`0397: a field named ${FIELD_NAME} exists with type ${field.type}`);
  if (!field) {
    field = { id: uid(), userId: String(grid.userId), gridId, name: FIELD_NAME, type: "boolean", inputEnabled: true, displayEnabled: false, meta: {} };
    log(`+ field ${FIELD_NAME} (boolean)`);
    if (!dryRun) await Field.create(field);
  } else log(`field ${FIELD_NAME} exists`);

  const page = await Occurrence.findOne({ id: ids.pageOccurrenceId, gridId }).lean();
  if (!page) throw new Error(`0397: Schedule page ${ids.pageOccurrenceId} not found`);
  const filters = withCombineFilter(page.filters, field.id);
  if (filters) {
    log(`+ local filter ${FIELD_NAME} on the Schedule page`);
    if (!dryRun) await Occurrence.updateOne({ id: page.id, gridId }, { $set: { filters } });
  } else log("Schedule page already filters on it");

  if (await Operation.findOne({ gridId, name: OP_NAME }).lean()) { log(`op ${OP_NAME} exists`); return; }
  const op = {
    id: uid(), userId: String(grid.userId), gridId, name: OP_NAME, enabled: true, priority: 4,
    description: "When the Schedule page's Combine Schedule is on and several days are picked, one column copy-links every picked day's items into its time slots.",
    targetOccurrenceId: ids.pageOccurrenceId,
    folderId: build.folderId || null,
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 4 },
      { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 4 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorId: ids.pageOccurrenceId, priority: 4 },
    ],
    triggerTypes: ["onLoad", "onFilterChange"], triggerType: "onLoad",
    pipeline: combineDaysPipeline({ pageOccurrenceId: ids.pageOccurrenceId, layoutContId, combineFieldId: field.id,
      dateFieldId: ids.dateFieldId, timeslotFieldId: ids.timeslotFieldId, scheduleFormatFieldId: ids.scheduleFormatFieldId }),
  };
  log(`+ op ${OP_NAME} (template ${layoutContId})`);
  if (!dryRun) await Operation.create(op);
  log("done. Restart the server (pm2).");
}
