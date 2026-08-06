// Media-role field inputs, in BOTH densities.
//
// HISTORY, because this file's contract has changed twice: the compact pill
// shipped 2026-07-07 and the full-size input joined it 2026-07-11, both opening
// the ImagePicker over a raw URL STRING value.
//
// 2026-08-06 changed what the value IS and what the click DOES. The value is an
// artifact OCCURRENCE ID resolved through `helpers/occurrenceMedia`, and
// clicking opens the artifact SPREAD — every file the occurrence has, with
// adding one available in there. The pill deliberately stopped being an entry
// point to the picker so there is exactly one way to attach a file.
//
// A legacy string value therefore renders NO thumbnail on purpose: the
// migration is what fixes data, and a fallback here would hide an unmigrated
// grid. That negative case is asserted below rather than left implicit.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

vi.mock("../ui/ArtifactSpreadHost", () => ({
  openArtifactSpread: vi.fn(),
  ArtifactSpreadHost: () => null,
}));
import { openArtifactSpread } from "../ui/ArtifactSpreadHost";

import Field from "../ui/Field";

const HOST_OCC = { id: "o-movie", moduleId: "m-movie", fields: { "f-poster": { value: "art1" } } };
const MAPS = {
  occurrencesById: {
    "o-movie": HOST_OCC,
    art1: { id: "art1", moduleId: "m-art", fields: {} },
  },
  modulesById: {
    "m-movie": { id: "m-movie", label: "Inception", fieldBindings: [{ fieldId: "f-poster", role: "media" }] },
    "m-art": { id: "m-art", role: "artifact", kind: "image", fileRef: "user/poster.png", label: "poster.png" },
  },
  fieldsById: {},
};

function renderWithCtx(node, maps = MAPS) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    ...maps,
    operationsById: {},
    getOccMap: () => maps.occurrencesById,
    state: { grid: {} },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>
  );
}

const posterField = { id: "f-poster", type: "text", name: "Poster", inputEnabled: true, meta: {} };
const mediaBinding = { role: "media", fieldId: "f-poster" };

beforeEach(() => { openArtifactSpread.mockClear(); });

describe("Field — a media-role input opens the artifact spread", () => {
  it("compact: renders the thumbnail and opens the spread on click", () => {
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="art1" hostOccurrence={HOST_OCC} compact onCommit={vi.fn()} />
    );
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn.querySelector("img")?.getAttribute("src")).toContain("poster.png");
    fireEvent.click(btn);
    expect(openArtifactSpread).toHaveBeenCalledTimes(1);
    expect(openArtifactSpread.mock.calls[0][0]).toBe("o-movie");
  });

  it("NON-compact: renders a thumbnail button, not a raw URL text input", () => {
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="art1" hostOccurrence={HOST_OCC} onCommit={vi.fn()} />
    );
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(btn.querySelector("img")?.getAttribute("src")).toContain("poster.png");
    fireEvent.click(btn);
    expect(openArtifactSpread).toHaveBeenCalledTimes(1);
  });

  it("opens the spread even with NO file yet — the empty state is the add tile", () => {
    const bare = { id: "o-bare", moduleId: "m-movie", fields: {} };
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="" hostOccurrence={bare} compact onCommit={vi.fn()} />,
      { ...MAPS, occurrencesById: { ...MAPS.occurrencesById, "o-bare": bare } }
    );
    const btn = container.querySelector("button");
    expect(btn.querySelector("img")).toBeNull();
    fireEvent.click(btn);
    expect(openArtifactSpread).toHaveBeenCalledTimes(1);
    expect(openArtifactSpread.mock.calls[0][0]).toBe("o-bare");
  });

  it("renders NO thumbnail for a legacy STRING value — no silent passthrough", () => {
    const legacy = { id: "o-legacy", moduleId: "m-movie", fields: { "f-poster": { value: "user/poster.png" } } };
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="user/poster.png" hostOccurrence={legacy} compact onCommit={vi.fn()} />,
      { ...MAPS, occurrencesById: { ...MAPS.occurrencesById, "o-legacy": legacy } }
    );
    expect(container.querySelector("button img")).toBeNull();
  });

  it("does not open the spread when the field is disabled", () => {
    const { container } = renderWithCtx(
      <Field field={posterField} binding={mediaBinding} value="art1" hostOccurrence={HOST_OCC} compact disabled onCommit={vi.fn()} />
    );
    fireEvent.click(container.querySelector("button"));
    expect(openArtifactSpread).not.toHaveBeenCalled();
  });

  it("plain (non-media) text field keeps its raw text input", () => {
    const plain = { id: "f-t", type: "text", name: "Notes", inputEnabled: true, meta: {} };
    const { container } = renderWithCtx(
      <Field field={plain} binding={{ role: "input" }} value="hi" onCommit={vi.fn()} />
    );
    expect(container.querySelector('input[type="text"]')).toBeTruthy();
    expect(openArtifactSpread).not.toHaveBeenCalled();
  });
});
