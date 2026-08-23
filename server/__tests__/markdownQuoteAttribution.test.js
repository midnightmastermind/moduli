// An annotation is not a pull-quote.
//
// The importer splits a trailing em-dash clause off a blockquote as an
// "— attribution" byline. That is right for a Wikipedia quote and wrong for the
// codex annotations, which are ordinary prose full of em-dashes: measured on the
// real corpus, 54 of 460 blockquotes would have their last sentence torn off and
// rendered as a byline.
import { describe, it, expect } from "vitest";
import { parseBlocks } from "../services/markdownImporter.js";

const quotes = (md) => parseBlocks(md).filter(b => b.kind === "quote");

describe("blockquote attribution", () => {
  it("KEEPS an annotation whole, em-dashes and all", () => {
    const md = "> **[annotation]** The system is deeply personal — then generalized for others.";
    const [q] = quotes(md);
    expect(q.attribution).toBe("");
    expect(q.text).toContain("then generalized for others");
  });

  it("still splits an ORDINARY quote's attribution — the control", () => {
    // Without this the fix is indistinguishable from deleting the feature, and
    // every Wikipedia pull-quote loses its byline.
    const [q] = quotes("> The unexamined life is not worth living. — Socrates");
    expect(q.attribution).toBe("Socrates");
    expect(q.text).toBe("The unexamined life is not worth living.");
  });

  it("marks an annotation and leaves an ordinary quote unmarked", () => {
    expect(quotes("> **[vision document]** A plan.")[0].annotation).toBe("vision document");
    expect(quotes("> Just a quote.")[0].annotation).toBeNull();
  });
});

// ── AND THE MARKER HAS TO SURVIVE ONTO THE MINTED BLOCK ─────────────────────
// The classifier being right proves nothing if the call site drops the value —
// the defect class this repo has paid for four times. So this asserts on what
// the IMPORTER produces, not on what parseBlocks returns.
import { markdownToModuli } from "../services/markdownImporter.js";

describe("the annotation marker reaches the module", () => {
  const run = (md) => markdownToModuli({
    gridId: "g", userId: "u", markdown: md, dryRun: true, title: "T",
  });

  it("stamps meta.codexAnnotation on an annotation quote", async () => {
    const res = await run("> **[annotation]** Commentary about the note.");
    const q = res.modules.find(m => m.kind === "quote");
    expect(q).toBeTruthy();
    expect(q.meta.codexAnnotation).toBe("annotation");
  });

  it("leaves the key ABSENT on an ordinary quote, not empty", () => {
    // A present-but-empty key reads as "an annotation with no label", which
    // would make every quoted line in the notes look machine-written.
    return run("> The unexamined life is not worth living. — Socrates").then((res) => {
      const q = res.modules.find(m => m.kind === "quote");
      expect(q.meta.attribution).toBe("Socrates");
      expect("codexAnnotation" in q.meta).toBe(false);
    });
  });
});
