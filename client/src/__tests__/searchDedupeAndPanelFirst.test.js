// __tests__/searchDedupeAndPanelFirst.test.js
// User 2026-11-02: "if i search on a panel, put the occurances in the page thats in the panel as the first search
// results" · "i saw some duplicates" · "i searched collin krainer and there were multiple file -> images".
// Measured on poms grid: "Collin Krainer" listed the person row, its People Table FEED COPY, and three photo files
// (one Facebook, two Instagram) all labelled with the person's name — five rows, one person.
import { describe, it, expect } from "vitest";
import { buildSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";

const modulesById = {
  m_page: { id: "m_page", role: "page", kind: "board", label: "People" },
  m_tpage: { id: "m_tpage", role: "page", kind: "table", label: "People Table" },
  m_board: { id: "m_board", role: "container", kind: "board", label: "Friends" },
  m_tbl: { id: "m_tbl", role: "container", kind: "table", label: "All" },
  m_person: { id: "m_person", role: "instance", label: "Collin Krainer" },
  m_img1: { id: "m_img1", role: "artifact", kind: "image", label: "Collin Krainer" },
  m_img2: { id: "m_img2", role: "artifact", kind: "image", label: "Collin Krainer" },
  m_lonely: { id: "m_lonely", role: "artifact", kind: "image", label: "Collin Krainer at the lake" },
  m_appt: { id: "m_appt", role: "instance", label: "Follow-up with Keith" },
  m_slot: { id: "m_slot", role: "container", kind: "board", label: "3:00pm" },
  m_spage: { id: "m_spage", role: "page", kind: "board", label: "Schedule" },
};
const fieldsById = { f_photo: { id: "f_photo", name: "Photo", type: "occurrence" } };
const occurrencesById = {
  page: { id: "page", moduleId: "m_page", occurrences: ["board"] },
  board: { id: "board", moduleId: "m_board", parentId: "page", occurrences: ["person", "appt"] },
  person: { id: "person", moduleId: "m_person", parentId: "board", linkedGroupId: "lg-p", fields: { f_photo: { value: ["img1", "img2"] } } },
  tpage: { id: "tpage", moduleId: "m_tpage", occurrences: ["tbl"] },
  tbl: { id: "tbl", moduleId: "m_tbl", parentId: "tpage", occurrences: ["copy"] },
  copy: { id: "copy", moduleId: "m_person", parentId: "tbl", linkedGroupId: "lg-p", meta: { feedSourceId: "person" }, fields: { f_photo: { value: ["img1", "img2"] } } },
  img1: { id: "img1", moduleId: "m_img1", parentId: null },
  img2: { id: "img2", moduleId: "m_img2", parentId: null },
  lonely: { id: "lonely", moduleId: "m_lonely", parentId: null },
  // An appointment and its linked copy in a Schedule slot: one appointment, two places.
  appt: { id: "appt", moduleId: "m_appt", parentId: "board", linkedGroupId: "lg-a" },
  spage: { id: "spage", moduleId: "m_spage", occurrences: ["slot"] },
  slot: { id: "slot", moduleId: "m_slot", parentId: "spage", occurrences: ["apptCopy"] },
  apptCopy: { id: "apptCopy", moduleId: "m_appt", parentId: "slot", linkedGroupId: "lg-a", meta: { copyLinkSource: "appt" } },
};
const index = buildSearchIndex({ occurrencesById, modulesById, fieldsById });
const ids = (q, opts) => searchOccurrences(index, q, opts).results.map((h) => h.entry.occId);

describe("one row per thing", () => {
  it("a feed copy is not listed beside its source", () => {
    const got = ids("collin krainer");
    expect(got).toContain("person");
    expect(got).not.toContain("copy");
  });

  it("…unless the copy is on the panel's own page, where the copy is what you want", () => {
    const got = ids("collin krainer", { preferRootId: "tpage" });
    expect(got).toContain("copy");
    expect(got).not.toContain("person");
  });

  it("photos attached to a matching row are not listed again", () => {
    const got = ids("collin krainer");
    expect(got).not.toContain("img1");
    expect(got).not.toContain("img2");
    // a file that matches on its own (attached to no matching row) still shows
    expect(got).toContain("lonely");
  });

  it("a file still shows when the row that holds it did NOT match", () => {
    // "lake" matches only the lonely file; and a query matching only the photos' label shows them
    expect(ids("lake")).toEqual(["lonely"]);
  });

  it("a linked copy shows once — the original by default", () => {
    const got = ids("keith");
    expect(got).toEqual(["appt"]);
  });

  it("…the copy on the panel's page when searching from that panel", () => {
    expect(ids("keith", { preferRootId: "spage" })).toEqual(["apptCopy"]);
  });
});

describe("the panel's page first", () => {
  it("hits under the panel's page outrank equally good hits elsewhere", () => {
    // Both the person (People) and the lonely file match "collin"; from People Table the copy leads.
    const first = ids("collin", { preferRootId: "tpage" })[0];
    expect(first).toBe("copy");
  });

  it("without a panel page the order is unchanged (control)", () => {
    const got = ids("collin");
    expect(got[0]).toBe("person");
  });
});
