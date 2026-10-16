// @vitest-environment jsdom
// 0402: "Day Page: Readings" runs "Day Page: Add Reading" per shown day; the callee reads the day's
// passage (READ_FILE) and imports it into that day's column. Real executor, read + import mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { operationsBridge } from "../state/bindSocketToStore";
import { readingsPipeline, addReadingPipeline, readingEntry, CALLER, CALLEE, NEXT_DAY_MARKER, dayMarker } from "../../../server/migrations/0402-day-page-readings.mjs";
import { rewriteMarkers } from "../../../server/migrations/0404-day-page-reading-markers.mjs";
import { slicePassage } from "../helpers/bookText";

const BOARD = "board1";
const DATE = "fDate";
const reading = readingEntry({ title: "Morning Words", fileRef: "gdrive:c:book", kind: "pdf" });

function world({ marked = false, have = false } = {}) {
  const occurrencesById = {
    [BOARD]: { id: BOARD, moduleId: "mBoard", occurrences: ["col15", "col16"] },
    col15: { id: "col15", moduleId: "mCol", parentId: BOARD, fields: { [DATE]: { value: "2026-10-15" } }, meta: marked ? { readings: { [reading.key]: "2026-10-15" } } : {}, occurrences: have ? ["r1"] : [] },
    col16: { id: "col16", moduleId: "mCol", parentId: BOARD, fields: { [DATE]: { value: "2026-10-16" } }, meta: {}, occurrences: [] },
    ...(have ? { r1: { id: "r1", moduleId: "mR", parentId: "col15" } } : {}),
  };
  const modulesById = { mBoard: { id: "mBoard", role: "page" }, mCol: { id: "mCol", role: "container", kind: "doc" }, mR: { id: "mR", role: "container", kind: "doc", label: "Morning Words" } };
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
      ["col15", "Morning Words", `${dayMarker("October 15")} passage`, "magic", true],
      ["col16", "Morning Words", `${dayMarker("October 16")} passage`, "magic", true],
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
});
