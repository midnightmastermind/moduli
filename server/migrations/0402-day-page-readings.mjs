// server/migrations/0402-day-page-readings.mjs
//
// User 2026-10-15: "i want to be able to add daily reflections and other day to day reflection books to
// the daypage for that day". Built from the operations the app already has — READ_FILE (a pdf / e-book's
// text, cut from one marker to the next) and IMPORT_MARKDOWN (laid out like Magic, embedded in the day
// column) — so it is editable in the operations editor and nothing in the app knows what a reading is.
//
//   "Day Page: Readings"     (caller)  per shown day (7 or fewer) × per entry of its $readings list,
//                                       runs the callee with that day's "Month d" as the start marker.
//   "Day Page: Add Reading"  (callee)  finds the day column, skips when the column already holds the
//                                       reading (by title) or already started it (meta.readings.<key>),
//                                       marks it, READ_FILEs the passage, imports it into the column.
//
// WHY A CALLEE: an action that waits (READ_FILE, IMPORT_*) only works at the TOP LEVEL of a pipeline —
// a wait inside a LOOP or an IF is dropped (operationExecutor, the suspend sentinel). A callee's own
// top level waits on its own, so each day's read runs and resumes independently. The callee's steps
// therefore never branch around the waits: an empty file reference reads nothing (found:false, no
// wait) and an empty passage imports nothing.
//
// WHY A FILE REFERENCE, not the book's row: a book row (and its file) arrive in the deferred half of a
// load, after the load-time operations run, so a row id finds nothing on load. READ_FILE takes the
// file's reference ("gdrive:…") with a kind.
//
// The mark is written BEFORE the wait, so the onLoad run and the filter-bootstrap run that follow each
// other on a load do not both import the same day.
//
// Run with READING_FILE_OCC=<the book file's occurrence id> (the title is read from the file, so no
// book title is written into git). Re-running adds another book to $readings.

export const id = "0402-day-page-readings";
export const describe = "Day page readings: a passage from a daily-reading book, imported into each shown day.";
export const touches = ["operations"];

export const CALLER = "Day Page: Readings";
export const CALLEE = "Day Page: Add Reading";
export const BUILD_OP = "Day Page: Build";
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
// A day starts a line ("OCTOBER 15", "October 15th"), maybe as a heading ("### October 15th…"). The day
// number must not run on into more digits, and nothing is required after it: an e-book heading can glue
// the day's title straight on ("October 15thTHE DAY TITLE…"), so a trailing \\b would miss it.
export const DAY_LINE_PREFIX = "^(?:#+\\s*)?";
export const NEXT_DAY_MARKER = `/${DAY_LINE_PREFIX}(${MONTHS}) \\d+(?!\\d)/im`;
/** The `from` marker for one day, given its "Month d" text (an expression the caller interpolates). */
export const dayMarker = (md) => `/${DAY_LINE_PREFIX}${md}(?!\\d)/im`;

const uid = () => globalThis.crypto.randomUUID();
const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const all = (...rules) => ({ id: uid(), operator: "AND", rules });
const act = (config) => ({ id: uid(), type: "action", config });
const iff = (condition, then, els = []) => ({ id: uid(), type: "if", condition, then, else: els });
const loop = (overExpr, as, body) => ({ id: uid(), type: "loop", overExpr, as, body });

/** A $readings entry. `key` names the column's mark; letters and digits only. */
export function readingEntry({ title, fileRef, kind }) {
  const key = String(title).replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "reading";
  return { key, title: String(title), file: String(fileRef), kind: kind === "ebook" ? "ebook" : "pdf" };
}

/**
 * PURE. Start markers for a book whose chapters are headed by their bare number and open on
 * "1 . " (its first verse): one /regex/ per chapter 1..count. Scanned books read a 1 as "l" or
 * "I" and split digits ("1 0"), so each digit tolerates that.
 */
export function chapterMarkers(count) {
  const out = [];
  for (let n = 1; n <= count; n++) {
    const num = String(n).split("").map((d) => (d === "1" ? "[1lI]" : d)).join(" ?");
    out.push(`/(?<![0-9A-Za-z])${num}\\s*\\n\\n1 \\.\\s/`);
  }
  return out;
}

/** PURE. The caller: every shown day × every reading → the callee. */
/** The INIT_VAR steps of `buildSteps` that a gate condition reads ($board for "came from the Day Page"). Pure. */
export function gateInits(buildSteps, gateCondition) {
  const json = JSON.stringify(gateCondition || {});
  return (buildSteps || []).filter((st) => st?.config?.type === "INIT_VAR" && st.config.name
    && new RegExp(`\\${st.config.name}(?![A-Za-z0-9_])`).test(json));
}

export function readingsPipeline({ readings, gateCondition = null, gateVars = [] }) {
  const body = [
    iff(all(r("$activePeriodCount", "LESS_OR_EQUAL", 7)), [
      loop("$activePeriodDates", "$day", [
        act({ type: "DATE_FORMAT", date: "$day", format: "MMMM d", to: "$md" }),
        loop("$readings", "$rd", [
          // A book read in turn (a chapter a day) carries `cycle`: one start marker per chapter, and
          // `to`. The day of the year picks one: (day - 1) % chapters. Any other book is dated.
          iff(all(r("$rd.cycle", "IS_NOT_EMPTY")), [
            act({ type: "INIT_VAR", name: "$cycle", expr: "$rd.cycle" }),
            act({ type: "ARRAY_LENGTH", name: "$cycle", to: "$cycleLen" }),
            act({ type: "DATE_FORMAT", date: "$day", format: "D", to: "$cycleAt" }),
            act({ type: "DECREMENT_VAR", name: "$cycleAt", by: "1" }),
            act({ type: "MOD_VAR", name: "$cycleAt", by: "$cycleLen" }),
            act({ type: "RUN_OPERATION", operationName: CALLEE, vars: {
              $day: "$day", $key: "$rd.key", $title: "$rd.title", $file: "$rd.file", $kind: "$rd.kind",
              $from: "$cycle.${$cycleAt}", $to: "$rd.to",
            } }),
          ], [
            act({ type: "RUN_OPERATION", operationName: CALLEE, vars: {
              $day: "$day", $key: "$rd.key", $title: "$rd.title", $file: "$rd.file", $kind: "$rd.kind",
              $from: dayMarker("${$md}"), $to: `literal:${NEXT_DAY_MARKER}`,
            } }),
          ]),
        ]),
      ]),
    ]),
  ];
  return {
    sources: [],
    steps: [
      act({ type: "INIT_VAR", name: "$readings", expr: `json:${JSON.stringify(readings)}` }),
      // The gate was copied from Day Page: Build, and so must the variables it reads: without $board the
      // "came from the Day Page" arm compared against nothing, so the Day Page's own date arrows imported no
      // reading (2026-10-26, fixed on poms by 0440).
      ...gateVars.map((st) => act({ ...st.config })),
      ...(gateCondition ? [iff(gateCondition, body)] : body),
    ],
  };
}

/** The identity of a day column's Reflections section (made by "Day Page: Build Day", 0413). */
export const REFLECTIONS_SIG = "daypage:reflections";

/** PURE. The callee. Top level only around the two waits (see the header).
 *  Each book's page goes into the day column's Reflections section (0413). A reading imported before
 *  that (straight into the column) is moved into the section the first time the day is seen again. */
export function addReadingPipeline({ boardOccurrenceId, dateFieldId }) {
  return {
    sources: [],
    steps: [
      act({ type: "FIND", over: "$allOccurrences", predicate: all(r("parentId", "IS", boardOccurrenceId), r(`fields.${dateFieldId}.value`, "SAME_DAY", "$day")),
        itemIdVar: "$colId", itemVar: "$col" }),
      act({ type: "FIND", over: "$allOccurrences", predicate: all(r("parentId", "IS", "$colId"), r("identitySignature", "IS", REFLECTIONS_SIG)),
        itemIdVar: "$reflId", itemVar: "$refl" }),
      act({ type: "FIND", over: "$allOccurrences", predicate: all(r("parentId", "IS", "$reflId"), r("label", "IS", "$title")),
        itemIdVar: "$haveId", itemVar: "$have" }),
      act({ type: "FIND", over: "$allOccurrences", predicate: all(r("parentId", "IS", "$colId"), r("label", "IS", "$title")),
        itemIdVar: "$oldId", itemVar: "$old" }),
      // A reading that sits straight in the column (imported before the section existed) moves into it:
      // listed there, embedded at the end of its text, and dropped from the column's text.
      iff(all(r("$reflId", "IS_NOT_EMPTY"), r("$haveId", "IS_EMPTY"), r("$oldId", "IS_NOT_EMPTY")), [
        act({ type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$oldId", toContainerIdExpr: "$reflId" }),
        act({ type: "INIT_VAR", name: "$reflBody", expr: "$refl.textmap.content" }),
        act({ type: "PUSH_TO_ARRAY", name: "$reflBody", value: { type: "moduleEmbed", attrs: { occurrenceId: "$oldId" } } }),
        act({ type: "UPDATE", path: "$refl.textmap", value: { type: "doc", content: "$reflBody" } }),
        act({ type: "INIT_VAR", name: "$colBody", expr: "json:[]" }),
        loop("$col.textmap.content", "$node", [
          iff(all(r("$node.attrs.occurrenceId", "IS_NOT", "$oldId")), [
            act({ type: "PUSH_TO_ARRAY", name: "$colBody", value: "$node" }),
          ]),
        ]),
        act({ type: "UPDATE", path: "$col.textmap", value: { type: "doc", content: "$colBody" } }),
        act({ type: "SET_VAR", name: "$haveId", expr: "$oldId" }),
      ]),
      act({ type: "INIT_VAR", name: "$readRef", expr: "literal:" }),
      // The mark keeps the two runs of one load (onLoad, then the filter bootstrap) from both importing.
      // It holds WHEN it was written: a load that ends while the file is still being read never clears
      // it, and with nothing in the section that day would be skipped forever — so an old mark (10 min)
      // with no reading behind it is tried again. A mark from before this holds a bare date: old.
      iff(all(r("$colId", "IS_NOT_EMPTY"), r("$reflId", "IS_NOT_EMPTY"), r("$haveId", "IS_EMPTY"), {
        id: uid(), operator: "OR",
        rules: [r("$col.meta.readings.${$key}", "IS_EMPTY"), r("$col.meta.readings.${$key}", "OLDER_THAN_MINUTES", 10)],
      }), [
        act({ type: "UPDATE", path: "$col.meta.readings.${$key}", value: "$now" }),
        act({ type: "SET_VAR", name: "$readRef", expr: "$file" }),
      ]),
      act({ type: "READ_FILE", file: "$readRef", kind: "$kind", from: "$from", to: "$to", resultVar: "$fileText" }),
      // The passage goes in under the book's title as its top heading: the importer names the page after a
      // leading heading and ignores `title` then, so an e-book passage starting "### October 15th…" was
      // named after the day. No passage → no markdown → nothing imported (an IF cannot hold the wait).
      act({ type: "INIT_VAR", name: "$importMd", expr: "literal:" }),
      iff(all(r("$fileText.text", "IS_NOT_EMPTY")), [
        act({ type: "SET_VAR", name: "$importMd", expr: "# ${$title}\n\n${$fileText.text}" }),
      ]),
      act({ type: "IMPORT_MARKDOWN", markdown: "$importMd", parentExpr: "$reflId", title: "$title", shape: "magic", embed: true,
        resultVar: "$importResult", onError: "continue" }),
      // A read that found no passage, or an import that failed, takes the mark back off so the next
      // load tries again (the mark went on before the wait). Only when THIS run marked the day.
      iff(all(r("$readRef", "IS_NOT_EMPTY"), {
        id: uid(), operator: "OR",
        rules: [r("$fileText.found", "IS", "false"), r("$importError", "IS_NOT_EMPTY")],
      }), [
        act({ type: "UPDATE", path: "$col.meta.readings.${$key}", value: "literal:" }),
      ]),
    ],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Occurrence, Module, Operation } = models;
  const grid = await Grid.findById(gridId).lean();
  const build = await Operation.findOne({ gridId, name: BUILD_OP }).lean();
  if (!build) throw new Error(`0402: no "${BUILD_OP}" on this grid`);
  const buildDay = await Operation.findOne({ gridId, name: "Day Page: Build Day" }).lean();
  const colFind = JSON.stringify(buildDay?.pipeline?.steps || []).match(/"left":"parentId","comparator":"IS","right":"([^"]+)"\},\{"id":"[^"]+","left":"fields\.([^".]+)\.value","comparator":"SAME_DAY","right":"\$day"/);
  if (!colFind) throw new Error("0402: could not read the day board / date field from \"Day Page: Build Day\"");
  const [, boardOccurrenceId, dateFieldId] = colFind;

  const fileOccId = process.env.READING_FILE_OCC;
  let reading = null;
  if (fileOccId) {
    const occ = await Occurrence.findOne({ id: fileOccId, gridId }).lean();
    const mod = occ && await Module.findOne({ id: occ.moduleId }).lean();
    if (!mod?.fileRef || (mod.kind !== "pdf" && mod.kind !== "ebook")) throw new Error(`0402: ${fileOccId} is not a pdf / e-book file`);
    const title = String(occ.label || mod.label || "Reading").replace(/\.(pdf|epub|mobi|azw3?)$/i, "").trim();
    reading = readingEntry({ title, fileRef: mod.fileRef, kind: mod.kind });
  }

  const common = { userId: String(grid.userId), gridId, enabled: true, folderId: build.folderId || null };
  if (!(await Operation.findOne({ gridId, name: CALLEE }).lean())) {
    log(`+ op ${CALLEE} (board ${boardOccurrenceId}, date ${dateFieldId})`);
    if (!dryRun) await Operation.create({ ...common, id: uid(), name: CALLEE, priority: 6,
      description: "Imports one reading's passage for one day into that day's column. Run by \"Day Page: Readings\".",
      triggerObjects: [], triggerTypes: [], triggerType: "manual",
      pipeline: addReadingPipeline({ boardOccurrenceId, dateFieldId }) });
  } else log(`op ${CALLEE} exists`);

  const caller = await Operation.findOne({ gridId, name: CALLER }).lean();
  if (caller) {
    if (!reading) { log(`op ${CALLER} exists`); return; }
    const init = caller.pipeline.steps[0]?.config;
    const list = JSON.parse(String(init?.expr || "json:[]").slice(5));
    if (list.some((x) => x.file === reading.file)) { log(`${reading.title} is already a reading`); return; }
    list.push(reading);
    log(`+ reading ${reading.title}`);
    if (!dryRun) await Operation.updateOne({ id: caller.id }, { $set: { "pipeline.steps.0.config.expr": `json:${JSON.stringify(list)}` } });
    return;
  }
  const gate = build.pipeline.steps.find((s) => s.type === "if")?.condition || null;
  log(`+ op ${CALLER}${reading ? ` with ${reading.title}` : " (no readings yet)"}`);
  // The Day Page the build is for: $activePeriodDates reads the dates of this page, not the toolbar's (0444).
  if (!dryRun) await Operation.create({ ...common, id: uid(), name: CALLER, priority: 6, targetOccurrenceId: build.targetOccurrenceId || null,
    description: "Imports each shown day's passage of every reading in $readings into that day's Day Page column.",
    triggerObjects: (build.triggerObjects || []).map((t) => ({ ...t, priority: 6 })),
    triggerTypes: build.triggerTypes || ["onLoad", "onFilterChange"], triggerType: "onLoad",
    pipeline: readingsPipeline({ readings: reading ? [reading] : [], gateCondition: gate, gateVars: gateInits(build.pipeline.steps, gate) }) });
  log("done. Restart the server (pm2).");
}
