// `markdownToModuli` always returns a `role:"container"` root — CLAUDE.md
// 2026-08-08 (8) says it in as many words: "the importer has NEVER minted a
// page". The user asked for pages, so the wrapper is real work.
import { describe, it, expect } from "vitest";
import { planCodexPage } from "../utils/codexPage.js";

const base = {
  gridId: "g", userId: "u", folderId: "F", tagFieldId: "T",
  relPath: "writing/mental health.md", rootOccurrenceId: "ROOT",
  tags: ["mental-health", "writing"],
};

describe("planCodexPage", () => {
  it("names the page from the FILE, without its extension", () => {
    expect(planCodexPage(base).pageModule.label).toBe("mental health");
  });

  it("homes the page in its folder and EMBEDS the imported root", () => {
    // A doc renders its textmap, so listing the root without embedding it is
    // the listed-but-not-embedded class this repo has repaired five times.
    const { pageOcc } = planCodexPage(base);
    expect(pageOcc.parentId).toBe("F");
    expect(pageOcc.occurrences).toEqual(["ROOT"]);
  });

  it("stamps the tags into the Codex Tags field", () => {
    expect(planCodexPage(base).pageOcc.fields.T).toEqual({ value: ["mental-health", "writing"], flow: "in" });
  });

  it("signs the page with the RELATIVE path, so a re-run recognises it", () => {
    // Basenames repeat across folders with different content — a basename
    // signature would make the second file look already-imported.
    expect(planCodexPage(base).pageOcc.meta.codexPath).toBe("writing/mental health.md");
  });

  it("writes NO tag field when the file had none — not an empty array", () => {
    // An empty array reads as "tagged with nothing" in a multi-select and shows
    // an empty chip row; absent reads as untagged.
    const { pageOcc } = planCodexPage({ ...base, tags: [] });
    expect(pageOcc.fields.T).toBeUndefined();
  });

  it("binds the tag field so the page has a control for it", () => {
    expect(planCodexPage(base).pageModule.fieldBindings).toEqual([{ fieldId: "T", role: "input" }]);
  });
});
