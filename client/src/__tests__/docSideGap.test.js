// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sideEdgeAt } from "../ui/Editor.jsx";

// One embed from x 100..500, y 200..300, then a paragraph (which cannot take a side "+").
function setup() {
  const nodes = [
    { type: { name: "moduleEmbed" }, nodeSize: 1, rect: { left: 100, right: 500, top: 200, bottom: 300, width: 400 } },
    { type: { name: "paragraph" }, nodeSize: 2, rect: { left: 100, right: 500, top: 300, bottom: 320, width: 400 } },
  ];
  const offs = [0, 1];
  const doc = { forEach: (fn) => nodes.forEach((n, i) => fn(n, offs[i])) };
  const view = { nodeDOM: (off) => ({ getBoundingClientRect: () => nodes[offs.indexOf(off)].rect }) };
  return { view, doc };
}

describe("the side '+' shows on a block's left or right edge", () => {
  it("near the right edge → right, drawn on that edge", () => {
    const { view, doc } = setup();
    expect(sideEdgeAt(view, doc, 494, 250)).toMatchObject({ side: "right", x: 500, top: 200, height: 100 });
  });
  it("near the left edge → left", () => {
    const { view, doc } = setup();
    expect(sideEdgeAt(view, doc, 104, 250)).toMatchObject({ side: "left", x: 100 });
  });
  it("in the middle of the block → nothing", () => {
    const { view, doc } = setup();
    expect(sideEdgeAt(view, doc, 300, 250)).toBeNull();
  });
  it("a plain paragraph line gets no side '+'", () => {
    const { view, doc } = setup();
    expect(sideEdgeAt(view, doc, 494, 310)).toBeNull();
  });
});
