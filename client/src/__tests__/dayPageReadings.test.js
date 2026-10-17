// @vitest-environment jsdom
// 0402: "Day Page: Readings" runs "Day Page: Add Reading" per shown day; the callee reads the day's
// passage (READ_FILE) and imports it into that day's column. Real executor, read + import mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { operationsBridge } from "../state/bindSocketToStore";
import { readingsPipeline, addReadingPipeline, readingEntry, CALLER, CALLEE, NEXT_DAY_MARKER, dayMarker } from "../../../server/migrations/0402-day-page-readings.mjs";
import { rewriteMarkers } from "../../../server/migrations/0404-day-page-reading-markers.mjs";
import { slicePassage } from "../helpers/bookText";
import { evalRule } from "../helpers/operationActions";
import { withReflectionsSection } from "../../../server/migrations/0413-day-page-reflections.mjs";

const BOARD = "board1";
const DATE = "fDate";
const reading = readingEntry({ title: "Morning Words", fileRef: "gdrive:c:book", kind: "pdf" });

function world({ marked = false, have = false, legacy = false, noRefl = false, markAt = new Date().toISOString() } = {}) {
  const refl = (id, col, kids = []) => noRefl ? {} : { [id]: { id, moduleId: "mRefl", parentId: col, identitySignature: "daypage:reflections", occurrences: kids, textmap: { type: "doc", content: [] } } };
  const occurrencesById = {
    [BOARD]: { id: BOARD, moduleId: "mBoard", occurrences: ["col15", "col16"] },
    col15: { id: "col15", moduleId: "mCol", parentId: BOARD, fields: { [DATE]: { value: "2026-10-15" } }, meta: (marked || legacy) ? { readings: { [reading.key]: markAt } } : {},
      occurrences: [...(noRefl ? [] : ["refl15"]), ...(legacy ? ["r0"] : [])],
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "refl15" } }, ...(legacy ? [{ type: "moduleEmbed", attrs: { occurrenceId: "r0" } }] : [])] } },
    col16: { id: "col16", moduleId: "mCol", parentId: BOARD, fields: { [DATE]: { value: "2026-10-16" } }, meta: {}, occurrences: noRefl ? [] : ["refl16"] },
    ...refl("refl15", "col15", have ? ["r1"] : []),
    ...refl("refl16", "col16"),
    ...(have ? { r1: { id: "r1", moduleId: "mR", parentId: "refl15" } } : {}),
    ...(legacy ? { r0: { id: "r0", moduleId: "mR", parentId: "col15" } } : {}),
  };
  const modulesById = { mBoard: { id: "mBoard", role: "page" }, mCol: { id: "mCol", role: "container", kind: "doc" }, mRefl: { id: "mRefl", role: "container", kind: "doc", label: "Reflections" }, mR: { id: "mR", role: "container", kind: "doc", label: "Morning Words" } };
  const callee = { id: "opCallee", name: CALLEE, enabled: true, pipeline: addReadingPipeline({ boardOccurrenceId: BOARD, dateFieldId: DATE }) };
  const caller = { id: "opCaller", name: CALLER, enabled: true, pipeline: readingsPipeline({ readings: [reading] }) };
  return { caller, callee, ctx: { state: { modules: Object.values(modulesById) }, fieldsById: {}, occurrencesById, modulesById, operationsById: { opCallee: callee, opCaller: caller } } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Day Page: Readings (0402)", () => {
  let reads, imports, applied;
  beforeEach(() => {
    reads = []; imports = []; applied = [];
    operationsBridge.readFileText = vi.fn(async (req) => { reads.push(req); return { text: `${req.from} passage`, found: true }; });
    operationsBridge.importText = vi.fn(async (req) => { imports.push(req); return { rootOccurrenceId: "new", stats: {} }; });
    operationsBridge.applyEffect = (e) => applied.push(e);
  });

  it("reads each shown day's passage and imports it into that day's column", async () => {
    const { caller, ctx } = world();
    const pre = executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15", "2026-10-16"], $activePeriodCount: 2 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads.map((r) => [r.src, r.kind, r.from, r.to])).toEqual([
      ["/files/c/book", "pdf", dayMarker("October 15"), NEXT_DAY_MARKER],
      ["/files/c/book", "pdf", dayMarker("October 16"), NEXT_DAY_MARKER],
    ]);
    expect(imports.map((r) => [r.parentId, r.title, r.content, r.shape, r.embed])).toEqual([
      ["refl15", "Morning Words", `# Morning Words\n\n${dayMarker("October 15")} passage`, "magic", true],
      ["refl16", "Morning Words", `# Morning Words\n\n${dayMarker("October 16")} passage`, "magic", true],
    ]);
    // The mark goes out BEFORE the wait, so a second run on the same load imports nothing.
    const marks = pre.filter((e) => JSON.stringify(e).includes(`readings`));
    expect(marks.length).toBe(2);
  });

  it.each([["marked", { marked: true }], ["holding it", { have: true }]])("a day already %s reads nothing", async (_n, opts) => {
    for (const w of [world(opts)]) {
      reads = []; imports = [];
      executePipeline(w.caller, w.ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
      for (let i = 0; i < 6; i++) await flush();
      expect(reads).toEqual([]);
      expect(imports).toEqual([]);
    }
  });

  it("a passage it cannot find takes the day's mark back off, so the next load tries again", async () => {
    operationsBridge.readFileText = vi.fn(async (req) => { reads.push(req); return { text: "", found: false }; });
    const { caller, ctx } = world();
    const pre = executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads.length).toBe(1);
    expect(imports).toEqual([]);
    const marks = [...pre, ...applied].filter((e) => JSON.stringify(e).includes("readings"));
    // marked before the wait, cleared after it
    expect(marks.length).toBe(2);
    expect(JSON.stringify(marks[1])).not.toContain("2026-10-15");
  });

  it("a failed import takes the mark back off too", async () => {
    operationsBridge.importText = vi.fn(async () => { throw new Error("server down"); });
    const { caller, ctx } = world();
    const pre = executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    const marks = [...pre, ...applied].filter((e) => JSON.stringify(e).includes("readings"));
    expect(marks.length).toBe(2);
  });

  it("a successful read keeps the mark", async () => {
    const { caller, ctx } = world();
    const pre = executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    const marks = [...pre, ...applied].filter((e) => JSON.stringify(e).includes("readings"));
    expect(marks.length).toBe(1);
  });

  it("a day with no column reads nothing", async () => {
    const { caller, ctx } = world();
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-20"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads).toEqual([]);
  });

  it("more than 7 days shown does nothing", async () => {
    const { caller, ctx } = world();
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 14 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads).toEqual([]);
  });

  it("a day's marker finds a heading with an ordinal, and stops at the next day", () => {
    const book = "Intro mentions october 150 things.\n\n### October 15th THE DAY TITLE\n\nText.\n\n### October 16th NEXT\n\nMore.";
    const r = slicePassage(book, { from: dayMarker("October 15"), to: NEXT_DAY_MARKER });
    expect(r.found).toBe(true);
    expect(r.text).toBe("### October 15th THE DAY TITLE\n\nText.");
    // still the plain upper-case line Daily Reflections uses, and never day 1 inside day 15
    expect(slicePassage("OCTOBER 15\nA\nOCTOBER 16\nB", { from: dayMarker("October 15"), to: NEXT_DAY_MARKER }).text).toBe("OCTOBER 15\nA");
    expect(slicePassage("October 15\nA", { from: dayMarker("October 1"), to: NEXT_DAY_MARKER }).found).toBe(false);
  });

  it("0404 rewrites an old caller's markers once", () => {
    const steps = JSON.parse(JSON.stringify(readingsPipeline({ readings: [reading] }).steps));
    const call = JSON.stringify(steps).includes(CALLEE) && steps[1].then[0].body[1].body[0];
    call.config.vars.$from = "/^${$md}\\b/im";
    expect(rewriteMarkers(steps)).toBe(1);
    expect(call.config.vars.$from).toBe(dayMarker("${$md}"));
    expect(rewriteMarkers(steps)).toBe(0);
  });

  it("an empty passage imports nothing — no title-only page", async () => {
    operationsBridge.readFileText = vi.fn(async (req) => { reads.push(req); return { text: "", found: true }; });
    const { caller, ctx } = world();
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads.length).toBe(1);
    expect(imports).toEqual([]);
  });
  it("an old mark with nothing in the section is tried again (a load that ended mid-read)", async () => {
    const { caller, ctx } = world({ marked: true, markAt: "2026-10-15" });
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads.length).toBe(1);
    expect(imports.map((r) => r.parentId)).toEqual(["refl15"]);
  });

  it("an old mark with the reading already there reads nothing", async () => {
    const { caller, ctx } = world({ marked: true, have: true, markAt: "2026-10-15" });
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads).toEqual([]);
  });

  it("OLDER_THAN_MINUTES: a date-time more than N minutes ago", () => {
    const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
    expect(evalRule({ left: "$a", comparator: "OLDER_THAN_MINUTES", right: 10 }, { $a: ago(11) })).toBe(true);
    expect(evalRule({ left: "$a", comparator: "OLDER_THAN_MINUTES", right: 10 }, { $a: ago(2) })).toBe(false);
    expect(evalRule({ left: "$a", comparator: "OLDER_THAN_MINUTES", right: 10 }, { $a: "2020-01-01" })).toBe(true);
    expect(evalRule({ left: "$a", comparator: "OLDER_THAN_MINUTES", right: 10 }, { $a: "" })).toBe(false);
    expect(evalRule({ left: "$a", comparator: "OLDER_THAN_MINUTES", right: 10 }, { $a: "nope" })).toBe(false);
  });

  it("a column with no Reflections section yet reads nothing (Build Day makes it first)", async () => {
    const { caller, ctx } = world({ noRefl: true });
    executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads).toEqual([]);
  });

  it("a reading imported straight into the column moves into the section, without a new read", async () => {
    const { caller, ctx } = world({ legacy: true });
    const pre = executePipeline(caller, ctx, null, { $activePeriodDates: ["2026-10-15"], $activePeriodCount: 1 });
    for (let i = 0; i < 6; i++) await flush();
    expect(reads).toEqual([]);
    expect(imports).toEqual([]);
    const all = [...pre, ...applied];
    expect(all).toContainEqual(expect.objectContaining({ _effect: "MOVE_OCCURRENCE", occurrenceId: "r0", toContainerId: "refl15" }));
    const texts = all.filter((e) => e._effect === "UPDATE_ITEM_TEXTMAP");
    const reflText = texts.find((e) => e.itemId === "refl15")?.textmap;
    const colText = texts.find((e) => e.itemId === "col15")?.textmap;
    expect(reflText.content.map((n) => n.attrs.occurrenceId)).toEqual(["r0"]);
    expect(colText.content.map((n) => n.attrs.occurrenceId)).toEqual(["refl15"]);
  });
});

describe("Day Page: Build Day keeps a Reflections section last (0413)", () => {
  const buildDay = () => [{ id: "s1", type: "if", condition: { operator: "AND", rules: [{ id: "x", left: "$day", comparator: "IS_NOT_EMPTY", right: "" }] }, else: [], then: [
    { id: "f", type: "action", config: { type: "FIND", over: "$allOccurrences", predicate: { operator: "AND", rules: [{ id: "y", left: "parentId", comparator: "IS", right: BOARD }, { id: "z", left: `fields.${DATE}.value`, comparator: "SAME_DAY", right: "$day" }] }, itemIdVar: "$colId", itemVar: "$col" } },
    { id: "b", type: "action", config: { type: "INIT_VAR", name: "$body", expr: "json:[]" } },
    { id: "l", type: "loop", overExpr: "$col.occurrences", as: "$kidId2", body: [
      { id: "k", type: "action", config: { type: "INIT_VAR", name: "$kid2", expr: "$allItemsById.${$kidId2}" } },
      { id: "i", type: "if", condition: { operator: "AND", rules: [{ id: "w", left: "$kid2.role", comparator: "IS_NOT", right: "textblock" }] }, else: [], then: [
        { id: "p", type: "action", config: { type: "PUSH_TO_ARRAY", name: "$body", value: { type: "moduleEmbed", attrs: { occurrenceId: "$kidId2" } } } },
      ] },
    ] },
    { id: "u", type: "action", config: { type: "UPDATE", path: "$col.textmap", value: { type: "doc", content: "$body" } } },
  ] }];
  const run = (occurrencesById) => {
    const modulesById = { mCol: { id: "mCol", role: "container", kind: "doc" }, mRefl: { id: "mRefl", role: "container", kind: "doc", label: "Reflections" }, mX: { id: "mX", role: "container", kind: "doc", label: "Check In" } };
    const op = { id: "bd", name: "Day Page: Build Day", enabled: true, pipeline: { sources: [], steps: withReflectionsSection(buildDay()) } };
    return executePipeline(op, { state: { modules: Object.values(modulesById) }, fieldsById: {}, occurrencesById, modulesById, operationsById: { bd: op } }, null, { $day: "2026-10-15" });
  };
  const col = (kids) => ({ [BOARD]: { id: BOARD, moduleId: "mB", occurrences: ["col15"] }, col15: { id: "col15", moduleId: "mCol", parentId: BOARD, fields: { [DATE]: { value: "2026-10-15" } }, occurrences: kids } });

  it("creates the section when the column has none, and embeds it last", () => {
    const fx = run({ ...col(["x1"]), x1: { id: "x1", moduleId: "mX", parentId: "col15" } });
    const made = fx.find((e) => e._effect === "CREATE_ITEM");
    expect(made.instance).toMatchObject({ parentId: "col15", identitySignature: "daypage:reflections" });
    const text = fx.find((e) => e._effect === "UPDATE_ITEM_TEXTMAP").textmap.content.map((n) => n.attrs.occurrenceId);
    expect(text).toEqual(["x1", made.instance.id]);
  });

  it("keeps an existing section last even when something was listed after it, and makes no second one", () => {
    const fx = run({ ...col(["refl15", "x1"]), x1: { id: "x1", moduleId: "mX", parentId: "col15" },
      refl15: { id: "refl15", moduleId: "mRefl", parentId: "col15", identitySignature: "daypage:reflections", occurrences: [] } });
    expect(fx.filter((e) => e._effect === "CREATE_ITEM")).toEqual([]);
    expect(fx.find((e) => e._effect === "UPDATE_ITEM_TEXTMAP").textmap.content.map((n) => n.attrs.occurrenceId)).toEqual(["x1", "refl15"]);
  });

  it("patches once", () => {
    const once = withReflectionsSection(buildDay());
    expect(withReflectionsSection(once)).toBe(null);
  });
});
