// Intake Task 5 — text/photo → checklist items.
//
// The fixture that matters is the OCR one. `split("\n")` is not the feature; a
// photo of handwriting comes back as a mix of real items and debris, and minting
// an instance per raw line produces a checklist the user has to clean by hand —
// worse than the single textblock they got before.

import { describe, it, expect } from "vitest";
import { splitToChecklistItems, MAX_CHECKLIST_ITEMS } from "../helpers/checklistFromText.js";

const labels = (t) => splitToChecklistItems(t).items.map(i => i.label);

describe("splitToChecklistItems — the plain cases", () => {
  it("one item per line", () => {
    expect(labels("Milk\nEggs\nBread")).toEqual(["Milk", "Eggs", "Bread"]);
  });

  it("strips every bullet form OCR actually produces", () => {
    expect(labels("- Milk\n* Eggs\n• Bread\n· Rice\n— Oats\n1. Salt\n2) Pepper"))
      .toEqual(["Milk", "Eggs", "Bread", "Rice", "Oats", "Salt", "Pepper"]);
  });

  it("reads checkbox state instead of putting it in the label", () => {
    const { items } = splitToChecklistItems("[x] Milk\n[ ] Eggs\n- [✓] Bread");
    expect(items.map(i => i.label)).toEqual(["Milk", "Eggs", "Bread"]);
    expect(items.map(i => i.checked)).toEqual([true, false, true]);
  });

  it("collapses the uneven spacing OCR produces", () => {
    // A label with a five-space gap looks broken in a row.
    expect(labels("Greek    Yogurt")).toEqual(["Greek Yogurt"]);
  });
});

describe("splitToChecklistItems — the refusals, which are the whole feature", () => {
  it("drops blank lines without counting them as skipped", () => {
    const res = splitToChecklistItems("Milk\n\n\nEggs");
    expect(res.items).toHaveLength(2);
    expect(res.skipped).toBe(0); // an empty line is not debris, it is nothing
  });

  it("drops debris lines and REPORTS them", () => {
    // Stray marks and the ruled lines of a notepad. Reported rather than
    // swallowed: a silent drop of half a shopping list is how someone stops
    // trusting the feature.
    const res = splitToChecklistItems("Milk\n.\n|\n---\n___\nEggs");
    expect(res.items.map(i => i.label)).toEqual(["Milk", "Eggs"]);
    expect(res.skipped).toBe(4);
  });

  it("drops a single stray character but KEEPS a two-character item", () => {
    // The discriminating pair. One char is a stray mark far more often than an
    // item; two is the shortest real thing on a list.
    const res = splitToChecklistItems("x\nOx\nAA");
    expect(res.items.map(i => i.label)).toEqual(["Ox", "AA"]);
    expect(res.skipped).toBe(1);
  });

  it("caps a bad scan and says so", () => {
    const res = splitToChecklistItems(Array.from({ length: 250 }, (_, i) => `Item ${i}`).join("\n"));
    expect(res.items).toHaveLength(MAX_CHECKLIST_ITEMS);
    expect(res.truncated).toBe(true);
  });

  it("does NOT dedupe — a list may legitimately repeat", () => {
    // Removing a repeat would be rewriting what the user wrote.
    expect(labels("Milk\nMilk")).toEqual(["Milk", "Milk"]);
  });

  it("does NOT merge a wrapped line into the one above", () => {
    // Guessing that "2 lb" belongs to the line below needs to know what the list
    // is ABOUT, and being wrong there silently rewrites content. Dropping
    // obvious debris is safe; rewriting is not.
    expect(labels("Chicken\n2 lb")).toEqual(["Chicken", "2 lb"]);
  });

  it("handles junk input without throwing", () => {
    for (const junk of [null, undefined, "", 42, {}]) {
      expect(splitToChecklistItems(junk).items).toEqual([]);
    }
  });
});

describe("a REAL OCR blob off a handwritten grocery list", () => {
  // The shape tesseract actually returns: a header, inconsistent bullets, stray
  // marks from the paper, and uneven spacing.
  const OCR = `GROCERIES
- Milk
* Eggs
.
• Chicken   Breast
|
[x] Coffee Beans
2) Bananas

—
Olive Oil`;

  it("yields the items and nothing else", () => {
    const res = splitToChecklistItems(OCR);
    expect(res.items.map(i => i.label)).toEqual([
      "GROCERIES", "Milk", "Eggs", "Chicken Breast", "Coffee Beans", "Bananas", "Olive Oil",
    ]);
    expect(res.items.find(i => i.label === "Coffee Beans").checked).toBe(true);
    // TWO, not three: a lone `—` is stripped as a BULLET, leaving an empty
    // label, so it counts as a blank line rather than debris. Wrote 3 first;
    // the code was right and the expectation was wrong.
    expect(res.skipped).toBe(2); // . and |
  });

  it("keeps the header as an item rather than guessing it is a title", () => {
    // "GROCERIES" is indistinguishable from an item by shape alone, and
    // silently deleting the first line of someone's list to be clever is the
    // worse error. The user can delete one row; they cannot recover a row that
    // was never minted.
    expect(splitToChecklistItems(OCR).items[0].label).toBe("GROCERIES");
  });
});
