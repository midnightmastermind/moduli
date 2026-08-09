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
import { render, screen, fireEvent, act } from "@testing-library/react";
import IntakeSheet, { describeIntakePayload, IntakeSheetHost, openIntakeSheet } from "../ui/IntakeSheet.jsx";
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

// ── STEP 2 ──────────────────────────────────────────────────────────────────
// A shape may need one more answer before it can run ("Set as field value"
// needs to know WHICH field). The sheet asks it in place rather than each shape
// growing its own dialog.
describe("IntakeSheet — a shape that asks a second question", () => {
  const withFollowUp = {
    payload: { kind: "link", urls: ["https://example.com"] },
    shapes: [
      { id: "link-chip", label: "Link chip" },
      {
        id: "link-field-value",
        label: "Set as field value",
        followUp: {
          kind: "choose-one",
          title: "Which field?",
          options: [
            { value: "f-web", label: "Website" },
            { value: "f-li", label: "LinkedIn" },
          ],
        },
      },
    ],
    fallback: "link-chip",
  };

  function open2(props = {}) {
    const onPick = vi.fn(), onCancel = vi.fn();
    render(<IntakeSheet classification={withFollowUp} onPick={onPick} onCancel={onCancel} {...props} />);
    return { onPick, onCancel };
  }

  it("picking it WRITES NOTHING — it opens the second question", () => {
    const { onPick } = open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    expect(onPick).not.toHaveBeenCalled();          // the assertion that matters
    expect(screen.getByTestId("intake-title").textContent).toBe("Which field?");
    expect(screen.getByTestId("intake-option-f-web")).toBeTruthy();
    expect(screen.getByTestId("intake-option-f-li")).toBeTruthy();
  });

  it("answering it commits the shape AND the answer", () => {
    const { onPick } = open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    fireEvent.click(screen.getByTestId("intake-option-f-li"));
    expect(onPick).toHaveBeenCalledWith("link-field-value", "f-li");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("a shape with NO follow-up still commits in one step", () => {
    const { onPick } = open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-chip"));
    expect(onPick).toHaveBeenCalledWith("link-chip");
  });

  it("step 2 pre-selects nothing either", () => {
    open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    for (const id of ["f-web", "f-li"]) {
      expect(document.activeElement).not.toBe(screen.getByTestId(`intake-option-${id}`));
    }
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });

  it("ESCAPE from step 2 goes BACK, and still commits nothing", () => {
    const { onPick, onCancel } = open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    fireEvent.keyDown(document, { key: "Escape" });
    // Back to the shapes — you answered "what should this become", not "which
    // field", so the gesture is not thrown away.
    expect(screen.getByTestId("intake-shape-link-field-value")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    // …and Escape again from step 1 does cancel.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the back button returns to the shapes", () => {
    const { onPick } = open2();
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    fireEvent.click(screen.getByTestId("intake-back"));
    expect(screen.getByTestId("intake-shape-link-chip")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });
});

// ── THE HOST IS A CALL SITE TOO ─────────────────────────────────────────────
// `IntakeSheetHost` is what App mounts and what every drop handler reaches
// through `openIntakeSheet`. Rendering IntakeSheet directly does NOT exercise
// it — and an A/B proved that: deleting the second argument from the host's
// onPick left every other test in this file green while the follow-up answer
// was silently dropped on the floor. That is the same class of defect that has
// bitten three sessions running (missing dispatch/userId, missing
// destinationModule, nobody passing onIntakeResult), so the seam gets its own
// test rather than being trusted.
describe("IntakeSheetHost — the seam the drop handlers actually use", () => {
  const classification = {
    payload: { kind: "link", urls: ["https://example.com"] },
    shapes: [{
      id: "link-field-value",
      label: "Set as field value",
      followUp: { kind: "choose-one", title: "Which field?", options: [{ value: "f-web", label: "Website" }] },
    }],
    fallback: "link-field-value",
  };

  it("delivers BOTH the shape and the follow-up answer to the caller", () => {
    const onPick = vi.fn();
    render(<IntakeSheetHost />);
    let opened;
    act(() => { opened = openIntakeSheet({ classification, onPick, onCancel: () => {} }); });
    expect(opened).toBe(true);

    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    expect(onPick).not.toHaveBeenCalled();          // step 2 is open, nothing written
    fireEvent.click(screen.getByTestId("intake-option-f-web"));

    expect(onPick).toHaveBeenCalledWith("link-field-value", "f-web");
  });

  it("the sheet is gone once the answer is given", () => {
    render(<IntakeSheetHost />);
    act(() => { openIntakeSheet({ classification, onPick: () => {}, onCancel: () => {} }); });
    fireEvent.click(screen.getByTestId("intake-shape-link-field-value"));
    expect(document.querySelector(".intake-sheet")).toBeTruthy();   // step 2 open
    fireEvent.click(screen.getByTestId("intake-option-f-web"));
    // A sheet still sitting there after you have answered it is a real bug.
    // (NOT asserted: that it closes synchronously INSIDE the callback — React
    // batches the state update, so that is not observable and never was.)
    expect(document.querySelector(".intake-sheet")).toBeNull();
  });
});
