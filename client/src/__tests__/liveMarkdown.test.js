// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { LiveMarkdown, markRuns, decorationsFor } from "../docs/LiveMarkdownExtension.js";

let editor;
afterEach(() => { editor?.destroy(); editor = null; });
const make = (content) => {
  editor = new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }), LiveMarkdown], content });
  return editor;
};
const key = (ed, k) => ed.view.someProp("handleKeyDown", (f) => f(ed.view, new KeyboardEvent("keydown", { key: k })));
const widgets = (ed) => decorationsFor(ed.state).find().map((d) => d.type.toDOM?.().textContent ?? d.spec?.key);

describe("live markdown: the line being edited shows its syntax", () => {
  it("a level-3 heading shows ### (the old marker said ##)", () => {
    const ed = make("<h3>Title</h3>");
    ed.commands.setTextSelection(3);
    expect(widgets(ed)).toEqual(["### "]);
  });

  it("level 4 exists, and # / Backspace at the start move the level", () => {
    const ed = make("<h4>Four</h4>");
    expect(ed.getJSON().content[0].attrs.level).toBe(4);
    ed.commands.setTextSelection(1);
    expect(key(ed, "#")).toBe(true);
    expect(ed.getJSON().content[0].attrs.level).toBe(5);
    key(ed, "Backspace"); key(ed, "Backspace"); key(ed, "Backspace"); key(ed, "Backspace");
    expect(ed.getJSON().content[0].attrs.level).toBe(1);
    key(ed, "Backspace");
    expect(ed.getJSON().content[0].type).toBe("paragraph");
  });

  it("bold shows ** around it, and Backspace right after the closing ** unbolds it", () => {
    const ed = make("<p>a <strong>bold</strong> b</p>");
    ed.commands.setTextSelection(3);
    expect(widgets(ed)).toEqual(["**", "**"]);
    ed.commands.setTextSelection(7);       // just after "bold"
    expect(key(ed, "Backspace")).toBe(true);
    expect(JSON.stringify(ed.getJSON())).not.toContain("bold\",\"marks");
    expect(ed.getText()).toBe("a bold b");
  });

  it("inline code (the pasted 'boxes') shows its backticks", () => {
    const ed = make("<p>run <code>npm</code> now</p>");
    ed.commands.setTextSelection(2);
    expect(widgets(ed)).toEqual(["`", "`"]);
  });

  it("Backspace inside text deletes a character as usual", () => {
    const ed = make("<p>a <strong>bold</strong> b</p>");
    ed.commands.setTextSelection(6);
    expect(key(ed, "Backspace")).toBeFalsy();
  });

  it("finds each mark's runs", () => {
    const ed = make("<p><strong>a<em>b</em></strong>c</p>");
    const runs = markRuns(ed.state.doc.firstChild, 1);
    expect(runs).toEqual(expect.arrayContaining([{ mark: "bold", from: 1, to: 3 }, { mark: "italic", from: 2, to: 3 }]));
  });
});

import { resolveMarkdownDoc } from "../docs/resolveMarkdown.js";
import { resolveTransaction } from "../docs/LiveMarkdownExtension.js";
const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("raw markdown that arrived as text resolves (the CPS application)", () => {
  it("#### lines become headings, *…* italic, list lines a list, and an empty pasted table goes", () => {
    const doc = { type: "doc", content: [
      p("#### Reflection Questions"),
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] },
      p("*Peer support honors the person’s right to make choices.*"),
      p("Some **bold** and `code` and ~~gone~~."),
      p("- one"), p("- two"),
      p("1. first"), p("2. second"),
      p("> quoted"),
      p("#hashtag stays"),
      p("```js"), p("const a = 1;"), p("  return a;"), p("```"),
    ] };
    expect(resolveMarkdownDoc(doc).doc.content.some((n) => n.type === "table")).toBe(true); // kept unless pasted
    const { doc: out, changed } = resolveMarkdownDoc(doc, { dropEmptyTables: true });
    expect(changed).toBe(true);
    const [h, it, mix, ul, ol, q, tag] = out.content;
    expect(h).toEqual({ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Reflection Questions" }] });
    expect(out.content.some((n) => n.type === "table")).toBe(false);
    expect(it.content).toEqual([{ type: "text", text: "Peer support honors the person’s right to make choices.", marks: [{ type: "italic" }] }]);
    expect(mix.content.map((c) => [c.text, (c.marks || []).map((m) => m.type).join()])).toEqual([
      ["Some ", ""], ["bold", "bold"], [" and ", ""], ["code", "code"], [" and ", ""], ["gone", "strike"], [".", ""],
    ]);
    expect(ul.type).toBe("bulletList"); expect(ul.content).toHaveLength(2);
    expect(ol.type).toBe("orderedList"); expect(ol.attrs.start).toBe(1);
    expect(q.type).toBe("blockquote");
    expect(tag).toEqual(p("#hashtag stays"));
    expect(out.content[7]).toEqual({ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "const a = 1;\n  return a;" }] });
    expect(resolveMarkdownDoc(out).changed).toBe(false);   // idempotent
  });

  it("leaves the caret's line alone and resolves the others", () => {
    const ed = make("<p>### Done line</p><p>## Typing here</p>");
    ed.commands.setTextSelection(3);                                   // on the first line: nothing resolves yet
    expect(ed.getJSON().content.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 3);  // move to the second line
    expect(ed.getJSON().content.map((n) => n.type)).toEqual(["heading", "paragraph"]);
    expect(resolveTransaction(ed.state, 1)).toBe(null);                // the line being typed is left alone
  });
});

describe("pasting from another site", () => {
  it("pastes the TEXT (no tables or boxes), and its markdown resolves", () => {
    const ed = make("<p>start</p>");
    ed.commands.setTextSelection(6);
    const data = { "text/html": "<table><tr><td><h4>Reflection</h4></td></tr></table>", "text/plain": "\n#### Reflection Questions\n*why it matters*" };
    const event = { clipboardData: { getData: (t) => data[t] || "", files: [] }, preventDefault() {} };
    const handled = ed.view.someProp("handlePaste", (f) => f(ed.view, event, null));
    expect(handled).toBe(true);
    const json = ed.getJSON();
    expect(JSON.stringify(json)).not.toContain("table");
    expect(json.content.find((n) => n.type === "heading")).toMatchObject({ attrs: { level: 4 } });
    expect(JSON.stringify(json)).toContain('"italic"');
  });

  it("a copy from this app keeps its formatting (the editor's own paste)", () => {
    const ed = make("<p>start</p>");
    const data = { "text/html": '<p data-pm-slice="1 1 []"><strong>x</strong></p>', "text/plain": "x" };
    const event = { clipboardData: { getData: (t) => data[t] || "", files: [] }, preventDefault() {} };
    const mine = ed.extensionManager.plugins.find((pl) => pl.spec.key === undefined ? false : String(pl.spec.key.key || "").startsWith("liveMarkdown"));
    expect(mine.props.handlePaste(ed.view, event)).toBe(false);
  });
});
