// 0434's four operations, driven through the real executor: a button press changes what the panel it was pressed
// in shows, and sets (or lets go of) the board's filter. Nothing about music is in the engine.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { plan } from "../../../server/migrations/0434-music-drilldown.mjs";

const ALBUMS = "9u204s73cxy8", SONGS = "omK6EzlhYDoQ", ART = "8wotshpcdlog", ALB = "9i0yaflshggo";
function press(stepsName, { occurrenceId, panelViewId = "view-left" } = {}) {
  const ops = plan({ albumsField: "fA", songsField: "fS", backArtistsField: "fBA", backAlbumsField: "fBS" });
  const op = ops.find((o) => o.name === stepsName);
  const occurrencesById = {
    [ALBUMS]: { id: ALBUMS, moduleId: "m-c", fields: {}, filterOverride: { [ART]: "older" } },
    [SONGS]: { id: SONGS, moduleId: "m-c", fields: {}, filterOverride: {} },
    eminem: { id: "eminem", moduleId: "m-artist", fields: {} },
    mmlp: { id: "mmlp", moduleId: "m-album", fields: {} },
  };
  const modulesById = { "m-c": { id: "m-c", role: "container" }, "m-artist": { id: "m-artist", role: "artifact", kind: "artist" }, "m-album": { id: "m-album", role: "artifact", kind: "album" } };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: op.name, pipeline: { sources: [], steps: op.steps } }, ctx,
    { type: "ButtonOp", occurrenceId, fieldId: op.field, panelViewId, panelPageId: "here" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return {
    filter: effects.filter((e) => e._effect === "UPDATE_ITEM_FILTER_OVERRIDE").map((e) => [e.itemId, e.fieldId, e.value ?? null]),
    view: effects.filter((e) => e._effect === "UPDATE_VIEW").map((e) => [e.viewId, e.patch?.activeOccurrenceId]),
  };
}

describe("music drill-down (0434)", () => {
  it("an artist's Albums: the Albums board filtered to it, shown in the panel pressed in", () => {
    const r = press("Music: Show Albums", { occurrenceId: "eminem" });
    expect(r.filter).toEqual([[ALBUMS, ART, "eminem"]]);
    expect(r.view).toEqual([["view-left", "fikhfl7ec8p0"]]);
  });
  it("an album's Songs: the Songs board filtered to it, in that panel", () => {
    const r = press("Music: Show Songs", { occurrenceId: "mmlp", panelViewId: "view-right" });
    expect(r.filter).toEqual([[SONGS, ALB, "mmlp"]]);
    expect(r.view).toEqual([["view-right", "rWtZZdAV3dVH"]]);
  });
  it("◀ Artists lets go of the artist filter (null — every album) and shows Artists", () => {
    const r = press("Music: Back to Artists", { occurrenceId: ALBUMS });
    expect(r.filter).toEqual([[ALBUMS, ART, null]]);
    expect(r.view).toEqual([["view-left", "y9v2e9b50sf0"]]);
  });
  it("◀ Albums lets go of the album filter and shows Albums (its artist filter untouched)", () => {
    const r = press("Music: Back to Albums", { occurrenceId: SONGS });
    expect(r.filter).toEqual([[SONGS, ALB, null]]);
    expect(r.view).toEqual([["view-left", "fikhfl7ec8p0"]]);
  });
});
