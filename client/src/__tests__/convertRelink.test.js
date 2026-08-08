// Task 6 — relink AT CONVERT TIME, which is the shape that replaced the migration.
//
// WHY THE MIGRATION IS NOT BEING BUILT (plan Step 2, measured against poms grid):
//   link chips 709 · candidate targets 247 · WOULD RELINK 10 — and all 10 were
//   FALSE POSITIVES. "Shady Records" and "Shade 45" are section HEADINGS at
//   depth 2 inside the Eminem article, so relinking them sends a reader who
//   clicked "Shady Records" to a heading instead of out to the real thing. With
//   the corrected selector (import roots only) it drops to ONE, and that one is
//   `Eminem -> Eminem`: a jump to the top of the page you are already reading.
//
// At convert time both ends are known, so the match is URL equality against a
// URL the user personally acted on — the guessing that produced those false
// positives is not part of this path at all.

import { describe, it, expect } from "vitest";
import { planConvertRelink, sameLinkTarget } from "../helpers/convertRelink.js";

const EM = "https://en.wikipedia.org/wiki/Eminem";

// A link chip, the shape markdownImporter.buildInlineLink mints.
const chip = (id, url, extra = {}) => ({
  id, moduleId: `m-${id}`, meta: { link: { kind: "url", url }, ...extra },
});
const ctx = (occs, mods = []) => ({
  occurrencesById: Object.fromEntries(occs.map(o => [o.id, o])),
  modulesById: Object.fromEntries(mods.map(m => [m.id, m])),
});

describe("sameLinkTarget — a fragment is a position, a query can be a document", () => {
  it("ignores fragment, trailing slash and host case", () => {
    expect(sameLinkTarget(EM, `${EM}#Career`)).toBe(true);
    expect(sameLinkTarget(EM, `${EM}/`)).toBe(true);
    expect(sameLinkTarget(EM, "https://EN.WIKIPEDIA.ORG/wiki/Eminem")).toBe(true);
  });

  it("does NOT ignore the query — ?page=2 can be a different document", () => {
    expect(sameLinkTarget(EM, `${EM}?action=raw`)).toBe(false);
  });

  it("keeps different articles apart", () => {
    // The Step 1 lesson: Dr._Dre_discography is NOT Dr. Dre.
    expect(sameLinkTarget(
      "https://en.wikipedia.org/wiki/Dr._Dre",
      "https://en.wikipedia.org/wiki/Dr._Dre_discography",
    )).toBe(false);
  });

  it("is false for junk on either side", () => {
    expect(sameLinkTarget(null, EM)).toBe(false);
    expect(sameLinkTarget(EM, "")).toBe(false);
  });
});

describe("planConvertRelink", () => {
  it("repoints a chip elsewhere on the grid at the new page", () => {
    const elsewhere = chip("c1", EM);
    const root = { id: "page-em", occurrences: [] };
    const got = planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([elsewhere, root]),
    });
    expect(got).toHaveLength(1);
    expect(got[0].occurrenceId).toBe("c1");
    expect(got[0].meta.link).toEqual({ kind: "occurrence", occId: "page-em", url: EM });
  });

  it("REFUSES a chip inside the new page — the Eminem -> Eminem self-loop", () => {
    // The single write the corrected migration would have made. A link inside
    // the page repointed at the page is a jump to the top of what you are
    // already reading.
    const inside = chip("c-inside", EM);
    const root = { id: "page-em", occurrences: ["sec-1"] };
    const section = { id: "sec-1", occurrences: ["c-inside"] };
    const got = planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([root, section, inside]),
    });
    expect(got).toEqual([]);
  });

  it("refuses a chip whose parentId chain reaches the new page", () => {
    // Structural children an importer parents without listing (the 2026-06-15
    // ancestry-orphan shape). Missing these would reintroduce the self-loop.
    const inside = { ...chip("c-inside", EM), parentId: "page-em" };
    const root = { id: "page-em", occurrences: [] };
    const got = planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([root, inside]),
    });
    expect(got).toEqual([]);
  });

  it("leaves chips pointing at a DIFFERENT url alone", () => {
    const other = chip("c2", "https://en.wikipedia.org/wiki/Dr._Dre");
    const root = { id: "page-em", occurrences: [] };
    expect(planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([other, root]),
    })).toEqual([]);
  });

  it("skips a chip that is ALREADY an in-app jump — a second run is a no-op", () => {
    const done = { id: "c3", moduleId: "m-c3", meta: { link: { kind: "occurrence", occId: "page-em" } } };
    const root = { id: "page-em", occurrences: [] };
    expect(planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([done, root]),
    })).toEqual([]);
  });

  it("MERGES meta rather than replacing it — a chip carries more than its link", () => {
    const c = chip("c4", EM, { note: "keep me", filterOverride: {} });
    const root = { id: "page-em", occurrences: [] };
    const [w] = planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([c, root]),
    });
    expect(w.meta.note).toBe("keep me");
    expect(w.meta.filterOverride).toEqual({});
  });

  it("reads the link off the MODULE when the occurrence has none", () => {
    // TextblockCard's precedence: per-placement meta wins, template is fallback.
    const occ = { id: "c5", moduleId: "m-shared" };
    const mod = { id: "m-shared", meta: { link: { kind: "url", url: EM } } };
    const root = { id: "page-em", occurrences: [] };
    const got = planConvertRelink({
      url: EM, rootOccurrenceId: "page-em", ...ctx([occ, root], [mod]),
    });
    expect(got).toHaveLength(1);
  });

  it("returns nothing without a url or a root", () => {
    const root = { id: "page-em", occurrences: [] };
    expect(planConvertRelink({ url: "", rootOccurrenceId: "page-em", ...ctx([root]) })).toEqual([]);
    expect(planConvertRelink({ url: EM, rootOccurrenceId: null, ...ctx([root]) })).toEqual([]);
  });
});
