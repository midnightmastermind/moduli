// The sweep measured the date arrows at 14x30 with the name "Prev", and the picture search box with no name at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the date arrows", () => {
  const src = read("ui/FilterNavWidgets.jsx");
  it("say what they do", () => {
    expect(src).toMatch(/aria-label="Previous date"/);
    expect(src).toMatch(/aria-label="Next date"/);
  });
  it("are at least 24px across, and 32 on a phone", () => {
    const css = read("index.css");
    expect(src.match(/className="date-nav-arrow"/g)).toHaveLength(2);
    expect(css).toMatch(/\.date-nav-arrow \{[^}]*min-width: 24px;[^}]*min-height: 24px;/);
    expect(css).toMatch(/body\[data-layout="mobile"\] \.date-nav-arrow \{ min-width: 32px; min-height: 32px; \}/);
  });
});

describe("the picture search box", () => {
  it("has a name", () => {
    expect(read("ui/ImagePickerMenu.jsx")).toMatch(/aria-label="Search the web for an image"/);
  });
});

describe("the field editor's boxes say what they are", () => {
  const src = read("ui/commandCenter/FieldsTab.jsx");
  it.each(["Field name", "Field type", "Unit", "Category", "Button label"])("%s", (n) => expect(src).toContain(`aria-label="${n}"`));
});

describe("the phone's smallest controls", () => {
  const css = read("index.css");
  it("tick boxes are 24px, over an inline width", () => expect(css).toMatch(/input\[type="radio"\]\) \{ width: 24px !important; height: 24px;/));
  it("boxes in a menu or form are 32px tall", () => expect(css).toMatch(/\[data-command-center\]\) :is\(input:not[^{]*select\) \{ min-height: 32px; \}/));
  it.each([".notes-close-btn", '[title="Set image…"]', '[title="Lock document"]', '[title="Snap view to center"]'])("%s gets a 24px box", (sel) => expect(css).toContain(sel));
});
