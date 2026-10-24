import { describe, it, expect, vi } from "vitest";
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: vi.fn(), deleteOccurrence: vi.fn(), createModule: vi.fn(), createOccurrence: vi.fn() }));
import * as CommitHelpers from "../helpers/CommitHelpers";
import { pageTextblocks, runPageMagic } from "../helpers/pageMagic.js";

const tb = (id, text) => ({ id, moduleId: `m${id}`, textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
const maps = {
  occurrencesById: { a: tb("a", "# Title\n"), pic: { id: "pic", moduleId: "mpic" }, b: tb("b", "") },
  modulesById: { ma: { id: "ma", role: "textblock" }, mpic: { id: "mpic", role: "artifact" }, mb: { id: "mb", role: "textblock" } },
};
const page = { id: "page", occurrences: ["a", "pic", "b"], textmap: { type: "doc", content: [
  { type: "instanceTextblock", attrs: { occurrenceId: "a" } }, { type: "moduleEmbed", attrs: { occurrenceId: "pic" } }, { type: "instanceTextblock", attrs: { occurrenceId: "b" } },
] } };

describe("Magic on a page", () => {
  it("takes the page's textblocks that hold text — not pictures, not empty blocks", () => {
    expect(pageTextblocks(page, maps).map((t) => [t.index, t.occurrenceId])).toEqual([[0, "a"]]);
  });

  it("puts the planned section where the textblock was, deletes the textblock, and keeps the rest", async () => {
    const plan = { ok: true, rootOccurrenceId: "r", occurrences: [{ id: "r", moduleId: "rm", occurrences: [] }], modules: [{ id: "rm", role: "container", kind: "doc" }] };
    const socket = { emit: (ev, payload, ack) => ack(plan) };
    const res = await runPageMagic({ pageOcc: page, maps, socket, dispatch: vi.fn(), gridId: "g", userId: "u" });
    expect(res).toEqual({ ok: true, converted: 1 });
    const written = CommitHelpers.updateOccurrence.mock.calls.at(-1)[0].occurrence;
    expect(written.textmap.content[0].type).toBe("moduleEmbed");
    expect(written.textmap.content[1]).toEqual(page.textmap.content[1]);
    expect(written.occurrences).not.toContain("a");
    expect(written.occurrences).toContain("pic");
    expect(CommitHelpers.deleteOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "a", fromParentId: "page" }));
  });
});
