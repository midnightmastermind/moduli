// The text of pages nobody had open arrives with the second message (server holdBackText) and fills its rows.
import { describe, it, expect } from "vitest";
import { masterReducer } from "../state/masterReducer";
import { ActionTypes } from "../state/actions";

const base = { occurrences: [
  { id: "held", textHeld: true },
  { id: "reconnected", textHeld: true, textmap: { old: true } },
  { id: "typed", textmap: { local: true } },
], modules: [] };
const rest = (textmaps) => masterReducer(base, { type: ActionTypes.FULL_STATE_REST, payload: { occurrences: [], modules: [], textmaps } });

describe("held text", () => {
  it("fills a held row and clears the mark", () => {
    const s = rest({ held: { t: 1 } });
    expect(s.occurrences[0]).toEqual({ id: "held", textmap: { t: 1 } });
  });
  it("replaces the in-memory text of a held row (a reconnect)", () => {
    expect(rest({ reconnected: { t: 2 } }).occurrences[1].textmap).toEqual({ t: 2 });
  });
  it("never replaces text on a row that was not held", () => {
    expect(rest({ typed: { t: 3 } }).occurrences[2].textmap).toEqual({ local: true });
  });
  it("text alone still ends the wait", () => {
    expect(rest({ held: { t: 1 } }).awaitingDeferred).toBe(false);
  });
});
