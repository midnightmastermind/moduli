import { describe, it, expect } from "vitest";
import { markdownToModuli } from "../services/markdownImporter.js";

const plan = async (md) => markdownToModuli({
  gridId: "g", userId: "u", markdown: md, dryRun: true, title: "t",
});
const quoteModules = (r) => r.modules.filter((m) => m.kind === "quote");

describe("a blockquote that is a markdown link", () => {
  // Measured on the badgerherald article: two of its blockquotes are a single
  // markdown link, and the quote artifact stored the RAW text — so the card
  // printed "[Bodies of two Madison men are buried on Bascom Hill](https://…)"
  // and the unbreakable URL overflowed and clipped its box.
  const MD = `> [Bodies of two Madison men are buried on Bascom Hill](https://badgerherald.com/artsetc/arts-feature/2014/10/13/bodies-of-two-madison-men-are-buried-on-bascom-hill/)`;

  it("KEEPS the markdown link, so the renderer can resolve it", async () => {
    const [q] = quoteModules(await plan(MD));
    expect(q.meta.quote).toContain("[Bodies of two Madison men are buried on Bascom Hill]");
    expect(q.meta.quote).toContain("https://badgerherald.com/artsetc/");
  });

  it("strips bold and italic and code, which have no link to resolve", async () => {
    const [q] = quoteModules(await plan(`> **Bold** and *italic* and \`code\``));
    expect(q.meta.quote).toBe("Bold and italic and code");
  });

  // A HEADING still strips links — only the quote keeps them, because only the
  // quote card renders an anchor.
  it("still strips links from a heading", async () => {
    const r = await plan(`## A [linked](https://x.com/a) heading\n\nbody text here`);
    const labels = r.modules.map((m) => m.label).filter(Boolean);
    expect(labels.some((l) => l === "A linked heading")).toBe(true);
    expect(labels.some((l) => l.includes("https://"))).toBe(false);
  });

  // The control: an ordinary quote is untouched, attribution split included.
  it("leaves an ordinary quote and its attribution alone", async () => {
    const [q] = quoteModules(await plan(`> The only true wisdom is knowing you know nothing — Socrates`));
    expect(q.meta.quote).toBe("The only true wisdom is knowing you know nothing");
    expect(q.meta.attribution).toBe("Socrates");
  });

  // A dash inside the URL used to reach the attribution split and tear the quote
  // in half — "[Bodies buried](https://x.com/a" with "b)" as the author.
  // Stripping BEFORE the split is what prevents it. (A dash in the link TEXT is
  // ordinary prose and the attribution heuristic still applies to it, which is
  // the same call it makes for any other sentence.)
  it("does not mistake a dash inside the URL for an attribution", async () => {
    const [q] = quoteModules(await plan(`> [Bodies buried](https://x.com/a\u2014b)`));
    expect(q.meta.quote).toBe("[Bodies buried](https://x.com/a\u2014b)");
    expect(q.meta.attribution).toBe("");
  });
});
