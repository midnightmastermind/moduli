// 0481 — a movie, episode or documentary you finish shows up on that day's Schedule (media streaming plan, Task 9).
//
// Op "Media: Log Watch" (Library Ops, priority 3; onLoad, onFilterChange grid, onChange Last Watched, onChange
// Watched At). For each day the Schedule shows: every movie / episode / documentary row (Board Category) whose watch
// moment falls on that day gets ONE completed copy of the Routines "Watch" item, unlinked (`linked:false`, its own
// values), in that day's column:
//   - the moment is Watched At (the exact ISO instant the player / the Jellyfin sync write) read in THIS browser's
//     zone — the executor runs in the browser — else the Last Watched date;
//   - with a time it goes in the half-hour slot it falls in (TIME_SLOT, "20:10" -> "8:00pm"), with only a date in the
//     day's Todo;
//   - a movie / documentary sets Media = [the row]; an episode sets TV Show, TV Season and Episode = the row.
// Each copy carries `meta.watchFor = "<row id>@<moment>"`; a row already logged for that moment anywhere under the
// Schedule page is skipped (reloads; the keys are collected once per run), and the copy's identitySignature `watch:<that key>` lets the server refuse a
// second one under the same slot (two tabs). Watching again writes a new moment, so it gets a second entry. Nothing
// is ever deleted. A day not on screen is placed when it is shown.
//
// Every id is found on the grid at run time (fields by name + type, the Watch item by its module, the Schedule from
// grid.meta.scheduleFieldIds). Writes one operation. Deletes nothing.
import { randomUUID } from "node:crypto";

export const id = "0481-media-log-watch";
export const describe = "Op 'Media: Log Watch': a finished movie / episode / documentary gets a completed Watch entry in that day's Schedule slot. Deletes nothing.";
export const touches = ["operations"];

export const OP_NAME = "Media: Log Watch";
export const WATCH_TAGS = ["movie", "episode", "documentary"];

const uid = () => randomUUID();
const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const and = (...rules) => ({ operator: "AND", rules });
const or = (...rules) => ({ id: uid(), operator: "OR", rules });
const act = (config) => ({ id: uid(), type: "action", config });
const iff = (condition, then, els = []) => ({ id: uid(), type: "if", condition, then, else: els });
const loop = (overExpr, as, body) => ({ id: uid(), type: "loop", overExpr, as, body });

/**
 * PURE. The op's pipeline from the grid's own ids.
 *
 * COST (review round 1, 0482): nothing walks the grid. Per shown day ONE FIND over $allOccurrences carries a plain
 * `fields.<Last Watched>.value SAME_DAY $day` rule, which the executor serves from its per-collection day index
 * (operationActions.sameDayRuleOf / recordsOnDay — a row with no Last Watched is not even in the index). "Already
 * logged" is a membership test against the watchFor keys collected ONCE per run from the instances under the
 * Schedule page (only when some day has a candidate), never a FIND per candidate.
 */
export function logWatchPipeline({
  pageOccurrenceId, dateFieldId, timeslotFieldId, scheduleFormatFieldId,
  categoryFieldId, lastWatchedFieldId, watchedAtFieldId, completedFieldId,
  mediaFieldId, showFieldId, seasonLinkFieldId, episodeFieldId, watchSourceId,
}) {
  const w = (fid) => `$watch.fields.${fid}.value`;
  const copy = (fields) => act({
    type: "COPY_LINK", sourceId: watchSourceId, parent: "$targetId", linked: false, recursive: false,
    identitySignature: "watch:${$watchKey}", meta: { watchFor: "$watchKey" },
    fields: { [completedFieldId]: "literal:true", [dateFieldId]: "$day", [timeslotFieldId]: "$slotTime", ...fields },
  });
  return { sources: [], steps: [
    act({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${pageOccurrenceId}` }),
    act({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
    iff(and(r("$schedPageId", "IS_NOT_EMPTY"),
      or(r("$trigger.sourceOccurrenceId", "IS_EMPTY"), r("$trigger.sourceOccurrenceId", "IS", "$schedPage.id"))), [
      act({ type: "INIT_VAR", name: "$loggedKeys", expr: "json:[]" }),
      act({ type: "INIT_VAR", name: "$loggedReady", expr: "" }),
      loop("$activePeriodDates", "$day", [
        // the day's watched rows, read from the Last Watched day index (feed copies would log a row twice)
        act({ type: "FIND", over: "$allOccurrences", itemVar: "$dayWatched", multiple: true, predicate: and(
          r(`fields.${lastWatchedFieldId}.value`, "SAME_DAY", "$day"),
          r("meta.feedSourceId", "IS_EMPTY"),
          or(...WATCH_TAGS.map((t) => r(`fields.${categoryFieldId}.value`, "CONTAINS", t)))) }),
        iff(and(r("$dayWatched", "IS_NOT_EMPTY")), [
          // what is already logged anywhere under the Schedule page — collected once per run
          iff(and(r("$loggedReady", "IS_EMPTY")), [
            act({ type: "FIND", over: "$allInstances", itemVar: "$logged", multiple: true, predicate: and(
              r("meta.watchFor", "IS_NOT_EMPTY"), r("_ancestors", "HAS_ANCESTOR", "$schedPageId")) }),
            loop("$logged", "$l", [act({ type: "PUSH_TO_VAR", name: "$loggedKeys", expr: "$l.meta.watchFor" })]),
            act({ type: "SET_VAR", name: "$loggedReady", value: "literal:true" }),
          ]),
          act({ type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: and(
            r("_ancestors", "HAS_ANCESTOR", "$schedPageId"), r(`fields.${scheduleFormatFieldId}.value`, "IS", "day-col"),
            r(`fields.${dateFieldId}.value`, "SAME_DAY", "$day")) }),
          iff(and(r("$dayColId", "IS_NOT_EMPTY")), [
            act({ type: "FIND", over: "$allContainers", itemIdVar: "$todoId", predicate: and(
              r("parentId", "IS", "$dayColId"), r(`fields.${timeslotFieldId}.value`, "IS", "Todo")) }),
            loop("$dayWatched", "$watch", [
              act({ type: "SET_VAR", name: "$watchAt", value: w(watchedAtFieldId) }),
              iff(and(r("$watchAt", "IS_EMPTY")), [act({ type: "SET_VAR", name: "$watchAt", value: w(lastWatchedFieldId) })]),
              act({ type: "SET_VAR", name: "$watchKey", value: "${$watch.id}@${$watchAt}" }),
              iff(and(r("$watchAt", "SAME_DAY", "$day"), r("$loggedKeys", "ARRAY_NOT_INCLUDES", "$watchKey")), [
                act({ type: "TIME_SLOT", time: "$watchAt", to: "$slotTime" }),
                act({ type: "SET_VAR", name: "$targetId", value: "$todoId" }),
                iff(and(r("$slotTime", "IS_NOT_EMPTY")), [
                  act({ type: "FIND", over: "$allContainers", itemIdVar: "$slotId", predicate: and(
                    r("parentId", "IS", "$dayColId"), r(`fields.${timeslotFieldId}.value`, "IS", "$slotTime")) }),
                  iff(and(r("$slotId", "IS_NOT_EMPTY")), [act({ type: "SET_VAR", name: "$targetId", value: "$slotId" })]),
                ]),
                iff(and(r("$targetId", "IS_NOT_EMPTY")), [
                  iff(and(r(w(categoryFieldId), "CONTAINS", "episode")),
                    [copy({ [showFieldId]: w(showFieldId), [seasonLinkFieldId]: w(seasonLinkFieldId), [episodeFieldId]: "$watch.id" })],
                    [copy({ [mediaFieldId]: 'json:["$watch.id"]' })]),
                  act({ type: "PUSH_TO_VAR", name: "$loggedKeys", expr: "$watchKey" }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ] };
}

/** Pure: the ids the pipeline needs, from the grid's records. Throws on anything missing or ambiguous. */
export function resolveIds({ grid, fields, modules, occurrences }) {
  const S = grid?.meta?.scheduleFieldIds || {};
  for (const k of ["pageOccurrenceId", "dateFieldId", "timeslotFieldId", "scheduleFormatFieldId"])
    if (!S[k]) throw new Error(`REFUSING: grid.meta.scheduleFieldIds.${k} is not set`);
  const one = (name, type) => {
    const hits = fields.filter((f) => f.name === name && f.type === type && !f.trashed);
    if (hits.length !== 1) throw new Error(`REFUSING: expected one ${type} field "${name}", found ${hits.length}`);
    return hits[0].id;
  };
  const watchMods = modules.filter((m) => m.label === "Watch" && m.role === "instance");
  if (watchMods.length !== 1) throw new Error(`REFUSING: expected one "Watch" instance module, found ${watchMods.length}`);
  const srcs = occurrences.filter((o) => o.moduleId === watchMods[0].id && !o.meta?.copyLinkSource && !o.meta?.feedSourceId);
  if (srcs.length !== 1) throw new Error(`REFUSING: expected one Routines Watch item, found ${srcs.length}`);
  return {
    ...S,
    categoryFieldId: one("Board Category", "select"), lastWatchedFieldId: one("Last Watched", "date"),
    watchedAtFieldId: one("Watched At", "text"), completedFieldId: one("Completed", "boolean"),
    mediaFieldId: one("Media", "occurrence"), showFieldId: one("TV Show", "occurrence"),
    seasonLinkFieldId: one("TV Season", "occurrence"), episodeFieldId: one("Episode", "occurrence"),
    watchSourceId: srcs[0].id,
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Module, Occurrence, Operation, Folder } = models;
  if (await Operation.findOne({ gridId, name: OP_NAME }).lean()) { log(`  op "${OP_NAME}" exists — nothing to do`); return; }
  const grid = await Grid.findById(gridId).lean();
  const [fields, modules] = await Promise.all([Field.find({ gridId }).lean(), Module.find({ gridId, label: "Watch" }).lean()]);
  const occurrences = await Occurrence.find({ gridId, moduleId: { $in: modules.map((m) => m.id) } }, { id: 1, moduleId: 1, meta: 1 }).lean();
  const ids = resolveIds({ grid, fields, modules, occurrences });
  const folder = await Folder.findOne({ gridId, name: "Library Ops" }).lean();
  log(`  Watch item ${ids.watchSourceId} · Schedule page ${ids.pageOccurrenceId} · folder ${folder?.id || "(none)"}`);
  const p = 3;
  const op = {
    id: uid(), userId: String(grid.userId), gridId, name: OP_NAME, enabled: true, priority: p, folderId: folder?.id || null,
    description: "A movie, episode or documentary you finish gets a completed Watch entry in that day's Schedule slot (0481).",
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: p },
      { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: p },
      { eventType: "onChange", subjectType: "field", targetId: ids.lastWatchedFieldId, priority: p },
      { eventType: "onChange", subjectType: "field", targetId: ids.watchedAtFieldId, priority: p },
    ],
    triggerTypes: ["onLoad", "onFilterChange", "onChange"], triggerType: "onLoad",
    pipeline: logWatchPipeline(ids),
  };
  log(`  + op "${OP_NAME}" (${op.triggerObjects.length} triggers)`);
  if (dryRun) return;
  await Operation.create(op);
  const after = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  const s = JSON.stringify(after?.pipeline || {});
  if (!after || !s.includes('"TIME_SLOT"') || !s.includes(ids.watchSourceId) || !s.includes("watchFor")) throw new Error("readback: the stored op is not the planned one");
  log(`  applied and read back: op ${after.id} — RESTART pm2.`);
}
