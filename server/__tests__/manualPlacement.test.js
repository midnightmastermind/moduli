// server/__tests__/manualPlacement.test.js
//
// A hand-placed clip is written by the SAME writer the share rules use — a
// synthetic one-step CREATE handed to runOperationServerSide. This is the
// spec's §7 constraint expressed as a test: if a future edit starts minting
// occurrences here instead, "calls the shared executor" fails.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runs = [];
// `failNext` is how the failure case is driven. A test that cannot make the
// executor fail cannot claim the failure is reported — this repo has recorded
// three green tests that were measuring nothing.
let failNext = null;
vi.mock("../services/serverExecutor.js", () => ({
  runOperationServerSide: async (op, opts) => {
    runs.push({ op, opts });
    if (failNext) { const f = failNext; failNext = null; return f; }
    return { ok: true, effects: [{ _effect: "CREATE", occurrenceId: "new-1", status: "created" }], scope: {}, unsupported: [] };
  },
}));

const { placeManually } = await import("../services/manualPlacement.js");

const SHARE = { type: "link", label: "A Guide…", externalId: "link:https://imdb/x", props: { url: "https://imdb/x" } };
const PLACEMENT = {
  parentId: "0cti4si13ijy", role: "artifact", kind: "movie",
  bindingsLike: "m-movie-row",
  fields: { "f-year": "2006", "f-cat": "movie" },
};

beforeEach(() => { runs.length = 0; failNext = null; });

describe("placeManually", () => {
  it("calls the shared executor rather than minting anything itself", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs).toHaveLength(1);
  });

  it("builds ONE create step carrying the placement", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    const steps = runs[0].op.pipeline.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].config).toMatchObject({
      type: "CREATE",
      parentId: "0cti4si13ijy",
      role: "artifact",
      kind: "movie",
      bindingsLike: "m-movie-row",
    });
  });

  it("passes field VALUES as literals, so no $var in a clipped title is resolved", async () => {
    // A page title containing "$today" must be written verbatim.
    await placeManually({
      share: SHARE, userId: "u1", gridId: "g1",
      placement: { ...PLACEMENT, fields: { "f-title": "$today and $allItems" } },
    });
    expect(runs[0].op.pipeline.steps[0].config.fields["f-title"]).toBe("literal:$today and $allItems");
  });

  it("keeps the share's externalId, so re-clipping the same link updates one row", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].op.pipeline.steps[0].config.externalId).toBe("literal:link:https://imdb/x");
  });

  it("does not interpolate an externalId whose URL carries ${", async () => {
    await placeManually({ share: { ...SHARE, externalId: "link:https://x/?q=${$today}" }, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].op.pipeline.steps[0].config.externalId).toBe("literal:link:https://x/?q=${$today}");
  });

  it("keeps 0 and false — only empty values are dropped", async () => {
    await placeManually({ share: SHARE, userId: "u1", gridId: "g1", placement: { ...PLACEMENT, fields: { a: 0, b: false, c: "" } } });
    expect(runs[0].op.pipeline.steps[0].config.fields).toEqual({ a: "literal:0", b: "literal:false" });
  });

  it("gives $share to the executor, so a placement can still reference it", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].opts.vars.$share).toMatchObject({ type: "link" });
  });

  it("returns the runShareRules shape, halted, so /share needs no special case", async () => {
    const out = await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(out.halted).toBe(true);
    expect(out.ran).toHaveLength(1);
    expect(out.ran[0]).toMatchObject({ ruleName: "Placed by hand", ok: true });
    expect(out.ran[0].created[0]).toMatchObject({ occurrenceId: "new-1" });
  });

  it("falls back to the share's label when the placement names none", async () => {
    await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(runs[0].op.pipeline.steps[0].config.label).toBe("literal:A Guide…");
  });

  it("refuses a placement with no parent — an unplaced manual placement is a contradiction", async () => {
    await expect(placeManually({
      share: SHARE, userId: "u1", gridId: "g1",
      placement: { ...PLACEMENT, parentId: null },
    })).rejects.toThrow(/parentId/);
  });

  it("reports an executor failure rather than swallowing it", async () => {
    failNext = { ok: false, error: { message: "boom" }, effects: [], unsupported: [] };
    const out = await placeManually({ share: SHARE, placement: PLACEMENT, userId: "u1", gridId: "g1" });
    expect(out.ran[0].ok).toBe(false);
    expect(out.ran[0].error).toMatchObject({ message: "boom" });
    expect(out.ran[0].created).toEqual([]);
  });
});
