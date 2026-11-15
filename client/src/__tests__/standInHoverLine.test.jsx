// The read-only stand-in drew a section's hover line (its one empty line after the final block) as a permanent blank
// line (2026-11-15). At rest the live editor hides it, so the stand-in draws none.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StaticTextmap from "../ui/StaticTextmap.jsx";

const card = { type: "standinCard", content: [{ type: "paragraph", content: [{ type: "text", text: "links" }] }] };
const lines = (c) => [...c.querySelectorAll("div")].filter((d) => d.style.minHeight === "1.35em").length;

describe("stand-in hover line", () => {
  it("draws no empty line after a final block", () => {
    const { container } = render(<StaticTextmap nodes={[card, { type: "paragraph" }]} />);
    expect(lines(container)).toBe(1); // the card's own text line only
  });
  it("inside a section too", () => {
    const { container } = render(<StaticTextmap nodes={[{ type: "standinSection", label: "Media", content: [card, { type: "paragraph" }] }]} />);
    expect(lines(container)).toBe(1);
  });
  it("keeps a blank line after text", () => {
    const { container } = render(<StaticTextmap nodes={[{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph" }]} />);
    expect(lines(container)).toBe(2);
  });
});
