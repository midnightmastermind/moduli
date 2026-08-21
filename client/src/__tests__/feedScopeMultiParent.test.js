// A feed's `scope` must see a row that is on the scoped page AND somewhere else.
//
// USER, 2026-08-21: *"make sure appointments or tasks set to complete in the
// tasks, get properly sent to completed at the end of the day even if they arent
// on the schedule"*. The `Tasks › Completed` container is a FEED scoped to the
// Tasks page, and it was reaching one ticked task of three.
//
// Cause, measured on live data: `feed.scope` was tested against a single
// ancestor chain walked from `buildParentMap`, which keys child -> ONE parent,
// last writer wins. A task listed by its Tasks container AND by a day column's
// `Todo` resolved through whichever the map happened to keep. Nine of the
// eighteen rows on that page resolved away from it.
import { describe, it, expect } from "vitest";
import { resolveFeedItems } from "../state/selectors";

const FIELD = "done";

/**
 * A ticked task listed by a Tasks bucket AND by a day column, plus a control
 * task listed only by the bucket. The feed is scoped to the Tasks page.
 */
function world({ alsoOnSchedule = true } = {}) {
  const w = {
    tasks:    { id: "tasks",    occurrences: ["bucket", "done"] },
    bucket:   { id: "bucket",   occurrences: ["shared", "local"], parentId: "tasks", role: "container" },
    done:     { id: "done",     occurrences: [], parentId: "tasks", role: "container",
                feed: { enabled: true, scope: "tasks", roles: ["instance"], limit: 50,
                        conditionOperator: "AND",
                        conditions: [{ id: "c", fieldId: FIELD, comparator: "IS", value: true }] } },
    schedule: { id: "schedule", occurrences: ["column"] },
    column:   { id: "column",   occurrences: [], parentId: "schedule", role: "container" },
    shared:   { id: "shared",   parentId: "bucket", role: "instance", fields: { [FIELD]: { value: true } } },
    local:    { id: "local",    parentId: "bucket", role: "instance", fields: { [FIELD]: { value: true } } },
    off:      { id: "off",      parentId: "column", role: "instance", fields: { [FIELD]: { value: true } } },
  };
  if (alsoOnSchedule) w.column.occurrences = ["shared", "off"];
  else w.column.occurrences = ["off"];
  return w;
}

const run = (w) =>
  resolveFeedItems(w.done, { occurrencesById: w, modulesById: {} })
    .map((i) => i.occurrence.id).sort();

describe("feed scope reaches a multi-parented row", () => {
  // THE DISCRIMINATING CASE. Fails against the single-chain walk.
  it("pulls a row listed by the scoped page AND by a day column", () => {
    expect(run(world({ alsoOnSchedule: true }))).toEqual(["local", "shared"]);
  });

  // The control: with the second listing removed the row was always found, so
  // the case above is measuring the multi-parenting and nothing else.
  it("pulls the same row when it is listed only by the page", () => {
    expect(run(world({ alsoOnSchedule: false }))).toEqual(["local", "shared"]);
  });

  it("still refuses a row that is genuinely outside the scope", () => {
    // `off` is ticked and lives only under the Schedule. Widening the walk must
    // not turn "reachable by some path" into "everything matches".
    expect(run(world())).not.toContain("off");
  });

  it("still refuses a row that fails the predicate", () => {
    const w = world();
    w.shared.fields[FIELD] = { value: false };
    expect(run(w)).toEqual(["local"]);
  });

  it("never pulls its own descendants, by any path", () => {
    // The recursion guard has to widen with the walk, or a feed whose owner is
    // reachable through a second parent starts pulling its own children.
    const w = world();
    w.done.occurrences = ["filed"];
    w.filed = { id: "filed", parentId: "done", role: "instance", fields: { [FIELD]: { value: true } } };
    w.bucket.occurrences.push("filed");     // also listed by the bucket
    expect(run(w)).not.toContain("filed");
  });

  it("never pulls a feed copy", () => {
    const w = world();
    w.copy = { id: "copy", parentId: "bucket", role: "instance",
               meta: { feedSourceId: "shared" }, fields: { [FIELD]: { value: true } } };
    w.bucket.occurrences.push("copy");
    expect(run(w)).not.toContain("copy");
  });
});
