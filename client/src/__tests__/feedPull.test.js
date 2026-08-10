// A pull-only feed READS its matches and owns none of them. The tests are
// weighted to what must NOT change: an ordinary board/page feed still
// materialises, because those surfaces render children.
import { describe, it, expect, vi } from "vitest";
import { isPullOnlyFeed } from "../helpers/feedPull";

describe("isPullOnlyFeed", () => {
  it("a GRAPH is pull-only — it draws a representation, it does not own rows", () => {
    expect(isPullOnlyFeed({ meta: { graph: { type: "pie" } }, feed: { enabled: true } })).toBe(true);
  });

  it("honours an explicit feed.materialize === false on any surface", () => {
    expect(isPullOnlyFeed({ meta: {}, feed: { enabled: true, materialize: false } })).toBe(true);
  });

  it("an ORDINARY feed still materialises — the default must not move", () => {
    // A board or page renders CHILDREN; the copies are what you see and drag.
    // 156 live feed copies on poms grid depend on this staying false.
    expect(isPullOnlyFeed({ meta: {}, feed: { enabled: true } })).toBe(false);
    expect(isPullOnlyFeed({ meta: {}, feed: { enabled: true, materialize: true } })).toBe(false);
  });

  it("is null-safe and does not treat a missing feed as pull-only", () => {
    expect(isPullOnlyFeed(null)).toBe(false);
    expect(isPullOnlyFeed({})).toBe(false);
  });
});

// ── feedSync's half ─────────────────────────────────────────────────────────
const removeOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  removeOccurrence: (...a) => removeOccurrence(...a),
  createOccurrence: vi.fn(),
  updateOccurrence: vi.fn(),
}));
vi.mock("../helpers/LayoutHelpers", () => ({ copylinkInstanceToContainer: vi.fn() }));
// The matches are returned so the NORMAL path would KEEP these copies (their
// sources still match). Without that, the sweep assertion below passes for the
// wrong reason — the ordinary path sweeps unmatched copies too.
vi.mock("../state/selectors", () => ({
  resolveFeedItems: () => [
    { occurrence: { id: "src-1", moduleId: "m1" } },
    { occurrence: { id: "src-2", moduleId: "m2" } },
  ],
  getEffectiveFilterForOccurrence: () => ({}),
  getLocalFilterConditions: () => [],
  isOccurrenceVisible: () => true,
}));

const { syncFeed } = await import("../helpers/feedSync");

describe("syncFeed on a pull-only feed", () => {
  const world = (extra = {}) => {
    const graph = { id: "g1", meta: { graph: { type: "sunburst" } }, feed: { enabled: true }, occurrences: ["c1", "c2"], ...extra };
    return {
      graph,
      occurrencesById: {
        g1: graph,
        c1: { id: "c1", parentId: "g1", meta: { feedSourceId: "src-1" } },
        c2: { id: "c2", parentId: "g1", meta: { feedSourceId: "src-2" } },
        hand: { id: "hand", parentId: "g1", meta: {} },   // hand-placed, NOT a copy
      },
    };
  };
  const ctx = (occurrencesById) => ({
    state: { gridId: "g", userId: "u" }, occurrencesById, modulesById: {},
    dispatch: vi.fn(), socket: { connected: true, emit: vi.fn() },
  });

  it("mints nothing and reports why", () => {
    removeOccurrence.mockClear();
    const { graph, occurrencesById } = world();
    const r = syncFeed(graph, ctx(occurrencesById));
    expect(r.minted).toBe(0);
    expect(r.bail).toBe("pull-only");
  });

  it("SWEEPS what it materialised before, so a graph heals itself without a migration", () => {
    removeOccurrence.mockClear();
    const { graph, occurrencesById } = world();
    const r = syncFeed(graph, ctx(occurrencesById));
    expect(r.swept).toBe(2);
    expect(removeOccurrence.mock.calls.map(c => c[0].occurrenceId).sort()).toEqual(["c1", "c2"]);
  });

  it("never sweeps a HAND-PLACED child — only rows carrying feedSourceId", () => {
    // The discriminating case: `meta.feedSourceId` is the only marker that says
    // "a feed minted this". Anything else is the user's.
    removeOccurrence.mockClear();
    const { graph, occurrencesById } = world();
    syncFeed(graph, ctx(occurrencesById));
    expect(removeOccurrence.mock.calls.map(c => c[0].occurrenceId)).not.toContain("hand");
  });

  it("unlinks from the owner as it deletes — a parent listing a dead id is the dangling-ref class", () => {
    removeOccurrence.mockClear();
    const { graph, occurrencesById } = world();
    syncFeed(graph, ctx(occurrencesById));
    for (const call of removeOccurrence.mock.calls) {
      expect(call[0].parentOccurrence?.id).toBe("g1");
    }
  });

  it("a DISABLED feed is still just disabled — pull-only never overrides that", () => {
    removeOccurrence.mockClear();
    const { graph, occurrencesById } = world({ feed: { enabled: false } });
    const r = syncFeed(graph, ctx(occurrencesById));
    expect(r.bail).toBe("disabled");
    expect(removeOccurrence).not.toHaveBeenCalled();
  });
});
