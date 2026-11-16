// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { extractCreatedOccId } from "../ui/AssistantDrawer.jsx";

describe("after Jonah acts, the window can open what it made", () => {
  it("a build names its page; a change names the row it changed", () => {
    expect(extractCreatedOccId("build", { ok: true, made: ["doc page Home"], rootOccurrenceId: "p1" })).toBe("p1");
    expect(extractCreatedOccId("change", { ok: true, changed: "Mail", occurrenceId: "m1" })).toBe("m1");
  });
  it("a build that wrote but kept a problem still links (ok:false is not 'nothing written')", () => {
    expect(extractCreatedOccId("build", { ok: false, problems: ["x"], rootOccurrenceId: "p1" })).toBe("p1");
  });
  it("an error or a reply with no id links nothing", () => {
    expect(extractCreatedOccId("change", { ok: false, error: "nothing named X" })).toBe(null);
    expect(extractCreatedOccId("remove", { ok: true, removed: "Social", count: 3 })).toBe(null);
  });
});
