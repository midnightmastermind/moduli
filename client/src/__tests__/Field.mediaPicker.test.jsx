// Media-role (image) field inputs open the ImagePicker in BOTH densities
// (2026-07-11): the compact pill shipped 2026-07-07; the full-size (non-compact)
// input used to fall through to a raw URL text box — profile pics / image
// fields edited in forms had no search. Both now render a thumbnail +
// "Set image…" affordance wired to openImagePicker.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

vi.mock("../ui/ImagePickerMenu", () => ({
  openImagePicker: vi.fn(),
  default: () => null,
}));
import { openImagePicker } from "../ui/ImagePickerMenu";

import Field from "../ui/Field";

function renderWithCtx(node) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
    state: { grid: {} },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>
  );
}

const posterField = { id: "f-poster", type: "text", name: "Poster", inputEnabled: true, meta: {} };
const mediaBinding = { role: "media" };

beforeEach(() => { openImagePicker.mockClear(); });

describe("Field — media-role text input opens the ImagePicker", () => {
  it("compact: renders the set-image pill and opens the picker on click", () => {
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="" compact onCommit={vi.fn()} />
    );
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(openImagePicker).toHaveBeenCalledTimes(1);
  });

  it("NON-compact: renders a set-image button (not a raw URL text input) and opens the picker", () => {
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="https://img.example/p.jpg" onCommit={vi.fn()} />
    );
    // No raw text input for the URL — the picker owns the value.
    expect(container.querySelector('input[type="text"]')).toBeNull();
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    // Thumbnail of the current value renders inside the button.
    expect(btn.querySelector("img")?.getAttribute("src")).toContain("img.example/p.jpg");
    fireEvent.click(btn);
    expect(openImagePicker).toHaveBeenCalledTimes(1);
  });

  it("non-compact picker pick commits through the normal field path", () => {
    const onCommit = vi.fn();
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="" onCommit={onCommit} />
    );
    fireEvent.click(container.querySelector("button"));
    const req = openImagePicker.mock.calls[0][0];
    req.onPick("https://img.example/new.png");
    expect(onCommit).toHaveBeenCalledWith("https://img.example/new.png");
  });

  it("plain (non-media) text field keeps its raw text input", () => {
    const plain = { id: "f-t", type: "text", name: "Notes", inputEnabled: true, meta: {} };
    const { container } = renderWithCtx(
      <Field field={plain} binding={{ role: "input" }} value="hi" onCommit={vi.fn()} />
    );
    expect(container.querySelector('input[type="text"]')).toBeTruthy();
    expect(openImagePicker).not.toHaveBeenCalled();
  });
});
