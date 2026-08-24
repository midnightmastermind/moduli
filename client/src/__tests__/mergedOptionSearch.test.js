// The dropdown that searches your grid AND a provider at once.
// User: "we still have our search for our own occurances merged in there."
import { describe, it, expect } from "vitest";
import { filterLocalOptions, optionProviderKey, localProviderKeys, splitSections }
  from "../helpers/mergedOptionSearch";

const opt = (value, label, meta) => ({ value, label, ...(meta ? { meta } : {}) });
const res = (externalId, title, provider = "wikipedia") => ({ provider, externalId, title });

describe("filterLocalOptions", () => {
  it("returns EVERYTHING for an empty query — the dropdown still lists what it always did", () => {
    const o = [opt("a", "Alpha"), opt("b", "Beta")];
    expect(filterLocalOptions(o, "")).toHaveLength(2);
    expect(filterLocalOptions(o, "   ")).toHaveLength(2);
  });
  it("matches label or value, case-insensitively", () => {
    const o = [opt("a", "Alpha"), opt("beta-id", "B")];
    expect(filterLocalOptions(o, "alp").map((x) => x.value)).toEqual(["a"]);
    expect(filterLocalOptions(o, "BETA").map((x) => x.value)).toEqual(["beta-id"]);
  });
  it("survives options with no label", () => {
    expect(() => filterLocalOptions([{ value: "x" }, null], "q")).not.toThrow();
  });
});

describe("splitSections", () => {
  it("keeps the two sections SEPARATE — one selects, the other imports", () => {
    const s = splitSections({ options: [opt("a", "Inception")], query: "inc",
                              remote: [res("1", "Inception (soundtrack)")] });
    expect(s.local.map((x) => x.label)).toEqual(["Inception"]);
    expect(s.external.map((x) => x.title)).toEqual(["Inception (soundtrack)"]);
  });

  it("drops a provider result the grid ALREADY holds", () => {
    const mine = opt("occ-1", "Inception", { searchProvider: "wikipedia", searchExternalId: "1" });
    const s = splitSections({ options: [mine], query: "inc",
                              remote: [res("1", "Inception"), res("2", "Inception (soundtrack)")] });
    expect(s.external.map((x) => x.externalId)).toEqual(["2"]);
  });

  it("matches on IDENTITY, not title — the whole reason for externalId", () => {
    const mine = opt("occ-1", "Inception", { searchProvider: "wikipedia", searchExternalId: "1" });
    const s = splitSections({ options: [mine], query: "inc", remote: [res("2", "Inception")] });
    // Same title, different pageid: still offered, because it IS a different thing.
    expect(s.external).toHaveLength(1);
  });

  it("does not confuse two providers sharing an id", () => {
    const mine = opt("occ-1", "x", { searchProvider: "wikipedia", searchExternalId: "1" });
    const s = splitSections({ options: [mine], query: "x", remote: [res("1", "x", "tmdb")] });
    expect(s.external).toHaveLength(1);
  });

  it("keeps a result with NO identity — it can still be imported", () => {
    const s = splitSections({ options: [], query: "x", remote: [{ provider: "p", title: "no id" }] });
    expect(s.external).toHaveLength(1);
  });

  it("reports SEARCHING so an empty remote list is not read as 'no results'", () => {
    const s = splitSections({ options: [], query: "inc", remote: [], remoteState: "searching" });
    expect(s.remoteState).toBe("searching");
  });

  it("is idle with no query, whatever the caller passes", () => {
    // Nothing has been asked for yet, so nothing is pending.
    expect(splitSections({ options: [], query: "", remoteState: "searching" }).remoteState).toBe("idle");
  });

  it("the LOCAL half never depends on the remote half", () => {
    // A provider that is down must degrade to exactly today's behaviour.
    const s = splitSections({ options: [opt("a", "Alpha")], query: "al", remote: null, remoteState: "error" });
    expect(s.local.map((x) => x.label)).toEqual(["Alpha"]);
    expect(s.external).toEqual([]);
  });

  it("survives being called with nothing", () => {
    const s = splitSections();
    expect(s.local).toEqual([]); expect(s.external).toEqual([]); expect(s.hasAnything).toBe(false);
  });
});

describe("optionProviderKey / localProviderKeys", () => {
  it("reads the stamp from meta or the option itself", () => {
    expect(optionProviderKey({ meta: { searchProvider: "p", searchExternalId: "1" } })).toBe("p:1");
    expect(optionProviderKey({ searchProvider: "p", searchExternalId: "2" })).toBe("p:2");
  });
  it("is null for a half-stamped or unstamped option", () => {
    expect(optionProviderKey({ meta: { searchProvider: "p" } })).toBeNull();
    expect(optionProviderKey({})).toBeNull();
    expect(optionProviderKey(null)).toBeNull();
  });
  it("collects only stamped options", () => {
    expect([...localProviderKeys([{ meta: { searchProvider: "p", searchExternalId: "1" } }, {}, null])])
      .toEqual(["p:1"]);
  });
});

// ── "add new" must survive the provider sections ────────────────────────────
// User, 2026-08-24: *"make sure add new works if i select one from the new lists
// or if its new completely (not on a list)."* Two paths through one box: the
// text you type is BOTH the provider query and the label a plain add-new would
// use, so a term that matches nothing anywhere must still leave you able to
// create it.
describe("typing something that is on no list", () => {
  it("leaves both sections empty rather than inventing a match", () => {
    const { local, external } = splitSections({
      options: [{ value: "a", label: "Bench Press" }],
      query: "Zzzq Custom Thing",
      remote: [],
      remoteState: "done",
    });
    expect(local).toEqual([]);
    expect(external).toEqual([]);
  });

  it("reports `done` rather than `searching`, so empty reads as an ANSWER", () => {
    // The distinction is the whole reason `remoteState` is surfaced: an empty
    // list under "searching…" means wait, and under a finished search it means
    // nothing was found and add-new is the way forward.
    const { remoteState } = splitSections({
      options: [], query: "Zzzq", remote: [], remoteState: "done",
    });
    expect(remoteState).toBe("done");
  });

  it("an empty query never asks the provider anything", () => {
    const { remoteState } = splitSections({
      options: [], query: "   ", remote: [], remoteState: "searching",
    });
    expect(remoteState).toBe("idle");
  });
});
