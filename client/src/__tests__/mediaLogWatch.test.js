// "Media: Log Watch" (migration 0481) through the REAL executor over the poms fixture. A movie / episode /
// documentary finished on a day the Schedule shows gets one completed Watch entry in that day's slot for the time
// it was finished (Watched At, read in the browser's own zone), or that day's Todo when only the date is known.
// The entry carries `meta.watchFor = "<row>@<moment>"`; a second sweep adds nothing, a new watch adds a second.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { logWatchPipeline, OP_NAME } from "../../../server/migrations/0481-media-log-watch.mjs";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
const S = fx.grid.meta.scheduleFieldIds;
const byName = (n) => fx.fields.find((f) => f.name === n)?.id;
const CAT = byName("Board Category"), LW = byName("Last Watched"), MEDIA = byName("Media"), COMPLETED = byName("Completed");
// The frozen fixture predates 0472/0473/0479: these fields are added the way those migrations made them.
const WA = "fWatchedAt", SHOW = "fTvShow", SEASON_LINK = "fTvSeason", EPISODE = "fEpisode";
const extraFields = [
  { id: WA, name: "Watched At", type: "text" }, { id: SHOW, name: "TV Show", type: "occurrence" },
  { id: SEASON_LINK, name: "TV Season", type: "occurrence" }, { id: EPISODE, name: "Episode", type: "occurrence" },
];
const modById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
const watchSource = fx.occurrences.find((o) => modById[o.moduleId]?.label === "Watch" && modById[o.moduleId]?.role === "instance" && !o.meta?.copyLinkSource);
const dayCols = fx.occurrences.filter((o) => o.parentId === S.pageOccurrenceId && o.fields?.[S.scheduleFormatFieldId]?.value === "day-col");
const day = dayCols.map((o) => o.fields?.[S.dateFieldId]?.value).sort().pop();
const dayCol = dayCols.find((o) => o.fields?.[S.dateFieldId]?.value === day);
const movie = fx.occurrences.find((o) => [].concat(o.fields?.[CAT]?.value || []).includes("movie") && !o.meta?.feedSourceId && !o.feed?.enabled);
const at = (h, m) => { const [y, mo, d] = day.split("-").map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
const dateF = Object.keys(fx.grid.activeFilterValues || {})[0];

const op = { id: "op-logwatch", name: OP_NAME, pipeline: logWatchPipeline({
  ...S, categoryFieldId: CAT, lastWatchedFieldId: LW, watchedAtFieldId: WA, completedFieldId: COMPLETED,
  mediaFieldId: MEDIA, showFieldId: SHOW, seasonLinkFieldId: SEASON_LINK, episodeFieldId: EPISODE, watchSourceId: watchSource?.id }) };

function world() {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  return occ;
}
const cell = (v) => ({ value: v, flow: "in" });
function run(occ) {
  const mods = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const page = occ[S.pageOccurrenceId];
  page.filterOverride = { ...(page.filterOverride || {}), [dateF]: day };
  const grid = { ...fx.grid, activeFilterValues: { [dateF]: day } };
  const fields = [...fx.fields, ...extraFields];
  const state = { grid, gridId: grid._id, fields, modules: Object.values(mods), occurrencesById: occ, modulesById: mods };
  const ctx = { state, fieldsById: Object.fromEntries(fields.map((f) => [f.id, f])), occurrencesById: occ, modulesById: mods, operationsById: {} };
  return executePipeline(op, ctx, null, {}).filter((e) => e._effect === "CREATE_ITEM");
}
const slotOf = (occ, label) => (occ[dayCol.id].occurrences || []).map((id) => occ[id])
  .find((s) => s?.fields?.[S.timeslotFieldId]?.value === label);

describe("Media: Log Watch", () => {
  it("the fixture has what the test needs", () => {
    expect(watchSource && dayCol && movie && CAT && LW && MEDIA && COMPLETED).toBeTruthy();
    expect(slotOf(world(), "8:00pm")).toBeTruthy();
  });

  it("a movie finished at 20:10 lands in that day's 8:00pm slot, completed, with Media = the movie", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell(day), [WA]: cell(at(20, 10)) };
    const creates = run(occ);
    expect(creates).toHaveLength(1);
    const inst = creates[0].instance;
    expect(inst.parentId).toBe(slotOf(occ, "8:00pm").id);
    expect(inst.meta).toMatchObject({ copyLinkSource: watchSource.id, watchFor: `${movie.id}@${at(20, 10)}` });
    expect(inst.linkedGroupId).toBeFalsy();
    expect(inst.identitySignature).toBe(`watch:${movie.id}@${at(20, 10)}`);
    expect(inst.fields[MEDIA].value).toEqual([movie.id]);
    expect(inst.fields[COMPLETED].value).toBe(true);
    expect(inst.fields[S.dateFieldId].value).toBe(day);
    expect(inst.fields[S.timeslotFieldId].value).toBe("8:00pm");
  });

  it("running the sweep twice leaves one entry", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell(day), [WA]: cell(at(20, 10)) };
    expect(run(occ)).toHaveLength(1);
    expect(run(occ)).toHaveLength(0);
  });

  it("watching again (a new Watched At) adds a second entry and keeps the first", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell(day), [WA]: cell(at(20, 10)) };
    expect(run(occ)).toHaveLength(1);
    occ[movie.id].fields = { ...occ[movie.id].fields, [WA]: cell(at(22, 40)) };
    const second = run(occ);
    expect(second).toHaveLength(1);
    expect(second[0].instance.parentId).toBe(slotOf(occ, "10:30pm").id);
    expect(second[0].instance.meta.watchFor).toBe(`${movie.id}@${at(22, 40)}`);
  });

  it("an episode entry carries the show, season and episode (and no Media)", () => {
    const occ = world();
    const show = { id: "show-1", moduleId: movie.moduleId, parentId: null, occurrences: [], meta: {}, fields: { [CAT]: cell(["series"]) } };
    const season = { id: "season-1", moduleId: movie.moduleId, parentId: null, occurrences: [], meta: {}, fields: { [CAT]: cell(["season"]), [SHOW]: cell("show-1") } };
    const episode = { id: "ep-1", moduleId: movie.moduleId, parentId: null, occurrences: [], meta: {},
      fields: { [CAT]: cell(["episode"]), [SHOW]: cell("show-1"), [SEASON_LINK]: cell("season-1"), [LW]: cell(day), [WA]: cell(at(9, 5)) } };
    Object.assign(occ, { [show.id]: show, [season.id]: season, [episode.id]: episode });
    const creates = run(occ);
    expect(creates).toHaveLength(1);
    const inst = creates[0].instance;
    expect(inst.parentId).toBe(slotOf(occ, "9:00am").id);
    expect(inst.fields[SHOW].value).toBe("show-1");
    expect(inst.fields[SEASON_LINK].value).toBe("season-1");
    expect(inst.fields[EPISODE].value).toBe("ep-1");
    expect(inst.fields[MEDIA]?.value ?? null).toBeNull();
  });

  it("a documentary is logged like a movie", () => {
    const occ = world();
    occ["doc-1"] = { id: "doc-1", moduleId: movie.moduleId, parentId: null, occurrences: [], meta: {},
      fields: { [CAT]: cell(["documentary"]), [LW]: cell(day), [WA]: cell(at(14, 45)) } };
    const creates = run(occ);
    expect(creates).toHaveLength(1);
    expect(creates[0].instance.parentId).toBe(slotOf(occ, "2:30pm").id);
    expect(creates[0].instance.fields[MEDIA].value).toEqual(["doc-1"]);
  });

  it("only a date (no Watched At) goes into that day's Todo", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell(day) };
    const creates = run(occ);
    expect(creates).toHaveLength(1);
    expect(creates[0].instance.parentId).toBe(slotOf(occ, "Todo").id);
    expect(creates[0].instance.meta.watchFor).toBe(`${movie.id}@${day}`);
  });

  it("a watch on a day the Schedule is not showing places nothing", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell("1999-01-01"), [WA]: cell("1999-01-01T20:10:00.000Z") };
    expect(run(occ)).toHaveLength(0);
  });

  it("a feed copy of a watched row is not logged a second time", () => {
    const occ = world();
    occ[movie.id].fields = { ...occ[movie.id].fields, [LW]: cell(day), [WA]: cell(at(20, 10)) };
    occ["copy-1"] = { ...structuredClone(occ[movie.id]), id: "copy-1", meta: { feedSourceId: movie.id } };
    expect(run(occ)).toHaveLength(1);
  });
});
