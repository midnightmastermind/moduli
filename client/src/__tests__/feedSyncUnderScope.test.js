// A filter changed on one occurrence moves only the effective filter of that occurrence and what sits under it,
// so only feeds owned there need a sync pass (2026-11-11: a Relationship pick on the People container re-synced
// every feed, ~0.5s).
import { describe, it, expect, vi } from "vitest";
vi.mock("../helpers/CommitHelpers", () => ({}));
vi.mock("../helpers/LayoutHelpers", () => ({}));
import { feedInScope } from "../helpers/feedSync";
import { echoFeedScope } from "../state/bindSocketToStore";

const occs = {
  page: { id: "page", occurrences: ["ctr", "feedA"] },
  ctr: { id: "ctr", occurrences: ["feedB"] },
  feedA: { id: "feedA", feed: { enabled: true, conditions: [] } },
  feedB: { id: "feedB", feed: { enabled: true, conditions: [] } },
  other: { id: "other", feed: { enabled: true, conditions: [{ fieldId: "f1", comparator: "IS", value: "x" }] } },
};
const args = (o) => ({ state: {}, occurrencesById: occs, ...o });

describe("feedInScope", () => {
  it("no scope covers every feed", () => {
    expect(feedInScope(occs.other, args({}))).toBe(true);
  });
  it("a feed owned AT the changed occurrence is in", () => {
    expect(feedInScope(occs.ctr, args({ onlyUnderIds: ["ctr"] }))).toBe(true);
  });
  it("a feed UNDER the changed occurrence is in", () => {
    expect(feedInScope(occs.feedB, args({ onlyUnderIds: ["ctr"] }))).toBe(true);
    expect(feedInScope(occs.feedB, args({ onlyUnderIds: ["page"] }))).toBe(true);
  });
  it("a feed elsewhere is out", () => {
    expect(feedInScope(occs.feedA, args({ onlyUnderIds: ["ctr"] }))).toBe(false);
    expect(feedInScope(occs.other, args({ onlyUnderIds: ["ctr"] }))).toBe(false);
  });
  it("scopes union: a field the feed reads brings it in", () => {
    expect(feedInScope(occs.other, args({ onlyUnderIds: ["ctr"], onlyFieldIds: ["f1"] }))).toBe(true);
  });
});

describe("echoFeedScope: a filter set on a row", () => {
  const prev = { id: "ctr", filterOverride: { rel: ["friend"] }, fields: {} };
  it("asks only for feeds under that row", () => {
    expect(echoFeedScope({ id: "ctr", filterOverride: { rel: ["acquaintance"] } }, prev)).toEqual({ underIds: ["ctr"] });
  });
  it("an unchanged filter with nothing else changed is none", () => {
    expect(echoFeedScope({ id: "ctr", filterOverride: { rel: ["friend"] } }, prev)).toBe("none");
  });
  it("a filter change together with a field change is a whole pass", () => {
    expect(echoFeedScope({ id: "ctr", filterOverride: {}, fields: { a: { value: 1 } } }, prev)).toBe("all");
  });
});
