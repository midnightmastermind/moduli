// Sorting by LABEL, not only by a field (user, 2026-09-26). The label is what
// the row shows: its own label when it has one, else its module's.
import { describe, it, expect } from "vitest";
import { resolveFeedItems } from "../state/selectors";
import { applyLocalSort } from "../helpers/LayoutHelpers";

const modulesById = {
  m1: { id: "m1", role: "instance", label: "zeta" },
  m2: { id: "m2", role: "instance", label: "Alpha" },
  m3: { id: "m3", role: "instance", label: "mid" },
  feedMod: { id: "feedMod", role: "container", label: "Feed" },
};
const occurrencesById = {
  a: { id: "a", moduleId: "m1", fields: {} },
  b: { id: "b", moduleId: "m2", fields: {} },
  c: { id: "c", moduleId: "m3", label: "Beta (own label)", fields: {} },
  feed: { id: "feed", moduleId: "feedMod", occurrences: [], feed: { enabled: true, roles: ["instance"], sort: { fieldId: "label", dir: "asc" } } },
};

describe("sort by label", () => {
  it("a feed sorted by label orders rows by what they show (own label first)", () => {
    const labels = resolveFeedItems(occurrencesById.feed, { occurrencesById, modulesById })
      .map(x => x.occurrence.label || x.module.label);
    expect(labels).toEqual(["Alpha", "Beta (own label)", "zeta"]);
  });

  it("descending reverses it", () => {
    const feed = { ...occurrencesById.feed, feed: { ...occurrencesById.feed.feed, sort: { fieldId: "label", dir: "desc" } } };
    const ids = resolveFeedItems(feed, { occurrencesById, modulesById }).map(x => x.occurrence.id);
    expect(ids).toEqual(["a", "c", "b"]);
  });

  it("the container Sort tab uses a row's own label over its module's", () => {
    const items = ["a", "b", "c"].map(id => ({ occurrence: occurrencesById[id] }));
    const sorted = applyLocalSort(items, { fieldId: "label", dir: "asc" }, modulesById).map(x => x.occurrence.id);
    expect(sorted).toEqual(["b", "c", "a"]);
  });
});
