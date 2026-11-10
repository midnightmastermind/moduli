// server/__tests__/importOwnsEmbeds.test.js
// Deleting an imported page cascades through children that are listed AND parented. A quote embedded in
// its lead-in paragraph was neither, so it was left behind (found 2026-11-10 cleaning up the prod probe).
import { describe, it, expect } from "vitest";
import { markdownToModuli } from "../services/markdownImporter.js";
import { ownEmbeddedBlocks } from "../utils/inlineChipOwnership.js";

const MD = "# Gnosis\n\nAs someone once said:\n\n> I know! I don't need to believe.\n\nA closing paragraph here.";

describe("an imported quote belongs to the text that embeds it", () => {
  it("parented to and listed by its textblock", async () => {
    const plan = await markdownToModuli({ gridId: "g", userId: "u", markdown: MD, dryRun: true, paragraphBlocks: true });
    const modById = new Map(plan.modules.map((m) => [m.id, m]));
    const quote = plan.occurrences.find((o) => modById.get(o.moduleId)?.kind === "quote");
    expect(quote).toBeTruthy();
    const holder = plan.occurrences.find((o) => o.id === quote.parentId);
    expect(holder).toBeTruthy();
    expect(holder.occurrences).toContain(quote.id);
    expect(JSON.stringify(holder.textmap)).toContain(quote.id);
  });
  it("an existing row the import only places keeps its own home — the control", () => {
    const occs = [{ id: "tb", textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "photo" } }] } }];
    expect(ownEmbeddedBlocks(occs)).toEqual([]);           // "photo" is not one of the import's own rows
    expect(occs[0].occurrences).toBeUndefined();
  });
  it("a block another node already lists is left to that lister", () => {
    const occs = [
      { id: "root", occurrences: ["sec"] },
      { id: "tb", textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "sec" } }] } },
      { id: "sec", parentId: null },
    ];
    ownEmbeddedBlocks(occs);
    expect(occs[2].parentId).toBeNull();
  });
});
