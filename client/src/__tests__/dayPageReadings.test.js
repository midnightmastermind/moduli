// @vitest-environment jsdom
// 0402: "Day Page: Readings" runs "Day Page: Add Reading" per shown day; the callee reads the day's
// passage (READ_FILE) and imports it into that day's column. Real executor, read + import mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { operationsBridge } from "../state/bindSocketToStore";
import { readingsPipeline, addReadingPipeline, readingEntry, CALLER, CALLEE, NEXT_DAY_MARKER } from "../../../server/migrations/0402-day-page-readings.mjs";

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
      ["/files/c/book", "pdf", "/^October 15\\b/im", NEXT_DAY_MARKER],
      ["/files/c/book", "pdf", "/^October 16\\b/im", NEXT_DAY_MARKER],
    ]);
    expect(imports.map((r) => [r.parentId, r.title, r.content, r.shape, r.embed])).toEqual([
      ["col15", "Morning Words", "/^October 15\\b/im passage", "magic", true],
      ["col16", "Morning Words", "/^October 16\\b/im passage", "magic", true],
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
});
