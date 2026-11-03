// A movie Jellyfin streams has no file; its VHS tape plays through the app's player (user, 2026-11-03).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { watchSrc } from "../vr/shelfItems.js";

vi.mock("../ui/JellyfinPlayer.jsx", () => ({ default: ({ occurrenceId }) => <div>player {occurrenceId}</div> }));
import { ReaderPlayer } from "../ReaderApp.jsx";

describe("VHS tapes for Jellyfin rows", () => {
  it("a linked row's tape is watch:<row>; a row Jellyfin does not know has none", () => {
    expect(watchSrc({ id: "m1", meta: { jellyfinId: "j" } })).toBe("watch:m1");
    expect(watchSrc({ id: "m2", meta: {} })).toBe(null);
  });
  it("the headset window plays the row", () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ fields: [] }) }));
    render(<ReaderPlayer occurrence={{ id: "m1", meta: { jellyfinId: "j" } }} label="Brightburn" gridId="g" getOcc={() => null} />);
    expect(screen.getByTestId("reader-player").textContent).toContain("player m1");
  });
});
