// A pasted link to a media FILE could only become a chip / bookmark / page — nothing could file it
// as the artifact it is (poms' Files/Examples samples were seed-written). "File from the link".
import { describe, it, expect, vi } from "vitest";
import { externalFileOf } from "../helpers/externalFile.js";
import { classifyIntake, normalizeIntakePayload } from "../helpers/intake.js";

describe("externalFileOf", () => {
  it("reads image / video / pdf off the path, ignoring the query", () => {
    expect(externalFileOf("https://upload.wikimedia.org/a/1280px-NASA-Apollo8-Dec24-Earthrise.jpg?x=1"))
      .toEqual({ kind: "image", mimeType: "image/jpeg", fileName: "1280px-NASA-Apollo8-Dec24-Earthrise.jpg" });
    expect(externalFileOf("https://x.org/Big_Buck_Bunny_4K.webm.480p.vp9.webm").kind).toBe("video");
    expect(externalFileOf("https://www.w3.org/dummy.pdf")).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
  });
  it("control: a page is not a file", () => {
    expect(externalFileOf("https://en.wikipedia.org/wiki/Bonsai")).toBe(null);
    expect(externalFileOf("https://x.org/index.html")).toBe(null);
    expect(externalFileOf("not a url")).toBe(null);
  });
});

describe("the link intake offers it for a media URL", () => {
  const dest = { kind: "board" };
  it("one media link: File from the link is offered and preselected", () => {
    const c = classifyIntake(normalizeIntakePayload({ url: "https://x.org/a/photo.jpg" }), dest);
    expect(c.shapes.map((s) => s.id)).toContain("link-file");
    expect(c.fallback).toBe("link-file");
  });
  it("control: a page link does not get it", () => {
    const c = classifyIntake(normalizeIntakePayload({ url: "https://en.wikipedia.org/wiki/Bonsai" }), dest);
    expect(c.shapes.map((s) => s.id)).not.toContain("link-file");
  });
});

describe("addExternalFileOccurrence", () => {
  it("mints an external artifact listed in the container, in ONE action", async () => {
    const CH = await import("../helpers/CommitHelpers.js");
    const emits = []; const socket = { connected: true, emit: (ev, data) => emits.push([ev, data]) };
    const made = CH.addExternalFileOccurrence({
      dispatch: () => {}, socket, gridId: "g", userId: "u",
      containerOccurrence: { id: "c", occurrences: ["a"] },
      url: "https://x.org/photo.jpg", file: externalFileOf("https://x.org/photo.jpg"), label: "Photo.jpg",
    });
    expect(made.module).toMatchObject({ role: "artifact", kind: "image", fileRef: "https://x.org/photo.jpg", label: "Photo.jpg", meta: { external: true, mimeType: "image/jpeg" } });
    const evs = emits.map((e) => e[0]);
    expect(evs).toEqual(expect.arrayContaining(["create_module", "create_occurrence", "update_occurrence"]));
    const ids = new Set(emits.map((e) => e[1]?.__actionId).filter(Boolean));
    expect(ids.size).toBe(1);
    const list = emits.find((e) => e[0] === "update_occurrence")[1].occurrence.occurrences;
    expect(list).toEqual(["a", made.occurrence.id]);
  });
});
