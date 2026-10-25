// @vitest-environment jsdom
// Raw markdown already saved in a document resolves when its editor opens — not only after an edit (user,
// 2026-10-25: "that doc page with the cps application is still not resolving markdown"; the text was saved before
// the resolver shipped and nothing edited it since).
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { LiveMarkdown } from "../docs/LiveMarkdownExtension.js";
import { resolveMarkdownDoc } from "../docs/resolveMarkdown.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const p = (...content) => ({ type: "paragraph", content });
const t = (text) => ({ type: "text", text });
const br = { type: "hardBreak" };
const cell = (text) => ({ type: "tableCell", content: [text ? p(t(text)) : { type: "paragraph" }] });
const table = (rows) => ({ type: "table", content: rows.map((r) => ({ type: "tableRow", content: r.map(cell) })) });

let editor;
afterEach(() => { editor?.destroy(); editor = null; });
const make = (content, editable = true) => {
  editor = new Editor({
    editable,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }), Table, TableRow, TableCell, TableHeader, LiveMarkdown],
    content: { type: "doc", content },
  });
  return editor;
};

// The CPS page's shapes, as stored.
const cps = [
  { type: "heading", attrs: { level: 1 }, content: [t("CPS and CPPS Training Application")] },
  table([[""]]),
  p(t("### Reflection Questions")),
  p(t("#### Interest In Peer Support")),
  p(t(" I have used my experiences, "), br, t("- to help people fight"), br, t("- turn a direction"), br, t("- give others hope")),
  p(t("*What strengths would you bring?*")),
];

describe("raw markdown resolves when the editor opens", () => {
  it("headings, line-break lists, italics and the empty layout box", async () => {
    const ed = make(cps);
    await tick();
    const doc = ed.getJSON().content;
    expect(doc.map((n) => n.type + (n.attrs?.level || ""))).toEqual(["heading1", "heading3", "heading4", "paragraph", "bulletList", "paragraph"]);
    expect(doc[3].content.map((c) => c.text).join("")).toBe(" I have used my experiences, ");
    expect(doc[4].content.map((li) => li.content[0].content[0].text)).toEqual(["to help people fight", "turn a direction", "give others hope"]);
    expect(doc[5].content[0]).toEqual({ type: "text", text: "What strengths would you bring?", marks: [{ type: "italic" }] });
  });

  it("a read-only editor changes nothing", async () => {
    const ed = make(cps, false);
    await tick();
    expect(ed.getJSON().content[2]).toEqual(p(t("### Reflection Questions")));
  });

  it("an empty table with real rows and columns stays — only a one-cell layout box goes", async () => {
    const ed = make([table([["", ""], ["", ""]]), p(t("x"))]);
    await tick();
    expect(ed.getJSON().content[0].type).toBe("table");
  });

  it("a line break with no markdown after it is left as one paragraph", () => {
    const { changed } = resolveMarkdownDoc({ type: "doc", content: [p(t("Name"), br, t("Address"))] }, { dropEmptyTables: "layout" });
    expect(changed).toBe(false);
  });
});
