// A combobox takes no name from its contents, so axe flagged every dropdown pill on a board and the grid picker
// (button-name, 20 nodes on poms rebuild, 2026-11-06) although each shows text. Every one carries a name now.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); } else if (/\.jsx$/.test(e.name)) files.push(p); } })(root);
const tags = (src, re) => { const out = []; let m; while ((m = re.exec(src))) { const end = src.indexOf(">", m.index); out.push(src.slice(m.index, end + 1)); } return out; };

describe("every combobox is named", () => {
  it("every <SelectTrigger …> has an aria-label", () => {
    const missing = [];
    for (const f of files) for (const t of tags(fs.readFileSync(f, "utf8"), /<SelectTrigger\b/g)) if (!/aria-label=/.test(t)) missing.push(`${path.relative(root, f)}: ${t.slice(0, 80)}`);
    expect(missing).toEqual([]);
  });
  it('every role="combobox" element has an aria-label', () => {
    const missing = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      let i = -1;
      while ((i = src.indexOf('role="combobox"', i + 1)) >= 0) { const start = src.lastIndexOf("<", i); const end = src.indexOf(">", i); if (!/aria-label=/.test(src.slice(start, end))) missing.push(path.relative(root, f)); }
    }
    expect(missing).toEqual([]);
  });
  it("the walker sees the files it should", () => {
    expect(files.some((f) => f.endsWith("Toolbar.jsx"))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("ui", "Field.jsx")))).toBe(true);
  });
});

describe("a field's own editors are named", () => {
  it("every <Input> in Field.jsx carries an aria-label", () => {
    const src = fs.readFileSync(path.join(root, "ui", "Field.jsx"), "utf8");
    const missing = [];
    let i = -1;
    while ((i = src.indexOf("<Input ", i + 1)) >= 0) { const end = src.indexOf("/>", i); if (!/aria-label=/.test(src.slice(i, end))) missing.push(src.slice(i, i + 60)); }
    expect(missing).toEqual([]);
  });
});
