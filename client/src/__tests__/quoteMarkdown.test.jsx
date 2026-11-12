import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { linkifyText } from "../modules/ArtifactCard.jsx";

const html = (t) => render(<blockquote>{linkifyText(t)}</blockquote>).container.innerHTML;

describe("quote text: markdown resolves", () => {
  it("bold and italic render as tags, not asterisks", () => {
    const out = html("**[annotation]** A painting, *The Last Supper*, and _Relapse_.");
    expect(out).toContain("<strong>[annotation]</strong>");
    expect(out).toContain("<em>The Last Supper</em>");
    expect(out).toContain("<em>Relapse</em>");
    expect(out).not.toContain("**");
  });
  it("a link keeps its URL's underscores and gets an emphasised label", () => {
    const out = html("See [Wikipedia: *Severance*](https://en.wikipedia.org/wiki/Severance_(TV_series)).");
    expect(out).toContain('href="https://en.wikipedia.org/wiki/Severance_(TV_series)"');
    expect(out).toContain("<em>Severance</em>");
  });
  it("leaves a lone star, a snake_case word and a bare url alone", () => {
    const out = html("5 * 3 in my_var at https://a.com/x_y_z");
    expect(out).not.toContain("<em>");
    expect(out).toContain('href="https://a.com/x_y_z"');
  });
  it("plain text with nothing to resolve comes back as itself", () => {
    expect(linkifyText("just words")).toBe("just words");
  });
});
