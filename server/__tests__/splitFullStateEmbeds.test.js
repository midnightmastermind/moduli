// A picture embedded in a document is part of the document, not the catalogue.
//
// 2026-10-22, user: Philosopher's Stone open on load showed 49 "embed: <id>"
// placeholders from ~23s until the LAST deferred chunk landed at ~28.6s, because
// every artifact — including the pictures the open doc embeds — rode in the
// catalogue half. An artifact a core textmap embeds ships with the core.
import { describe, it, expect } from "vitest";
import { splitFullState } from "../utils/splitFullState.js";

const mod = (id, role) => ({ id, role });
const embed = (occurrenceId) => ({ type: "moduleEmbed", attrs: { occurrenceId } });
const doc = (...content) => ({ type: "doc", content });

describe("splitFullState — embedded artifacts", () => {
  const modules = [mod("mc", "container"), mod("mt", "textblock"), mod("mpic", "artifact"), mod("msong", "artifact")];

  it("ships an artifact a core textmap embeds with the core, and its module", () => {
    const occurrences = [
      { id: "doc", moduleId: "mc", textmap: doc({ type: "wrapGroup", content: [embed("pic"), embed("tb")] }) },
      { id: "tb", moduleId: "mt", textmap: doc({ type: "paragraph" }) },
      { id: "pic", moduleId: "mpic" },
      { id: "song", moduleId: "msong" },
    ];
    const { core, deferred, coreModules, deferredModules } = splitFullState(occurrences, modules);
    expect(core.map((o) => o.id)).toContain("pic");
    expect(deferred.map((o) => o.id)).toEqual(["song"]);
    expect(coreModules.map((m) => m.id)).toContain("mpic");
    expect(deferredModules.map((m) => m.id)).toEqual(["msong"]);
  });

  it("follows embeds through a core textblock's own textmap", () => {
    const occurrences = [
      { id: "tb", moduleId: "mt", textmap: doc({ type: "paragraph", content: [{ type: "text", text: "x" }] }, embed("pic")) },
      { id: "pic", moduleId: "mpic" },
    ];
    expect(splitFullState(occurrences, modules).core.map((o) => o.id)).toContain("pic");
  });

  // Control: an artifact embedded only by ANOTHER artifact (a deferred row) stays
  // deferred — the rule is "a working surface shows it", not "anything mentions it".
  it("an embed held by a deferred artifact does not pull its target forward", () => {
    const occurrences = [
      { id: "song", moduleId: "msong", textmap: doc(embed("pic")) },
      { id: "pic", moduleId: "mpic" },
    ];
    const { core } = splitFullState(occurrences, modules);
    expect(core).toEqual([]);
  });
});
