import { describe, it, expect } from "vitest";
import { occurrenceToMarkdown, tiptapToMarkdown, markdownFileName } from "../helpers/exportMarkdown";

const p = (...content) => ({ type: "paragraph", content });
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const doc = (...content) => ({ type: "doc", content });

const modulesById = {
  pageM: { id: "pageM", role: "page", kind: "board", label: "Tasks" },
  boardM: { id: "boardM", role: "container", kind: "board", label: "Today" },
  rowM: { id: "rowM", role: "instance", label: "Drink water", fieldBindings: [{ fieldId: "glasses" }, { fieldId: "secret", hidden: true }, { fieldId: "done" }] },
  docM: { id: "docM", role: "container", kind: "doc", label: "Notes" },
  secM: { id: "secM", role: "container", kind: "doc", label: "Ideas" },
  tbM: { id: "tbM", role: "textblock" },
  chipM: { id: "chipM", role: "textblock", kind: "inline" },
  imgM: { id: "imgM", role: "artifact", kind: "image", label: "photo.png", fileRef: "https://x.test/p.png" },
  pdfM: { id: "pdfM", role: "artifact", kind: "pdf", label: "paper.pdf", fileRef: "https://x.test/a.pdf" },
  tableM: { id: "tableM", role: "container", kind: "table", label: "Macros" },
};
const fieldsById = {
  glasses: { id: "glasses", name: "Glasses", type: "number" },
  secret: { id: "secret", name: "Secret", type: "text" },
  done: { id: "done", name: "Done", type: "boolean" },
};
const occurrencesById = {
  page: { id: "page", moduleId: "pageM", occurrences: ["board", "notes"] },
  board: { id: "board", moduleId: "boardM", occurrences: ["row1", "row2"] },
  row1: { id: "row1", moduleId: "rowM", fields: { glasses: { value: 3 }, secret: { value: "x" }, done: { value: true } } },
  row2: { id: "row2", moduleId: "rowM", label: "Stretch", fields: {} },
  notes: { id: "notes", moduleId: "docM", occurrences: ["tb1", "sec", "img", "pdf", "tbl"],
    textmap: doc(
      { type: "moduleEmbed", attrs: { occurrenceId: "tb1" } },
      { type: "moduleEmbed", attrs: { occurrenceId: "sec" } },
      { type: "wrapGroup", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "img" } }, { type: "moduleEmbed", attrs: { occurrenceId: "pdf" } }] },
      { type: "moduleEmbed", attrs: { occurrenceId: "tbl" } },
    ) },
  tb1: { id: "tb1", moduleId: "tbM", textmap: doc(p(t("Hello "), t("world", [{ type: "bold" }]), t(" see "),
    { type: "instanceTextblockInline", attrs: { occurrenceId: "chip" } })) },
  chip: { id: "chip", moduleId: "chipM", textmap: doc(p(t("Wiki"))), meta: { link: { kind: "url", url: "https://w.test" } } },
  sec: { id: "sec", moduleId: "secM", textmap: doc({ type: "bulletList", content: [
    { type: "listItem", content: [p(t("one"))] }, { type: "listItem", content: [p(t("two"))] }] }) },
  img: { id: "img", moduleId: "imgM" },
  pdf: { id: "pdf", moduleId: "pdfM" },
  tbl: { id: "tbl", moduleId: "tableM", meta: { table: { columns: [{ title: "Food" }, { title: "Kcal" }], rowCount: 1,
    cells: { "0:0": doc(p(t("Oats"))), "0:1": doc(p(t("150"))) } } } },
};

describe("occurrenceToMarkdown", () => {
  const md = occurrenceToMarkdown("page", { occurrencesById, modulesById, fieldsById });

  it("a page and its containers are headings, one level per nesting", () => {
    expect(md).toMatch(/^# Tasks\n\n## Today\n\n/);
    expect(md).toContain("## Notes\n\n");
    expect(md).toContain("### Ideas\n\n");
  });

  it("a row is a list item with its visible field values; a hidden one is left out", () => {
    expect(md).toContain("- Drink water\n  - Glasses: 3\n  - Done: yes\n");
    expect(md).toContain("- Stretch\n");
    expect(md).not.toContain("Secret");
  });

  it("a doc is walked through its text: textblocks, chips as links, lists, pictures, files, tables", () => {
    expect(md).toContain("Hello **world** see [Wiki](https://w.test)");
    expect(md).toContain("- one\n- two\n");
    expect(md).toContain("![photo.png](https://x.test/p.png)");
    expect(md).toContain("[paper.pdf](https://x.test/a.pdf)");
    expect(md).toContain("| Food | Kcal |\n| --- | --- |\n| Oats | 150 |");
  });

  it("order follows the page", () => {
    expect(md.indexOf("## Today")).toBeLessThan(md.indexOf("## Notes"));
    expect(md.indexOf("Hello")).toBeLessThan(md.indexOf("### Ideas"));
  });

  it("a cycle does not loop", () => {
    const loop = { a: { id: "a", moduleId: "boardM", occurrences: ["b"] }, b: { id: "b", moduleId: "boardM", occurrences: ["a"] } };
    expect(occurrenceToMarkdown("a", { occurrencesById: loop, modulesById, fieldsById })).toBe("# Today\n\n## Today\n");
  });
});

describe("fields on containers and files", () => {
  it("are sub-items under the heading or the file", () => {
    const occ = { ...occurrencesById,
      board: { ...occurrencesById.board, fields: { glasses: { value: 8 } } },
      img: { id: "img", moduleId: "imgM", fields: { done: { value: false } } } };
    const mods = { ...modulesById, boardM: { ...modulesById.boardM, fieldBindings: [{ fieldId: "glasses" }] },
      imgM: { ...modulesById.imgM, fieldBindings: [{ fieldId: "done" }] } };
    const md = occurrenceToMarkdown("page", { occurrencesById: occ, modulesById: mods, fieldsById });
    expect(md).toContain("## Today\n\n- Glasses: 8\n\n- Drink water\n");
    expect(md).toContain("![photo.png](https://x.test/p.png)\n\n- Done: no\n");
  });
});

it("a header bound to a field exports that field's value as the heading", () => {
  const occ = { q: { id: "q", moduleId: "qM", fields: { glasses: { value: "What went well?" } } } };
  const mods = { qM: { id: "qM", role: "container", kind: "board", label: "Daily Question", meta: { headerLink: { selfField: "glasses" } }, fieldBindings: [{ fieldId: "glasses" }] } };
  expect(occurrenceToMarkdown("q", { occurrencesById: occ, modulesById: mods, fieldsById })).toBe("# What went well?\n");
});

it("a doc's listed children that its text does not embed follow the text", () => {
  const occ = { d: { id: "d", moduleId: "docM", occurrences: ["x"], textmap: doc(p(t("Intro"))) }, x: { id: "x", moduleId: "rowM", fields: {} } };
  expect(occurrenceToMarkdown("d", { occurrencesById: occ, modulesById, fieldsById })).toBe("# Notes\n\nIntro\n\n- Drink water\n");
});

describe("tiptapToMarkdown", () => {
  it("keeps links and numbered lists", () => {
    const md = tiptapToMarkdown(doc(p(t("go", [{ type: "link", attrs: { href: "https://a.test" } }])),
      { type: "orderedList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] }));
    expect(md).toBe("[go](https://a.test)\n\n1. a\n2. b\n\n");
  });
});

it("file names lose characters a file system refuses", () => {
  expect(markdownFileName('A/B: "C"?')).toBe("A B C .md".replace(" .md", ".md"));
  expect(markdownFileName("")).toBe("export.md");
});
