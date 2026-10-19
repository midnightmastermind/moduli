// Define opens a card with the word's meanings (it was a sonner toast nothing mounts),
// and the lookup retries the singular (the dictionary has no plurals).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { defineWord, singularCandidates } from "../helpers/textLookup.js";
import { DefinitionHost, openDefinition, definitionCardPosition } from "../ui/DefinitionCard.jsx";

const ok = (defs) => ({ ok: true, json: async () => [{ meanings: [{ partOfSpeech: "noun", definitions: defs.map((d) => ({ definition: d })) }] }] });
const miss = { ok: false, json: async () => ({}) };

describe("defineWord", () => {
  it("tries the singular when the plural has no entry", async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith("/religions") ? miss : ok(["A system of faith"])));
    expect(await defineWord("religions", fetchImpl)).toEqual(["(noun) A system of faith"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("singular forms", () => {
    expect(singularCandidates("stories")).toContain("story");
    expect(singularCandidates("boxes")).toContain("box");
    expect(singularCandidates("glass")).toEqual([]);
  });
});

describe("DefinitionCard", () => {
  it("opens with the word's definitions and closes on Escape", async () => {
    globalThis.fetch = vi.fn(async () => ok(["A miniature tree"]));
    render(<DefinitionHost />);
    expect(openDefinition("bonsai")).toBe(true);
    expect(await screen.findByText("(noun) A miniature tree")).toBeInTheDocument();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByTestId("definition-card")).toBeNull();
  });
  it("says so when there is no definition", async () => {
    globalThis.fetch = vi.fn(async () => miss);
    render(<DefinitionHost />);
    act(() => { openDefinition("zxqv"); });
    expect(await screen.findByText("No definition found.")).toBeInTheDocument();
  });
  it("keeps the card on screen near the click", () => {
    expect(definitionCardPosition(1580, 950, 1600, 1000)).toEqual({ top: 730, left: 1272 });
    expect(definitionCardPosition(100, 100, 1600, 1000)).toEqual({ top: 108, left: 100 });
  });
});
