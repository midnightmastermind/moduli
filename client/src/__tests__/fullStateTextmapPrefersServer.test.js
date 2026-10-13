// @vitest-environment jsdom
// FULL_STATE kept the textmap already in memory over the one in the payload. That was meant for
// rows the server sends WITHOUT a textmap; for a row that carries one, the server's is the truth
// (a boot snapshot or an earlier load holds older text).
import { describe, it, expect } from "vitest";
import { masterReducer } from "../state/masterReducer";
import { ActionTypes } from "../state/actions";
import { initialState } from "../state/initialState";

const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const full = (occurrences) => ({ type: ActionTypes.FULL_STATE, payload: { gridId: "g", occurrences } });

describe("FULL_STATE textmap merge", () => {
  const before = masterReducer(initialState, full([{ id: "a", textmap: doc("old") }, { id: "b", textmap: doc("keep") }]));
  const after = masterReducer(before, full([{ id: "a", textmap: doc("new") }, { id: "b" }]));
  const by = Object.fromEntries(after.occurrences.map((o) => [o.id, o]));
  it("takes the server's textmap when the payload carries one", () => {
    expect(by.a.textmap.content[0].content[0].text).toBe("new");
  });
  it("keeps the in-memory textmap when the payload has none (control)", () => {
    expect(by.b.textmap.content[0].content[0].text).toBe("keep");
  });
});
