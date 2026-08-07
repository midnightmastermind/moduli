import { describe, it, expect } from "vitest";
import {
  parseDelimited, sniffDelimiter, escapeTableCell,
  rowsToMarkdownTable, csvToMarkdownTable,
} from "../helpers/csvToTable";

describe("parseDelimited", () => {
  it("splits plain rows and columns", () => {
    expect(parseDelimited("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps a delimiter that sits inside quotes", () => {
    expect(parseDelimited('name,note\n"Smith, John",hi')).toEqual([
      ["name", "note"], ["Smith, John", "hi"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseDelimited('a\n"she said ""hi"""')).toEqual([["a"], ['she said "hi"']]);
  });

  it("keeps a newline that sits inside quotes as ONE row", () => {
    expect(parseDelimited('a,b\n"line1\nline2",x')).toEqual([
      ["a", "b"], ["line1\nline2", "x"],
    ]);
  });

  it("treats a quote mid-field as a literal, not an opener", () => {
    // Without the field-start rule a stray inch mark swallows the rest of the file.
    expect(parseDelimited('size,note\n6" pipe,ok\nnext,row')).toEqual([
      ["size", "note"], ['6" pipe', "ok"], ["next", "row"],
    ]);
  });

  it("handles CRLF and a trailing newline without minting a blank row", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops blank lines but keeps genuinely empty cells", () => {
    expect(parseDelimited("a,b\n\n1,\n")).toEqual([["a", "b"], ["1", ""]]);
  });

  it("strips a UTF-8 BOM so it can't become part of the first header", () => {
    expect(parseDelimited("\uFEFFa,b\n1,2")[0][0]).toBe("a");
  });

  it("keeps an unterminated final field rather than discarding it", () => {
    expect(parseDelimited('a,b\n"unclosed')).toEqual([["a", "b"], ["unclosed"]]);
  });
});

describe("sniffDelimiter", () => {
  it("picks the tab for a .tsv by extension", () => {
    expect(sniffDelimiter("a\tb\n1\t2", "rows.tsv")).toBe("\t");
  });

  it("prefers the delimiter that yields a CONSISTENT rectangle", () => {
    // Prose commas outnumber the real tab delimiters — a raw character count
    // would pick "," and shred the file.
    const text = "name\tnote\nAlice\tone, two, three\nBob\tfour, five, six";
    expect(sniffDelimiter(text)).toBe("\t");
  });

  it("picks a semicolon for the European convention", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  it("falls back to a comma when nothing splits into columns", () => {
    expect(sniffDelimiter("one\ntwo\nthree")).toBe(",");
  });
});

describe("escapeTableCell", () => {
  it("escapes a pipe so it cannot end the cell", () => {
    expect(escapeTableCell("a|b")).toBe("a\\|b");
  });

  it("leaves a backslash alone (splitTableRow only unescapes \\|)", () => {
    expect(escapeTableCell("C:\\path")).toBe("C:\\path");
  });

  it("flattens newlines — a table row IS one line", () => {
    expect(escapeTableCell("one\ntwo")).toBe("one two");
  });
});

describe("rowsToMarkdownTable", () => {
  it("emits a header, a separator and one line per row", () => {
    expect(rowsToMarkdownTable([["a", "b"], ["1", "2"]])).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("starts every line with a pipe (parseBlocks only detects tables that do)", () => {
    const md = rowsToMarkdownTable([["a", "b"], ["1", "2"]]);
    expect(md.split("\n").every((l) => l.startsWith("|"))).toBe(true);
  });

  it("pads a ragged row instead of dropping it", () => {
    const md = rowsToMarkdownTable([["a", "b", "c"], ["1"]]);
    expect(md.split("\n")[2]).toBe("| 1 |  |  |");
  });

  it("names a blank header by position so no column is unlabelled", () => {
    expect(rowsToMarkdownTable([["a", ""], ["1", "2"]]).split("\n")[0]).toBe("| a | Column 2 |");
  });

  it("REFUSES a single-column table — the separator regex needs two groups", () => {
    // A one-column pipe table is silently imported as prose; returning null is
    // what lets the caller fail out loud instead.
    expect(rowsToMarkdownTable([["only"], ["one"]])).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(rowsToMarkdownTable([])).toBeNull();
  });
});

describe("csvToMarkdownTable", () => {
  it("converts a plain CSV end to end", () => {
    const res = csvToMarkdownTable("name,qty\nApples,3\nPears,4", "list.csv");
    expect(res.ok).toBe(true);
    expect(res.columns).toBe(2);
    expect(res.rows).toBe(2);
    expect(res.markdown).toBe("| name | qty |\n| --- | --- |\n| Apples | 3 |\n| Pears | 4 |");
  });

  it("escapes a pipe carried in a quoted cell", () => {
    const res = csvToMarkdownTable('a,b\n"x|y",2');
    expect(res.markdown).toContain("x\\|y");
  });

  it("reports too-few-columns rather than emitting an undetectable table", () => {
    const res = csvToMarkdownTable("just\none\ntwo", "notes.csv");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("too-few-columns");
    expect(res.columns).toBe(1);
  });

  it("reports empty for a file with nothing in it", () => {
    expect(csvToMarkdownTable("   \n\n", "blank.csv")).toEqual({ ok: false, reason: "empty" });
  });
});
