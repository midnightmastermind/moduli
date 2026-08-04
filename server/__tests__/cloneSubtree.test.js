// server/__tests__/cloneSubtree.test.js
//
// These run WITHOUT a database by injecting `persist`. The previous version was
// DB-gated and returned early whenever no Mongo was reachable, so it passed
// vacuously — which is how the targetId/moduleId break below went unnoticed
// after the 2026-07-29 rename. Persistence itself is verified end-to-end
// against a real database in the plan's Task 9.
import { describe, it, expect } from "vitest";
import { cloneSubtree, mergeSubtreeInto, signatureOf } from "../utils/cloneSubtree.js";

// Records what WOULD be written, so assertions can check persistence intent.
function fakePersist() {
  const modules = [];
  const occurrences = [];
  return {
    modules,
    occurrences,
    saveModule: async (m) => { modules.push(m); },
    saveOccurrence: async (o) => { occurrences.push(o); },
  };
}

// Fixtures carry ONLY `moduleId` — the real schema shape. The old fixtures set
// `targetId` too, which masked the bug.
function ucTwoLevel() {
  return {
    modulesById: {
      "m-p": { id: "m-p", userId: "u", role: "page", kind: "board", label: "P", meta: {} },
      "m-c": { id: "m-c", userId: "u", role: "container", label: "C", meta: {} },
    },
    occurrencesById: {
      "o-p": { id: "o-p", userId: "u", moduleId: "m-p", gridId: "g1", occurrences: ["o-c"], meta: {} },
      "o-c": { id: "o-c", userId: "u", moduleId: "m-c", gridId: "g1", occurrences: [], meta: {} },
    },
  };
}

describe("cloneSubtree", () => {
  it("clones a 2-level tree from the real `moduleId` shape", async () => {
    // The regression: occurrences carry moduleId, never targetId. Reading
    // targetId made walk() bail on the first node and return a null root, so
    // every apply/save-template failed with "Template clone failed".
    const uc = ucTwoLevel();
    const persist = fakePersist();
    const r = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, newParentId: "folder-x", persist,
    });

    expect(r.rootClonedOccurrenceId).toBeTruthy();
    expect(r.occurrenceIds).toHaveLength(2);
    expect(r.moduleIds).toHaveLength(2);

    const root = uc.occurrencesById[r.rootClonedOccurrenceId];
    expect(root.parentId).toBe("folder-x");
    expect(root.occurrences).toHaveLength(1);
    // The clone must point at its OWN new module, not the source's.
    expect(root.moduleId).not.toBe("m-p");
    expect(uc.modulesById[root.moduleId].label).toBe("P");
    expect(root.targetId).toBeUndefined();
  });

  it("persists every cloned node", async () => {
    const uc = ucTwoLevel();
    const persist = fakePersist();
    await cloneSubtree({ rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist });
    expect(persist.modules).toHaveLength(2);
    expect(persist.occurrences).toHaveLength(2);
  });

  it("applies rootLabel to the root clone's module only", async () => {
    const uc = ucTwoLevel();
    const r = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc,
      rootLabel: "My Template", persist: fakePersist(),
    });
    const root = uc.occurrencesById[r.rootClonedOccurrenceId];
    expect(uc.modulesById[root.moduleId].label).toBe("My Template");
    const child = uc.occurrencesById[root.occurrences[0]];
    expect(uc.modulesById[child.moduleId].label).toBe("C");
  });

  it("applies occMetaPatch to the root occurrence only", async () => {
    const uc = ucTwoLevel();
    const r = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc,
      occMetaPatch: { appliedFromTemplateId: "tpl-1" }, persist: fakePersist(),
    });
    const root = uc.occurrencesById[r.rootClonedOccurrenceId];
    expect(root.meta.appliedFromTemplateId).toBe("tpl-1");
    expect(uc.occurrencesById[root.occurrences[0]].meta.appliedFromTemplateId).toBeUndefined();
  });

  it("returns a null root when the source occurrence is missing", async () => {
    const uc = { modulesById: {}, occurrencesById: {} };
    const r = await cloneSubtree({
      rootOccurrenceId: "missing", userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });
    expect(r.rootClonedOccurrenceId).toBeNull();
    expect(r.occurrenceIds).toHaveLength(0);
  });

  it("returns a null root when the source module is missing (dangling occurrence)", async () => {
    const uc = {
      modulesById: {},
      occurrencesById: { o: { id: "o", moduleId: "gone", occurrences: [] } },
    };
    const r = await cloneSubtree({
      rootOccurrenceId: "o", userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });
    expect(r.rootClonedOccurrenceId).toBeNull();
  });
});

describe("signatureOf", () => {
  it("prefers an explicit identitySignature", () => {
    expect(signatureOf({ id: "x", identitySignature: "daypage:Journal" })).toBe("daypage:Journal");
  });

  it("falls back to auto:<id> so an unsigned node still matches itself later", () => {
    expect(signatureOf({ id: "x" })).toBe("auto:x");
  });
});

describe("mergeSubtreeInto", () => {
  // A template page holding two sections; the target page already has one of
  // them (matched by signature) plus the user's own writing.
  function ucMerge() {
    const mod = (id, label) => ({ id, userId: "u", role: "container", label, meta: {} });
    const occ = (id, moduleId, extra = {}) => ({
      id, userId: "u", moduleId, gridId: "g1", occurrences: [], meta: {}, ...extra,
    });
    return {
      modulesById: {
        "m-tpl": mod("m-tpl", "Day Page"), "m-j": mod("m-j", "Journal"),
        "m-n": mod("m-n", "Notes"), "m-page": mod("m-page", "Today"),
        "m-jt": mod("m-jt", "Journal"), "m-mine": mod("m-mine", "My stuff"),
      },
      occurrencesById: {
        tpl: occ("tpl", "m-tpl", { occurrences: ["t-j", "t-n"] }),
        "t-j": occ("t-j", "m-j", { identitySignature: "daypage:Journal" }),
        "t-n": occ("t-n", "m-n", { identitySignature: "daypage:Notes" }),
        page: occ("page", "m-page", { occurrences: ["p-j", "p-mine"] }),
        "p-j": occ("p-j", "m-jt", { identitySignature: "daypage:Journal" }),
        "p-mine": occ("p-mine", "m-mine"),
      },
    };
  }

  it("clones only the sections the target does not already have", async () => {
    const uc = ucMerge();
    const r = await mergeSubtreeInto({
      templateOccurrenceId: "tpl", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });

    // Notes arrives; Journal does not duplicate.
    expect(r.occurrenceIds).toHaveLength(1);
    const page = uc.occurrencesById.page;
    expect(page.occurrences).toHaveLength(3);
    const labels = page.occurrences.map(id => uc.modulesById[uc.occurrencesById[id].moduleId].label);
    expect(labels.filter(l => l === "Journal")).toHaveLength(1);
    expect(labels).toContain("Notes");
  });

  it("leaves the user's own content untouched", async () => {
    const uc = ucMerge();
    const before = { ...uc.occurrencesById["p-mine"] };
    await mergeSubtreeInto({
      templateOccurrenceId: "tpl", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });
    expect(uc.occurrencesById["p-mine"]).toEqual(before);
    expect(uc.occurrencesById.page.occurrences).toContain("p-mine");
  });

  it("applies CONTENTS, not the template's wrapper", async () => {
    const uc = ucMerge();
    await mergeSubtreeInto({
      templateOccurrenceId: "tpl", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });
    const labels = uc.occurrencesById.page.occurrences
      .map(id => uc.modulesById[uc.occurrencesById[id].moduleId].label);
    expect(labels).not.toContain("Day Page");
  });

  it("is idempotent — a second merge adds nothing", async () => {
    // This is the property that stops a re-applied template from duplicating,
    // and the one the auto:<id> signature fallback exists to guarantee.
    const uc = ucMerge();
    const args = {
      templateOccurrenceId: "tpl", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc,
    };
    await mergeSubtreeInto({ ...args, persist: fakePersist() });
    const afterFirst = [...uc.occurrencesById.page.occurrences];
    const second = await mergeSubtreeInto({ ...args, persist: fakePersist() });
    expect(second.occurrenceIds).toHaveLength(0);
    expect(uc.occurrencesById.page.occurrences).toEqual(afterFirst);
  });

  it("merges UNSIGNED template nodes without duplicating them on re-apply", async () => {
    const uc = {
      modulesById: {
        t: { id: "t", label: "T", meta: {} }, s: { id: "s", label: "S", meta: {} },
        p: { id: "p", label: "P", meta: {} },
      },
      occurrencesById: {
        tpl: { id: "tpl", moduleId: "t", occurrences: ["sec"], meta: {} },
        sec: { id: "sec", moduleId: "s", occurrences: [], meta: {} },
        page: { id: "page", moduleId: "p", occurrences: [], meta: {} },
      },
    };
    const args = { templateOccurrenceId: "tpl", targetOccurrenceId: "page", userId: "u", gridId: "g1", uc };
    await mergeSubtreeInto({ ...args, persist: fakePersist() });
    expect(uc.occurrencesById.page.occurrences).toHaveLength(1);
    const second = await mergeSubtreeInto({ ...args, persist: fakePersist() });
    expect(second.occurrenceIds).toHaveLength(0);
    expect(uc.occurrencesById.page.occurrences).toHaveLength(1);
  });

  it("recurses so a section the template GAINED arrives inside a matched section", async () => {
    const uc = ucMerge();
    // Template's Journal gains a child; the page's Journal has none.
    uc.modulesById["m-q"] = { id: "m-q", label: "Daily Question", meta: {} };
    uc.occurrencesById["t-q"] = {
      id: "t-q", moduleId: "m-q", occurrences: [], meta: {}, identitySignature: "daypage:Q",
    };
    uc.occurrencesById["t-j"].occurrences = ["t-q"];

    await mergeSubtreeInto({
      templateOccurrenceId: "tpl", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });

    const pageJournal = uc.occurrencesById["p-j"];
    expect(pageJournal.occurrences).toHaveLength(1);
    const added = uc.occurrencesById[pageJournal.occurrences[0]];
    expect(uc.modulesById[added.moduleId].label).toBe("Daily Question");
  });

  it("no-ops when the template or target is missing", async () => {
    const uc = ucMerge();
    const r = await mergeSubtreeInto({
      templateOccurrenceId: "nope", targetOccurrenceId: "page",
      userId: "u", gridId: "g1", uc, persist: fakePersist(),
    });
    expect(r.occurrenceIds).toHaveLength(0);
    expect(r.updatedParentIds).toHaveLength(0);
  });
});
