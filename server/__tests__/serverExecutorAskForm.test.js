// A form needs someone in the app: run server-side (a share rule), "Ask with a form" STOPS the operation — the steps
// after it read its answers — and says so.
import { describe, it, expect, vi } from "vitest";

vi.mock("../models/Occurrence.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../models/Module.js", () => ({ default: {} }));
vi.mock("../services/occurrenceMint.js", () => ({ mintOccurrence: async () => ({}) }));

const { runOperationServerSide } = await import("../services/serverExecutor.js");
const show = (id, v) => ({ id, type: "action", config: { type: "SHOW_VALUE", name: `$${id}`, value: v } });

describe("ASK_FORM on the server", () => {
  it("stops at the form: earlier steps ran, later ones did not", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await runOperationServerSide({ id: "op", name: "New movie", pipeline: { steps: [
      show("before", "1"),
      { id: "f", type: "action", config: { type: "ASK_FORM", items: [{ key: "name", label: "Name" }] } },
      show("after", "2"),
    ] } }, { userId: "u", gridId: "g" });
    expect(res.vars).toEqual({ $before: 1 });
    expect(res.unsupported).toContain("ASK_FORM");
    expect(res.stoppedAt).toBe("f");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("a form needs someone in the app"))).toBe(true);
    warn.mockRestore();
  });

  it("a stop inside a loop stops the rest of the loop too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await runOperationServerSide({ id: "op", pipeline: { steps: [
      { id: "l", type: "loop", overExpr: "json:[1,2]", as: "$i", body: [
        { id: "f", type: "action", config: { type: "ASK_FORM", items: [] } },
        show("inLoop", "x"),
      ] },
      show("after", "2"),
    ] } }, { userId: "u", gridId: "g" });
    expect(res.vars).toEqual({});
  });
});
