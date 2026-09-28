// EVERY place that picks a field uses the searchable picker.
//
// User, 2026-09-28: *"i wanted to add a filter on the bookmarks page and it was
// incredibly hard to find the field"* → *"we also need that search selector for
// the sort fields"* → *"any place that selects a field should be using that
// one"*. So the deliverable is not two surfaces, it is a rule — and the rule is
// what this walks for, because the failure mode is the NEXT native `<select>`
// someone adds, not the eight that were swapped.
//
// It is the same complaint `DestinationPicker` answered one surface earlier
// ("we need to use our components that allows search"), which is why FieldSelect
// wraps that picker rather than being a second one.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// A `<select>` whose options are mapped out of a field list. The field list is
// named by convention across the app (fields / allFields / ourFields / sorted).
// `.name` and `.label || .name` are the two ways a field's display name is read.
// Written to survive prettier: the arrow body may be parenthesised and split
// over lines, which is exactly the shape the first version of this regex
// missed — it passed against an un-swapped FilterEditor.
const FIELD_OPTION_MAP =
  /(?:fields|allFields|ourFields|sorted|fieldsList|gridFields)\s*\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\(?\s*<option[\s\S]{0,120}?\{\s*\1(?:\.label\s*\|\|\s*\1)?\.name\s*\}\s*<\/option>/;

const SOURCES = walk(ROOT).filter((p) => !p.endsWith("FieldSelect.jsx"));

describe("the field picker is the one picker", () => {
  it("no component builds a native <select> out of the field list", () => {
    const offenders = SOURCES.filter((p) => FIELD_OPTION_MAP.test(fs.readFileSync(p, "utf8")))
      .map((p) => path.relative(ROOT, p));
    expect(offenders, `use <FieldSelect> instead of a native <select>: ${offenders.join(", ")}`)
      .toEqual([]);
  });

  it("the detector actually detects — a planted native field select is caught", () => {
    // Control: "no offenders" is equally satisfied by a regex that matches
    // nothing, which is how this guard would rot into a green no-op.
    const planted = `
      <select value={x} onChange={f}>
        <option value="">field…</option>
        {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>`;
    expect(FIELD_OPTION_MAP.test(planted)).toBe(true);
    const plantedLabel = `{allFields.map(field => <option key={field.id} value={field.id}>{field.label || field.name}</option>)}`;
    expect(FIELD_OPTION_MAP.test(plantedLabel)).toBe(true);
    // The multi-line, parenthesised shape prettier produces — the one the
    // first version of this regex walked straight past.
    const plantedWrapped = `
                {allFields.map(field => (
                  <option key={field.id} value={field.id}>{field.label || field.name}</option>
                ))}`;
    expect(FIELD_OPTION_MAP.test(plantedWrapped)).toBe(true);
  });

  it("the surfaces the user named import it", () => {
    for (const rel of [
      "ui/FilterEditor.jsx",            // local filters — the Bookmarks page
      "ui/LayoutCascadeEditor.jsx",     // "Order by" — the sort field
      "ui/FeedSection.jsx",             // a feed's condition field AND its sort
      "ui/commandCenter/GridSettingsTab.jsx",
      "ui/commandCenter/OperationsTab.jsx",
      "ui/commandCenter/PrefillEditor.jsx",
      "ui/commandCenter/SelectOptionsSourceEditor.jsx",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} should use FieldSelect`).toMatch(/import FieldSelect from ["']\.\.?\/(?:\.\.\/)?(?:ui\/)?FieldSelect\.jsx["']/);
    }
  });
});

describe("FieldSelect wraps the picker the app already has", () => {
  it("does not reimplement the popover", () => {
    const src = fs.readFileSync(path.join(ROOT, "ui/FieldSelect.jsx"), "utf8");
    expect(src).toMatch(/import DestinationPicker from/);
    // A second popover implementation is the drift this exists to avoid.
    expect(src).not.toMatch(/PopoverTrigger/);
  });
});
