// Task 2 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// The sheet is the ONLY thing that asks what a dropped payload should become.
// The plan makes always-ask affordable by promising two things, and both are
// behaviour a test can hold:
//
//   1. NOTHING is pre-selected — the user picks every time (2026-08-09)
//   2. Escape cancels and COMMITS NOTHING
//
// (2) is asserted as "zero calls to onPick", not "the sheet closed" — a sheet
// that closes AND writes is exactly the bug this plan exists to prevent, and
// only the write assertion can tell them apart.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import IntakeSheet, { describeIntakePayload } from "../ui/IntakeSheet.jsx";
import { classifyIntake } from "../helpers/intake.js";

afterEach(() => { delete document.body.dataset.layout; });

const mkFiles = (n, name = "shot.png", type = "image/png") =>
  Array.from({ length: n }, (_, i) => ({ name: n > 1 ? `${i}-${name}` : name, type, size: 10 }));

function open(payload, destination = {}, props = {}) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const classification = classifyIntake(payload, destination);
  render(
    <IntakeSheet classification={classification} onPick={onPick} onCancel={onCancel} {...props} />,
  );
  return { onPick, onCancel, classification };
}

describe("describeIntakePayload — the header names the GESTURE, not the first item", () => {
  it("counts a multi-file drop", () => {
    expect(describeIntakePayload({ kind: "files", files: mkFiles(9) })).toBe("9 files");
  });
  it("names a single file", () => {
    expect(describeIntakePayload({ kind: "file", files: [{ name: "budget.csv" }] })).toBe("budget.csv");
  });
  it("counts several links but shows a lone url", () => {
    expect(describeIntakePayload({ kind: "link", urls: ["a", "b", "c"] })).toBe("3 links");
    expect(describeIntakePayload({ kind: "link", urls: ["https://x.com"] })).toBe("https://x.com");
  });
  it("has a phrase for every payload kind (never blank)", () => {
    for (const kind of ["files", "file", "link", "html", "text", "unknown"]) {
      expect(describeIntakePayload({ kind }).length).toBeGreaterThan(0);
    }
  });
});

describe("IntakeSheet", () => {
  it("renders one tile per shape the classifier offered", () => {
    const { classification } = open({ url: "https://en.wikipedia.org/wiki/Eminem" });
    for (const s of classification.shapes) {
      expect(screen.getByTestId(`intake-shape-${s.id}`)).toBeTruthy();
    }
  });

  // THE CONTRACT, and the whole point of this change (user, 2026-08-09: "there
  // shouldnt be a default, it should ask everytime what id like to do with it").
  // Focusing a tile is not a neutral act — a focused button is activated by
  // Enter, so it IS a default whatever we call it.
  it("focuses NO tile — nothing is pre-selected", () => {
    const { classification } = open({ url: "https://example.com" });
    for (const s of classification.shapes) {
      expect(
        document.activeElement,
        `tile ${s.id} was focused — that makes Enter commit it`,
      ).not.toBe(screen.getByTestId(`intake-shape-${s.id}`));
    }
    // Focus is parked on the dialog so Escape and the arrow keys still work.
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });

  it("no tile is visually singled out either", () => {
    const { classification } = open({ url: "https://example.com" });
    const bgs = new Set(
      classification.shapes.map(
        (s) => screen.getByTestId(`intake-shape-${s.id}`).style.background,
      ),
    );
    // Every tile renders identically; a highlighted one would be a
    // recommendation the sheet is no longer allowed to make.
    expect(bgs.size).toBe(1);
  });

  it("the fallback is NOT wired into the sheet — it is the no-host escape only", () => {
    const { classification } = open({ url: "https://example.com" });
    const tile = screen.getByTestId(`intake-shape-${classification.fallback}`);
    expect(tile.dataset.preselected).toBeUndefined();
    expect(tile.dataset.fallback).toBeUndefined();
  });

  it("ESCAPE COMMITS NOTHING", () => {
    const { onPick, onCancel } = open({ url: "https://example.com" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();   // the assertion that matters
  });

  it("tapping the backdrop commits nothing either", () => {
    document.body.dataset.layout = "mobile";
    const { onPick, onCancel } = open({ url: "https://example.com" });
    fireEvent.pointerDown(document.querySelector(".menu-surface-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("ONE sheet per gesture: nine files ask once and the header says so", () => {
    open({ files: mkFiles(9) });
    expect(screen.getByTestId("intake-payload").textContent).toBe("9 files");
    // One sheet, one set of shapes — not nine sheets and not per-file tiles.
    expect(document.querySelectorAll(".intake-sheet").length).toBe(1);
    expect(screen.getByTestId("intake-shape-files-siblings")).toBeTruthy();
  });

  it("picking a tile returns THAT shape", () => {
    const { onPick } = open({ url: "https://example.com" });
    fireEvent.click(screen.getByTestId("intake-shape-link-page"));
    expect(onPick).toHaveBeenCalledWith("link-page");
  });

  it("arrow keys move focus between tiles", () => {
    const { classification } = open({ url: "https://example.com" });
    const first = screen.getByTestId(`intake-shape-${classification.shapes[0].id}`);
    const list = first.parentElement;
    // Focus starts on the dialog, so the FIRST Down lands on the first tile —
    // arriving at an end of the list rather than at a recommended shape.
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByTestId(`intake-shape-${classification.shapes[1].id}`),
    );
  });

  it("is a DRAWER on mobile and anchored on desktop (MenuSurface owns this)", () => {
    document.body.dataset.layout = "mobile";
    const { unmount } = render(
      <IntakeSheet classification={classifyIntake({ url: "https://x.com" })} onPick={() => {}} onCancel={() => {}} />,
    );
    expect(document.querySelector(".menu-surface--drawer")).toBeTruthy();
    unmount();

    document.body.dataset.layout = "desktop";
    render(
      <IntakeSheet classification={classifyIntake({ url: "https://x.com" })} onPick={() => {}} onCancel={() => {}} />,
    );
    expect(document.querySelector(".menu-surface--drawer")).toBeFalsy();
  });

  it("renders nothing when there are no shapes (cannot show an empty dead end)", () => {
    const { container } = render(
      <IntakeSheet classification={{ payload: {}, shapes: [], fallback: null }} onPick={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector(".intake-sheet")).toBeFalsy();
  });
});
