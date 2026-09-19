// An op's textmap write that only adds/removes top-level embeds must be applied
// node by node — a full replace re-mounts every node view, and on the day page
// that threw the scroll back to the top on every mood click (2026-09-19).
import { describe, it, expect } from "vitest";
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { planEmbedDiff, applyEmbedDiff } from "../helpers/embedDiff";

const e = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });
const p = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : undefined });

describe("planEmbedDiff", () => {
  it("plans an appended embed", () => {
    expect(planEmbedDiff([e("w"), p()], [e("w"), p(), e("ci")]))
      .toEqual({ remove: [], insert: [{ afterId: "w", node: e("ci") }] });
  });
  it("plans a removed embed", () => {
    expect(planEmbedDiff([e("w"), e("ci"), p()], [e("w"), p()]))
      .toEqual({ remove: ["ci"], insert: [] });
  });
  // THE CONTROL: any other difference is not ours to patch — full replace.
  it("returns null when anything besides embeds changed", () => {
    expect(planEmbedDiff([e("w"), p("a")], [e("w"), p("b"), e("ci")])).toBeNull();
  });
  it("returns null when nothing changed", () => {
    expect(planEmbedDiff([e("w")], [e("w")])).toBeNull();
  });
});

const ModuleEmbed = Node.create({
  name: "moduleEmbed", group: "block", atom: true,
  addAttributes: () => ({ occurrenceId: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-embed]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", { "data-embed": HTMLAttributes.occurrenceId }],
});
const make = (content) => new Editor({ extensions: [StarterKit, ModuleEmbed], content: { type: "doc", content } });

// The editor appends an empty paragraph after a trailing atom, and a column's
// textmap may carry one — a planner that counted them would never match a real
// column and every write would fall back to the full replace.
describe("empty paragraphs are layout", () => {
  it("still plans when the editor carries a trailing empty paragraph", () => {
    expect(planEmbedDiff([e("w"), p()], [e("w"), e("ci")])).not.toBeNull();
  });
});

describe("applyEmbedDiff on a live editor", () => {
  it("inserts and removes without touching the other nodes", () => {
    const ed = make([e("w"), e("old"), p("hi")]);
    const wheelBefore = ed.state.doc.child(0);
    const target = [e("w"), p("hi"), e("new")];
    const ok = applyEmbedDiff(ed, planEmbedDiff(ed.getJSON().content, target));
    expect(ok).toBe(true);
    expect(ed.getJSON().content.map((n) => n.attrs?.occurrenceId || n.type).filter((x) => x !== "paragraph"))
      .toEqual(["w", "new"]);
    expect(ed.getText()).toContain("hi");
    // The untouched node is the SAME node — its view is not re-created.
    expect(ed.state.doc.child(0)).toBe(wheelBefore);
    ed.destroy();
  });

  it("is not an undo step", () => {
    const ed = make([e("w")]);
    applyEmbedDiff(ed, planEmbedDiff(ed.getJSON().content, [e("w"), e("ci")]));
    ed.commands.undo();
    expect(ed.getJSON().content.map((n) => n.attrs?.occurrenceId).filter(Boolean)).toEqual(["w", "ci"]);
    ed.destroy();
  });
});
