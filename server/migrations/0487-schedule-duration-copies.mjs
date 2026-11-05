// 0487 — a row with a duration shows in every slot it covers (user 2026-11-05: "cps training is 4 hours, we need a copy of
// it (not copylink) in the other timeslots. and remove them if the original gets deleted or the duration changes. dont
// include duration in these copies.").
//
// Plain copies with `meta.spanOf` = the original. They carry no Duration (or the time trackers would count it again) and no
// tick (a copy made from a ticked row would count as a second finished task). Each pass works out what should exist and
// deletes the rest, so a deleted original or a changed Duration / Time Slot / Date needs no bookkeeping.
export const id = "0487-schedule-duration-copies";
export const describe = "Schedule: Duration Copies — a plain copy of a row in each further slot its Duration covers.";
export const touches = ["operations"];

export const OP_NAME = "Schedule: Duration Copies";
const f = (fid) => `fields.${fid}.value`;
let n = 0;
const uid = () => `dc${(n++).toString(36)}`;
const action = (config) => ({ id: uid(), type: "action", config });
const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const when = (rules, then) => ({ id: uid(), type: "if", condition: { operator: "AND", rules }, then, else: [] });
const loop = (overExpr, as, body) => ({ id: uid(), type: "loop", overExpr, as, body });

/** Pure: the op. `hiddenFieldIds` is what the Schedule page hides: a copy's own list replaces that one, so it restates it. */
export function durationCopiesOp({ userId, gridId, schedulePageOccId, dateFieldId, timeslotFieldId, durationFieldId, scheduleFormatFieldId, omitFieldIds = [], hiddenFieldIds = [] }) {
  const inDay = (v) => rule(`${v}._ancestors`, "HAS_ANCESTOR", "$dayColId");
  const slotOf = (v) => `${v}.${f(timeslotFieldId)}`;
  const steps = [
    action({ type: "INIT_VAR", name: "$schedPageId", expr: `literal:${schedulePageOccId}` }),
    loop("$activePeriodDates", "$day", [
      action({ type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: { operator: "AND", rules: [
        rule("_ancestors", "HAS_ANCESTOR", "$schedPageId"),
        rule(f(scheduleFormatFieldId), "IS", "day-col"),
        rule(f(dateFieldId), "SAME_DAY", "$day"),
      ] } }),
      when([rule("$dayColId", "IS_NOT_EMPTY")], [
        action({ type: "INIT_VAR", name: "$slotLabels", expr: "json:[]" }),
        action({ type: "INIT_VAR", name: "$wanted", expr: "json:[]" }),
        loop("$allContainers", "$slot", [
          when([inDay("$slot"), rule(`$slot.${f(scheduleFormatFieldId)}`, "IS", "slot"), rule(slotOf("$slot"), "IS_NOT_EMPTY")], [
            action({ type: "PUSH_TO_VAR", name: "$slotLabels", expr: slotOf("$slot") }),
          ]),
        ]),
        loop("$allInstances", "$orig", [
          when([
            inDay("$orig"),
            rule(slotOf("$orig"), "IS_NOT_EMPTY"),
            rule(`$orig.${f(durationFieldId)}`, "GREATER", "0"),
            rule("$orig.meta.spanOf", "IS_EMPTY"),
            rule("$orig.meta.feedSourceId", "IS_EMPTY"),
          ], [
            action({ type: "SLOTS_COVERED", start: slotOf("$orig"), duration: `$orig.${f(durationFieldId)}`, slotLabels: "$slotLabels", to: "$covered" }),
            loop("$covered", "$lbl", [
              when([rule("$lbl", "IS_NOT", `$${slotOf("orig")}`)], [
                action({ type: "PUSH_TO_VAR", name: "$wanted", expr: "${$orig.id}|${$lbl}" }),
                action({ type: "FIND", over: "$allContainers", itemIdVar: "$slotId", predicate: { operator: "AND", rules: [
                  rule("_ancestors", "HAS_ANCESTOR", "$dayColId"),
                  rule(f(scheduleFormatFieldId), "IS", "slot"),
                  rule(f(timeslotFieldId), "IS", "$lbl"),
                ] } }),
                action({ type: "FIND", over: "$allInstances", itemIdVar: "$copyId", predicate: { operator: "AND", rules: [
                  rule("meta.spanOf", "IS", "$orig.id"),
                  rule("parentId", "IS", "$slotId"),
                ] } }),
                when([rule("$slotId", "IS_NOT_EMPTY"), rule("$copyId", "IS_EMPTY")], [
                  action({
                    type: "COPY_LINK", sourceId: "$orig.id", parent: "$slotId", linked: false, recursive: false,
                    omitFields: omitFieldIds,
                    fields: { [timeslotFieldId]: "$lbl", [dateFieldId]: "$day" },
                    fieldVisibility: `json:${JSON.stringify({ mode: "hide", fieldIds: [...new Set([...hiddenFieldIds, durationFieldId])] })}`,
                    meta: { spanOf: "$orig.id" },
                    identitySignature: "span:${$orig.id}:${$lbl}",
                  }),
                ]),
              ]),
            ]),
          ]),
        ]),
        // Whatever is not wanted now: the original went, or its Duration, Time Slot or Date changed.
        loop("$allInstances", "$c", [
          when([rule("$c.meta.spanOf", "IS_NOT_EMPTY"), inDay("$c")], [
            when([rule("$wanted", "NOT_CONTAINS", `\${$c.meta.spanOf}|\${$${slotOf("c")}}`)], [
              action({ type: "DELETE", itemIdExpr: "$c.id" }),
            ]),
          ]),
        ]),
      ]),
    ]),
  ];
  const on = (o) => ({ priority: 3, targetId: "", ...o });
  return {
    name: OP_NAME, userId, gridId, enabled: true,
    // $activePeriodDates is the period of this page's own filter.
    targetOccurrenceId: schedulePageOccId,
    pipeline: { sources: [], steps },
    // Which events fire an op is read from this list; triggerObjects only narrow them.
    triggerTypes: ["onLoad", "onFilterChange", "onChange", "onDelete", "onAdd", "onMove"],
    triggerObjects: [
      on({ eventType: "onLoad", subjectType: "grid" }),
      on({ eventType: "onFilterChange", subjectType: "grid" }),
      on({ eventType: "onFilterChange", subjectType: "filterNav", ancestorId: schedulePageOccId }),
      on({ eventType: "onChange", subjectType: "field", targetId: durationFieldId }),
      on({ eventType: "onChange", subjectType: "field", targetId: timeslotFieldId }),
      on({ eventType: "onChange", subjectType: "field", targetId: dateFieldId }),
      on({ eventType: "onDelete", subjectType: "module", subjectRole: "instance", ancestorId: schedulePageOccId }),
      on({ eventType: "onAdd", subjectType: "module", subjectRole: "instance", ancestorId: schedulePageOccId }),
      on({ eventType: "onMove", subjectType: "module", subjectRole: "instance", ancestorId: schedulePageOccId }),
    ],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Occurrence, Grid } = models;
  if (await Operation.findOne({ gridId, name: OP_NAME }).lean()) { log(`${OP_NAME} already exists`); return; }
  const place = await Operation.findOne({ gridId, name: "Schedule: Place Dated Work" }).lean();
  if (!place) throw new Error("no Schedule: Place Dated Work to read the Schedule page from");
  const fields = await Field.find({ gridId }).lean();
  const byName = (name, type) => {
    const hit = fields.filter((x) => x.name === name && (!type || x.type === type));
    if (hit.length !== 1) throw new Error(`expected one field "${name}", found ${hit.length}`);
    return hit[0].id;
  };
  const schedulePageOccId = /\$allItemsById\.([\w-]+)/.exec(JSON.stringify(place.pipeline))?.[1];
  if (!schedulePageOccId) throw new Error("could not read the Schedule page off Place Dated Work");
  const page = await Occurrence.findOne({ id: schedulePageOccId }).lean();
  const grid = await Grid.findById(gridId).lean();
  const op = durationCopiesOp({
    userId: grid.userId, gridId, schedulePageOccId,
    dateFieldId: byName("Date"), timeslotFieldId: byName("Time Slot"), durationFieldId: byName("Duration"),
    scheduleFormatFieldId: byName("Schedule Format"),
    omitFieldIds: [byName("Duration"), byName("Completed"), byName("Completed On")],
    hiddenFieldIds: page?.fieldVisibility?.mode === "hide" ? page.fieldVisibility.fieldIds : [],
  });
  log(`would create ${OP_NAME}: ${op.pipeline.steps.length} top-level steps`);
  if (!dryRun) await Operation.create(op);
}
