// Terminal skin: headers draw 1.3x (font-size-adjust 0.66) because VT323 reads small. A container's
// FIELD pills sit inside its header and took that boost, drawing as big as the label (user
// 2026-10-19). A field in a header keeps the body's field size.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("terminal skin: fields in a header are not headings", () => {
  it("a field inside a page/container header keeps the body's 0.48", () => {
    expect(css).toMatch(/:root\[data-skin="terminal"\] :is\(\.page-header, \.container-header\) :is\(\.field-display, \.field-input\)[^{]*\{\s*font-size-adjust: 0\.48;/);
  });
  it("comes after the header boost, so it wins at equal specificity", () => {
    const boost = css.indexOf('.container-header * { font-size-adjust: 0.66; }');
    const field = css.indexOf(':is(.page-header, .container-header) :is(.field-display, .field-input)');
    expect(boost).toBeGreaterThan(0);
    expect(field).toBeGreaterThan(boost);
  });
});
