// __tests__/completedPageMove.test.js
//
// Moving the Completed container off the Tasks page is a re-parent of a FEED
// container, and the sharp edge is that a feed's SCOPE and its container's
// PARENT are different things. Re-pointing the scope at the new page would
// leave the feed looking at a page holding only its own copies — which
// `resolveFeedItems` skips — so it would resolve to zero and sweep all of them.
// These tests are about the move happening and the scope NOT.
import { describe, it, expect } from "vitest";
import { planMove } from "../migrations/0335-completed-gets-its-own-page.mjs";

const TASKS_PAGE = "9zU5UYHq5FMn";
const COMPLETED = "c54c2971-31f7-4ba9-b648-a64c79f2149d";

const tasksPage = (over = {}) => ({
  id: TASKS_PAGE, parentId: "HN6TJ5MlVux6", sortOrder: 1,
  occurrences: ["a", "b", COMPLETED], ...over,
});
const completed = (over = {}) => ({
  id: COMPLETED, parentId: TASKS_PAGE,
  feed: { enabled: true, scope: TASKS_PAGE, roles: ["instance"] },
  occurrences: ["copy1", "copy2"], ...over,
});

describe("planMove", () => {
  it("plans the move and keeps the new page in the Tasks FOLDER", () => {
    const plan = planMove({ tasksPage: tasksPage(), completed: completed(), existingPage: null });
    expect(plan.folderId).toBe("HN6TJ5MlVux6");
    expect(plan.unlistFrom).toBe(TASKS_PAGE);
    expect(plan.reuseExistingPage).toBe(null);
  });

  it("sorts the new page right after Tasks", () => {
    expect(planMove({ tasksPage: tasksPage({ sortOrder: 4 }), completed: completed(), existingPage: null }).sortOrder).toBe(5);
  });

  // THE LOAD-BEARING REFUSAL. If the scope is not the Tasks page, the feed has
  // been re-pointed since this was measured and the migration's reasoning no
  // longer describes it — so it refuses rather than moving a container whose
  // feed might empty itself.
  it("REFUSES when the feed scope is not the Tasks page", () => {
    const c = completed({ feed: { enabled: true, scope: "some-other-page" } });
    expect(() => planMove({ tasksPage: tasksPage(), completed: c, existingPage: null })).toThrow(/scope/);
  });

  it("refuses when the feed is missing entirely", () => {
    const c = completed({ feed: null });
    expect(() => planMove({ tasksPage: tasksPage(), completed: c, existingPage: null })).toThrow(/scope/);
  });

  it("refuses when either end is missing", () => {
    expect(() => planMove({ tasksPage: null, completed: completed(), existingPage: null })).toThrow(/Tasks page/);
    expect(() => planMove({ tasksPage: tasksPage(), completed: null, existingPage: null })).toThrow(/Completed/);
  });

  // IDEMPOTENCY: a re-run must not mint a SECOND page. The converged state is
  // "the container already lives on the existing Completed page".
  it("is a no-op once the container lives on the Completed page", () => {
    const page = { id: "completed-page", occurrences: [COMPLETED] };
    const plan = planMove({
      tasksPage: tasksPage({ occurrences: ["a", "b"] }),
      completed: completed({ parentId: "completed-page" }),
      existingPage: page,
    });
    expect(plan).toBe(null);
  });

  // A page exists from a PARTIAL earlier run but the container never moved —
  // adopt that page rather than minting another one.
  it("adopts an existing Completed page instead of minting a second", () => {
    const page = { id: "completed-page", occurrences: [] };
    const plan = planMove({ tasksPage: tasksPage(), completed: completed(), existingPage: page });
    expect(plan).not.toBe(null);
    expect(plan.reuseExistingPage).toBe(page);
  });

  // The container may already be unlisted (a half-applied run). The move still
  // needs to finish, but there is nothing to $pull.
  it("skips the unlist when the Tasks page no longer lists it", () => {
    const plan = planMove({
      tasksPage: tasksPage({ occurrences: ["a", "b"] }),
      completed: completed(), existingPage: null,
    });
    expect(plan.unlistFrom).toBe(null);
  });
});
