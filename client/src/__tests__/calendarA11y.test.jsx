// @vitest-environment jsdom
// The date picker failed axe (sweep row toolbar#11): its month arrows had no name, and the other month's blank filler days
// carried aria-label on a div with no role (react-multi-date-picker hard-codes both).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render } from "@testing-library/react";
import { calendarArrow, quietHiddenDays, watchHiddenDays } from "../helpers/calendarA11y.jsx";

describe("calendarArrow", () => {
  it("names each arrow and keeps the library's classes", () => {
    let clicked = 0;
    const { getByRole } = render(<div>{calendarArrow("left", () => clicked++, false, () => {})}{calendarArrow("right", () => {}, true, () => {})}</div>);
    const prev = getByRole("button", { name: "Previous month" });
    expect(prev.className).toContain("rmdp-arrow-container");
    expect(prev.className).toContain("rmdp-left");
    prev.click(); expect(clicked).toBe(1);
    const next = getByRole("button", { name: "Next month" });
    expect(next.className).toContain("disabled");
    expect(next.getAttribute("aria-disabled")).toBe("true");
  });
});

const day = (hidden, label) => { const d = document.createElement("div"); d.className = `rmdp-day${hidden ? " rmdp-day-hidden" : ""}`; d.setAttribute("aria-label", label); return d; };

describe("quietHiddenDays", () => {
  it("hides the filler days and drops their label, leaves real days alone", () => {
    const root = document.createElement("div"); const f = day(true, "Choose Dec 1"); const r = day(false, "Choose Nov 6"); root.append(f, r);
    quietHiddenDays(root);
    expect(f.getAttribute("aria-hidden")).toBe("true");
    expect(f.hasAttribute("aria-label")).toBe(false);
    expect(r.getAttribute("aria-label")).toBe("Choose Nov 6");
    expect(r.hasAttribute("aria-hidden")).toBe(false);
  });
  it("a filler day that becomes a real day gets its label back from the library and is shown again", () => {
    const root = document.createElement("div"); const d = day(true, "Choose Dec 1"); root.append(d); quietHiddenDays(root);
    d.className = "rmdp-day"; d.setAttribute("aria-label", "Choose Dec 1"); quietHiddenDays(root);
    expect(d.hasAttribute("aria-hidden")).toBe(false);
  });
  it("re-applies after the month changes", async () => {
    const root = document.createElement("div"); document.body.append(root);
    const stop = watchHiddenDays(root);
    const d = day(true, "Choose Jan 1"); root.append(d);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.getAttribute("aria-hidden")).toBe("true");
    stop();
  });
});

describe("wiring", () => {
  it("the date picker uses both", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/ui/NavPickerPopover.jsx"), "utf8");
    expect(src).toMatch(/renderButton=\{calendarArrow\}/);
    expect(src).toMatch(/watchHiddenDays\(/);
  });
});
