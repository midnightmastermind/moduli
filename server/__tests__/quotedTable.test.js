// server/__tests__/quotedTable.test.js — a table inside a blockquote is a table, not a pull-quote (2026-11-10).
import { describe, it, expect } from "vitest";
import { parseBlocks } from "../services/markdownImporter.js";

// Verbatim from the Stanford Encyclopedia's "Academic Tools" box, as the reader writes it.
const SEP = `## Academic Tools

> |  | How to cite this entry. |
> | --- | --- |
> |  | Preview the PDF version of this entry at the Friends of the SEP Society. |
> |  | Enhanced bibliography for this entry at PhilPapers, with links to its database. |

## Other Internet Resources`;

describe("a quoted table", () => {
  it("is parsed as a table, with no quote", () => {
    const kinds = parseBlocks(SEP).map((b) => b.kind);
    expect(kinds).not.toContain("quote");
    expect(kinds).toContain("table");
  });
  it("a real quotation holding a | stays a quote — the control", () => {
    const blocks = parseBlocks("> I know! | don't need to believe.\n> — Someone");
    expect(blocks.map((b) => b.kind)).toEqual(["quote"]);
  });
  it("quoted lines that start with | but have no separator row stay a quote", () => {
    expect(parseBlocks("> | not a table\n> | just bars").map((b) => b.kind)).toEqual(["quote"]);
  });
});
