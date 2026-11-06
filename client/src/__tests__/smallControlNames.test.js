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

describe("what axe found in the settings forms and on the page", () => {
  it("a row is a named group: a list item with no list around it failed on every board", () => {
    const src = read("modules/ModuleInstance.jsx");
    expect(src).not.toMatch(/role="listitem"/);
    expect(src.match(/role="group"/g).length).toBeGreaterThanOrEqual(2);
  });
  it("a board's items are a named group too: a list holding groups failed aria-required-children on every board", () => {
    const src = read("modules/ModuleContainer.jsx");
    expect(src).not.toMatch(/role="list"/);
    expect(src).toMatch(/role="group"\s+ref=\{itemsListRef\}\s+aria-label=\{`\$\{module\.label \|\| "Container"\} items`\}/);
  });
  it("the document editor is named", () => {
    expect(read("ui/Editor.jsx")).toMatch(/attributes: \{ "aria-label": "Document text", class: "doc-editor-content/);
  });
  it.each(["modules/ModulePanel.jsx", "modules/ModuleInstance.jsx", "modules/ModuleContainer.jsx"])("%s: closing settings is named", (f) => {
    for (const l of read(f).split("\n").filter((x) => x.includes("onClick={() => setSettingsOpen(false)}") && x.includes("<button"))) expect(l).toContain('aria-label="Close settings"');
  });
  it.each([
    ["ui/ContainerForm.jsx", ['aria-label="Header label overflow"', 'aria-label="Add a field"']],
    ["ui/LayoutForm.jsx", ['aria-label="View type"']],
    ["ui/LayoutCascadeEditor.jsx", ["aria-label={label}"]],
    ["ui/FormInput.jsx", ["aria-label={s.label"]],
    ["ui/StyleEditor.jsx", ['aria-label={`${label} style mode`}', 'aria-label="Font family"', 'aria-label="Font size"', 'aria-label="Font weight"']],
  ])("%s", (f, names) => { const src = read(f); for (const n of names) expect(src).toContain(n); });
  it("every Style select trigger has a name", () => {
    for (const l of read("ui/StyleEditor.jsx").split("\n").filter((x) => x.includes("<SelectTrigger"))) expect(l).toContain("aria-label");
  });
});

describe("the last unnamed controls", () => {
  it("a form's boxes carry their question", () => {
    const src = read("ui/FormModal.jsx");
    expect(src.match(/aria-label=\{item\.label \|\| item\.key\}/g).length).toBeGreaterThanOrEqual(3);
  });
  it("the option filter and the template name", () => {
    expect(read("ui/Field.jsx")).toContain('aria-label="Filter options"');
    expect(read("ui/TemplatesSection.jsx")).toContain('aria-label="New template name"');
  });
});

// A column tile lifts its handle out of the row, over the picture. With no picture it landed on the row's name.
describe("a column tile with no picture", () => {
  it("keeps its name clear of the lifted handle", () => {
    expect(read("index.css")).toMatch(/\.container-items--content-column \.instance-content > \.instance-textcol > \.instance-label:first-child \{ padding-left: 24px !important; \}/);
  });
});
