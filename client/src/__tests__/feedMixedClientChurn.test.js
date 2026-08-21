// TWO CLIENTS ON DIFFERENT CODE VERSIONS FIGHT OVER ONE MATERIALIZED FEED.
//
// Recorded because it cost a revert. Widening `feed.scope` (so a multi-parented
// row is seen by every page it is on) was deployed, and the newly-matched copies
// churned on the live grid: a fresh id every pass, never settling in Mongo.
//
// The change was NOT defective. `feedSync` is idempotent — a second pass over
// its own output mints 0. What it is not is SAFE AGAINST A PEER THAT DISAGREES
// ABOUT WHAT MATCHES. Feed copies are shared, persisted state, and the sweep
// rule is "delete any copy whose source I no longer match". So a client running
// the OLD scope walk deletes exactly the copies a client running the NEW one
// just created, and the new client re-creates them. Neither is malfunctioning.
//
// Any two clients can be in this state: a browser tab left open across a deploy
// runs the old bundle, and a local dev stack points at the SAME Atlas database
// as production. Both were live while this was being measured.
//
// This test is the mechanism, not a defect in current code: it drives the real
// `syncFeed` twice with the resolver returning different match sets, which is
// what two code versions look like from the feed engine's point of view.
import { describe, it, expect, vi, beforeEach } from "vitest";

const matchesRef = { current: [] };

// The two "code versions" are the two answers this resolver gives.
vi.mock("../state/selectors", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    resolveFeedItems: () => matchesRef.current.map((o) => ({ occurrence: o, module: null })),
    // Feeds also apply the owner's date filter; keep it out of the way so this
    // test measures the scope disagreement and nothing else.
    isOccurrenceVisible: () => true,
    getEffectiveFilterForOccurrence: () => ({}),
    getLocalFilterConditions: () => [],
  };
});

const { syncFeed } = await import("../helpers/feedSync");

const SHARED = { id: "shared", moduleId: "m", role: "instance", parentId: "bucket" };
const LOCAL  = { id: "local",  moduleId: "m", role: "instance", parentId: "bucket" };

function world() {
  return {
    feed:   { id: "feed", moduleId: "fm", occurrences: [], role: "container",
              feed: { enabled: true, scope: "page", roles: ["instance"], limit: 50, conditions: [] } },
    bucket: { id: "bucket", occurrences: ["shared", "local"], role: "container" },
    shared: { ...SHARED },
    local:  { ...LOCAL },
  };
}

/** A store that applies what the helpers dispatch, so pass 2 sees pass 1. */
function makeCtx(occurrencesById) {
  const dispatch = (a = {}) => {
    const t = a.type || "";
    const p = a.payload || {};
    if (/CREATE_OCCURRENCE|ADD_OCCURRENCE/i.test(t) && p.occurrence) {
      occurrencesById[p.occurrence.id] = { ...p.occurrence };
    } else if (/UPDATE_OCCURRENCE/i.test(t) && p.occurrence?.id) {
      occurrencesById[p.occurrence.id] = { ...(occurrencesById[p.occurrence.id] || {}), ...p.occurrence };
    } else if (/REMOVE_OCCURRENCE|DELETE_OCCURRENCE/i.test(t)) {
      const id = p.occurrenceId || p.id;
      if (id) delete occurrencesById[id];
    }
  };
  return {
    state: { gridId: "g", userId: "u", grid: {} },
    occurrencesById, modulesById: { m: { id: "m", role: "instance" }, fm: { id: "fm" } },
    dispatch, socket: { emit: vi.fn(), connected: true },
  };
}

const copies = (w) => Object.values(w).filter((o) => o.meta?.feedSourceId);

describe("one client, two passes — the control", () => {
  beforeEach(() => { matchesRef.current = []; });

  it("is idempotent: pass 2 mints nothing and sweeps nothing", () => {
    const w = world();
    matchesRef.current = [w.shared, w.local];
    const a = syncFeed(w.feed, makeCtx(w));
    const idsAfterFirst = copies(w).map((c) => c.id).sort();

    const b = syncFeed(w.feed, makeCtx(w));
    expect(a.minted).toBe(2);
    expect(b).toMatchObject({ minted: 0, swept: 0 });
    // The ids are STABLE — which is what churn destroys.
    expect(copies(w).map((c) => c.id).sort()).toEqual(idsAfterFirst);
  });
});

describe("two clients that disagree about what matches", () => {
  beforeEach(() => { matchesRef.current = []; });

  it("the narrower client SWEEPS what the wider one minted", () => {
    const w = world();
    matchesRef.current = [w.shared, w.local];        // wide client
    expect(syncFeed(w.feed, makeCtx(w)).minted).toBe(2);

    matchesRef.current = [w.shared];                  // narrow client, same grid
    const narrow = syncFeed(w.feed, makeCtx(w));
    expect(narrow.swept).toBe(1);                     // `local`'s copy is deleted
    expect(copies(w)).toHaveLength(1);
  });

  it("alternating clients produce a FRESH id every pass — the observed churn", () => {
    const w = world();
    const seen = [];
    for (let i = 0; i < 3; i++) {
      matchesRef.current = [w.shared, w.local];       // wide mints
      syncFeed(w.feed, makeCtx(w));
      seen.push(copies(w).find((c) => c.meta.feedSourceId === "local").id);
      matchesRef.current = [w.shared];                // narrow sweeps
      syncFeed(w.feed, makeCtx(w));
    }
    // Three passes, three different ids, nothing ever settles.
    expect(new Set(seen).size).toBe(3);
  });

  it("the copy they AGREE on is never disturbed", () => {
    // The discriminator: churn hits only the rows the two versions disagree
    // about, which is exactly what was seen live — one stable row, two churning.
    const w = world();
    matchesRef.current = [w.shared, w.local];
    syncFeed(w.feed, makeCtx(w));
    const stable = copies(w).find((c) => c.meta.feedSourceId === "shared").id;
    matchesRef.current = [w.shared];
    syncFeed(w.feed, makeCtx(w));
    expect(copies(w).find((c) => c.meta.feedSourceId === "shared").id).toBe(stable);
  });
});
