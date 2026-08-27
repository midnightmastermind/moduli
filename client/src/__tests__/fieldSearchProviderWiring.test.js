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

/** Every element of `tag`, as its own source slice. */
function elements(src, tag) {
  const out = [];
  let i = src.indexOf(`<${tag}`);
  while (i !== -1) {
    out.push(src.slice(i, src.indexOf("/>", i) + 2));
    i = src.indexOf(`<${tag}`, i + 1);
  }
  return out;
}
const callSites = (src) => elements(src, "MultiSelectWithAdd");

// THE PROBE USED TO LOOK AT ONE TAG, AND THAT IS WHY IT MISSED THE GAP.
// It only ever read `<MultiSelectWithAdd>`, so it had nothing to say about the
// SINGLE-select occurrence dropdown — which rendered its own plain list and
// never got a provider at all. Measured 2026-08-27: `Location` and `Song` carry
// an enabled provider that nothing rendered, out of 33 single-select occurrence
// fields with no search box between them.
const listSites = elements(SRC, "OptionSearchList");

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

  it("the provider is DATA on the field, read through the ONE shared reader", () => {
    // It lives at `meta.optionsSource.searchProvider` — beside the query it
    // belongs to, which is where the editor writes it. Read via
    // `searchProviderConfig` rather than inline, so the editor's notion of
    // "enabled" and the dropdown's cannot drift.
    expect(SRC).toContain("searchProviderConfig(field)");
    expect(SRC).not.toContain("meta?.searchProvider");   // the old, bypassable path
  });

  it("the import USES the authored mapping, or the mapping is decoration", () => {
    expect(SRC).toContain("mapProviderFields(");
    expect(SRC).toContain("extraFields");
  });

  it("every SINGLE-select occurrence dropdown passes them too", () => {
    // The half this suite could not see. `OptionSearchList` is the shared body
    // of both dropdowns, so every site of it must carry the wiring — including
    // `MultiSelectWithAdd`'s own pass-through.
    expect(listSites.length).toBeGreaterThanOrEqual(3);   // control
    for (const site of listSites) {
      expect(site).toContain("searchProvider=");
      expect(site).toContain("onImportResult=");
    }
  });

  it("there is ONE import handler, and it records WHERE the row came from", () => {
    // `dropAlreadyOnGrid` keys on `${provider}:${externalId}` — an import that
    // does not stamp both is offered again on the next search, forever.
    //
    // It used to be COUNTED per call site, because the handler was written
    // inline twice and a bare `toContain` was satisfied by one surviving copy.
    // It is hoisted to one now, which is the stronger property: there is no
    // second copy to drift, and the single-select branches could only reach it
    // once it stopped living inside the multi-select branch.
    const handlers = SRC.split("occMeta: {").length - 1;
    expect(handlers).toBe(1);
    expect(SRC.split("searchExternalId: r?.externalId").length - 1).toBe(handlers);
    expect(SRC.split("searchProvider: r?.provider").length - 1).toBe(handlers);
  });
});

describe("a picked provider result asks WHERE it goes, like the typed one does", () => {
  // The typed "+ Add new" has asked which board since 2026-07-25. Picking a
  // provider result called `onImportResult(r)` with no parent, so it minted
  // into `targets[0]` silently — on `Purchase Item` (7 candidate boards) typing
  // a name asked and picking the same name from a provider did not.

  it("routes the remote row through the chooser, not straight to onImportResult", () => {
    // The defect verbatim was `onClick={() => onImportResult?.(r)}`.
    expect(SRC).not.toMatch(/onClick=\{\(\)\s*=>\s*onImportResult\?\.\(r\)\}/);
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*handlePickRemote\(r\)\}/);
  });

  it("asks only when there is a CHOICE — one target still commits directly", () => {
    // A question with one answer is a click nobody needs.
    const fn = SRC.slice(SRC.indexOf("const handlePickRemote"), SRC.indexOf("const handlePickRemote") + 320);
    expect(fn).toMatch(/addNewTargets\?\.\length\s*\|\|\s*0\)\s*>\s*1/);
    expect(fn).toMatch(/doImport\(r,\s*addNewTargets\?\.\[0\]\?\.id/);
  });

  it("THREADS the chosen parent to the mint — asking and ignoring is worse than not asking", () => {
    // The whole point: `occAddNew` has always accepted `parentOccurrenceId`,
    // and the import path passed none.
    for (const site of SRC.split("occAddNew({").slice(1)) {
      const call = site.slice(0, site.indexOf("});"));
      if (!call.includes("searchProvider:")) continue;      // only the import path
      expect(call).toMatch(/parentOccurrenceId/);
    }
  });

  it("every importResult callback accepts the parent argument", () => {
    const sigs = SRC.match(/\?\s*async \(r[^)]*\)\s*=>/g) || [];
    expect(sigs.length).toBeGreaterThan(0);
    for (const s of sigs) expect(s).toMatch(/parentOccurrenceId/);
  });

  it("the chooser names the thing it is placing, whichever way it arrived", () => {
    expect(SRC).toMatch(/pendingImport \? pendingImport\.title : newValue\.trim\(\)/);
  });
});
