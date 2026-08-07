// Task 2 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// The sheet is the ONLY thing that asks what a dropped payload should become.
// The plan makes always-ask affordable by promising two things, and both are
// behaviour a test can hold:
//
//   1. the best shape is PRE-SELECTED and focused, so Enter commits it
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

  it("focuses the PRE-SELECTED tile, so Enter commits it", () => {
    const { onPick, classification } = open({ url: "https://example.com" });
    const pre = screen.getByTestId(`intake-shape-${classification.preselected}`);
    expect(document.activeElement).toBe(pre);

    // Enter on a focused button is the browser's own activation — this asserts
    // the wiring (focus lands on the right tile), not that React handles keys.
    fireEvent.click(pre);
    expect(onPick).toHaveBeenCalledWith(classification.preselected);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("a link pre-selects the chip — the user's headline ask", () => {
    open({ url: "https://example.com" });
    expect(screen.getByTestId("intake-shape-link-chip").dataset.preselected).toBe("true");
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

  it("picking a non-preselected tile returns THAT shape", () => {
    const { onPick } = open({ url: "https://example.com" });
    fireEvent.click(screen.getByTestId("intake-shape-link-page"));
    expect(onPick).toHaveBeenCalledWith("link-page");
  });

  it("arrow keys move focus between tiles", () => {
    const { classification } = open({ url: "https://example.com" });
    const list = screen.getByTestId(`intake-shape-${classification.shapes[0].id}`).parentElement;
    const before = document.activeElement;
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(before);
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
      <IntakeSheet classification={{ payload: {}, shapes: [], preselected: null }} onPick={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector(".intake-sheet")).toBeFalsy();
  });
});
