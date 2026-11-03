// User 2026-11-03: "i currently cannot turn off selected choices … and all the other select inputs are hover
// highlighting any of the selections (like timeslot selects)". Picking the chosen option clears it, and the chosen
// option is marked by a ✓ (a background tint read the same as hover in the Terminal skin).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { togglePick, SelectOptionRow } from "../ui/Field.jsx";

describe("single-pick option lists", () => {
  it("picking the chosen option clears it; any other option replaces it", () => {
    expect(togglePick("9:30am", "9:30am")).toBe(null);
    expect(togglePick("9:30am", "10:00am")).toBe("10:00am");
    expect(togglePick(null, "10:00am")).toBe("10:00am");
  });
  it("the chosen row carries a check and aria-selected; the others do not", () => {
    const onClick = vi.fn();
    render(<div><SelectOptionRow selected onClick={onClick}>9:30am</SelectOptionRow><SelectOptionRow selected={false}>10:00am</SelectOptionRow></div>);
    const [a, b] = screen.getAllByRole("option");
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.querySelector("svg")).not.toBeNull();
    expect(b.getAttribute("aria-selected")).toBe("false");
    expect(b.querySelector("svg")).toBeNull();
    fireEvent.click(a);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("Field.jsx marks no single pick with a hover-coloured background any more", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/Field.jsx"), "utf8");
    expect(src).not.toMatch(/localValue === o\.value \? "bg-accent/);
    expect(src).not.toMatch(/selected\.includes\(o\.value\) \? "bg-primary\/10/);
    expect((src.match(/togglePick\(localValue,/g) || []).length).toBe(4); // compact + full plain, compact + full occurrence
  });
});
