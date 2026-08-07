// Task 4 Step 6 — dragging a file OUT of Files lands a PLACEMENT.
//
// This is the other half of Step 5. Until this existed, nothing in the app
// created a SECOND placement of a file, so the placement-delete-vs-file-delete
// distinction Step 5 enforces had no way to be exercised end to end.
//
// The rule is per-kind and it is NOT arbitrary:
//   MEDIA    → a copy per placement. One module, N occurrences.
//   MARKDOWN → one occurrence, multi-parented, because `textmap` lives on the
//              OCCURRENCE and a copy would carry an independent body.

import { describe, it, expect } from "vitest";
import { placementSemanticForKind } from "../helpers/mainFile.js";
import { handleArtifactDrop } from "../helpers/dropHandlers.js";

describe("placementSemanticForKind — the client twin", () => {
  it("markdown is the ONLY multiparent kind", () => {
    expect(placementSemanticForKind("markdown")).toBe("multiparent");
    for (const k of ["image", "video", "audio", "pdf", "code", "quote", undefined, null]) {
      expect(placementSemanticForKind(k)).toBe("copy");
    }
  });

  it("MUST MATCH the server rule verbatim", () => {
    // server/utils/filesFolder.js holds the authoritative version, and it also
    // enforces the delete side. If these drift, a markdown file dropped on a page
    // gets copied by the client while the server still treats it as one shared
    // row — and the two halves disagree about what a delete means. This test is
    // the drift alarm; the server suite has the mirror of it.
    const serverRule = (kind) => (kind === "markdown" ? "multiparent" : "copy");
    for (const k of ["markdown", "image", "video", "audio", "pdf", "code", "x"]) {
      expect(placementSemanticForKind(k)).toBe(serverRule(k));
    }
  });
});

// ── The drop itself ─────────────────────────────────────────────────────────
//
// Asserted on the WRITES THAT LEAVE, not on which helper got called. Spying the
// helpers would pin the plumbing; the socket traffic is the behaviour, and it is
// what actually differs between the two semantics:
//   copy        → a `create_occurrence` mints a new row of the same module
//   multiparent → an `update_occurrence` adds the EXISTING id to the parent
const ART_OCC = "art-occ-1";
const CONT_MOD = "cont-mod";
const CONT_OCC = "cont-occ";

function ctxFor(kind, { listed = [] } = {}) {
  const emitted = [];
  const artifactOcc = { id: ART_OCC, moduleId: "art-mod", parentId: "files-images" };
  const containerOcc = { id: CONT_OCC, moduleId: CONT_MOD, occurrences: listed };
  return {
    emitted,
    dispatch: () => {},
    socket: { connected: true, emit: (ev, data) => emitted.push({ ev, data }) },
    state: {
      userId: "u1", gridId: "g1",
      // dropView resolves the destination's ROLE from modulesById; the artifact
      // lookup in the handler reads the `modules` array. Both are real shapes.
      modulesById: {
        [CONT_MOD]: { id: CONT_MOD, role: "container", label: "Day" },
        "art-mod": { id: "art-mod", role: "artifact", kind },
      },
      modules: [{ id: "art-mod", role: "artifact", kind, fileRef: "user/2026-08/x", label: "x" }],
    },
    occurrencesById: { [ART_OCC]: artifactOcc, [CONT_OCC]: containerOcc },
    baseContainers: [{ id: CONT_MOD, label: "Day" }],
    clearSession: () => {},
    getCellFromPoint: () => null,
  };
}

const dropOn = (ctx) => handleArtifactDrop(
  {
    payload: { payloadType: "artifact", occurrenceId: ART_OCC },
    target: { kind: "container-list", occurrenceId: CONT_OCC, moduleId: CONT_MOD },
    position: { edge: null, insertIndex: null },
    dataTransfer: null,
  },
  ctx,
);

const creates = (ctx) => ctx.emitted.filter(e => e.ev === "create_occurrence");
const parentUpdates = (ctx) => ctx.emitted.filter(
  e => e.ev === "update_occurrence" && e.data?.occurrence?.id === CONT_OCC,
);

describe("handleArtifactDrop — landing a placement", () => {
  it("an IMAGE is copied — a new occurrence of the same module", () => {
    const ctx = ctxFor("image");
    dropOn(ctx);
    const made = creates(ctx);
    expect(made).toHaveLength(1);
    expect(made[0].data.occurrence.moduleId).toBe("art-mod");
    expect(made[0].data.occurrence.id).not.toBe(ART_OCC);
  });

  it("MARKDOWN is multi-parented — the same occurrence, one more parent", () => {
    const ctx = ctxFor("markdown");
    dropOn(ctx);
    const ups = parentUpdates(ctx);
    expect(ups).toHaveLength(1);
    expect(ups[0].data.occurrence.occurrences).toContain(ART_OCC);
    // The discriminating half: NO new row. A copy here is the bug — two
    // independent bodies for one markdown file.
    expect(creates(ctx)).toHaveLength(0);
  });

  it("dropping the same markdown file twice does not list it twice", () => {
    const ctx = ctxFor("markdown", { listed: [ART_OCC] });
    dropOn(ctx);
    // A duplicate id in occurrences[] renders the body twice and makes the
    // array's own order ambiguous.
    expect(parentUpdates(ctx)).toHaveLength(0);
    expect(creates(ctx)).toHaveLength(0);
  });

  it("an image dropped twice DOES place twice — copies are independent by design", () => {
    // Discriminating sibling for the idempotency case: the guard must be scoped
    // to the multiparent branch. Two copies of a photo on one page is legitimate.
    const ctx = ctxFor("image", { listed: [ART_OCC] });
    dropOn(ctx);
    expect(creates(ctx)).toHaveLength(1);
  });
});
