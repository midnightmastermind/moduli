// The dropdown's provider search is only real if the CALL SITES pass it.
//
// This suite exists because the feature shipped INERT: `MultiSelectWithAdd`
// grew `searchProvider` / `onImportResult`, every unit test of the component
// passed, and not one of the three call sites in Field.jsx handed it either
// prop. Nothing failed — the second section simply never rendered. That is the
// class this repo keeps paying for (2026-08-08 (7): "the call site is what
// would have made this inert"), so the wiring itself is pinned here.
//
// It reads the SOURCE rather than mounting the component, deliberately.
// Mounting Field needs the whole grid store, and the defect does not live in
// the component — it lives in whether the prop is written at the call site.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "Field.jsx"),
  "utf-8",
);

/** Every `<MultiSelectWithAdd …/>` element, as its own source slice. */
function callSites(src) {
  const out = [];
  let i = src.indexOf("<MultiSelectWithAdd");
  while (i !== -1) {
    out.push(src.slice(i, src.indexOf("/>", i) + 2));
    i = src.indexOf("<MultiSelectWithAdd", i + 1);
  }
  return out;
}

describe("the occurrence dropdown's provider search is wired at the call site", () => {
  const sites = callSites(SRC);

  it("finds the call sites at all (the control — a zero here is a broken probe)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  // The discriminator: an OCCURRENCE dropdown mints a row, so a provider result
  // has somewhere to land. A `select` field stores strings and does not.
  const occurrenceSites = sites.filter((s) => s.includes("onAddOption={occAddNew}"));
  const selectSites = sites.filter((s) => !s.includes("onAddOption={occAddNew}"));

  it("every OCCURRENCE dropdown passes both props", () => {
    expect(occurrenceSites.length).toBeGreaterThan(0);   // control
    for (const site of occurrenceSites) {
      expect(site).toContain("searchProvider=");
      expect(site).toContain("onImportResult=");
    }
  });

  it("the SELECT dropdown passes neither — a string field has nowhere to put a row", () => {
    expect(selectSites.length).toBeGreaterThan(0);       // control
    for (const site of selectSites) {
      expect(site).not.toContain("searchProvider=");
      expect(site).not.toContain("onImportResult=");
    }
  });

  it("the provider is DATA on the field, never a hardcoded name", () => {
    expect(SRC).toContain("field?.meta?.searchProvider?.provider");
  });

  it("EVERY import handler records WHERE the row came from", () => {
    // `dropAlreadyOnGrid` keys on `${provider}:${externalId}` — an import that
    // does not stamp both is offered again on the next search, forever.
    //
    // COUNTED, not merely present: a bare `toContain` is satisfied by one
    // surviving site, so it cannot see a regression at the other. That is not
    // hypothetical — the first A/B of this test mutated one of the two handlers
    // and the assertion stayed green.
    const handlers = SRC.split("occMeta: {").length - 1;
    const stamped = SRC.split("searchExternalId: r?.externalId").length - 1;
    expect(handlers).toBe(occurrenceSites.length);   // one handler per wired site
    expect(stamped).toBe(handlers);                  // and every one stamps
    expect(SRC.split("searchProvider: r?.provider").length - 1).toBe(handlers);
  });
});
