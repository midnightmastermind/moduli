import { describe, it, expect, vi } from "vitest";
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: vi.fn(), deleteOccurrence: vi.fn(), createModule: vi.fn(), createOccurrence: vi.fn() }));
import * as CommitHelpers from "../helpers/CommitHelpers";
import { pageTextblocks, runPageMagic, magicHosts } from "../helpers/pageMagic.js";

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

  // User, 2026-11-11: a page made with a link's "+ Page" (Reader) is page -> doc container -> ONE textblock holding
  // the whole article, and Magic said "no plain text blocks" — the page's own top level holds only the container.
  const nested = {
    occurrencesById: { box: { id: "box", moduleId: "mbox", occurrences: ["art"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "art" } }] } }, art: tb("art", "Intro"), sec: { id: "sec", moduleId: "msec", occurrences: ["inner"], textmap: { type: "doc", content: [{ type: "instanceTextblock", attrs: { occurrenceId: "inner" } }] } }, inner: tb("inner", "deep") },
    modulesById: { mbox: { id: "mbox", role: "container", kind: "doc" }, mart: { id: "mart", role: "textblock" }, msec: { id: "msec", role: "container", kind: "doc" }, minner: { id: "minner", role: "textblock" } },
  };
  const readerPage = { id: "rp", occurrences: ["box"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "box" } }] } };

  it("reaches the textblock inside a doc container on the page", () => {
    expect(magicHosts(readerPage, nested).map((h) => [h.host.id, h.items.map((i) => i.occurrenceId)])).toEqual([["box", ["art"]]]);
  });

  it("goes only one level down, so a second click does not re-plan the sections it made", () => {
    const madePage = { id: "mp", occurrences: ["box2"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "box2" } }] } };
    const maps2 = { occurrencesById: { ...nested.occurrencesById, box2: { id: "box2", moduleId: "mbox", occurrences: ["sec"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "sec" } }] } } }, modulesById: nested.modulesById };
    expect(magicHosts(madePage, maps2)).toEqual([]);
  });

  it("drops the planner's wrapper: its sections take the textblock's place in the container, parented to it", async () => {
    CommitHelpers.updateOccurrence.mockClear(); CommitHelpers.createOccurrence.mockClear(); CommitHelpers.createModule.mockClear();
    const plan = { ok: true, rootOccurrenceId: "r",
      occurrences: [
        { id: "r", moduleId: "rm", occurrences: ["s1", "s2"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "s1" } }, { type: "moduleEmbed", attrs: { occurrenceId: "s2" } }] } },
        { id: "s1", moduleId: "sm", occurrences: [] }, { id: "s2", moduleId: "sm", occurrences: [] },
      ],
      modules: [{ id: "rm", role: "container", kind: "doc", label: "Imported" }, { id: "sm", role: "container", kind: "doc" }] };
    const socket = { emit: (ev, payload, ack) => ack(plan) };
    const res = await runPageMagic({ pageOcc: readerPage, maps: nested, socket, dispatch: vi.fn(), gridId: "g", userId: "u" });
    expect(res).toEqual({ ok: true, converted: 1 });
    const written = CommitHelpers.updateOccurrence.mock.calls.at(-1)[0].occurrence;
    expect(written.id).toBe("box");
    expect(written.textmap.content).toHaveLength(2);
    expect(written.occurrences).toHaveLength(2);
    expect(written.occurrences).not.toContain("art");
    const made = CommitHelpers.createOccurrence.mock.calls.map((c) => c[0].occurrence);
    expect(made).toHaveLength(2);
    expect(made.every((o) => o.parentId === "box")).toBe(true);
    expect(written.textmap.content.map((n) => n.attrs.occurrenceId)).toEqual(made.map((o) => o.id));
    expect(CommitHelpers.createModule.mock.calls.map((c) => c[0].module.label)).not.toContain("Imported");
    expect(CommitHelpers.deleteOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "art", fromParentId: "box" }));
  });
});
